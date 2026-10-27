import { Router } from "express";
import { z } from "zod";
import { DocumentType, ExportStatus } from "@prisma/client";
import { prisma, inTx } from "../lib/prisma";
import { ah, parse, idParam, pageParams } from "../lib/http";
import { crud } from "../lib/crud";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";

export const exportsRouter = Router();

exportsRouter.use("/partners", crud({
  model: "exportPartner", entity: "socio_exportador", readPerm: "exports.read", writePerm: "exports.write",
  schema: z.object({ name: z.string().min(2).max(150), ruc: z.string().regex(/^(10|20)\d{9}$/).nullable().optional(), country: z.string().min(2).max(60), contact: z.string().max(100).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal("")), services: z.string().min(2).max(300), active: z.boolean().default(true) }),
  search: ["name", "country"], orderBy: { name: "asc" },
}));

/** Lista de documentos a gestionar. Su aplicabilidad real depende del destino y debe validarse con el agente de aduanas / socio. */
const REQUIREMENTS: { docType: DocumentType; name: string; mandatory: boolean; modes: ("DIRECTA" | "INDIRECTA")[] }[] = [
  { docType: "FACTURA_COMERCIAL", name: "Factura comercial", mandatory: true, modes: ["DIRECTA"] },
  { docType: "PACKING_LIST", name: "Packing list", mandatory: true, modes: ["DIRECTA", "INDIRECTA"] },
  { docType: "COA", name: "Certificado de análisis (COA) del lote", mandatory: true, modes: ["DIRECTA", "INDIRECTA"] },
  { docType: "CERTIFICADO", name: "Certificados aplicables según destino (origen, fitosanitario u otros)", mandatory: true, modes: ["DIRECTA", "INDIRECTA"] },
  { docType: "DOC_TRANSPORTE", name: "Documento de transporte (BL / AWB / CRT)", mandatory: true, modes: ["DIRECTA"] },
  { docType: "DOC_ADUANERO", name: "Declaración aduanera (DAM) — gestionada por agente de aduanas", mandatory: true, modes: ["DIRECTA"] },
  { docType: "CONTRATO", name: "Contrato / orden de compra con el socio exportador", mandatory: true, modes: ["INDIRECTA"] },
];

exportsRouter.get("/orders", requirePerm("exports.read"), ah(async (req, res) => {
  const { skip, take, page, pageSize } = pageParams(req);
  const [items, total] = await Promise.all([
    prisma.exportOrder.findMany({ skip, take, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true, country: true } }, partner: { select: { name: true } }, lot: { select: { code: true, qualityStatus: true } }, requirements: true } }),
    prisma.exportOrder.count(),
  ]);
  res.json({ items, total, page, pageSize });
}));

exportsRouter.get("/orders/:id", requirePerm("exports.read"), ah(async (req, res) => {
  const o = await prisma.exportOrder.findUnique({ where: { id: idParam(req) }, include: { customer: true, partner: true, product: true, lot: true, requirements: { include: { document: true }, orderBy: { id: "asc" } }, receivables: true } });
  if (!o) throw notFound();
  res.json(o);
}));

exportsRouter.post("/orders", requirePerm("exports.write"), ah(async (req, res) => {
  const input = parse(z.object({
    customerId: z.coerce.number().int().positive(), partnerId: z.coerce.number().int().positive().nullable().optional(),
    mode: z.enum(["INDIRECTA", "DIRECTA"]), destinationCountry: z.string().min(2).max(60),
    incoterm: z.enum(["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]), incotermVersion: z.string().default("Incoterms® 2020"),
    currency: z.enum(["USD", "PEN", "EUR"]).default("USD"), exchangeRate: z.coerce.number().positive(),
    productId: z.coerce.number().int().positive(), lotId: z.coerce.number().int().positive().nullable().optional(),
    netWeightKg: z.coerce.number().positive(), grossWeightKg: z.coerce.number().positive(), amount: z.coerce.number().positive(),
    logisticsCost: z.coerce.number().min(0).default(0), etd: z.coerce.date().nullable().optional(), eta: z.coerce.date().nullable().optional(), notes: z.string().max(500).optional(),
  }).refine((d) => d.grossWeightKg >= d.netWeightKg, { message: "El peso bruto debe ser ≥ al neto", path: ["grossWeightKg"] })
    .refine((d) => d.mode === "DIRECTA" || d.partnerId, { message: "La exportación indirecta requiere un socio exportador", path: ["partnerId"] }), req.body);
  const out = await inTx(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!c || c.type !== "INTERNACIONAL") throw unprocessable("Seleccione un cliente internacional");
    const o = await tx.exportOrder.create({
      data: { ...input, code: await nextCode(tx, "EXP", new Date().getFullYear(), 4), requirements: { create: REQUIREMENTS.filter((r) => r.modes.includes(input.mode)).map(({ docType, name, mandatory }) => ({ docType, name, mandatory })) } },
    });
    await audit(tx, req.user!.id, "CREAR", "exportacion", o.id, { code: o.code, mode: input.mode });
    return o;
  });
  res.status(201).json(out);
}));

