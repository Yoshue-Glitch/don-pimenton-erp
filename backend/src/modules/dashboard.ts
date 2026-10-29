import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ah } from "../lib/http";
import { requirePerm, hasPerm } from "../auth/auth";
import { inventoryAlerts } from "./inventory";

export const dashboardRouter = Router();

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Todos los indicadores se calculan en vivo desde la base de datos. */
dashboardRouter.get("/", requirePerm("dashboard.read"), ah(async (_req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const from12 = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [prodTotal, ptBalances, lotsByQuality, activeLots, salesMonth, costMonth, costYear, pendingOrders, pendingPurchases, exportsInProcess, agreementsActive, txByStatus] = await Promise.all([
    prisma.lot.aggregate({ where: { type: "PRODUCTO_TERMINADO" }, _sum: { quantityKg: true } }),
    prisma.inventoryBalance.aggregate({ where: { product: { type: "PRODUCTO_TERMINADO" } }, _sum: { availableKg: true, reservedKg: true, quarantineKg: true } }),
    prisma.lot.groupBy({ by: ["qualityStatus"], where: { type: "PRODUCTO_TERMINADO" }, _count: true }),
    prisma.lot.count({ where: { type: "PRODUCTO_TERMINADO", balances: { some: { OR: [{ availableKg: { gt: 0 } }, { reservedKg: { gt: 0 } }, { quarantineKg: { gt: 0 } }] } } } }),
    prisma.salesOrder.findMany({ where: { date: { gte: monthStart }, status: { not: "ANULADO" } }, select: { total: true, taxTotal: true, exchangeRate: true } }),
    prisma.productionOrder.aggregate({ where: { status: "COMPLETADA", endDate: { gte: monthStart } }, _sum: { totalCost: true } }),
    prisma.productionOrder.aggregate({ where: { status: "COMPLETADA", endDate: { gte: new Date(now.getFullYear(), 0, 1) } }, _sum: { totalCost: true, finalWeightKg: true } }),
    prisma.salesOrder.count({ where: { status: { in: ["REGISTRADO", "RESERVADO", "DESPACHADO"] } } }),
    prisma.purchaseRequest.count({ where: { status: "EN_REVISION" } }),
    prisma.exportOrder.count({ where: { status: { in: ["CONFIRMADA", "DOCUMENTACION", "EMBARCADA", "EN_TRANSITO"] } } }),
    prisma.smartAgreement.count({ where: { status: { in: ["PROPUESTO", "ACEPTADO", "FONDEADO", "EN_DISPUTA"] } } }),
    prisma.blockchainTransaction.groupBy({ by: ["status"], _count: true }),
  ]);

  // Margen bruto estimado del año: ventas (base imponible, PEN) − costo de ventas de los lotes despachados
  const consumed = await prisma.inventoryReservation.findMany({
    where: { status: "CONSUMIDA", orderItem: { order: { date: { gte: new Date(now.getFullYear(), 0, 1) } } } },
    include: { lot: { select: { unitCost: true } }, orderItem: { include: { order: { select: { priceIncludesTax: true, taxRate: true, exchangeRate: true } } } } },
  });
  let revenueYear = 0, cogsYear = 0;
  for (const r of consumed) {
    const it = r.orderItem, o = it.order;
    const share = Number(r.quantityKg) / Number(it.quantityKg);
    revenueYear += (o.priceIncludesTax ? Number(it.lineTotal) / (1 + Number(o.taxRate)) : Number(it.lineTotal)) * share * Number(o.exchangeRate);
    cogsYear += Number(r.quantityKg) * Number(r.lot.unitCost);
  }

  const productionSeries = await prisma.$queryRaw<{ y: number; m: number; kg: number; cost: number }[]>`
    SELECT EXTRACT(YEAR FROM "endDate")::int y, EXTRACT(MONTH FROM "endDate")::int m, SUM("finalWeightKg")::float kg, SUM("totalCost")::float cost
    FROM "ProductionOrder" WHERE "status" = 'COMPLETADA' AND "endDate" >= ${from12} GROUP BY 1,2`;
  const salesSeries = await prisma.$queryRaw<{ y: number; m: number; total: number; kg: number }[]>`
    SELECT EXTRACT(YEAR FROM "date")::int y, EXTRACT(MONTH FROM "date")::int m, SUM("total" * "exchangeRate")::float total, SUM("totalKg")::float kg
    FROM "SalesOrder" WHERE "status" <> 'ANULADO' AND "date" >= ${from12} GROUP BY 1,2`;
  const series = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(from12.getFullYear(), from12.getMonth() + i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const p = productionSeries.find((r) => r.y === y && r.m === m), s = salesSeries.find((r) => r.y === y && r.m === m);
    return { label: `${MONTHS[m - 1]} ${String(y).slice(2)}`, produccionKg: p?.kg ?? 0, costoProduccion: p?.cost ?? 0, ventasPen: s?.total ?? 0, ventasKg: s?.kg ?? 0 };
  });

  const inventoryByProduct = await prisma.inventoryBalance.groupBy({ by: ["productId"], _sum: { availableKg: true, reservedKg: true, quarantineKg: true } });
  const products = await prisma.product.findMany({ where: { id: { in: inventoryByProduct.map((i) => i.productId) } } });
  const inventory = inventoryByProduct.map((i) => {
    const p = products.find((x) => x.id === i.productId)!;
    return { product: p.name, type: p.type, unit: p.unit, disponible: Number(i._sum.availableKg ?? 0), reservado: Number(i._sum.reservedKg ?? 0), cuarentena: Number(i._sum.quarantineKg ?? 0) };
  }).filter((x) => x.disponible + x.reservado + x.cuarentena > 0);

  const qualityAgg = await prisma.qualityInspection.aggregate({ where: { status: { in: ["APROBADO", "RECHAZADO", "CUARENTENA"] } }, _avg: { moisturePct: true, astaColor: true }, _count: true });
  const qc = Object.fromEntries(lotsByQuality.map((q) => [q.qualityStatus, q._count]));
  const decided = (qc.APROBADO ?? 0) + (qc.RECHAZADO ?? 0) + (qc.CUARENTENA ?? 0);

  const recent = await prisma.auditLog.findMany({ where: { action: { notIn: ["LOGIN", "LOGOUT", "LOGIN_FALLIDO", "ACCESO_DENEGADO"] } }, orderBy: { id: "desc" }, take: 10, include: { user: { select: { name: true } } } });

  const alerts: any[] = await inventoryAlerts();
  const soon = new Date(Date.now() + 7 * 86400000);
  for (const a of await prisma.smartAgreement.findMany({ where: { status: { in: ["PROPUESTO", "ACEPTADO", "FONDEADO"] }, deadline: { lte: soon } } })) {
    alerts.push({ level: "warning", type: "CONTRATO", message: `Acuerdo ${a.code}: fecha límite ${a.deadline.toISOString().slice(0, 10)}`, ref: a.code });
  }
  for (const a of await prisma.smartAgreement.findMany({ where: { status: "EN_DISPUTA" } })) alerts.push({ level: "danger", type: "CONTRATO", message: `Acuerdo ${a.code} en disputa`, ref: a.code });
  const overdue = await prisma.accountReceivable.count({ where: { status: { not: "COBRADO" }, dueDate: { lt: now } } });
  if (overdue) alerts.push({ level: "warning", type: "COBRANZA", message: `${overdue} cuenta(s) por cobrar vencida(s)` });
  const failed = txByStatus.find((t) => t.status === "FALLIDA")?._count ?? 0;

  const salesMonthPen = salesMonth.reduce((s, o) => s + Number(o.total) * Number(o.exchangeRate), 0);
  const overview = await managementOverview(now, hasPerm(_req, "hr.sensitive"));
  res.json({
    demoData: true,
    overview,
    kpis: {
      produccionTotalKg: Number(prodTotal._sum.quantityKg ?? 0),
      stockDisponibleKg: Number(ptBalances._sum.availableKg ?? 0), stockReservadoKg: Number(ptBalances._sum.reservedKg ?? 0), stockCuarentenaKg: Number(ptBalances._sum.quarantineKg ?? 0),
      lotesActivos: activeLots, lotesAprobados: qc.APROBADO ?? 0, lotesRechazados: qc.RECHAZADO ?? 0, lotesCuarentena: qc.CUARENTENA ?? 0, lotesPendientes: (qc.PENDIENTE ?? 0) + (qc.EN_EVALUACION ?? 0),
      ventasMesPen: salesMonthPen, costoProduccionMes: Number(costMonth._sum.totalCost ?? 0), costoProduccionAnio: Number(costYear._sum.totalCost ?? 0),
      costoPorKgAnio: Number(costYear._sum.finalWeightKg ?? 0) ? Number(costYear._sum.totalCost ?? 0) / Number(costYear._sum.finalWeightKg) : 0,
      ingresosAnioPen: revenueYear, costoVentasAnioPen: cogsYear, margenBrutoPen: revenueYear - cogsYear, margenBrutoPct: revenueYear ? ((revenueYear - cogsYear) / revenueYear) * 100 : 0,
      pedidosPendientes: pendingOrders, comprasPorAprobar: pendingPurchases, exportacionesEnProceso: exportsInProcess, contratosActivos: agreementsActive,
      txConfirmadas: txByStatus.find((t) => t.status === "CONFIRMADA")?._count ?? 0, txFallidas: failed,
    },
    series, inventory,
    quality: { byStatus: qc, approvalRatePct: decided ? ((qc.APROBADO ?? 0) / decided) * 100 : null, avgMoisturePct: qualityAgg._avg.moisturePct ? Number(qualityAgg._avg.moisturePct) : null, avgAsta: qualityAgg._avg.astaColor ? Number(qualityAgg._avg.astaColor) : null, inspections: qualityAgg._count },
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt, user: r.user?.name ?? "Sistema", action: r.action, entity: r.entity, entityId: r.entityId, details: r.details })),
    alerts,
  });
}));

