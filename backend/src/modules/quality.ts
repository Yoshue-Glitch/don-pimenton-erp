import { Router } from "express";
import { z } from "zod";
import { QualityStatus } from "@prisma/client";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import { hashObject } from "../lib/hash";
import { applyMovement } from "./inventory.service";

export const qualityRouter = Router();

qualityRouter.use("/specs", crud({
  model: "qualitySpec", entity: "especificacion_calidad", readPerm: "quality.read", writePerm: "quality.specs",
  schema: z.object({
    productId: z.coerce.number().int().positive(),
    customerId: z.coerce.number().int().positive().nullable().optional(),
    parameter: z.enum(["HUMEDAD", "COLOR_ASTA", "GRANULOMETRIA"]),
    minValue: z.coerce.number().nullable().optional(),
    maxValue: z.coerce.number().nullable().optional(),
    unit: z.string().min(1).max(30),
    notes: z.string().max(300).nullable().optional(),
    isDemo: z.boolean().default(true),
  }),
  filters: ["productId", "customerId", "parameter"],
  include: { product: { select: { code: true, name: true } }, customer: { select: { name: true } } },
  orderBy: [{ productId: "asc" }, { parameter: "asc" }],
}));

const FIELD: Record<string, "moisturePct" | "astaColor" | "granulometry"> = { HUMEDAD: "moisturePct", COLOR_ASTA: "astaColor", GRANULOMETRIA: "granulometry" };

/** Evalúa la inspección contra las especificaciones configuradas (las del cliente prevalecen sobre las generales). */
export async function evaluateSpecs(tx: Tx | typeof prisma, productId: number, customerId: number | null, values: Record<string, unknown>) {
  const specs = await tx.qualitySpec.findMany({ where: { productId, OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])] } });
  const chosen = new Map<string, (typeof specs)[number]>();
  for (const s of specs) if (!chosen.has(s.parameter) || s.customerId) chosen.set(s.parameter, s);
  return [...chosen.values()].map((s) => {
    const raw = values[FIELD[s.parameter]];
    const v = raw === null || raw === undefined ? null : Number(raw);
    const okMin = s.minValue === null || (v !== null && v >= Number(s.minValue));
    const okMax = s.maxValue === null || (v !== null && v <= Number(s.maxValue));
    return {
      parameter: s.parameter, value: v, min: s.minValue === null ? null : Number(s.minValue), max: s.maxValue === null ? null : Number(s.maxValue),
      unit: s.unit, source: s.customerId ? "cliente" : "general", isDemo: s.isDemo,
      result: v === null ? "SIN_DATO" : okMin && okMax ? "CUMPLE" : "NO_CUMPLE",
    };
  });
}

