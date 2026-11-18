/** API del hub de exportación (ERP interno). */
import { Router, Request } from "express";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { requirePerm, hasPerm } from "../auth/auth";
import { forbidden, notFound, unprocessable } from "../lib/errors";
import { audit } from "../lib/audit";
import { D } from "../lib/decimal";
import { getSetting } from "../lib/settings";
import * as T from "./trade.service";
import * as A from "./automation";
import * as chain from "../blockchain/chain";
import { shipmentPdf, harvestPdf, DOC_TYPES, traceUrl } from "./exportDocs";

export const tradeRouter = Router();

/** Alcance por rol: el agente solo ve sus embarques; broker/comprador solo los de su cliente. */
function scope(req: Request) {
  const u = req.user!;
  if (u.role === "AGENTE_ADUANA") return { agentEmail: u.email };
  if (["BROKER", "COMPRADOR"].includes(u.role)) return { customerId: u.customerId ?? -1 };
  return {};
}
async function loadScoped(req: Request, id: number) {
  const s = await prisma.exportShipment.findFirst({ where: { id, ...scope(req) } });
  if (!s) throw notFound("Embarque no encontrado o no autorizado para su usuario");
  return s;
}

tradeRouter.get("/params", ah(async (_req, res) => {
  const p = await T.params();
  res.json({ params: p, limits: await T.limits(), pallet: T.palletWeights(p), gtin: T.gtinCodes(p.gs1CompanyPrefix), costsPerJar: await getSetting("costs.perJarPen"), automation: await A.autoSettings() });
}));

tradeRouter.get("/mass-balance", ah(async (req, res) => {
  const p = await T.params();
  res.json(T.massBalance(p, Number(req.query.freshKg ?? 2102), req.query.finalKg ? Number(req.query.finalKg) : null, req.query.discardKg ? Number(req.query.discardKg) : null));
}));

// ------------------------------------------------------------------ embarques
tradeRouter.get("/shipments", requirePerm("customs.read"), ah(async (req, res) => {
  const where: any = { ...scope(req) };
  if (req.query.status) where.status = req.query.status;
  const items = await prisma.exportShipment.findMany({ where, orderBy: { id: "desc" }, include: { customer: { select: { name: true } }, lot: { select: { code: true, qualityStatus: true } }, agreement: { select: { code: true, status: true, qualityState: true, deliveryState: true } }, _count: { select: { palletsList: true, payments: true, claims: true } } } });
  const p = await T.params();
  const canCosts = hasPerm(req, "costs.read");
  res.json(items.map((s) => ({ ...T.sanitizeForRole(s, canCosts), customs: T.customsLight(s, p) })));
}));

tradeRouter.get("/shipments/:id", requirePerm("customs.read"), ah(async (req, res) => {
  const base = await loadScoped(req, idParam(req));
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: base.id }, include: { customer: true, lot: { include: { parentLot: { include: { labAnalyses: true } } } }, palletsList: true, compliance: { orderBy: { id: "asc" } }, payments: { orderBy: { id: "desc" } }, claims: true, events: { orderBy: { id: "desc" }, take: 80 }, agreement: true, costs: true } });
  const p = await T.params();
  const canCosts = hasPerm(req, "costs.read");
  let onchain: any = null;
  if (s.agreement) onchain = await chain.readAgreement(s.agreement.code).catch(() => null);
  const milestones = s.lot ? await chain.readMilestones(s.lot.code).catch(() => []) : [];
  const out: any = { ...T.sanitizeForRole(s, canCosts), customs: T.customsLight(s, p), onchain, milestones, traceUrl: s.lot ? traceUrl(s.lot.code) : null, docTypes: DOC_TYPES };
  if (canCosts) out.finance = await T.shipmentFinance(prisma, s.id);
  res.json(out);
}));

const shipSchema = z.object({
  customerId: z.coerce.number().int().positive(), pallets: z.coerce.number().int().min(1).max(20), unitPriceUsd: z.coerce.number().positive().optional(),
  incoterm: z.enum(["FCA", "FOB"]).default("FCA"), incotermPlace: z.string().max(120).optional(), deliveryDate: z.coerce.date(), paymentTerms: z.string().max(200).optional(),
  broker: z.string().max(120).nullable().optional(), exchangeRate: z.coerce.number().positive().optional(), status: z.enum(["COTIZACION", "PEDIDO"]).default("PEDIDO"),
  notes: z.string().max(500).optional(), agentEmail: z.string().email().nullable().optional(), autopilot: z.boolean().optional(),
});
tradeRouter.post("/quote", requirePerm("trade.read"), ah(async (req, res) => {
  const i = parse(z.object({ pallets: z.coerce.number().int().min(1).max(20), unitPriceUsd: z.coerce.number().positive().optional(), exchangeRate: z.coerce.number().positive().optional(), incoterm: z.enum(["FCA", "FOB"]).default("FCA") }), req.body);
  const q = await T.quote(prisma, i);
  res.json(hasPerm(req, "costs.read") ? q : { ...q, costs: undefined, costPen: undefined, costPerJarPen: undefined, marginPct: undefined });
}));
tradeRouter.post("/shipments", requirePerm("trade.write"), ah(async (req, res) => {
  const i = parse(shipSchema, req.body);
  const s = await inTx((tx) => T.createShipment(tx, i, req.user!.id));
  if (i.autopilot === false) await prisma.exportShipment.update({ where: { id: s.id }, data: { autopilot: false } });
  res.status(201).json(s);
}));

