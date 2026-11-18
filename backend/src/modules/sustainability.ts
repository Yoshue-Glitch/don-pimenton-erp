/** Logística inversa (reclamos/RMA, devoluciones, retiro de lote, economía circular) y Plan de Responsabilidad Social. */
import { Router } from "express";
import { z } from "zod";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { notFound, unprocessable } from "../lib/errors";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { D } from "../lib/decimal";
import * as T from "./trade.service";

export const reverseRouter = Router();
export const rsRouter = Router();

// ------------------------------------------------------------------ logística inversa
reverseRouter.get("/", requirePerm("reverse.read"), ah(async (_req, res) => {
  const [claims, circular, drills] = await Promise.all([
    prisma.claim.findMany({ orderBy: { id: "desc" }, include: { customer: { select: { name: true } }, shipment: { select: { code: true } } } }),
    prisma.circularRecord.findMany({ orderBy: { date: "desc" } }),
    prisma.recallDrill.findMany({ orderBy: { id: "desc" }, take: 10 }),
  ]);
  res.json({ claims, circular, drills, kpis: await reverseKpis() });
}));

export async function reverseKpis() {
  const claims = await prisma.claim.findMany();
  const closed = claims.filter((c) => c.closedAt);
  const within15 = closed.filter((c) => c.closedAt!.getTime() - c.openedAt.getTime() <= 15 * 86400000);
  const circ = await prisma.circularRecord.findMany();
  const sum = (t: string) => circ.filter((c) => c.type === t).reduce((a, b) => a + Number(b.quantity), 0);
  const sacksSold = await prisma.inventoryMovement.aggregate({ where: { type: "SALIDA", product: { code: "PT-PAP-MOL-25" } }, _sum: { bags: true } });
  const reuse = Number(sacksSold._sum.bags ?? 0) ? sum("SACO_REUTILIZADO") / Number(sacksSold._sum.bags) * 100 : null;
  const organic = await prisma.productionOrder.aggregate({ where: { status: "COMPLETADA" }, _sum: { wasteKg: true } });
  const compostPct = Number(organic._sum.wasteKg ?? 0) ? Math.min(100, sum("COMPOST") / (Number(organic._sum.wasteKg) * 0.18) * 100) : null; // ≈18 % de la merma es residuo sólido orgánico (el resto es agua evaporada)
  const lastDrill = await prisma.recallDrill.findFirst({ where: { minutes: { not: null } }, orderBy: { id: "desc" } });
  return {
    openClaims: claims.filter((c) => !["CERRADO", "RECHAZADO"].includes(c.status)).length, totalClaims: claims.length,
    within15Pct: closed.length ? Number((within15.length / closed.length * 100).toFixed(1)) : null, creditUsd: claims.reduce((a, c) => a + Number(c.creditUsd), 0),
    sacksReused: sum("SACO_REUTILIZADO"), reusePct: reuse === null ? null : Number(reuse.toFixed(1)), compostKg: sum("COMPOST"), compostPct: compostPct === null ? null : Number(compostPct.toFixed(1)),
    recycledKg: sum("RECICLAJE_VIDRIO") + sum("RECICLAJE_CARTON") + sum("RECICLAJE_PLASTICO"), returnablePallets: sum("PALETA_RETORNABLE"),
    lastRecallMinutes: lastDrill?.minutes ?? null, recallTargetMinutes: 240,
  };
}

reverseRouter.post("/claims", requirePerm("reverse.write"), ah(async (req, res) => {
  const i = parse(z.object({ shipmentCode: z.string().optional(), customerId: z.coerce.number().int().positive().optional(), type: z.enum(["CALIDAD", "ROTURA", "FALTANTE", "ETIQUETADO", "RETRASO", "OTRO"]), description: z.string().min(5), jars: z.coerce.number().int().min(0).default(0) }), req.body);
  const s = i.shipmentCode ? await prisma.exportShipment.findUnique({ where: { code: i.shipmentCode }, include: { lot: true } }) : null;
  const customerId = s?.customerId ?? i.customerId;
  if (!customerId) throw unprocessable("Indique el embarque o el cliente");
  const c = await inTx(async (tx) => tx.claim.create({ data: { code: await nextCode(tx, "RMA", new Date().getFullYear(), 3), shipmentId: s?.id, customerId, lotCode: s?.lot?.code, type: i.type, description: i.description, jars: i.jars } }));
  await audit(prisma, req.user!.id, "CREAR_RECLAMO", "claim", c.id, {});
  res.status(201).json(c);
}));

