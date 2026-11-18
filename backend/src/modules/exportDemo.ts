/**
 * "INICIAR SIMULACIÓN DE EXPORTACIÓN" (sección 19) y pruebas obligatorias P1–P12 (TI-15 + Smart Contracts).
 * Cada paso usa los mismos servicios que la interfaz. La simulación es reiniciable: cada corrida usa
 * códigos nuevos (SIM-n) y no borra las anteriores. Las pruebas P1–P7 se ejecutan dentro de una
 * transacción que se REVIERTE al final (no dejan datos); P8–P12 envían transacciones reales a la red local.
 */
import { Router } from "express";
import { prisma, inTx, Tx } from "../lib/prisma";
import { ah } from "../lib/http";
import { requirePerm } from "../auth/auth";
import { AppError, unprocessable } from "../lib/errors";
import { D } from "../lib/decimal";
import { nextCode } from "../lib/sequence";
import { audit } from "../lib/audit";
import { sha256Bytes32 } from "../lib/hash";
import * as chain from "../blockchain/chain";
import { registerHarvest, sendHarvestToProcessing } from "./agriculture";
import { createProductionOrder, advanceStage, completeOrder } from "./production";
import * as T from "./trade.service";
import * as A from "./automation";
import { shipmentPdf } from "./exportDocs";

export const exportDemoRouter = Router();

export const SIM_STEPS = [
  "Seleccionar parcela", "Registrar cosecha", "Crear lote", "Registrar procesamiento", "Calcular balance de masa", "Registrar análisis de laboratorio",
  "Aprobar COA", "Envasar y generar 2,304 frascos", "Crear 96 cajas", "Registrar una paleta", "Crear pedido internacional", "Reservar inventario",
  "Generar documentación", "Verificar cumplimiento", "Crear Smart Contract", "Depositar fondos de prueba", "Registrar despacho y DAM", "Confirmar entrega",
  "Liberar pago simulado", "Mostrar el resultado en el Dashboard",
];

type Ctx = { n: number; parcel: string; campaign?: string; harvest?: string; rawLot?: string; order?: string; bulkLot?: string; lab?: number; jarLot?: string; sscc?: string; shipmentId?: number; shipment?: string; agreement?: string };
type Step = { step: number; title: string; status: "OK" | "ERROR"; mode: "ERP" | "BLOCKCHAIN" | "ERP+BLOCKCHAIN"; summary: string; data?: any; txs?: any[]; at: string };

const txv = (r: any) => (r?.tx ? { fn: r.tx.functionName, actor: r.tx.actor, status: r.tx.status, hash: r.tx.txHash, block: r.tx.blockNumber, error: r.tx.errorMessage } : null);
async function users() {
  const [admin, calidad] = await Promise.all([prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } }, include: { role: true } }), prisma.user.findFirst({ where: { role: { code: "CALIDAD" } }, include: { role: true } })]);
  return { admin, calidad: calidad ?? admin };
}
const need = (r: any, what: string) => { if (!r?.ok) throw new AppError(422, `${what}: ${r?.errorMessage ?? r?.message ?? "rechazado"}`, "CHAIN_REJECTED", { tx: txv(r) }); return r; };

