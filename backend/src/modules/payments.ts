/**
 * Pagos del portal del comprador.
 *  - TARJETA: pasarela certificada PCI. Stripe Checkout (USD, compradores internacionales) y/o
 *    Mercado Pago Checkout Pro (PEN: tarjetas y Yape en Perú). El ERP NUNCA recibe ni guarda los
 *    datos de la tarjeta: el comprador los ingresa en la página segura de la pasarela.
 *    Se activan con variables de entorno (STRIPE_SECRET_KEY, MP_ACCESS_TOKEN). Con claves de prueba
 *    (sk_test_…, TEST-…) los cobros son de prueba; con claves productivas, son REALES.
 *  - YAPE directo: QR/número del negocio + número de operación + constancia → verificación de Finanzas.
 *  - TRANSFERENCIA: CCI (Perú) o SWIFT (exterior) + número de operación + constancia → verificación.
 * Al aprobarse un pago se registra la cobranza y el motor fondea el escrow espejo del smart contract.
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { AppError, notFound, unprocessable } from "../lib/errors";
import { nextCode } from "../lib/sequence";
import { audit } from "../lib/audit";
import { D } from "../lib/decimal";
import { getSetting } from "../lib/settings";
import { sha256Hex } from "../lib/hash";
import { onPaymentApproved } from "./automation";
import { publicBase } from "./exportDocs";

export const paymentsRouter = Router();

const env = (k: string) => (process.env[k] || "").trim();
export const providers = () => ({
  stripe: !!env("STRIPE_SECRET_KEY"), stripeLive: env("STRIPE_SECRET_KEY").startsWith("sk_live_"),
  mercadopago: !!env("MP_ACCESS_TOKEN"), mercadopagoLive: !!env("MP_ACCESS_TOKEN") && !env("MP_ACCESS_TOKEN").startsWith("TEST-"),
  testMode: env("PAYMENTS_ALLOW_TEST") !== "false",
});
export async function accounts() {
  const s = await getSetting<any>("payments.accounts");
  return {
    yapeNumber: env("YAPE_NUMBER") || s?.yapeNumber || null, yapeHolder: env("YAPE_HOLDER") || s?.yapeHolder || null, yapeQrUrl: env("YAPE_QR_URL") || s?.yapeQrUrl || null,
    bankName: env("BANK_NAME") || s?.bankName || null, accountNumber: env("BANK_ACCOUNT") || s?.accountNumber || null, cci: env("BANK_CCI") || s?.cci || null,
    swift: env("BANK_SWIFT") || s?.swift || null, accountHolder: env("BANK_HOLDER") || s?.accountHolder || null, currency: s?.currency || "USD",
  };
}

async function newPayment(shipmentId: number, data: { provider: string; method: string; currency: string; amount: any; payerEmail?: string | null; payerName?: string | null }) {
  return inTx(async (tx) => tx.payment.create({ data: { code: await nextCode(tx, "PAG", new Date().getFullYear(), 4), shipmentId, ...data } }));
}

/** Aprueba un pago una sola vez (idempotente frente a webhooks repetidos). */
export async function approvePayment(paymentId: number, patch: { livemode?: boolean; externalId?: string; raw?: any; verifiedBy?: string }) {
  const upd = await prisma.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDIENTE", "EN_VERIFICACION"] } }, data: { status: "APROBADO", verifiedAt: new Date(), ...patch } });
  if (upd.count === 1) await onPaymentApproved(paymentId);
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

// ------------------------------------------------------------------ Stripe (REST)
async function stripe(path: string, method = "GET", body?: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body: body ? new URLSearchParams(body).toString() : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError(502, `Stripe: ${j?.error?.message ?? r.status}`, "PAYMENT_PROVIDER");
  return j;
}
// ------------------------------------------------------------------ Mercado Pago (REST)
async function mp(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`https://api.mercadopago.com${path}`, { method, headers: { Authorization: `Bearer ${env("MP_ACCESS_TOKEN")}`, "Content-Type": "application/json", "X-Idempotency-Key": crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError(502, `Mercado Pago: ${j?.message ?? r.status}`, "PAYMENT_PROVIDER");
  return j;
}

export async function startPayment(req: Request, shipmentId: number, input: { method: "TARJETA" | "YAPE" | "TRANSFERENCIA" | "PRUEBA"; provider?: "STRIPE" | "MERCADOPAGO"; amountUsd?: number; payerName?: string; payerEmail?: string }) {
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId } });
  if (["ANULADO", "COTIZACION"].includes(s.status)) throw unprocessable(s.status === "COTIZACION" ? "Confirme la cotización como pedido antes de pagar" : "Pedido anulado");
  const pending = D(s.amountUsd).minus(s.paidUsd);
  if (pending.lte(0)) throw unprocessable("El pedido ya está pagado");
  const amountUsd = D(input.amountUsd ?? pending).toDecimalPlaces(2);
  if (amountUsd.lte(0) || amountUsd.gt(pending)) throw unprocessable(`Importe inválido (pendiente US$ ${pending.toFixed(2)})`);
  const pv = providers();
  const base = publicBase();
  const back = (st: string, code: string) => `${base}/portal/pedidos/${s.code}?pago=${code}&estado=${st}`;
  const payer = { payerName: input.payerName ?? req.user?.name ?? null, payerEmail: input.payerEmail ?? req.user?.email ?? null };

  if (input.method === "TARJETA") {
    const prov = input.provider ?? (pv.stripe ? "STRIPE" : pv.mercadopago ? "MERCADOPAGO" : null);
    if (prov === "STRIPE" && pv.stripe) {
      const pay = await newPayment(s.id, { provider: "STRIPE", method: "TARJETA", currency: "USD", amount: amountUsd, ...payer });
      const sess = await stripe("/checkout/sessions", "POST", {
        mode: "payment", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd", "line_items[0][price_data][unit_amount]": amountUsd.times(100).toFixed(0),
        "line_items[0][price_data][product_data][name]": `Don Pimentón · pedido ${s.code} · ${s.jars} frascos de páprika 4 oz`, client_reference_id: pay.code, "metadata[payment]": pay.code, "metadata[shipment]": s.code,
        success_url: back("ok", pay.code), cancel_url: back("cancelado", pay.code), ...(payer.payerEmail ? { customer_email: payer.payerEmail } : {}),
      });
      return prisma.payment.update({ where: { id: pay.id }, data: { externalId: sess.id, checkoutUrl: sess.url, livemode: !!sess.livemode } });
    }
    if (prov === "MERCADOPAGO" && pv.mercadopago) {
      const pen = amountUsd.times(s.exchangeRate).toDecimalPlaces(2);
      const pay = await newPayment(s.id, { provider: "MERCADOPAGO", method: "TARJETA", currency: "PEN", amount: pen, ...payer });
      const pref = await mp("/checkout/preferences", "POST", {
        items: [{ title: `Don Pimentón · pedido ${s.code} (${s.jars} frascos)`, quantity: 1, unit_price: Number(pen), currency_id: "PEN" }],
        external_reference: pay.code, back_urls: { success: back("ok", pay.code), failure: back("rechazado", pay.code), pending: back("pendiente", pay.code) }, auto_return: "approved",
        notification_url: `${base}/api/payments/webhooks/mercadopago`, ...(payer.payerEmail ? { payer: { email: payer.payerEmail } } : {}),
      });
      return prisma.payment.update({ where: { id: pay.id }, data: { externalId: pref.id, checkoutUrl: pv.mercadopagoLive ? pref.init_point : pref.sandbox_init_point ?? pref.init_point, livemode: pv.mercadopagoLive } });
    }
    throw new AppError(503, "El pago con tarjeta requiere configurar una pasarela (Stripe o Mercado Pago) con las credenciales de comercio de Don Pimentón. Mientras tanto use Yape, transferencia o el pago de prueba.", "PAYMENT_NOT_CONFIGURED");
  }
  if (input.method === "YAPE" || input.method === "TRANSFERENCIA") {
    const acc = await accounts();
    if (input.method === "YAPE" && !acc.yapeNumber) throw new AppError(503, "Yape aún no está configurado (falta el número o QR de Yape del negocio).", "PAYMENT_NOT_CONFIGURED");
    if (input.method === "TRANSFERENCIA" && !acc.accountNumber && !acc.cci) throw new AppError(503, "La transferencia aún no está configurada (faltan los datos de la cuenta bancaria del negocio).", "PAYMENT_NOT_CONFIGURED");
    const currency = input.method === "YAPE" ? "PEN" : acc.currency;
    const amount = currency === "PEN" ? amountUsd.times(s.exchangeRate).toDecimalPlaces(2) : amountUsd;
    const pay = await newPayment(s.id, { provider: input.method, method: input.method, currency, amount, ...payer });
    return { ...pay, instructions: input.method === "YAPE" ? { yapeNumber: acc.yapeNumber, holder: acc.yapeHolder, qr: acc.yapeQrUrl, note: "Yapee el importe exacto e ingrese el número de operación. Yape tiene límites diarios por usuario." } : { bank: acc.bankName, account: acc.accountNumber, cci: acc.cci, swift: acc.swift, holder: acc.accountHolder, currency, note: "Transfiera el importe exacto y registre el número de operación y la constancia." } };
  }
  if (input.method === "PRUEBA") {
    if (!pv.testMode) throw unprocessable("Los pagos de prueba están deshabilitados en este entorno");
    const pay = await newPayment(s.id, { provider: "SIMULADO", method: "PRUEBA", currency: "USD", amount: amountUsd, ...payer });
    return approvePayment(pay.id, { livemode: false, externalId: `TEST-${pay.code}`, verifiedBy: "Pago de prueba (sin dinero real)" });
  }
  throw unprocessable("Método de pago no soportado");
}