/** Búsqueda global (barra superior). */
dashboardRouter.get("/search", requirePerm("dashboard.read"), ah(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  const c = { contains: q, mode: "insensitive" as const };
  const [lots, orders, customers, campaigns, agreements] = await Promise.all([
    prisma.lot.findMany({ where: { code: c }, take: 5, select: { code: true, type: true } }),
    prisma.salesOrder.findMany({ where: { code: c }, take: 5, select: { id: true, code: true } }),
    prisma.customer.findMany({ where: { name: c }, take: 5, select: { id: true, name: true } }),
    prisma.campaign.findMany({ where: { code: c }, take: 5, select: { id: true, code: true } }),
    prisma.smartAgreement.findMany({ where: { code: c }, take: 5, select: { code: true } }),
  ]);
  res.json([
    ...lots.map((l) => ({ type: "Lote", label: l.code, href: `/inventario/lotes/${l.code}` })),
    ...orders.map((o) => ({ type: "Pedido", label: o.code, href: `/ventas/pedidos/${o.id}` })),
    ...customers.map((x) => ({ type: "Cliente", label: x.name, href: `/ventas?tab=clientes&q=${encodeURIComponent(x.name)}` })),
    ...campaigns.map((x) => ({ type: "Campaña", label: x.code, href: `/agricultura/campanas/${x.id}` })),
    ...agreements.map((x) => ({ type: "Smart Contract", label: x.code, href: `/blockchain/acuerdos/${x.code}` })),
  ]);
}));

