/**
 * Escenario integral de demostración (sección 16). Cada paso usa los MISMOS
 * servicios que la interfaz (no hay atajos) y es idempotente: si el registro
 * ya existe se reutiliza, de modo que re-ejecutar no duplica datos.
 */
import { Router } from "express";
import { prisma, inTx } from "../lib/prisma";
import { ah } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { AppError, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import * as chain from "../blockchain/chain";
import { registerHarvest, sendHarvestToProcessing } from "./agriculture";
import { createProductionOrder, advanceStage, completeOrder, STAGE_LABEL } from "./production";
import { createInspection, decideInspection } from "./quality";
import { createSalesOrder } from "./sales";
import { createDispatch, advanceDispatch } from "./logistics";
import { storeDocument } from "./documents";
import { anchorLot, verifyLot, createAgreementFromOrder, agreementAction, refreshAgreement } from "./blockchain.service";
import { resetBusinessData, seedBaseData } from "../seed/seedData";

export const demoRouter = Router();

const C = {
  campaign: "CAM-DEMO-2026-001", rawLot: "MP-2026-001", lot: "DP-2026-001", order: "OP-DEMO-2026-001", sale: "PED-DEMO-2026-001",
  agreement: "SC-DP-2026-001", customer: "Distribuidora Andina Demo",
};

export const STEPS = [
  "Crear campaña agrícola", "Registrar cosecha (1,000 kg)", "Generar lote de materia prima y enviarlo a procesamiento", "Procesar el lote (etapas de planta)",
  "Registrar el producto terminado (200 kg = 8 sacos)", "Ejecutar control de calidad", "Aprobar el lote", "Registrar el hash del lote en la blockchain local",
  "Incorporar los 8 sacos al inventario disponible", "Crear pedido de 8 sacos", "Crear acuerdo comercial inteligente", "Depositar fondos de prueba y registrar conformidad de calidad",
  "Registrar despacho y entrega", "Confirmar recepción (comprador)", "Liberar pago simulado", "Actualizar inventarios, ventas y cuentas por cobrar",
  "Mostrar transacción blockchain confirmada", "Generar reporte de trazabilidad en PDF",
];

type StepResult = { step: number; title: string; status: "OK" | "ERROR"; mode: "ERP" | "BLOCKCHAIN" | "ERP+BLOCKCHAIN"; summary: string; data?: any; txs?: any[] };

const txView = (r: any) => r?.tx ? ({ id: r.tx.id, fn: r.tx.functionName, actor: r.tx.actor, status: r.tx.status, hash: r.tx.txHash, block: r.tx.blockNumber, error: r.tx.errorMessage }) : null;

async function ctx() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
  return { userId: admin.id };
}

async function requireOk(r: any, what: string) {
  if (!r.ok) throw new AppError(422, `${what}: ${r.errorMessage ?? r.message}`, "CHAIN_REJECTED", { tx: txView(r) });
  return r;
}

