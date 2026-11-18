/**
 * Hub de exportación de páprika molida en frascos de 4 oz (113 g) hacia EE. UU.
 * Implementa las tablas TI-10 a TI-15 y OP-1 a OP-9 del plan:
 *  R1 Ningún lote se reserva sin COA aprobado.
 *  R2 Pesos neto y bruto del packing list = suma de paletas y bultos.
 *  R3 Descripción y subpartida del catálogo aprobado.
 *  R4 DAM: embarque dentro de 30 días (semáforo 20 / 27 / 28).
 *  R5 Regularización dentro de 30 días del embarque (alertas 20, 25, 28).
 *  R6 Datos ISF al importador 48 h antes del cierre de carga.
 *  R7 Registros FDA / DIGESA / BPA vigentes (bloquea pedidos).
 *  R8 Margen bajo el piso de Gerencia requiere aprobación.
 * El ERP PREPARA los datos; no transmite nada a SUNAT, VUCE, FDA ni CBP.
 */
import { Prisma } from "@prisma/client";
import { prisma, Tx } from "../lib/prisma";
import { D, round2, round3 } from "../lib/decimal";
import { nextCode } from "../lib/sequence";
import { notFound, unprocessable } from "../lib/errors";
import { audit } from "../lib/audit";
import { getSetting } from "../lib/settings";
import { applyMovement, warehouseByCode, lotBalances } from "./inventory.service";
import { storeDocument } from "./documents";
import { sha256Hex } from "../lib/hash";

export type ExportParams = {
  jarNetG: number; jarsPerCase: number; casesPerPallet: number; jarTareG: number; caseTareKg: number; palletTareKg: number;
  freshPerKg: number; yieldPct: number; selectionDiscardPct: number; maxFinalMoisturePct: number; bestByMonths: number;
  gs1CompanyPrefix: string; hsCode: string; htsCode: string; approvedDescription: string; defaultPriceUsd: number; marginFloorPct: number;
  incotermVersion: string; damShipDays: number; damGreenUntil: number; damAmberUntil: number; regularizationDays: number;
  regularizationAlerts: number[]; isfHoursBeforeCutoff: number; originPort: string; destinationPort: string; voyageDays: number;
};
export type ExportLimits = { astaMin: number; astaMax: number; moistureMax: number; awMax: number; aflatoxinB1Max: number; aflatoxinTotalMax: number; ochratoxinAMax: number; ecoliMax: number; moldsYeastsMax: number; netWeightMinG: number };

export const params = async (db: Tx | typeof prisma = prisma) => getSetting<ExportParams>("export.params", db);
export const limits = async (db: Tx | typeof prisma = prisma) => getSetting<ExportLimits>("quality.exportLimits", db);
const DAY = 86400000;

// ------------------------------------------------------------------ GS1 (demostración)
/** Dígito de control GS1 (módulo 10, pesos 3-1 desde la derecha). */
export function gs1Check(body: string) {
  let s = 0;
  for (let i = 0; i < body.length; i++) s += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return String((10 - (s % 10)) % 10);
}
export function gtinCodes(prefix: string) {
  const body12 = (prefix + "00113").padEnd(12, "0").slice(0, 12);
  const gtin13 = body12 + gs1Check(body12);
  const body13 = "1" + body12; // indicador 1 = caja de 24
  const gtin14 = body13 + gs1Check(body13);
  return { gtin13, gtin14 };
}
export function sscc(prefix: string, serial: number) {
  const body = ("0" + prefix + String(serial).padStart(16 - prefix.length, "0")).slice(0, 17);
  return body + gs1Check(body);
}

// ------------------------------------------------------------------ cálculos físicos (sin redondeos ocultos)
export function packaging(p: ExportParams, jars: number) {
  const net = D(jars).times(p.jarNetG).div(1000);
  const cases = Math.ceil(jars / p.jarsPerCase);
  const fullPallets = Math.floor(jars / (p.jarsPerCase * p.casesPerPallet));
  const pallets = Math.ceil(jars / (p.jarsPerCase * p.casesPerPallet));
  const gross = net.plus(D(jars).times(p.jarTareG).div(1000)).plus(D(cases).times(p.caseTareKg)).plus(D(pallets).times(p.palletTareKg));
  return { jars, cases, pallets, fullPallets, looseJars: jars - fullPallets * p.jarsPerCase * p.casesPerPallet, netKg: round3(net), grossKg: round3(gross), planRoundedNetKg: Number((p.jarNetG * p.jarsPerCase * p.casesPerPallet / 1000).toFixed(1)) * pallets };
}
export const jarsPerPallet = (p: ExportParams) => p.jarsPerCase * p.casesPerPallet;
export function palletWeights(p: ExportParams) {
  const j = jarsPerPallet(p);
  const net = round3(D(j).times(p.jarNetG).div(1000));
  const gross = round3(net.plus(D(j).times(p.jarTareG).div(1000)).plus(D(p.casesPerPallet).times(p.caseTareKg)).plus(p.palletTareKg));
  return { jars: j, cases: p.casesPerPallet, netKg: net, grossKg: gross };
}

/** Balance de masa de referencia (8.075 kg de fruto por 1 kg) frente al real. */
export function massBalance(p: ExportParams, freshKg: number, finalKg?: number | null, discardKg?: number | null) {
  const expectedFinal = freshKg / p.freshPerKg;
  const expectedDiscard = freshKg * p.selectionDiscardPct / 100;
  return {
    freshKg, expectedFinalKg: Number(expectedFinal.toFixed(3)), expectedYieldPct: Number((100 / p.freshPerKg).toFixed(3)), planYieldPct: p.yieldPct,
    expectedDiscardKg: Number(expectedDiscard.toFixed(3)), realFinalKg: finalKg ?? null, realDiscardKg: discardKg ?? null,
    realYieldPct: finalKg ? Number((finalKg / freshKg * 100).toFixed(3)) : null,
    deviationKg: finalKg ? Number((finalKg - expectedFinal).toFixed(3)) : null,
    jarsPossible: finalKg ? Math.floor(finalKg * 1000 / p.jarNetG) : Math.floor(expectedFinal * 1000 / p.jarNetG),
  };
}

