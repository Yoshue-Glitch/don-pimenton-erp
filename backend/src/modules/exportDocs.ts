/**
 * Documentos de exportación en PDF (demostración): proforma, confirmación, factura comercial,
 * packing list, contenido de paletas, instrucciones al agente, datos ISF y Prior Notice, COA,
 * certificación de origen, etiquetas GS1 con QR, ficha de cosecha y expediente del embarque.
 * Ninguno es un documento oficial: el ERP prepara los datos y los actores autorizados los transmiten.
 */
import { Response } from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma";
import { notFound } from "../lib/errors";
import { D } from "../lib/decimal";
import * as T from "./trade.service";
import { header, section, kv, table, footer, send, fmt, day, safe, RED, GREEN } from "./reports";

export const publicBase = () => process.env.PUBLIC_BASE_URL || "https://don-pimenton-erp.onrender.com";
export const traceUrl = (lot: string) => `${publicBase()}/trazabilidad/${encodeURIComponent(lot)}`;
const LEGAL = "DOCUMENTO DE DEMOSTRACIÓN · Datos ficticios · No es un comprobante electrónico SUNAT ni un documento oficial. El ERP prepara los datos; la transmisión a SUNAT, VUCE, FDA o CBP corresponde al agente de aduana, al importador o a su broker.";

export const DOC_TYPES: Record<string, string> = {
  proforma: "Factura proforma", confirmacion: "Confirmación de pedido", factura: "Factura comercial (demostración)", packing: "Packing list",
  paletas: "Lista de contenido de paletas", agente: "Instrucciones al agente de aduana", isf: "Datos para ISF 10+2", priornotice: "Datos para Prior Notice (FDA)",
  coa: "Certificado de análisis (demostración, no oficial)", origen: "Certificación de origen APC Perú–EE. UU. (borrador)", etiquetas: "Etiquetas GS1 y QR de trazabilidad",
  expediente: "Expediente del embarque", reporte: "Reporte final de la simulación de exportación",
};
/** Documentos que puede descargar el comprador / broker desde el portal. */
export const PORTAL_DOCS = ["proforma", "confirmacion", "factura", "packing", "paletas", "coa", "origen", "isf", "priornotice"];

async function load(id: number) {
  const s = await prisma.exportShipment.findUnique({
    where: { id },
    include: { customer: true, palletsList: { orderBy: { id: "asc" } }, costs: true, compliance: true, payments: true, events: { orderBy: { id: "asc" } }, agreement: true,
      lot: { include: { parentLot: { include: { labAnalyses: { orderBy: { id: "desc" } }, productionOrder: true, parentLot: { include: { harvest: true, campaign: { include: { parcel: true } } } } } } } } },
  });
  if (!s) throw notFound("Embarque no encontrado");
  return s;
}

const company: [string, string][] = [["Exportador", "Don Pimentón · Martha Torres (Gerencia General)"], ["RUC (demo)", "10304821499"], ["Dirección", "Caravelí / Arequipa, Perú"], ["Producto", "Páprika molida premium en frascos de vidrio de 113 g (4 oz)"]];

async function qr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size = 80) {
  const png = await QRCode.toBuffer(text, { margin: 1, width: size * 3, color: { dark: GREEN } });
  doc.image(png, x, y, { width: size });
}