async function runStep(n: number, userId: number): Promise<StepResult> {
  const title = STEPS[n - 1];
  const ok = (mode: StepResult["mode"], summary: string, data?: any, txs?: any[]): StepResult => ({ step: n, title, status: "OK", mode, summary, data, txs });
  switch (n) {
    case 1: {
      let c = await prisma.campaign.findUnique({ where: { code: C.campaign } });
      if (!c) {
        const parcel = await prisma.parcel.findUniqueOrThrow({ where: { code: "PAR-001" } });
        c = await inTx(async (tx) => {
          const camp = await tx.campaign.create({ data: { code: C.campaign, parcelId: parcel.id, variety: "Papri King", sowingDate: new Date("2026-04-15"), estHarvestDate: new Date("2026-10-01"), estimatedYieldKg: 1000, status: "EN_CURSO", notes: "Campaña de demostración del escenario integral" } });
          const acts: [any, string, string, number][] = [["SIEMBRA", "2026-04-15", "Trasplante de plantines", 180], ["RIEGO", "2026-05-20", "Riego por gravedad", 120], ["FERTILIZACION", "2026-06-10", "Fertilización NPK", 260], ["CONTROL_PLAGAS", "2026-07-15", "Control biológico de pulgón", 150], ["COSECHA", "2026-10-05", "Cosecha manual — personal temporal", 400]];
          for (const [type, date, description, cost] of acts) {
            const a = await tx.agriActivity.create({ data: { campaignId: camp.id, type, date: new Date(date), description, responsible: "Responsable agrícola (demo)", cost } });
            await tx.financialTransaction.create({ data: { code: `FIN-DEMO-${camp.id}-${a.id}`, type: "EGRESO", category: "COSTO_AGRICOLA", date: new Date(date), description: `${type} — ${C.campaign}: ${description}`, amount: cost, amountPen: cost, campaignId: camp.id, referenceType: "AGRI_ACTIVITY", referenceCode: `${C.campaign}#${a.id}`, userId } });
          }
          await audit(tx, userId, "CREAR", "campaña", camp.id, { code: C.campaign, demo: true });
          return camp;
        });
      }
      return ok("ERP", `Campaña ${c.code} en la parcela PAR-001 (variedad ${c.variety}) con 5 actividades agrícolas y costos asociados.`, { campaignId: c.id, code: c.code });
    }
    case 2: {
      const c = await prisma.campaign.findUniqueOrThrow({ where: { code: C.campaign } });
      let lot = await prisma.lot.findUnique({ where: { code: C.rawLot }, include: { harvest: true } });
      if (!lot) {
        await inTx((tx) => registerHarvest(tx, c.id, { date: new Date("2026-10-05"), quantityKg: 1000, notes: "Cosecha de demostración", lotCode: C.rawLot }, userId));
        lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.rawLot }, include: { harvest: true } });
      }
      return ok("ERP", `Cosecha ${lot.harvest!.code}: 1,000 kg de pimentón fresco. Ingreso al almacén ALM-MP.`, { harvest: lot.harvest!.code, lot: lot.code });
    }
    case 3: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.rawLot }, include: { harvest: true } });
      await inTx((tx) => sendHarvestToProcessing(tx, lot.harvestId!, userId));
      return ok("ERP", `Lote de materia prima ${lot.code} (identificador único) enviado al módulo de procesamiento.`, { lot: lot.code, kg: Number(lot.quantityKg) });
    }
    case 4: {
      let o = await prisma.productionOrder.findUnique({ where: { code: C.order } });
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.rawLot } });
      if (!o) o = await inTx((tx) => createProductionOrder(tx, { sourceLotId: lot.id, initialWeightKg: 1000, startDate: new Date("2026-10-06T08:00:00"), code: C.order }, userId));
      const plan: Record<string, any> = {
        SELECCION: { outputKg: 960, notes: "Descarte de frutos dañados" },
        LAVADO_ACONDICIONAMIENTO: { outputKg: 950, notes: "Lavado y despedunculado" },
        DESHIDRATACION: { outputKg: 212, temperatureC: 60, durationH: 30, notes: "Secador propio — valores de demostración" },
        MOLIENDA: { outputKg: 204, notes: "Trituración y molienda" },
        CONTROL_CALIDAD: { outputKg: 202, notes: "Control en proceso (tamiz y humedad rápida)" },
        ENVASADO: { outputKg: 200, notes: "8 sacos de 25 kg" },
      };
      let cur = await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } });
      let day = 6;
      while (cur.status === "EN_PROCESO" && cur.currentStage !== "ALMACEN") {
        await inTx((tx) => advanceStage(tx, o!.id, { ...plan[cur.currentStage], at: new Date(`2026-10-${String(++day > 12 ? 12 : day).padStart(2, "0")}T12:00:00`) }, userId));
        cur = await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } });
      }
      return ok("ERP", `Orden ${o.code}: recepción → selección → lavado → deshidratación (60 °C, 30 h) → molienda → control → envasado. Etapa actual: ${STAGE_LABEL[cur.currentStage]}.`, { order: o.code });
    }
    case 5: {
      const o = await prisma.productionOrder.findUniqueOrThrow({ where: { code: C.order } });
      if (o.status !== "COMPLETADA") await inTx((tx) => completeOrder(tx, o.id, { finalWeightKg: 200, outputs: [{ quantityKg: 200, code: C.lot }], laborCost: 450, energyCost: 380, packagingCost: 64, otherCost: 50, expiryMonths: 18, at: new Date("2026-10-13T10:00:00") }, userId));
      const done = await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } });
      return ok("ERP", `Peso inicial 1,000 kg → final 200 kg. Merma ${D(done.wasteKg).toFixed(0)} kg, rendimiento ${D(done.yieldPct).toFixed(2)} % (valores ficticios de demostración). Lote ${C.lot}: 8 sacos en cuarentena hasta liberación por Calidad.`, { wasteKg: Number(done.wasteKg), yieldPct: Number(done.yieldPct), totalCost: Number(done.totalCost) });
    }
    case 6: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.lot } });
      let insp = await prisma.qualityInspection.findFirst({ where: { lotId: lot.id }, orderBy: { id: "desc" } });
      if (!insp) {
        const customer = await prisma.customer.findFirstOrThrow({ where: { name: C.customer } });
        const coa = await storeDocument(prisma, { buffer: Buffer.from(coaText(C.lot)), originalname: `informe-analisis-${C.lot}.txt`, mimetype: "text/plain" }, { title: `Informe de análisis ${C.lot} (demostración)`, type: "COA", entityType: "lot", entityId: C.lot }, userId);
        insp = await inTx((tx) => createInspection(tx, { lotId: lot.id, date: new Date("2026-10-14T09:00:00"), moisturePct: 9.4, astaColor: 128, granulometry: 98.5, granulometryMesh: "Malla 40 (425 µm)", microbiological: "CONFORME", contaminants: "CONFORME", observations: "Muestreo compuesto de 8 sacos", coaDocumentId: coa.id, specCustomerId: customer.id }, userId));
      }
      return ok("ERP", `Inspección ${insp.code}: humedad 9.4 %, color 128 ASTA, granulometría 98.5 % (malla 40), microbiología y contaminantes conformes. Evaluado contra especificaciones del cliente (demo).`, { inspection: insp.code, specEvaluation: insp.specEvaluation });
    }
    case 7: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.lot } });
      const insp = await prisma.qualityInspection.findFirstOrThrow({ where: { lotId: lot.id }, orderBy: { id: "desc" } });
      if (insp.status === "EN_EVALUACION") await inTx((tx) => decideInspection(tx, insp.id, { status: "APROBADO", note: "Liberado para venta", at: new Date("2026-10-14T15:00:00") }, userId));
      const l = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
      return ok("ERP", `Lote ${l.code} APROBADO. Hash del certificado (SHA-256 del archivo COA): ${l.certHash?.slice(0, 18)}…`, { qualityStatus: l.qualityStatus, certHash: l.certHash });
    }
    case 8: {
      const r = await anchorLot(C.lot, userId, "INTEGRAL");
      if (!r.ok) await requireOk(r, "Registro en blockchain");
      const v = await verifyLot(C.lot);
      return ok("BLOCKCHAIN", `Lote registrado en PaprikaTraceability con hash de datos y de certificado. Verificación: ${v.verdict}`, { verification: v }, r.results.map(txView));
    }
    case 9: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.lot }, include: { balances: true, movements: { where: { type: "LIBERACION_CUARENTENA" } } } });
      const avail = lot.balances.reduce((s, b) => s.plus(b.availableKg).plus(b.reservedKg), D(0));
      if (!lot.movements.length) throw unprocessable("El lote aún no fue liberado a stock disponible");
      return ok("ERP", `Stock en ALM-PT: ${avail.toFixed(0)} kg = ${avail.div(25).toFixed(0)} sacos de 25 kg (movimiento ${lot.movements[0].code}: liberación de cuarentena tras la aprobación).`, { availableKg: Number(avail), bags: Number(avail.div(25)) });
    }
    case 10: {
      let o = await prisma.salesOrder.findUnique({ where: { code: C.sale } });
      if (!o) {
        const customer = await prisma.customer.findFirstOrThrow({ where: { name: C.customer } });
        const product = await prisma.product.findUniqueOrThrow({ where: { code: "PT-PAP-MOL-25" } });
        const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.lot } });
        o = await inTx((tx) => createSalesOrder(tx, { customerId: customer.id, date: new Date("2026-10-15T10:00:00"), currency: "PEN", taxCode: "IGV", priceIncludesTax: true, notes: "Pedido del escenario integral", items: [{ productId: product.id, lotId: lot.id, unit: "SACO", quantity: 8, unitPrice: 375, discountPct: 0 }], code: C.sale }, userId));
      }
      return ok("ERP", `Pedido ${o.code}: 8 sacos × S/ 375 (S/ 15/kg) = S/ ${D(o.total).toFixed(2)} (precio con IGV incluido: base ${D(o.subtotal).toFixed(2)} + IGV ${D(o.taxTotal).toFixed(2)}). 200 kg reservados.`, { order: o.code, total: Number(o.total), subtotal: Number(o.subtotal), tax: Number(o.taxTotal) });
    }
    case 11: {
      const o = await prisma.salesOrder.findUniqueOrThrow({ where: { code: C.sale } });
      const txs: any[] = [];
      let ag = await prisma.smartAgreement.findUnique({ where: { code: C.agreement } });
      if (!ag || ag.status === "BORRADOR") {
        const r: any = await createAgreementFromOrder(o.id, userId, { code: C.agreement, scenario: "INTEGRAL" });
        txs.push(txView(r.result));
        if (!r.ok) await requireOk(r.result, "Creación del acuerdo");
      }
      ag = await refreshAgreement(C.agreement);
      if (ag!.status === "PROPUESTO") { const r = await agreementAction(C.agreement, "accept", userId, { scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Aceptación"); }
      ag = await prisma.smartAgreement.findUniqueOrThrow({ where: { code: C.agreement } });
      return ok("BLOCKCHAIN", `Acuerdo ${ag.code} creado por el vendedor y aceptado por el comprador (billetera demo). Importe: ${chain.formatEth(BigInt(ag.amountWei))} ETH de prueba ≙ S/ ${D(ag.referencePen).toFixed(2)} de referencia.`, { agreement: ag }, txs);
    }
    case 12: {
      const txs: any[] = [];
      let ag = await refreshAgreement(C.agreement);
      if (ag!.status === "ACEPTADO") { const r = await agreementAction(C.agreement, "deposit", userId, { scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Depósito"); }
      ag = await refreshAgreement(C.agreement);
      if (ag!.qualityState === "PENDIENTE") { const r = await agreementAction(C.agreement, "quality", userId, { approved: true, scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Conformidad de calidad"); }
      const on: any = await chain.readAgreement(C.agreement);
      return ok("BLOCKCHAIN", `Fondos de prueba en custodia del contrato: ${on.depositedEth} ETH. Calidad registró la conformidad (rol QUALITY_ROLE, verificado contra PaprikaTraceability).`, { onchain: on }, txs);
    }
    case 13: {
      const o = await prisma.salesOrder.findUniqueOrThrow({ where: { code: C.sale }, include: { dispatches: true } });
      let d = o.dispatches[0];
      if (!d) {
        const carrier = await prisma.carrier.findFirstOrThrow();
        const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { carrierId: carrier.id } });
        d = await inTx((tx) => createDispatch(tx, { salesOrderId: o.id, carrierId: carrier.id, vehicleId: vehicle.id, destination: "Almacén Distribuidora Andina Demo — Av. Ficticia 123, Arequipa" }, userId));
      }
      const seq: any[] = [["DESPACHADO", "2026-10-16T07:30:00"], ["EN_TRANSITO", "2026-10-16T08:00:00"], ["ENTREGADO", "2026-10-16T11:15:00"], ["CONFORME", "2026-10-16T11:30:00"]];
      for (const [status, at] of seq) {
        const cur = await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: d.id } });
        const order = ["PREPARACION", "DESPACHADO", "EN_TRANSITO", "ENTREGADO", "CONFORME"];
        if (order.indexOf(cur.status) >= order.indexOf(status)) continue;
        let evidenceDocId: number | undefined;
        if (status === "CONFORME") {
          const ev = await storeDocument(prisma, { buffer: Buffer.from(`ACTA DE CONFORMIDAD (DEMOSTRACIÓN)\nDespacho ${d.code} — Pedido ${o.code}\n8 sacos de 25 kg del lote ${C.lot} recibidos conformes.\nRecibió: Jefe de almacén (ficticio)\n`), originalname: `acta-conformidad-${d.code}.txt`, mimetype: "text/plain" }, { title: `Acta de conformidad ${d.code}`, type: "EVIDENCIA_ENTREGA", entityType: "dispatch", entityId: d.code }, userId);
          evidenceDocId = ev.id;
        }
        await inTx((tx) => advanceDispatch(tx, d!.id, { status, at: new Date(at), receivedBy: "Jefe de almacén — Distribuidora Andina Demo", evidenceDocId }, userId));
      }
      const txs: any[] = [];
      const ag = await refreshAgreement(C.agreement);
      if (ag!.deliveryState === "PENDIENTE") { const r = await agreementAction(C.agreement, "delivery", userId, { scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Registro de entrega"); }
      const fin = await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: d.id } });
      return ok("ERP+BLOCKCHAIN", `Despacho ${fin.code}: Preparación → Despachado → En tránsito → Entregado → Conforme (inventario descontado una sola vez: ${fin.inventoryPosted ? "sí" : "no"}). Logística registró la entrega on-chain con el hash del acta.`, { dispatch: fin.code, status: fin.status }, txs);
    }
    case 14: {
      const txs: any[] = [];
      const ag = await refreshAgreement(C.agreement);
      if (ag!.deliveryState === "ENTREGADA") { const r = await agreementAction(C.agreement, "confirm", userId, { scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Confirmación de recepción"); }
      const on: any = await chain.readAgreement(C.agreement);
      return ok("BLOCKCHAIN", `El comprador confirmó la recepción. ¿Liberación habilitada? ${on.canRelease ? "Sí" : "No"} — ${on.canReleaseReason}.`, { onchain: on }, txs);
    }
    case 15: {
      const txs: any[] = [];
      const ag = await refreshAgreement(C.agreement);
      if (ag!.status === "FONDEADO") { const r = await agreementAction(C.agreement, "release", userId, { scenario: "INTEGRAL" }); txs.push(txView(r)); await requireOk(r, "Liberación del pago"); }
      const on: any = await chain.readAgreement(C.agreement);
      return ok("BLOCKCHAIN", `Pago simulado liberado al vendedor. Estado on-chain: ${on.state}. Saldo del contrato: ${on.contractBalanceEth} ETH de prueba.`, { onchain: on }, txs);
    }
    case 16: {
      const o = await prisma.salesOrder.findUniqueOrThrow({ where: { code: C.sale }, include: { receivables: { include: { transactions: true } } } });
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: C.lot }, include: { balances: true } });
      const stock = lot.balances.reduce((s, b) => s.plus(b.availableKg).plus(b.reservedKg).plus(b.quarantineKg), D(0));
      const ar = o.receivables[0];
      if (o.status !== "COMPLETADO" || ar?.status !== "COBRADO") throw unprocessable("El pedido o la cuenta por cobrar aún no reflejan el pago (ejecute el paso 15)");
      return ok("ERP", `Pedido ${o.code}: ${o.status} / ${o.paymentStatus}. CxC ${ar.code}: cobrada S/ ${D(ar.collected).toFixed(2)} (registro marcado como SIMULADO, ref. tx ${ar.transactions[0]?.referenceCode?.slice(0, 12)}…). Stock del lote ${lot.code}: ${stock.toFixed(0)} kg.`, { order: o.status, payment: o.paymentStatus, receivable: ar.status, lotStockKg: Number(stock) });
    }
    case 17: {
      const tx = await prisma.blockchainTransaction.findFirst({ where: { entityCode: C.agreement, functionName: "releasePayment", status: "CONFIRMADA" }, include: { events: true } });
      if (!tx?.txHash) throw unprocessable("No hay transacción de liberación confirmada");
      const receipt = await chain.getProvider().getTransactionReceipt(tx.txHash);
      if (!receipt) throw unprocessable("La red local no reconoce la transacción (¿se reinició Hardhat?)");
      return ok("BLOCKCHAIN", `Transacción ${tx.txHash} confirmada en el bloque ${receipt.blockNumber} (status ${receipt.status}, gas ${receipt.gasUsed}). Eventos: ${tx.events.map((e) => e.eventName).join(", ")}.`, { hash: tx.txHash, block: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString(), confirmations: await receipt.confirmations() });
    }
    case 18:
      return ok("ERP", `Reporte disponible para descarga.`, { url: `/api/reports/traceability/${C.lot}.pdf` });
    default:
      throw unprocessable("Paso inexistente");
  }
}

function coaText(lot: string) {
  return [
    "INFORME DE ANÁLISIS — DOCUMENTO DE DEMOSTRACIÓN (NO ES UN CERTIFICADO OFICIAL)",
    `Lote: ${lot}  ·  Producto: Páprika deshidratada y molida  ·  Presentación: sacos de 25 kg`,
    "Humedad: 9.4 %  ·  Color: 128 ASTA  ·  Granulometría: 98.5 % pasa malla 40",
    "Microbiología: conforme (demo)  ·  Contaminantes: conforme (demo)",
    "Laboratorio: Laboratorio Ficticio Demo S.A.C.",
  ].join("\n");
}

async function lastRun(scenario: string) {
  return prisma.demoRun.findFirst({ where: { scenario }, orderBy: { id: "desc" } });
}

demoRouter.get("/", requirePerm("dashboard.read"), ah(async (_req, res) => {
  const run = await lastRun("INTEGRAL");
  const negatives = await prisma.demoRun.findMany({ where: { scenario: { startsWith: "NEG_" } }, orderBy: { id: "desc" }, take: 10 });
  res.json({ steps: STEPS, run, negatives, codes: C });
}));

demoRouter.post("/step/:n", requirePerm("demo.run"), ah(async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1 || n > STEPS.length) throw unprocessable("Paso inválido");
  let run = await lastRun("INTEGRAL");
  if (!run || run.status === "REINICIADA") run = await prisma.demoRun.create({ data: { scenario: "INTEGRAL", status: "EN_CURSO", steps: [] } });
  const results = (run.steps as any[]) ?? [];
  const done = new Set(results.filter((r) => r.status === "OK").map((r) => r.step));
  for (let i = 1; i < n; i++) if (!done.has(i)) throw unprocessable(`Ejecute primero el paso ${i}: ${STEPS[i - 1]}`);
  let result: StepResult;
  try {
    result = await runStep(n, req.user!.id);
  } catch (e: any) {
    result = { step: n, title: STEPS[n - 1], status: "ERROR", mode: "ERP", summary: e.message, data: e.details };
  }
  const steps = [...results.filter((r) => r.step !== n), { ...result, at: new Date().toISOString() }].sort((a, b) => a.step - b.step);
  const allOk = STEPS.every((_, i) => steps.find((s) => s.step === i + 1 && s.status === "OK"));
  await prisma.demoRun.update({ where: { id: run.id }, data: { steps, status: allOk ? "COMPLETADA" : "EN_CURSO", finishedAt: allOk ? new Date() : null } });
  res.status(result.status === "OK" ? 200 : 422).json(result);
}));

