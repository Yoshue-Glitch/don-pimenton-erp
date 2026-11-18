/**
 * Motor de automatización del Smart Contract de exportación.
 * Cada tarea del flujo se ejecuta sola cuando se cumplen sus condiciones en el ERP:
 *  pedido → validación de calidad (R1) → reserva → confirmación → contrato on-chain → aceptación →
 *  depósito (al aprobarse el pago real o con fondos de prueba) → conformidad de calidad on-chain →
 *  documentos (R2/R3) → DAM → despacho → viaje (mapa) → arribo → entrega registrada →
 *  confirmación del comprador → verificación de condiciones → liberación del pago → cierre.
 * Lo que figura "on-chain" solo se marca así cuando existe una transacción confirmada.
 */
import { prisma, inTx } from "../lib/prisma";
import { D } from "../lib/decimal";
import { hashObject, sha256Bytes32 } from "../lib/hash";
import { getSetting } from "../lib/settings";
import { audit } from "../lib/audit";
import { nextCode } from "../lib/sequence";
import * as chain from "../blockchain/chain";
import { anchorLot } from "./blockchain.service";
import * as T from "./trade.service";

const DAY = 86400000;
let running = false;
let timer: NodeJS.Timeout | null = null;

export type AutoSettings = { enabled: boolean; voyageSeconds: number; simulateBuyerConfirm: boolean; buyerConfirmDelaySeconds: number; autoTestFunds: boolean; intervalMs: number };
export const autoSettings = async (): Promise<AutoSettings> => ({
  enabled: true, voyageSeconds: 150, simulateBuyerConfirm: true, buyerConfirmDelaySeconds: 20, autoTestFunds: true, intervalMs: 4000,
  ...((await getSetting<any>("automation.settings")) ?? {}),
});

export const agreementCode = (shipCode: string) => `SC-${shipCode}`;

async function systemUser() {
  return (await prisma.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } })).id;
}

async function chainOk() {
  try { const st = await chain.status(); return st.connected && st.contracts.every((c: any) => c.deployed); } catch { return false; }
}

/** Registra un hito de trazabilidad en la blockchain (Parcela → … → Entrega) si aún no existe. */
export async function milestone(lotCode: string, stage: string, payload: unknown, actor: chain.Actor, shipmentId: number | null, userId: number) {
  const existing = await chain.readMilestones(lotCode);
  if (existing.some((m) => m.stage === stage)) return null;
  const docHash = hashObject(payload);
  const r = await chain.sendTx({ contract: "PaprikaTraceability", fn: "recordMilestone", args: [lotCode, stage, docHash], actor, entityType: "LOT", entityCode: lotCode, scenario: "AUTOMATIZACION", userId });
  if (r.ok) await T.event(prisma, shipmentId, "BLOCKCHAIN", `Hito ${stage} registrado on-chain (hash ${docHash.slice(0, 12)}…)`, "success", r.tx.txHash);
  else await T.event(prisma, shipmentId, "BLOCKCHAIN", `No se pudo registrar el hito ${stage}: ${r.errorMessage}`, "danger");
  return r;
}

/** Datos (sin datos personales) de cada etapa para su hash. */
export async function stagePayloads(lotCode: string) {
  const lot = await prisma.lot.findUniqueOrThrow({ where: { code: lotCode }, include: { parentLot: { include: { parentLot: { include: { harvest: true, campaign: { include: { parcel: true } } } }, productionOrder: true, labAnalyses: true } }, pallets: true } });
  const bulk = lot.parentLot;
  const raw = bulk?.parentLot;
  const parcel = raw?.campaign?.parcel;
  return {
    PARCELA: parcel ? { code: parcel.code, location: parcel.location, areaHa: parcel.areaHa.toString(), crop: parcel.cropType } : { note: "sin parcela" },
    COSECHA: raw?.harvest ? { code: raw.harvest.code, date: raw.harvest.date.toISOString().slice(0, 10), kg: raw.harvest.quantityKg.toString(), lot: raw.code } : { lot: raw?.code ?? null },
    PRODUCCION: bulk?.productionOrder ? { order: bulk.productionOrder.code, initialKg: bulk.productionOrder.initialWeightKg.toString(), finalKg: bulk.productionOrder.finalWeightKg?.toString(), yieldPct: bulk.productionOrder.yieldPct?.toString(), lot: bulk.code } : { lot: bulk?.code ?? null },
    CALIDAD: { coaHash: lot.certHash, analyses: bulk?.labAnalyses.filter((a) => a.result === "APROBADO").map((a) => a.code) ?? [] },
    ENVASADO: { lot: lot.code, netKg: lot.quantityKg.toString(), bestBy: lot.expiryDate?.toISOString().slice(0, 10) },
    PALETA: { pallets: lot.pallets.map((p) => ({ sscc: p.sscc, cases: p.cases, jars: p.jars, netKg: p.netKg.toString() })) },
  };
}

