import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah, parse, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { D, round2 } from "../lib/decimal";
import { unprocessable } from "../lib/errors";

export const financeRouter = Router();

financeRouter.use("/budgets", crud({
  model: "budget", entity: "presupuesto", readPerm: "finance.read", writePerm: "finance.write",
  schema: z.object({ year: z.coerce.number().int().min(2020).max(2100), month: z.coerce.number().int().min(1).max(12), areaId: z.coerce.number().int().positive().nullable().optional(), category: z.string().min(2).max(60), type: z.enum(["INGRESO", "EGRESO"]), amountPen: z.coerce.number().min(0) }),
  filters: ["year", "type"], orderBy: [{ year: "desc" }, { month: "asc" }], include: { area: { select: { name: true } } },
}));

financeRouter.use("/exchange-rates", crud({
  model: "exchangeRate", entity: "tipo_cambio", readPerm: "finance.read", writePerm: "finance.write",
  schema: z.object({ date: z.coerce.date(), currency: z.enum(["USD"]), rate: z.coerce.number().positive().max(20), source: z.string().max(60).default("Manual (demo)") }),
  orderBy: { date: "desc" },
}));

financeRouter.get("/transactions", requirePerm("finance.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.type) where.type = req.query.type;
  if (req.query.category) where.category = req.query.category;
  if (q) where.OR = [{ code: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  const [items, total] = await Promise.all([
    prisma.financialTransaction.findMany({ where, skip, take, orderBy: [{ date: "desc" }, { id: "desc" }], include: { user: { select: { name: true } }, campaign: { select: { code: true } }, lot: { select: { code: true } } } }),
    prisma.financialTransaction.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

financeRouter.post("/transactions", requirePerm("finance.write"), ah(async (req, res) => {
  const input = parse(z.object({
    type: z.enum(["INGRESO", "EGRESO"]), category: z.string().min(2).max(60), date: z.coerce.date(), description: z.string().min(3).max(300),
    currency: z.enum(["PEN", "USD"]).default("PEN"), amount: z.coerce.number().positive(), exchangeRate: z.coerce.number().positive().optional(),
    campaignId: z.coerce.number().int().positive().nullable().optional(), lotId: z.coerce.number().int().positive().nullable().optional(),
  }), req.body);
  if (input.currency === "USD" && !input.exchangeRate) throw unprocessable("Las operaciones en USD requieren registrar el tipo de cambio utilizado");
  const fx = input.currency === "USD" ? input.exchangeRate! : 1;
  const t = await prisma.$transaction(async (tx) => {
    const created = await tx.financialTransaction.create({ data: { ...input, exchangeRate: fx, amountPen: round2(D(input.amount).times(fx)), code: await nextCode(tx, "FIN", input.date.getFullYear(), 5), referenceType: "MANUAL", userId: req.user!.id } });
    await audit(tx, req.user!.id, "CREAR", "transaccion_financiera", created.id, { type: input.type, amount: input.amount, currency: input.currency });
    return created;
  });
  res.status(201).json(t);
}));

/** Flujo de caja mensual (PEN) con presupuesto comparativo. */
financeRouter.get("/cash-flow", requirePerm("finance.read"), ah(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await prisma.$queryRaw<{ month: number; type: string; total: number }[]>`
    SELECT EXTRACT(MONTH FROM "date")::int AS month, "type"::text AS type, SUM("amountPen")::float AS total
    FROM "FinancialTransaction" WHERE EXTRACT(YEAR FROM "date") = ${year} GROUP BY 1, 2 ORDER BY 1`;
  const budgets = await prisma.budget.findMany({ where: { year } });
  let cumulative = 0;
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const inc = rows.find((r) => r.month === m && r.type === "INGRESO")?.total ?? 0;
    const exp = rows.find((r) => r.month === m && r.type === "EGRESO")?.total ?? 0;
    cumulative += inc - exp;
    return {
      month: m, ingresos: round2(inc).toNumber(), egresos: round2(exp).toNumber(), neto: round2(inc - exp).toNumber(), acumulado: round2(cumulative).toNumber(),
      presupuestoIngresos: budgets.filter((b) => b.month === m && b.type === "INGRESO").reduce((s, b) => s + Number(b.amountPen), 0),
      presupuestoEgresos: budgets.filter((b) => b.month === m && b.type === "EGRESO").reduce((s, b) => s + Number(b.amountPen), 0),
    };
  });
  res.json({ year, months });
}));

financeRouter.get("/campaign-costs", requirePerm("finance.read"), ah(async (_req, res) => {
  const camps = await prisma.campaign.findMany({ include: { activities: true, transactions: true, harvests: true, parcel: { select: { code: true, areaHa: true } } }, orderBy: { sowingDate: "desc" } });
  res.json(camps.map((c) => {
    const act = c.activities.reduce((s, a) => s + Number(a.cost), 0);
    const other = c.transactions.filter((t) => t.type === "EGRESO" && t.referenceType !== "AGRI_ACTIVITY").reduce((s, t) => s + Number(t.amountPen), 0);
    const kg = c.harvests.reduce((s, h) => s + Number(h.quantityKg), 0);
    return { code: c.code, parcel: c.parcel.code, variety: c.variety, status: c.status, harvestedKg: kg, activitiesCost: act, otherCost: other, totalCost: act + other, costPerKg: kg ? (act + other) / kg : null, costPerHa: (act + other) / Number(c.parcel.areaHa) };
  }));
}));

/** Rentabilidad por lote terminado: ingresos por ventas (sin impuesto) vs costo de producción. */
financeRouter.get("/lot-profitability", requirePerm("finance.read"), ah(async (_req, res) => {
  const lots = await prisma.lot.findMany({
    where: { type: "PRODUCTO_TERMINADO" }, orderBy: { productionDate: "desc" },
    include: { productionOrder: { select: { code: true, totalCost: true, finalWeightKg: true, yieldPct: true } }, reservations: { where: { status: "CONSUMIDA" }, include: { orderItem: { include: { order: true } } } } },
  });
  res.json(lots.map((l) => {
    let soldKg = 0, revenue = 0;
    for (const r of l.reservations) {
      const it = r.orderItem, o = it.order;
      const share = Number(r.quantityKg) / Number(it.quantityKg);
      const lineBase = o.priceIncludesTax ? Number(it.lineTotal) / (1 + Number(o.taxRate)) : Number(it.lineTotal);
      soldKg += Number(r.quantityKg); revenue += lineBase * share * Number(o.exchangeRate);
    }
    const cost = soldKg * Number(l.unitCost);
    return { code: l.code, productionDate: l.productionDate, quantityKg: Number(l.quantityKg), qualityStatus: l.qualityStatus, order: l.productionOrder?.code, yieldPct: l.productionOrder?.yieldPct, unitCost: Number(l.unitCost), lotCost: Number(l.productionOrder?.totalCost ?? 0) * (Number(l.quantityKg) / Number(l.productionOrder?.finalWeightKg ?? l.quantityKg)), soldKg, revenue: round2(revenue).toNumber(), costOfSales: round2(cost).toNumber(), grossMargin: round2(revenue - cost).toNumber(), marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null };
  }));
}));

financeRouter.get("/summary", requirePerm("finance.read"), ah(async (_req, res) => {
  const [ar, ap, inc, exp] = await Promise.all([
    prisma.accountReceivable.findMany({ where: { status: { not: "COBRADO" } } }),
    prisma.accountPayable.findMany({ where: { status: { not: "PAGADA" } } }),
    prisma.financialTransaction.aggregate({ where: { type: "INGRESO" }, _sum: { amountPen: true } }),
    prisma.financialTransaction.aggregate({ where: { type: "EGRESO" }, _sum: { amountPen: true } }),
  ]);
  const pen = (amount: any, collected: any, fx: any) => (Number(amount) - Number(collected)) * Number(fx);
  res.json({
    receivablesPen: ar.reduce((s, r) => s + pen(r.amount, r.collected, r.exchangeRate), 0),
    payablesPen: ap.reduce((s, r) => s + pen(r.amount, r.paidAmount, r.exchangeRate), 0),
    overdueReceivables: ar.filter((r) => r.dueDate < new Date()).length,
    totalIncomePen: Number(inc._sum.amountPen ?? 0), totalExpensePen: Number(exp._sum.amountPen ?? 0),
    disclaimer: "Información de gestión. La contabilidad y obligaciones tributarias reales requieren configuración y validación especializada antes de su uso en producción.",
  });
}));