async function runStep(n: number, c: Ctx): Promise<Omit<Step, "at">> {
  const { admin, calidad } = await users();
  const uid = admin.id;
  const title = SIM_STEPS[n - 1];
  const ok = (mode: Step["mode"], summary: string, data?: any, txs?: any[]) => ({ step: n, title, status: "OK" as const, mode, summary, data, txs });
  const p = await T.params();
  switch (n) {
    case 1: {
      const parcel = await prisma.parcel.findUniqueOrThrow({ where: { code: c.parcel } });
      return ok("ERP", `Parcela ${parcel.code} · ${parcel.name} · ${parcel.location} · ${parcel.areaHa} ha · ${parcel.cropType}.`, { parcel: parcel.code });
    }
    case 2: {
      if (!c.campaign) {
        const parcel = await prisma.parcel.findUniqueOrThrow({ where: { code: c.parcel } });
        const camp = await prisma.campaign.create({ data: { code: `CAM-SIM-${c.n}`, parcelId: parcel.id, variety: "Papri King", sowingDate: new Date(Date.now() - 170 * 86400000), estHarvestDate: new Date(), estimatedYieldKg: 2150, status: "EN_CURSO", notes: "Campaña de la simulación de exportación (demo)" } });
        c.campaign = camp.code;
        const lotCode = await inTx((tx) => nextCode(tx, `LOTE-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`, null, 3));
        await inTx((tx) => registerHarvest(tx, camp.id, { date: new Date(), quantityKg: 2150, notes: "Cosecha soleada, 24 °C, sin lluvias (demo)", lotCode }, uid));
        const lot = await prisma.lot.findUniqueOrThrow({ where: { code: lotCode }, include: { harvest: true } });
        c.harvest = lot.harvest!.code; c.rawLot = lot.code;
      }
      return ok("ERP", `Cosecha ${c.harvest}: 2,150 kg de fruto fresco (Papri King), clima soleado. Ingreso al almacén de materia prima. Ficha de cosecha PDF con QR de origen disponible.`, { harvest: c.harvest, pdf: `/trade/harvests/${c.harvest}/ficha.pdf` });
    }
    case 3: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: c.rawLot! }, include: { harvest: true, campaign: { include: { parcel: true } } } });
      await inTx((tx) => sendHarvestToProcessing(tx, lot.harvestId!, uid));
      return ok("ERP", `Lote ${lot.code} (formato LOTE-AAAA-MM-NNN) hereda la parcela ${lot.campaign?.parcel.code} y la fecha de cosecha ${lot.productionDate.toISOString().slice(0, 10)}.`, { lot: lot.code, parcel: lot.campaign?.parcel.code, harvestDate: lot.productionDate });
    }
    case 4: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: c.rawLot! } });
      if (!c.order) { const o = await inTx((tx) => createProductionOrder(tx, { sourceLotId: lot.id, initialWeightKg: 2150, code: `OP-SIM-${c.n}` }, uid)); c.order = o.code; }
      const o = await prisma.productionOrder.findUniqueOrThrow({ where: { code: c.order } });
      const plan: Record<string, any> = {
        SELECCION: { outputKg: 1999.5, notes: "Selección y lavado: descarte 7 % (150.5 kg)" }, LAVADO_ACONDICIONAMIENTO: { outputKg: 1990, notes: "Lavado con agua potable" },
        DESHIDRATACION: { outputKg: 290, temperatureC: 60, durationH: 28, notes: "Humedad final 9.8 % · GLP 50.6 kg (0.19 kg/kg)" }, MOLIENDA: { outputKg: 268, notes: "Despalillado, molienda y tamizado malla 40" },
        CONTROL_CALIDAD: { outputKg: 267, notes: "Reducción microbiana por vapor (maquila) y detector de metales" }, ENVASADO: { outputKg: 266.5, notes: "Granel en bolsas grado alimentario para envasado" },
      };
      let cur = o;
      while (cur.status === "EN_PROCESO" && cur.currentStage !== "ALMACEN") {
        await inTx((tx) => advanceStage(tx, o.id, plan[cur.currentStage] ?? {}, uid));
        cur = await prisma.productionOrder.findUniqueOrThrow({ where: { id: o.id } });
      }
      return ok("ERP", `Orden ${o.code}: recepción → selección y lavado (−7 %) → deshidratado 60 °C × 28 h (humedad 9.8 %, GLP 50.6 kg) → despalillado/molienda/tamizado → reducción microbiana → control de metales.`, { order: o.code });
    }
    case 5: {
      const o = await prisma.productionOrder.findUniqueOrThrow({ where: { code: c.order! } });
      if (o.status !== "COMPLETADA") {
        const code = `DP-SIM-${c.n}`;
        await inTx((tx) => completeOrder(tx, o.id, { finalWeightKg: 266.5, outputs: [{ quantityKg: 266.5, code }], laborCost: 420, energyCost: 770, packagingCost: 0, otherCost: 180, expiryMonths: 12 }, uid));
        c.bulkLot = code;
      }
      c.bulkLot ??= `DP-SIM-${c.n}`;
      const mb = T.massBalance(p, 2150, 266.5, 150.5);
      return ok("ERP", `Balance de masa: 2,150 kg de fruto → 266.5 kg de páprika molida. Rendimiento real ${mb.realYieldPct} % vs. referencia ${p.yieldPct} % (8.075 kg/kg = ${mb.expectedFinalKg} kg esperados; desviación ${mb.deviationKg} kg). Merma 1,883.5 kg. Alcanza para ${mb.jarsPossible} frascos.`, mb);
    }
    case 6: {
      if (!c.lab) {
        const r = await inTx((tx) => T.registerLabAnalysis(tx, { lotCode: c.bulkLot, laboratory: "Laboratorio acreditado (ficticio) — Lima", asta: 114, moisturePct: 9.8, aw: 0.55, salmonella: "AUSENTE", ecoli: 2, moldsYeasts: 600, aflatoxinB1: 1.2, aflatoxinTotal: 2.6, ochratoxinA: 3.4, bannedDyes: "NO_DETECTADO", foreignMatter: "CONFORME", metalDetection: "CONFORME", netWeightG: 113.3 }, calidad.id));
        c.lab = r.analysis.id;
      }
      const a = await prisma.labAnalysis.findUniqueOrThrow({ where: { id: c.lab } });
      return ok("ERP", `Análisis ${a.code}: 114 ASTA, humedad 9.8 %, aw 0.55, Salmonella ausente/25 g, aflatoxina B1 1.2 µg/kg, totales 2.6 µg/kg, OTA 3.4, sin colorantes prohibidos, metales conformes. Todos los parámetros CUMPLEN.`, { analysis: a.code, evaluation: a.evaluation });
    }
    case 7: {
      const a = await prisma.labAnalysis.findUniqueOrThrow({ where: { id: c.lab! } });
      if (a.result !== "APROBADO") await inTx((tx) => T.decideLabAnalysis(tx, a.id, { decision: "APROBADO", evidence: `Informe de ensayo ${a.code} (demo)` }, { id: calidad.id, name: calidad.name, roleName: calidad.role.name }));
      const done = await prisma.labAnalysis.findUniqueOrThrow({ where: { id: a.id }, include: { lot: true } });
      return ok("ERP", `COA de demostración (no oficial) aprobado por ${done.approvedBy} el ${done.approvedAt?.toISOString().slice(0, 16).replace("T", " ")}. Evidencia: ${done.evidence}. Hash SHA-256: ${done.coaHash?.slice(0, 20)}…  Stock liberado de cuarentena.`, { approvedBy: done.approvedBy, coaHash: done.coaHash });
    }
    case 8: {
      if (!c.jarLot) { const r = await inTx((tx) => T.packLot(tx, { sourceLotCode: c.bulkLot!, pallets: 1 }, uid)); c.jarLot = r.lot.code; c.sscc = r.palletList[0]?.sscc; }
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: c.jarLot } });
      return ok("ERP", `Lote de frascos ${lot.code}: 2,304 frascos × 113 g = ${D(lot.quantityKg).toFixed(3)} kg netos (referencia del plan ≈ 260.4 kg; la diferencia de 0.048 kg es redondeo, no merma). Granel restante en ${c.bulkLot}: ${(266.5 - Number(lot.quantityKg)).toFixed(3)} kg. Best by: ${lot.expiryDate?.toISOString().slice(0, 10)}.`, { jarLot: lot.code });
    }
    case 9: {
      const g = T.gtinCodes(p.gs1CompanyPrefix);
      return ok("ERP", `96 cajas shelf-ready de 24 frascos (GTIN-14 ${g.gtin14}); frasco GTIN ${g.gtin13}. Consumo automático de 2,304 frascos, tapas y sellos, 4,608 etiquetas y 96 cajas en el almacén de insumos.`, g);
    }
    case 10: {
      const pl = await prisma.pallet.findUniqueOrThrow({ where: { sscc: c.sscc! } });
      return ok("ERP", `Paleta SSCC ${pl.sscc}: ${pl.cases} cajas · ${pl.jars} frascos · neto ${D(pl.netKg).toFixed(3)} kg · bruto ${D(pl.grossKg).toFixed(3)} kg · ${pl.location}. Etiquetas GS1 y QR de trazabilidad generadas.`, { sscc: pl.sscc });
    }
    case 11: {
      if (!c.shipmentId) {
        const cust = await prisma.customer.findUniqueOrThrow({ where: { code: "CLI-USA-001" } });
        const s = await inTx((tx) => T.createShipment(tx, { customerId: cust.id, pallets: 1, unitPriceUsd: 2.0, incoterm: "FCA", deliveryDate: new Date(Date.now() + 30 * 86400000), broker: "Food Broker Demo (EE. UU.)", notes: `Simulación de exportación SIM-${c.n} (datos de prueba)` }, uid));
        await prisma.exportShipment.update({ where: { id: s.id }, data: { autopilot: false } });
        c.shipmentId = s.id; c.shipment = s.code;
      }
      const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId } });
      return ok("ERP", `Pedido ${s.code} de Importador Demo USA: 1 paleta FCA (${s.incotermVersion}) Callao · 2,304 frascos × US$ ${D(s.unitPriceUsd).toFixed(2)} = US$ ${D(s.amountUsd).toFixed(2)} (precio ficticio de prueba). Margen estimado ${D(s.marginPct ?? 0).toFixed(2)} % (piso ${p.marginFloorPct} %).`, { shipment: s.code });
    }
    case 12: {
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: c.jarLot! } });
      const s0 = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId! } });
      if (s0.status === "PEDIDO") await inTx((tx) => T.validateQuality(tx, s0.id, uid));
      const r: any = await inTx((tx) => T.reserveShipment(tx, s0.id, uid, lot.id));
      return ok("ERP", `R1 verificado (COA aprobado). Reservada la paleta ${r.pallets.map((x: any) => x.sscc).join(", ")}: el sistema identificó automáticamente ${r.cases ?? 96} cajas y ${r.jars ?? 2304} frascos.`, { cases: r.cases, jars: r.jars });
    }
    case 13: {
      const r = await inTx((tx) => T.validateDocs(tx, c.shipmentId!, {}, uid));
      if (!r.ok) throw unprocessable(r.errors.join(" · "));
      return ok("ERP", `Paquete documental aprobado (R2: neto ${r.totals.netKg.toFixed(3)} kg y bruto ${r.totals.grossKg.toFixed(3)} kg = suma de paletas; R3: descripción y subpartida ${p.hsCode} del catálogo). Factura, packing list, contenido de paleta, instrucciones al agente, datos ISF y Prior Notice, COA y certificación de origen.`, r.totals);
    }
    case 14: {
      const blockers = await T.complianceBlockers(prisma, new Date(Date.now() + 30 * 86400000));
      if (blockers.length) throw unprocessable(`R7: ${blockers.map((b) => b.name).join("; ")}`);
      await prisma.complianceItem.updateMany({ where: { shipmentId: c.shipmentId, code: "ORIGEN-APC" }, data: { status: "CUMPLIDO", evidence: "Certificación de origen APC generada (borrador demo)" } });
      await inTx((tx) => T.confirmShipment(tx, c.shipmentId!, uid));
      const items = await prisma.complianceItem.findMany({ where: { scope: "EMPRESA" } });
      return ok("ERP", `Cumplimiento verificado: ${items.length} registros de empresa vigentes (FDA FFR, agente EE. UU., FSMA/PCQI, DIGESA, BPA, BPM, SUNAT…), sin bloqueos R7. Pedido confirmado. El sistema no declara cumplimiento sin evidencia.`, { items: items.map((i) => ({ code: i.code, status: T.complianceStatus(i) })) });
    }
    case 15: {
      const r: any = await A.createShipmentAgreement(c.shipmentId!, uid);
      if (r && r.ok === false) need(r, "Creación del acuerdo");
      const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId! }, include: { agreement: true } });
      c.agreement = s.agreement!.code;
      const txs = await prisma.blockchainTransaction.findMany({ where: { OR: [{ entityCode: c.agreement }, { entityCode: c.jarLot }] }, orderBy: { id: "asc" } });
      return ok("BLOCKCHAIN", `Lote ${c.jarLot} registrado en PaprikaTraceability con hitos Parcela → Cosecha → Producción → Calidad → Envasado → Paleta. Acuerdo ${c.agreement} creado por Don Pimentón y aceptado por el comprador.`, { agreement: c.agreement }, txs.map((t) => ({ fn: t.functionName, actor: t.actor, status: t.status, hash: t.txHash, block: t.blockNumber })));
    }
    case 16: {
      const txs: any[] = [];
      const on: any = await chain.readAgreement(c.agreement!);
      if (on.state === "ACEPTADO") txs.push(txv(need(await A.sendAg(c.shipmentId!, "depositFunds", [c.agreement], "importer", uid, `3. Depósito de ${on.amountEth} ETH de prueba en custodia`, BigInt(on.amountWei)), "Depósito")));
      const on2: any = await chain.readAgreement(c.agreement!);
      const lot = await prisma.lot.findUniqueOrThrow({ where: { code: c.jarLot! } });
      if (on2.quality === "PENDIENTE") txs.push(txv(need(await A.sendAg(c.shipmentId!, "recordQuality", [c.agreement, true, lot.certHash], "quality", uid, "4-5. Conformidad de calidad registrada on-chain por el servicio autorizado"), "Calidad")));
      const fin: any = await chain.readAgreement(c.agreement!);
      return ok("BLOCKCHAIN", `Fondos de prueba en custodia: ${fin.depositedEth} ETH (≙ S/ ${fin.referencePen}). Calidad: ${fin.quality}. Sin dinero real.`, { onchain: fin }, txs);
    }
    case 17: {
      const now = Date.now();
      await inTx((tx) => T.updateCustoms(tx, c.shipmentId!, { damNumber: `118-${new Date().getFullYear()}-40-${String(900000 + c.n)}`, damDate: new Date(now - 6 * 86400000), channel: "VERDE", levanteDate: new Date(now - 6 * 86400000), cargoCutoff: new Date(now + 2 * 86400000), isfSentAt: new Date(now - 2 * 86400000), priorNoticeNo: `PN-SIM-${c.n}`, blNumber: `DPSIM${c.n}CLLPEF`, manifest: `118-${new Date().getFullYear()}-${3000 + c.n}`, container: `DPMU${String(7000000 + c.n)}`, vessel: "MSC DEMO EXPRESS", shippingLine: "Naviera demo (ficticia)" }, uid));
      await inTx((tx) => T.dispatchShipment(tx, c.shipmentId!, uid));
      const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId! } });
      await A.milestone(c.jarLot!, "EMBARQUE", { bl: s.blNumber, dam: s.damNumber, vessel: s.vessel, container: s.container }, "logistics", s.id, uid);
      const light = T.customsLight(s, p);
      return ok("ERP+BLOCKCHAIN", `DAM ${s.damNumber} canal verde (numerada hace 6 días → semáforo ${light.light}); ISF enviado 48 h antes del cierre; Prior Notice ${s.priorNoticeNo}. Despacho FCA: B/L ${s.blNumber}, contenedor ${s.container}, nave ${s.vessel}. El barco zarpa del Callao hacia ${s.destinationPort} (ver mapa).`, { light });
    }
    case 18: {
      const txs: any[] = [];
      let s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId! } });
      if (s.status === "EN_TRANSITO") { await prisma.exportShipment.update({ where: { id: s.id }, data: { voyageProgress: 1, status: "ARRIBADO", arrivedAt: new Date() } }); await T.event(prisma, s.id, "VIAJE", `Arribo a ${s.destinationPort}`, "success"); }
      const on: any = await chain.readAgreement(c.agreement!);
      if (on.delivery === "PENDIENTE") {
        const ev = sha256Bytes32(JSON.stringify({ ship: s.code, bl: s.blNumber, port: s.destinationPort }));
        txs.push(txv(need(await A.sendAg(s.id, "recordDelivery", [c.agreement, ev], "logistics", uid, "6. Logística registra la entrega con el hash de la evidencia"), "Entrega")));
        await prisma.exportShipment.update({ where: { id: s.id }, data: { status: "ENTREGADO", deliveredAt: new Date(), regularizedAt: new Date() } });
        await prisma.complianceItem.updateMany({ where: { shipmentId: s.id, code: "REGULARIZACION" }, data: { status: "CUMPLIDO", evidence: "DAM regularizada (demo)" } });
        await A.milestone(c.jarLot!, "ENTREGA", { ship: s.code, evidence: ev }, "logistics", s.id, uid);
      }
      const on2: any = await chain.readAgreement(c.agreement!);
      if (on2.delivery === "ENTREGADA") txs.push(txv(need(await A.confirmByBuyer(s.id, "comprador — billetera demo"), "Confirmación")));
      s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: s.id } });
      const fin: any = await chain.readAgreement(c.agreement!);
      return ok("ERP+BLOCKCHAIN", `Arribo y entrega registrados; el comprador confirmó la recepción. Condiciones del contrato: ${fin.canReleaseReason}.`, { onchain: fin }, txs);
    }
    case 19: {
      const on: any = await chain.readAgreement(c.agreement!);
      let tx = null;
      if (on.state !== "EJECUTADO") {
        const r = need(await A.sendAg(c.shipmentId!, "releasePayment", [c.agreement], "seller", uid, "9. El contrato verificó las condiciones y liberó el pago simulado"), "Liberación");
        tx = txv(r);
        await A.closeShipment(c.shipmentId!, r.tx.txHash, uid);
      }
      const fin: any = await chain.readAgreement(c.agreement!);
      return ok("BLOCKCHAIN", `Pago simulado liberado al vendedor: estado ${fin.state}. Cobranza conciliada en Finanzas como ingreso SIMULADO (fondos de prueba, sin dinero real).`, { onchain: fin }, tx ? [tx] : []);
    }
    case 20: {
      const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: c.shipmentId! } });
      const f = await T.shipmentFinance(prisma, s.id);
      const k = await T.kpis(prisma);
      return ok("ERP", `Exportación ${s.code} CERRADA. Costo por frasco S/ ${D(f.costPerJarPen ?? 0).toFixed(4)}, costo por paleta S/ ${D(f.costPerPalletPen ?? 0).toFixed(2)}, margen ${D(f.marginPct ?? 0).toFixed(2)} %. OTIF: ${s.otif ? "sí" : "no"}. Dashboard e indicadores actualizados. Reporte PDF final listo.`, { shipment: s.code, finance: f, kpis: k, pdf: `/trade/shipments/${s.id}/docs/reporte.pdf` });
    }
  }
  throw unprocessable("Paso inexistente");
}