qualityRouter.get("/inspections", requirePerm("quality.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  if (q) where.OR = [{ code: { contains: q, mode: "insensitive" } }, { lot: { code: { contains: q, mode: "insensitive" } } }];
  const [items, total] = await Promise.all([
    prisma.qualityInspection.findMany({ where, skip, take, orderBy: { date: "desc" }, include: { lot: { select: { code: true, quantityKg: true, bags: true } }, inspector: { select: { name: true } }, decidedBy: { select: { name: true } }, coaDocument: { select: { id: true, code: true, fileName: true, sha256: true } } } }),
    prisma.qualityInspection.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

qualityRouter.get("/inspections/:id", requirePerm("quality.read"), ah(async (req, res) => {
  const i = await prisma.qualityInspection.findUnique({ where: { id: idParam(req) }, include: { lot: { include: { product: true } }, inspector: { select: { name: true } }, decidedBy: { select: { name: true } }, coaDocument: true } });
  if (!i) throw notFound();
  res.json(i);
}));

qualityRouter.get("/lots", requirePerm("quality.read"), ah(async (req, res) => {
  const where: any = { type: "PRODUCTO_TERMINADO" };
  if (req.query.qualityStatus) where.qualityStatus = req.query.qualityStatus;
  const lots = await prisma.lot.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { inspections: { select: { code: true, status: true, date: true }, orderBy: { date: "desc" } } } });
  res.json(lots);
}));

const inspectionSchema = z.object({
  lotId: z.coerce.number().int().positive(),
  date: z.coerce.date().optional(),
  moisturePct: z.coerce.number().min(0).max(100).nullable().optional(),
  astaColor: z.coerce.number().min(0).max(1000).nullable().optional(),
  granulometry: z.coerce.number().min(0).max(100).nullable().optional(),
  granulometryMesh: z.string().max(40).nullable().optional(),
  microbiological: z.enum(["PENDIENTE", "CONFORME", "NO_CONFORME"]).default("PENDIENTE"),
  contaminants: z.enum(["PENDIENTE", "CONFORME", "NO_CONFORME"]).default("PENDIENTE"),
  observations: z.string().max(1000).nullable().optional(),
  coaDocumentId: z.coerce.number().int().positive().nullable().optional(),
  specCustomerId: z.coerce.number().int().positive().nullable().optional(),
});

export async function createInspection(tx: Tx, input: z.infer<typeof inspectionSchema>, userId: number) {
  const lot = await tx.lot.findUnique({ where: { id: input.lotId } });
  if (!lot) throw notFound("Lote no encontrado");
  if (lot.type !== "PRODUCTO_TERMINADO") throw unprocessable("Las inspecciones de liberación se realizan sobre lotes de producto terminado");
  const specEvaluation = await evaluateSpecs(tx, lot.productId, input.specCustomerId ?? null, input);
  const at = input.date ?? new Date();
  const insp = await tx.qualityInspection.create({
    data: { ...input, date: at, code: await nextCode(tx, "QC", at.getFullYear(), 4), inspectorId: userId, status: "EN_EVALUACION", specEvaluation },
  });
  await tx.lot.update({ where: { id: lot.id }, data: { qualityStatus: "EN_EVALUACION" } });
  await audit(tx, userId, "CREAR", "inspeccion_calidad", insp.id, { lot: lot.code });
  return insp;
}

qualityRouter.post("/inspections", requirePerm("quality.write"), ah(async (req, res) => {
  const input = parse(inspectionSchema, req.body);
  res.status(201).json(await inTx((tx) => createInspection(tx, input, req.user!.id)));
}));

qualityRouter.put("/inspections/:id", requirePerm("quality.write"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(inspectionSchema.omit({ lotId: true }).partial(), req.body);
  const out = await inTx(async (tx) => {
    const insp = await tx.qualityInspection.findUnique({ where: { id }, include: { lot: true } });
    if (!insp) throw notFound();
    if (insp.status !== "EN_EVALUACION" && insp.status !== "PENDIENTE") throw unprocessable("La inspección ya tiene una decisión registrada");
    const merged = { ...insp, ...input };
    const specEvaluation = await evaluateSpecs(tx, insp.lot.productId, merged.specCustomerId ?? null, merged as any);
    return tx.qualityInspection.update({ where: { id }, data: { ...input, specEvaluation } });
  });
  res.json(out);
}));

/** Hash del certificado: SHA-256 del archivo COA si se adjuntó; si no, del informe de inspección (JSON canónico). */
async function certificateHash(tx: Tx, inspId: number) {
  const i = await tx.qualityInspection.findUniqueOrThrow({ where: { id: inspId }, include: { coaDocument: true, lot: true } });
  if (i.coaDocument) return { hash: "0x" + i.coaDocument.sha256, source: `Archivo COA ${i.coaDocument.fileName}` };
  return {
    hash: hashObject({
      inspection: i.code, lot: i.lot.code, date: i.date.toISOString(), moisturePct: i.moisturePct?.toString() ?? null, astaColor: i.astaColor?.toString() ?? null,
      granulometry: i.granulometry?.toString() ?? null, granulometryMesh: i.granulometryMesh, microbiological: i.microbiological, contaminants: i.contaminants, status: i.status,
    }),
    source: `Informe de inspección ${i.code}`,
  };
}

const decisionSchema = z.object({ status: z.enum(["APROBADO", "RECHAZADO", "CUARENTENA"]), note: z.string().max(500).optional(), at: z.coerce.date().optional() });

/** Decisión de calidad con impacto en inventario: aprobado → stock disponible; rechazado/cuarentena → bloqueado. */
export async function decideInspection(tx: Tx, inspId: number, input: z.infer<typeof decisionSchema>, userId: number) {
  const insp = await tx.qualityInspection.findUnique({ where: { id: inspId }, include: { lot: { include: { product: true } } } });
  if (!insp) throw notFound();
  if (insp.status !== "EN_EVALUACION") throw unprocessable("La inspección ya fue decidida");
  const evals = (insp.specEvaluation as any[]) ?? [];
  if (input.status === "APROBADO") {
    const problems: string[] = [];
    if (insp.microbiological !== "CONFORME") problems.push("resultado microbiológico no conforme o pendiente");
    if (insp.contaminants !== "CONFORME") problems.push("resultado de contaminantes no conforme o pendiente");
    for (const e of evals) if (e.result !== "CUMPLE") problems.push(`${e.parameter}: ${e.result === "SIN_DATO" ? "sin dato" : "fuera de especificación"}`);
    if (problems.length) throw unprocessable(`No se puede aprobar el lote ${insp.lot.code}: ${problems.join("; ")}`);
  }
  const at = input.at ?? new Date();
  await tx.qualityInspection.update({ where: { id: inspId }, data: { status: input.status, decidedById: userId, decidedAt: at, observations: input.note ? `${insp.observations ?? ""}\n${input.note}`.trim() : insp.observations } });
  const cert = await certificateHash(tx, inspId);
  const lotStatus: QualityStatus = input.status;
  await tx.lot.update({ where: { id: insp.lotId }, data: { qualityStatus: lotStatus, certHash: cert.hash, status: input.status === "RECHAZADO" ? "BLOQUEADO" : "EN_ALMACEN" } });

  const bag = insp.lot.product.bagWeightKg ? Number(insp.lot.product.bagWeightKg) : null;
  const balances = await tx.inventoryBalance.findMany({ where: { lotId: insp.lotId } });
  for (const b of balances) {
    if (input.status === "APROBADO" && D(b.quarantineKg).gt(0)) {
      await applyMovement(tx, { type: "LIBERACION_CUARENTENA", productId: b.productId, warehouseId: b.warehouseId, lotId: insp.lotId, quantityKg: b.quarantineKg, bagWeightKg: bag, unitCost: insp.lot.unitCost, reason: `Lote aprobado por Calidad (${insp.code})`, referenceType: "QUALITY_INSPECTION", referenceCode: insp.code, userId, at });
    }
    if (input.status !== "APROBADO" && D(b.availableKg).gt(0)) {
      await applyMovement(tx, { type: "BLOQUEO_CUARENTENA", productId: b.productId, warehouseId: b.warehouseId, lotId: insp.lotId, quantityKg: b.availableKg, bagWeightKg: bag, unitCost: insp.lot.unitCost, reason: `Lote ${input.status.toLowerCase()} por Calidad (${insp.code})`, referenceType: "QUALITY_INSPECTION", referenceCode: insp.code, userId, at });
    }
  }
  await audit(tx, userId, `CALIDAD_${input.status}`, "lote", insp.lotId, { lot: insp.lot.code, inspection: insp.code, certHash: cert.hash, certSource: cert.source });
  return { inspection: await tx.qualityInspection.findUnique({ where: { id: inspId } }), certHash: cert.hash, certSource: cert.source };
}

qualityRouter.post("/inspections/:id/decision", requirePerm("quality.approve"), ah(async (req, res) => {
  const input = parse(decisionSchema, req.body);
  res.json(await inTx((tx) => decideInspection(tx, idParam(req), input, req.user!.id)));
}));