const act = (perm: string, fn: (id: number, req: Request) => Promise<unknown>) => ah(async (req, res) => {
  if (!hasPerm(req, perm)) throw forbidden(`No tiene permisos para esta operación (${perm})`);
  const s = await loadScoped(req, idParam(req));
  res.json(await fn(s.id, req));
});
tradeRouter.post("/shipments/:id/convert", act("trade.write", (id, req) => inTx(async (tx) => {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id } });
  if (s.status !== "COTIZACION") throw unprocessable("Solo se convierten cotizaciones");
  const blockers = await T.complianceBlockers(tx, s.deliveryDate);
  if (blockers.length) throw unprocessable(`R7 — Pedido bloqueado: ${blockers.map((b) => `${b.name} (${b.reason})`).join("; ")}`, { blockers });
  await T.event(tx, id, "PEDIDO", "Cotización convertida en pedido", "info");
  await audit(tx, req.user!.id, "CONVERTIR_COTIZACION", "embarque", id, {});
  return tx.exportShipment.update({ where: { id }, data: { status: "PEDIDO" } });
})));
tradeRouter.post("/shipments/:id/validate-quality", act("trade.write", (id, req) => inTx((tx) => T.validateQuality(tx, id, req.user!.id))));
tradeRouter.post("/shipments/:id/reserve", act("trade.write", (id, req) => inTx((tx) => T.reserveShipment(tx, id, req.user!.id))));
tradeRouter.post("/shipments/:id/approve-margin", act("trade.approve", (id, req) => inTx((tx) => T.approveMargin(tx, id, req.user!))));
tradeRouter.post("/shipments/:id/confirm", act("trade.write", (id, req) => inTx((tx) => T.confirmShipment(tx, id, req.user!.id))));
tradeRouter.post("/shipments/:id/docs/validate", act("docs.write", (id, req) => inTx((tx) => T.validateDocs(tx, id, parse(z.object({ declaredNetKg: z.coerce.number().optional(), declaredGrossKg: z.coerce.number().optional(), description: z.string().optional(), hsCode: z.string().optional() }), req.body ?? {}), req.user!.id))));
tradeRouter.put("/shipments/:id/customs", act("customs.write", (id, req) => inTx((tx) => T.updateCustoms(tx, id, req.body ?? {}, req.user!.id))));
tradeRouter.post("/shipments/:id/dispatch", act("customs.write", (id, req) => inTx((tx) => T.dispatchShipment(tx, id, req.user!.id))));
tradeRouter.post("/shipments/:id/advance", act("trade.write", (id) => A.advance(id, { force: true })));
tradeRouter.post("/shipments/:id/autopilot", act("trade.write", async (id, req) => prisma.exportShipment.update({ where: { id }, data: { autopilot: !!req.body?.enabled } })));
tradeRouter.post("/shipments/:id/agreement", act("blockchain.write", (id, req) => A.createShipmentAgreement(id, req.user!.id)));
tradeRouter.put("/shipments/:id/costs", act("costs.write", async (id, req) => {
  const rows = parse(z.array(z.object({ concept: z.string(), amountPen: z.coerce.number().min(0), budgetPen: z.coerce.number().min(0).optional(), dataKind: z.enum(["REAL", "SUPUESTO", "DEMO"]).optional() })), req.body);
  for (const r of rows) await prisma.shipmentCost.upsert({ where: { shipmentId_concept: { shipmentId: id, concept: r.concept } }, create: { shipmentId: id, ...r, budgetPen: r.budgetPen ?? r.amountPen }, update: r });
  await audit(prisma, req.user!.id, "ACTUALIZAR_COSTOS", "embarque", id, { rows: rows.length });
  return T.shipmentFinance(prisma, id);
}));
tradeRouter.put("/shipments/:id/compliance/:itemId", act("compliance.write", async (id, req) => {
  const i = parse(z.object({ status: z.enum(["CUMPLIDO", "PENDIENTE", "POR_VENCER", "VENCIDO", "NO_APLICABLE", "REQUIERE_VALIDACION"]), evidence: z.string().max(200).nullable().optional() }), req.body);
  if (i.status === "CUMPLIDO" && !i.evidence) throw unprocessable("No se declara cumplimiento sin evidencia documental");
  return prisma.complianceItem.update({ where: { id: Number(req.params.itemId) }, data: i });
}));
tradeRouter.get("/shipments/:id/docs/:type.pdf", requirePerm("docs.read"), ah(async (req, res) => {
  const s = await loadScoped(req, idParam(req));
  await audit(prisma, req.user!.id, "GENERAR_DOCUMENTO", "embarque", s.id, { type: req.params.type });
  await shipmentPdf(res, s.id, req.params.type, { hideCosts: !hasPerm(req, "costs.read") });
}));
tradeRouter.get("/harvests/:code/ficha.pdf", requirePerm("agri.read"), ah(async (req, res) => harvestPdf(res, req.params.code)));