const SHIPPED = ["EMBARCADA", "EN_TRANSITO", "ENTREGADA", "COBRADA"] as const;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);

/** Vista gerencial (diseño del panel de Gerencia): tendencias, cadena productiva, exportaciones y estado por área. */
async function managementOverview(now: Date, canSeePayroll: boolean) {
  const from6 = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [fin, prod, sales, exportsAll, harvested, finishedLots, consumed, completedOrders, customers, workers, campaigns] = await Promise.all([
    prisma.financialTransaction.findMany({ where: { date: { gte: new Date(now.getFullYear(), now.getMonth() - 6, 1) } }, select: { date: true, type: true, amountPen: true } }),
    prisma.productionOrder.findMany({ where: { status: "COMPLETADA", endDate: { gte: new Date(now.getFullYear(), now.getMonth() - 6, 1) } }, select: { endDate: true, finalWeightKg: true } }),
    prisma.salesOrder.findMany({ where: { status: { not: "ANULADO" }, date: { gte: new Date(now.getFullYear(), now.getMonth() - 6, 1) } }, select: { date: true, totalKg: true, total: true, exchangeRate: true } }),
    prisma.exportOrder.findMany({ where: { status: { not: "ANULADA" } }, include: { customer: { select: { name: true } } } }),
    prisma.harvest.aggregate({ _sum: { quantityKg: true } }),
    prisma.lot.aggregate({ where: { type: "PRODUCTO_TERMINADO" }, _sum: { quantityKg: true } }),
    prisma.inventoryReservation.aggregate({ where: { status: "CONSUMIDA" }, _sum: { quantityKg: true } }),
    prisma.productionOrder.aggregate({ where: { status: "COMPLETADA" }, _sum: { initialWeightKg: true, finalWeightKg: true } }),
    prisma.customer.groupBy({ by: ["type"], where: { active: true }, _count: true }),
    prisma.worker.findMany({ where: { active: true }, select: { monthlySalary: true, area: { select: { code: true } } } }),
    prisma.marketingCampaign.findMany(),
  ]);
  const months = Array.from({ length: 6 }, (_, i) => monthKey(new Date(from6.getFullYear(), from6.getMonth() + i, 1)));
  const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), curKey = monthKey(now);
  const byMonth = (key: string) => {
    const f = fin.filter((t) => monthKey(t.date) === key);
    const ing = f.filter((t) => t.type === "INGRESO").reduce((s, t) => s + Number(t.amountPen), 0);
    const egr = f.filter((t) => t.type === "EGRESO").reduce((s, t) => s + Number(t.amountPen), 0);
    const exp = exportsAll.filter((e) => e.etd && monthKey(e.etd) === key && (SHIPPED as readonly string[]).includes(e.status));
    return {
      key, ingresos: ing, egresos: egr, resultado: ing - egr,
      produccionKg: prod.filter((o) => o.endDate && monthKey(o.endDate) === key).reduce((s, o) => s + Number(o.finalWeightKg ?? 0), 0),
      ventasNacKg: sales.filter((o) => monthKey(o.date) === key).reduce((s, o) => s + Number(o.totalKg), 0),
      ventasPen: sales.filter((o) => monthKey(o.date) === key).reduce((s, o) => s + Number(o.total) * Number(o.exchangeRate), 0),
      exportKg: exp.reduce((s, e) => s + Number(e.netWeightKg), 0),
      exportUsd: exp.reduce((s, e) => s + Number(e.amount) * (e.currency === "USD" ? 1 : 0), 0),
    };
  };
  const series = months.map(byMonth);
  const cur = byMonth(curKey), prev = byMonth(prevKey);
  const byCountry = new Map<string, number>();
  for (const e of exportsAll) if (e.currency === "USD") byCountry.set(e.destinationCountry, (byCountry.get(e.destinationCountry) ?? 0) + Number(e.amount));
  const exportedKg = exportsAll.filter((e) => (SHIPPED as readonly string[]).includes(e.status)).reduce((s, e) => s + Number(e.netWeightKg), 0);
  const activeWorkers = workers.length;
  const headcount: Record<string, number> = {};
  for (const w of workers) headcount[w.area.code] = (headcount[w.area.code] ?? 0) + 1;
  const leadsByChannel = new Map<string, number>();
  for (const c of campaigns) leadsByChannel.set(c.channel, (leadsByChannel.get(c.channel) ?? 0) + c.leads);
  const cash = await prisma.financialTransaction.groupBy({ by: ["type"], _sum: { amountPen: true } });
  const cashPen = Number(cash.find((c) => c.type === "INGRESO")?._sum.amountPen ?? 0) - Number(cash.find((c) => c.type === "EGRESO")?._sum.amountPen ?? 0);
  return {
    month: curKey,
    current: cur,
    trends: { ingresos: pct(cur.ingresos, prev.ingresos), resultado: pct(cur.resultado, prev.resultado), exportUsd: pct(cur.exportUsd, prev.exportUsd), produccionKg: pct(cur.produccionKg, prev.produccionKg) },
    series,
    exportsByCountry: [...byCountry.entries()].map(([country, usd]) => ({ country, usd })).sort((a, b) => b.usd - a.usd),
    exportPipelineUsd: [...byCountry.values()].reduce((s, v) => s + v, 0),
    upcomingShipments: exportsAll.filter((e) => !["ENTREGADA", "COBRADA"].includes(e.status)).sort((a, b) => (a.etd?.getTime() ?? Infinity) - (b.etd?.getTime() ?? Infinity)).slice(0, 4)
      .map((e) => ({ id: e.id, code: e.code, customer: e.customer.name, country: e.destinationCountry, etd: e.etd, amount: Number(e.amount), currency: e.currency, status: e.status })),
    funnel: {
      cosechadoKg: Number(harvested._sum.quantityKg ?? 0), procesadoKg: Number(finishedLots._sum.quantityKg ?? 0),
      ventaNacionalKg: Number(consumed._sum.quantityKg ?? 0), exportadoKg: exportedKg,
      rendimientoSecadoPct: Number(completedOrders._sum.initialWeightKg ?? 0) ? (Number(completedOrders._sum.finalWeightKg ?? 0) / Number(completedOrders._sum.initialWeightKg)) * 100 : null,
    },
    customers: { active: customers.reduce((s, c) => s + c._count, 0), international: customers.find((c) => c.type === "INTERNACIONAL")?._count ?? 0 },
    workers: { active: activeWorkers, payrollPen: canSeePayroll ? workers.reduce((s, w) => s + Number(w.monthlySalary), 0) : null, headcount },
    marketing: {
      leads: campaigns.reduce((s, c) => s + c.leads, 0), active: campaigns.filter((c) => c.status === "ACTIVA").length,
      leadsByChannel: [...leadsByChannel.entries()].map(([channel, leads]) => ({ channel, leads })).sort((a, b) => b.leads - a.leads),
    },
    cashPen,
  };
}

