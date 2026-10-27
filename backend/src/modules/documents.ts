import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { z } from "zod";
import { DocumentType } from "@prisma/client";
import { prisma, Tx } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { badRequest, notFound } from "../lib/errors";
import { sha256Hex } from "../lib/hash";
import { config } from "../config";

export const documentsRouter = Router();

const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

/** Guarda un archivo fuera de la BD y registra su hash SHA-256 (base para la verificación de integridad). */
export async function storeDocument(tx: Tx | typeof prisma, f: { buffer: Buffer; originalname: string; mimetype: string }, meta: { title: string; type: DocumentType; entityType: string; entityId: string }, userId: number) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const sha = sha256Hex(f.buffer);
  const stored = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "")}`;
  fs.writeFileSync(path.join(config.uploadDir, stored), f.buffer);
  const doc = await tx.document.create({
    data: { code: await nextCode(tx as Tx, "DOC", new Date().getFullYear(), 5), title: meta.title, type: meta.type, fileName: f.originalname.slice(0, 200), mimeType: f.mimetype, sizeBytes: f.buffer.length, sha256: sha, storagePath: stored, entityType: meta.entityType, entityId: meta.entityId, uploadedById: userId },
  });
  await audit(tx, userId, "ADJUNTAR_DOCUMENTO", meta.entityType, meta.entityId, { doc: doc.code, sha256: sha, type: meta.type });
  return doc;
}

documentsRouter.post("/", requirePerm("documents.write"), upload.single("file"), ah(async (req, res) => {
  if (!req.file) throw badRequest("Adjunte un archivo");
  if (!ALLOWED.includes(req.file.mimetype)) throw badRequest(`Tipo de archivo no permitido (${req.file.mimetype})`);
  const meta = parse(z.object({
    title: z.string().min(2).max(150),
    type: z.nativeEnum(DocumentType),
    entityType: z.string().min(2).max(40),
    entityId: z.string().min(1).max(40),
  }), req.body);
  res.status(201).json(await storeDocument(prisma, req.file, meta, req.user!.id));
}));

documentsRouter.get("/", requirePerm("dashboard.read"), ah(async (req, res) => {
  const where: any = {};
  if (req.query.entityType) where.entityType = String(req.query.entityType);
  if (req.query.entityId) where.entityId = String(req.query.entityId);
  res.json(await prisma.document.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { uploadedBy: { select: { name: true } } } }));
}));

documentsRouter.get("/:id/download", requirePerm("dashboard.read"), ah(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: idParam(req) } });
  if (!d) throw notFound();
  const file = path.join(config.uploadDir, path.basename(d.storagePath));
  if (!fs.existsSync(file)) throw notFound("Archivo no disponible en el almacenamiento");
  const buf = fs.readFileSync(file);
  res.setHeader("X-Document-SHA256", d.sha256);
  res.setHeader("X-Integrity", sha256Hex(buf) === d.sha256 ? "OK" : "ALTERADO");
  res.setHeader("Content-Type", d.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(d.fileName)}"`);
  res.send(buf);
}));

documentsRouter.get("/:id/verify", requirePerm("dashboard.read"), ah(async (req, res) => {
  const d = await prisma.document.findUnique({ where: { id: idParam(req) } });
  if (!d) throw notFound();
  const file = path.join(config.uploadDir, path.basename(d.storagePath));
  const actual = fs.existsSync(file) ? sha256Hex(fs.readFileSync(file)) : null;
  res.json({ code: d.code, registered: d.sha256, actual, intact: actual === d.sha256 });
}));
