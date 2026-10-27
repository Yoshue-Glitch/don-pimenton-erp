import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { D, round2, round3 } from "../lib/decimal";
import { getSetting } from "../lib/settings";
import { applyMovement, warehouseByCode } from "./inventory.service";

export const salesRouter = Router();

salesRouter.use("/customers", crud({
  model: "customer", entity: "cliente", readPerm: "sales.read", writePerm: "sales.write",
  schema: z.object({
    code: z.string().max(20).optional(),
    type: z.enum(["NACIONAL", "INTERNACIONAL"]).default("NACIONAL"),
    documentType: z.enum(["RUC", "DNI", "TAX_ID"]),
    documentNumber: z.string().min(5).max(20),
    name: z.string().min(2).max(150),
    contact: z.string().max(100).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal("")),
    phone: z.string().max(30).nullable().optional(),
    address: z.string().max(200).nullable().optional(),
    city: z.string().max(80).nullable().optional(),
    country: z.string().max(60).default("Perú"),
    creditDays: z.coerce.number().int().min(0).max(180).default(0),
    active: z.boolean().default(true),
  }).refine((c) => c.documentType !== "RUC" || /^(10|20)\d{9}$/.test(c.documentNumber), { message: "RUC inválido (11 dígitos, inicia en 10 o 20)", path: ["documentNumber"] }),
  search: ["code", "name", "documentNumber", "city"], filters: ["type", "active"], orderBy: { name: "asc" },
  codePrefix: { field: "code", prefix: "CLI", year: false, pad: 4 },
}));

export const lineSchema = z.object({
  productId: z.coerce.number().int().positive(),
  lotId: z.coerce.number().int().positive().nullable().optional(),
  unit: z.enum(["KG", "SACO"]),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().positive(),
  discountPct: z.coerce.number().min(0).max(100).default(0),
});
type Line = z.infer<typeof lineSchema>;

/** Cálculo de importes: subtotal (base imponible), descuentos, impuesto configurado y total. */
export function computeTotals(lines: (Line & { bagWeightKg: number })[], taxRate: number, priceIncludesTax: boolean) {
  let net = D(0), discount = D(0), kg = D(0);
  const out = lines.map((l) => {
    if (l.unit === "SACO" && !Number.isInteger(l.quantity)) throw unprocessable("La venta por saco requiere un número entero de sacos");
    const quantityKg = round3(l.unit === "SACO" ? D(l.quantity).times(l.bagWeightKg) : D(l.quantity));
    const gross = D(l.quantity).times(l.unitPrice);
    const disc = gross.times(l.discountPct).div(100);
    const lineTotal = round2(gross.minus(disc));
    net = net.plus(lineTotal); discount = discount.plus(disc); kg = kg.plus(quantityKg);
    return { ...l, quantityKg, lineTotal };
  });
  const rate = D(taxRate);
  let subtotal: Prisma.Decimal, tax: Prisma.Decimal, total: Prisma.Decimal;
  if (priceIncludesTax) { total = round2(net); subtotal = round2(net.div(rate.plus(1))); tax = round2(total.minus(subtotal)); }
  else { subtotal = round2(net); tax = round2(net.times(rate)); total = round2(subtotal.plus(tax)); }
  return { lines: out, subtotal, discountTotal: round2(discount), taxTotal: tax, total, totalKg: kg };
}

async function resolveTax(code?: string) {
  const rates = await getSetting<{ code: string; rate: number }[]>("tax.rates");
  const def = await getSetting<string>("tax.defaultCode");
  const r = rates.find((x) => x.code === (code || def));
  if (!r) throw unprocessable(`Impuesto ${code} no configurado`);
  return r.rate;
}

async function withBagWeights(tx: Tx | typeof prisma, lines: Line[]) {
  const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  return lines.map((l) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p) throw unprocessable(`Producto ${l.productId} no existe`);
    if (l.unit === "SACO" && !p.bagWeightKg) throw unprocessable(`${p.name} no se vende por saco`);
    return { ...l, bagWeightKg: Number(p.bagWeightKg ?? 0) };
  });
}

// ---------------------------------------------------------------- cotizaciones
const quoteSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  validUntil: z.coerce.date(),
  currency: z.enum(["PEN", "USD"]).default("PEN"),
  taxCode: z.string().optional(),
  priceIncludesTax: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(lineSchema).min(1),
});

salesRouter.get("/quotes", requirePerm("sales.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const [items, total] = await Promise.all([
    prisma.salesQuote.findMany({ skip, take, orderBy: { date: "desc" }, include: { customer: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } } }),
    prisma.salesQuote.count(),
  ]);
  res.json({ items, total, page, pageSize });
}));

