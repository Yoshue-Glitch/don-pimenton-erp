import { Router } from "express";
import { ZodEffects, ZodObject, ZodRawShape, ZodTypeAny } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ah, parse, pageParams, idParam } from "./http";
import { requirePerm } from "../auth/auth";
import { audit } from "./audit";
import { conflict, notFound } from "./errors";
import { nextCode } from "./sequence";

export interface CrudOptions {
  model: string;               // nombre del delegado Prisma (p. ej. "parcel")
  entity: string;              // nombre para auditoría
  readPerm: string;
  writePerm: string;
  schema: ZodObject<ZodRawShape> | ZodEffects<ZodTypeAny>;
  search?: string[];           // campos de texto para búsqueda
  filters?: string[];          // filtros exactos permitidos vía query (?status=ACTIVA)
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  codePrefix?: { field: string; prefix: string; year?: boolean; pad?: number };
  /** quita campos sensibles al listar */
  select?: (req: any) => Record<string, unknown> | undefined;
  transform?: (row: any, req: any) => any;
  allowDelete?: boolean;
}

/** Fábrica de endpoints CRUD para datos maestros con paginación, búsqueda, filtros y auditoría. */
export function crud(o: CrudOptions) {
  const r = Router();
  const delegate = () => (prisma as any)[o.model];

  const buildWhere = (req: any) => {
    const { q } = pageParams(req);
    const where: any = {};
    if (q && o.search?.length) where.OR = o.search.map((f) => ({ [f]: { contains: q, mode: "insensitive" } }));
    for (const f of o.filters ?? []) {
      const v = req.query[f];
      if (v === undefined || v === "") continue;
      where[f] = v === "true" ? true : v === "false" ? false : /Id$/.test(f) ? Number(v) : v;
    }
    return where;
  };

  r.get("/", requirePerm(o.readPerm), ah(async (req, res) => {
    const { skip, take, page, pageSize } = pageParams(req);
    const where = buildWhere(req);
    const select = o.select?.(req);
    const [items, total] = await Promise.all([
      delegate().findMany({ where, skip, take, orderBy: o.orderBy ?? { id: "desc" }, ...(select ? { select } : { include: o.include }) }),
      delegate().count({ where }),
    ]);
    res.json({ items: o.transform ? items.map((i: any) => o.transform!(i, req)) : items, total, page, pageSize });
  }));

  r.get("/:id", requirePerm(o.readPerm), ah(async (req, res) => {
    const select = o.select?.(req);
    const row = await delegate().findUnique({ where: { id: idParam(req) }, ...(select ? { select } : { include: o.include }) });
    if (!row) throw notFound();
    res.json(o.transform ? o.transform(row, req) : row);
  }));

  r.post("/", requirePerm(o.writePerm), ah(async (req, res) => {
    const data: any = parse(o.schema, req.body);
    const row = await prisma.$transaction(async (tx) => {
      if (o.codePrefix && !data[o.codePrefix.field]) {
        data[o.codePrefix.field] = await nextCode(tx, o.codePrefix.prefix, o.codePrefix.year === false ? null : new Date().getFullYear(), o.codePrefix.pad ?? 4);
      }
      const created = await (tx as any)[o.model].create({ data });
      await audit(tx, req.user!.id, "CREAR", o.entity, created.id, data, req.ip);
      return created;
    }).catch(mapPrismaError);
    res.status(201).json(row);
  }));

  r.put("/:id", requirePerm(o.writePerm), ah(async (req, res) => {
    const id = idParam(req);
    const base = (o.schema instanceof ZodEffects ? o.schema.innerType() : o.schema) as ZodObject<ZodRawShape>;
    const data: any = parse(base.partial(), req.body);
    const row = await prisma.$transaction(async (tx) => {
      const before = await (tx as any)[o.model].findUnique({ where: { id } });
      if (!before) throw notFound();
      const updated = await (tx as any)[o.model].update({ where: { id }, data });
      await audit(tx, req.user!.id, "ACTUALIZAR", o.entity, id, { cambios: data }, req.ip);
      return updated;
    }).catch(mapPrismaError);
    res.json(row);
  }));

  if (o.allowDelete !== false) {
    r.delete("/:id", requirePerm(o.writePerm), ah(async (req, res) => {
      const id = idParam(req);
      await prisma.$transaction(async (tx) => {
        await (tx as any)[o.model].delete({ where: { id } });
        await audit(tx, req.user!.id, "ELIMINAR", o.entity, id, {}, req.ip);
      }).catch(mapPrismaError);
      res.json({ ok: true });
    }));
  }
  return r;
}

export function mapPrismaError(e: any): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") throw conflict(`Ya existe un registro con el mismo valor único (${(e.meta?.target as string[] | undefined)?.join(", ") ?? "campo"})`);
    if (e.code === "P2003") throw conflict("El registro está relacionado con otros datos y no puede eliminarse o la referencia no existe");
    if (e.code === "P2025") throw notFound();
  }
  throw e;
}