// ------------------------------------------------------------------ calidad de exportación (OP-8)
export function evaluateLab(l: ExportLimits, a: any) {
  const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
  const row = (param: string, label: string, value: any, ok: boolean | null, limit: string, unit = "") => ({ param, label, value, unit, limit, result: ok === null ? "SIN_DATO" : ok ? "CUMPLE" : "NO_CUMPLE" });
  const v = { asta: num(a.asta), moisture: num(a.moisturePct), aw: num(a.aw), b1: num(a.aflatoxinB1), tot: num(a.aflatoxinTotal), ota: num(a.ochratoxinA), ecoli: num(a.ecoli), my: num(a.moldsYeasts), net: num(a.netWeightG) };
  return [
    row("asta", "Color (grados ASTA)", v.asta, v.asta === null ? null : v.asta >= l.astaMin && v.asta <= l.astaMax, `${l.astaMin}–${l.astaMax}`, "ASTA"),
    row("moisture", "Humedad", v.moisture, v.moisture === null ? null : v.moisture <= l.moistureMax, `≤ ${l.moistureMax}`, "%"),
    row("aw", "Actividad de agua (aw)", v.aw, v.aw === null ? null : v.aw <= l.awMax, `≤ ${l.awMax} (sujeto a validación)`),
    row("salmonella", "Salmonella", a.salmonella ?? null, a.salmonella ? a.salmonella === "AUSENTE" : null, "Ausencia en 25 g"),
    row("ecoli", "E. coli", v.ecoli, v.ecoli === null ? null : v.ecoli <= l.ecoliMax, `≤ ${l.ecoliMax}`, "UFC/g"),
    row("molds", "Mohos y levaduras", v.my, v.my === null ? null : v.my <= l.moldsYeastsMax, `≤ ${l.moldsYeastsMax}`, "UFC/g"),
    row("b1", "Aflatoxina B1", v.b1, v.b1 === null ? null : v.b1 <= l.aflatoxinB1Max, `≤ ${l.aflatoxinB1Max}`, "µg/kg"),
    row("aflaTotal", "Aflatoxinas totales", v.tot, v.tot === null ? null : v.tot <= l.aflatoxinTotalMax, `≤ ${l.aflatoxinTotalMax}`, "µg/kg"),
    row("ota", "Ocratoxina A", v.ota, v.ota === null ? null : v.ota <= l.ochratoxinAMax, `≤ ${l.ochratoxinAMax} (según contrato)`, "µg/kg"),
    row("dyes", "Colorantes prohibidos (Sudán I–IV)", a.bannedDyes ?? null, a.bannedDyes ? a.bannedDyes === "NO_DETECTADO" : null, "No detectado"),
    row("foreign", "Materia extraña", a.foreignMatter ?? null, a.foreignMatter ? a.foreignMatter === "CONFORME" : null, "Conforme"),
    row("metal", "Control de metales", a.metalDetection ?? null, a.metalDetection ? a.metalDetection === "CONFORME" : null, "Conforme"),
    row("net", "Peso neto por frasco", v.net, v.net === null ? null : v.net >= l.netWeightMinG, `≥ ${l.netWeightMinG}`, "g"),
  ];
}

export async function registerLabAnalysis(tx: Tx, input: any, userId: number) {
  const lot = await tx.lot.findUnique({ where: { code: input.lotCode } });
  if (!lot) throw notFound(`Lote ${input.lotCode} no encontrado`);
  if (lot.type !== "PRODUCTO_TERMINADO") throw unprocessable("El análisis de exportación se registra sobre lotes de producto terminado");
  const evaluation = evaluateLab(await limits(tx), input);
  const outOfSpec = evaluation.some((e) => e.result === "NO_CUMPLE");
  const at = input.analysisDate ? new Date(input.analysisDate) : new Date();
  const a = await tx.labAnalysis.create({
    data: {
      code: await nextCode(tx, "LAB", at.getFullYear(), 4), lotId: lot.id, laboratory: input.laboratory, analysisDate: at,
      asta: input.asta ?? null, moisturePct: input.moisturePct ?? null, aw: input.aw ?? null, salmonella: input.salmonella ?? "AUSENTE",
      ecoli: input.ecoli ?? null, moldsYeasts: input.moldsYeasts ?? null, aflatoxinB1: input.aflatoxinB1 ?? null, aflatoxinTotal: input.aflatoxinTotal ?? null,
      ochratoxinA: input.ochratoxinA ?? null, bannedDyes: input.bannedDyes ?? "NO_DETECTADO", foreignMatter: input.foreignMatter ?? "CONFORME",
      metalDetection: input.metalDetection ?? "CONFORME", netWeightG: input.netWeightG ?? null, evaluation, result: outOfSpec ? "RETENIDO" : "EN_EVALUACION",
    },
  });
  if (outOfSpec) await holdLot(tx, lot.id, `Resultado fuera de especificación (${a.code})`, userId);
  else if (lot.qualityStatus === "PENDIENTE") await tx.lot.update({ where: { id: lot.id }, data: { qualityStatus: "EN_EVALUACION" } });
  await audit(tx, userId, "REGISTRAR_ANALISIS", "lab_analysis", a.id, { lot: lot.code, result: a.result });
  return { analysis: a, evaluation, retained: outOfSpec };
}

/** Retiene el lote: estado CUARENTENA ("retenido") y bloqueo del stock disponible. */
export async function holdLot(tx: Tx, lotId: number, reason: string, userId: number) {
  const lot = await tx.lot.update({ where: { id: lotId }, data: { qualityStatus: "CUARENTENA" } });
  const balances = await tx.inventoryBalance.findMany({ where: { lotId } });
  for (const b of balances) {
    if (D(b.availableKg).gt(0)) await applyMovement(tx, { type: "BLOQUEO_CUARENTENA", productId: b.productId, warehouseId: b.warehouseId, lotId, quantityKg: b.availableKg, reason, referenceType: "LAB_ANALYSIS", referenceCode: lot.code, userId });
  }
  await tx.pallet.updateMany({ where: { lotId, status: "DISPONIBLE" }, data: { status: "RETENIDO" } });
  return lot;
}

export async function decideLabAnalysis(tx: Tx, id: number, input: { decision: "APROBADO" | "RECHAZADO"; evidence?: string }, user: { id: number; name: string; roleName: string }) {
  const a = await tx.labAnalysis.findUnique({ where: { id }, include: { lot: true } });
  if (!a) throw notFound();
  if (["APROBADO", "RECHAZADO"].includes(a.result)) throw unprocessable("El análisis ya tiene una decisión registrada");
  const ev = (a.evaluation as any[]) ?? [];
  if (input.decision === "APROBADO" && ev.some((e) => e.result !== "CUMPLE")) {
    throw unprocessable("No se puede aprobar el COA: hay parámetros fuera de especificación o sin dato. El lote permanece retenido.", { failing: ev.filter((e) => e.result !== "CUMPLE") });
  }
  const at = new Date();
  let coaHash: string | null = null;
  if (input.decision === "APROBADO") {
    const text = coaText(a, ev, user, at);
    const doc = await storeDocument(tx, { buffer: Buffer.from(text), originalname: `COA-DEMO-${a.lot.code}.txt`, mimetype: "text/plain" }, { title: `COA de demostración ${a.lot.code} (no oficial)`, type: "COA", entityType: "lot", entityId: a.lot.code }, user.id);
    coaHash = "0x" + doc.sha256;
    await tx.lot.update({ where: { id: a.lotId }, data: { qualityStatus: "APROBADO", certHash: coaHash } });
    for (const b of await tx.inventoryBalance.findMany({ where: { lotId: a.lotId } })) {
      if (D(b.quarantineKg).gt(0)) await applyMovement(tx, { type: "LIBERACION_CUARENTENA", productId: b.productId, warehouseId: b.warehouseId, lotId: a.lotId, quantityKg: b.quarantineKg, reason: `COA aprobado (${a.code})`, referenceType: "LAB_ANALYSIS", referenceCode: a.code, userId: user.id });
    }
    await tx.pallet.updateMany({ where: { lotId: a.lotId, status: "RETENIDO" }, data: { status: "DISPONIBLE" } });
  } else {
    await tx.lot.update({ where: { id: a.lotId }, data: { qualityStatus: "RECHAZADO", status: "BLOQUEADO" } });
    await holdLot(tx, a.lotId, `COA rechazado (${a.code})`, user.id);
    await tx.lot.update({ where: { id: a.lotId }, data: { qualityStatus: "RECHAZADO" } });
  }
  const out = await tx.labAnalysis.update({ where: { id }, data: { result: input.decision, approvedBy: `${user.name} · ${user.roleName}`, approvedAt: at, evidence: input.evidence ?? `Informe de ensayo ${a.laboratory} ${a.code}`, coaHash } });
  await audit(tx, user.id, input.decision === "APROBADO" ? "APROBAR_COA" : "RECHAZAR_COA", "lab_analysis", id, { lot: a.lot.code, evidence: out.evidence, coaHash });
  return out;
}