async function ensureLotOnChain(lotCode: string, shipmentId: number, userId: number) {
  const on = await chain.readLot(lotCode);
  if (!on.exists || (on as any).quality !== "APROBADO") {
    const r = await anchorLot(lotCode, userId, "AUTOMATIZACION");
    for (const x of r.results ?? []) if (x?.ok) await T.event(prisma, shipmentId, "BLOCKCHAIN", `PaprikaTraceability.${x.tx.functionName}(${lotCode}) confirmada en el bloque ${x.tx.blockNumber}`, "success", x.tx.txHash);
    if (!r.ok) throw new Error(r.message ?? "No se pudo registrar el lote en blockchain");
  }
  const p = await stagePayloads(lotCode);
  for (const [stage, actor] of [["PARCELA", "registrar"], ["COSECHA", "registrar"], ["PRODUCCION", "registrar"], ["CALIDAD", "quality"], ["ENVASADO", "registrar"], ["PALETA", "logistics"]] as const) {
    await milestone(lotCode, stage, (p as any)[stage], actor, shipmentId, userId);
  }
}

export async function sendAg(shipmentId: number, fn: string, args: unknown[], actor: chain.Actor, userId: number, label: string, value?: bigint) {
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId } });
  const r = await chain.sendTx({ contract: "PaprikaTradeAgreement", fn, args, actor, value, entityType: "AGREEMENT", entityCode: agreementCode(s.code), scenario: "AUTOMATIZACION", userId });
  if (r.ok) await T.event(prisma, shipmentId, "SMART_CONTRACT", `${label} — tx confirmada en el bloque ${r.tx.blockNumber}`, "success", r.tx.txHash);
  else await T.event(prisma, shipmentId, "SMART_CONTRACT", `${label} — RECHAZADA por el contrato: ${r.errorMessage}`, "danger");
  await syncAgreement(shipmentId);
  return r;
}

export async function syncAgreement(shipmentId: number) {
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { agreement: true } });
  if (!s.agreement) return null;
  const a: any = await chain.readAgreement(s.agreement.code).catch(() => ({ exists: false }));
  if (!a.exists) return s.agreement;
  const map: Record<string, any> = { PROPUESTO: "PROPUESTO", ACEPTADO: "ACEPTADO", FONDEADO: "FONDEADO", EJECUTADO: "EJECUTADO", CANCELADO: "CANCELADO", REEMBOLSADO: "REEMBOLSADO", EN_DISPUTA: "EN_DISPUTA" };
  return prisma.smartAgreement.update({ where: { id: s.agreement.id }, data: { status: map[a.state] ?? "BORRADOR", qualityState: a.quality, deliveryState: a.delivery, lastSyncedAt: new Date() } });
}

