import { Router, Response } from "express";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { ah, idParam } from "../lib/http";
import { requirePerm, hasPerm } from "../auth/auth";
import { forbidden, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { lotTraceability } from "./inventory";
import { verifyLot } from "./blockchain.service";
import { STAGE_LABEL } from "./production";

export const reportsRouter = Router();

const RED = "#A52A2A", GREEN = "#1C3F2B", DARK = "#1F2937", GOLD = "#D9A441";
const fmt = (v: any, d = 2) => Number(v ?? 0).toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (d?: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
// Helvetica (WinAnsi) no incluye algunos símbolos: se sustituyen.
const safe = (s: unknown) => String(s ?? "—").replace(/→/g, "->").replace(/[—–]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[^\x00-\xFF]/g, "");

function header(doc: PDFKit.PDFDocument, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 70).fill(GREEN);
  doc.rect(0, 70, doc.page.width, 3).fill(RED);
  doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica-Bold").text("DON PIMENTÓN ERP", 40, 18);
  doc.fontSize(9).font("Helvetica").text("Agroindustrial Management & Blockchain  ·  Del campo al mercado, con calidad y trazabilidad", 40, 42);
  doc.fillColor(DARK).fontSize(15).font("Helvetica-Bold").text(safe(title), 40, 90);
  doc.fontSize(9).font("Helvetica").fillColor("#555").text(safe(subtitle), 40, 110);
  doc.moveDown(1.2);
}

function section(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > doc.page.height - 170) doc.addPage();
  doc.moveDown(0.6);
  const y = doc.y;
  doc.rect(40, y, doc.page.width - 80, 18).fill(GREEN);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10).text(safe(title), 46, y + 4);
  doc.fillColor(DARK).font("Helvetica").fontSize(9);
  doc.y = y + 24;
}

function kv(doc: PDFKit.PDFDocument, rows: [string, unknown][]) {
  for (const [k, v] of rows) {
    if (doc.y > doc.page.height - 85) doc.addPage();
    const y = doc.y;
    doc.font("Helvetica-Bold").text(safe(k), 46, y, { width: 170 });
    doc.font("Helvetica").text(safe(v), 220, y, { width: doc.page.width - 260 });
    doc.y = Math.max(doc.y, y + 12) + 2;
  }
}

function table(doc: PDFKit.PDFDocument, cols: { h: string; w: number }[], rows: unknown[][]) {
  let x = 46;
  if (doc.y > doc.page.height - 110) doc.addPage();
  const y0 = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
  cols.forEach((c) => { doc.text(safe(c.h), x, y0, { width: c.w }); x += c.w; });
  doc.moveTo(46, y0 + 11).lineTo(doc.page.width - 46, y0 + 11).strokeColor(GOLD).stroke();
  doc.y = y0 + 14;
  doc.font("Helvetica").fontSize(8);
  for (const r of rows) {
    if (doc.y > doc.page.height - 85) doc.addPage();
    const y = doc.y; x = 46;
    let maxH = 10;
    r.forEach((v, i) => { const h = doc.heightOfString(safe(v), { width: cols[i].w - 4 }); maxH = Math.max(maxH, h); doc.text(safe(v), x, y, { width: cols[i].w - 4 }); x += cols[i].w; });
    doc.y = y + maxH + 3;
  }
  doc.fontSize(9);
}

function footer(doc: PDFKit.PDFDocument, note: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(6.5).fillColor("#777").text(safe(note), 40, doc.page.height - 52, { width: doc.page.width - 80, align: "center" });
    doc.text(`Página ${i + 1} de ${range.count}  ·  Generado ${new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })}`, 40, doc.page.height - 28, { width: doc.page.width - 80, align: "center" });
    doc.page.margins.bottom = bottom;
  }
}

function send(res: Response, doc: PDFKit.PDFDocument, filename: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}