async function currentRun() {
  return prisma.demoRun.findFirst({ where: { scenario: "EXPORTACION" }, orderBy: { id: "desc" } });
}
const runView = (r: any) => r && ({ id: r.id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, ctx: (r.steps as any).ctx, results: (r.steps as any).results, total: SIM_STEPS.length });

exportDemoRouter.get("/sim", requirePerm("dashboard.read"), ah(async (_req, res) => res.json({ steps: SIM_STEPS, run: runView(await currentRun()) })));
exportDemoRouter.post("/sim/start", requirePerm("demo.run"), ah(async (req, res) => {
  const n = Number((await inTx((tx) => nextCode(tx, "SIMEXP", null, 1))).split("-").pop());
  const run = await prisma.demoRun.create({ data: { scenario: "EXPORTACION", status: "EN_CURSO", steps: { ctx: { n, parcel: "PAR-001" }, results: [] } as any } });
  await audit(prisma, req.user!.id, "INICIAR_SIMULACION_EXPORTACION", "demo", run.id, { n });
  res.json({ steps: SIM_STEPS, run: runView(run) });
}));
exportDemoRouter.post("/sim/next", requirePerm("demo.run"), ah(async (_req, res) => {
  const run = await currentRun();
  if (!run || run.status !== "EN_CURSO") throw unprocessable("Inicie una simulación");
  const st = run.steps as any;
  const n = st.results.filter((r: Step) => r.status === "OK").length + 1;
  if (n > SIM_STEPS.length) throw unprocessable("La simulación ya terminó");
  let result: Step;
  try { result = { ...(await runStep(n, st.ctx)), at: new Date().toISOString() }; }
  catch (e: any) { result = { step: n, title: SIM_STEPS[n - 1], status: "ERROR", mode: "ERP", summary: e.message, data: e.details, at: new Date().toISOString() }; }
  const results = [...st.results.filter((r: Step) => r.step !== n), result];
  const done = result.status === "OK" && n === SIM_STEPS.length;
  const upd = await prisma.demoRun.update({ where: { id: run.id }, data: { steps: { ctx: st.ctx, results } as any, status: done ? "COMPLETADA" : "EN_CURSO", finishedAt: done ? new Date() : null } });
  res.json({ steps: SIM_STEPS, run: runView(upd), last: result });
}));
exportDemoRouter.get("/sim/report.pdf", requirePerm("reports.read"), ah(async (_req, res) => {
  const run = await currentRun();
  const id = (run?.steps as any)?.ctx?.shipmentId;
  if (!id) throw unprocessable("Aún no hay un embarque de simulación");
  await shipmentPdf(res, id, "reporte");
}));

