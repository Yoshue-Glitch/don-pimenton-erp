import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ah, parse, pageParams } from "../lib/http";
import { requirePerm, hasPerm } from "../auth/auth";
import { forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import * as chain from "../blockchain/chain";
import { anchorLot, verifyLot, createAgreementFromOrder, agreementAction, refreshAgreement } from "./blockchain.service";

export const blockchainRouter = Router();

blockchainRouter.get("/status", requirePerm("blockchain.read"), ah(async (_req, res) => {
  const [st, counts] = await Promise.all([
    chain.status(),
    prisma.blockchainTransaction.groupBy({ by: ["status"], _count: true }),
  ]);
  const agreements = await prisma.smartAgreement.groupBy({ by: ["status"], _count: true });
  res.json({ ...st, txCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])), agreementCounts: Object.fromEntries(agreements.map((c) => [c.status, c._count])) });
}));

blockchainRouter.post("/deploy", requirePerm("blockchain.write", "demo.run"), ah(async (req, res) => {
  const out = await chain.deployContracts(req.user!.id);
  await audit(prisma, req.user!.id, "DESPLEGAR_CONTRATOS", "blockchain", null, out);
  res.json(out);
}));

blockchainRouter.post("/sync-events", requirePerm("blockchain.read"), ah(async (_req, res) => {
  res.json({ synced: await chain.syncEvents() });
}));

blockchainRouter.get("/transactions", requirePerm("blockchain.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize, q } = pageParams(req);
  const where: any = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.entityCode) where.entityCode = String(req.query.entityCode);
  if (q) where.OR = [{ txHash: { contains: q, mode: "insensitive" } }, { functionName: { contains: q, mode: "insensitive" } }, { entityCode: { contains: q, mode: "insensitive" } }];
  const [items, total] = await Promise.all([
    prisma.blockchainTransaction.findMany({ where, skip, take, orderBy: { id: "desc" }, include: { user: { select: { name: true } }, events: { select: { eventName: true, logIndex: true } } } }),
    prisma.blockchainTransaction.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

blockchainRouter.get("/events", requirePerm("blockchain.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const [items, total] = await Promise.all([
    prisma.blockchainEvent.findMany({ skip, take, orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }] }),
    prisma.blockchainEvent.count(),
  ]);
  res.json({ items, total, page, pageSize });
}));

/** Verificación en vivo de un recibo: consulta la red local por el hash. */
blockchainRouter.get("/tx/:hash", requirePerm("blockchain.read"), ah(async (req, res) => {
  const receipt = await chain.getProvider().getTransactionReceipt(req.params.hash);
  if (!receipt) throw notFound("La transacción no existe en la red local");
  res.json({ hash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status === 1 ? "CONFIRMADA" : "REVERTIDA", from: receipt.from, to: receipt.to, gasUsed: receipt.gasUsed.toString(), logs: receipt.logs.length, confirmations: await receipt.confirmations() });
}));

blockchainRouter.post("/lots/:code/anchor", requirePerm("blockchain.write"), ah(async (req, res) => {
  if (!hasPerm(req, "quality.approve") && !hasPerm(req, "production.write")) throw forbidden("Registrar lotes en blockchain requiere permisos de Producción o Calidad");
  res.json(await anchorLot(req.params.code, req.user!.id));
}));

blockchainRouter.get("/lots/:code/verify", requirePerm("blockchain.read"), ah(async (req, res) => {
  res.json(await verifyLot(req.params.code));
}));

blockchainRouter.get("/agreements", requirePerm("blockchain.read"), ah(async (_req, res) => {
  res.json(await prisma.smartAgreement.findMany({ orderBy: { id: "desc" }, include: { lot: { select: { code: true, qualityStatus: true } }, customer: { select: { name: true } }, salesOrder: { select: { code: true, status: true } } } }));
}));

blockchainRouter.get("/agreements/:code", requirePerm("blockchain.read"), ah(async (req, res) => {
  const ag = await prisma.smartAgreement.findUnique({ where: { code: req.params.code }, include: { lot: true, customer: true, salesOrder: { include: { dispatches: true, receivables: true } } } });
  if (!ag) throw notFound();
  let onchain: any = null, chainError: string | null = null;
  try { onchain = await chain.readAgreement(ag.code); await refreshAgreement(ag.code); } catch (e: any) { chainError = e.message; }
  const txs = await prisma.blockchainTransaction.findMany({ where: { entityCode: ag.code }, orderBy: { id: "asc" }, include: { events: true } });
  res.json({ ...ag, onchain, chainError, txs });
}));

blockchainRouter.post("/agreements", requirePerm("blockchain.write", "sales.write"), ah(async (req, res) => {
  const input = parse(z.object({ salesOrderId: z.coerce.number().int().positive(), deadlineDays: z.coerce.number().int().min(1).max(180).default(30) }), req.body);
  res.status(201).json(await createAgreementFromOrder(input.salesOrderId, req.user!.id, { deadlineDays: input.deadlineDays }));
}));

/** Permiso ERP requerido por acción (además del control de roles dentro del contrato). */
const ACTION_PERMS: Record<string, string> = {
  accept: "sales.write", deposit: "sales.write", confirm: "sales.write", release: "sales.write", cancel: "sales.write", dispute: "sales.write",
  quality: "quality.approve", delivery: "logistics.write", resolve: "blockchain.arbitrate",
};

blockchainRouter.post("/agreements/:code/:action", requirePerm("blockchain.write"), ah(async (req, res) => {
  const action = req.params.action;
  const perm = ACTION_PERMS[action];
  if (!perm) throw notFound("Acción no disponible");
  if (!hasPerm(req, perm)) throw forbidden(`La acción "${action}" requiere el permiso ${perm}`);
  const params = parse(z.object({ approved: z.boolean().optional(), reason: z.string().max(200).optional(), releaseToSeller: z.boolean().optional() }), req.body ?? {});
  const out = await agreementAction(req.params.code, action as any, req.user!.id, params);
  res.status(out.ok ? 200 : 422).json(out);
}));
