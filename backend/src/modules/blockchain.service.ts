import { AgreementStatus } from "@prisma/client";
import { prisma, inTx } from "../lib/prisma";
import { hashObject, sha256Bytes32 } from "../lib/hash";
import { notFound, unprocessable, AppError } from "../lib/errors";
import { audit } from "../lib/audit";
import { getSetting } from "../lib/settings";
import { D } from "../lib/decimal";
import * as chain from "../blockchain/chain";
import { collectReceivable } from "./sales";

/** Datos del lote que se resumen en el hash on-chain (sin datos personales ni comerciales sensibles). */
export async function lotHashPayload(lotId: number) {
  const l = await prisma.lot.findUniqueOrThrow({
    where: { id: lotId },
    include: { product: true, parentLot: { include: { harvest: true } }, campaign: true, productionOrder: true },
  });
  return {
    lot: l.code, type: l.type, product: l.product.code, quantityKg: D(l.quantityKg).toFixed(3), bags: l.bags,
    productionDate: l.productionDate.toISOString().slice(0, 10), expiryDate: l.expiryDate?.toISOString().slice(0, 10) ?? null,
    campaign: l.campaign?.code ?? null, sourceLot: l.parentLot?.code ?? null, harvest: l.parentLot?.harvest?.code ?? null,
    productionOrder: l.productionOrder ? {
      code: l.productionOrder.code, initialKg: D(l.productionOrder.initialWeightKg).toFixed(3), finalKg: l.productionOrder.finalWeightKg ? D(l.productionOrder.finalWeightKg).toFixed(3) : null,
      yieldPct: l.productionOrder.yieldPct?.toString() ?? null, dryingTempC: l.productionOrder.dryingTempC?.toString() ?? null, dryingHours: l.productionOrder.dryingHours?.toString() ?? null,
    } : null,
  };
}

const QUALITY_ENUM: Record<string, number> = { APROBADO: 1, RECHAZADO: 2, CUARENTENA: 3 };

/** Registra el lote (hash de datos) y, si existe decisión, su calidad (hash del COA) en PaprikaTraceability. */
export async function anchorLot(code: string, userId: number, scenario?: string) {
  const lot = await prisma.lot.findUnique({ where: { code } });
  if (!lot) throw notFound(`Lote ${code} no encontrado`);
  if (lot.type !== "PRODUCTO_TERMINADO") throw unprocessable("Se registran en blockchain los lotes de producto terminado");
  const results: any[] = [];
  const onchain = await chain.readLot(code);
  const dataHash = hashObject(await lotHashPayload(lot.id));
  if (!onchain.exists) {
    await prisma.lot.update({ where: { id: lot.id }, data: { chainStatus: "PENDIENTE", dataHash } });
    const r = await chain.sendTx({ contract: "PaprikaTraceability", fn: "registerLot", args: [code, dataHash], actor: "registrar", entityType: "LOT", entityCode: code, scenario, userId });
    results.push(r);
    await prisma.lot.update({ where: { id: lot.id }, data: { chainStatus: r.ok ? "REGISTRADO" : "FALLIDO", chainTxHash: r.ok ? r.tx.txHash : lot.chainTxHash } });
    if (!r.ok) return { ok: false, results, message: r.errorMessage };
  }
  const status = QUALITY_ENUM[lot.qualityStatus];
  const after = await chain.readLot(code);
  if (status && lot.certHash && (after as any).quality !== lot.qualityStatus) {
    const r = await chain.sendTx({ contract: "PaprikaTraceability", fn: "recordQuality", args: [code, status, lot.certHash], actor: "quality", entityType: "LOT", entityCode: code, scenario, userId });
    results.push(r);
    if (!r.ok) return { ok: false, results, message: r.errorMessage };
  }
  await audit(prisma, userId, "ANCLAR_BLOCKCHAIN", "lote", lot.id, { code, dataHash });
  return { ok: true, results, dataHash, onchain: await chain.readLot(code) };
}