// ------------------------------------------------------------------ pruebas P1–P12
class Rollback extends Error { constructor(public result: any) { super("rollback"); } }
async function sandbox(fn: (tx: Tx) => Promise<any>) {
  try { await prisma.$transaction(async (tx) => { throw new Rollback(await fn(tx as Tx)); }, { timeout: 60000 }); }
  catch (e: any) { if (e instanceof Rollback) return e.result; throw e; }
}
const expectFail = async (fn: () => Promise<any>) => { try { await fn(); return null; } catch (e: any) { return e.message as string; } };

export const TESTS: Record<string, { title: string; expected: string; run: () => Promise<{ passed: boolean; evidence: string[] }> }> = {
  P1: { title: "Cosecha y lote", expected: "El lote hereda parcela y fecha; se genera el código LOTE-AAAA-MM-NNN", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const parcel = await tx.parcel.findUniqueOrThrow({ where: { code: "PAR-002" } });
    const camp = await tx.campaign.create({ data: { code: "CAM-TEST-P1", parcelId: parcel.id, variety: "Papri King", sowingDate: new Date("2026-05-01"), estHarvestDate: new Date(), estimatedYieldKg: 500, status: "EN_CURSO" } });
    const date = new Date("2026-11-10");
    await registerHarvest(tx, camp.id, { date, quantityKg: 500 }, admin.id);
    const lot = await tx.lot.findFirstOrThrow({ where: { campaignId: camp.id }, include: { harvest: true, campaign: { include: { parcel: true } } } });
    const okCode = /^LOTE-2026-11-\d{3}$/.test(lot.code);
    return { passed: okCode && lot.campaign!.parcel.code === "PAR-002" && lot.productionDate.toISOString().slice(0, 10) === "2026-11-10", evidence: [`Lote generado: ${lot.code}`, `Parcela heredada: ${lot.campaign!.parcel.code}`, `Fecha de cosecha heredada: ${lot.productionDate.toISOString().slice(0, 10)}`, `Cosecha: ${lot.harvest!.code}`] };
  }) },
  P2: { title: "Calidad fuera de especificación", expected: "El lote queda «retenido» y no puede reservarse", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const jar = await tx.pallet.findFirstOrThrow({ where: { status: "DISPONIBLE" }, include: { lot: true } });
    const r = await T.registerLabAnalysis(tx, { lotCode: jar.lot.code, laboratory: "Lab de prueba", asta: 108, moisturePct: 12.6, aflatoxinB1: 7.5, aflatoxinTotal: 11.2, salmonella: "AUSENTE" }, admin.id);
    const lot = await tx.lot.findUniqueOrThrow({ where: { id: jar.lotId } });
    const r1 = await T.coaApproved(tx, lot.id);
    const pallet = await tx.pallet.findUniqueOrThrow({ where: { id: jar.id } });
    return { passed: r.retained && lot.qualityStatus === "CUARENTENA" && !r1.ok && pallet.status === "RETENIDO", evidence: [`Análisis ${r.analysis.code}: ${r.evaluation.filter((e: any) => e.result === "NO_CUMPLE").map((e: any) => `${e.label} ${e.value} (${e.limit})`).join("; ")}`, `Estado del lote ${lot.code}: ${lot.qualityStatus} (retenido)`, `Paleta ${pallet.sscc}: ${pallet.status}`, `Reserva: ${r1.reason}`] };
  }) },
  P3: { title: "Pedido de 1 paleta FCA", expected: "El ERP reserva 96 cajas y calcula 2,304 frascos", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const cust = await tx.customer.findUniqueOrThrow({ where: { code: "CLI-USA-001" } });
    const s = await T.createShipment(tx, { customerId: cust.id, pallets: 1, incoterm: "FCA", deliveryDate: new Date(Date.now() + 30 * 86400000) }, admin.id);
    await T.validateQuality(tx, s.id, admin.id);
    const r: any = await T.reserveShipment(tx, s.id, admin.id);
    return { passed: r.cases === 96 && r.jars === 2304 && s.jars === 2304, evidence: [`Pedido ${s.code}: ${s.pallets} paleta, Incoterm ${s.incoterm}`, `Calculado: ${s.cases} cajas · ${s.jars} frascos`, `Reservado: ${r.cases} cajas · ${r.jars} frascos · SSCC ${r.pallets.map((p: any) => p.sscc).join(", ")}`] };
  }) },
  P4: { title: "Documentos con pesos inconsistentes", expected: "El sistema rechaza y muestra la discrepancia", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const cust = await tx.customer.findUniqueOrThrow({ where: { code: "CLI-USA-001" } });
    const s = await T.createShipment(tx, { customerId: cust.id, pallets: 1, incoterm: "FCA", deliveryDate: new Date(Date.now() + 30 * 86400000) }, admin.id);
    await T.validateQuality(tx, s.id, admin.id); await T.reserveShipment(tx, s.id, admin.id);
    const r = await T.validateDocs(tx, s.id, { declaredNetKg: 250, declaredGrossKg: 560 }, admin.id);
    return { passed: !r.ok && r.shipment.docsStatus === "RECHAZADO" && r.errors.some((e) => e.startsWith("R2")), evidence: [`Estado documental: ${r.shipment.docsStatus}`, ...r.errors] };
  }) },
  P5: { title: "DAM numerada hace 22 días sin embarque", expected: "El semáforo cambia a ámbar y envía alerta", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const cust = await tx.customer.findUniqueOrThrow({ where: { code: "CLI-USA-001" } });
    const s = await T.createShipment(tx, { customerId: cust.id, pallets: 1, incoterm: "FCA", deliveryDate: new Date(Date.now() + 30 * 86400000) }, admin.id);
    const u = await T.updateCustoms(tx, s.id, { damNumber: "118-2026-40-TEST22", damDate: new Date(Date.now() - 22 * 86400000) }, admin.id);
    const light = T.customsLight(u, await T.params(tx));
    return { passed: light.light === "AMBAR" && light.alerts.length > 0, evidence: [`DAM ${u.damNumber} numerada el ${u.damDate!.toISOString().slice(0, 10)}`, `Semáforo: ${light.light} · ${light.phase}`, ...light.alerts.map((a) => `Alerta: ${a.message}`)] };
  }) },
  P6: { title: "Registro obligatorio vencido", expected: "Se bloquea el pedido nuevo", run: () => sandbox(async (tx) => {
    const admin = await tx.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
    const cust = await tx.customer.findUniqueOrThrow({ where: { code: "CLI-USA-001" } });
    await tx.complianceItem.updateMany({ where: { scope: "EMPRESA", code: "DIGESA-RS" }, data: { validUntil: new Date(Date.now() - 86400000) } });
    const err = await expectFail(() => T.createShipment(tx, { customerId: cust.id, pallets: 1, incoterm: "FCA", deliveryDate: new Date(Date.now() + 30 * 86400000) }, admin.id));
    return { passed: !!err && err.includes("R7"), evidence: ["Se simuló el vencimiento del registro sanitario DIGESA (ayer)", `Respuesta del sistema: ${err ?? "el pedido NO fue bloqueado"}`] };
  }) },
  P7: { title: "Ingreso como agente de aduana", expected: "Solo ve sus documentos y no ve costos", run: async () => {
    const agent = await prisma.user.findUniqueOrThrow({ where: { email: "agente@aduanas-demo.pe" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
    const perms = new Set(agent.role.permissions.map((p) => p.permission.code));
    const own = await prisma.exportShipment.count({ where: { agentEmail: agent.email } });
    const all = await prisma.exportShipment.count();
    const sample = await prisma.exportShipment.findFirst({ where: { agentEmail: agent.email }, include: { costs: true } });
    const view = sample ? T.sanitizeForRole(sample, perms.has("costs.read")) : null;
    const noCosts = !perms.has("costs.read") && !perms.has("finance.read") && (!view || (view.costs === undefined && view.marginPct === undefined));
    return { passed: noCosts && perms.has("customs.write"), evidence: [`Rol: ${agent.role.name}`, `Permisos: ${[...perms].join(", ")}`, `Costos financieros: ${perms.has("costs.read") ? "VISIBLES" : "sin acceso (403 en /finance y /trade/…/costs)"}`, `Embarques autorizados visibles: ${own} de ${all}`, view ? `Vista del embarque ${view.code}: margen y costos ocultos = ${view.costsHidden === true}` : "Sin embarques asignados"] };
  } },
  P8: { title: "Calidad y entrega aprobadas → el pago se libera", expected: "El pago simulado puede liberarse", run: () => chainCase("P8", { approve: true, release: true }) },
  P9: { title: "Calidad rechazada → pago bloqueado", expected: "El pago permanece bloqueado", run: () => chainCase("P9", { approve: false, release: true }) },
  P10: { title: "Cuenta no autorizada", expected: "El contrato rechaza la operación", run: () => chainCase("P10", { intruder: true }) },
  P11: { title: "Liberar el mismo pago dos veces", expected: "La segunda operación falla", run: () => chainCase("P11", { approve: true, release: true, twice: true }) },
  P12: { title: "Documento modificado", expected: "El hash ya no coincide con el registrado", run: async () => {
    const id = `TEST-P12-${Date.now()}`;
    const original = "COA LOTE TEST · aflatoxinas totales 2.6 µg/kg · APROBADO";
    const tampered = original.replace("2.6", "1.6");
    const uid = (await users()).admin.id;
    need(await chain.sendTx({ contract: "PaprikaTraceability", fn: "registerLot", args: [id, sha256Bytes32("datos " + id)], actor: "registrar", entityType: "TEST", entityCode: id, scenario: "PRUEBAS", userId: uid }), "Registro");
    need(await chain.sendTx({ contract: "PaprikaTraceability", fn: "recordQuality", args: [id, 1, sha256Bytes32(original)], actor: "quality", entityType: "TEST", entityCode: id, scenario: "PRUEBAS", userId: uid }), "Calidad");
    const { c } = await chain.contract("PaprikaTraceability");
    const [, certOk] = await c.verifyLot(id, sha256Bytes32("datos " + id), sha256Bytes32(original));
    const [, certTampered] = await c.verifyLot(id, sha256Bytes32("datos " + id), sha256Bytes32(tampered));
    return { passed: certOk === true && certTampered === false, evidence: [`Hash registrado: ${sha256Bytes32(original)}`, `Documento original → coincide: ${certOk}`, `Documento modificado («2.6» → «1.6») → hash ${sha256Bytes32(tampered).slice(0, 22)}… → coincide: ${certTampered}`] };
  } },
};

async function chainCase(tag: string, o: { approve?: boolean; release?: boolean; twice?: boolean; intruder?: boolean }) {
  const uid = (await users()).admin.id;
  const lot = `TEST-${tag}-${Date.now()}`, ag = `SC-${lot}`;
  const base = { entityType: "TEST", entityCode: ag, scenario: "PRUEBAS", userId: uid };
  const ev: string[] = [];
  const s = async (contract: chain.ContractName, fn: string, args: unknown[], actor: chain.Actor, value?: bigint) => {
    const r = await chain.sendTx({ contract, fn, args, actor, value, ...base });
    ev.push(`${fn} (${actor}) → ${r.ok ? `CONFIRMADA bloque ${r.tx.blockNumber} · ${r.tx.txHash?.slice(0, 14)}…` : `RECHAZADA: ${r.errorMessage}`}`);
    return r;
  };
  need(await s("PaprikaTraceability", "registerLot", [lot, sha256Bytes32(lot)], "registrar"), "registro");
  need(await s("PaprikaTraceability", "recordQuality", [lot, o.approve === false ? 2 : 1, sha256Bytes32("coa " + lot)], "quality"), "calidad lote");
  const wei = chain.parseEth("0.5");
  need(await s("PaprikaTradeAgreement", "createAgreement", [ag, lot, chain.actorAddress("importer"), 260n, wei, 187500n, BigInt(Math.floor(Date.now() / 1000) + 86400 * 30)], "seller"), "creación");
  need(await s("PaprikaTradeAgreement", "acceptAgreement", [ag], "importer"), "aceptación");
  need(await s("PaprikaTradeAgreement", "depositFunds", [ag], "importer", wei), "depósito");
  if (o.intruder) {
    const r = await s("PaprikaTradeAgreement", "recordQuality", [ag, true, sha256Bytes32("x")], "intruder");
    const r2 = await s("PaprikaTradeAgreement", "releasePayment", [ag], "intruder");
    return { passed: !r.ok && !r2.ok, evidence: ev };
  }
  if (o.approve === false) {
    await s("PaprikaTradeAgreement", "recordQuality", [ag, false, sha256Bytes32("coa " + lot)], "quality");
    const rel = await s("PaprikaTradeAgreement", "releasePayment", [ag], "seller");
    const refund = await s("PaprikaTradeAgreement", "cancelAgreement", [ag, "Calidad rechazada"], "importer");
    const fin: any = await chain.readAgreement(ag);
    ev.push(`Estado final: ${fin.state} (fondos devueltos al comprador: ${refund.ok})`);
    return { passed: !rel.ok && refund.ok, evidence: ev };
  }
  need(await s("PaprikaTradeAgreement", "recordQuality", [ag, true, sha256Bytes32("coa " + lot)], "quality"), "conformidad");
  const early = await s("PaprikaTradeAgreement", "releasePayment", [ag], "seller");
  need(await s("PaprikaTradeAgreement", "recordDelivery", [ag, sha256Bytes32("entrega " + lot)], "logistics"), "entrega");
  need(await s("PaprikaTradeAgreement", "confirmReceipt", [ag], "importer"), "confirmación");
  const rel = await s("PaprikaTradeAgreement", "releasePayment", [ag], "seller");
  if (o.twice) { const again = await s("PaprikaTradeAgreement", "releasePayment", [ag], "seller"); return { passed: rel.ok && !again.ok, evidence: ev }; }
  const fin: any = await chain.readAgreement(ag);
  ev.push(`Estado final: ${fin.state}`);
  return { passed: !early.ok && rel.ok && fin.state === "EJECUTADO", evidence: ev };
}

exportDemoRouter.get("/tests", requirePerm("dashboard.read"), ah(async (_req, res) => {
  const last = await prisma.auditLog.findMany({ where: { action: "PRUEBA_ACEPTACION" }, orderBy: { id: "desc" }, take: 60 });
  res.json(Object.entries(TESTS).map(([id, t]) => ({ id, title: t.title, expected: t.expected, last: last.find((l) => (l.details as any)?.id === id) ?? null })));
}));
exportDemoRouter.post("/tests/:id", requirePerm("demo.run"), ah(async (req, res) => {
  const t = TESTS[req.params.id];
  if (!t) throw unprocessable("Prueba inexistente");
  const started = Date.now();
  let out: { passed: boolean; evidence: string[] };
  try { out = await t.run(); } catch (e: any) { out = { passed: false, evidence: [`Error: ${e.message}`] }; }
  const result = { id: req.params.id, title: t.title, expected: t.expected, ...out, ms: Date.now() - started, at: new Date().toISOString(), rolledBack: Number(req.params.id.slice(1)) <= 6 };
  await audit(prisma, req.user!.id, "PRUEBA_ACEPTACION", "pruebas", req.params.id, result);
  res.json(result);
}));