// ---------------------------------------------------------------- escenarios negativos

/** Lote terminado de prueba por la vía de los servicios normales. */
async function quickLot(userId: number, n: number, approve: boolean) {
  const lotCode = `DP-2026-00${n}`;
  const existing = await prisma.lot.findUnique({ where: { code: lotCode } });
  if (existing) return existing;
  const camp = await prisma.campaign.findUnique({ where: { code: C.campaign } }) ?? (await runStep(1, userId), await prisma.campaign.findUniqueOrThrow({ where: { code: C.campaign } }));
  const { lot: raw } = await inTx((tx) => registerHarvest(tx, camp.id, { date: new Date("2026-10-08"), quantityKg: 500, notes: `Cosecha para escenario negativo ${n}`, lotCode: `MP-2026-00${n}` }, userId));
  await inTx((tx) => sendHarvestToProcessing(tx, raw.harvestId!, userId));
  const o = await inTx((tx) => createProductionOrder(tx, { sourceLotId: raw.id, initialWeightKg: 500, startDate: new Date("2026-10-09T08:00:00"), code: `OP-DEMO-2026-00${n}` }, userId));
  for (const s of [{ outputKg: 480 }, { outputKg: 475 }, { outputKg: 106, temperatureC: 60, durationH: 30 }, { outputKg: 102 }, { outputKg: 101 }, { outputKg: 100 }]) await inTx((tx) => advanceStage(tx, o.id, s, userId));
  await inTx((tx) => completeOrder(tx, o.id, { finalWeightKg: 100, outputs: [{ quantityKg: 100, code: lotCode }], laborCost: 220, energyCost: 190, packagingCost: 32, otherCost: 20, expiryMonths: 18 }, userId));
  const lot = await prisma.lot.findUniqueOrThrow({ where: { code: lotCode } });
  const insp = await inTx((tx) => createInspection(tx, approve
    ? { lotId: lot.id, moisturePct: 9.8, astaColor: 122, granulometry: 97, granulometryMesh: "Malla 40 (425 µm)", microbiological: "CONFORME", contaminants: "CONFORME", observations: "Escenario negativo (lote conforme)" }
    : { lotId: lot.id, moisturePct: 14.2, astaColor: 86, granulometry: 91, granulometryMesh: "Malla 40 (425 µm)", microbiological: "NO_CONFORME", contaminants: "CONFORME", observations: "Escenario negativo: humedad alta y recuento microbiológico no conforme (datos ficticios)" }, userId));
  await inTx((tx) => decideInspection(tx, insp.id, { status: approve ? "APROBADO" : "RECHAZADO", note: "Escenario negativo" }, userId));
  await anchorLot(lotCode, userId, `NEG_${n}`);
  return prisma.lot.findUniqueOrThrow({ where: { code: lotCode } });
}