function coaText(a: any, ev: any[], user: { name: string; roleName: string }, at: Date) {
  return [
    "CERTIFICADO DE ANÁLISIS — DOCUMENTO DE DEMOSTRACIÓN (NO OFICIAL)",
    "Don Pimentón · Caravelí / Arequipa, Perú · Producto: páprika molida en frascos de 113 g (4 oz)",
    `Lote: ${a.lot.code}   Análisis: ${a.code}   Laboratorio: ${a.laboratory}   Fecha: ${new Date(a.analysisDate).toISOString().slice(0, 10)}`,
    "", "Parámetro | Resultado | Límite de referencia | Evaluación",
    ...ev.map((e) => `${e.label} | ${e.value ?? "—"} ${e.unit} | ${e.limit} | ${e.result}`),
    "", `Aprobado por: ${user.name} (${user.roleName}) el ${at.toISOString()}`,
    "Los límites son referencias del plan de negocios y deben ajustarse a la especificación contractual y a la normativa aplicable.",
    "Este documento NO sustituye el informe de ensayo de un laboratorio acreditado.",
  ].join("\n");
}

/** R1: el lote (o su lote de origen a granel) tiene COA aprobado. */
export async function coaApproved(db: Tx | typeof prisma, lotId: number): Promise<{ ok: boolean; reason: string; analysis?: any }> {
  const lot = await db.lot.findUnique({ where: { id: lotId }, include: { parentLot: true } });
  if (!lot) return { ok: false, reason: "Lote inexistente" };
  if (lot.qualityStatus !== "APROBADO") return { ok: false, reason: `R1: el lote ${lot.code} está ${lot.qualityStatus.toLowerCase()} (sin COA aprobado)` };
  const ids = [lot.id, lot.parentLotId].filter(Boolean) as number[];
  const lab = await db.labAnalysis.findFirst({ where: { lotId: { in: ids }, result: "APROBADO" }, orderBy: { approvedAt: "desc" } });
  const insp = lab ? null : await db.qualityInspection.findFirst({ where: { lotId: { in: ids }, status: "APROBADO" } });
  if (!lab && !insp) return { ok: false, reason: `R1: el lote ${lot.code} no tiene un COA aprobado registrado` };
  return { ok: true, reason: "COA aprobado", analysis: lab ?? insp };
}

// ------------------------------------------------------------------ envasado → frascos, cajas y paletas
export async function packLot(tx: Tx, input: { sourceLotCode: string; pallets?: number; jars?: number; at?: Date }, userId: number) {
  const p = await params(tx);
  const src = await tx.lot.findUnique({ where: { code: input.sourceLotCode }, include: { product: true } });
  if (!src) throw notFound(`Lote ${input.sourceLotCode} no encontrado`);
  if (src.type !== "PRODUCTO_TERMINADO" || src.product.code !== "PT-PAP-MOL-25") throw unprocessable("Se envasa páprika molida a granel (lote de producto terminado PT-PAP-MOL-25)");
  const r1 = await coaApproved(tx, src.id);
  if (!r1.ok) throw unprocessable(`No se puede envasar para exportación. ${r1.reason}`);
  const jars = input.jars ?? (input.pallets ?? 1) * jarsPerPallet(p);
  if (!Number.isInteger(jars) || jars <= 0) throw unprocessable("Cantidad de frascos inválida");
  const pk = packaging(p, jars);
  const bal = await lotBalances(tx, src.id);
  if (bal.available.lt(pk.netKg)) throw unprocessable(`Páprika a granel insuficiente en el lote ${src.code}: disponible ${bal.available.toFixed(3)} kg, se requieren ${pk.netKg.toFixed(3)} kg (${jars} × ${p.jarNetG} g).`);
  const at = input.at ?? new Date();
  const whPT = await warehouseByCode(tx, "ALM-PT");
  const whIns = await warehouseByCode(tx, "ALM-INS");
  const jarProduct = await tx.product.findUniqueOrThrow({ where: { code: "PT-PAP-FRASCO-113" } });
  const yyyy = at.getFullYear(), mm = String(at.getMonth() + 1).padStart(2, "0");
  const code = await nextCode(tx, `LOTE-${yyyy}-${mm}`, null, 3);
  const bestBy = new Date(at); bestBy.setMonth(bestBy.getMonth() + p.bestByMonths);
  // consumo de la páprika a granel
  await applyMovement(tx, { type: "CONSUMO_PRODUCCION", productId: src.productId, warehouseId: whPT.id, lotId: src.id, quantityKg: pk.netKg, reason: `Envasado de ${jars} frascos de ${p.jarNetG} g → lote ${code}`, referenceType: "PACKING", referenceCode: code, userId, at });
  // consumo de materiales de empaque (unidades)
  const materials: [string, number][] = [["EMP-FRASCO-4OZ", jars], ["EMP-TAPA-DOSIF", jars], ["EMP-SELLO-INDUC", jars], ["EMP-ETIQUETA-US", jars * 2], ["EMP-CAJA-24", pk.cases], ["EMP-PALETA-GMA", pk.pallets]];
  for (const [mcode, qty] of materials) {
    const m = await tx.product.findUnique({ where: { code: mcode } });
    if (!m) throw unprocessable(`Falta el material de empaque ${mcode} en el catálogo`);
    await applyMovement(tx, { type: "CONSUMO_PRODUCCION", productId: m.id, warehouseId: whIns.id, quantityKg: qty, reason: `Envasado lote ${code}`, referenceType: "PACKING", referenceCode: code, userId, at });
  }
  const costs = await getSetting<Record<string, number>>("costs.perJarPen", tx);
  const unitCostKg = D(costs.AGRICOLA + costs.SECADO + costs.TRATAMIENTO + costs.MOLIENDA + costs.ENVASADO + costs.EMBALAJE).times(1000).div(p.jarNetG).toDecimalPlaces(4);
  const lot = await tx.lot.create({
    data: {
      code, type: "PRODUCTO_TERMINADO", productId: jarProduct.id, campaignId: src.campaignId, parentLotId: src.id, quantityKg: pk.netKg,
      productionDate: at, expiryDate: bestBy, status: "EN_ALMACEN", qualityStatus: src.qualityStatus, certHash: src.certHash, unitCost: unitCostKg,
    },
  });
  await applyMovement(tx, { type: "ENTRADA", productId: jarProduct.id, warehouseId: whPT.id, lotId: lot.id, quantityKg: pk.netKg, unitCost: unitCostKg, reason: `Producto envasado: ${jars} frascos · ${pk.cases} cajas · ${pk.fullPallets} paleta(s)`, referenceType: "PACKING", referenceCode: code, userId, at });
  const pw = palletWeights(p);
  const pallets = [];
  for (let i = 0; i < pk.fullPallets; i++) {
    const serial = Number((await nextCode(tx, "SSCC", null, 1)).split("-").pop());
    pallets.push(await tx.pallet.create({ data: { sscc: sscc(p.gs1CompanyPrefix, serial), lotId: lot.id, cases: pw.cases, jars: pw.jars, netKg: pw.netKg, grossKg: pw.grossKg, bestBy, location: `ALM-PT · Rack A-0${(i % 4) + 1}` } }));
  }
  await audit(tx, userId, "ENVASAR", "lote", lot.id, { source: src.code, jars, cases: pk.cases, pallets: pk.fullPallets, netKg: pk.netKg.toString() });
  return {
    lot, palletList: pallets, ...pk, gtin: gtinCodes(p.gs1CompanyPrefix), bestBy,
    sourceLot: src.code, sourceRemainingKg: bal.available.minus(pk.netKg).toFixed(3),
    note: `Peso neto exacto ${pk.netKg.toFixed(3)} kg (${jars} × ${p.jarNetG} g). Referencia redondeada del plan: ${pk.planRoundedNetKg} kg (diferencia ${(pk.planRoundedNetKg - Number(pk.netKg)).toFixed(3)} kg, no es merma física).`,
  };
}