/** Resuelve un reclamo y ejecuta automáticamente sus efectos (nota de crédito, reciclaje, compostaje, reposición). */
reverseRouter.post("/claims/:id/resolve", requirePerm("reverse.write"), ah(async (req, res) => {
  const i = parse(z.object({ decision: z.enum(["APROBADO", "RECHAZADO"]), disposition: z.enum(["REPOSICION", "NOTA_CREDITO", "REPROCESO", "DESTRUCCION", "COMPOSTAJE", "RECICLAJE"]).optional(), creditUsd: z.coerce.number().min(0).default(0), resolution: z.string().max(500).optional() }), req.body);
  const out = await inTx(async (tx) => {
    const c = await tx.claim.findUnique({ where: { id: idParam(req) }, include: { shipment: true } });
    if (!c) throw notFound();
    if (["CERRADO", "RECHAZADO"].includes(c.status)) throw unprocessable("El reclamo ya fue cerrado");
    if (i.decision === "APROBADO" && !i.disposition) throw unprocessable("Indique la disposición");
    const now = new Date();
    if (i.decision === "APROBADO") {
      if (i.disposition === "NOTA_CREDITO" && i.creditUsd > 0) {
        const fx = c.shipment ? c.shipment.exchangeRate : D(3.75);
        await tx.financialTransaction.create({ data: { code: await nextCode(tx, "FIN", now.getFullYear(), 5), type: "EGRESO", category: "NOTA_CREDITO_EXPORTACION", date: now, description: `Nota de crédito por ${c.code} (${c.type.toLowerCase()})`, currency: "USD", amount: i.creditUsd, exchangeRate: fx, amountPen: D(i.creditUsd).times(fx).toDecimalPlaces(2), referenceType: "CLAIM", referenceCode: c.code, userId: req.user!.id } });
      }
      const circ: Record<string, [string, number, string]> = { RECICLAJE: ["RECICLAJE_VIDRIO", Number((c.jars * 0.105).toFixed(3)), "KG"], COMPOSTAJE: ["COMPOST", Number((c.jars * 0.113).toFixed(3)), "KG"], DESTRUCCION: ["RESIDUO_PELIGROSO", c.jars, "UND"], REPROCESO: ["PRODUCTO_DEVUELTO", c.jars, "UND"] };
      if (circ[i.disposition!] && c.jars > 0) await tx.circularRecord.create({ data: { date: now, type: circ[i.disposition!][0], quantity: circ[i.disposition!][1], unit: circ[i.disposition!][2], partner: i.disposition === "RECICLAJE" ? "Asociación de recicladores (convenio)" : "Planta Don Pimentón", reference: c.code } });
      if (c.shipmentId) await T.event(tx, c.shipmentId, "LOGISTICA_INVERSA", `Reclamo ${c.code} aprobado → ${i.disposition}${i.creditUsd ? ` (nota de crédito US$ ${i.creditUsd.toFixed(2)})` : ""}`, "info");
    }
    const upd = await tx.claim.update({ where: { id: c.id }, data: { status: i.decision === "APROBADO" ? "CERRADO" : "RECHAZADO", disposition: i.disposition, creditUsd: i.creditUsd, resolution: i.resolution, closedAt: now } });
    await audit(tx, req.user!.id, "RESOLVER_RECLAMO", "claim", c.id, i as any);
    return upd;
  });
  res.json(out);
}));

reverseRouter.post("/circular", requirePerm("reverse.write"), ah(async (req, res) => {
  const i = parse(z.object({ date: z.coerce.date(), type: z.enum(["SACO_REUTILIZADO", "PALETA_RETORNABLE", "COMPOST", "RECICLAJE_VIDRIO", "RECICLAJE_CARTON", "RECICLAJE_PLASTICO", "RESIDUO_PELIGROSO", "PRODUCTO_DEVUELTO"]), quantity: z.coerce.number().positive(), unit: z.enum(["UND", "KG"]), partner: z.string().max(120).optional(), notes: z.string().max(300).optional() }), req.body);
  res.status(201).json(await prisma.circularRecord.create({ data: i }));
}));

