import { Router } from "express";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { forbidden, notFound, unprocessable } from "../lib/errors";
import { D, round2 } from "../lib/decimal";
import { getSetting } from "../lib/settings";
import { applyMovement } from "./inventory.service";

export const purchasingRouter = Router();

purchasingRouter.use("/suppliers", crud({
  model: "supplier", entity: "proveedor", readPerm: "purchases.read", writePerm: "purchases.write",
  schema: z.object({
    ruc: z.string().regex(/^(10|20)\d{9}$/, "RUC inválido (11 dígitos)"),
    name: z.string().min(2).max(150), contact: z.string().max(100).nullable().optional(),
    email: z.string().email().nullable().optional().or(z.literal("")), phone: z.string().max(30).nullable().optional(),
    address: z.string().max(200).nullable().optional(), category: z.string().min(2).max(60), active: z.boolean().default(true),
  }),
  search: ["ruc", "name", "category"], filters: ["active", "category"], orderBy: { name: "asc" },
}));

const include = {
  requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, area: { select: { name: true } },
  items: { include: { product: { select: { code: true, name: true, unit: true } } } },
  quotes: { include: { supplier: { select: { name: true } } } }, orders: { select: { code: true, status: true } },
};

purchasingRouter.get("/requests", requirePerm("purchases.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  const [items, total] = await Promise.all([prisma.purchaseRequest.findMany({ where, skip, take, orderBy: { date: "desc" }, include }), prisma.purchaseRequest.count({ where })]);
  res.json({ items: items.map((r) => ({ ...r, estimatedTotal: r.items.reduce((s, i) => s.plus(D(i.quantity).times(i.estimatedPrice)), D(0)) })), total, page, pageSize });
}));

purchasingRouter.get("/requests/:id", requirePerm("purchases.read"), ah(async (req, res) => {
  const r = await prisma.purchaseRequest.findUnique({ where: { id: idParam(req) }, include });
  if (!r) throw notFound();
  res.json(r);
}));

purchasingRouter.post("/requests", requirePerm("purchases.write"), ah(async (req, res) => {
  const input = parse(z.object({
    areaId: z.coerce.number().int().positive().nullable().optional(),
    justification: z.string().min(5).max(500),
    items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive(), estimatedPrice: z.coerce.number().min(0) })).min(1),
  }), req.body);
  const r = await inTx(async (tx) => {
    const created = await tx.purchaseRequest.create({
      data: { code: await nextCode(tx, "SOL", new Date().getFullYear(), 4), requestedById: req.user!.id, areaId: input.areaId, date: new Date(), justification: input.justification, status: "BORRADOR", items: { create: input.items } },
    });
    await audit(tx, req.user!.id, "CREAR", "solicitud_compra", created.id, { code: created.code });
    return created;
  });
  res.status(201).json(r);
}));

purchasingRouter.post("/requests/:id/submit", requirePerm("purchases.write"), ah(async (req, res) => {
  const id = idParam(req);
  const r = await prisma.purchaseRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (r.status !== "BORRADOR") throw unprocessable("Solo se envían a revisión solicitudes en borrador");
  await audit(prisma, req.user!.id, "ENVIAR_REVISION", "solicitud_compra", id, {});
  res.json(await prisma.purchaseRequest.update({ where: { id }, data: { status: "EN_REVISION" } }));
}));

purchasingRouter.post("/requests/:id/quotes", requirePerm("purchases.write"), ah(async (req, res) => {
  const requestId = idParam(req);
  const input = parse(z.object({
    supplierId: z.coerce.number().int().positive(), currency: z.enum(["PEN", "USD"]).default("PEN"), total: z.coerce.number().positive(),
    deliveryDays: z.coerce.number().int().min(0).max(365), paymentTerms: z.string().max(100).optional(), notes: z.string().max(300).optional(),
  }), req.body);
  const q = await inTx(async (tx) => {
    const r = await tx.purchaseRequest.findUnique({ where: { id: requestId } });
    if (!r) throw notFound();
    if (!["BORRADOR", "EN_REVISION", "APROBADA"].includes(r.status)) throw unprocessable("La solicitud no admite cotizaciones");
    return tx.supplierQuote.create({ data: { ...input, requestId, date: new Date(), code: await nextCode(tx, "CTP", new Date().getFullYear(), 4) } });
  });
  res.status(201).json(q);
}));