// ------------------------------------------------------------------ cumplimiento (R7)
export const COMPANY_COMPLIANCE: [string, string, string, number | null, string][] = [
  // code, name, authority, días de vigencia desde hoy (null = sin vencimiento), responsable
  ["FDA-FFR", "Registro de instalación alimentaria FDA (FFR) y número UFI", "FDA", 44, "Jefe de Exportaciones"],
  ["FDA-AGENT", "Agente en EE. UU. designado y DUNS", "FDA", 300, "Jefe de Exportaciones"],
  ["FSMA-PCQI", "Plan de inocuidad FSMA firmado por el PCQI (controles preventivos)", "FDA", 365, "Supervisor de Calidad"],
  ["FSVP", "Información FSVP del importador (verificación de proveedor extranjero)", "Importador", 365, "Jefe de Exportaciones"],
  ["DIGESA-RS", "Registro sanitario DIGESA del producto", "DIGESA", 420, "Supervisor de Calidad"],
  ["SENASA-BPA", "Buenas Prácticas Agrícolas (BPA) — acompañamiento SENASA", "SENASA", 200, "Área Agrícola"],
  ["BPM-HACCP", "Buenas Prácticas de Manufactura (BPM) en planta", "DIGESA", 250, "Supervisor de Calidad"],
  ["SUNAT-RUC", "RUC activo y habido, régimen RER y factura electrónica de exportación", "SUNAT", null, "Gerencia"],
  ["SUNAT-SOL", "Clave SOL operativa y usuario VUCE", "SUNAT", null, "Logística"],
  ["FDA-LABEL", "Etiquetado EE. UU. (21 CFR 101, «Product of Peru» 19 CFR 134, alérgenos, Nutrition Facts)", "FDA / CBP", 365, "Marketing"],
];
export const SHIPMENT_CHECKLIST: [string, string, string, boolean][] = [
  ["PRIOR-NOTICE", "Prior Notice FDA con número de confirmación (lo presenta el importador/broker)", "FDA", true],
  ["ISF-10+2", "Datos ISF 10+2 enviados al importador ≥ 48 h antes del cierre de carga (R6)", "CBP", true],
  ["COA", "COA del lote completo y aprobado (R1)", "Calidad", true],
  ["ORIGEN-APC", "Certificación de origen APC Perú–EE. UU. (Anexo 8-C)", "MINCETUR / importador", true],
  ["FACTURA-PL", "Factura de exportación y packing list coherentes (R2, R3)", "SUNAT", true],
  ["DAM", "DAM numerada y canal asignado (DESPA-PG.02)", "SUNAT", true],
  ["BL", "B/L definitivo recibido", "Naviera", true],
  ["REGULARIZACION", "DAM regularizada dentro de 30 días del embarque (R5)", "SUNAT", true],
  ["FITOSANITARIO", "Certificado fitosanitario SENASA (si el importador lo exige)", "SENASA", false],
];

export function complianceStatus(item: { status: string; validUntil: Date | null; evidence: string | null; mandatory: boolean }, ref = new Date()) {
  if (item.status === "NO_APLICABLE") return "NO_APLICABLE";
  if (item.validUntil) {
    const days = Math.floor((new Date(item.validUntil).getTime() - ref.getTime()) / DAY);
    if (days < 0) return "VENCIDO";
    if (!item.evidence) return "REQUIERE_VALIDACION";
    if (days <= 45) return "POR_VENCER";
  }
  if (item.status === "CUMPLIDO" && !item.evidence) return "REQUIERE_VALIDACION";
  return item.status;
}

/** R7: devuelve los registros obligatorios vencidos (o que vencen antes de la fecha de embarque). */
export async function complianceBlockers(db: Tx | typeof prisma, shipDate?: Date) {
  const items = await db.complianceItem.findMany({ where: { scope: "EMPRESA", mandatory: true } });
  const blockers: { code: string; name: string; reason: string }[] = [];
  for (const it of items) {
    const st = complianceStatus(it);
    if (st === "VENCIDO") blockers.push({ code: it.code, name: it.name, reason: `vencido el ${it.validUntil?.toISOString().slice(0, 10)}` });
    else if (shipDate && it.validUntil && it.validUntil < shipDate && ["FDA-FFR", "DIGESA-RS", "SENASA-BPA"].includes(it.code)) blockers.push({ code: it.code, name: it.name, reason: `vence (${it.validUntil.toISOString().slice(0, 10)}) antes del embarque` });
  }
  return blockers;
}

// ------------------------------------------------------------------ pedidos / embarques
export async function estimateCosts(db: Tx | typeof prisma, jars: number) {
  const c = await getSetting<Record<string, number>>("costs.perJarPen", db);
  const rows = Object.entries(c).map(([concept, perJar]) => ({ concept, amountPen: round2(D(perJar).times(jars)) }));
  return { rows, total: rows.reduce((s, r) => s.plus(r.amountPen), D(0)) };
}

