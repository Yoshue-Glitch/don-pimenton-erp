import { Router } from "express";
import { z } from "zod";
import { StageType } from "@prisma/client";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { D, round2, round3 } from "../lib/decimal";
import { applyMovement, warehouseByCode } from "./inventory.service";

export const productionRouter = Router();

export const STAGES: StageType[] = [
  "RECEPCION", "SELECCION", "LAVADO_ACONDICIONAMIENTO", "DESHIDRATACION", "MOLIENDA", "CONTROL_CALIDAD", "ENVASADO", "ALMACEN",
];
export const STAGE_LABEL: Record<StageType, string> = {
  RECEPCION: "Recepción de materia prima", SELECCION: "Selección", LAVADO_ACONDICIONAMIENTO: "Lavado y acondicionamiento",
  DESHIDRATACION: "Deshidratación", MOLIENDA: "Molienda", CONTROL_CALIDAD: "Control de calidad en proceso", ENVASADO: "Envasado", ALMACEN: "Almacén",
};

/** Cálculos de rendimiento: Rendimiento (%) = final / inicial × 100; Merma = inicial − final. */
export function computeYield(initialKg: number | string, finalKg: number | string) {
  const i = D(initialKg), f = D(finalKg);
  if (i.lte(0)) throw unprocessable("El peso inicial debe ser mayor a cero");
  if (f.lt(0) || f.gt(i)) throw unprocessable("El peso final debe estar entre 0 y el peso inicial");
  return { wasteKg: round3(i.minus(f)), yieldPct: f.div(i).times(100).toDecimalPlaces(3) };
}

productionRouter.get("/pending-lots", requirePerm("production.read"), ah(async (_req, res) => {
  const lots = await prisma.lot.findMany({
    where: { type: "MATERIA_PRIMA", status: { in: ["REGISTRADO", "EN_PROCESO"] } },
    include: { harvest: { select: { code: true, sentToProcessing: true, date: true } }, campaign: { select: { code: true, variety: true } } },
    orderBy: { productionDate: "desc" },
  });
  res.json(lots.map((l) => ({ ...l, remainingKg: D(l.quantityKg).minus(l.consumedKg) })).filter((l) => l.remainingKg.gt(0)));
}));

