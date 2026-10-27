import { Router } from "express";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { forbidden, notFound, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import { applyMovement, MOVEMENT_LABEL } from "./inventory.service";

export const inventoryRouter = Router();

inventoryRouter.use("/products", crud({
  model: "product", entity: "producto", readPerm: "inventory.read", writePerm: "inventory.write",
  schema: z.object({
    code: z.string().min(2).max(30),
    name: z.string().min(2).max(120),
    type: z.enum(["MATERIA_PRIMA", "PRODUCTO_TERMINADO", "INSUMO", "EMPAQUE"]),
    unit: z.enum(["KG", "UND", "L"]),
    bagWeightKg: z.coerce.number().positive().nullable().optional(),
    minStock: z.coerce.number().min(0).default(0),
    standardCost: z.coerce.number().min(0).default(0),
    salePricePerKg: z.coerce.number().min(0).nullable().optional(),
    active: z.boolean().default(true),
  }),
  search: ["code", "name"], filters: ["type", "active"], orderBy: { code: "asc" },
}));

inventoryRouter.use("/warehouses", crud({
  model: "warehouse", entity: "almacen", readPerm: "inventory.read", writePerm: "inventory.write",
  schema: z.object({ code: z.string().min(2).max(20), name: z.string().min(2).max(100), address: z.string().max(200).nullable().optional(), active: z.boolean().default(true) }),
  search: ["code", "name"], orderBy: { code: "asc" }, include: { locations: true },
}));

inventoryRouter.post("/warehouses/:id/locations", requirePerm("inventory.write"), ah(async (req, res) => {
  const data = parse(z.object({ code: z.string().min(1).max(20), name: z.string().min(2).max(100) }), req.body);
  res.status(201).json(await prisma.warehouseLocation.create({ data: { ...data, warehouseId: idParam(req) } }));
}));

/** Stock por producto/almacén/lote con disponible, reservado y en cuarentena (+ equivalencia en sacos). */
inventoryRouter.get("/balances", requirePerm("inventory.read"), ah(async (req, res) => {
  const where: any = { OR: [{ availableKg: { gt: 0 } }, { reservedKg: { gt: 0 } }, { quarantineKg: { gt: 0 } }] };
  if (req.query.productId) where.productId = Number(req.query.productId);
  if (req.query.warehouseId) where.warehouseId = Number(req.query.warehouseId);
  if (req.query.type) where.product = { type: req.query.type };
  const rows = await prisma.inventoryBalance.findMany({
    where, orderBy: [{ productId: "asc" }, { lotId: "asc" }],
    include: { product: { select: { code: true, name: true, type: true, unit: true, bagWeightKg: true, minStock: true } }, warehouse: { select: { code: true, name: true } }, lot: { select: { code: true, qualityStatus: true, status: true, expiryDate: true } } },
  });
  res.json(rows.map((r) => {
    const bag = r.product.bagWeightKg ? Number(r.product.bagWeightKg) : null;
    return { ...r, totalKg: D(r.availableKg).plus(r.reservedKg).plus(r.quarantineKg), bags: bag ? { available: Number(r.availableKg) / bag, reserved: Number(r.reservedKg) / bag, quarantine: Number(r.quarantineKg) / bag } : null };
  }));
}));

inventoryRouter.get("/summary", requirePerm("inventory.read"), ah(async (_req, res) => {
  const products = await prisma.product.findMany({ where: { active: true }, include: { balances: true }, orderBy: { code: "asc" } });
  res.json(products.map((p) => {
    const s = p.balances.reduce((a, b) => ({ available: a.available.plus(b.availableKg), reserved: a.reserved.plus(b.reservedKg), quarantine: a.quarantine.plus(b.quarantineKg) }), { available: D(0), reserved: D(0), quarantine: D(0) });
    return { id: p.id, code: p.code, name: p.name, type: p.type, unit: p.unit, bagWeightKg: p.bagWeightKg, minStock: p.minStock, ...s, belowMin: s.available.lt(p.minStock) && D(p.minStock).gt(0) };
  }));
}));

/** Kardex: movimientos con saldo físico posterior; filtrable por producto, almacén, lote y fechas. */
inventoryRouter.get("/movements", requirePerm("inventory.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  for (const f of ["productId", "warehouseId", "lotId"]) if (req.query[f]) where[f] = Number(req.query[f]);
  if (req.query.type) where.type = req.query.type;
  if (req.query.from || req.query.to) where.createdAt = { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}) };
  if (q) where.OR = [{ code: { contains: q, mode: "insensitive" } }, { referenceCode: { contains: q, mode: "insensitive" } }, { reason: { contains: q, mode: "insensitive" } }];
  const [items, total] = await Promise.all([
    prisma.inventoryMovement.findMany({ where, skip, take, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { product: { select: { code: true, name: true } }, warehouse: { select: { code: true } }, lot: { select: { code: true } }, user: { select: { name: true } } } }),
    prisma.inventoryMovement.count({ where }),
  ]);
  res.json({ items: items.map((m) => ({ ...m, typeLabel: MOVEMENT_LABEL[m.type] })), total, page, pageSize });
}));