// ------------------------------------------------------------------ paletas, envasado y laboratorio
tradeRouter.get("/pallets", requirePerm("trade.read"), ah(async (req, res) => {
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  res.json(await prisma.pallet.findMany({ where, orderBy: { id: "desc" }, include: { lot: { select: { code: true, qualityStatus: true, expiryDate: true } }, shipment: { select: { code: true } } } }));
}));
tradeRouter.get("/bulk-lots", requirePerm("trade.read"), ah(async (_req, res) => {
  const lots = await prisma.lot.findMany({ where: { type: "PRODUCTO_TERMINADO", product: { code: "PT-PAP-MOL-25" } }, include: { balances: true, labAnalyses: { orderBy: { id: "desc" }, take: 1 } }, orderBy: { id: "desc" } });
  res.json(lots.map((l) => ({ id: l.id, code: l.code, qualityStatus: l.qualityStatus, productionDate: l.productionDate, availableKg: l.balances.reduce((a, b) => a.plus(b.availableKg), D(0)), quarantineKg: l.balances.reduce((a, b) => a.plus(b.quarantineKg), D(0)), lastLab: l.labAnalyses[0] ?? null })));
}));
tradeRouter.get("/jar-lots", requirePerm("trade.read"), ah(async (_req, res) => {
  res.json(await prisma.lot.findMany({ where: { product: { code: "PT-PAP-FRASCO-113" } }, orderBy: { id: "desc" }, include: { parentLot: { select: { code: true } }, pallets: { select: { sscc: true, status: true } }, balances: true } }));
}));
tradeRouter.post("/pack", requirePerm("trade.write"), ah(async (req, res) => {
  const i = parse(z.object({ sourceLotCode: z.string(), pallets: z.coerce.number().int().min(1).max(10).optional(), jars: z.coerce.number().int().positive().optional() }), req.body);
  res.status(201).json(await inTx((tx) => T.packLot(tx, i, req.user!.id)));
}));
tradeRouter.get("/lab", requirePerm("quality.read"), ah(async (_req, res) => {
  res.json(await prisma.labAnalysis.findMany({ orderBy: { id: "desc" }, include: { lot: { select: { code: true, qualityStatus: true } } } }));
}));
const labSchema = z.object({
  lotCode: z.string(), laboratory: z.string().min(2), analysisDate: z.coerce.date().optional(), asta: z.coerce.number().nullable().optional(), moisturePct: z.coerce.number().nullable().optional(), aw: z.coerce.number().nullable().optional(),
  salmonella: z.enum(["AUSENTE", "PRESENTE"]).optional(), ecoli: z.coerce.number().nullable().optional(), moldsYeasts: z.coerce.number().nullable().optional(), aflatoxinB1: z.coerce.number().nullable().optional(),
  aflatoxinTotal: z.coerce.number().nullable().optional(), ochratoxinA: z.coerce.number().nullable().optional(), bannedDyes: z.enum(["NO_DETECTADO", "DETECTADO"]).optional(), foreignMatter: z.enum(["CONFORME", "NO_CONFORME"]).optional(),
  metalDetection: z.enum(["CONFORME", "NO_CONFORME"]).optional(), netWeightG: z.coerce.number().nullable().optional(),
});
tradeRouter.post("/lab", requirePerm("lab.write"), ah(async (req, res) => res.status(201).json(await inTx((tx) => T.registerLabAnalysis(tx, parse(labSchema, req.body), req.user!.id)))));
tradeRouter.post("/lab/:id/decide", requirePerm("lab.approve"), ah(async (req, res) => {
  const i = parse(z.object({ decision: z.enum(["APROBADO", "RECHAZADO"]), evidence: z.string().max(200).optional() }), req.body);
  res.json(await inTx((tx) => T.decideLabAnalysis(tx, idParam(req), i, req.user!)));
}));
tradeRouter.put("/limits", requirePerm("quality.specs"), ah(async (req, res) => {
  const cur = await T.limits();
  const value = { ...cur, ...parse(z.record(z.coerce.number()), req.body) };
  await prisma.setting.upsert({ where: { key: "quality.exportLimits" }, create: { key: "quality.exportLimits", value }, update: { value } });
  await audit(prisma, req.user!.id, "CONFIGURAR_LIMITES", "settings", "quality.exportLimits", value);
  res.json(value);
}));
tradeRouter.put("/params", requirePerm("settings.manage"), ah(async (req, res) => {
  const value = { ...(await T.params()), ...(req.body ?? {}) };
  await prisma.setting.upsert({ where: { key: "export.params" }, create: { key: "export.params", value }, update: { value } });
  await audit(prisma, req.user!.id, "CONFIGURAR_PARAMETROS", "settings", "export.params", {});
  res.json(value);
}));
tradeRouter.put("/automation", requirePerm("settings.manage"), ah(async (req, res) => {
  const value = { ...(await A.autoSettings()), ...(req.body ?? {}) };
  await prisma.setting.upsert({ where: { key: "automation.settings" }, create: { key: "automation.settings", value }, update: { value } });
  res.json(value);
}));