async function directAgreement(code: string, lotId: number, userId: number, scenario: string) {
  const customer = await prisma.customer.findFirstOrThrow({ where: { name: C.customer } });
  const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
  const amountWei = chain.parseEth("1.5");
  const deadline = new Date(Date.now() + 30 * 86400000);
  const txs: any[] = [];
  let ag = await prisma.smartAgreement.findUnique({ where: { code } });
  if (!ag) ag = await prisma.smartAgreement.create({ data: { code, lotId, customerId: customer.id, sellerAddress: chain.actorAddress("seller"), buyerAddress: chain.actorAddress("buyer"), quantityKg: lot.quantityKg, amountWei: amountWei.toString(), referencePen: 1500, deadline } });
  if (ag.status === "BORRADOR") {
    const r = await chain.sendTx({ contract: "PaprikaTradeAgreement", fn: "createAgreement", args: [code, lot.code, chain.actorAddress("buyer"), BigInt(Math.round(Number(lot.quantityKg))), amountWei, 150000n, BigInt(Math.floor(deadline.getTime() / 1000))], actor: "seller", entityType: "AGREEMENT", entityCode: code, scenario, userId });
    txs.push(txView(r)); await requireOk(r, "Creación del acuerdo");
    ag = (await refreshAgreement(code))!;
  }
  if (ag.status === "PROPUESTO") { const r = await agreementAction(code, "accept", userId, { scenario }); txs.push(txView(r)); await requireOk(r, "Aceptación"); ag = (await refreshAgreement(code))!; }
  if (ag.status === "ACEPTADO") { const r = await agreementAction(code, "deposit", userId, { scenario }); txs.push(txView(r)); await requireOk(r, "Depósito"); }
  return txs;
}