/** Recalcula los hashes desde la BD y los compara con lo registrado en la cadena. */
export async function verifyLot(code: string) {
  const lot = await prisma.lot.findUnique({ where: { code } });
  if (!lot) throw notFound(`Lote ${code} no encontrado`);
  const onchain = await chain.readLot(code);
  const recomputed = hashObject(await lotHashPayload(lot.id));
  if (!onchain.exists) return { code, registered: false, recomputedDataHash: recomputed, message: "El lote no está registrado en la blockchain local" };
  const o = onchain as any;
  const dataMatches = o.lotDataHash === recomputed;
  const certMatches = !!lot.certHash && o.qualityCertHash === lot.certHash;
  return {
    code, registered: true, onchain, recomputedDataHash: recomputed, erpCertHash: lot.certHash, dataMatches, certMatches,
    qualityMatches: o.quality === (lot.qualityStatus === "EN_EVALUACION" ? "PENDIENTE" : lot.qualityStatus),
    verdict: dataMatches && certMatches ? "ÍNTEGRO: los datos del ERP coinciden con el registro en blockchain" : dataMatches ? "Datos íntegros; el certificado difiere o no fue registrado" : "ALERTA: los datos del lote en el ERP NO coinciden con el hash registrado",
  };
}

const STATE_MAP: Record<string, AgreementStatus> = {
  PROPUESTO: "PROPUESTO", ACEPTADO: "ACEPTADO", FONDEADO: "FONDEADO", EJECUTADO: "EJECUTADO", CANCELADO: "CANCELADO", REEMBOLSADO: "REEMBOLSADO", EN_DISPUTA: "EN_DISPUTA",
};

export async function refreshAgreement(code: string) {
  const a = await chain.readAgreement(code);
  if (!a.exists) return prisma.smartAgreement.findUnique({ where: { code } });
  const x = a as any;
  return prisma.smartAgreement.update({ where: { code }, data: { status: STATE_MAP[x.state] ?? "BORRADOR", qualityState: x.quality, deliveryState: x.delivery, lastSyncedAt: new Date() } });
}

/** Crea el acuerdo comercial inteligente a partir de un pedido reservado (un lote por acuerdo). */
export async function createAgreementFromOrder(salesOrderId: number, userId: number, opts: { deadlineDays?: number; code?: string; scenario?: string } = {}) {
  const o = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, include: { customer: true, agreements: true, items: { include: { reservations: { include: { lot: true } } } } } });
  if (!o) throw notFound("Pedido no encontrado");
  const active = o.agreements.find((a) => !["CANCELADO", "REEMBOLSADO"].includes(a.status));
  if (active) return { ok: true, agreement: active, reused: true };
  const lots = [...new Set(o.items.flatMap((i) => i.reservations.map((r) => r.lot.code)))];
  if (lots.length !== 1) throw unprocessable("El acuerdo inteligente de demostración requiere que el pedido provenga de un único lote");
  const lot = o.items[0].reservations[0].lot;
  if (o.customer.chainActor !== "buyer") throw unprocessable("El cliente no tiene una identidad blockchain de demostración asignada");
  const penPerEth = await getSetting<number>("blockchain.penPerTestEth");
  const totalPen = D(o.total).times(o.exchangeRate);
  const amountWei = chain.parseEth(totalPen.div(penPerEth).toFixed(18));
  const deadline = new Date(Date.now() + (opts.deadlineDays ?? 30) * 86400000);
  const code = opts.code ?? `SC-${o.code}`;
  const existing = await prisma.smartAgreement.findUnique({ where: { code } });
  if (existing && existing.status !== "BORRADOR") throw unprocessable(`El identificador ${code} ya fue utilizado`);
  const ag = existing ?? await prisma.smartAgreement.create({
    data: { code, lotId: lot.id, customerId: o.customerId, salesOrderId: o.id, sellerAddress: chain.actorAddress("seller"), buyerAddress: chain.actorAddress("buyer"), quantityKg: o.totalKg, amountWei: amountWei.toString(), referencePen: totalPen.toDecimalPlaces(2), deadline, status: "BORRADOR" },
  });
  const r = await chain.sendTx({
    contract: "PaprikaTradeAgreement", fn: "createAgreement",
    args: [code, lot.code, chain.actorAddress("buyer"), BigInt(Math.round(Number(o.totalKg))), amountWei, BigInt(totalPen.times(100).toFixed(0)), BigInt(Math.floor(deadline.getTime() / 1000))],
    actor: "seller", entityType: "AGREEMENT", entityCode: code, scenario: opts.scenario, userId,
  });
  if (r.ok) {
    const { deployment } = await chain.contract("PaprikaTradeAgreement");
    await prisma.smartAgreement.update({ where: { id: ag.id }, data: { contractAddress: deployment.address } });
  }
  await audit(prisma, userId, "CREAR_ACUERDO_BLOCKCHAIN", "acuerdo", ag.id, { code, ok: r.ok });
  return { ok: r.ok, result: r, agreement: await refreshAgreement(code) };
}