/** Simulacro de retiro (recall): trazabilidad hacia atrás y hacia adelante del lote, con tiempo medido (meta < 4 h). */
reverseRouter.post("/recall", requirePerm("reverse.write"), ah(async (req, res) => {
  const { lotCode, reason } = parse(z.object({ lotCode: z.string(), reason: z.string().min(3).max(300) }), req.body);
  const t0 = Date.now();
  const lot = await prisma.lot.findUnique({ where: { code: lotCode }, include: { parentLot: { include: { parentLot: { include: { harvest: true, campaign: { include: { parcel: true } } } } } }, childLots: { include: { childLots: true } } } });
  if (!lot) throw notFound("Lote no encontrado");
  const related = [lot.id, ...(lot.parentLotId ? [lot.parentLotId] : []), ...lot.childLots.map((c) => c.id), ...lot.childLots.flatMap((c) => c.childLots.map((g) => g.id))];
  const parentChildren = lot.parentLotId ? await prisma.lot.findMany({ where: { parentLotId: lot.parentLotId } }) : [];
  const lotIds = [...new Set([...related, ...parentChildren.map((l) => l.id)])];
  const [pallets, ships, sales] = await Promise.all([
    prisma.pallet.findMany({ where: { lotId: { in: lotIds } }, include: { lot: { select: { code: true } } } }),
    prisma.exportShipment.findMany({ where: { lotId: { in: lotIds } }, include: { customer: { select: { name: true, country: true } } } }),
    prisma.salesOrderItem.findMany({ where: { lotId: { in: lotIds } }, include: { order: { include: { customer: { select: { name: true } } } } } }),
  ]);
  const raw = lot.parentLot?.parentLot;
  const affected = {
    backward: { parcel: raw?.campaign?.parcel?.code ?? null, harvest: raw?.harvest?.code ?? null, rawLot: raw?.code ?? null, bulkLot: lot.parentLot?.code ?? null },
    lots: (await prisma.lot.findMany({ where: { id: { in: lotIds } }, select: { code: true, qualityStatus: true } })),
    pallets: pallets.map((p) => ({ sscc: p.sscc, lot: p.lot.code, status: p.status })),
    customers: [...ships.map((s) => ({ name: s.customer.name, country: s.customer.country, via: s.code })), ...sales.map((s) => ({ name: s.order.customer.name, country: "Perú", via: s.order.code }))],
  };
  const minutes = Number(((Date.now() - t0) / 60000).toFixed(4));
  const d = await prisma.recallDrill.create({ data: { code: await inTx((tx) => nextCode(tx, "RECALL", new Date().getFullYear(), 3)), lotCode, reason, affected, finishedAt: new Date(), minutes } });
  await audit(prisma, req.user!.id, "SIMULACRO_RETIRO", "recall", d.id, { lotCode, minutes });
  res.json({ ...d, seconds: Number(((Date.now() - t0) / 1000).toFixed(2)), targetHours: 4 });
}));

// ------------------------------------------------------------------ Responsabilidad Social
const light = (pct: number | null) => (pct === null ? "GRIS" : pct >= 90 ? "VERDE" : pct >= 70 ? "AMARILLO" : "ROJO");
export function indicatorProgress(i: { baseline: number | null; target12: number; current: number | null; lowerIsBetter: boolean }) {
  if (i.current === null || i.current === undefined) return null;
  if (i.lowerIsBetter) {
    const base = i.baseline ?? i.current;
    if (base === i.target12) return i.current <= i.target12 ? 100 : 0;
    return Math.max(0, Math.min(100, ((base - i.current) / (base - i.target12)) * 100));
  }
  return i.target12 ? Math.max(0, Math.min(100, (i.current / i.target12) * 100)) : null;
}