export async function shipmentPdf(res: Response, id: number, type: string, opts: { hideCosts?: boolean } = {}) {
  const s = await load(id);
  const p = await T.params();
  const title = DOC_TYPES[type] ?? "Documento";
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `${title} ${s.code}`, Author: "Don Pimentón ERP" } });
  header(doc, `${title} · ${s.code}`, `Importador: ${s.importer} · ${s.incoterm} ${s.incotermVersion} ${s.incotermPlace} · ${s.country}`);
  const gt = T.gtinCodes(p.gs1CompanyPrefix);
  const totals = { net: s.palletsList.reduce((a, b) => a.plus(b.netKg), D(0)), gross: s.palletsList.reduce((a, b) => a.plus(b.grossKg), D(0)), cases: s.palletsList.reduce((a, b) => a + b.cases, 0), jars: s.palletsList.reduce((a, b) => a + b.jars, 0) };
  const goods = () => { section(doc, "Mercancía"); kv(doc, [["Descripción (catálogo aprobado, R3)", s.description], ["Subpartida nacional / HTS EE. UU.", `${s.hsCode} / ${s.htsCode}`], ["Cantidad", `${s.pallets} paleta(s) · ${s.cases} cajas · ${s.jars} frascos de ${p.jarNetG} g`], ["GTIN frasco / GTIN-14 caja", `${gt.gtin13} / ${gt.gtin14}`], ["Lote", s.lot?.code ?? "por asignar"], ["Peso neto / bruto", `${D(s.netKg).toFixed(3)} kg / ${D(s.grossKg).toFixed(3)} kg`], ["País de origen", "Perú — Product of Peru"]]); };
  const commercial = () => { section(doc, "Condiciones comerciales"); kv(doc, [["Precio por frasco", `US$ ${D(s.unitPriceUsd).toFixed(4)}`], ["Importe", `US$ ${fmt(s.amountUsd)}`], ["Incoterm", `${s.incoterm} (${s.incotermVersion}) — ${s.incotermPlace}`], ["Entrega", day(s.deliveryDate)], ["Condiciones de pago", s.paymentTerms], ["Broker", s.broker ?? "—"]]); };
  const palletsTable = () => table(doc, [{ h: "SSCC", w: 130 }, { h: "Lote", w: 95 }, { h: "Cajas", w: 45 }, { h: "Frascos", w: 55 }, { h: "Neto kg", w: 65 }, { h: "Bruto kg", w: 65 }, { h: "Best by", w: 60 }], s.palletsList.map((x) => [`(00) ${x.sscc}`, s.lot?.code ?? "", x.cases, x.jars, D(x.netKg).toFixed(3), D(x.grossKg).toFixed(3), day(x.bestBy)]));

  switch (type) {
    case "proforma": case "confirmacion": case "factura":
      section(doc, "Partes"); kv(doc, [...company, ["Importador", `${s.customer.name} · ${s.customer.address ?? ""}`], ["N.° de importador (demo)", s.customer.importerNumber ?? "—"]]);
      goods(); commercial();
      if (type === "confirmacion") { section(doc, "Confirmación"); kv(doc, [["Estado del pedido", s.status], ["Paletas reservadas", s.palletsList.map((x) => x.sscc).join(", ") || "pendiente"], ["Smart contract", s.agreement ? `${s.agreement.code} · ${s.agreement.status}` : "se crea al confirmar"]]); }
      if (type === "factura") { section(doc, "Totales"); kv(doc, [["Valor FCA/FOB", `US$ ${fmt(s.amountUsd)}`], ["Tributos", "Exportación no afecta a IGV (validar con contador)"], ["DAM", s.damNumber ?? "por numerar"]]); }
      break;
    case "packing": case "paletas":
      goods(); section(doc, type === "packing" ? "Detalle por paleta" : "Contenido de cada paleta"); palletsTable();
      section(doc, "Totales (R2: deben coincidir con la suma de paletas)");
      kv(doc, [["Bultos", `${totals.cases} cajas`], ["Frascos", totals.jars], ["Peso neto total", `${totals.net.toFixed(3)} kg`], ["Peso bruto total", `${totals.gross.toFixed(3)} kg`], ["Declarado en el paquete", `${D(s.declaredNetKg ?? 0).toFixed(3)} kg neto / ${D(s.declaredGrossKg ?? 0).toFixed(3)} kg bruto`], ["Estado documental", `${s.docsStatus}${(s.docsErrors as any[])?.length ? " · " + (s.docsErrors as any[]).join(" | ") : ""}`]]);
      if (type === "paletas") kv(doc, [["Composición", `${p.casesPerPallet} cajas × ${p.jarsPerCase} frascos = ${p.casesPerPallet * p.jarsPerCase} frascos por paleta`], ["Taras", `frasco ${p.jarTareG} g · caja ${p.caseTareKg} kg · paleta ${p.palletTareKg} kg (referenciales: confirmar pesando)`]]);
      break;
    case "agente":
      section(doc, "Instrucciones al agente de aduana"); kv(doc, [["Régimen", "Exportación definitiva (40) · DESPA-PG.02 · Aduana Marítima del Callao (118)"], ["Exportador", "Don Pimentón (RUC demo 10304821499)"], ["Subpartida", s.hsCode], ["Descripción", s.description], ["Bultos / peso", `${s.cases} cajas · neto ${D(s.netKg).toFixed(3)} kg · bruto ${D(s.grossKg).toFixed(3)} kg`], ["Valor FOB/FCA", `US$ ${fmt(s.amountUsd)}`], ["Incoterm", `${s.incoterm} ${s.incotermPlace}`], ["Plazos", `Embarcar en ≤ ${p.damShipDays} días desde la numeración; regularizar en ≤ ${p.regularizationDays} días desde el término del embarque`], ["Documentos adjuntos", "Factura, packing list, COA, certificación de origen, booking"]]);
      break;
    case "isf":
      section(doc, "Datos para ISF 10+2 (los presenta el importador o su broker ante CBP)"); kv(doc, [["1. Fabricante / proveedor", "Don Pimentón, Caravelí, Arequipa, Perú"], ["2. Vendedor", "Don Pimentón"], ["3. Comprador", s.customer.name], ["4. Destinatario (ship to)", s.customer.address ?? s.customer.name], ["5. Consolidador / lugar de llenado", "Terminal de carga, Callao, Perú"], ["6. Importador de registro", s.customer.importerNumber ?? "—"], ["7. Consignatario", s.customer.name], ["8. País de origen", "Perú"], ["9. HTS (6 dígitos)", s.htsCode.slice(0, 7)], ["10. Contenedor / nave", `${s.container ?? "por asignar"} / ${s.vessel ?? "por asignar"}`], ["Cierre de carga", day(s.cargoCutoff)], ["Plazo R6", `Enviar al importador ≥ ${p.isfHoursBeforeCutoff} h antes del cierre de carga · Enviado: ${day(s.isfSentAt)}`]]);
      break;
    case "priornotice":
      section(doc, "Datos para Prior Notice (FDA, lo presenta el importador o su broker)"); kv(doc, [["Producto", s.description], ["Código de producto FDA", "Spices, flavors and salts — paprika ground (validar en el Product Code Builder)"], ["Fabricante (FFR)", "Don Pimentón · registro de instalación FDA vigente (ver Cumplimiento)"], ["Cultivador", "Don Pimentón y productores asociados — Caravelí, Arequipa"], ["País de envío", "Perú"], ["Puerto de llegada", s.destinationPort], ["Cantidad", `${s.cases} cajas / ${s.jars} frascos`], ["Lote", s.lot?.code ?? "—"], ["N.° de confirmación", s.priorNoticeNo ?? "pendiente"]]);
      break;
    case "coa": {
      const a = s.lot?.parentLot?.labAnalyses.find((x) => x.result === "APROBADO") ?? s.lot?.parentLot?.labAnalyses[0];
      doc.fillColor(RED).font("Helvetica-Bold").fontSize(11).text("CERTIFICADO DE DEMOSTRACIÓN — NO OFICIAL", { align: "center" }); doc.fillColor("#1F2937").font("Helvetica").fontSize(9);
      section(doc, "Identificación"); kv(doc, [["Lote de frascos", s.lot?.code ?? "—"], ["Lote a granel", s.lot?.parentLot?.code ?? "—"], ["Análisis", a?.code ?? "—"], ["Laboratorio", a?.laboratory ?? "—"], ["Fecha de análisis", day(a?.analysisDate)], ["Aprobado por", `${a?.approvedBy ?? "—"} · ${day(a?.approvedAt)}`], ["Evidencia", a?.evidence ?? "—"], ["Hash del COA (SHA-256)", s.lot?.certHash ?? "—"]]);
      section(doc, "Resultados");
      table(doc, [{ h: "Parámetro", w: 170 }, { h: "Resultado", w: 90 }, { h: "Límite de referencia", w: 150 }, { h: "Evaluación", w: 90 }], ((a?.evaluation as any[]) ?? []).map((e) => [e.label, `${e.value ?? "—"} ${e.unit}`, e.limit, e.result]));
      doc.moveDown(); doc.fontSize(8).text(safe("Límites referenciales del plan de negocios; deben ajustarse a la especificación contractual y a la normativa aplicable. No sustituye el informe de un laboratorio acreditado."));
      break;
    }
    case "origen":
      section(doc, "Certificación de origen (campos mínimos, Anexo 8-C)"); kv(doc, [["1. Certificador", "Exportador: Don Pimentón · Martha Torres · RUC demo 10304821499 · Arequipa"], ["2. Productor", "Don Pimentón (Caravelí, Arequipa) y productores asociados"], ["3. Importador", `${s.customer.name} · ${s.customer.address ?? ""}`], ["4. Mercancía", `Pimentón (páprika) molido en frascos de 4 oz; ${s.cases} cajas de 24 frascos`], ["5. Clasificación", `HTS ${s.htsCode}; subpartida nacional ${s.hsCode}`], ["6. Criterio de origen", "Mercancía totalmente obtenida o producida en Perú"], ["7. Periodo", `Embarque ${s.code} · DAM ${s.damNumber ?? "por numerar"}`], ["8. Declaración", "«Certifico que la mercancía descrita es originaria del Perú y cumple los requisitos de origen del Acuerdo de Promoción Comercial Perú–Estados Unidos.»"], ["9. Firma", "Persona autorizada · fecha · teléfono · correo (completar)"]]);
      break;
    case "etiquetas": {
      const lot = s.lot?.code ?? "LOTE";
      const bestBy = s.palletsList[0]?.bestBy ?? s.lot?.expiryDate ?? null;
      section(doc, "Etiqueta del frasco (panel posterior)");
      kv(doc, [["Producto", "PREMIUM GROUND PAPRIKA · Pimentón molido"], ["Contenido neto", `NET WT ${p.jarNetG} g (4 oz)`], ["GTIN", gt.gtin13], ["Lote", lot], ["Best by", day(bestBy)], ["Origen", "PRODUCT OF PERU"]]);
      await qr(doc, traceUrl(lot), doc.page.width - 140, doc.y - 90, 85);
      section(doc, "Etiqueta de caja (24 frascos)"); kv(doc, [["GTIN-14", gt.gtin14], ["(10) Lote", lot], ["(15) Best by", day(bestBy)], ["Cantidad", `${p.jarsPerCase} × ${p.jarNetG} g`]]);
      for (const pl of s.palletsList) {
        section(doc, `Etiqueta logística de paleta · SSCC ${pl.sscc}`);
        kv(doc, [["(00) SSCC", pl.sscc], ["(02) GTIN-14 contenido", gt.gtin14], ["(37) Cajas", pl.cases], ["(10) Lote", lot], ["(15) Best by", day(pl.bestBy)], ["Neto / bruto", `${D(pl.netKg).toFixed(3)} / ${D(pl.grossKg).toFixed(3)} kg`]]);
        await qr(doc, `(00)${pl.sscc}(02)${gt.gtin14}(37)${pl.cases}(10)${lot}`, doc.page.width - 140, doc.y - 90, 80);
      }
      doc.moveDown().fontSize(8).text(safe("Códigos GS1 de demostración con prefijo ficticio: se reemplazan por los asignados por GS1 Perú (membresía)."));
      break;
    }
    case "expediente": case "reporte": {
      section(doc, "Información del lote y trazabilidad");
      const raw = s.lot?.parentLot?.parentLot;
      kv(doc, [["Lote de frascos", s.lot?.code ?? "—"], ["Lote a granel", s.lot?.parentLot?.code ?? "—"], ["Materia prima / cosecha", `${raw?.code ?? "—"} · ${raw?.harvest?.code ?? "—"} · ${day(raw?.harvest?.date)}`], ["Parcela", raw?.campaign?.parcel ? `${raw.campaign.parcel.code} · ${raw.campaign.parcel.location}` : "—"], ["Orden de producción", s.lot?.parentLot?.productionOrder ? `${s.lot.parentLot.productionOrder.code} · rendimiento ${D(s.lot.parentLot.productionOrder.yieldPct ?? 0).toFixed(2)} %` : "—"], ["QR de origen", traceUrl(s.lot?.code ?? "")]]);
      if (s.lot) await qr(doc, traceUrl(s.lot.code), doc.page.width - 130, doc.y - 80, 70);
      const a = s.lot?.parentLot?.labAnalyses.find((x) => x.result === "APROBADO");
      section(doc, "Resultado de calidad"); kv(doc, [["COA", a ? `${a.code} · ${a.result} · ${a.approvedBy} · ${day(a.approvedAt)}` : "sin COA aprobado"], ["Hash del COA", s.lot?.certHash ?? "—"]]);
      goods(); commercial();
      section(doc, "Documentación (R2/R3)"); kv(doc, [["Estado", s.docsStatus], ["Neto / bruto validados", `${totals.net.toFixed(3)} / ${totals.gross.toFixed(3)} kg`], ["Observaciones", ((s.docsErrors as any[]) ?? []).join(" | ") || "Sin discrepancias"]]);
      section(doc, "Estado aduanero"); const light = T.customsLight(s, p);
      kv(doc, [["DAM / canal", `${s.damNumber ?? "—"} · ${s.channel ?? "—"}`], ["Numeración / levante", `${day(s.damDate)} / ${day(s.levanteDate)}`], ["B/L · contenedor · nave", `${s.blNumber ?? "—"} · ${s.container ?? "—"} · ${s.vessel ?? "—"}`], ["Embarque / regularización", `${day(s.shipDate)} / ${day(s.regularizedAt)}`], ["Semáforo", `${light.light} · ${light.phase}`], ["ISF / Prior Notice", `${day(s.isfSentAt)} / ${s.priorNoticeNo ?? "—"}`]]);
      section(doc, "Cumplimiento del embarque"); table(doc, [{ h: "Requisito", w: 300 }, { h: "Autoridad", w: 100 }, { h: "Estado", w: 100 }], s.compliance.map((c) => [c.name, c.authority, c.status]));
      if (!opts.hideCosts) {
        const f = await T.shipmentFinance(prisma, s.id);
        section(doc, "Costos y margen (datos de prueba)"); table(doc, [{ h: "Concepto", w: 200 }, { h: "Presupuesto S/", w: 100 }, { h: "Real S/", w: 100 }], s.costs.map((c) => [c.concept, fmt(c.budgetPen), fmt(c.amountPen)]));
        kv(doc, [["Costo total", `S/ ${fmt(f.totalCostPen)}`], ["Costo por frasco", `S/ ${D(f.costPerJarPen ?? 0).toFixed(4)}`], ["Costo por paleta", `S/ ${fmt(f.costPerPalletPen)}`], ["Ingreso", `US$ ${fmt(f.revenueUsd)} × ${D(f.exchangeRate).toFixed(4)} = S/ ${fmt(f.revenuePen)}`], ["Margen por embarque", `${D(f.marginPct ?? 0).toFixed(2)} % = (ingreso − costos) ÷ ingreso × 100`]]);
      }
      section(doc, "Contrato inteligente");
      const txs = s.agreement ? await prisma.blockchainTransaction.findMany({ where: { entityCode: s.agreement.code, status: "CONFIRMADA" }, orderBy: { id: "asc" } }) : [];
      kv(doc, [["Acuerdo", s.agreement ? `${s.agreement.code} · ${s.agreement.status} · calidad ${s.agreement.qualityState} · entrega ${s.agreement.deliveryState}` : "—"], ["Contrato", s.agreement?.contractAddress ?? "—"]]);
      if (txs.length) table(doc, [{ h: "Función", w: 110 }, { h: "Actor", w: 60 }, { h: "Bloque", w: 45 }, { h: "Hash de transacción", w: 300 }], txs.map((t) => [t.functionName, t.actor, t.blockNumber, t.txHash]));
      section(doc, "Pagos"); table(doc, [{ h: "Pago", w: 90 }, { h: "Medio", w: 110 }, { h: "Importe", w: 90 }, { h: "Estado", w: 90 }, { h: "Modo", w: 110 }], s.payments.map((x) => [x.code, `${x.provider} · ${x.method}`, `${x.currency} ${fmt(x.amount)}`, x.status, x.livemode ? "REAL" : "prueba"]));
      section(doc, "Resultado final");
      kv(doc, [["Estado del embarque", s.status], ["OTIF", s.otif === null ? "—" : s.otif ? "Sí (a tiempo y completo)" : "No"], ["Cobrado", `US$ ${fmt(s.paidUsd)} de US$ ${fmt(s.amountUsd)}`]]);
      section(doc, "Bitácora automatizada"); table(doc, [{ h: "Fecha", w: 90 }, { h: "Regla", w: 80 }, { h: "Evento", w: 260 }, { h: "On-chain", w: 70 }], s.events.slice(-40).map((e) => [e.createdAt.toISOString().slice(0, 16).replace("T", " "), e.rule, e.message, e.txHash ? "tx ✓" : "ERP"]));
      break;
    }
    default: throw notFound("Tipo de documento no disponible");
  }
  footer(doc, LEGAL);
  send(res, doc, `${type}-${s.code}.pdf`);
}

