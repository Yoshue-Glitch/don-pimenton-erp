import { Router } from "express";
import { z } from "zod";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import { applyMovement, warehouseByCode } from "./inventory.service";

export const agricultureRouter = Router();

const parcelSchema = z.object({
  code: z.string().min(2).max(20).optional(),
  name: z.string().min(2).max(100),
  location: z.string().min(2).max(200),
  areaHa: z.coerce.number().positive().max(10000),
  cropType: z.string().min(2).max(60),
  responsibleId: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(["ACTIVA", "EN_DESCANSO", "EN_PREPARACION", "INACTIVA"]).default("ACTIVA"),
});
agricultureRouter.use("/parcels", crud({
  model: "parcel", entity: "parcela", readPerm: "agri.read", writePerm: "agri.write", schema: parcelSchema,
  search: ["code", "name", "location", "cropType"], filters: ["status"], orderBy: { code: "asc" },
  include: { responsible: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { campaigns: true } } },
  codePrefix: { field: "code", prefix: "PAR", year: false, pad: 3 },
}));

const campaignSchema = z.object({
  code: z.string().min(2).max(30).optional(),
  parcelId: z.coerce.number().int().positive(),
  variety: z.string().min(2).max(80),
  sowingDate: z.coerce.date(),
  estHarvestDate: z.coerce.date(),
  estimatedYieldKg: z.coerce.number().positive(),
  status: z.enum(["PLANIFICADA", "EN_CURSO", "COSECHADA", "CERRADA"]).default("EN_CURSO"),
  notes: z.string().max(500).optional().nullable(),
}).refine((c) => c.estHarvestDate > c.sowingDate, { message: "La cosecha estimada debe ser posterior a la siembra", path: ["estHarvestDate"] });

async function campaignCosts(tx: Tx | typeof prisma, campaignId: number) {
  const [act, fin] = await Promise.all([
    tx.agriActivity.aggregate({ where: { campaignId }, _sum: { cost: true } }),
    tx.financialTransaction.aggregate({ where: { campaignId, type: "EGRESO", referenceType: { not: "AGRI_ACTIVITY" } }, _sum: { amountPen: true } }),
  ]);
  return { activities: D(act._sum.cost), other: D(fin._sum.amountPen), total: D(act._sum.cost).plus(D(fin._sum.amountPen)) };
}

agricultureRouter.get("/campaigns", requirePerm("agri.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (q) where.OR = [{ code: { contains: q, mode: "insensitive" } }, { variety: { contains: q, mode: "insensitive" } }];
  if (req.query.status) where.status = req.query.status;
  const [items, total] = await Promise.all([
    prisma.campaign.findMany({ where, skip, take, orderBy: { sowingDate: "desc" }, include: { parcel: { select: { code: true, name: true } }, _count: { select: { harvests: true, activities: true } } } }),
    prisma.campaign.count({ where }),
  ]);
  const withCosts = await Promise.all(items.map(async (c) => ({ ...c, costs: await campaignCosts(prisma, c.id) })));
  res.json({ items: withCosts, total, page, pageSize });
}));

agricultureRouter.post("/campaigns", requirePerm("agri.write"), ah(async (req, res) => {
  const data = parse(campaignSchema, req.body);
  const c = await inTx(async (tx) => {
    const parcel = await tx.parcel.findUnique({ where: { id: data.parcelId } });
    if (!parcel) throw unprocessable("La parcela no existe");
    if (parcel.status === "INACTIVA") throw unprocessable("No se puede iniciar una campaña en una parcela inactiva");
    const code = data.code || (await nextCode(tx, "CAM", data.sowingDate.getFullYear(), 3));
    const created = await tx.campaign.create({ data: { ...data, code } });
    await audit(tx, req.user!.id, "CREAR", "campaña", created.id, { code }, req.ip);
    return created;
  });
  res.status(201).json(c);
}));

agricultureRouter.put("/campaigns/:id", requirePerm("agri.write"), ah(async (req, res) => {
  const id = idParam(req);
  const data = parse(z.object({
    variety: z.string().min(2).max(80), estHarvestDate: z.coerce.date(), estimatedYieldKg: z.coerce.number().positive(),
    status: z.enum(["PLANIFICADA", "EN_CURSO", "COSECHADA", "CERRADA"]), notes: z.string().max(500).nullable(),
  }).partial(), req.body);
  const c = await prisma.campaign.update({ where: { id }, data });
  await audit(prisma, req.user!.id, "ACTUALIZAR", "campaña", id, data, req.ip);
  res.json(c);
}));

