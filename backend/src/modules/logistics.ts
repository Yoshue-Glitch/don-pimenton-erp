import { Router } from "express";
import { z } from "zod";
import { DispatchStatus } from "@prisma/client";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import { getSetting } from "../lib/settings";
import { applyMovement, warehouseByCode } from "./inventory.service";
import { issueInternalDocument } from "./sales";

export const logisticsRouter = Router();

logisticsRouter.use("/carriers", crud({
  model: "carrier", entity: "transportista", readPerm: "logistics.read", writePerm: "logistics.write",
  schema: z.object({ ruc: z.string().regex(/^(10|20)\d{9}$/, "RUC inválido"), name: z.string().min(2).max(120), phone: z.string().max(30).nullable().optional(), active: z.boolean().default(true) }),
  search: ["ruc", "name"], orderBy: { name: "asc" }, include: { vehicles: true },
}));

logisticsRouter.use("/vehicles", crud({
  model: "vehicle", entity: "vehiculo", readPerm: "logistics.read", writePerm: "logistics.write",
  schema: z.object({ plate: z.string().min(5).max(10), carrierId: z.coerce.number().int().positive(), type: z.string().min(2).max(40), capacityKg: z.coerce.number().positive() }),
  search: ["plate", "type"], filters: ["carrierId"], orderBy: { plate: "asc" }, include: { carrier: { select: { name: true } } },
}));

const FLOW: DispatchStatus[] = ["PREPARACION", "DESPACHADO", "EN_TRANSITO", "ENTREGADO", "CONFORME"];

logisticsRouter.get("/dispatches", requirePerm("logistics.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  const [items, total] = await Promise.all([
    prisma.dispatchOrder.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { salesOrder: { select: { code: true, customer: { select: { name: true } } } }, carrier: { select: { name: true } }, vehicle: { select: { plate: true } }, evidenceDoc: { select: { code: true, fileName: true } } } }),
    prisma.dispatchOrder.count({ where }),
  ]);
  res.json({ items, total, page, pageSize, policy: await getSetting("inventory.dispatchPolicy") });
}));

const createSchema = z.object({
  salesOrderId: z.coerce.number().int().positive(),
  carrierId: z.coerce.number().int().positive(),
  vehicleId: z.coerce.number().int().positive(),
  destination: z.string().min(3).max(200),
  notes: z.string().max(500).optional(),
});

export async function createDispatch(tx: Tx, input: z.infer<typeof createSchema>, userId: number) {
  const o = await tx.salesOrder.findUnique({ where: { id: input.salesOrderId }, include: { dispatches: true } });
  if (!o) throw notFound("Pedido no encontrado");
  if (o.status !== "RESERVADO") throw unprocessable(`El pedido ${o.code} debe estar RESERVADO para despacharse (estado: ${o.status})`);
  if (o.dispatches.length) throw unprocessable(`El pedido ${o.code} ya tiene la orden de despacho ${o.dispatches[0].code}`);
  const v = await tx.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!v || v.carrierId !== input.carrierId) throw unprocessable("El vehículo no pertenece al transportista");
  if (D(o.totalKg).gt(v.capacityKg)) throw unprocessable(`El peso (${o.totalKg} kg) excede la capacidad del vehículo (${v.capacityKg} kg)`);
  const d = await tx.dispatchOrder.create({ data: { ...input, code: await nextCode(tx, "DES", new Date().getFullYear(), 4), weightKg: o.totalKg } });
  await audit(tx, userId, "CREAR", "despacho", d.id, { code: d.code, order: o.code });
  return d;
}

logisticsRouter.post("/dispatches", requirePerm("logistics.write"), ah(async (req, res) => {
  res.status(201).json(await inTx((tx) => createDispatch(tx, parse(createSchema, req.body), req.user!.id)));
}));

/** Descuenta inventario UNA sola vez (bandera inventoryPosted con actualización condicional). */
async function postInventory(tx: Tx, dispatchId: number, userId: number, at: Date) {
  const claimed = await tx.dispatchOrder.updateMany({ where: { id: dispatchId, inventoryPosted: false }, data: { inventoryPosted: true } });
  if (claimed.count === 0) return false; // ya descontado: no duplicar
  const d = await tx.dispatchOrder.findUniqueOrThrow({ where: { id: dispatchId }, include: { salesOrder: { include: { items: { include: { reservations: { include: { lot: true } } } } } } } });
  for (const it of d.salesOrder.items) {
    for (const r of it.reservations.filter((x) => x.status === "ACTIVA")) {
      await applyMovement(tx, { type: "SALIDA", productId: it.productId, warehouseId: r.warehouseId, lotId: r.lotId, quantityKg: r.quantityKg, bagWeightKg: 25, reason: `Despacho ${d.code} del pedido ${d.salesOrder.code}`, referenceType: "DISPATCH", referenceCode: d.code, userId, at });
      await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: "CONSUMIDA" } });
      const left = await tx.inventoryBalance.aggregate({ where: { lotId: r.lotId }, _sum: { availableKg: true, reservedKg: true, quarantineKg: true } });
      if (Number(left._sum.availableKg ?? 0) + Number(left._sum.reservedKg ?? 0) + Number(left._sum.quarantineKg ?? 0) === 0) await tx.lot.update({ where: { id: r.lotId }, data: { status: "AGOTADO" } });
    }
  }
  return true;
}