/** Comparación de ofertas: precio en PEN, plazo y puntaje simple (60% precio, 40% plazo). */
purchasingRouter.get("/requests/:id/comparison", requirePerm("purchases.read"), ah(async (req, res) => {
  const quotes = await prisma.supplierQuote.findMany({ where: { requestId: idParam(req) }, include: { supplier: { select: { name: true } } } });
  const fx = await getSetting<number>("fx.defaultUsdPen");
  const rows = quotes.map((q) => ({ ...q, totalPen: Number(q.total) * (q.currency === "USD" ? fx : 1) }));
  const minP = Math.min(...rows.map((r) => r.totalPen)), minD = Math.min(...rows.map((r) => r.deliveryDays));
  res.json(rows.map((r) => ({ ...r, score: Math.round((0.6 * (minP / r.totalPen) + 0.4 * ((minD + 1) / (r.deliveryDays + 1))) * 100) })).sort((a, b) => b.score - a.score));
}));

/** Aprobación de Gerencia: requiere permiso purchases.approve y que el aprobador no sea el solicitante. */
purchasingRouter.post("/requests/:id/decision", requirePerm("purchases.approve"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ approve: z.boolean(), note: z.string().max(300).optional() }), req.body);
  const out = await inTx(async (tx) => {
    const r = await tx.purchaseRequest.findUnique({ where: { id } });
    if (!r) throw notFound();
    if (r.status !== "EN_REVISION") throw unprocessable("La solicitud debe estar EN_REVISION");
    if (r.requestedById === req.user!.id) throw forbidden("Segregación de funciones: no puede aprobar su propia solicitud");
    await audit(tx, req.user!.id, input.approve ? "APROBAR" : "RECHAZAR", "solicitud_compra", id, { note: input.note });
    return tx.purchaseRequest.update({ where: { id }, data: { status: input.approve ? "APROBADA" : "RECHAZADA", approvedById: req.user!.id, decidedAt: new Date(), decisionNote: input.note } });
  });
  res.json(out);
}));

purchasingRouter.get("/orders", requirePerm("purchases.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, skip, take, orderBy: { date: "desc" }, include: { supplier: { select: { name: true } }, request: { select: { code: true } }, items: { include: { product: { select: { name: true, unit: true } } } }, receipts: true, payables: true } }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

/** Genera la orden de compra desde una solicitud APROBADA y la cotización seleccionada. */
purchasingRouter.post("/orders", requirePerm("purchases.write"), ah(async (req, res) => {
  const input = parse(z.object({
    requestId: z.coerce.number().int().positive(), quoteId: z.coerce.number().int().positive(),
    items: z.array(z.object({ productId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive(), unitPrice: z.coerce.number().positive() })).min(1),
    taxRate: z.coerce.number().min(0).max(1).default(0.18), exchangeRate: z.coerce.number().positive().optional(),
  }), req.body);
  const out = await inTx(async (tx) => {
    const r = await tx.purchaseRequest.findUnique({ where: { id: input.requestId } });
    if (!r) throw notFound("Solicitud no encontrada");
    if (r.status !== "APROBADA") throw unprocessable("Solo se emiten órdenes de compra para solicitudes APROBADAS por Gerencia");
    const q = await tx.supplierQuote.findUnique({ where: { id: input.quoteId } });
    if (!q || q.requestId !== r.id) throw unprocessable("La cotización no pertenece a la solicitud");
    const subtotal = round2(input.items.reduce((s, i) => s.plus(D(i.quantity).times(i.unitPrice)), D(0)));
    const tax = round2(subtotal.times(input.taxRate));
    const fx = q.currency === "USD" ? input.exchangeRate ?? (await getSetting<number>("fx.defaultUsdPen")) : 1;
    await tx.supplierQuote.update({ where: { id: q.id }, data: { selected: true } });
    const po = await tx.purchaseOrder.create({
      data: { code: await nextCode(tx, "OC", new Date().getFullYear(), 4), requestId: r.id, supplierId: q.supplierId, quoteId: q.id, date: new Date(), currency: q.currency, exchangeRate: fx, subtotal, tax, total: subtotal.plus(tax), items: { create: input.items } },
    });
    await tx.purchaseRequest.update({ where: { id: r.id }, data: { status: "ORDENADA" } });
    await audit(tx, req.user!.id, "CREAR", "orden_compra", po.id, { code: po.code, total: po.total.toString() });
    return po;
  });
  res.status(201).json(out);
}));

purchasingRouter.post("/orders/:id/receive", requirePerm("purchases.receive"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({
    warehouseId: z.coerce.number().int().positive(), receivedBy: z.string().min(3).max(100), notes: z.string().max(300).optional(),
    items: z.array(z.object({ orderItemId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive() })).min(1),
  }), req.body);
  const out = await inTx(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
    if (!po) throw notFound();
    if (!["EMITIDA", "RECIBIDA_PARCIAL"].includes(po.status)) throw unprocessable("La orden no admite recepciones");
    const code = await nextCode(tx, "REC", new Date().getFullYear(), 4);
    for (const ri of input.items) {
      const it = po.items.find((i) => i.id === ri.orderItemId);
      if (!it) throw unprocessable("Ítem no pertenece a la orden");
      if (D(it.receivedQty).plus(ri.quantity).gt(it.quantity)) throw unprocessable(`Se excede lo ordenado de ${it.product.name}`);
      await tx.purchaseOrderItem.update({ where: { id: it.id }, data: { receivedQty: D(it.receivedQty).plus(ri.quantity) } });
      await applyMovement(tx, { type: "ENTRADA", productId: it.productId, warehouseId: input.warehouseId, quantityKg: ri.quantity, unitCost: D(it.unitPrice).times(po.exchangeRate), reason: `Recepción ${code} de la OC ${po.code}`, referenceType: "PURCHASE_ORDER", referenceCode: po.code, userId: req.user!.id });
    }
    const items = await tx.purchaseOrderItem.findMany({ where: { orderId: id } });
    const complete = items.every((i) => D(i.receivedQty).gte(i.quantity));
    await tx.goodsReceipt.create({ data: { code, orderId: id, warehouseId: input.warehouseId, date: new Date(), receivedBy: input.receivedBy, notes: input.notes, items: input.items } });
    await audit(tx, req.user!.id, "RECEPCIONAR", "orden_compra", id, { code });
    return tx.purchaseOrder.update({ where: { id }, data: { status: complete ? "RECIBIDA" : "RECIBIDA_PARCIAL" } });
  });
  res.json(out);
}));