/** Organigrama: colaboradores activos por área (sin datos personales). */
dashboardRouter.get("/org", requirePerm("dashboard.read"), ah(async (_req, res) => {
  const [areas, rows, gm] = await Promise.all([
    prisma.area.findMany({ orderBy: { id: "asc" } }),
    prisma.worker.groupBy({ by: ["areaId"], where: { active: true }, _count: true }),
    prisma.worker.findFirst({ where: { active: true, area: { code: "GER" }, firstName: { not: null } }, select: { firstName: true, lastName: true, position: true } }),
  ]);
  res.json({
    areas: areas.map((a) => ({ code: a.code, name: a.name, projected: a.projected, headcount: rows.find((r) => r.areaId === a.id)?._count ?? 0 })),
    generalManager: gm ? `${gm.firstName ?? ""} ${gm.lastName ?? ""}`.trim() : null,
  });
}));

type ModKpi = { tone: "green" | "red" | "amber" | "blue"; icon: string; label: string; value: number | string; unit?: "kg" | "pen" | "usd" | "pct" | "num"; hint: string };
const MODULE_PERM: Record<string, string> = {
  agricultura: "agri.read", produccion: "production.read", calidad: "quality.read", ventas: "sales.read",
  compras: "purchases.read", logistica: "logistics.read", exportaciones: "exports.read",
};