const advanceSchema = z.object({
  status: z.enum(["DESPACHADO", "EN_TRANSITO", "ENTREGADO", "CONFORME"]),
  receivedBy: z.string().min(3).max(120).optional(),
  evidenceDocId: z.coerce.number().int().positive().optional(),
  at: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});

export async function advanceDispatch(tx: Tx, dispatchId: number, input: z.infer<typeof advanceSchema>, userId: number) {
  const d = await tx.dispatchOrder.findUnique({ where: { id: dispatchId }, include: { salesOrder: { include: { items: { include: { reservations: { include: { lot: true } } } } } } } });
  if (!d) throw notFound();
  const from = FLOW.indexOf(d.status), to = FLOW.indexOf(input.status);
  if (to !== from + 1) throw unprocessable(`Transición no permitida: ${d.status} → ${input.status}. Secuencia: ${FLOW.join(" → ")}`);
  const at = input.at ?? new Date();
  const policy = await getSetting<string>("inventory.dispatchPolicy");
  const data: any = { status: input.status, notes: input.notes ?? d.notes };

  if (input.status === "DESPACHADO") {
    // Calidad bloquea el despacho de lotes rechazados o en cuarentena
    for (const it of d.salesOrder.items) for (const r of it.reservations.filter((x) => x.status === "ACTIVA")) {
      if (r.lot.qualityStatus !== "APROBADO") throw unprocessable(`Despacho bloqueado: el lote ${r.lot.code} está ${r.lot.qualityStatus}`);
    }
    data.departureAt = at;
    await issueInternalDocument(tx, d.salesOrderId, userId, at);
    await tx.salesOrder.update({ where: { id: d.salesOrderId }, data: { status: "DESPACHADO" } });
  }
  if (input.status === "ENTREGADO") {
    if (!input.receivedBy) throw unprocessable("Indique el responsable de recepción");
    data.deliveredAt = at; data.receivedBy = input.receivedBy;
    const o = await tx.salesOrder.findUniqueOrThrow({ where: { id: d.salesOrderId } });
    await tx.salesOrder.update({ where: { id: o.id }, data: { status: o.paymentStatus === "COBRADO" ? "COMPLETADO" : "ENTREGADO" } });
  }
  if (input.status === "CONFORME") {
    const docId = input.evidenceDocId ?? d.evidenceDocId;
    if (!docId) throw unprocessable("La conformidad requiere adjuntar la evidencia (acta / guía firmada)");
    data.evidenceDocId = docId;
  }
  await tx.dispatchOrder.update({ where: { id: dispatchId }, data });
  if ((input.status === "DESPACHADO" && policy === "ON_DISPATCH") || (input.status === "ENTREGADO" && policy !== "ON_DISPATCH")) {
    await postInventory(tx, dispatchId, userId, at);
  }
  await audit(tx, userId, `DESPACHO_${input.status}`, "despacho", dispatchId, { code: d.code });
  return tx.dispatchOrder.findUnique({ where: { id: dispatchId } });
}

logisticsRouter.post("/dispatches/:id/advance", requirePerm("logistics.write"), ah(async (req, res) => {
  res.json(await inTx((tx) => advanceDispatch(tx, idParam(req), parse(advanceSchema, req.body), req.user!.id)));
}));

/** Devolución: el producto regresa a CUARENTENA para su reevaluación por Calidad. */
logisticsRouter.post("/dispatches/:id/return", requirePerm("logistics.write"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ lotId: z.coerce.number().int().positive(), quantityKg: z.coerce.number().positive(), reason: z.string().min(5).max(300) }), req.body);
  const out = await inTx(async (tx) => {
    const d = await tx.dispatchOrder.findUnique({ where: { id }, include: { salesOrder: { include: { items: { include: { reservations: true } } } } } });
    if (!d) throw notFound();
    if (!d.inventoryPosted) throw unprocessable("El despacho aún no descontó inventario");
    const dispatched = d.salesOrder.items.flatMap((i) => i.reservations).filter((r) => r.lotId === input.lotId && r.status === "CONSUMIDA").reduce((s, r) => s.plus(r.quantityKg), D(0));
    const prev = await tx.inventoryMovement.aggregate({ where: { type: "DEVOLUCION", referenceCode: d.code, lotId: input.lotId }, _sum: { quantityKg: true } });
    if (D(input.quantityKg).plus(D(prev._sum.quantityKg)).gt(dispatched)) throw unprocessable("La devolución excede lo despachado de ese lote");
    const lot = await tx.lot.findUniqueOrThrow({ where: { id: input.lotId } });
    const wh = await warehouseByCode(tx, "ALM-PT");
    const m = await applyMovement(tx, { type: "DEVOLUCION", productId: lot.productId, warehouseId: wh.id, lotId: lot.id, quantityKg: input.quantityKg, bagWeightKg: 25, reason: `Devolución: ${input.reason}`, referenceType: "DISPATCH", referenceCode: d.code, userId: req.user!.id });
    await audit(tx, req.user!.id, "DEVOLUCION", "despacho", id, input);
    return m;
  });
  res.status(201).json(out);
}));