salesRouter.post("/quotes", requirePerm("sales.write"), ah(async (req, res) => {
  const input = parse(quoteSchema, req.body);
  const rate = await resolveTax(input.taxCode);
  const q = await inTx(async (tx) => {
    const t = computeTotals(await withBagWeights(tx, input.items), rate, input.priceIncludesTax);
    const created = await tx.salesQuote.create({
      data: {
        code: await nextCode(tx, "COT", new Date().getFullYear(), 4), customerId: input.customerId, date: new Date(), validUntil: input.validUntil,
        currency: input.currency, priceIncludesTax: input.priceIncludesTax, taxRate: rate, subtotal: t.subtotal, discount: t.discountTotal, tax: t.taxTotal, total: t.total,
        notes: input.notes, status: "ENVIADA",
        items: { create: t.lines.map((l) => ({ productId: l.productId, unit: l.unit, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct })) },
      },
    });
    await audit(tx, req.user!.id, "CREAR", "cotizacion", created.id, { code: created.code });
    return created;
  });
  res.status(201).json(q);
}));

salesRouter.post("/quotes/:id/status", requirePerm("sales.write"), ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["ACEPTADA", "RECHAZADA"]) }), req.body);
  res.json(await prisma.salesQuote.update({ where: { id: idParam(req) }, data: { status } }));
}));

// ---------------------------------------------------------------- pedidos
const orderSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  quoteId: z.coerce.number().int().positive().nullable().optional(),
  date: z.coerce.date().optional(),
  currency: z.enum(["PEN", "USD"]).default("PEN"),
  exchangeRate: z.coerce.number().positive().optional(),
  taxCode: z.string().optional(),
  priceIncludesTax: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
  items: z.array(lineSchema).min(1).max(30),
  code: z.string().optional(),
});

/** Reserva stock aprobado (FEFO) para cada línea. Solo lotes APROBADOS con stock disponible. */
async function reserveLine(tx: Tx, item: { id: number; productId: number; lotId: number | null; quantityKg: Prisma.Decimal }, orderCode: string, userId: number, at = new Date()) {
  const wh = await warehouseByCode(tx, "ALM-PT");
  let pending = D(item.quantityKg);
  const candidates = await tx.inventoryBalance.findMany({
    where: { productId: item.productId, warehouseId: wh.id, availableKg: { gt: 0 }, ...(item.lotId ? { lotId: item.lotId } : {}), lot: { qualityStatus: "APROBADO" } },
    include: { lot: true }, orderBy: [{ lot: { expiryDate: "asc" } }, { id: "asc" }],
  });
  if (item.lotId) {
    const lot = await tx.lot.findUnique({ where: { id: item.lotId } });
    if (!lot) throw unprocessable("Lote no encontrado");
    if (lot.qualityStatus !== "APROBADO") throw unprocessable(`El lote ${lot.code} está ${lot.qualityStatus}: no puede reservarse ni despacharse`);
  }
  for (const b of candidates) {
    if (pending.lte(0)) break;
    const take = D(b.availableKg).lt(pending) ? D(b.availableKg) : pending;
    await applyMovement(tx, { type: "RESERVA", productId: item.productId, warehouseId: wh.id, lotId: b.lotId, quantityKg: take, bagWeightKg: 25, reason: `Reserva para el pedido ${orderCode}`, referenceType: "SALES_ORDER", referenceCode: orderCode, userId, at });
    await tx.inventoryReservation.create({ data: { orderItemId: item.id, lotId: b.lotId!, warehouseId: wh.id, quantityKg: take } });
    pending = pending.minus(take);
  }
  if (pending.gt(0)) throw unprocessable(`Stock aprobado insuficiente: faltan ${pending.toFixed(3)} kg para el pedido ${orderCode}`);
}