/** Reporte de trazabilidad del lote en PDF: campo → planta → calidad → inventario → venta → blockchain. */
reportsRouter.get("/traceability/:code.pdf", requirePerm("reports.read"), ah(async (req, res) => {
  const t: any = await lotTraceability(req.params.code);
  let verification: any = null;
  if (hasPerm(req, "blockchain.read")) { try { verification = await verifyLot(t.code); } catch (e: any) { verification = { error: e.message }; } }
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `Trazabilidad ${t.code}`, Author: "Don Pimentón ERP" } });
  header(doc, `Reporte de trazabilidad — Lote ${t.code}`, `${t.product.name} · ${fmt(t.quantityKg, 0)} kg${t.bags ? ` · ${t.bags} sacos de ${fmt(t.product.bagWeightKg, 0)} kg` : ""} · DATOS DE DEMOSTRACIÓN`);

  section(doc, "1. Identificación del lote");
  kv(doc, [["Código", t.code], ["Tipo", t.type], ["Producto", `${t.product.code} — ${t.product.name}`], ["Cantidad", `${fmt(t.quantityKg, 3)} kg`], ["Fecha de producción", day(t.productionDate)], ["Vencimiento", day(t.expiryDate)], ["Estado de calidad", t.qualityStatus], ["Lote de origen", t.parentLot?.code ?? "—"]]);

  if (t.campaign) {
    section(doc, "2. Origen agrícola");
    kv(doc, [["Campaña", `${t.campaign.code} — variedad ${t.campaign.variety}`], ["Parcela", `${t.campaign.parcel.code} ${t.campaign.parcel.name} (${fmt(t.campaign.parcel.areaHa)} ha) — ${t.campaign.parcel.location}`], ["Siembra / cosecha", `${day(t.campaign.sowingDate)} / ${day(t.campaign.actualHarvestDate)}`], ["Cosecha", t.parentLot?.harvest ? `${t.parentLot.harvest.code} — ${fmt(t.parentLot.harvest.quantityKg, 0)} kg el ${day(t.parentLot.harvest.date)}` : "—"]]);
    if (t.campaign.activities.length) table(doc, [{ h: "Fecha", w: 70 }, { h: "Actividad", w: 100 }, { h: "Descripción", w: 260 }, { h: "Costo S/", w: 70 }], t.campaign.activities.map((a: any) => [day(a.date), a.type, a.description, fmt(a.cost)]));
  }

  if (t.productionOrder) {
    const o = t.productionOrder;
    section(doc, "3. Procesamiento");
    kv(doc, [["Orden de producción", `${o.code} (responsable: ${o.responsible.name})`], ["Peso inicial / final", `${fmt(o.initialWeightKg, 3)} kg / ${fmt(o.finalWeightKg, 3)} kg`], ["Merma", `${fmt(o.wasteKg, 3)} kg`], ["Rendimiento", `${fmt(o.yieldPct, 2)} % (valores de demostración)`], ["Secado", `${fmt(o.dryingTempC, 1)} °C durante ${fmt(o.dryingHours, 1)} h`], ["Costo total", `S/ ${fmt(o.totalCost)}`]]);
    table(doc, [{ h: "Etapa", w: 170 }, { h: "Inicio", w: 80 }, { h: "Fin", w: 80 }, { h: "Entrada kg", w: 85 }, { h: "Salida kg", w: 85 }], o.stages.map((s: any) => [STAGE_LABEL[s.stage as keyof typeof STAGE_LABEL], day(s.startedAt), day(s.completedAt), s.inputKg ? fmt(s.inputKg, 1) : "—", s.outputKg ? fmt(s.outputKg, 1) : "—"]));
  }

  section(doc, "4. Control de calidad");
  if (!t.inspections.length) doc.text("Sin inspecciones registradas.", 46);
  for (const i of t.inspections) {
    kv(doc, [["Inspección", `${i.code} — ${day(i.date)} — inspector: ${i.inspector.name}`], ["Resultados", `Humedad ${i.moisturePct ?? "—"} % · ASTA ${i.astaColor ?? "—"} · Granulometría ${i.granulometry ?? "—"} % ${i.granulometryMesh ?? ""}`], ["Microbiológico / contaminantes", `${i.microbiological} / ${i.contaminants}`], ["Decisión", `${i.status}${i.decidedBy ? ` por ${i.decidedBy.name} (${day(i.decidedAt)})` : ""}`], ["Documento COA", i.coaDocument ? `${i.coaDocument.code} ${i.coaDocument.fileName} · SHA-256 ${i.coaDocument.sha256}` : "Informe de inspección interno"]]);
    const ev = (i.specEvaluation as any[]) ?? [];
    if (ev.length) table(doc, [{ h: "Parámetro", w: 110 }, { h: "Valor", w: 70 }, { h: "Rango", w: 120 }, { h: "Fuente", w: 90 }, { h: "Resultado", w: 90 }], ev.map((e) => [e.parameter, e.value ?? "—", `${e.min ?? "—"} a ${e.max ?? "—"} ${e.unit}`, `${e.source}${e.isDemo ? " (demo)" : ""}`, e.result]));
  }
  doc.fontSize(7).fillColor("#777").text("Las especificaciones mostradas son configurables por producto y cliente; los valores de demostración no constituyen límites regulatorios.", 46).fillColor(DARK).fontSize(9);

  section(doc, "5. Movimientos de inventario (kardex del lote)");
  table(doc, [{ h: "Fecha", w: 65 }, { h: "Movimiento", w: 115 }, { h: "kg", w: 55 }, { h: "Almacén", w: 55 }, { h: "Referencia", w: 95 }, { h: "Usuario", w: 120 }], t.movements.map((m: any) => [day(m.createdAt), m.type, fmt(m.quantityKg, 1), m.warehouse.code, m.referenceCode, m.user.name]));

  section(doc, "6. Comercialización y despacho");
  if (!t.salesOrderItems.length) doc.text("Sin ventas asociadas.", 46);
  for (const it of t.salesOrderItems) {
    const o = it.order;
    kv(doc, [["Pedido", `${o.code} — ${o.customer.name} — ${fmt(it.quantity, 0)} ${it.unit === "SACO" ? "sacos" : "kg"} (${fmt(it.quantityKg, 0)} kg)`], ["Importe", `${o.currency} ${fmt(o.total)} · estado ${o.status} · cobro ${o.paymentStatus}`], ...o.dispatches.map((d: any) => [`Despacho ${d.code}`, `${d.status} · salida ${day(d.departureAt)} · entrega ${day(d.deliveredAt)} · recibió ${d.receivedBy ?? "—"}`] as [string, unknown])]);
  }

  section(doc, "7. Registro en blockchain local (Hardhat, chainId 31337)");
  if (verification?.registered) {
    kv(doc, [["Hash de datos (ERP recalculado)", verification.recomputedDataHash], ["Hash de datos (on-chain)", verification.onchain.lotDataHash], ["Hash del certificado (on-chain)", verification.onchain.qualityCertHash], ["Calidad on-chain", verification.onchain.quality], ["Resultado de verificación", verification.verdict]]);
  } else kv(doc, [["Estado", verification?.error ?? verification?.message ?? "No consultado"]]);
  if (t.chainTxs.length) table(doc, [{ h: "Función", w: 105 }, { h: "Estado", w: 70 }, { h: "Bloque", w: 45 }, { h: "Hash de transacción", w: 285 }], t.chainTxs.map((x: any) => [x.functionName, x.status, x.blockNumber ?? "—", x.txHash ?? `(rechazada antes de minar: ${x.errorMessage})`]));

  footer(doc, "Documento de gestión generado por un prototipo con datos ficticios de demostración. No es un certificado oficial ni un documento tributario. Las operaciones blockchain se ejecutaron en una red local sin valor económico.");
  await audit(prisma, req.user!.id, "REPORTE_PDF", "lote", t.id, { code: t.code });
  send(res, doc, `trazabilidad-${t.code}.pdf`);
}));