/** KPIs de cabecera de cada módulo (tarjetas de colores del panel), calculados desde la base. */
dashboardRouter.get("/kpis/:module", requirePerm("dashboard.read"), ah(async (req, res) => {
  const m = req.params.module;
  const perm = MODULE_PERM[m];
  if (!perm) return res.status(404).json({ error: "Módulo sin indicadores" });
  if (!hasPerm(req, perm)) return res.status(403).json({ error: `Requiere ${perm}` });
  let k: ModKpi[] = [];
  if (m === "agricultura") {
    const [h, nH, camps, parcels] = await Promise.all([
      prisma.harvest.aggregate({ _sum: { quantityKg: true } }), prisma.harvest.count(),
      prisma.campaign.groupBy({ by: ["status"], _count: true }), prisma.parcel.findMany({ where: { status: { not: "INACTIVA" } } }),
    ]);
    const c = (s: string) => camps.find((x) => x.status === s)?._count ?? 0;
    k = [
      { tone: "green", icon: "sprout", label: "Cosecha acumulada", value: Number(h._sum.quantityKg ?? 0), unit: "kg", hint: "Pimentón fresco" },
      { tone: "amber", icon: "calendar", label: "Cosechas registradas", value: nH, unit: "num", hint: `${c("EN_CURSO") + c("PLANIFICADA")} campañas en curso o planificadas` },
      { tone: "blue", icon: "layers", label: "Campañas", value: camps.reduce((s, x) => s + x._count, 0), unit: "num", hint: `${c("COSECHADA")} cosechadas` },
      { tone: "red", icon: "leaf", label: "Parcelas", value: parcels.length, unit: "num", hint: `${parcels.reduce((s, p) => s + Number(p.areaHa), 0).toFixed(1)} ha en producción o descanso` },
    ];
  } else if (m === "produccion") {
    const [done, byStatus] = await Promise.all([
      prisma.productionOrder.aggregate({ where: { status: "COMPLETADA" }, _sum: { finalWeightKg: true, initialWeightKg: true, totalCost: true } }),
      prisma.productionOrder.groupBy({ by: ["status"], _count: true }),
    ]);
    const c = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
    const fin = Number(done._sum.finalWeightKg ?? 0), ini = Number(done._sum.initialWeightKg ?? 0);
    k = [
      { tone: "green", icon: "factory", label: "Producción acumulada", value: fin, unit: "kg", hint: "Páprika procesada" },
      { tone: "amber", icon: "check", label: "Órdenes completadas", value: c("COMPLETADA"), unit: "num", hint: `${c("EN_PROCESO")} en proceso` },
      { tone: "blue", icon: "trend", label: "Rendimiento de secado", value: ini ? (fin / ini) * 100 : 0, unit: "pct", hint: "Fresco a páprika (demo)" },
      { tone: "red", icon: "coins", label: "Costo promedio", value: fin ? Number(done._sum.totalCost ?? 0) / fin : 0, unit: "pen", hint: "Por kg producido" },
    ];
  } else if (m === "calidad") {
    const [decided, agg, pending] = await Promise.all([
      prisma.qualityInspection.groupBy({ by: ["status"], where: { status: { in: ["APROBADO", "RECHAZADO", "CUARENTENA"] } }, _count: true }),
      prisma.qualityInspection.aggregate({ where: { status: { in: ["APROBADO", "RECHAZADO", "CUARENTENA"] } }, _avg: { moisturePct: true, astaColor: true } }),
      prisma.lot.count({ where: { type: "PRODUCTO_TERMINADO", qualityStatus: { in: ["PENDIENTE", "EN_EVALUACION"] } } }),
    ]);
    const c = (s: string) => decided.find((x) => x.status === s)?._count ?? 0;
    const total = c("APROBADO") + c("RECHAZADO") + c("CUARENTENA");
    k = [
      { tone: "green", icon: "check", label: "Lotes aprobados", value: total ? (c("APROBADO") / total) * 100 : 0, unit: "pct", hint: `${c("APROBADO")} de ${total} analizados` },
      { tone: "blue", icon: "flask", label: "Humedad promedio", value: Number(agg._avg.moisturePct ?? 0), unit: "pct", hint: "Según especificación configurada" },
      { tone: "amber", icon: "tag", label: "Color ASTA promedio", value: Math.round(Number(agg._avg.astaColor ?? 0)), unit: "num", hint: "Intensidad de color" },
      { tone: "red", icon: "alert", label: "Observados", value: c("RECHAZADO") + c("CUARENTENA"), unit: "num", hint: `${pending} lote(s) por evaluar` },
    ];
  } else if (m === "ventas") {
    const orders = await prisma.salesOrder.findMany({ where: { status: { not: "ANULADO" } }, select: { total: true, exchangeRate: true, status: true, totalKg: true } });
    const t = orders.reduce((s, o) => s + Number(o.total) * Number(o.exchangeRate), 0);
    k = [
      { tone: "amber", icon: "cart", label: "Ventas acumuladas", value: t, unit: "pen", hint: `${Math.round(orders.reduce((s, o) => s + Number(o.totalKg), 0) / 25)} sacos vendidos` },
      { tone: "green", icon: "check", label: "Pedidos", value: orders.length, unit: "num", hint: `${orders.filter((o) => ["ENTREGADO", "COMPLETADO"].includes(o.status)).length} entregados` },
      { tone: "blue", icon: "money", label: "Ticket promedio", value: orders.length ? t / orders.length : 0, unit: "pen", hint: "Por pedido" },
      { tone: "red", icon: "alert", label: "Por atender", value: orders.filter((o) => ["REGISTRADO", "RESERVADO", "DESPACHADO"].includes(o.status)).length, unit: "num", hint: "Registrados, reservados o en despacho" },
    ];
  } else if (m === "compras") {
    const [pos, suppliers, review, ap] = await Promise.all([
      prisma.purchaseOrder.findMany({ where: { status: { not: "ANULADA" } }, select: { total: true, exchangeRate: true } }), prisma.supplier.count({ where: { active: true } }),
      prisma.purchaseRequest.count({ where: { status: "EN_REVISION" } }), prisma.accountPayable.findMany({ where: { status: { not: "PAGADA" } } }),
    ]);
    k = [
      { tone: "red", icon: "truck", label: "Compras acumuladas", value: pos.reduce((s, p) => s + Number(p.total) * Number(p.exchangeRate), 0), unit: "pen", hint: `${pos.length} órdenes de compra` },
      { tone: "green", icon: "users", label: "Proveedores", value: suppliers, unit: "num", hint: "Activos" },
      { tone: "amber", icon: "alert", label: "Por aprobar", value: review, unit: "num", hint: "Solicitudes en revisión de Gerencia" },
      { tone: "blue", icon: "money", label: "Cuentas por pagar", value: ap.reduce((s, a) => s + (Number(a.amount) - Number(a.paidAmount)) * Number(a.exchangeRate), 0), unit: "pen", hint: `${ap.length} pendiente(s)` },
    ];
  } else if (m === "logistica") {
    const d = await prisma.dispatchOrder.findMany({ select: { status: true, weightKg: true } });
    const c = (s: string[]) => d.filter((x) => s.includes(x.status)).length;
    k = [
      { tone: "green", icon: "truck", label: "Despachos", value: d.length, unit: "num", hint: "Órdenes registradas" },
      { tone: "amber", icon: "calendar", label: "En preparación o tránsito", value: c(["PREPARACION", "DESPACHADO", "EN_TRANSITO"]), unit: "num", hint: "Por entregar" },
      { tone: "blue", icon: "check", label: "Entregados", value: c(["ENTREGADO", "CONFORME"]), unit: "num", hint: `${c(["CONFORME"])} con conformidad` },
      { tone: "red", icon: "box", label: "Peso despachado", value: d.reduce((s, x) => s + Number(x.weightKg), 0), unit: "kg", hint: "Acumulado" },
    ];
  } else if (m === "exportaciones") {
    const e = await prisma.exportOrder.findMany({ where: { status: { not: "ANULADA" } }, include: { requirements: true } });
    const usdTotal = e.filter((x) => x.currency === "USD").reduce((s, x) => s + Number(x.amount), 0);
    k = [
      { tone: "green", icon: "globe", label: "Valor en cartera", value: usdTotal, unit: "usd", hint: `≈ S/ ${Math.round(e.reduce((s, x) => s + Number(x.amount) * Number(x.exchangeRate), 0)).toLocaleString("es-PE")}` },
      { tone: "red", icon: "ship", label: "Volumen", value: e.reduce((s, x) => s + Number(x.netWeightKg), 0), unit: "kg", hint: `${e.length} órdenes internacionales` },
      { tone: "blue", icon: "tag", label: "Países destino", value: new Set(e.map((x) => x.destinationCountry)).size, unit: "num", hint: "Mercados" },
      { tone: "amber", icon: "alert", label: "Docs. pendientes", value: e.reduce((s, x) => s + x.requirements.filter((r) => r.mandatory && !["VERIFICADO", "NO_APLICA"].includes(r.status)).length, 0), unit: "num", hint: "Requisitos sin evidencia verificada" },
    ];
  }
  res.json(k);
}));