export async function createSalesOrder(tx: Tx, input: z.infer<typeof orderSchema>, userId: number) {
  const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
  if (!customer || !customer.active) throw unprocessable("Cliente inexistente o inactivo");
  const rate = await resolveTax(input.taxCode);
  const fx = input.currency === "USD" ? input.exchangeRate ?? (await getSetting<number>("fx.defaultUsdPen")) : 1;
  const t = computeTotals(await withBagWeights(tx, input.items), rate, input.priceIncludesTax);
  const date = input.date ?? new Date();
  const code = input.code || (await nextCode(tx, "PED", date.getFullYear(), 4));
  const order = await tx.salesOrder.create({
    data: {
      code, customerId: input.customerId, quoteId: input.quoteId, date, currency: input.currency, exchangeRate: fx,
      priceIncludesTax: input.priceIncludesTax, taxRate: rate, subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total, totalKg: t.totalKg,
      notes: input.notes, status: "REGISTRADO",
      items: { create: t.lines.map((l) => ({ productId: l.productId, lotId: l.lotId ?? null, unit: l.unit, quantity: l.quantity, quantityKg: l.quantityKg, unitPrice: l.unitPrice, discountPct: l.discountPct, lineTotal: l.lineTotal })) },
    },
    include: { items: true },
  });
  for (const it of order.items) await reserveLine(tx, it, code, userId, date);
  if (input.quoteId) await tx.salesQuote.update({ where: { id: input.quoteId }, data: { status: "CONVERTIDA" } });
  const updated = await tx.salesOrder.update({ where: { id: order.id }, data: { status: "RESERVADO" } });
  await audit(tx, userId, "CREAR", "pedido", order.id, { code, total: t.total.toString(), kg: t.totalKg.toString() });
  return updated;
}

salesRouter.get("/orders", requirePerm("sales.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.customerId) where.customerId = Number(req.query.customerId);
  if (q) where.OR = [{ code: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }];
  const [items, total] = await Promise.all([
    prisma.salesOrder.findMany({ where, skip, take, orderBy: { date: "desc" }, include: { customer: { select: { name: true } }, items: { include: { product: { select: { name: true } }, lot: { select: { code: true } } } }, agreements: { select: { code: true, status: true } } } }),
    prisma.salesOrder.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

salesRouter.get("/orders/:id", requirePerm("sales.read"), ah(async (req, res) => {
  const o = await prisma.salesOrder.findUnique({
    where: { id: idParam(req) },
    include: {
      customer: true, items: { include: { product: true, lot: { select: { code: true, qualityStatus: true } }, reservations: { include: { lot: { select: { code: true } } } } } },
      dispatches: { include: { carrier: true, vehicle: true } }, documents: true, receivables: { include: { transactions: true } }, agreements: true,
    },
  });
  if (!o) throw notFound();
  res.json(o);
}));

salesRouter.post("/orders", requirePerm("sales.write"), ah(async (req, res) => {
  const input = parse(orderSchema.omit({ code: true }), req.body);
  res.status(201).json(await inTx((tx) => createSalesOrder(tx, input, req.user!.id)));
}));

salesRouter.post("/orders/:id/cancel", requirePerm("sales.write"), ah(async (req, res) => {
  const id = idParam(req);
  const out = await inTx(async (tx) => {
    const o = await tx.salesOrder.findUnique({ where: { id }, include: { items: { include: { reservations: true } }, dispatches: true } });
    if (!o) throw notFound();
    if (o.dispatches.some((d) => d.inventoryPosted)) throw unprocessable("El pedido ya fue despachado; registre una devolución");
    if (o.status === "ANULADO") return o;
    for (const it of o.items) for (const r of it.reservations.filter((x) => x.status === "ACTIVA")) {
      await applyMovement(tx, { type: "LIBERACION_RESERVA", productId: it.productId, warehouseId: r.warehouseId, lotId: r.lotId, quantityKg: r.quantityKg, bagWeightKg: 25, reason: `Anulación del pedido ${o.code}`, referenceType: "SALES_ORDER", referenceCode: o.code, userId: req.user!.id });
      await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: "LIBERADA" } });
    }
    await audit(tx, req.user!.id, "ANULAR", "pedido", id, { reason: req.body?.reason });
    return tx.salesOrder.update({ where: { id }, data: { status: "ANULADO" } });
  });
  res.json(out);
}));

/** Emite el comprobante INTERNO de demostración y la cuenta por cobrar (idempotente). */
export async function issueInternalDocument(tx: Tx, orderId: number, userId: number, at = new Date()) {
  const o = await tx.salesOrder.findUnique({ where: { id: orderId }, include: { documents: true, customer: true } });
  if (!o) throw notFound();
  if (o.status === "ANULADO") throw unprocessable("Pedido anulado");
  if (o.documents.length) return o.documents[0];
  const doc = await tx.salesDocument.create({ data: { code: await nextCode(tx, "CI", at.getFullYear(), 5), orderId, issueDate: at, total: o.total, currency: o.currency } });
  const due = new Date(at); due.setDate(due.getDate() + (o.customer.creditDays || 0));
  await tx.accountReceivable.create({
    data: { code: await nextCode(tx, "CXC", at.getFullYear(), 4), customerId: o.customerId, salesOrderId: o.id, documentRef: doc.code, issueDate: at, dueDate: due, currency: o.currency, exchangeRate: o.exchangeRate, amount: o.total },
  });
  await audit(tx, userId, "EMITIR_COMPROBANTE_INTERNO", "pedido", orderId, { doc: doc.code });
  return doc;
}

salesRouter.post("/orders/:id/document", requirePerm("sales.write"), ah(async (req, res) => {
  res.json(await inTx((tx) => issueInternalDocument(tx, idParam(req), req.user!.id)));
}));

salesRouter.get("/receivables", requirePerm("sales.read"), ah(async (req, res) => {
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  res.json(await prisma.accountReceivable.findMany({ where, orderBy: { issueDate: "desc" }, take: 200, include: { customer: { select: { name: true } }, salesOrder: { select: { code: true } }, exportOrder: { select: { code: true } } } }));
}));

const collectSchema = z.object({
  amount: z.coerce.number().positive(),
  date: z.coerce.date().optional(),
  method: z.string().min(2).max(40),
  reference: z.string().max(100).optional(),
  simulated: z.boolean().default(false),
});

/** Registra un cobro, actualiza la cuenta por cobrar y el estado del pedido. */
export async function collectReceivable(tx: Tx, receivableId: number, input: z.infer<typeof collectSchema>, userId: number) {
  const ar = await tx.accountReceivable.findUnique({ where: { id: receivableId } });
  if (!ar) throw notFound("Cuenta por cobrar no encontrada");
  const pending = D(ar.amount).minus(ar.collected);
  if (D(input.amount).gt(pending)) throw unprocessable(`El cobro (${input.amount}) excede el saldo pendiente (${pending.toFixed(2)})`);
  const date = input.date ?? new Date();
  const collected = D(ar.collected).plus(input.amount);
  const status = collected.gte(ar.amount) ? "COBRADO" : "PARCIAL";
  await tx.accountReceivable.update({ where: { id: ar.id }, data: { collected, status } });
  const ft = await tx.financialTransaction.create({
    data: {
      code: await nextCode(tx, "FIN", date.getFullYear(), 5), type: "INGRESO", category: "COBRO_CLIENTE", date,
      description: `Cobro ${ar.documentRef} (${input.method}${input.reference ? " " + input.reference : ""})${input.simulated ? " — SIMULADO con fondos de prueba de red local" : ""}`,
      currency: ar.currency, amount: input.amount, exchangeRate: ar.exchangeRate, amountPen: round2(D(input.amount).times(ar.exchangeRate)),
      receivableId: ar.id, referenceType: input.simulated ? "SMART_CONTRACT" : "COBRO", referenceCode: input.reference ?? ar.code, simulated: input.simulated, userId,
    },
  });
  if (ar.salesOrderId) {
    const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: ar.salesOrderId } });
    await tx.salesOrder.update({ where: { id: o.id }, data: { paymentStatus: status, ...(status === "COBRADO" && o.status === "ENTREGADO" ? { status: "COMPLETADO" } : {}) } });
  }
  if (ar.exportOrderId) {
    const e = await tx.exportOrder.findUniqueOrThrow({ where: { id: ar.exportOrderId } });
    await tx.exportOrder.update({ where: { id: e.id }, data: { collectedAmount: D(e.collectedAmount).plus(input.amount), ...(status === "COBRADO" ? { status: "COBRADA" } : {}) } });
  }
  await audit(tx, userId, "REGISTRAR_COBRO", "cuenta_por_cobrar", ar.id, { amount: input.amount, simulated: input.simulated });
  return ft;
}