/** Comprobante interno de demostración (sin validez tributaria). */
reportsRouter.get("/sales-document/:id.pdf", requirePerm("sales.read"), ah(async (req, res) => {
  const d = await prisma.salesDocument.findUnique({ where: { id: idParam(req) }, include: { order: { include: { customer: true, items: { include: { product: true, lot: true } } } } } });
  if (!d) throw notFound();
  const o = d.order;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  header(doc, `Comprobante interno ${d.code}`, "DOCUMENTO INTERNO DE DEMOSTRACIÓN — NO ES UN COMPROBANTE DE PAGO ELECTRÓNICO");
  kv(doc, [["Cliente", `${o.customer.name} (${o.customer.documentType} ${o.customer.documentNumber})`], ["Pedido", o.code], ["Fecha", day(d.issueDate)], ["Moneda", o.currency]]);
  section(doc, "Detalle");
  table(doc, [{ h: "Producto", w: 170 }, { h: "Lote", w: 80 }, { h: "Cantidad", w: 70 }, { h: "kg", w: 60 }, { h: "P. unit.", w: 60 }, { h: "Importe", w: 70 }], o.items.map((i) => [i.product.name, i.lot?.code ?? "asignado por FEFO", `${fmt(i.quantity, 0)} ${i.unit === "SACO" ? "sacos" : "kg"}`, fmt(i.quantityKg, 0), fmt(i.unitPrice), fmt(i.lineTotal)]));
  section(doc, "Totales");
  kv(doc, [["Base imponible", fmt(o.subtotal)], ["Descuentos", fmt(o.discountTotal)], [`Impuesto (${fmt(Number(o.taxRate) * 100, 0)} %)`, fmt(o.taxTotal)], ["Total", `${o.currency} ${fmt(o.total)}`], ["Precio incluye impuesto", o.priceIncludesTax ? "Sí" : "No"]]);
  doc.moveDown().fontSize(8).fillColor(RED).text(safe(d.legalNote), 46).fillColor(DARK);
  doc.text("Facturación electrónica: integración futura con un OSE/PSE autorizado por SUNAT (estado: NO_ENVIADO).", 46);
  footer(doc, "Don Pimentón ERP — prototipo con datos de demostración.");
  send(res, doc, `${d.code}.pdf`);
}));