/** Crea el acuerdo PaprikaTradeAgreement del embarque y lo acepta con la billetera demo del importador. */
export async function createShipmentAgreement(shipmentId: number, userId: number) {
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { lot: true, agreement: true, customer: true } });
  if (!s.lot) throw new Error("El embarque aún no tiene lote reservado");
  await ensureLotOnChain(s.lot.code, s.id, userId);
  const code = agreementCode(s.code);
  let ag = s.agreement;
  if (!ag) {
    const penPerEth = await getSetting<number>("blockchain.penPerTestEth");
    const refPen = D(s.amountUsd).times(s.exchangeRate);
    const amountWei = chain.parseEth(refPen.div(penPerEth).toFixed(18));
    const deadline = new Date(Math.max(s.deliveryDate.getTime() + 30 * DAY, Date.now() + 45 * DAY));
    ag = await prisma.smartAgreement.create({ data: { code, lotId: s.lot.id, customerId: s.customerId, shipmentId: s.id, sellerAddress: chain.actorAddress("seller"), buyerAddress: chain.actorAddress("importer"), quantityKg: s.netKg, amountWei: amountWei.toString(), referencePen: refPen.toDecimalPlaces(2), deadline, status: "BORRADOR" } });
  }
  const on: any = await chain.readAgreement(code);
  if (!on.exists) {
    const r = await sendAg(s.id, "createAgreement", [code, s.lot.code, chain.actorAddress("importer"), BigInt(Math.round(Number(s.netKg))), BigInt(ag.amountWei), BigInt(D(ag.referencePen).times(100).toFixed(0)), BigInt(Math.floor(ag.deadline.getTime() / 1000))], "seller", userId, `1. Don Pimentón crea el acuerdo ${code} (${s.jars} frascos, ${s.incoterm})`);
    if (!r.ok) return r;
    const { deployment } = await chain.contract("PaprikaTradeAgreement");
    await prisma.smartAgreement.update({ where: { id: ag.id }, data: { contractAddress: deployment.address } });
  }
  const now: any = await chain.readAgreement(code);
  if (now.state === "PROPUESTO") return sendAg(s.id, "acceptAgreement", [code], "importer", userId, "2. El comprador acepta las condiciones (billetera demo del importador)");
  return { ok: true };
}

/** Aplica un pago real aprobado: registra la cobranza en el ERP y fondea el escrow espejo en la red local. */
export async function onPaymentApproved(paymentId: number) {
  const pay = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { shipment: true } });
  const userId = await systemUser();
  const amountUsd = pay.currency === "USD" ? D(pay.amount) : D(pay.amount).div(pay.shipment.exchangeRate);
  await inTx(async (tx) => {
    const s = await tx.exportShipment.update({ where: { id: pay.shipmentId }, data: { paidUsd: D(pay.shipment.paidUsd).plus(amountUsd).toDecimalPlaces(2) } });
    await tx.financialTransaction.create({ data: {
      code: await nextCode(tx, "FIN", new Date().getFullYear(), 5), type: "INGRESO", category: "COBRO_EXPORTACION", date: new Date(), description: `Cobro ${pay.code} (${pay.provider} · ${pay.method}) del embarque ${s.code}`,
      currency: pay.currency, amount: pay.amount, exchangeRate: pay.currency === "USD" ? s.exchangeRate : 1, amountPen: pay.currency === "USD" ? D(pay.amount).times(s.exchangeRate).toDecimalPlaces(2) : pay.amount,
      referenceType: "PAYMENT", referenceCode: pay.code, simulated: !pay.livemode, userId,
    } });
  });
  await T.event(prisma, pay.shipmentId, "PAGO", `Pago ${pay.code} aprobado: ${pay.currency} ${D(pay.amount).toFixed(2)} vía ${pay.provider} (${pay.livemode ? "pago REAL" : "modo prueba de la pasarela"})`, "success");
  await audit(prisma, userId, "PAGO_APROBADO", "pago", pay.id, { code: pay.code, provider: pay.provider, live: pay.livemode });
  tick().catch(() => {});
}