/** Vincula un documento adjunto a un requisito (pasa a ADJUNTADO, no a cumplido). */
exportsRouter.post("/requirements/:id/attach", requirePerm("exports.write"), ah(async (req, res) => {
  const { documentId } = parse(z.object({ documentId: z.coerce.number().int().positive() }), req.body);
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw notFound("Documento no encontrado");
  const r = await prisma.exportRequirement.update({ where: { id: idParam(req) }, data: { documentId, status: "ADJUNTADO" } });
  await audit(prisma, req.user!.id, "ADJUNTAR_REQUISITO", "exportacion", r.exportOrderId, { requirement: r.name, doc: doc.code });
  res.json(r);
}));

/** Verificación: SOLO es posible si existe evidencia documental adjunta. */
exportsRouter.post("/requirements/:id/verify", requirePerm("exports.write"), ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(z.object({ status: z.enum(["VERIFICADO", "NO_APLICA"]), notes: z.string().max(300).optional() }), req.body);
  const r = await prisma.exportRequirement.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (input.status === "VERIFICADO" && !r.documentId) throw unprocessable("No se puede marcar como verificado sin evidencia documental adjunta");
  if (input.status === "NO_APLICA" && !input.notes) throw unprocessable("Justifique por qué el requisito no aplica");
  const out = await prisma.exportRequirement.update({ where: { id }, data: { status: input.status, notes: input.notes, verifiedBy: req.user!.name, verifiedAt: new Date() } });
  await audit(prisma, req.user!.id, `REQUISITO_${input.status}`, "exportacion", r.exportOrderId, { requirement: r.name });
  res.json(out);
}));

const FLOW: ExportStatus[] = ["BORRADOR", "CONFIRMADA", "DOCUMENTACION", "EMBARCADA", "EN_TRANSITO", "ENTREGADA"];

exportsRouter.post("/orders/:id/advance", requirePerm("exports.write"), ah(async (req, res) => {
  const id = idParam(req);
  const out = await inTx(async (tx) => {
    const o = await tx.exportOrder.findUnique({ where: { id }, include: { requirements: true, lot: true } });
    if (!o) throw notFound();
    const i = FLOW.indexOf(o.status);
    if (i < 0 || i === FLOW.length - 1) throw unprocessable(`No hay transición disponible desde ${o.status}`);
    const next = FLOW[i + 1];
    if (next === "CONFIRMADA" && o.lot && o.lot.qualityStatus !== "APROBADO") throw unprocessable(`El lote ${o.lot.code} no está aprobado por Calidad`);
    if (next === "EMBARCADA") {
      const pending = o.requirements.filter((r) => r.mandatory && !["VERIFICADO", "NO_APLICA"].includes(r.status));
      if (pending.length) throw unprocessable(`No se puede embarcar: requisitos sin evidencia verificada → ${pending.map((p) => p.name).join("; ")}`);
      const due = new Date(); due.setDate(due.getDate() + 30);
      await tx.accountReceivable.create({ data: { code: await nextCode(tx, "CXC", new Date().getFullYear(), 4), customerId: o.customerId, exportOrderId: o.id, documentRef: o.code, issueDate: new Date(), dueDate: due, currency: o.currency, exchangeRate: o.exchangeRate, amount: o.amount } });
    }
    await audit(tx, req.user!.id, `EXPORTACION_${next}`, "exportacion", id, {});
    return tx.exportOrder.update({ where: { id }, data: { status: next } });
  });
  res.json(out);
}));