/** Confirma el estado consultando a la pasarela (no confía en el navegador). */
export async function refreshPayment(id: number) {
  const pay = await prisma.payment.findUniqueOrThrow({ where: { id } });
  if (pay.status !== "PENDIENTE" || !pay.externalId) return pay;
  if (pay.provider === "STRIPE" && providers().stripe) {
    const sess = await stripe(`/checkout/sessions/${pay.externalId}`);
    if (sess.payment_status === "paid") return approvePayment(pay.id, { livemode: !!sess.livemode, raw: { id: sess.id, payment_intent: sess.payment_intent } });
    if (sess.status === "expired") return prisma.payment.update({ where: { id }, data: { status: "EXPIRADO" } });
  }
  if (pay.provider === "MERCADOPAGO" && providers().mercadopago) {
    const r = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(pay.code)}`);
    const ok = (r.results ?? []).find((x: any) => x.status === "approved");
    if (ok) return approvePayment(pay.id, { livemode: !!ok.live_mode, raw: { id: ok.id, method: ok.payment_method_id } });
    if ((r.results ?? []).some((x: any) => x.status === "rejected")) return prisma.payment.update({ where: { id }, data: { status: "RECHAZADO" } });
  }
  return prisma.payment.findUniqueOrThrow({ where: { id } });
}

export async function submitManual(paymentId: number, input: { operationNumber: string; voucherName?: string; voucherBase64?: string }) {
  const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (!["YAPE", "TRANSFERENCIA"].includes(pay.provider)) throw unprocessable("Este pago no requiere constancia");
  if (pay.status !== "PENDIENTE") throw unprocessable("El pago ya fue enviado a verificación");
  const dup = await prisma.payment.findFirst({ where: { operationNumber: input.operationNumber, provider: pay.provider, id: { not: pay.id } } });
  if (dup) throw unprocessable("Ese número de operación ya fue registrado en otro pago (posible duplicado)");
  let voucherHash: string | null = null;
  if (input.voucherBase64) {
    const buf = Buffer.from(input.voucherBase64.replace(/^data:[^,]+,/, ""), "base64");
    if (buf.length > 5 * 1024 * 1024) throw unprocessable("La constancia supera 5 MB");
    voucherHash = sha256Hex(buf);
  }
  return prisma.payment.update({ where: { id: pay.id }, data: { status: "EN_VERIFICACION", operationNumber: input.operationNumber, voucherName: input.voucherName ?? null, voucherHash } });
}

// ------------------------------------------------------------------ webhooks (sin sesión; verificados)
export async function stripeWebhook(req: Request, res: Response) {
  const secret = env("STRIPE_WEBHOOK_SECRET");
  const raw: Buffer = req.body;
  const sig = String(req.headers["stripe-signature"] ?? "");
  if (!secret) return res.status(503).json({ error: "Webhook no configurado" });
  const parts = Object.fromEntries(sig.split(",").map((kv) => kv.split("=") as [string, string]));
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw.toString("utf8")}`).digest("hex");
  const okSig = parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  if (!okSig || Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return res.status(400).json({ error: "Firma inválida" });
  const ev = JSON.parse(raw.toString("utf8"));
  if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
    const pay = await prisma.payment.findFirst({ where: { provider: "STRIPE", externalId: ev.data.object.id } });
    if (pay && ev.data.object.payment_status === "paid") await approvePayment(pay.id, { livemode: !!ev.livemode, raw: { event: ev.id } });
  }
  res.json({ received: true });
}
export async function mercadopagoWebhook(req: Request, res: Response) {
  const id = String(req.query["data.id"] ?? req.body?.data?.id ?? "");
  if (id && providers().mercadopago) {
    const p = await mp(`/v1/payments/${encodeURIComponent(id)}`).catch(() => null); // se verifica consultando a la API, no se confía en el cuerpo
    if (p?.status === "approved" && p.external_reference) {
      const pay = await prisma.payment.findUnique({ where: { code: p.external_reference } });
      if (pay) await approvePayment(pay.id, { livemode: !!p.live_mode, raw: { id: p.id } });
    }
  }
  res.json({ received: true });
}