rsRouter.get("/", requirePerm("rs.read"), ah(async (_req, res) => {
  const [projects, indicators] = await Promise.all([prisma.rsProject.findMany({ orderBy: { id: "asc" } }), prisma.rsIndicator.findMany({ orderBy: { id: "asc" } })]);
  // indicadores alimentados automáticamente por el ERP
  const rk = await reverseKpis();
  const kpis = await T.kpis();
  const comp = await prisma.complianceItem.findMany({ where: { scope: "EMPRESA" } });
  const workers = await prisma.worker.findMany({ where: { active: true } as any }).catch(() => [] as any[]);
  const formal = workers.length ? workers.filter((w: any) => w.contractType !== "TEMPORAL_COSECHA" && !w.isTemporary).length / workers.length * 100 : null;
  const budget = projects.reduce((a, p) => a + Number(p.budgetPen), 0), executed = projects.reduce((a, p) => a + Number(p.executedPen), 0);
  const expectedNow = projects.reduce((a, p) => a + Number(p.budgetPen) * p.progressPct / 100, 0);
  const auto: Record<string, number | null> = {
    rrhh: formal === null ? null : Number(formal.toFixed(1)),
    compliance: Number((comp.filter((c) => ["CUMPLIDO", "POR_VENCER"].includes(T.complianceStatus(c))).length / Math.max(1, comp.length) * 100).toFixed(1)),
    kpi3: kpis.find((k) => k.n === 3)?.value ?? null, compost: rk.compostPct, reuse: rk.reusePct, claims: rk.within15Pct,
    budget: expectedNow ? Number((executed / expectedNow * 100).toFixed(1)) : null,
  };
  const ind = indicators.map((i) => {
    const current = i.source && auto[i.source] !== undefined ? auto[i.source] : i.current;
    const progress = indicatorProgress({ ...i, current });
    return { ...i, current, auto: !!(i.source && auto[i.source] !== undefined), progressPct: progress === null ? null : Number(progress.toFixed(1)), light: light(progress) };
  });
  const byAxis: Record<string, { budget: number; year1: number; year2: number; executed: number; projects: number }> = {};
  const bySource: Record<string, number> = {}, byClass: Record<string, number> = {};
  for (const p of projects) {
    byAxis[p.axis] ??= { budget: 0, year1: 0, year2: 0, executed: 0, projects: 0 };
    byAxis[p.axis].budget += Number(p.budgetPen); byAxis[p.axis].year1 += Number(p.year1Pen); byAxis[p.axis].year2 += Number(p.year2Pen); byAxis[p.axis].executed += Number(p.executedPen); byAxis[p.axis].projects++;
    bySource[p.source] = (bySource[p.source] ?? 0) + Number(p.budgetPen); byClass[p.expenseClass] = (byClass[p.expenseClass] ?? 0) + Number(p.budgetPen);
  }
  res.json({
    projects, indicators: ind, byAxis, bySource, byClass, totals: { subtotal: budget, contingency: Number((budget * 0.1).toFixed(0)), total: Number((budget * 1.1).toFixed(0)), executed },
    quarterly: [9077, 11926, 21925, 21980, 10012, 12245, 7130, 7576], // Tabla RS-45 (S/, con imprevistos)
    stages: [{ n: 1, name: "Cumplimiento primero (T1–T4)", rule: "Aprobación del Comité y financiamiento propio mínimo" }, { n: 2, name: "Valor compartido (T3–T6)", rule: "Fondos concursables presentados y convenio de la asociación firmado" }, { n: 3, name: "Inversión social (T5–T8)", rule: "Ventas del año 1 con crecimiento ≥ 10 % o fondos aprobados; si no, escenario austero" }],
    note: "Presupuesto por plan y totales según el Plan de RS (S/ 92,610 + 10 % = S/ 101,871). La distribución por proyecto es una estimación de demostración que respeta los totales por plan.",
  });
}));
rsRouter.put("/projects/:id", requirePerm("rs.write"), ah(async (req, res) => {
  const i = parse(z.object({ progressPct: z.coerce.number().int().min(0).max(100).optional(), executedPen: z.coerce.number().min(0).optional(), status: z.enum(["PLANIFICADO", "EN_CURSO", "COMPLETADO", "POSTERGADO"]).optional() }), req.body);
  const out = await prisma.rsProject.update({ where: { id: idParam(req) }, data: { ...i, ...(i.progressPct === 100 ? { status: "COMPLETADO" } : {}) } });
  await audit(prisma, req.user!.id, "ACTUALIZAR_PROYECTO_RS", "rs", out.id, i as any);
  res.json(out);
}));
rsRouter.put("/indicators/:id", requirePerm("rs.write"), ah(async (req, res) => {
  const { current } = parse(z.object({ current: z.coerce.number().nullable() }), req.body);
  res.json(await prisma.rsIndicator.update({ where: { id: idParam(req) }, data: { current } }));
}));