/** Avanza UN embarque tanto como permitan sus condiciones. Idempotente. */
export async function advance(shipmentId: number, opts: { force?: boolean } = {}) {
  const cfg = await autoSettings();
  const userId = await systemUser();
  let s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { agreement: true, lot: true, payments: true } });
  if (!s.autopilot && !opts.force) return s;
  const step = async (fn: () => Promise<unknown>, label: string) => {
    try { await fn(); } catch (e: any) {
      const msg = e?.message ?? String(e);
      const last = await prisma.automationEvent.findFirst({ where: { shipmentId, rule: "BLOQUEO" }, orderBy: { id: "desc" } });
      if (last?.message !== `${label}: ${msg}`) await T.event(prisma, shipmentId, "BLOQUEO", `${label}: ${msg}`, "warning");
      throw e;
    }
  };
  const reload = async () => (s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { agreement: true, lot: true, payments: true } }));
  try {
    if (s.status === "PEDIDO") { await step(() => inTx((tx) => T.validateQuality(tx, s.id, userId)), "Validación de calidad (R1)"); await reload(); }
    if (s.status === "CALIDAD_VALIDADA") { await step(() => inTx((tx) => T.reserveShipment(tx, s.id, userId)), "Reserva de stock"); await reload(); }
    if (s.status === "RESERVADO") { await step(() => inTx((tx) => T.confirmShipment(tx, s.id, userId)), "Confirmación del pedido (R7/R8)"); await reload(); }
    if (["CONFIRMADO", "DOCUMENTACION"].includes(s.status) && (await chainOk())) {
      if (!s.agreement || ["BORRADOR", "PROPUESTO"].includes(s.agreement.status)) { await step(() => createShipmentAgreement(s.id, userId), "Smart contract"); await reload(); }
      const on: any = await chain.readAgreement(agreementCode(s.code));
      // 3. depósito: con pago real aprobado o con fondos de prueba automatizados
      if (on.exists && on.state === "ACEPTADO") {
        const paid = D(s.paidUsd).gte(s.amountUsd);
        if (paid || cfg.autoTestFunds) await sendAg(s.id, "depositFunds", [agreementCode(s.code)], "importer", userId, `3. Depósito en custodia: ${on.amountEth} ETH de prueba ${paid ? "(espejo del pago real aprobado)" : "(fondos de prueba de la red local)"}`, BigInt(on.amountWei));
      }
      const on2: any = await chain.readAgreement(agreementCode(s.code));
      // 4-5. conformidad de calidad on-chain cuando el ERP tiene el lote aprobado
      if (on2.exists && on2.state === "FONDEADO" && on2.quality === "PENDIENTE" && s.lot) {
        const lot = await prisma.lot.findUniqueOrThrow({ where: { id: s.lot.id } });
        if (lot.qualityStatus === "APROBADO") await sendAg(s.id, "recordQuality", [agreementCode(s.code), true, lot.certHash ?? chain.ZERO32], "quality", userId, "4-5. Calidad aprobada en el ERP → servicio autorizado registra la conformidad on-chain");
        else if (lot.qualityStatus === "RECHAZADO") await sendAg(s.id, "recordQuality", [agreementCode(s.code), false, lot.certHash ?? chain.ZERO32], "quality", userId, "Calidad RECHAZADA registrada on-chain: el pago queda bloqueado");
      }
      // documentos (R2/R3) automáticos con los totales de las paletas
      if (s.docsStatus === "PENDIENTE") { await step(() => inTx((tx) => T.validateDocs(tx, s.id, {}, userId)), "Paquete documental"); await reload(); }
      // DAM y datos de embarque (los transmite el agente de aduana: aquí se registran los datos devueltos — demostración)
      if (s.docsStatus === "APROBADO" && !s.damNumber) {
        const now = new Date();
        await inTx((tx) => T.updateCustoms(tx, s.id, {
          damNumber: `118-${now.getFullYear()}-40-${String(s.id).padStart(6, "0")}`, damDate: now, channel: "VERDE", levanteDate: now, cargoCutoff: new Date(now.getTime() + 3 * DAY), isfSentAt: now,
          priorNoticeNo: `PN-DEMO-${String(s.id).padStart(6, "0")}`, blNumber: `DPEXP${now.getFullYear()}${String(s.id).padStart(5, "0")}`, manifest: `118-${now.getFullYear()}-${1000 + s.id}`,
          container: `DPMU${String(1000000 + s.id).slice(-7)}`, vessel: "MSC DEMO EXPRESS", shippingLine: "Naviera demo (ficticia)",
        }, userId));
        await T.event(prisma, s.id, "ADUANAS", "Datos ISF 10+2 enviados al importador y DAM numerada por el agente de aduana (demostración: el ERP no transmite a SUNAT/CBP)", "info");
        await reload();
      }
      const on3: any = await chain.readAgreement(agreementCode(s.code));
      if (s.damNumber && on3.state === "FONDEADO" && on3.quality === "APROBADA") {
        await step(() => inTx((tx) => T.dispatchShipment(tx, s.id, userId)), "Despacho");
        await reload();
        if (s.lot) await milestone(s.lot.code, "EMBARQUE", { bl: s.blNumber, dam: s.damNumber, vessel: s.vessel, container: s.container, ship: s.code }, "logistics", s.id, userId);
      }
    }
    // 6. viaje: el barco avanza en el mapa
    if (s.status === "EN_TRANSITO" && s.voyageStartedAt) {
      const progress = Math.min(1, (Date.now() - s.voyageStartedAt.getTime()) / (cfg.voyageSeconds * 1000));
      if (progress >= 1) {
        await prisma.exportShipment.update({ where: { id: s.id }, data: { voyageProgress: 1, status: "ARRIBADO", arrivedAt: new Date() } });
        await T.event(prisma, s.id, "VIAJE", `Arribo a ${s.destinationPort}. Prior Notice ${s.priorNoticeNo ?? "—"}; ingreso CBP gestionado por el broker del importador`, "success");
        await reload();
      } else await prisma.exportShipment.update({ where: { id: s.id }, data: { voyageProgress: progress } });
    }
    // 7. entrega registrada por logística (on-chain) y regularización de la DAM
    if (s.status === "ARRIBADO" && (await chainOk())) {
      const on: any = await chain.readAgreement(agreementCode(s.code));
      if (on.state === "FONDEADO" && on.delivery === "PENDIENTE") {
        const ev = sha256Bytes32(JSON.stringify({ ship: s.code, bl: s.blNumber, port: s.destinationPort, arrivedAt: s.arrivedAt }));
        const r = await sendAg(s.id, "recordDelivery", [agreementCode(s.code), ev], "logistics", userId, "6. Logística registra la entrega con el hash de la evidencia (B/L + arribo)");
        if (r.ok) {
          await prisma.exportShipment.update({ where: { id: s.id }, data: { status: "ENTREGADO", deliveredAt: new Date(), regularizedAt: s.regularizedAt ?? new Date() } });
          await prisma.complianceItem.updateMany({ where: { shipmentId: s.id, code: "REGULARIZACION" }, data: { status: "CUMPLIDO", evidence: "DAM regularizada (demostración)" } });
          if (s.lot) await milestone(s.lot.code, "ENTREGA", { ship: s.code, evidence: ev }, "logistics", s.id, userId);
          await reload();
        }
      }
    }
    // 8. confirmación del comprador (portal) — o automática con la billetera demo si está habilitado
    if (s.status === "ENTREGADO" && (await chainOk())) {
      const on: any = await chain.readAgreement(agreementCode(s.code));
      const due = s.deliveredAt && Date.now() - s.deliveredAt.getTime() >= cfg.buyerConfirmDelaySeconds * 1000;
      if (on.delivery === "ENTREGADA" && cfg.simulateBuyerConfirm && due) await confirmByBuyer(s.id, "automatización (billetera demo del importador)");
      await reload();
    }
    // 9-10. verificación de condiciones y liberación del pago
    if (s.agreement && (await chainOk())) {
      const on: any = await chain.readAgreement(agreementCode(s.code));
      if (on.exists && on.canRelease) {
        const r = await sendAg(s.id, "releasePayment", [agreementCode(s.code)], "seller", userId, "9. El contrato verificó TODAS las condiciones (fondos, calidad, entrega confirmada) y liberó el pago de prueba");
        if (r.ok) await closeShipment(s.id, r.tx.txHash ?? null, userId);
      }
      if (on.exists && on.state === "FONDEADO" && on.quality === "RECHAZADA") {
        await sendAg(s.id, "cancelAgreement", [agreementCode(s.code), "Calidad rechazada: reembolso automático"], "importer", userId, "Reembolso automático al comprador por calidad rechazada (los fondos no quedan bloqueados)");
      }
      if (on.exists && on.state === "FONDEADO" && new Date(on.deadline).getTime() < Date.now() && on.delivery !== "CONFIRMADA") {
        await sendAg(s.id, "cancelAgreement", [agreementCode(s.code), "Plazo vencido sin confirmación"], "importer", userId, "Plazo vencido sin confirmación de entrega: reembolso automático");
      }
    }
    // alertas de plazos aduaneros R4/R5 (una vez por umbral)
    if (s.damDate && !s.regularizedAt) {
      const light = T.customsLight(s, await T.params());
      for (const a of light.alerts) {
        const exists = await prisma.automationEvent.findFirst({ where: { shipmentId: s.id, message: a.message } });
        if (!exists) await T.event(prisma, s.id, "PLAZOS", a.message, a.level);
      }
    }
  } catch { /* el bloqueo ya quedó registrado como evento; se reintenta en el siguiente ciclo */ }
  return prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId } });
}