// ------------------------------------------------------------------ ERP: cobranza y verificación
paymentsRouter.get("/", requirePerm("payments.read"), ah(async (_req, res) => {
  res.json({ providers: providers(), accounts: await accounts(), items: await prisma.payment.findMany({ orderBy: { id: "desc" }, take: 200, include: { shipment: { select: { code: true, importer: true, amountUsd: true, paidUsd: true } } } }) });
}));
paymentsRouter.post("/:id/verify", requirePerm("payments.verify"), ah(async (req, res) => {
  const { approve, note } = parse(z.object({ approve: z.boolean(), note: z.string().max(200).optional() }), req.body);
  const pay = await prisma.payment.findUnique({ where: { id: idParam(req) } });
  if (!pay) throw notFound();
  if (pay.status !== "EN_VERIFICACION") throw unprocessable("Solo se verifican pagos enviados con constancia");
  const out = approve ? await approvePayment(pay.id, { livemode: true, verifiedBy: `${req.user!.name}${note ? " · " + note : ""}` }) : await prisma.payment.update({ where: { id: pay.id }, data: { status: "RECHAZADO", verifiedBy: req.user!.name, verifiedAt: new Date() } });
  await audit(prisma, req.user!.id, approve ? "VERIFICAR_PAGO" : "RECHAZAR_PAGO", "pago", pay.id, { code: pay.code, op: pay.operationNumber });
  res.json(out);
}));
paymentsRouter.post("/:id/refresh", requirePerm("payments.read"), ah(async (req, res) => res.json(await refreshPayment(idParam(req)))));
paymentsRouter.put("/accounts", requirePerm("settings.manage"), ah(async (req, res) => {
  const value = parse(z.object({ yapeNumber: z.string().regex(/^9\d{8}$/, "Número Yape de 9 dígitos").nullable().optional(), yapeHolder: z.string().max(80).nullable().optional(), yapeQrUrl: z.string().url().nullable().optional(), bankName: z.string().max(80).nullable().optional(), accountNumber: z.string().max(40).nullable().optional(), cci: z.string().regex(/^\d{20}$/, "CCI de 20 dígitos").nullable().optional(), swift: z.string().max(11).nullable().optional(), accountHolder: z.string().max(120).nullable().optional(), currency: z.enum(["USD", "PEN"]).default("USD") }), req.body);
  await prisma.setting.upsert({ where: { key: "payments.accounts" }, create: { key: "payments.accounts", value }, update: { value } });
  await audit(prisma, req.user!.id, "CONFIGURAR_CUENTAS_COBRO", "settings", "payments.accounts", {});
  res.json(value);
}));