/** Historial completo de la campaña: actividades, cosechas, lotes generados, costos y rendimiento. */
agricultureRouter.get("/campaigns/:id", requirePerm("agri.read"), ah(async (req, res) => {
  const id = idParam(req);
  const c = await prisma.campaign.findUnique({
    where: { id },
    include: {
      parcel: true,
      activities: { orderBy: { date: "asc" }, include: { product: { select: { code: true, name: true, unit: true } } } },
      harvests: { orderBy: { date: "asc" }, include: { lot: { select: { id: true, code: true, status: true, quantityKg: true, consumedKg: true } } } },
      lots: { select: { id: true, code: true, type: true, quantityKg: true, qualityStatus: true, status: true } },
    },
  });
  if (!c) throw notFound();
  const costs = await campaignCosts(prisma, id);
  const harvested = c.harvests.reduce((s, h) => s.plus(h.quantityKg), D(0));
  res.json({
    ...c, costs,
    kpis: {
      harvestedKg: harvested,
      yieldVsEstimatePct: D(c.estimatedYieldKg).gt(0) ? harvested.div(c.estimatedYieldKg).times(100).toDecimalPlaces(2) : null,
      yieldKgPerHa: D(c.parcel.areaHa).gt(0) ? harvested.div(c.parcel.areaHa).toDecimalPlaces(2) : null,
      costPerKg: harvested.gt(0) ? costs.total.div(harvested).toDecimalPlaces(4) : null,
    },
  });
}));

const activitySchema = z.object({
  type: z.enum(["SIEMBRA", "RIEGO", "FERTILIZACION", "CONTROL_PLAGAS", "MANTENIMIENTO", "COSECHA", "OTRO"]),
  date: z.coerce.date(),
  description: z.string().min(3).max(500),
  responsible: z.string().min(2).max(100),
  productId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().positive().nullable().optional(),
  cost: z.coerce.number().min(0).default(0),
  consumeStock: z.boolean().optional().default(false),
});

agricultureRouter.post("/campaigns/:id/activities", requirePerm("agri.write"), ah(async (req, res) => {
  const campaignId = idParam(req);
  const { consumeStock, ...data } = parse(activitySchema, req.body);
  const act = await inTx(async (tx) => {
    const camp = await tx.campaign.findUnique({ where: { id: campaignId } });
    if (!camp) throw notFound("Campaña no encontrada");
    if (camp.status === "CERRADA") throw unprocessable("La campaña está cerrada");
    const a = await tx.agriActivity.create({ data: { ...data, campaignId } });
    if (consumeStock && data.productId && data.quantity) {
      const wh = await warehouseByCode(tx, "ALM-INS");
      await applyMovement(tx, {
        type: "SALIDA", from: "availableKg", productId: data.productId, warehouseId: wh.id, quantityKg: data.quantity,
        reason: `Consumo de insumo en campaña ${camp.code}: ${data.description}`, referenceType: "AGRI_ACTIVITY", referenceCode: `${camp.code}#${a.id}`, userId: req.user!.id,
      });
    }
    if (data.cost > 0) {
      await tx.financialTransaction.create({
        data: {
          code: await nextCode(tx, "FIN", data.date.getFullYear(), 5), type: "EGRESO", category: "COSTO_AGRICOLA", date: data.date,
          description: `${data.type} — ${camp.code}: ${data.description}`, amount: data.cost, amountPen: data.cost, campaignId,
          referenceType: "AGRI_ACTIVITY", referenceCode: `${camp.code}#${a.id}`, userId: req.user!.id,
        },
      });
    }
    await audit(tx, req.user!.id, "CREAR", "actividad_agricola", a.id, { campaign: camp.code, type: data.type }, req.ip);
    return a;
  });
  res.status(201).json(act);
}));