inventoryRouter.get("/lots", requirePerm("inventory.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.type) where.type = req.query.type;
  if (req.query.qualityStatus) where.qualityStatus = req.query.qualityStatus;
  if (q) where.code = { contains: q, mode: "insensitive" };
  const [items, total] = await Promise.all([
    prisma.lot.findMany({ where, skip, take, orderBy: { createdAt: "desc" }, include: { product: { select: { code: true, name: true } }, parentLot: { select: { code: true } }, productionOrder: { select: { code: true } }, balances: true } }),
    prisma.lot.count({ where }),
  ]);
  res.json({
    items: items.map(({ balances, ...l }) => ({ ...l, stock: balances.reduce((a, b) => ({ available: a.available + Number(b.availableKg), reserved: a.reserved + Number(b.reservedKg), quarantine: a.quarantine + Number(b.quarantineKg) }), { available: 0, reserved: 0, quarantine: 0 }) })),
    total, page, pageSize,
  });
}));

/** Trazabilidad completa de un lote (hacia atrás y hacia adelante). */
export async function lotTraceability(code: string) {
  const lot = await prisma.lot.findUnique({
    where: { code },
    include: {
      product: true, campaign: { include: { parcel: true, activities: { orderBy: { date: "asc" } } } }, harvest: true,
      parentLot: { include: { harvest: true } }, childLots: { select: { code: true, quantityKg: true, bags: true, qualityStatus: true } },
      productionOrder: { include: { stages: { orderBy: { seq: "asc" } }, responsible: { select: { name: true } } } },
      inspections: { include: { inspector: { select: { name: true } }, decidedBy: { select: { name: true } }, coaDocument: { select: { code: true, fileName: true, sha256: true } } }, orderBy: { date: "asc" } },
      movements: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { warehouse: { select: { code: true } }, user: { select: { name: true } } } },
      salesOrderItems: { include: { order: { include: { customer: { select: { name: true } }, dispatches: true } } } },
      agreements: true, balances: true,
    },
  });
  if (!lot) throw notFound(`Lote ${code} no encontrado`);
  const chainTxs = await prisma.blockchainTransaction.findMany({ where: { OR: [{ entityCode: code }, ...lot.agreements.map((a) => ({ entityCode: a.code }))] }, orderBy: { id: "asc" } });
  return { ...lot, chainTxs };
}

inventoryRouter.get("/lots/:code/trace", requirePerm("inventory.read"), ah(async (req, res) => {
  res.json(await lotTraceability(req.params.code));
}));

const moveSchema = z.object({
  type: z.enum(["ENTRADA", "SALIDA"]),
  productId: z.coerce.number().int().positive(),
  warehouseId: z.coerce.number().int().positive(),
  lotId: z.coerce.number().int().positive().nullable().optional(),
  quantityKg: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0).optional(),
  reason: z.string().min(3).max(300),
  referenceCode: z.string().min(1).max(60),
});

/** Entradas/salidas manuales de insumos y empaques (el producto terminado solo sale vía despacho). */
inventoryRouter.post("/movements", requirePerm("inventory.write"), ah(async (req, res) => {
  const input = parse(moveSchema, req.body);
  const out = await inTx(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: input.productId } });
    if (!p) throw notFound("Producto no encontrado");
    if (p.type === "PRODUCTO_TERMINADO" || p.type === "MATERIA_PRIMA") throw unprocessable("La materia prima y el producto terminado se mueven por cosecha, producción, calidad y despachos. Use un ajuste autorizado si necesita corregir.");
    const m = await applyMovement(tx, { ...input, from: "availableKg", referenceType: "MANUAL", userId: req.user!.id });
    await audit(tx, req.user!.id, `MOVIMIENTO_${input.type}`, "inventario", m.id, input);
    return m;
  });
  res.status(201).json(out);
}));

inventoryRouter.post("/transfers", requirePerm("inventory.write"), ah(async (req, res) => {
  const input = parse(z.object({
    productId: z.coerce.number().int().positive(), lotId: z.coerce.number().int().positive().nullable().optional(),
    fromWarehouseId: z.coerce.number().int().positive(), toWarehouseId: z.coerce.number().int().positive(),
    quantityKg: z.coerce.number().positive(), reason: z.string().min(3).max(300),
  }).refine((d) => d.fromWarehouseId !== d.toWarehouseId, { message: "Los almacenes deben ser distintos" }), req.body);
  const out = await inTx(async (tx) => {
    const code = await nextCode(tx, "TRF", new Date().getFullYear(), 4);
    const p = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
    const base = { productId: input.productId, lotId: input.lotId, quantityKg: input.quantityKg, referenceType: "TRANSFER", referenceCode: code, userId: req.user!.id, bagWeightKg: p.bagWeightKg ? Number(p.bagWeightKg) : null };
    const outM = await applyMovement(tx, { ...base, type: "TRANSFERENCIA_SALIDA", warehouseId: input.fromWarehouseId, reason: input.reason });
    const inM = await applyMovement(tx, { ...base, type: "TRANSFERENCIA_ENTRADA", warehouseId: input.toWarehouseId, reason: input.reason });
    await audit(tx, req.user!.id, "TRANSFERENCIA", "inventario", code, input);
    return { code, movements: [outM, inM] };
  });
  res.status(201).json(out);
}));