type Action = "accept" | "deposit" | "quality" | "delivery" | "confirm" | "release" | "cancel" | "dispute" | "resolve";

/** Ejecuta una acción del flujo del acuerdo con la billetera del actor correspondiente. */
export async function agreementAction(code: string, action: Action, userId: number, params: { approved?: boolean; reason?: string; releaseToSeller?: boolean; actorOverride?: chain.Actor; scenario?: string } = {}) {
  const ag = await prisma.smartAgreement.findUnique({ where: { code }, include: { lot: true, salesOrder: { include: { dispatches: { include: { evidenceDoc: true } }, receivables: true } } } });
  if (!ag) throw notFound("Acuerdo no encontrado");
  const base = { contract: "PaprikaTradeAgreement" as const, entityType: "AGREEMENT", entityCode: code, userId, scenario: params.scenario };
  let r: Awaited<ReturnType<typeof chain.sendTx>>;
  const dispatch = ag.salesOrder?.dispatches[0];
  switch (action) {
    case "accept": r = await chain.sendTx({ ...base, fn: "acceptAgreement", args: [code], actor: params.actorOverride ?? "buyer" }); break;
    case "deposit": r = await chain.sendTx({ ...base, fn: "depositFunds", args: [code], actor: params.actorOverride ?? "buyer", value: BigInt(ag.amountWei) }); break;
    case "quality": {
      const approved = params.approved ?? ag.lot.qualityStatus === "APROBADO";
      r = await chain.sendTx({ ...base, fn: "recordQuality", args: [code, approved, ag.lot.certHash ?? chain.ZERO32], actor: params.actorOverride ?? "quality" });
      break;
    }
    case "delivery": {
      if (!params.actorOverride && (!dispatch || !["ENTREGADO", "CONFORME"].includes(dispatch.status))) throw unprocessable("Logística aún no registró la entrega del despacho en el ERP");
      const evidence = dispatch?.evidenceDoc ? "0x" + dispatch.evidenceDoc.sha256 : sha256Bytes32(JSON.stringify({ dispatch: dispatch?.code, deliveredAt: dispatch?.deliveredAt, receivedBy: dispatch?.receivedBy }));
      r = await chain.sendTx({ ...base, fn: "recordDelivery", args: [code, evidence], actor: params.actorOverride ?? "logistics" });
      break;
    }
    case "confirm": r = await chain.sendTx({ ...base, fn: "confirmReceipt", args: [code], actor: params.actorOverride ?? "buyer" }); break;
    case "release": r = await chain.sendTx({ ...base, fn: "releasePayment", args: [code], actor: params.actorOverride ?? "seller" }); break;
    case "cancel": r = await chain.sendTx({ ...base, fn: "cancelAgreement", args: [code, params.reason ?? "Cancelación"], actor: params.actorOverride ?? "buyer" }); break;
    case "dispute": r = await chain.sendTx({ ...base, fn: "openDispute", args: [code, sha256Bytes32(params.reason ?? "disputa")], actor: params.actorOverride ?? "buyer" }); break;
    case "resolve": r = await chain.sendTx({ ...base, fn: "resolveDispute", args: [code, !!params.releaseToSeller], actor: params.actorOverride ?? "arbiter" }); break;
    default: throw new AppError(400, "Acción desconocida");
  }
  const updated = await refreshAgreement(code);
  // Sincronización contable: solo DESPUÉS de la confirmación on-chain de la liberación
  if (r.ok && (action === "release" || (action === "resolve" && params.releaseToSeller)) && ag.salesOrder) {
    const ar = ag.salesOrder.receivables[0];
    if (ar && D(ar.amount).gt(ar.collected)) {
      await inTx((tx) => collectReceivable(tx, ar.id, { amount: D(ar.amount).minus(ar.collected).toNumber(), method: "Smart Contract (red local)", reference: r.tx.txHash ?? undefined, simulated: true }, userId));
    }
  }
  await audit(prisma, userId, `ACUERDO_${action.toUpperCase()}`, "acuerdo", ag.id, { code, ok: r.ok, error: r.ok ? undefined : r.errorMessage });
  return { ok: r.ok, tx: r.tx, errorName: r.ok ? undefined : r.errorName, errorMessage: r.ok ? undefined : r.errorMessage, events: r.ok ? r.events : [], agreement: updated };
}