agricultureRouter.get("/activities", requirePerm("agri.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const where: any = {};
  if (req.query.type) where.type = req.query.type;
  if (req.query.campaignId) where.campaignId = Number(req.query.campaignId);
  const [items, total] = await Promise.all([
    prisma.agriActivity.findMany({ where, skip, take, orderBy: { date: "desc" }, include: { campaign: { select: { code: true } }, product: { select: { name: true, unit: true } } } }),
    prisma.agriActivity.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

const harvestSchema = z.object({
  date: z.coerce.date(),
  quantityKg: z.coerce.number().positive().max(1_000_000),
  notes: z.string().max(500).optional().nullable(),
  lotCode: z.string().regex(/^MP-\d{4}-\d{3,}$/).optional(), // solo para la demostración
});

/** Registra una cosecha y genera automáticamente el lote de materia prima (MP-AAAA-NNN). */
export async function registerHarvest(tx: Tx, campaignId: number, input: z.infer<typeof harvestSchema>, userId: number, ip?: string) {
  const camp = await tx.campaign.findUnique({ where: { id: campaignId } });
  if (!camp) throw notFound("Campaña no encontrada");
  if (camp.status === "CERRADA") throw unprocessable("La campaña está cerrada");
  if (input.date < camp.sowingDate) throw unprocessable("La fecha de cosecha no puede ser anterior a la siembra");
  const rawProduct = await tx.product.findUnique({ where: { code: "MP-PIM-FRESCO" } });
  if (!rawProduct) throw unprocessable("No existe el producto materia prima MP-PIM-FRESCO");
  const year = input.date.getFullYear();
  const harvest = await tx.harvest.create({ data: { code: await nextCode(tx, "COS", year, 3), campaignId, date: input.date, quantityKg: input.quantityKg, notes: input.notes } });
  const lotCode = input.lotCode || (await nextCode(tx, "MP", year, 3));
  const costs = await campaignCosts(tx, campaignId);
  const prevHarvested = await tx.harvest.aggregate({ where: { campaignId }, _sum: { quantityKg: true } });
  const unitCost = D(prevHarvested._sum.quantityKg).gt(0) ? costs.total.div(D(prevHarvested._sum.quantityKg)) : D(0);
  const lot = await tx.lot.create({
    data: {
      code: lotCode, type: "MATERIA_PRIMA", productId: rawProduct.id, campaignId, harvestId: harvest.id,
      quantityKg: input.quantityKg, productionDate: input.date, status: "REGISTRADO", qualityStatus: "PENDIENTE", unitCost: unitCost.toDecimalPlaces(4),
    },
  });
  const wh = await warehouseByCode(tx, "ALM-MP");
  await applyMovement(tx, {
    type: "ENTRADA", productId: rawProduct.id, warehouseId: wh.id, lotId: lot.id, quantityKg: input.quantityKg, unitCost: lot.unitCost,
    reason: `Cosecha ${harvest.code} de la campaña ${camp.code}`, referenceType: "HARVEST", referenceCode: harvest.code, userId, at: input.date,
  });
  const total = D(prevHarvested._sum.quantityKg);
  await tx.campaign.update({ where: { id: campaignId }, data: { actualYieldKg: total, actualHarvestDate: input.date, status: "COSECHADA" } });
  await audit(tx, userId, "REGISTRAR_COSECHA", "cosecha", harvest.id, { campaign: camp.code, kg: input.quantityKg, lot: lot.code }, ip);
  return { harvest, lot };
}

agricultureRouter.post("/campaigns/:id/harvests", requirePerm("agri.write"), ah(async (req, res) => {
  const input = parse(harvestSchema, req.body);
  const out = await inTx((tx) => registerHarvest(tx, idParam(req), input, req.user!.id, req.ip));
  res.status(201).json(out);
}));

export async function sendHarvestToProcessing(tx: Tx, harvestId: number, userId: number) {
  const h = await tx.harvest.findUnique({ where: { id: harvestId }, include: { lot: true } });
  if (!h || !h.lot) throw notFound("Cosecha no encontrada");
  if (h.sentToProcessing) return h; // idempotente
  const updated = await tx.harvest.update({ where: { id: harvestId }, data: { sentToProcessing: true } });
  await audit(tx, userId, "ENVIAR_A_PROCESAMIENTO", "cosecha", harvestId, { lot: h.lot.code });
  return updated;
}

agricultureRouter.post("/harvests/:id/send-to-processing", requirePerm("agri.write"), ah(async (req, res) => {
  res.json(await inTx((tx) => sendHarvestToProcessing(tx, idParam(req), req.user!.id)));
}));

agricultureRouter.get("/harvests", requirePerm("agri.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const [items, total] = await Promise.all([
    prisma.harvest.findMany({ skip, take, orderBy: { date: "desc" }, include: { campaign: { select: { code: true, variety: true } }, lot: { select: { id: true, code: true, status: true } } } }),
    prisma.harvest.count(),
  ]);
  res.json({ items, total, page, pageSize });
}));