export async function quote(db: Tx | typeof prisma, input: { pallets: number; unitPriceUsd?: number; exchangeRate?: number; incoterm?: string }) {
  const p = await params(db);
  const fx = input.exchangeRate ?? (await getSetting<number>("fx.defaultUsdPen", db));
  const jars = input.pallets * jarsPerPallet(p);
  const pk = packaging(p, jars);
  const price = input.unitPriceUsd ?? p.defaultPriceUsd;
  const amountUsd = round2(D(price).times(jars));
  const cost = await estimateCosts(db, jars);
  const revenuePen = amountUsd.times(fx);
  const marginPct = revenuePen.gt(0) ? revenuePen.minus(cost.total).div(revenuePen).times(100).toDecimalPlaces(2) : D(0);
  return {
    pallets: input.pallets, cases: pk.cases, jars, netKg: pk.netKg, grossKg: pk.grossKg, unitPriceUsd: price, amountUsd, exchangeRate: fx,
    incoterm: input.incoterm ?? "FCA", incotermVersion: p.incotermVersion, costPen: round2(cost.total), costPerJarPen: cost.total.div(jars).toDecimalPlaces(4),
    marginPct, marginFloorPct: p.marginFloorPct, needsApproval: marginPct.lt(p.marginFloorPct), costs: cost.rows,
    gtin: gtinCodes(p.gs1CompanyPrefix), hsCode: p.hsCode, htsCode: p.htsCode, description: p.approvedDescription,
  };
}

export async function createShipment(tx: Tx, input: { customerId: number; pallets: number; unitPriceUsd?: number; incoterm?: string; incotermPlace?: string; deliveryDate: Date; paymentTerms?: string; broker?: string | null; exchangeRate?: number; source?: string; status?: "COTIZACION" | "PEDIDO"; notes?: string; agentEmail?: string | null }, userId: number) {
  const p = await params(tx);
  const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw notFound("Cliente no encontrado");
  if (!["FCA", "FOB"].includes(input.incoterm ?? "FCA")) throw unprocessable("Incoterms permitidos para este producto: FCA o FOB");
  if (input.pallets < 1 || input.pallets > 20) throw unprocessable("El pedido debe ser de 1 a 20 paletas");
  if ((input.status ?? "PEDIDO") === "PEDIDO") {
    const blockers = await complianceBlockers(tx, input.deliveryDate);
    if (blockers.length) throw unprocessable(`R7 — Pedido bloqueado: hay registros obligatorios vencidos o por vencer antes del embarque: ${blockers.map((b) => `${b.name} (${b.reason})`).join("; ")}`, { blockers });
  }
  const q = await quote(tx, input);
  const year = new Date().getFullYear();
  const s = await tx.exportShipment.create({
    data: {
      code: await nextCode(tx, "EMB", year, 3), customerId: customer.id, source: input.source ?? "ERP", importer: customer.name, broker: input.broker ?? null,
      country: customer.country, pallets: q.pallets, cases: q.cases, jars: q.jars, netKg: q.netKg, grossKg: q.grossKg, unitPriceUsd: q.unitPriceUsd, amountUsd: q.amountUsd,
      exchangeRate: q.exchangeRate, incoterm: q.incoterm, incotermVersion: q.incotermVersion, incotermPlace: input.incotermPlace ?? (q.incoterm === "FOB" ? "Callao, Perú (a bordo)" : "Terminal de carga Callao, Perú"),
      deliveryDate: input.deliveryDate, paymentTerms: input.paymentTerms ?? "Escrow smart contract (red local) + pago real por pasarela", status: input.status ?? "PEDIDO",
      marginPct: q.marginPct, marginApproved: !q.needsApproval, hsCode: p.hsCode, htsCode: p.htsCode, description: p.approvedDescription,
      originPort: p.originPort, destinationPort: p.destinationPort, voyageDays: p.voyageDays, notes: input.notes, agentEmail: input.agentEmail ?? "agente@aduanas-demo.pe",
      costs: { create: q.costs.map((c) => ({ concept: c.concept, amountPen: c.amountPen, budgetPen: c.amountPen, dataKind: "DEMO" })) },
      compliance: { create: SHIPMENT_CHECKLIST.map(([code, name, authority, mandatory]) => ({ code, name, authority, scope: "EMBARQUE", mandatory, status: code === "FITOSANITARIO" ? "NO_APLICABLE" : "PENDIENTE" })) },
    },
  });
  await event(tx, s.id, "PEDIDO", `${s.status === "COTIZACION" ? "Cotización" : "Pedido"} ${s.code}: ${q.pallets} paleta(s) = ${q.cases} cajas = ${q.jars} frascos (${q.netKg.toFixed(3)} kg netos) · ${q.incoterm} ${q.incotermVersion} · US$ ${q.amountUsd.toFixed(2)}`, "info");
  if (q.needsApproval) await event(tx, s.id, "R8", `Margen estimado ${q.marginPct.toFixed(2)} % < piso de Gerencia ${p.marginFloorPct} %: requiere aprobación antes de confirmar`, "warning");
  await audit(tx, userId, "CREAR", "embarque", s.id, { code: s.code, pallets: q.pallets, amountUsd: q.amountUsd.toString() });
  return s;
}

export async function event(tx: Tx | typeof prisma, shipmentId: number | null, rule: string, message: string, level = "info", txHash?: string | null) {
  return tx.automationEvent.create({ data: { shipmentId, rule, message, level, chain: !!txHash, txHash: txHash ?? null } });
}

export async function validateQuality(tx: Tx, id: number, userId: number) {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id } });
  if (!["PEDIDO", "CALIDAD_VALIDADA"].includes(s.status)) throw unprocessable(`El pedido está en estado ${s.status}`);
  const candidates = await tx.pallet.findMany({ where: { status: "DISPONIBLE", shipmentId: null }, include: { lot: true }, orderBy: { bestBy: "asc" } });
  const ok = [];
  for (const pl of candidates) if ((await coaApproved(tx, pl.lotId)).ok) ok.push(pl);
  if (ok.length < s.pallets) throw unprocessable(`R1 — Solo hay ${ok.length} paleta(s) con COA aprobado disponibles; el pedido requiere ${s.pallets}. Envase y apruebe un lote antes de continuar.`);
  const out = await tx.exportShipment.update({ where: { id }, data: { status: "CALIDAD_VALIDADA" } });
  await event(tx, id, "R1", `Validación de calidad: ${ok.length} paleta(s) disponibles con COA aprobado`, "success");
  await audit(tx, userId, "VALIDAR_CALIDAD", "embarque", id, {});
  return out;
}