const NEGATIVES: Record<string, { title: string; run: (userId: number) => Promise<any> }> = {
  rechazado: {
    title: "Lote rechazado: el contrato bloquea el pago",
    run: async (userId) => {
      const lot = await quickLot(userId, 2, false);
      const checks: any[] = [];
      // 1) ERP: no se puede reservar / vender un lote rechazado
      try {
        const customer = await prisma.customer.findFirstOrThrow({ where: { name: C.customer } });
        const product = await prisma.product.findUniqueOrThrow({ where: { code: "PT-PAP-MOL-25" } });
        await inTx((tx) => createSalesOrder(tx, { customerId: customer.id, currency: "PEN", priceIncludesTax: true, items: [{ productId: product.id, lotId: lot.id, unit: "SACO", quantity: 4, unitPrice: 375, discountPct: 0 }] }, userId));
        checks.push({ layer: "ERP", action: "Crear pedido con el lote rechazado", blocked: false, message: "¡El ERP permitió la venta!" });
      } catch (e: any) { checks.push({ layer: "ERP", action: "Crear pedido con el lote rechazado", blocked: true, message: e.message }); }
      // 2) Blockchain: acuerdo directo con fondos depositados
      const code = "SC-NEG-RECHAZADO";
      const txs = await directAgreement(code, lot.id, userId, "NEG_RECHAZADO");
      const q1 = await agreementAction(code, "quality", userId, { approved: true, scenario: "NEG_RECHAZADO" });
      checks.push({ layer: "BLOCKCHAIN", action: "Calidad intenta aprobar en el acuerdo un lote RECHAZADO en trazabilidad", blocked: !q1.ok, message: q1.errorMessage ?? "Aceptado", tx: txView(q1) });
      const ag0 = await refreshAgreement(code);
      if (ag0!.qualityState === "PENDIENTE") { const q2 = await agreementAction(code, "quality", userId, { approved: false, scenario: "NEG_RECHAZADO" }); txs.push(txView(q2)); }
      const rel = await agreementAction(code, "release", userId, { scenario: "NEG_RECHAZADO" });
      checks.push({ layer: "BLOCKCHAIN", action: "Vendedor intenta liberar el pago", blocked: !rel.ok, message: rel.errorMessage ?? "¡Pago liberado!", tx: txView(rel) });
      const ag1 = await refreshAgreement(code);
      if (ag1!.status === "FONDEADO") { const c = await agreementAction(code, "cancel", userId, { reason: "Lote rechazado por Calidad", scenario: "NEG_RECHAZADO" }); checks.push({ layer: "BLOCKCHAIN", action: "Comprador cancela y recupera los fondos de prueba (regla de cancelación explícita)", blocked: !c.ok, expectBlocked: false, message: c.ok ? "Reembolso ejecutado" : c.errorMessage, tx: txView(c) }); }
      return { lot: lot.code, agreement: code, checks, txs, onchain: await chain.readAgreement(code) };
    },
  },
  "entrega-no-confirmada": {
    title: "Entrega no confirmada: el pago permanece pendiente",
    run: async (userId) => {
      const lot = await quickLot(userId, 3, true);
      const code = "SC-NEG-ENTREGA";
      const txs = await directAgreement(code, lot.id, userId, "NEG_ENTREGA");
      const ag = await refreshAgreement(code);
      if (ag!.qualityState === "PENDIENTE") { const q = await agreementAction(code, "quality", userId, { approved: true, scenario: "NEG_ENTREGA" }); txs.push(txView(q)); await requireOk(q, "Calidad"); }
      const checks: any[] = [];
      const rel1 = await agreementAction(code, "release", userId, { scenario: "NEG_ENTREGA" });
      checks.push({ layer: "BLOCKCHAIN", action: "Liberar pago sin entrega registrada", blocked: !rel1.ok, message: rel1.errorMessage ?? "¡Pago liberado!", tx: txView(rel1) });
      const conf = await agreementAction(code, "confirm", userId, { scenario: "NEG_ENTREGA" });
      checks.push({ layer: "BLOCKCHAIN", action: "Comprador intenta confirmar recepción sin entrega de logística", blocked: !conf.ok, message: conf.errorMessage ?? "Aceptado", tx: txView(conf) });
      const ag2 = await refreshAgreement(code);
      if (ag2!.deliveryState === "PENDIENTE") { const d = await agreementAction(code, "delivery", userId, { actorOverride: "logistics", scenario: "NEG_ENTREGA" }); txs.push(txView(d)); }
      const rel2 = await agreementAction(code, "release", userId, { scenario: "NEG_ENTREGA" });
      checks.push({ layer: "BLOCKCHAIN", action: "Liberar pago con entrega registrada pero SIN confirmación del comprador", blocked: !rel2.ok, message: rel2.errorMessage ?? "¡Pago liberado!", tx: txView(rel2) });
      const on: any = await chain.readAgreement(code);
      checks.push({ layer: "BLOCKCHAIN", action: "Estado final", blocked: on.state === "FONDEADO", message: `Estado ${on.state}; fondos retenidos en el contrato: ${on.depositedEth} ETH de prueba` });
      return { lot: lot.code, agreement: code, checks, txs, onchain: on };
    },
  },
  "no-autorizado": {
    title: "Usuario no autorizado: el contrato rechaza la transacción",
    run: async (userId) => {
      const checks: any[] = [];
      // Capa ERP: el rol Auditor no tiene permisos de escritura
      const auditor = await prisma.user.findFirstOrThrow({ where: { role: { code: "AUDITOR" } }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
      const perms = new Set(auditor.role.permissions.map((p) => p.permission.code));
      for (const p of ["quality.approve", "blockchain.write", "purchases.approve"]) checks.push({ layer: "ERP", action: `${auditor.email} → requiere ${p}`, blocked: !perms.has(p), message: perms.has(p) ? "Tiene permiso" : "El rol no tiene el permiso: la API responde HTTP 403 y la interfaz oculta la acción (ver pruebas automatizadas)" });
      // Capa contrato: la billetera "intruder" no tiene roles
      const lot = await quickLot(userId, 3, true);
      const code = "SC-NEG-ENTREGA";
      if (!(await prisma.smartAgreement.findUnique({ where: { code } }))) await NEGATIVES["entrega-no-confirmada"].run(userId);
      const attempts: [string, any][] = [
        ["Registrar conformidad de calidad", () => agreementAction(code, "quality", userId, { approved: true, actorOverride: "intruder", scenario: "NEG_NO_AUTORIZADO" })],
        ["Registrar entrega", () => agreementAction(code, "delivery", userId, { actorOverride: "intruder", scenario: "NEG_NO_AUTORIZADO" })],
        ["Confirmar recepción en nombre del comprador", () => agreementAction(code, "confirm", userId, { actorOverride: "intruder", scenario: "NEG_NO_AUTORIZADO" })],
        ["Liberar el pago", () => agreementAction(code, "release", userId, { actorOverride: "intruder", scenario: "NEG_NO_AUTORIZADO" })],
        ["Resolver una disputa como árbitro", () => agreementAction(code, "resolve", userId, { actorOverride: "intruder", releaseToSeller: true, scenario: "NEG_NO_AUTORIZADO" })],
      ];
      for (const [action, fn] of attempts) { const r = await fn(); checks.push({ layer: "BLOCKCHAIN", action: `Billetera no autorizada: ${action}`, blocked: !r.ok, message: r.errorMessage ?? "¡Aceptado!", tx: txView(r) }); }
      const r = await chain.sendTx({ contract: "PaprikaTraceability", fn: "registerLot", args: ["DP-FALSO-001", "0x" + "ab".repeat(32)], actor: "intruder", entityType: "LOT", entityCode: "DP-FALSO-001", scenario: "NEG_NO_AUTORIZADO", userId });
      checks.push({ layer: "BLOCKCHAIN", action: "Billetera no autorizada: registrar un lote falso en trazabilidad", blocked: !r.ok, message: r.ok ? "¡Aceptado!" : r.errorMessage, tx: txView(r) });
      return { lot: lot.code, agreement: code, intruder: chain.actorAddress("intruder"), checks };
    },
  },
};

demoRouter.post("/negative/:name", requirePerm("demo.run"), ah(async (req, res) => {
  const n = NEGATIVES[req.params.name];
  if (!n) throw unprocessable("Escenario inexistente");
  let result: any, status = "COMPLETADA";
  try { result = await n.run(req.user!.id); }
  catch (e: any) { status = "ERROR"; result = { error: e.message, details: e.details }; }
  // cada verificación indica el resultado esperado (por defecto: bloqueada)
  const allBlocked = !!result.checks?.length && result.checks.every((c: any) => c.blocked === (c.expectBlocked ?? true));
  const run = await prisma.demoRun.create({ data: { scenario: `NEG_${req.params.name.toUpperCase()}`, status, steps: { title: n.title, ...result, allBlocked } as any, finishedAt: new Date() } });
  res.status(status === "ERROR" ? 422 : 200).json({ title: n.title, status, allBlocked, ...result, runId: run.id });
}));

/** Reinicia la demostración: restaura datos de demostración y redespliega contratos (identificadores on-chain limpios). */
demoRouter.post("/reset", requirePerm("demo.run", "settings.manage"), ah(async (req, res) => {
  if (req.body?.confirm !== "REINICIAR") throw unprocessable('Confirme escribiendo "REINICIAR"');
  await resetBusinessData(prisma);
  await seedBaseData(prisma);
  let contracts: any = null, chainError: string | null = null;
  try { contracts = await chain.deployContracts(req.user!.id); } catch (e: any) { chainError = e.message; }
  await prisma.demoRun.create({ data: { scenario: "INTEGRAL", status: "REINICIADA", steps: [] } });
  await audit(prisma, req.user!.id, "DEMO_REINICIADA", "demo", null, { contracts, chainError });
  res.json({ ok: true, contracts, chainError });
}));