/** Ficha de cosecha en PDF con QR de origen. */
export async function harvestPdf(res: Response, code: string) {
  const h = await prisma.harvest.findUnique({ where: { code }, include: { campaign: { include: { parcel: true } }, lot: { include: { childLots: { include: { childLots: true } } } } } });
  if (!h) throw notFound("Cosecha no encontrada");
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  header(doc, `Ficha de cosecha ${h.code}`, `Parcela ${h.campaign.parcel.code} · campaña ${h.campaign.code}`);
  section(doc, "Datos de la cosecha");
  kv(doc, [["Código", h.code], ["Fecha", day(h.date)], ["Parcela", `${h.campaign.parcel.code} · ${h.campaign.parcel.name} · ${h.campaign.parcel.location}`], ["Superficie", `${h.campaign.parcel.areaHa} ha`], ["Variedad", h.campaign.variety], ["Kilogramos recolectados", `${D(h.quantityKg).toFixed(3)} kg`], ["Observaciones", h.notes ?? "—"], ["Lote de materia prima", h.lot?.code ?? "—"]]);
  const p = await T.params();
  const mb = T.massBalance(p, Number(h.quantityKg));
  section(doc, "Balance de masa de referencia"); kv(doc, [["Relación del plan", `${p.freshPerKg} kg de fruto por 1 kg de páprika molida (≈ ${mb.expectedYieldPct} %)`], ["Producto esperado", `${mb.expectedFinalKg} kg ≈ ${mb.jarsPossible} frascos de ${p.jarNetG} g`], ["Descarte esperado en selección", `${mb.expectedDiscardKg} kg (${p.selectionDiscardPct} %)`]]);
  const downstream = h.lot?.childLots.flatMap((l) => [l.code, ...l.childLots.map((c) => c.code)]) ?? [];
  section(doc, "Historia de origen (QR)"); kv(doc, [["Lotes derivados", downstream.join(", ") || "aún sin procesar"], ["Consulta pública", traceUrl(downstream[downstream.length - 1] ?? h.lot?.code ?? h.code)]]);
  await qr(doc, traceUrl(downstream[downstream.length - 1] ?? h.lot?.code ?? h.code), 40, doc.y + 6, 110);
  footer(doc, LEGAL);
  send(res, doc, `ficha-cosecha-${h.code}.pdf`);
}