/** P3: reserva paletas completas (96 cajas y 2,304 frascos por paleta) de lotes con COA aprobado (R1). */
export async function reserveShipment(tx: Tx, id: number, userId: number, preferLotId?: number) {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id }, include: { palletsList: true } });
  if (s.palletsList.length >= s.pallets) return { shipment: s, pallets: s.palletsList, reused: true };
  if (!["PEDIDO", "CALIDAD_VALIDADA"].includes(s.status)) throw unprocessable(`No se puede reservar un pedido en estado ${s.status}`);
  const p = await params(tx);
  const need = s.pallets - s.palletsList.length;
  const candidates = (await tx.pallet.findMany({ where: { status: "DISPONIBLE", shipmentId: null }, include: { lot: true }, orderBy: [{ bestBy: "asc" }, { id: "asc" }] }))
    .sort((a, b) => (preferLotId ? Number(b.lotId === preferLotId) - Number(a.lotId === preferLotId) : 0));
  const chosen = [];
  for (const pl of candidates) {
    if (chosen.length === need) break;
    const r1 = await coaApproved(tx, pl.lotId);
    if (r1.ok) chosen.push(pl);
  }
  if (chosen.length < need) throw unprocessable(`R1 — No hay paletas suficientes con COA aprobado (disponibles ${chosen.length}, requeridas ${need}). Ningún lote puede reservarse sin COA aprobado.`);
  const wh = await warehouseByCode(tx, "ALM-PT");
  for (const pl of chosen) {
    // reserva condicional: evita que dos pedidos tomen la misma paleta
    const upd = await tx.pallet.updateMany({ where: { id: pl.id, status: "DISPONIBLE", shipmentId: null }, data: { status: "RESERVADO", shipmentId: id } });
    if (upd.count !== 1) throw unprocessable(`La paleta ${pl.sscc} acaba de ser reservada por otro pedido; reintente`);
    await applyMovement(tx, { type: "RESERVA", productId: pl.lot.productId, warehouseId: wh.id, lotId: pl.lotId, quantityKg: pl.netKg, reason: `Reserva de paleta SSCC ${pl.sscc} (${pl.cases} cajas · ${pl.jars} frascos) para ${s.code}`, referenceType: "EXPORT_SHIPMENT", referenceCode: s.code, userId });
  }
  const out = await tx.exportShipment.update({ where: { id }, data: { status: "RESERVADO", lotId: chosen[0].lotId } });
  const cases = chosen.reduce((a, b) => a + b.cases, 0), jars = chosen.reduce((a, b) => a + b.jars, 0);
  await event(tx, id, "RESERVA", `Reservadas ${chosen.length} paleta(s): ${cases} cajas y ${jars} frascos (${chosen.map((c) => c.sscc).join(", ")}) del lote ${chosen[0].lot.code}`, "success");
  await audit(tx, userId, "RESERVAR", "embarque", id, { pallets: chosen.map((c) => c.sscc), cases, jars, jarsPerPallet: jarsPerPallet(p) });
  return { shipment: out, pallets: chosen, cases, jars };
}

export async function approveMargin(tx: Tx, id: number, user: { id: number; name: string }) {
  const s = await tx.exportShipment.update({ where: { id }, data: { marginApproved: true, marginApprovedBy: user.name } });
  await event(tx, id, "R8", `Margen ${D(s.marginPct ?? 0).toFixed(2)} % aprobado por Gerencia (${user.name})`, "success");
  await audit(tx, user.id, "APROBAR_MARGEN", "embarque", id, { marginPct: s.marginPct?.toString() });
  return s;
}

export async function confirmShipment(tx: Tx, id: number, userId: number) {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id } });
  if (["CONFIRMADO", "DOCUMENTACION"].includes(s.status)) return s;
  if (s.status !== "RESERVADO") throw unprocessable("Solo se confirman pedidos con stock reservado");
  if (!s.marginApproved) throw unprocessable(`R8 — El margen estimado (${D(s.marginPct ?? 0).toFixed(2)} %) está por debajo del piso aprobado: requiere aprobación de Gerencia`);
  const blockers = await complianceBlockers(tx, s.deliveryDate);
  if (blockers.length) throw unprocessable(`R7 — Confirmación bloqueada: ${blockers.map((b) => `${b.name} (${b.reason})`).join("; ")}`, { blockers });
  const out = await tx.exportShipment.update({ where: { id }, data: { status: s.docsStatus === "APROBADO" ? "DOCUMENTACION" : "CONFIRMADO" } });
  await event(tx, id, "CONFIRMACION", `Pedido ${s.code} confirmado. Se emite la confirmación de pedido y se prepara el embarque.`, "success");
  await audit(tx, userId, "CONFIRMAR", "embarque", id, {});
  return out;
}

/** R2 + R3: valida el paquete documental. Si hay discrepancias, bloquea la aprobación. */
export async function validateDocs(tx: Tx, id: number, input: { declaredNetKg?: number; declaredGrossKg?: number; description?: string; hsCode?: string }, userId: number) {
  const p = await params(tx);
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id }, include: { palletsList: true } });
  if (!s.palletsList.length) throw unprocessable("El embarque no tiene paletas reservadas");
  const sumNet = s.palletsList.reduce((a, b) => a.plus(b.netKg), D(0));
  const sumGross = s.palletsList.reduce((a, b) => a.plus(b.grossKg), D(0));
  const sumCases = s.palletsList.reduce((a, b) => a + b.cases, 0);
  const declaredNet = input.declaredNetKg !== undefined ? D(input.declaredNetKg) : sumNet;
  const declaredGross = input.declaredGrossKg !== undefined ? D(input.declaredGrossKg) : sumGross;
  const description = input.description ?? p.approvedDescription;
  const hsCode = input.hsCode ?? p.hsCode;
  const errors: string[] = [];
  if (!declaredNet.eq(sumNet)) errors.push(`R2: peso neto declarado ${declaredNet.toFixed(3)} kg ≠ suma de paletas ${sumNet.toFixed(3)} kg (diferencia ${declaredNet.minus(sumNet).toFixed(3)} kg)`);
  if (!declaredGross.eq(sumGross)) errors.push(`R2: peso bruto declarado ${declaredGross.toFixed(3)} kg ≠ suma de paletas ${sumGross.toFixed(3)} kg (diferencia ${declaredGross.minus(sumGross).toFixed(3)} kg)`);
  if (sumCases !== s.cases) errors.push(`R2: bultos en paletas (${sumCases}) ≠ bultos del pedido (${s.cases})`);
  if (description.trim().toUpperCase() !== p.approvedDescription.toUpperCase()) errors.push(`R3: la descripción «${description}» no corresponde al catálogo aprobado`);
  if (hsCode !== p.hsCode) errors.push(`R3: la subpartida ${hsCode} no corresponde al catálogo aprobado (${p.hsCode})`);
  const lot = s.lotId ? await coaApproved(tx, s.lotId) : { ok: false, reason: "Sin lote" };
  if (!lot.ok) errors.push(lot.reason);
  const okStatus = errors.length === 0;
  const out = await tx.exportShipment.update({
    where: { id },
    data: { docsStatus: okStatus ? "APROBADO" : "RECHAZADO", docsErrors: errors, declaredNetKg: declaredNet, declaredGrossKg: declaredGross, docsApprovedAt: okStatus ? new Date() : null, ...(okStatus && s.status === "CONFIRMADO" ? { status: "DOCUMENTACION" } : {}) },
  });
  if (okStatus) {
    await tx.complianceItem.updateMany({ where: { shipmentId: id, code: { in: ["FACTURA-PL", "COA"] } }, data: { status: "CUMPLIDO", evidence: `Paquete documental ${s.code} validado (R2/R3)` } });
    await event(tx, id, "R2/R3", `Paquete documental aprobado: neto ${sumNet.toFixed(3)} kg, bruto ${sumGross.toFixed(3)} kg, ${sumCases} bultos, subpartida ${p.hsCode}`, "success");
  } else await event(tx, id, "R2/R3", `Paquete documental RECHAZADO: ${errors.join(" · ")}`, "danger");
  await audit(tx, userId, okStatus ? "APROBAR_DOCUMENTOS" : "RECHAZAR_DOCUMENTOS", "embarque", id, { errors });
  return { shipment: out, ok: okStatus, errors, totals: { netKg: sumNet, grossKg: sumGross, cases: sumCases, jars: s.palletsList.reduce((a, b) => a + b.jars, 0) } };
}