productionRouter.get("/orders", requirePerm("production.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  if (q) where.code = { contains: q, mode: "insensitive" };
  const [items, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where, skip, take, orderBy: { startDate: "desc" },
      include: { sourceLot: { select: { code: true } }, responsible: { select: { name: true } }, outputLots: { select: { code: true, quantityKg: true, bags: true, qualityStatus: true } } },
    }),
    prisma.productionOrder.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

productionRouter.get("/orders/:id", requirePerm("production.read"), ah(async (req, res) => {
  const o = await prisma.productionOrder.findUnique({
    where: { id: idParam(req) },
    include: {
      sourceLot: { include: { campaign: { select: { code: true, variety: true } }, harvest: { select: { code: true, date: true } } } },
      responsible: { select: { name: true } },
      stages: { orderBy: { seq: "asc" } },
      outputLots: { include: { inspections: { select: { code: true, status: true } } } },
    },
  });
  if (!o) throw notFound();
  res.json({ ...o, stageLabels: STAGE_LABEL });
}));

const createSchema = z.object({
  sourceLotId: z.coerce.number().int().positive(),
  initialWeightKg: z.coerce.number().positive(),
  startDate: z.coerce.date().optional(),
  observations: z.string().max(1000).optional().nullable(),
  code: z.string().optional(),
});

export async function createProductionOrder(tx: Tx, input: z.infer<typeof createSchema>, userId: number) {
  const lot = await tx.lot.findUnique({ where: { id: input.sourceLotId }, include: { harvest: true } });
  if (!lot || lot.type !== "MATERIA_PRIMA") throw unprocessable("El lote de origen debe ser un lote de materia prima");
  if (lot.harvest && !lot.harvest.sentToProcessing) throw unprocessable(`La cosecha ${lot.harvest.code} aún no fue enviada a procesamiento`);
  const remaining = D(lot.quantityKg).minus(lot.consumedKg);
  if (D(input.initialWeightKg).gt(remaining)) throw unprocessable(`El lote ${lot.code} solo tiene ${remaining.toFixed(3)} kg disponibles para procesar`);
  const start = input.startDate ?? new Date();
  const code = input.code || (await nextCode(tx, "OP", start.getFullYear(), 4));
  const order = await tx.productionOrder.create({
    data: {
      code, sourceLotId: lot.id, responsibleId: userId, startDate: start, initialWeightKg: input.initialWeightKg,
      status: "EN_PROCESO", currentStage: "SELECCION", observations: input.observations,
      rawMaterialCost: round2(D(input.initialWeightKg).times(lot.unitCost)),
      stages: {
        create: STAGES.map((s, i) => ({
          stage: s, seq: i + 1,
          startedAt: i <= 1 ? start : null, completedAt: i === 0 ? start : null,
          inputKg: i === 0 ? input.initialWeightKg : null, outputKg: i === 0 ? input.initialWeightKg : null,
          notes: i === 0 ? `Recepción del lote ${lot.code}` : null,
        })),
      },
    },
  });
  const consumed = D(lot.consumedKg).plus(input.initialWeightKg);
  await tx.lot.update({ where: { id: lot.id }, data: { consumedKg: consumed, status: consumed.gte(lot.quantityKg) ? "CONSUMIDO" : "EN_PROCESO" } });
  const wh = await warehouseByCode(tx, "ALM-MP");
  await applyMovement(tx, {
    type: "CONSUMO_PRODUCCION", productId: lot.productId, warehouseId: wh.id, lotId: lot.id, quantityKg: input.initialWeightKg,
    unitCost: lot.unitCost, reason: `Recepción en planta para la orden ${code}`, referenceType: "PRODUCTION_ORDER", referenceCode: code, userId, at: start,
  });
  await audit(tx, userId, "CREAR", "orden_produccion", order.id, { code, lot: lot.code, kg: input.initialWeightKg });
  return order;
}

productionRouter.post("/orders", requirePerm("production.write"), ah(async (req, res) => {
  const input = parse(createSchema.omit({ code: true }), req.body);
  res.status(201).json(await inTx((tx) => createProductionOrder(tx, input, req.user!.id)));
}));

const stageSchema = z.object({
  outputKg: z.coerce.number().min(0).optional(),
  temperatureC: z.coerce.number().min(0).max(200).optional(),
  durationH: z.coerce.number().min(0).max(500).optional(),
  responsible: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  at: z.coerce.date().optional(),
});

/** Completa la etapa actual (en orden) e inicia la siguiente. */
export async function advanceStage(tx: Tx, orderId: number, input: z.infer<typeof stageSchema>, userId: number) {
  const o = await tx.productionOrder.findUnique({ where: { id: orderId }, include: { stages: { orderBy: { seq: "asc" } } } });
  if (!o) throw notFound();
  if (o.status !== "EN_PROCESO") throw unprocessable("La orden no está en proceso");
  if (o.currentStage === "ALMACEN") throw unprocessable("Use \"Completar orden\" para registrar el producto terminado en almacén");
  const idx = STAGES.indexOf(o.currentStage);
  const cur = o.stages.find((s) => s.stage === o.currentStage)!;
  const prev = o.stages[idx - 1];
  const inputKg = prev?.outputKg ?? o.initialWeightKg;
  if (input.outputKg !== undefined && D(input.outputKg).gt(inputKg)) throw unprocessable("La salida de la etapa no puede superar su entrada");
  if (o.currentStage === "DESHIDRATACION" && (input.temperatureC === undefined || input.durationH === undefined)) {
    throw unprocessable("La deshidratación requiere temperatura (°C) y duración (h)");
  }
  const at = input.at ?? new Date();
  await tx.productionStage.update({
    where: { id: cur.id },
    data: { completedAt: at, startedAt: cur.startedAt ?? at, inputKg, outputKg: input.outputKg ?? inputKg, temperatureC: input.temperatureC, durationH: input.durationH, responsible: input.responsible, notes: input.notes },
  });
  const next = STAGES[idx + 1];
  await tx.productionStage.update({ where: { orderId_stage: { orderId, stage: next } }, data: { startedAt: at } });
  await tx.productionOrder.update({
    where: { id: orderId },
    data: { currentStage: next, ...(o.currentStage === "DESHIDRATACION" ? { dryingTempC: input.temperatureC, dryingHours: input.durationH } : {}) },
  });
  await audit(tx, userId, "AVANZAR_ETAPA", "orden_produccion", orderId, { from: o.currentStage, to: next });
  return tx.productionOrder.findUnique({ where: { id: orderId }, include: { stages: { orderBy: { seq: "asc" } } } });
}

productionRouter.post("/orders/:id/advance", requirePerm("production.write"), ah(async (req, res) => {
  const input = parse(stageSchema, req.body);
  res.json(await inTx((tx) => advanceStage(tx, idParam(req), input, req.user!.id)));
}));

const completeSchema = z.object({
  finalWeightKg: z.coerce.number().positive(),
  outputs: z.array(z.object({ quantityKg: z.coerce.number().positive(), code: z.string().optional() })).min(1).max(20).optional(),
  laborCost: z.coerce.number().min(0).default(0),
  energyCost: z.coerce.number().min(0).default(0),
  packagingCost: z.coerce.number().min(0).default(0),
  otherCost: z.coerce.number().min(0).default(0),
  expiryMonths: z.coerce.number().int().min(1).max(60).default(18),
  observations: z.string().max(1000).optional(),
  at: z.coerce.date().optional(),
});

/** Cierra la orden: calcula merma y rendimiento, crea uno o varios lotes terminados (en cuarentena hasta su liberación por Calidad). */
export async function completeOrder(tx: Tx, orderId: number, input: z.infer<typeof completeSchema>, userId: number) {
  const o = await tx.productionOrder.findUnique({ where: { id: orderId }, include: { sourceLot: true, stages: true } });
  if (!o) throw notFound();
  if (o.status !== "EN_PROCESO") throw unprocessable("La orden no está en proceso (¿ya fue completada?)");
  if (o.currentStage !== "ALMACEN") throw unprocessable(`Faltan etapas por completar. Etapa actual: ${STAGE_LABEL[o.currentStage]}`);
  const { wasteKg, yieldPct } = computeYield(Number(o.initialWeightKg), input.finalWeightKg);
  const outputs = input.outputs?.length ? input.outputs : [{ quantityKg: input.finalWeightKg }];
  const sum = outputs.reduce((s, x) => s.plus(x.quantityKg), D(0));
  if (!sum.eq(round3(input.finalWeightKg))) throw unprocessable(`La suma de los lotes terminados (${sum} kg) debe igualar el peso final (${input.finalWeightKg} kg)`);
  const product = await tx.product.findUnique({ where: { code: "PT-PAP-MOL-25" } });
  if (!product) throw unprocessable("No existe el producto terminado PT-PAP-MOL-25");
  const bagKg = Number(product.bagWeightKg ?? 25);
  const totalCost = round2(D(o.rawMaterialCost).plus(input.laborCost).plus(input.energyCost).plus(input.packagingCost).plus(input.otherCost));
  const unitCost = totalCost.div(input.finalWeightKg).toDecimalPlaces(4);
  const at = input.at ?? new Date();
  const wh = await warehouseByCode(tx, "ALM-PT");
  const expiry = new Date(at); expiry.setMonth(expiry.getMonth() + input.expiryMonths);

  const lots = [];
  for (const out of outputs) {
    const code = out.code || (await nextCode(tx, "DP", at.getFullYear(), 3));
    const bags = Number.isInteger(out.quantityKg / bagKg) ? out.quantityKg / bagKg : null;
    const lot = await tx.lot.create({
      data: {
        code, type: "PRODUCTO_TERMINADO", productId: product.id, campaignId: o.sourceLot.campaignId, parentLotId: o.sourceLotId,
        productionOrderId: o.id, quantityKg: out.quantityKg, bags, productionDate: at, expiryDate: expiry,
        status: "EN_ALMACEN", qualityStatus: "PENDIENTE", unitCost,
      },
    });
    await applyMovement(tx, {
      type: "INGRESO_CUARENTENA", productId: product.id, warehouseId: wh.id, lotId: lot.id, quantityKg: out.quantityKg, unitCost, bagWeightKg: bagKg,
      reason: `Producto terminado de la orden ${o.code} — pendiente de liberación por Calidad`, referenceType: "PRODUCTION_ORDER", referenceCode: o.code, userId, at,
    });
    lots.push(lot);
  }
  const almacen = o.stages.find((s) => s.stage === "ALMACEN")!;
  await tx.productionStage.update({ where: { id: almacen.id }, data: { completedAt: at, inputKg: input.finalWeightKg, outputKg: input.finalWeightKg, notes: `Lotes: ${lots.map((l) => l.code).join(", ")}` } });
  const updated = await tx.productionOrder.update({
    where: { id: orderId },
    data: {
      status: "COMPLETADA", endDate: at, finalWeightKg: input.finalWeightKg, wasteKg, yieldPct,
      laborCost: input.laborCost, energyCost: input.energyCost, packagingCost: input.packagingCost, otherCost: input.otherCost, totalCost,
      observations: input.observations ?? o.observations,
    },
  });
  for (const [cat, amount] of [["MANO_OBRA", input.laborCost], ["ENERGIA", input.energyCost], ["ENVASES", input.packagingCost], ["OTROS", input.otherCost]] as const) {
    if (amount > 0) {
      await tx.financialTransaction.create({
        data: {
          code: await nextCode(tx, "FIN", at.getFullYear(), 5), type: "EGRESO", category: `COSTO_PRODUCCION_${cat}`, date: at,
          description: `Costo de producción (${cat.toLowerCase().replace("_", " ")}) — ${o.code}`, amount, amountPen: amount,
          productionOrderId: o.id, lotId: lots[0].id, referenceType: "PRODUCTION_ORDER", referenceCode: o.code, userId,
        },
      });
    }
  }
  await audit(tx, userId, "COMPLETAR", "orden_produccion", orderId, { finalKg: input.finalWeightKg, yieldPct: yieldPct.toString(), lots: lots.map((l) => l.code) });
  return { order: updated, lots };
}

productionRouter.post("/orders/:id/complete", requirePerm("production.write"), ah(async (req, res) => {
  const input = parse(completeSchema, req.body);
  if (input.outputs) input.outputs = input.outputs.map(({ quantityKg }) => ({ quantityKg })); // los códigos los asigna el sistema
  res.json(await inTx((tx) => completeOrder(tx, idParam(req), input, req.user!.id)));
}));

productionRouter.post("/orders/:id/cancel", requirePerm("production.write"), ah(async (req, res) => {
  const id = idParam(req);
  const out = await inTx(async (tx) => {
    const o = await tx.productionOrder.findUnique({ where: { id }, include: { sourceLot: true } });
    if (!o) throw notFound();
    if (o.status !== "EN_PROCESO" && o.status !== "PLANIFICADA") throw unprocessable("Solo se pueden anular órdenes en proceso");
    // la materia prima ya procesada no regresa al almacén: se registra como merma total
    await audit(tx, req.user!.id, "ANULAR", "orden_produccion", id, { motivo: req.body?.reason });
    return tx.productionOrder.update({ where: { id }, data: { status: "ANULADA", endDate: new Date(), observations: `${o.observations ?? ""}\nANULADA: ${req.body?.reason ?? ""}`.trim() } });
  });
  res.json(out);
}));
