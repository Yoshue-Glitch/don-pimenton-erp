import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ah } from "../lib/http";
import { requirePerm } from "../auth/auth";
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
  res.json({
    demoData: true,
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