/** Semáforo R4/R5 y tareas R6. */
export function customsLight(s: { damDate: Date | null; shipDate: Date | null; regularizedAt: Date | null; cargoCutoff?: Date | null; isfSentAt?: Date | null }, p: ExportParams, now = new Date()) {
  const alerts: { level: string; message: string }[] = [];
  let light: "SIN_DAM" | "VERDE" | "AMBAR" | "ROJO" | "REGULARIZADO" = "SIN_DAM";
  let phase = "Sin DAM numerada";
  let days: number | null = null;
  if (s.damDate && !s.shipDate) {
    days = Math.floor((now.getTime() - new Date(s.damDate).getTime()) / DAY);
    phase = `Día ${days} desde la numeración (embarcar en ≤ ${p.damShipDays} días)`;
    light = days <= p.damGreenUntil ? "VERDE" : days <= p.damAmberUntil ? "AMBAR" : "ROJO";
    if (light === "AMBAR") alerts.push({ level: "warning", message: `R4: DAM numerada hace ${days} días sin embarque (ámbar)` });
    if (light === "ROJO") alerts.push({ level: "danger", message: `R4: DAM numerada hace ${days} días: riesgo de caducidad (rojo)` });
  } else if (s.shipDate && !s.regularizedAt) {
    days = Math.floor((now.getTime() - new Date(s.shipDate).getTime()) / DAY);
    phase = `Día ${days} desde el embarque (regularizar en ≤ ${p.regularizationDays} días)`;
    light = days < p.regularizationAlerts[0] ? "VERDE" : days < p.regularizationAlerts[2] ? "AMBAR" : "ROJO";
    for (const a of p.regularizationAlerts) if (days >= a) alerts.push({ level: a >= p.regularizationAlerts[2] ? "danger" : "warning", message: `R5: alerta de regularización — día ${a} desde el embarque` });
  } else if (s.regularizedAt) { light = "REGULARIZADO"; phase = "DAM regularizada"; }
  if (s.cargoCutoff && !s.isfSentAt) {
    const hours = (new Date(s.cargoCutoff).getTime() - now.getTime()) / 3600000;
    const due = new Date(new Date(s.cargoCutoff).getTime() - p.isfHoursBeforeCutoff * 3600000);
    alerts.push({ level: hours < p.isfHoursBeforeCutoff ? "danger" : "info", message: `R6: enviar datos ISF 10+2 al importador antes del ${due.toISOString().slice(0, 16).replace("T", " ")} (48 h antes del cierre de carga)` });
  }
  return { light, phase, days, alerts };
}

export async function updateCustoms(tx: Tx, id: number, input: any, userId: number) {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id } });
  if (input.shipDate && !(input.damDate ?? s.damDate)) throw unprocessable("No se puede registrar el embarque sin DAM numerada");
  const data: any = {};
  for (const k of ["damNumber", "channel", "blNumber", "manifest", "container", "vessel", "shippingLine", "priorNoticeNo"]) if (input[k] !== undefined) data[k] = input[k] || null;
  for (const k of ["damDate", "levanteDate", "shipDate", "regularizedAt", "isfSentAt", "cargoCutoff"]) if (input[k] !== undefined) data[k] = input[k] ? new Date(input[k]) : null;
  const out = await tx.exportShipment.update({ where: { id }, data });
  const map: [string, string][] = [["damNumber", "DAM"], ["blNumber", "BL"], ["regularizedAt", "REGULARIZACION"], ["isfSentAt", "ISF-10+2"], ["priorNoticeNo", "PRIOR-NOTICE"]];
  for (const [field, code] of map) if (data[field]) await tx.complianceItem.updateMany({ where: { shipmentId: id, code }, data: { status: "CUMPLIDO", evidence: `${field}: ${String(data[field] instanceof Date ? data[field].toISOString().slice(0, 10) : data[field])}` } });
  await event(tx, id, "ADUANAS", `Seguimiento aduanero actualizado: ${Object.keys(data).join(", ")}`, "info");
  await audit(tx, userId, "ACTUALIZAR_ADUANA", "embarque", id, data);
  return out;
}

/** Despacho físico: exige documentos aprobados (R2/R3), DAM numerada y cumplimiento vigente (R7). */
export async function dispatchShipment(tx: Tx, id: number, userId: number, at = new Date()) {
  const s = await tx.exportShipment.findUniqueOrThrow({ where: { id }, include: { palletsList: { include: { lot: true } } } });
  if (["DESPACHADO", "EN_TRANSITO", "ARRIBADO", "ENTREGADO", "CERRADO"].includes(s.status)) return s;
  if (s.docsStatus !== "APROBADO") throw unprocessable("No se puede despachar: el paquete documental no está aprobado (R2/R3)");
  if (!s.damNumber || !s.damDate) throw unprocessable("No se puede despachar sin DAM numerada");
  const blockers = await complianceBlockers(tx, at);
  if (blockers.length) throw unprocessable(`R7 — Despacho bloqueado: ${blockers.map((b) => b.name).join("; ")}`, { blockers });
  const wh = await warehouseByCode(tx, "ALM-PT");
  for (const pl of s.palletsList) {
    const upd = await tx.pallet.updateMany({ where: { id: pl.id, status: "RESERVADO" }, data: { status: "DESPACHADO", location: `Contenedor ${s.container ?? "por asignar"}` } });
    if (upd.count === 1) await applyMovement(tx, { type: "SALIDA", productId: pl.lot.productId, warehouseId: wh.id, lotId: pl.lotId, quantityKg: pl.netKg, reason: `Despacho de exportación ${s.code} · SSCC ${pl.sscc}`, referenceType: "EXPORT_SHIPMENT", referenceCode: s.code, userId, at });
  }
  const out = await tx.exportShipment.update({ where: { id }, data: { status: "EN_TRANSITO", shipDate: s.shipDate ?? at, voyageStartedAt: at, voyageProgress: 0 } });
  await event(tx, id, "DESPACHO", `Carga entregada al transportista (${s.incoterm} ${s.incotermPlace}) y embarcada en ${s.vessel ?? "la nave asignada"} · B/L ${s.blNumber ?? "por emitir"}`, "success");
  await audit(tx, userId, "DESPACHAR", "embarque", id, {});
  return out;
}

