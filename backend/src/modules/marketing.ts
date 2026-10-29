import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";

export const marketingRouter = Router();

export const CHANNELS = ["Instagram", "Facebook", "LinkedIn", "Email", "Web", "Feria"];

/** Indicadores: inversión ejecutada, leads, costo por lead y leads por canal. */
marketingRouter.get("/summary", requirePerm("marketing.read"), ah(async (_req, res) => {
  const rows = await prisma.marketingCampaign.findMany();
  const executed = rows.filter((r) => r.status !== "PLANIFICADA");
  const investment = executed.reduce((s, r) => s + Number(r.budgetPen), 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0);
  const byChannel = new Map<string, { channel: string; leads: number; investment: number }>();
  for (const r of rows) {
    const e = byChannel.get(r.channel) ?? { channel: r.channel, leads: 0, investment: 0 };
    e.leads += r.leads;
    if (r.status !== "PLANIFICADA") e.investment += Number(r.budgetPen);
    byChannel.set(r.channel, e);
  }
  res.json({
    investment, leads, costPerLead: leads ? investment / leads : null,
    active: rows.filter((r) => r.status === "ACTIVA").length, planned: rows.filter((r) => r.status === "PLANIFICADA").length,
    byChannel: [...byChannel.values()].sort((a, b) => b.leads - a.leads),
  });
}));

marketingRouter.use("/campaigns", crud({
  model: "marketingCampaign", entity: "campaña_marketing", readPerm: "marketing.read", writePerm: "marketing.write",
  schema: z.object({
    code: z.string().max(20).optional(),
    name: z.string().min(3).max(150),
    channel: z.enum(CHANNELS as [string, ...string[]]),
    startDate: z.coerce.date(),
    budgetPen: z.coerce.number().min(0),
    leads: z.coerce.number().int().min(0).default(0),
    status: z.enum(["PLANIFICADA", "ACTIVA", "FINALIZADA"]).default("PLANIFICADA"),
    notes: z.string().max(500).nullable().optional(),
  }),
  search: ["code", "name", "channel"], filters: ["status", "channel"], orderBy: { startDate: "desc" },
  codePrefix: { field: "code", prefix: "MKT", year: false, pad: 3 },
}));