export async function confirmByBuyer(shipmentId: number, who: string) {
  const userId = await systemUser();
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId } });
  const r = await sendAg(s.id, "confirmReceipt", [agreementCode(s.code)], "importer", userId, `7. El comprador confirma la recepción (${who})`);
  if (r.ok) await prisma.exportShipment.update({ where: { id: s.id }, data: { confirmedAt: new Date() } });
  return r;
}

export async function closeShipment(shipmentId: number, txHash: string | null, userId: number) {
  const s = await prisma.exportShipment.findUniqueOrThrow({ where: { id: shipmentId }, include: { claims: true } });
  const otif = !!s.deliveredAt && s.deliveredAt.getTime() <= s.deliveryDate.getTime() + DAY && !s.claims.some((c) => c.type === "FALTANTE");
  await inTx(async (tx) => {
    const pending = D(s.amountUsd).minus(s.paidUsd);
    if (pending.gt(0)) {
      await tx.financialTransaction.create({ data: {
        code: await nextCode(tx, "FIN", new Date().getFullYear(), 5), type: "INGRESO", category: "COBRO_EXPORTACION", date: new Date(),
        description: `Liberación del escrow ${agreementCode(s.code)} (fondos de PRUEBA de red local; referencia US$ ${pending.toFixed(2)})`, currency: "USD", amount: pending.toDecimalPlaces(2),
        exchangeRate: s.exchangeRate, amountPen: pending.times(s.exchangeRate).toDecimalPlaces(2), referenceType: "SMART_CONTRACT", referenceCode: txHash ?? agreementCode(s.code), simulated: true, userId,
      } });
    }
    await tx.exportShipment.update({ where: { id: s.id }, data: { status: "CERRADO", otif, paidUsd: s.amountUsd } });
  });
  await T.event(prisma, s.id, "CIERRE", `10. Embarque cerrado. Cobranza conciliada, OTIF: ${otif ? "sí" : "no"}. El ERP registró el hash de la transacción.`, "success", txHash);
}

/** Ciclo del motor: recorre los embarques activos con piloto automático. */
export async function tick() {
  if (running) return;
  running = true;
  try {
    const cfg = await autoSettings();
    if (!cfg.enabled) return;
    const active = await prisma.exportShipment.findMany({ where: { autopilot: true, status: { in: ["PEDIDO", "CALIDAD_VALIDADA", "RESERVADO", "CONFIRMADO", "DOCUMENTACION", "DESPACHADO", "EN_TRANSITO", "ARRIBADO", "ENTREGADO"] } }, select: { id: true } });
    for (const a of active) await advance(a.id);
  } catch (e) { console.error("[automatización]", (e as Error).message); } finally { running = false; }
}

export async function startAutomation() {
  if (timer || process.env.NODE_ENV === "test") return;
  const cfg = await autoSettings().catch(() => ({ intervalMs: 4000 } as AutoSettings));
  timer = setInterval(() => { tick().catch(() => {}); }, cfg.intervalMs);
  console.log(`Motor de automatización del smart contract activo (cada ${cfg.intervalMs / 1000} s)`);
}
export const stopAutomation = () => { if (timer) clearInterval(timer); timer = null; };
