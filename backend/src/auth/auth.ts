import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah, parse } from "../lib/http";
import { AppError, forbidden } from "../lib/errors";
import { audit } from "../lib/audit";
import { config } from "../config";
import { sha256Hex } from "../lib/hash";
import { getSetting } from "../lib/settings";

export interface AuthUser { id: number; email: string; name: string; role: string; roleName: string; permissions: Set<string>; }

declare global {
  namespace Express { interface Request { user?: AuthUser } }
}

async function loadUser(userId: number): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  if (!u || !u.active) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role.code, roleName: u.role.name, permissions: new Set(u.role.permissions.map((rp) => rp.permission.code)) };
}

/** Autenticación por cookie httpOnly con token opaco (solo se guarda su hash). */
export const authenticate = ah(async (req, _res, next) => {
  const token = req.cookies?.[config.cookieName] || (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (token) {
    const s = await prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (s && !s.revokedAt && s.expiresAt > new Date()) {
      const user = await loadUser(s.userId);
      if (user) req.user = user;
    }
  }
  next();
});

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, "Sesión no válida o expirada", "UNAUTHENTICATED"));
  next();
}

export const requirePerm = (...perms: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError(401, "Sesión no válida o expirada", "UNAUTHENTICATED"));
  const missing = perms.filter((p) => !req.user!.permissions.has(p));
  if (missing.length) {
    audit(prisma, req.user.id, "ACCESO_DENEGADO", "permission", missing.join(","), { path: req.originalUrl, method: req.method }, req.ip).catch(() => {});
    return next(forbidden(`No tiene permisos para esta operación (${missing.join(", ")})`));
  }
  next();
};

export const hasPerm = (req: Request, p: string) => !!req.user?.permissions.has(p);

/** Mitigación CSRF: las peticiones que modifican datos deben incluir una cabecera personalizada. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.headers["x-requested-with"] !== "DonPimentonERP" && !req.headers.authorization) {
    return next(new AppError(403, "Petición rechazada (falta cabecera anti-CSRF)", "CSRF"));
  }
  next();
}

const MODULE_PERMS: Record<string, string> = {
  agricultura: "agri.read", produccion: "production.read", calidad: "quality.read", inventario: "inventory.read",
  compras: "purchases.read", ventas: "sales.read", logistica: "logistics.read", finanzas: "finance.read",
  blockchain: "blockchain.read", exportaciones: "exports.read", rrhh: "hr.read",
};

/** Bloquea las rutas de un módulo desactivado en Configuración. */
export const requireModule = (module: string) => ah(async (_req, _res, next) => {
  const enabled = await getSetting<Record<string, boolean>>("modules.enabled");
  if (enabled && enabled[module] === false) throw new AppError(403, `El módulo "${module}" está desactivado en la configuración`, "MODULE_DISABLED");
  next();
});

export const authRouter = Router();

authRouter.post("/login", ah(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
  const u = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const generic = new AppError(401, "Correo o contraseña incorrectos", "INVALID_CREDENTIALS");
  if (!u || !u.active) { await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv"); throw generic; }
  if (u.lockedUntil && u.lockedUntil > new Date()) throw new AppError(423, "Cuenta bloqueada temporalmente por intentos fallidos. Intente más tarde.", "LOCKED");
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    const attempts = u.failedAttempts + 1;
    await prisma.user.update({ where: { id: u.id }, data: { failedAttempts: attempts, lockedUntil: attempts >= config.maxLoginAttempts ? new Date(Date.now() + config.lockMinutes * 60000) : null } });
    await audit(prisma, u.id, "LOGIN_FALLIDO", "user", u.id, { attempts }, req.ip);
    throw generic;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600000);
  await prisma.session.create({ data: { userId: u.id, tokenHash: sha256Hex(token), expiresAt, ip: req.ip, userAgent: String(req.headers["user-agent"] || "").slice(0, 250) } });
  await prisma.user.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit(prisma, u.id, "LOGIN", "user", u.id, {}, req.ip);
  res.cookie(config.cookieName, token, { httpOnly: true, sameSite: "lax", secure: config.secureCookies, expires: expiresAt, path: "/" });
  const user = await loadUser(u.id);
  res.json({ user: serializeUser(user!), token: req.headers["x-return-token"] === "1" ? token : undefined });
}));

/** Pista de acceso de la pantalla de login: solo muestra la contraseña si es la documentada. */
authRouter.get("/demo-info", (_req, res) => {
  res.json({ showPassword: !process.env.DEMO_PASSWORD, password: process.env.DEMO_PASSWORD ? null : "DonPimenton#2026" });
});

authRouter.post("/logout", ah(async (req, res) => {
  const token = req.cookies?.[config.cookieName];
  if (token) await prisma.session.updateMany({ where: { tokenHash: sha256Hex(token) }, data: { revokedAt: new Date() } });
  if (req.user) await audit(prisma, req.user.id, "LOGOUT", "user", req.user.id, {}, req.ip);
  res.clearCookie(config.cookieName, { path: "/" });
  res.json({ ok: true });
}));

authRouter.get("/me", requireAuth, ah(async (req, res) => {
  const modules = await getSetting<Record<string, boolean>>("modules.enabled");
  const visible = Object.entries(MODULE_PERMS).filter(([m, p]) => modules?.[m] !== false && req.user!.permissions.has(p)).map(([m]) => m);
  res.json({ user: serializeUser(req.user!), modules: visible, modulesEnabled: modules });
}));

export const serializeUser = (u: AuthUser) => ({ id: u.id, email: u.email, name: u.name, role: u.role, roleName: u.roleName, permissions: [...u.permissions] });