// ------------------------------------------------------------------ costos y KPI
export async function shipmentFinance(db: Tx | typeof prisma, id: number) {
  const s = await db.exportShipment.findUniqueOrThrow({ where: { id }, include: { costs: true, payments: true } });
  const cost = s.costs.reduce((a, c) => a.plus(c.amountPen), D(0));
  const budget = s.costs.reduce((a, c) => a.plus(c.budgetPen), D(0));
  const revenuePen = D(s.amountUsd).times(s.exchangeRate);
  return {
    costs: s.costs, totalCostPen: round2(cost), budgetPen: round2(budget), varianceePen: round2(cost.minus(budget)),
    costPerJarPen: s.jars ? cost.div(s.jars).toDecimalPlaces(4) : null, costPerPalletPen: s.pallets ? round2(cost.div(s.pallets)) : null,
    revenueUsd: s.amountUsd, revenuePen: round2(revenuePen), exchangeRate: s.exchangeRate,
    marginPct: revenuePen.gt(0) ? revenuePen.minus(cost).div(revenuePen).times(100).toDecimalPlaces(2) : null,
    collectedUsd: s.paidUsd, pendingUsd: round2(D(s.amountUsd).minus(s.paidUsd)),
    formula: { costPerJar: "Costo total del lote ÷ número de frascos", margin: "(Ingreso − costos) ÷ ingreso × 100" },
  };
}

export async function kpis(db: Tx | typeof prisma = prisma, year?: number) {
  const p = await params(db);
  const from = year ? new Date(`${year}-01-01`) : new Date("2000-01-01");
  const to = year ? new Date(`${year + 1}-01-01`) : new Date("2100-01-01");
  // 1. Rendimiento fruto-producto
  const orders = await db.productionOrder.findMany({ where: { status: "COMPLETADA", endDate: { gte: from, lt: to } }, select: { initialWeightKg: true, finalWeightKg: true, energyCost: true } });
  const ini = orders.reduce((a, o) => a.plus(o.initialWeightKg), D(0)), fin = orders.reduce((a, o) => a.plus(o.finalWeightKg ?? 0), D(0));
  const yieldPct = ini.gt(0) ? Number(fin.div(ini).times(100).toFixed(2)) : null;
  // 2. Lotes aprobados a la primera
  const lots = await db.lot.findMany({ where: { type: "PRODUCTO_TERMINADO", productionDate: { gte: from, lt: to }, product: { code: "PT-PAP-MOL-25" } }, include: { inspections: { orderBy: { date: "asc" }, take: 1 }, labAnalyses: { orderBy: { createdAt: "asc" }, take: 1 } } });
  const decided = lots.filter((l) => l.inspections[0]?.status && l.inspections[0].status !== "EN_EVALUACION" || l.labAnalyses[0]?.result && !["EN_EVALUACION"].includes(l.labAnalyses[0].result));
  const firstOk = decided.filter((l) => (l.labAnalyses[0] ? l.labAnalyses[0].result === "APROBADO" : l.inspections[0]?.status === "APROBADO"));
  // 3. Energía por kg: costo de energía (S/) ÷ tarifa de referencia → kWh (demostración: S/ 0.85 por kWh)
  const energyPen = orders.reduce((a, o) => a.plus(o.energyCost ?? 0), D(0));
  const kwhPerKg = fin.gt(0) ? Number(energyPen.div(0.85).div(fin).toFixed(2)) : null;
  // 4-8 sobre embarques
  const ships = await db.exportShipment.findMany({ where: { createdAt: { gte: from, lt: to }, status: { not: "ANULADO" } }, include: { costs: true, claims: true } });
  const delivered = ships.filter((s) => s.deliveredAt);
  const otif = delivered.filter((s) => s.deliveredAt! <= new Date(s.deliveryDate.getTime() + DAY) && !s.claims.some((c) => c.type === "FALTANTE"));
  const d1 = ships.filter((s) => s.damDate && s.shipDate).map((s) => (s.shipDate!.getTime() - s.damDate!.getTime()) / DAY);
  const d2 = ships.filter((s) => s.shipDate && s.regularizedAt).map((s) => (s.regularizedAt!.getTime() - s.shipDate!.getTime()) / DAY);
  const avg = (a: number[]) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)) : null);
  const tCost = ships.reduce((a, s) => a.plus(s.costs.reduce((x, c) => x.plus(c.amountPen), D(0))), D(0));
  const tJars = ships.reduce((a, s) => a + s.jars, 0);
  const tRev = ships.reduce((a, s) => a.plus(D(s.amountUsd).times(s.exchangeRate)), D(0));
  const k = (n: number, name: string, value: number | null, unit: string, target: string, ok: boolean | null, formula: string, kind: string, extra: any = {}) => ({ n, name, value, unit, target, ok, formula, kind, ...extra });
  return [
    k(1, "Rendimiento fruto-producto", yieldPct, "%", `≥ ${p.yieldPct} %`, yieldPct === null ? null : yieldPct >= p.yieldPct, "kg de producto ÷ kg de fruto fresco", "REAL (registros ERP, datos demo)", { baseline: 12.4 }),
    k(2, "Lotes aprobados a la primera", decided.length ? Number((firstOk.length / decided.length * 100).toFixed(1)) : null, "%", "≥ 95 %", decided.length ? firstOk.length / decided.length >= 0.95 : null, "Lotes liberados ÷ lotes producidos", "REAL (registros ERP, datos demo)", { detail: `${firstOk.length} de ${decided.length}` }),
    k(3, "Consumo energético por kg", kwhPerKg, "kWh/kg", "Línea base 3.40 → meta 2.73", kwhPerKg === null ? null : kwhPerKg <= 2.73, "kWh totales ÷ kg de producto (costo de energía ÷ S/ 0.85 por kWh)", "SUPUESTO (tarifa de referencia)", { baseline: 3.4 }),
    k(4, "Pedidos OTIF", delivered.length ? Number((otif.length / delivered.length * 100).toFixed(1)) : null, "%", "≥ 90 %", delivered.length ? otif.length / delivered.length >= 0.9 : null, "Pedidos a tiempo y completos ÷ pedidos entregados", "DEMO", { detail: `${otif.length} de ${delivered.length}` }),
    k(5, "Días de numeración a embarque", avg(d1), "días", "≤ 15 días", avg(d1) === null ? null : avg(d1)! <= 15, "Fecha de embarque − fecha de numeración", "DEMO"),
    k(6, "Días de embarque a regularización", avg(d2), "días", "≤ 10 días", avg(d2) === null ? null : avg(d2)! <= 10, "Fecha de regularización − fecha de embarque", "DEMO"),
    k(7, "Costo por frasco", tJars ? Number(tCost.div(tJars).toFixed(4)) : null, "S/", "≤ S/ 2.96 (plan, costo variable)", tJars ? tCost.div(tJars).lte(2.96 + 0.42) : null, "Costo total ÷ frascos", "SUPUESTO (OP-48) + DEMO"),
    k(8, "Margen por embarque", tRev.gt(0) ? Number(tRev.minus(tCost).div(tRev).times(100).toFixed(2)) : null, "%", `≥ piso ${p.marginFloorPct} %`, tRev.gt(0) ? tRev.minus(tCost).div(tRev).times(100).gte(p.marginFloorPct) : null, "(Ingreso − costos) ÷ ingreso × 100", "DEMO"),
  ];
}

export const sanitizeForRole = (s: any, canSeeCosts: boolean) => {
  if (canSeeCosts) return s;
  const { marginPct, costs, marginApproved, marginApprovedBy, ...rest } = s;
  return { ...rest, costsHidden: true };
};

export type { Prisma };