salesRouter.post("/receivables/:id/collect", requirePerm("sales.write"), ah(async (req, res) => {
  const input = parse(collectSchema.omit({ simulated: true }), req.body);
  res.status(201).json(await inTx((tx) => collectReceivable(tx, idParam(req), { ...input, simulated: false }, req.user!.id)));
}));

salesRouter.get("/customers/:id/history", requirePerm("sales.read"), ah(async (req, res) => {
  const id = idParam(req);
  const [customer, orders, receivables] = await Promise.all([
    prisma.customer.findUnique({ where: { id } }),
    prisma.salesOrder.findMany({ where: { customerId: id }, orderBy: { date: "desc" }, select: { code: true, date: true, total: true, totalKg: true, status: true, paymentStatus: true, currency: true } }),
    prisma.accountReceivable.findMany({ where: { customerId: id }, select: { code: true, amount: true, collected: true, status: true, dueDate: true } }),
  ]);
  if (!customer) throw notFound();
  const totalSold = orders.filter((o) => o.status !== "ANULADO").reduce((s, o) => s.plus(o.total), D(0));
  res.json({ customer, orders, receivables, kpis: { orders: orders.length, totalSold, pending: receivables.reduce((s, r) => s.plus(D(r.amount).minus(r.collected)), D(0)) } });
}));
