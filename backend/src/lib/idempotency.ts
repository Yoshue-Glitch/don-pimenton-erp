import { Request, Response, NextFunction } from "express";
import { prisma } from "./prisma";
import { conflict } from "./errors";

/**
 * Idempotencia para operaciones críticas: si el cliente envía la cabecera
 * "Idempotency-Key", una repetición (doble clic, reintento de red) devuelve la
 * respuesta original en lugar de crear otro registro.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["idempotency-key"];
  if (req.method !== "POST" || typeof key !== "string" || !key) return next();
  const fullKey = `${req.user?.id ?? "anon"}:${key.slice(0, 100)}`;
  try {
    const existing = await prisma.idempotencyKey.findUnique({ where: { key: fullKey } });
    if (existing) {
      if (existing.route !== req.originalUrl) return next(conflict("La clave de idempotencia ya se usó en otra operación"));
      if (existing.statusCode === 0) return next(conflict("La operación original aún se está procesando"));
      res.setHeader("Idempotent-Replay", "true");
      return res.status(existing.statusCode).json(existing.response);
    }
    await prisma.idempotencyKey.create({ data: { key: fullKey, userId: req.user?.id, route: req.originalUrl, statusCode: 0, response: {} } });
  } catch (e: any) {
    if (e?.code === "P2002") return next(conflict("La operación original aún se está procesando"));
    return next(e);
  }
  const json = res.json.bind(res);
  res.json = (body: any) => {
    const status = res.statusCode;
    const store = status < 500
      ? prisma.idempotencyKey.update({ where: { key: fullKey }, data: { statusCode: status, response: body ?? {} } })
      : prisma.idempotencyKey.delete({ where: { key: fullKey } });
    store.catch(() => {});
    return json(body);
  };
  next();
}