/** Conformidad: habilita la cuenta por pagar. */
purchasingRouter.post("/orders/:id/conformity", requirePerm("purchases.receive"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ documentRef: z.string().min(3).max(60), dueDays: z.coerce.number().int().min(0).max(180).default(30) }), req.body);
  const out = await inTx(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) throw notFound();
    if (po.status !== "RECIBIDA") throw unprocessable("La conformidad requiere la recepción completa");
    const due = new Date(); due.setDate(due.getDate() + input.dueDays);
    await tx.accountPayable.create({ data: { code: await nextCode(tx, "CXP", new Date().getFullYear(), 4), supplierId: po.supplierId, purchaseOrderId: po.id, documentRef: input.documentRef, issueDate: new Date(), dueDate: due, currency: po.currency, exchangeRate: po.exchangeRate, amount: po.total } });
    await audit(tx, req.user!.id, "CONFORMIDAD", "orden_compra", id, input);
    return tx.purchaseOrder.update({ where: { id }, data: { status: "CONFORME", conformityAt: new Date() } });
  });
  res.json(out);
}));

purchasingRouter.get("/payables", requirePerm("purchases.read"), ah(async (_req, res) => {
  res.json(await prisma.accountPayable.findMany({ orderBy: { dueDate: "asc" }, include: { supplier: { select: { name: true } }, purchaseOrder: { select: { code: true } } } }));
}));

purchasingRouter.post("/payables/:id/pay", requirePerm("purchases.pay"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ amount: z.coerce.number().positive(), method: z.string().min(2).max(40), reference: z.string().max(80).optional() }), req.body);
  const out = await inTx(async (tx) => {
    const ap = await tx.accountPayable.findUnique({ where: { id }, include: { purchaseOrder: true } });
    if (!ap) throw notFound();
    const pending = D(ap.amount).minus(ap.paidAmount);
    if (D(input.amount).gt(pending)) throw unprocessable(`El pago excede el saldo (${pending.toFixed(2)})`);
    const paid = D(ap.paidAmount).plus(input.amount);
    const status = paid.gte(ap.amount) ? "PAGADA" : "PARCIAL";
    await tx.accountPayable.update({ where: { id }, data: { paidAmount: paid, status } });
    await tx.financialTransaction.create({
      data: { code: await nextCode(tx, "FIN", new Date().getFullYear(), 5), type: "EGRESO", category: "PAGO_PROVEEDOR", date: new Date(), description: `Pago ${ap.code} (${input.method})`, currency: ap.currency, amount: input.amount, exchangeRate: ap.exchangeRate, amountPen: round2(D(input.amount).times(ap.exchangeRate)), payableId: id, referenceType: "PAGO", referenceCode: input.reference ?? ap.code, userId: req.user!.id },
    });
    if (status === "PAGADA" && ap.purchaseOrderId) await tx.purchaseOrder.update({ where: { id: ap.purchaseOrderId }, data: { status: "PAGADA" } });
    await audit(tx, req.user!.id, "PAGAR", "cuenta_por_pagar", id, input);
    return { status, paid };
  });
  res.json(out);
}));