// ---------------------------------------------------------------- Excel
const EXPORTS: Record<string, { perm: string; title: string; load: () => Promise<{ columns: { header: string; key: string; width?: number }[]; rows: any[] }> }> = {
  lotes: { perm: "inventory.read", title: "Lotes", load: async () => ({
    columns: [{ header: "Código", key: "code", width: 16 }, { header: "Tipo", key: "type", width: 20 }, { header: "Producto", key: "product", width: 30 }, { header: "kg", key: "kg" }, { header: "Sacos", key: "bags" }, { header: "Calidad", key: "quality", width: 14 }, { header: "Estado", key: "status", width: 14 }, { header: "Blockchain", key: "chain", width: 14 }, { header: "Producción", key: "date", width: 12 }],
    rows: (await prisma.lot.findMany({ include: { product: true }, orderBy: { code: "asc" } })).map((l) => ({ code: l.code, type: l.type, product: l.product.name, kg: Number(l.quantityKg), bags: l.bags, quality: l.qualityStatus, status: l.status, chain: l.chainStatus, date: day(l.productionDate) })),
  }) },
  inventario: { perm: "inventory.read", title: "Stock", load: async () => ({
    columns: [{ header: "Producto", key: "product", width: 30 }, { header: "Almacén", key: "wh", width: 12 }, { header: "Lote", key: "lot", width: 16 }, { header: "Disponible kg", key: "a", width: 14 }, { header: "Reservado kg", key: "r", width: 14 }, { header: "Cuarentena kg", key: "q", width: 14 }],
    rows: (await prisma.inventoryBalance.findMany({ include: { product: true, warehouse: true, lot: true } })).map((b) => ({ product: b.product.name, wh: b.warehouse.code, lot: b.lot?.code ?? "", a: Number(b.availableKg), r: Number(b.reservedKg), q: Number(b.quarantineKg) })),
  }) },
  kardex: { perm: "inventory.read", title: "Kardex", load: async () => ({
    columns: [{ header: "Código", key: "code", width: 16 }, { header: "Fecha", key: "date", width: 18 }, { header: "Tipo", key: "type", width: 22 }, { header: "Producto", key: "product", width: 28 }, { header: "Almacén", key: "wh" }, { header: "Lote", key: "lot", width: 14 }, { header: "kg", key: "kg" }, { header: "Saldo", key: "bal" }, { header: "Referencia", key: "ref", width: 16 }, { header: "Motivo", key: "reason", width: 50 }, { header: "Usuario", key: "user", width: 22 }],
    rows: (await prisma.inventoryMovement.findMany({ include: { product: true, warehouse: true, lot: true, user: true }, orderBy: { id: "asc" } })).map((m) => ({ code: m.code, date: m.createdAt.toISOString().replace("T", " ").slice(0, 16), type: m.type, product: m.product.name, wh: m.warehouse.code, lot: m.lot?.code ?? "", kg: Number(m.quantityKg), bal: Number(m.balanceAfter), ref: m.referenceCode, reason: m.reason, user: m.user.name })),
  }) },
  ventas: { perm: "sales.read", title: "Pedidos", load: async () => ({
    columns: [{ header: "Pedido", key: "code", width: 16 }, { header: "Fecha", key: "date", width: 12 }, { header: "Cliente", key: "customer", width: 32 }, { header: "kg", key: "kg" }, { header: "Moneda", key: "cur" }, { header: "Total", key: "total" }, { header: "Estado", key: "status", width: 14 }, { header: "Cobro", key: "pay", width: 12 }],
    rows: (await prisma.salesOrder.findMany({ include: { customer: true }, orderBy: { date: "asc" } })).map((o) => ({ code: o.code, date: day(o.date), customer: o.customer.name, kg: Number(o.totalKg), cur: o.currency, total: Number(o.total), status: o.status, pay: o.paymentStatus })),
  }) },
  finanzas: { perm: "finance.read", title: "Transacciones", load: async () => ({
    columns: [{ header: "Código", key: "code", width: 16 }, { header: "Fecha", key: "date", width: 12 }, { header: "Tipo", key: "type" }, { header: "Categoría", key: "cat", width: 28 }, { header: "Descripción", key: "desc", width: 55 }, { header: "Moneda", key: "cur" }, { header: "Importe", key: "amount" }, { header: "T.C.", key: "fx" }, { header: "Importe PEN", key: "pen" }, { header: "Simulado", key: "sim" }],
    rows: (await prisma.financialTransaction.findMany({ orderBy: { date: "asc" } })).map((t) => ({ code: t.code, date: day(t.date), type: t.type, cat: t.category, desc: t.description, cur: t.currency, amount: Number(t.amount), fx: Number(t.exchangeRate), pen: Number(t.amountPen), sim: t.simulated ? "Sí" : "No" })),
  }) },
  blockchain: { perm: "blockchain.read", title: "Transacciones blockchain", load: async () => ({
    columns: [{ header: "ID", key: "id" }, { header: "Contrato", key: "contract", width: 24 }, { header: "Función", key: "fn", width: 22 }, { header: "Actor", key: "actor", width: 12 }, { header: "Estado", key: "status", width: 12 }, { header: "Bloque", key: "block" }, { header: "Hash", key: "hash", width: 70 }, { header: "Error", key: "err", width: 50 }, { header: "Entidad", key: "entity", width: 18 }],
    rows: (await prisma.blockchainTransaction.findMany({ orderBy: { id: "asc" } })).map((t) => ({ id: t.id, contract: t.contractName, fn: t.functionName, actor: t.actor, status: t.status, block: t.blockNumber, hash: t.txHash ?? "(no minada)", err: t.errorMessage ?? "", entity: t.entityCode ?? "" })),
  }) },
};

reportsRouter.get("/excel/:entity.xlsx", requirePerm("reports.read"), ah(async (req, res) => {
  const e = EXPORTS[req.params.entity];
  if (!e) throw notFound("Exportación no disponible");
  if (!hasPerm(req, e.perm)) throw forbidden();
  const { columns, rows } = await e.load();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Don Pimentón ERP";
  const ws = wb.addWorksheet(e.title);
  ws.columns = columns.map((c) => ({ width: 12, ...c }));
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFA52A2A" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.addRow([]);
  ws.addRow(["Datos de demostración — Don Pimentón ERP"]);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.entity}-${day(new Date())}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));
