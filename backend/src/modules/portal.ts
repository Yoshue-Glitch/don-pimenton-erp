/**
 * Portal del comprador (importador / broker) vinculado al ERP y al smart contract,
 * y rutas públicas: catálogo, registro de compradores, consulta QR de trazabilidad y chat.
 */
import { Router, Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { AppError, forbidden, notFound, unprocessable } from "../lib/errors";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { D } from "../lib/decimal";
import { hashObject } from "../lib/hash";
import * as T from "./trade.service";
import * as A from "./automation";
import * as chain from "../blockchain/chain";
import { shipmentPdf, PORTAL_DOCS, DOC_TYPES, traceUrl } from "./exportDocs";
import { startPayment, refreshPayment, submitManual, providers, accounts } from "./payments";
import { ask, aiEnabled } from "./assistant";
import { stagePayloads } from "./automation";

export const portalRouter = Router();
export const publicRouter = Router();

const myCustomer = (req: Request) => {
  const id = req.user?.customerId;
  if (!id) throw forbidden("Su usuario no está vinculado a un cliente importador");
  return id;
};
async function myShipment(req: Request, code: string) {
  const s = await prisma.exportShipment.findFirst({ where: { code, customerId: myCustomer(req) } });
  if (!s) throw notFound("Pedido no encontrado");
  return s;
}

async function catalog() {
  const p = await T.params();
  const pallets = await prisma.pallet.findMany({ where: { status: "DISPONIBLE", shipmentId: null }, include: { lot: true } });
  const approved = [];
  for (const pl of pallets) if ((await T.coaApproved(prisma, pl.lotId)).ok) approved.push(pl);
  const pw = T.palletWeights(p);
  return {
    product: { name: "Premium Ground Paprika · Páprika molida premium", origin: "Caravelí, Arequipa — Product of Peru", net: `${p.jarNetG} g (4 oz)`, jar: "Frasco de vidrio con tapa dosificadora y sello de inducción", shelfLife: `${p.bestByMonths} meses (Best by)`, hts: p.htsCode, gtin: T.gtinCodes(p.gs1CompanyPrefix) },
    packaging: { jarsPerCase: p.jarsPerCase, casesPerPallet: p.casesPerPallet, jarsPerPallet: pw.jars, netKgPerPallet: pw.netKg, grossKgPerPallet: pw.grossKg },
    priceUsdPerJar: p.defaultPriceUsd, priceNote: "Precio de referencia de prueba (FCA Callao). El precio final se confirma en la proforma.",
    incoterms: ["FCA", "FOB"], incotermVersion: p.incotermVersion, originPort: p.originPort, destinationPort: p.destinationPort, transitDays: p.voyageDays,
    availablePallets: approved.length, availableJars: approved.length * pw.jars, leadTimeDays: approved.length ? 10 : 45,
    specs: await T.limits(),
    certifications: (await prisma.complianceItem.findMany({ where: { scope: "EMPRESA" } })).map((c) => ({ name: c.name, authority: c.authority, status: T.complianceStatus(c) })),
    payments: { card: providers().stripe || providers().mercadopago, yape: !!(await accounts()).yapeNumber, transfer: !!((await accounts()).cci || (await accounts()).accountNumber), test: providers().testMode },
  };
}

// ------------------------------------------------------------------ público
publicRouter.get("/assistant-status", (_req, res) => res.json({ mode: aiEnabled() ? "CLAUDE" : "LOCAL", enabled: aiEnabled() }));
publicRouter.get("/catalog", ah(async (_req, res) => res.json(await catalog())));

/** Consulta pública del QR: historia de origen verificable (sin datos personales ni comerciales). */
publicRouter.get("/trace/:lot", ah(async (req, res) => {
  const lot = await prisma.lot.findUnique({ where: { code: req.params.lot }, include: { product: true, parentLot: { include: { parentLot: { include: { harvest: true, campaign: { include: { parcel: true } } } }, labAnalyses: { where: { result: "APROBADO" }, take: 1 } } }, harvest: true, campaign: { include: { parcel: true } }, pallets: { select: { sscc: true, status: true } } } });
  if (!lot) throw notFound("Lote no encontrado");
  const raw = lot.parentLot?.parentLot ?? (lot.type === "MATERIA_PRIMA" ? lot : null);
  const parcel = raw?.campaign?.parcel ?? lot.campaign?.parcel;
  let onchain: any = null, milestones: any[] = [], verification: any[] = [];
  try {
    onchain = await chain.readLot(lot.code);
    milestones = await chain.readMilestones(lot.code);
    if (milestones.length && lot.product.code === "PT-PAP-FRASCO-113") {
      const payloads: any = await stagePayloads(lot.code);
      verification = milestones.map((m) => ({ stage: m.stage, onchainHash: m.docHash, matches: payloads[m.stage] ? hashObject(payloads[m.stage]) === m.docHash : null }));
    }
  } catch { onchain = { error: "La red blockchain local no responde" }; }
  const ship = await prisma.exportShipment.findFirst({ where: { lotId: lot.id }, select: { code: true, status: true, destinationPort: true, vessel: true, voyageProgress: true, shipDate: true } });
  res.json({
    lot: lot.code, product: lot.product.name, productionDate: lot.productionDate, bestBy: lot.expiryDate, quality: lot.qualityStatus,
    origin: parcel ? { parcel: parcel.code, location: parcel.location, areaHa: parcel.areaHa, crop: parcel.cropType } : null,
    harvest: raw?.harvest ? { code: raw.harvest.code, date: raw.harvest.date } : null, bulkLot: lot.parentLot?.code ?? null,
    coa: lot.parentLot?.labAnalyses[0] ? { code: lot.parentLot.labAnalyses[0].code, laboratory: lot.parentLot.labAnalyses[0].laboratory, approvedAt: lot.parentLot.labAnalyses[0].approvedAt, hash: lot.certHash } : null,
    pallets: lot.pallets, shipment: ship, onchain, milestones, verification, url: traceUrl(lot.code),
    note: "Consulta pública de demostración. Los datos son ficticios; la blockchain es una red local de prueba.",
  });
}));

const regSchema = z.object({ company: z.string().min(2).max(120), taxId: z.string().min(3).max(40), country: z.string().min(2).max(60), city: z.string().max(80).optional(), contact: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(10).max(100).regex(/[A-Z]/, "Debe tener una mayúscula").regex(/[0-9]/, "Debe tener un número"), acceptTerms: z.literal(true) });
publicRouter.post("/register", ah(async (req, res) => {
  const i = parse(regSchema, req.body);
  if (await prisma.user.findUnique({ where: { email: i.email.toLowerCase() } })) throw unprocessable("Ya existe una cuenta con ese correo");
  const role = await prisma.role.findUniqueOrThrow({ where: { code: "COMPRADOR" } });
  const out = await inTx(async (tx) => {
    const cust = await tx.customer.create({ data: { code: await nextCode(tx, "CLI-WEB", null, 4), type: "INTERNACIONAL", documentType: "TAX_ID", documentNumber: i.taxId, name: i.company, contact: i.contact, email: i.email.toLowerCase(), country: i.country, city: i.city, chainActor: "importer", isDemo: true } });
    const user = await tx.user.create({ data: { email: i.email.toLowerCase(), name: `${i.company} · ${i.contact}`, passwordHash: await bcrypt.hash(i.password, 12), roleId: role.id, customerId: cust.id } });
    await audit(tx, user.id, "REGISTRO_COMPRADOR", "customer", cust.id, { country: i.country }, req.ip);
    return { customer: cust.code };
  });
  res.status(201).json({ ok: true, ...out, message: "Cuenta creada. Ya puede ingresar al portal del comprador." });
}));

const hits = new Map<string, { n: number; t: number }>();
publicRouter.post("/assistant", ah(async (req, res) => {
  const key = req.ip ?? "x", now = Date.now(), h = hits.get(key);
  if (h && now - h.t < 60000 && h.n >= 12) throw new AppError(429, "Demasiadas consultas; espere un minuto", "RATE_LIMIT");
  hits.set(key, h && now - h.t < 60000 ? { n: h.n + 1, t: h.t } : { n: 1, t: now });
  const i = parse(z.object({ question: z.string().min(2).max(1000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).optional() }), req.body);
  res.json(await ask(req, { ...i, portal: true }));
}));

// ------------------------------------------------------------------ portal (sesión de comprador o broker)
portalRouter.use(requirePerm("portal.access"));
portalRouter.get("/me", ah(async (req, res) => {
  const cust = await prisma.customer.findUniqueOrThrow({ where: { id: myCustomer(req) } });
  const ships = await prisma.exportShipment.findMany({ where: { customerId: cust.id }, orderBy: { id: "desc" }, include: { agreement: { select: { code: true, status: true } } } });
  const p = await T.params();
  res.json({ customer: { code: cust.code, name: cust.name, country: cust.country, city: cust.city, fsvp: cust.fsvpContact, importerNumber: cust.importerNumber }, readOnly: req.user!.role === "BROKER", orders: ships.map((s) => ({ ...T.sanitizeForRole(s, false), customs: T.customsLight(s, p) })), catalog: await catalog() });
}));
portalRouter.post("/quote", ah(async (req, res) => {
  const i = parse(z.object({ pallets: z.coerce.number().int().min(1).max(20), incoterm: z.enum(["FCA", "FOB"]).default("FCA") }), req.body);
  const q = await T.quote(prisma, i);
  res.json({ pallets: q.pallets, cases: q.cases, jars: q.jars, netKg: q.netKg, grossKg: q.grossKg, unitPriceUsd: q.unitPriceUsd, amountUsd: q.amountUsd, incoterm: q.incoterm, incotermVersion: q.incotermVersion, hsCode: q.hsCode, htsCode: q.htsCode });
}));
const buyerOnly = (req: Request) => { if (req.user!.role === "BROKER") throw forbidden("El broker tiene acceso de consulta; el pedido lo realiza el importador"); };
portalRouter.post("/orders", ah(async (req, res) => {
  buyerOnly(req);
  const i = parse(z.object({ pallets: z.coerce.number().int().min(1).max(20), incoterm: z.enum(["FCA", "FOB"]).default("FCA"), deliveryDate: z.coerce.date(), notes: z.string().max(500).optional(), broker: z.string().max(120).optional() }), req.body);
  if (i.deliveryDate.getTime() < Date.now() + 7 * 86400000) throw unprocessable("La fecha de entrega debe ser al menos 7 días posterior a hoy");
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
  const s = await inTx((tx) => T.createShipment(tx, { customerId: myCustomer(req), pallets: i.pallets, incoterm: i.incoterm, deliveryDate: i.deliveryDate, notes: i.notes, broker: i.broker ?? null, source: "PORTAL", status: "PEDIDO" }, admin.id));
  await audit(prisma, req.user!.id, "PEDIDO_PORTAL", "embarque", s.id, { code: s.code });
  A.tick().catch(() => {});
  res.status(201).json(s);
}));
portalRouter.post("/orders/:code/accept-quote", ah(async (req, res) => {
  buyerOnly(req);
  const s = await myShipment(req, req.params.code);
  if (s.status !== "COTIZACION") throw unprocessable("El pedido no es una cotización");
  const blockers = await T.complianceBlockers(prisma, s.deliveryDate);
  if (blockers.length) throw unprocessable(`R7 — no se puede confirmar ahora: ${blockers.map((b) => b.name).join("; ")}`);
  const out = await prisma.exportShipment.update({ where: { id: s.id }, data: { status: "PEDIDO" } });
  await T.event(prisma, s.id, "PEDIDO", "El comprador aceptó la cotización desde el portal", "info");
  A.tick().catch(() => {});
  res.json(out);
}));
portalRouter.get("/orders/:code", ah(async (req, res) => {
  const base = await myShipment(req, req.params.code);
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: base.id }, include: { palletsList: { select: { sscc: true, cases: true, jars: true, netKg: true, grossKg: true, status: true, bestBy: true } }, payments: { orderBy: { id: "desc" } }, claims: { orderBy: { id: "desc" } }, events: { orderBy: { id: "desc" }, take: 60 }, agreement: true, lot: { select: { code: true, qualityStatus: true, certHash: true } }, compliance: { select: { name: true, status: true, authority: true } } } });
  const p = await T.params();
  const onchain = s.agreement ? await chain.readAgreement(s.agreement.code).catch(() => null) : null;
  const milestones = s.lot ? await chain.readMilestones(s.lot.code).catch(() => []) : [];
  const txs = s.agreement ? await prisma.blockchainTransaction.findMany({ where: { entityCode: s.agreement.code }, orderBy: { id: "asc" }, select: { functionName: true, actor: true, status: true, txHash: true, blockNumber: true, createdAt: true, errorMessage: true } }) : [];
  const { marginPct, marginApproved, marginApprovedBy, ...safe } = s as any;
  res.json({ ...safe, customs: T.customsLight(s, p), onchain, milestones, txs, docs: PORTAL_DOCS.map((d) => ({ type: d, name: DOC_TYPES[d] })), traceUrl: s.lot ? traceUrl(s.lot.code) : null, accounts: await accounts(), providers: providers() });
}));
portalRouter.get("/orders/:code/docs/:type.pdf", ah(async (req, res) => {
  const s = await myShipment(req, req.params.code);
  if (!PORTAL_DOCS.includes(req.params.type)) throw forbidden("Documento interno no disponible en el portal");
  await shipmentPdf(res, s.id, req.params.type, { hideCosts: true });
}));
portalRouter.post("/orders/:code/pay", ah(async (req, res) => {
  buyerOnly(req);
  const s = await myShipment(req, req.params.code);
  const i = parse(z.object({ method: z.enum(["TARJETA", "YAPE", "TRANSFERENCIA", "PRUEBA"]), provider: z.enum(["STRIPE", "MERCADOPAGO"]).optional(), amountUsd: z.coerce.number().positive().optional() }), req.body);
  const out = await startPayment(req, s.id, i);
  await audit(prisma, req.user!.id, "INICIAR_PAGO", "pago", (out as any).id, { method: i.method, ship: s.code });
  res.json(out);
}));
portalRouter.post("/payments/:code/refresh", ah(async (req, res) => {
  const pay = await prisma.payment.findUnique({ where: { code: req.params.code }, include: { shipment: true } });
  if (!pay || pay.shipment.customerId !== myCustomer(req)) throw notFound();
  res.json(await refreshPayment(pay.id));
}));
portalRouter.post("/payments/:code/voucher", ah(async (req, res) => {
  buyerOnly(req);
  const pay = await prisma.payment.findUnique({ where: { code: req.params.code }, include: { shipment: true } });
  if (!pay || pay.shipment.customerId !== myCustomer(req)) throw notFound();
  const i = parse(z.object({ operationNumber: z.string().min(4).max(40), voucherName: z.string().max(120).optional(), voucherBase64: z.string().max(8_000_000).optional() }), req.body);
  const out = await submitManual(pay.id, i);
  await T.event(prisma, pay.shipmentId, "PAGO", `Constancia ${pay.provider} enviada (operación ${i.operationNumber}); pendiente de verificación por Finanzas`, "info");
  res.json(out);
}));
portalRouter.post("/orders/:code/confirm-delivery", ah(async (req, res) => {
  buyerOnly(req);
  const s = await myShipment(req, req.params.code);
  if (s.status !== "ENTREGADO") throw unprocessable("Solo se confirma la recepción de un pedido entregado");
  const r = await A.confirmByBuyer(s.id, `comprador desde el portal (${req.user!.email})`);
  if (!r.ok) throw unprocessable(r.errorMessage ?? "El contrato rechazó la confirmación");
  await audit(prisma, req.user!.id, "CONFIRMAR_RECEPCION", "embarque", s.id, { tx: r.tx.txHash });
  A.advance(s.id).catch(() => {});
  res.json({ ok: true, tx: r.tx });
}));
portalRouter.post("/orders/:code/dispute", ah(async (req, res) => {
  buyerOnly(req);
  const s = await myShipment(req, req.params.code);
  const { reason } = parse(z.object({ reason: z.string().min(5).max(500) }), req.body);
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
  const r = await A.sendAg(s.id, "openDispute", [A.agreementCode(s.code), hashObject({ reason })], "importer", admin.id, `Disputa abierta por el comprador: ${reason}`);
  if (!r.ok) throw unprocessable(r.errorMessage ?? "No se pudo abrir la disputa");
  await prisma.exportShipment.update({ where: { id: s.id }, data: { autopilot: false } });
  res.json({ ok: true, tx: r.tx });
}));
portalRouter.post("/orders/:code/claims", ah(async (req, res) => {
  buyerOnly(req);
  const s = await myShipment(req, req.params.code);
  const i = parse(z.object({ type: z.enum(["CALIDAD", "ROTURA", "FALTANTE", "ETIQUETADO", "RETRASO", "OTRO"]), description: z.string().min(5).max(1000), jars: z.coerce.number().int().min(0).max(100000).default(0) }), req.body);
  const lot = s.lotId ? await prisma.lot.findUnique({ where: { id: s.lotId } }) : null;
  const c = await inTx(async (tx) => tx.claim.create({ data: { code: await nextCode(tx, "RMA", new Date().getFullYear(), 3), shipmentId: s.id, customerId: s.customerId, lotCode: lot?.code ?? null, type: i.type, description: i.description, jars: i.jars, source: "PORTAL" } }));
  await T.event(prisma, s.id, "RECLAMO", `Reclamo ${c.code} (${i.type.toLowerCase()}) registrado desde el portal — logística inversa`, "warning");
  res.status(201).json(c);
}));
portalRouter.post("/samples", ah(async (req, res) => {
  buyerOnly(req);
  const i = parse(z.object({ address: z.string().min(5).max(300), notes: z.string().max(300).optional() }), req.body);
  const cust = await prisma.customer.findUniqueOrThrow({ where: { id: myCustomer(req) } });
  await audit(prisma, req.user!.id, "SOLICITUD_MUESTRA", "customer", cust.id, i);
  await prisma.automationEvent.create({ data: { rule: "MUESTRA", message: `Solicitud de muestras de ${cust.name}: caja de 6 frascos → ${i.address}`, level: "info" } });
  res.json({ ok: true, message: "Solicitud registrada. El Departamento de Exportaciones coordinará el envío de la caja de muestras (6 frascos) y el COA." });
}));
portalRouter.post("/assistant", ah(async (req, res) => {
  const i = parse(z.object({ question: z.string().min(2).max(2000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).optional() }), req.body);
  res.json(await ask(req, { ...i, portal: true }));
}));
export { D };
