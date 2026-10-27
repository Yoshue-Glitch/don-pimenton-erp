import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { getAllSettings, DEFAULT_SETTINGS } from "../lib/settings";
import { forbidden, notFound, unprocessable } from "../lib/errors";
import { mapPrismaError } from "../lib/crud";

export const adminRouter = Router();

adminRouter.get("/settings", requirePerm("dashboard.read"), ah(async (_req, res) => res.json(await getAllSettings())));

const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "modules.enabled": z.record(z.boolean()),
  "inventory.dispatchPolicy": z.enum(["ON_DISPATCH", "ON_DELIVERY"]),
  "tax.rates": z.array(z.object({ code: z.string().min(2).max(10), name: z.string().min(2).max(80), rate: z.number().min(0).max(1) })).min(1),
  "tax.defaultCode": z.string(),
  "fx.defaultUsdPen": z.number().positive().max(20),
  "blockchain.penPerTestEth": z.number().positive(),
  "company.name": z.string().min(2), "company.city": z.string().min(2),
};

adminRouter.put("/settings/:key", requirePerm("settings.manage"), ah(async (req, res) => {
  const key = req.params.key;
  const schema = SETTING_SCHEMAS[key];
  if (!schema) throw notFound("Parámetro no configurable");
  let value = parse(schema, req.body?.value);
  if (key === "modules.enabled") {
    // los módulos del núcleo operativo no se pueden desactivar
    const core = ["agricultura", "produccion", "calidad", "inventario", "ventas"];
    value = { ...(DEFAULT_SETTINGS["modules.enabled"] as object), ...(value as object) };
    for (const c of core) if ((value as any)[c] === false) throw unprocessable(`El módulo ${c} es parte del núcleo operativo y no puede desactivarse`);
  }
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as any }, update: { value: value as any } });
  await audit(prisma, req.user!.id, "CONFIGURAR", "setting", key, { value });
  res.json({ key, value });
}));

adminRouter.get("/users", requirePerm("users.manage"), ah(async (_req, res) => {
  res.json(await prisma.user.findMany({ orderBy: { id: "asc" }, select: { id: true, email: true, name: true, active: true, lastLoginAt: true, lockedUntil: true, role: { select: { code: true, name: true } }, area: { select: { name: true } } } }));
}));

const strongPassword = z.string().min(10, "Mínimo 10 caracteres").regex(/[A-Z]/, "Incluya una mayúscula").regex(/[a-z]/, "Incluya una minúscula").regex(/\d/, "Incluya un número");

adminRouter.post("/users", requirePerm("users.manage"), ah(async (req, res) => {
  const input = parse(z.object({ email: z.string().email(), name: z.string().min(3).max(100), password: strongPassword, roleId: z.coerce.number().int().positive(), areaId: z.coerce.number().int().positive().nullable().optional() }), req.body);
  const u = await prisma.user.create({ data: { email: input.email.toLowerCase(), name: input.name, roleId: input.roleId, areaId: input.areaId, passwordHash: await bcrypt.hash(input.password, 12) }, select: { id: true, email: true, name: true } }).catch(mapPrismaError);
  await audit(prisma, req.user!.id, "CREAR", "usuario", u.id, { email: u.email, roleId: input.roleId });
  res.status(201).json(u);
}));

adminRouter.put("/users/:id", requirePerm("users.manage"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ name: z.string().min(3).max(100), roleId: z.coerce.number().int().positive(), active: z.boolean(), password: strongPassword, unlock: z.boolean() }).partial(), req.body);
  if (id === req.user!.id && input.active === false) throw forbidden("No puede desactivar su propio usuario");
  const { password, unlock, ...rest } = input;
  const data: any = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  if (unlock) { data.failedAttempts = 0; data.lockedUntil = null; }
  const u = await prisma.user.update({ where: { id }, data, select: { id: true, email: true, name: true, active: true } });
  if (input.active === false || password) await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(prisma, req.user!.id, "ACTUALIZAR", "usuario", id, { ...rest, passwordChanged: !!password, unlock });
  res.json(u);
}));

adminRouter.get("/roles", requirePerm("users.manage"), ah(async (_req, res) => {
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: "asc" }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { code: "asc" }] }),
  ]);
  res.json({ roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, users: r._count.users, permissions: r.permissions.map((p) => p.permission.code) })), permissions });
}));

adminRouter.put("/roles/:id/permissions", requirePerm("users.manage"), ah(async (req, res) => {
  const id = idParam(req);
  const { permissions } = parse(z.object({ permissions: z.array(z.string()) }), req.body);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw notFound();
  if (role.code === "ADMIN" && (!permissions.includes("users.manage") || !permissions.includes("settings.manage"))) throw unprocessable("El rol Administrador debe conservar la gestión de usuarios y configuración");
  if (role.code === "AUDITOR" && permissions.some((p) => !p.endsWith(".read") && p !== "audit.read")) throw unprocessable("El rol Auditor es de solo lectura");
  const perms = await prisma.permission.findMany({ where: { code: { in: permissions } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
  ]);
  await audit(prisma, req.user!.id, "CAMBIAR_PERMISOS", "rol", id, { role: role.code, permissions });
  res.json({ ok: true, count: perms.length });
}));

adminRouter.get("/areas", requirePerm("dashboard.read"), ah(async (_req, res) => res.json(await prisma.area.findMany({ orderBy: { id: "asc" } }))));

adminRouter.get("/audit", requirePerm("audit.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.entity) where.entity = req.query.entity;
  if (req.query.userId) where.userId = Number(req.query.userId);
  if (q) where.OR = [{ action: { contains: q, mode: "insensitive" } }, { entity: { contains: q, mode: "insensitive" } }, { entityId: { contains: q, mode: "insensitive" } }];
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { id: "desc" }, include: { user: { select: { name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));