// ------------------------------------------------------------------ cumplimiento de empresa
tradeRouter.get("/compliance", requirePerm("compliance.read"), ah(async (_req, res) => {
  const items = await prisma.complianceItem.findMany({ where: { scope: "EMPRESA" }, orderBy: { id: "asc" } });
  const out = items.map((i) => ({ ...i, computedStatus: T.complianceStatus(i), daysLeft: i.validUntil ? Math.floor((i.validUntil.getTime() - Date.now()) / 86400000) : null }));
  res.json({ items: out, blockers: await T.complianceBlockers(prisma), note: "El sistema no declara cumplimiento legal sin evidencia documental. Vigencias y requisitos deben validarse con la autoridad o un especialista." });
}));
tradeRouter.put("/compliance/:id", requirePerm("compliance.write"), ah(async (req, res) => {
  const i = parse(z.object({ status: z.enum(["CUMPLIDO", "PENDIENTE", "POR_VENCER", "VENCIDO", "NO_APLICABLE", "REQUIERE_VALIDACION"]).optional(), validUntil: z.coerce.date().nullable().optional(), evidence: z.string().max(200).nullable().optional(), notes: z.string().max(500).nullable().optional() }), req.body);
  const cur = await prisma.complianceItem.findUniqueOrThrow({ where: { id: idParam(req) } });
  if ((i.status ?? cur.status) === "CUMPLIDO" && !(i.evidence ?? cur.evidence)) throw unprocessable("No se declara cumplimiento sin evidencia documental");
  const out = await prisma.complianceItem.update({ where: { id: cur.id }, data: i });
  await audit(prisma, req.user!.id, "ACTUALIZAR_CUMPLIMIENTO", "cumplimiento", cur.id, i as any);
  res.json(out);
}));

// ------------------------------------------------------------------ KPI y tablero de exportación
tradeRouter.get("/kpis", requirePerm("kpi.read"), ah(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  const k = await T.kpis(prisma, year);
  res.json(hasPerm(req, "costs.read") ? k : k.filter((x) => x.n !== 7 && x.n !== 8));
}));
tradeRouter.get("/overview", requirePerm("trade.read"), ah(async (_req, res) => {
  const [ships, pallets, events] = await Promise.all([
    prisma.exportShipment.findMany({ include: { agreement: true } }),
    prisma.pallet.groupBy({ by: ["status"], _count: true }),
    prisma.automationEvent.findMany({ orderBy: { id: "desc" }, take: 25, include: { shipment: { select: { code: true } } } }),
  ]);
  const p = await T.params();
  const byStatus: Record<string, number> = {};
  for (const s of ships) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  res.json({
    byStatus, pallets, events,
    active: ships.filter((s) => ["EN_TRANSITO", "DESPACHADO", "ARRIBADO", "ENTREGADO"].includes(s.status)).length,
    completed: ships.filter((s) => s.status === "CERRADO").length,
    contractsActive: ships.filter((s) => s.agreement && ["PROPUESTO", "ACEPTADO", "FONDEADO", "EN_DISPUTA"].includes(s.agreement.status)).length,
    customs: ships.filter((s) => s.damDate && !s.regularizedAt).map((s) => ({ code: s.code, ...T.customsLight(s, p) })),
    voyages: ships.filter((s) => ["EN_TRANSITO", "ARRIBADO", "ENTREGADO"].includes(s.status)).map((s) => ({ code: s.code, progress: s.voyageProgress, status: s.status, vessel: s.vessel, origin: s.originPort, destination: s.destinationPort })),
  });
}));
