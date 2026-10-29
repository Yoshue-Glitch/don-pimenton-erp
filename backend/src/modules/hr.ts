import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm, hasPerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { unprocessable } from "../lib/errors";

export const hrRouter = Router();

/** Enmascara datos personales y remuneraciones si el usuario no tiene hr.sensitive. */
function mask(w: any, req: any) {
  if (hasPerm(req, "hr.sensitive")) return w;
  return { ...w, documentNumber: w.documentNumber ? "••••" + String(w.documentNumber).slice(-2) : null, phone: w.phone ? "•••••••" : null, email: w.email ? "•••@•••" : null, monthlySalary: null, _masked: true };
}

hrRouter.use("/workers", crud({
  model: "worker", entity: "trabajador", readPerm: "hr.read", writePerm: "hr.write",
  schema: z.object({
    code: z.string().max(20).optional(),
    // el nombre es opcional: los puestos se identifican por cargo y área
    firstName: z.string().min(2).max(60).nullable().optional().or(z.literal("")), lastName: z.string().min(2).max(80).nullable().optional().or(z.literal("")),
    documentNumber: z.string().regex(/^\d{8,12}$/, "Documento inválido"), phone: z.string().max(30).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal("")),
    areaId: z.coerce.number().int().positive(), position: z.string().min(2).max(80), hireDate: z.coerce.date(),
    contractType: z.enum(["INDEFINIDO", "PLAZO_FIJO", "TEMPORAL_COSECHA", "LOCACION_SERVICIOS"]), monthlySalary: z.coerce.number().min(0),
    isTemporary: z.boolean().default(false), active: z.boolean().default(true),
  }),
  search: ["code", "firstName", "lastName", "position"], filters: ["areaId", "isTemporary", "active", "contractType"], orderBy: { code: "asc" },
  include: { area: { select: { name: true } } }, transform: mask,
  codePrefix: { field: "code", prefix: "TRB", year: false, pad: 4 },
}));

hrRouter.get("/attendance", requirePerm("hr.read"), ah(async (req, res) => {
  const date = req.query.date ? new Date(String(req.query.date)) : undefined;
  res.json(await prisma.attendance.findMany({ where: date ? { date } : {}, orderBy: [{ date: "desc" }], take: 300, include: { worker: { select: { code: true, firstName: true, lastName: true, position: true } } } }));
}));

hrRouter.post("/attendance", requirePerm("hr.write"), ah(async (req, res) => {
  const input = parse(z.object({ workerId: z.coerce.number().int().positive(), date: z.coerce.date(), status: z.enum(["PRESENTE", "TARDANZA", "FALTA", "PERMISO", "VACACIONES"]), hours: z.coerce.number().min(0).max(16).default(8) }), req.body);
  const a = await prisma.attendance.upsert({ where: { workerId_date: { workerId: input.workerId, date: input.date } }, create: input, update: input });
  res.status(201).json(a);
}));

hrRouter.get("/leaves", requirePerm("hr.read"), ah(async (_req, res) => {
  res.json(await prisma.leaveRequest.findMany({ orderBy: { startDate: "desc" }, include: { worker: { select: { code: true, firstName: true, lastName: true, position: true } } } }));
}));

hrRouter.post("/leaves", requirePerm("hr.write"), ah(async (req, res) => {
  const input = parse(z.object({ workerId: z.coerce.number().int().positive(), type: z.enum(["VACACIONES", "PERMISO", "LICENCIA"]), startDate: z.coerce.date(), endDate: z.coerce.date(), notes: z.string().max(300).optional() }), req.body);
  if (input.endDate < input.startDate) throw unprocessable("La fecha final debe ser posterior a la inicial");
  const days = Math.round((+input.endDate - +input.startDate) / 86400000) + 1;
  res.status(201).json(await prisma.leaveRequest.create({ data: { ...input, days } }));
}));

hrRouter.post("/leaves/:id/decision", requirePerm("hr.write"), ah(async (req, res) => {
  const { approve } = parse(z.object({ approve: z.boolean() }), req.body);
  const l = await prisma.leaveRequest.update({ where: { id: idParam(req) }, data: { status: approve ? "APROBADO" : "RECHAZADO" } });
  await audit(prisma, req.user!.id, approve ? "APROBAR_VACACIONES" : "RECHAZAR_VACACIONES", "trabajador", l.workerId, {});
  res.json(l);
}));

hrRouter.get("/trainings", requirePerm("hr.read"), ah(async (_req, res) => {
  res.json(await prisma.training.findMany({ orderBy: { date: "desc" }, include: { participants: { include: { worker: { select: { firstName: true, lastName: true, position: true } } } } } }));
}));

hrRouter.post("/trainings", requirePerm("hr.write"), ah(async (req, res) => {
  const input = parse(z.object({ title: z.string().min(3).max(150), date: z.coerce.date(), hours: z.coerce.number().positive(), provider: z.string().max(100).optional(), topic: z.string().max(100).optional(), workerIds: z.array(z.coerce.number().int().positive()).default([]) }), req.body);
  const { workerIds, ...data } = input;
  res.status(201).json(await prisma.training.create({ data: { ...data, participants: { create: workerIds.map((workerId) => ({ workerId })) } } }));
}));

hrRouter.get("/evaluations", requirePerm("hr.read"), ah(async (_req, res) => {
  res.json(await prisma.evaluation.findMany({ orderBy: { period: "desc" }, include: { worker: { select: { firstName: true, lastName: true, position: true } } } }));
}));

hrRouter.post("/evaluations", requirePerm("hr.write"), ah(async (req, res) => {
  const input = parse(z.object({ workerId: z.coerce.number().int().positive(), period: z.string().min(4).max(20), score: z.coerce.number().min(0).max(20), evaluator: z.string().min(2).max(100), comments: z.string().max(500).optional() }), req.body);
  res.status(201).json(await prisma.evaluation.create({ data: input }));
}));

/** Costos laborales por área (requiere permiso de datos sensibles). */
hrRouter.get("/labor-costs", requirePerm("hr.sensitive"), ah(async (_req, res) => {
  const workers = await prisma.worker.findMany({ where: { active: true }, include: { area: true } });
  const byArea = new Map<string, { area: string; workers: number; temporary: number; monthlyCost: number }>();
  for (const w of workers) {
    const e = byArea.get(w.area.name) ?? { area: w.area.name, workers: 0, temporary: 0, monthlyCost: 0 };
    e.workers++; if (w.isTemporary) e.temporary++;
    e.monthlyCost += Number(w.monthlySalary);
    byArea.set(w.area.name, e);
  }
  res.json({ areas: [...byArea.values()], note: "Remuneración bruta mensual registrada. No incluye cargas sociales ni beneficios: requieren configuración laboral especializada." });
}));

hrRouter.get("/summary", requirePerm("hr.read"), ah(async (_req, res) => {
  const [total, temporary, pendingLeaves, trainings] = await Promise.all([
    prisma.worker.count({ where: { active: true } }), prisma.worker.count({ where: { active: true, isTemporary: true } }),
    prisma.leaveRequest.count({ where: { status: "PENDIENTE" } }), prisma.training.count(),
  ]);
  res.json({ total, temporary, pendingLeaves, trainings });
}));