// ---- Ajustes: solicitud + autorización por un usuario distinto con permiso
inventoryRouter.get("/adjustments", requirePerm("inventory.read"), ah(async (_req, res) => {
  res.json(await prisma.inventoryAdjustment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { code: true, name: true } }, requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } } } }));
}));

inventoryRouter.post("/adjustments", requirePerm("inventory.write"), ah(async (req, res) => {
  const input = parse(z.object({
    productId: z.coerce.number().int().positive(), warehouseId: z.coerce.number().int().positive(), lotId: z.coerce.number().int().positive().nullable().optional(),
    quantityKg: z.coerce.number().refine((v) => v !== 0, "La cantidad no puede ser cero"), reason: z.string().min(5).max(300),
  }), req.body);
  const out = await inTx(async (tx) => {
    const a = await tx.inventoryAdjustment.create({ data: { ...input, code: await nextCode(tx, "AJU", new Date().getFullYear(), 4), requestedById: req.user!.id } });
    await audit(tx, req.user!.id, "SOLICITAR_AJUSTE", "inventario", a.code, input);
    return a;
  });
  res.status(201).json(out);
}));

inventoryRouter.post("/adjustments/:id/decision", requirePerm("inventory.adjust.approve"), ah(async (req, res) => {
  const id = idParam(req);
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const out = await inTx(async (tx) => {
    const a = await tx.inventoryAdjustment.findUnique({ where: { id } });
    if (!a) throw notFound();
    if (a.status !== "PENDIENTE") throw unprocessable("El ajuste ya fue decidido");
    if (a.requestedById === req.user!.id) throw forbidden("Segregación de funciones: no puede autorizar su propio ajuste");
    if (approve) {
      await applyMovement(tx, {
        type: D(a.quantityKg).gt(0) ? "AJUSTE_POSITIVO" : "AJUSTE_NEGATIVO", productId: a.productId, warehouseId: a.warehouseId, lotId: a.lotId,
        quantityKg: D(a.quantityKg).abs(), reason: `Ajuste autorizado: ${a.reason}`, referenceType: "ADJUSTMENT", referenceCode: a.code, userId: req.user!.id,
      });
    }
    await audit(tx, req.user!.id, approve ? "APROBAR_AJUSTE" : "RECHAZAR_AJUSTE", "inventario", a.code, {});
    return tx.inventoryAdjustment.update({ where: { id }, data: { status: approve ? "APROBADO" : "RECHAZADO", approvedById: req.user!.id, decidedAt: new Date() } });
  });
  res.json(out);
}));

inventoryRouter.get("/alerts", requirePerm("inventory.read"), ah(async (_req, res) => {
  res.json(await inventoryAlerts());
}));

export async function inventoryAlerts() {
  const alerts: { level: "warning" | "danger" | "info"; type: string; message: string; ref?: string }[] = [];
  const products = await prisma.product.findMany({ where: { active: true, minStock: { gt: 0 } }, include: { balances: true } });
  for (const p of products) {
    const avail = p.balances.reduce((s, b) => s.plus(b.availableKg), D(0));
    if (avail.lt(p.minStock)) alerts.push({ level: "warning", type: "STOCK_MINIMO", message: `${p.name}: stock disponible ${avail.toFixed(1)} ${p.unit === "KG" ? "kg" : p.unit} por debajo del mínimo (${D(p.minStock).toFixed(0)})`, ref: p.code });
  }
  const soon = new Date(Date.now() + 60 * 86400000);
  const expiring = await prisma.lot.findMany({ where: { expiryDate: { lte: soon }, balances: { some: { OR: [{ availableKg: { gt: 0 } }, { reservedKg: { gt: 0 } }] } } }, select: { code: true, expiryDate: true } });
  for (const l of expiring) alerts.push({ level: l.expiryDate! < new Date() ? "danger" : "warning", type: "VENCIMIENTO", message: `Lote ${l.code} ${l.expiryDate! < new Date() ? "vencido" : "vence"} el ${l.expiryDate!.toISOString().slice(0, 10)}`, ref: l.code });
  const blocked = await prisma.lot.findMany({ where: { qualityStatus: { in: ["RECHAZADO", "CUARENTENA"] }, balances: { some: { quarantineKg: { gt: 0 } } } }, select: { code: true, qualityStatus: true } });
  for (const l of blocked) alerts.push({ level: "danger", type: "LOTE_BLOQUEADO", message: `Lote ${l.code} ${l.qualityStatus === "RECHAZADO" ? "rechazado" : "en cuarentena"}: bloqueado para despacho`, ref: l.code });
  return alerts;
}
