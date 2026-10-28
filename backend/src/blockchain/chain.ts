/**
 * Conexión REAL del ERP con la red Ethereum local (Hardhat, chainId 31337).
 * No hay simulación silenciosa: si la red no responde, las operaciones fallan
 * y el ERP lo informa. Las billeteras son las cuentas deterministas públicas de
 * Hardhat (custodia del ERP SOLO para la demostración local).
 */
import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { prisma } from "../lib/prisma";
import { config } from "../config";
import { AppError } from "../lib/errors";

export const ACTORS = {
  admin: { index: 0, label: "Administrador (despliegue)" },
  seller: { index: 1, label: "Don Pimentón — Comercial (vendedor)" },
  buyer: { index: 2, label: "Distribuidora Andina Demo (comprador ficticio)" },
  quality: { index: 3, label: "Responsable de calidad" },
  logistics: { index: 4, label: "Logística" },
  arbiter: { index: 5, label: "Gerencia (árbitro)" },
  intruder: { index: 6, label: "Actor NO autorizado (prueba negativa)" },
  registrar: { index: 7, label: "Producción (registro de lotes)" },
} as const;
export type Actor = keyof typeof ACTORS;
export type ContractName = "PaprikaTraceability" | "PaprikaTradeAgreement";

export const LOCAL_CHAIN_ID = 31337;

const ERROR_ES: Record<string, string> = {
  AccessControlUnauthorizedAccount: "La cuenta no tiene el rol requerido en el contrato (actor no autorizado)",
  LotAlreadyRegistered: "El lote ya está registrado en blockchain (duplicado)",
  LotNotFound: "El lote no existe en blockchain",
  InvalidHash: "Hash inválido",
  InvalidLotId: "Identificador de lote inválido",
  InvalidQualityStatus: "Estado de calidad inválido",
  AgreementExists: "El identificador del acuerdo ya fue utilizado",
  AgreementNotFound: "El acuerdo no existe en blockchain",
  LotAlreadyCommitted: "El lote ya está comprometido en otro acuerdo",
  InvalidParameters: "Parámetros inválidos",
  InvalidState: "El acuerdo no está en el estado requerido para esta operación",
  NotBuyer: "Solo el comprador puede ejecutar esta operación",
  NotParty: "Solo el comprador o el vendedor pueden ejecutar esta operación",
  WrongAmount: "El importe depositado no coincide con el acordado",
  QualityAlreadyRecorded: "La calidad ya fue registrada para este acuerdo",
  LotNotApprovedOnChain: "El lote no figura como APROBADO en el contrato de trazabilidad",
  QualityNotApproved: "Pago bloqueado: la calidad del lote no está aprobada",
  DeliveryNotRecorded: "La entrega aún no fue registrada por logística",
  DeliveryNotConfirmed: "Pago pendiente: el comprador no ha confirmado la recepción",
  CancellationNotAllowed: "Las reglas del contrato no permiten cancelar en este momento",
  TransferFailed: "Falló la transferencia de fondos de prueba",
  ReentrancyGuardReentrantCall: "Llamada reentrante bloqueada",
};

let provider: ethers.JsonRpcProvider | null = null;
export function getProvider() {
  if (!provider) provider = new ethers.JsonRpcProvider(config.chainRpcUrl, undefined, { staticNetwork: false, cacheTimeout: -1 });
  return provider;
}

const wallets = new Map<Actor, ethers.HDNodeWallet>();
export function signer(actor: Actor) {
  if (!wallets.has(actor)) {
    const w = ethers.HDNodeWallet.fromPhrase(config.chainMnemonic, undefined, `m/44'/60'/0'/0/${ACTORS[actor].index}`);
    wallets.set(actor, w.connect(getProvider()));
  }
  return wallets.get(actor)!;
}
export const actorAddress = (a: Actor) => signer(a).address;

function artifact(name: ContractName) {
  const file = path.join(config.artifactsDir, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) throw new AppError(503, `No se encontró el artefacto compilado ${name}. Ejecute "npm run compile" en /blockchain.`, "CHAIN_ARTIFACT");
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  return { abi: a.abi as ethers.InterfaceAbi, bytecode: a.bytecode as string };
}

const ifaces = new Map<ContractName, ethers.Interface>();
export function iface(name: ContractName) {
  if (!ifaces.has(name)) ifaces.set(name, new ethers.Interface(artifact(name).abi));
  return ifaces.get(name)!;
}

async function assertLocalChain() {
  let net: ethers.Network;
  try {
    net = await getProvider().getNetwork();
  } catch {
    throw new AppError(503, `La red blockchain local no responde en ${config.chainRpcUrl}. Inicie "npm run chain" (Hardhat).`, "CHAIN_DOWN");
  }
  if (Number(net.chainId) !== LOCAL_CHAIN_ID) throw new AppError(503, `Red no permitida (chainId ${net.chainId}). Solo se admite la red local ${LOCAL_CHAIN_ID}.`, "CHAIN_WRONG");
}

export async function getDeployment(name: ContractName) {
  let d = await prisma.chainDeployment.findFirst({ where: { contractName: name, active: true }, orderBy: { id: "desc" } });
  if (!d && fs.existsSync(config.deploymentFile)) {
    // importa el despliegue realizado con "npm run deploy" (Hardhat)
    const f = JSON.parse(fs.readFileSync(config.deploymentFile, "utf8"));
    if (f.contracts?.[name]) {
      d = await prisma.chainDeployment.create({ data: { contractName: name, address: f.contracts[name].address, chainId: f.chainId, deployBlock: f.deployBlock ?? 0 } });
    }
  }
  return d;
}

export async function contract(name: ContractName, actor: Actor = "admin") {
  await assertLocalChain();
  const d = await getDeployment(name);
  if (!d) throw new AppError(503, `El contrato ${name} no está desplegado. Use "Desplegar contratos" en el panel blockchain.`, "CHAIN_NOT_DEPLOYED");
  const code = await getProvider().getCode(d.address);
  if (code === "0x") throw new AppError(503, `No hay código en ${d.address}: la red local fue reiniciada. Vuelva a desplegar los contratos.`, "CHAIN_NOT_DEPLOYED");
  return { c: new ethers.Contract(d.address, artifact(name).abi, signer(actor)), deployment: d };
}

// --- Serialización de envíos (evita colisiones de nonce entre peticiones concurrentes)
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function decodeError(e: any, name?: ContractName): { errorName: string; errorMessage: string } {
  let errorName = e?.revert?.name as string | undefined;
  let args: any[] | undefined = e?.revert?.args ? [...e.revert.args] : undefined;
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  if (!errorName && data && typeof data === "string") {
    for (const n of (name ? [name] : ["PaprikaTraceability", "PaprikaTradeAgreement"]) as ContractName[]) {
      try {
        const p = iface(n).parseError(data);
        if (p) { errorName = p.name; args = [...p.args]; break; }
      } catch { /* sigue */ }
    }
  }
  if (errorName) {
    const extra = args?.length ? ` [${args.map((a) => String(a)).join(", ")}]` : "";
    return { errorName, errorMessage: (ERROR_ES[errorName] || errorName) + extra };
  }
  if (e?.code === "ECONNREFUSED" || /ECONNREFUSED|could not detect network/i.test(String(e?.message))) {
    return { errorName: "CHAIN_DOWN", errorMessage: "La red blockchain local no responde" };
  }
  return { errorName: e?.code || "ERROR", errorMessage: e?.shortMessage || e?.message || "Error desconocido" };
}

export interface SendOptions {
  contract: ContractName;
  fn: string;
  args: unknown[];
  actor: Actor;
  value?: bigint;
  entityType?: string;
  entityCode?: string;
  scenario?: string;
  userId?: number;
}

const jsonSafe = (v: unknown): any => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/**
 * Envía una transacción real y espera su confirmación. Registra SIEMPRE el
 * resultado en BlockchainTransaction: CONFIRMADA (minada con status 1) o
 * FALLIDA (rechazada por el contrato al estimar gas, o minada y revertida).
 */
export async function sendTx(o: SendOptions) {
  const { c, deployment } = await contract(o.contract, o.actor);
  return serial(async () => {
    const rec = await prisma.blockchainTransaction.create({
      data: {
        contractName: o.contract, contractAddress: deployment.address, functionName: o.fn, args: jsonSafe(o.args),
        actor: o.actor, fromAddress: actorAddress(o.actor), valueWei: (o.value ?? 0n).toString(), status: "PENDIENTE",
        entityType: o.entityType, entityCode: o.entityCode, scenario: o.scenario, userId: o.userId,
      },
    });
    let tx: ethers.ContractTransactionResponse;
    try {
      tx = await c[o.fn](...o.args, ...(o.value ? [{ value: o.value }] : []));
    } catch (e) {
      const err = decodeError(e, o.contract);
      const failed = await prisma.blockchainTransaction.update({ where: { id: rec.id }, data: { status: "FALLIDA", ...err, minedRevert: false } });
      return { ok: false as const, tx: failed, ...err };
    }
    await prisma.blockchainTransaction.update({ where: { id: rec.id }, data: { txHash: tx.hash } });
    let receipt: ethers.TransactionReceipt | null = null;
    try {
      receipt = await tx.wait(1);
    } catch (e) {
      const err = decodeError(e, o.contract);
      const failed = await prisma.blockchainTransaction.update({ where: { id: rec.id }, data: { status: "FALLIDA", ...err, minedRevert: true, blockNumber: (e as any)?.receipt?.blockNumber ?? null } });
      return { ok: false as const, tx: failed, ...err };
    }
    if (!receipt || receipt.status !== 1) {
      const failed = await prisma.blockchainTransaction.update({ where: { id: rec.id }, data: { status: "FALLIDA", errorName: "REVERTED", errorMessage: "Transacción revertida", minedRevert: true, blockNumber: receipt?.blockNumber } });
      return { ok: false as const, tx: failed, errorName: "REVERTED", errorMessage: "Transacción revertida" };
    }
    const confirmed = await prisma.blockchainTransaction.update({
      where: { id: rec.id },
      data: { status: "CONFIRMADA", blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), confirmedAt: new Date() },
    });
    const events = await storeReceiptEvents(receipt, o.contract, deployment.address, rec.id);
    return { ok: true as const, tx: confirmed, receipt, events };
  });
}

async function storeReceiptEvents(receipt: ethers.TransactionReceipt, name: ContractName, address: string, txId: number) {
  const out: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    let parsed: ethers.LogDescription | null = null;
    try { parsed = iface(name).parseLog(log); } catch { parsed = null; }
    if (!parsed) continue;
    const args: Record<string, unknown> = {};
    parsed.fragment.inputs.forEach((inp, i) => { args[inp.name] = parsed!.args[i]; });
    const safe = jsonSafe(args);
    await prisma.blockchainEvent.upsert({
      where: { txHash_logIndex: { txHash: receipt.hash, logIndex: log.index } },
      create: { txHash: receipt.hash, logIndex: log.index, blockNumber: receipt.blockNumber, contractName: name, contractAddress: address, eventName: parsed.name, args: safe, transactionId: txId },
      update: { transactionId: txId },
    });
    out.push({ eventName: parsed.name, args: safe });
  }
  return out;
}

/** Re-sincroniza todos los eventos emitidos por los contratos activos (idempotente). */
export async function syncEvents() {
  let total = 0;
  for (const name of ["PaprikaTraceability", "PaprikaTradeAgreement"] as ContractName[]) {
    const { c, deployment } = await contract(name);
    const logs = await c.queryFilter("*", deployment.deployBlock);
    for (const log of logs) {
      const ev = log as ethers.EventLog;
      if (!ev.eventName) continue;
      const args: Record<string, unknown> = {};
      ev.fragment.inputs.forEach((inp, i) => { args[inp.name] = ev.args[i]; });
      const txRec = await prisma.blockchainTransaction.findUnique({ where: { txHash: ev.transactionHash } });
      await prisma.blockchainEvent.upsert({
        where: { txHash_logIndex: { txHash: ev.transactionHash, logIndex: ev.index } },
        create: { txHash: ev.transactionHash, logIndex: ev.index, blockNumber: ev.blockNumber, contractName: name, contractAddress: deployment.address, eventName: ev.eventName, args: jsonSafe(args), transactionId: txRec?.id },
        update: {},
      });
      total++;
    }
  }
  return total;
}

/** Despliega ambos contratos en la red local y asigna los roles a las cuentas demo. */
/**
 * Si la red local se reinició (los contratos activos ya no tienen código), el
 * historial guardado pertenece a una cadena que ya no existe. Una red Hardhat
 * nueva reproduce los mismos hashes, así que se archiva ese historial para no
 * confundirlo con el nuevo y se marcan los lotes como no registrados.
 */
async function archiveLostChain() {
  const active = await prisma.chainDeployment.findMany({ where: { active: true } });
  if (!active.length) return false;
  const codes = await Promise.all(active.map((d) => getProvider().getCode(d.address)));
  if (codes.some((c) => c !== "0x")) return false;
  const tag = ` (red reiniciada ${new Date().toISOString().slice(0, 19)})`;
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "BlockchainTransaction" SET "txHash" = "txHash" || ${tag} WHERE "txHash" IS NOT NULL AND "txHash" NOT LIKE '%(red reiniciada%'`,
    prisma.$executeRaw`UPDATE "BlockchainEvent" SET "txHash" = "txHash" || ${tag} WHERE "txHash" NOT LIKE '%(red reiniciada%'`,
    prisma.lot.updateMany({ where: { chainStatus: { not: "NO_REGISTRADO" } }, data: { chainStatus: "NO_REGISTRADO", chainTxHash: null } }),
    prisma.smartAgreement.updateMany({ where: { status: { in: ["BORRADOR", "PROPUESTO", "ACEPTADO", "FONDEADO", "EN_DISPUTA"] } }, data: { status: "CANCELADO" } }),
    prisma.auditLog.create({ data: { action: "RED_BLOCKCHAIN_REINICIADA", entity: "blockchain", details: { contratos: active.map((d) => d.address) } } }),
  ]);
  return true;
}

export async function deployContracts(userId?: number) {
  await assertLocalChain();
  return serial(async () => {
    if (await archiveLostChain()) console.log("Red local reiniciada: historial anterior archivado");
    const admin = signer("admin");
    const deployOne = async (name: ContractName, args: unknown[]) => {
      const a = artifact(name);
      const f = new ethers.ContractFactory(a.abi, a.bytecode, admin);
      const c = await f.deploy(...args);
      const r = await c.deploymentTransaction()!.wait(1);
      return { c: c as ethers.Contract, address: await c.getAddress(), block: r!.blockNumber, hash: r!.hash };
    };
    const trace = await deployOne("PaprikaTraceability", [admin.address]);
    const trade = await deployOne("PaprikaTradeAgreement", [admin.address, trace.address]);
    const grants: [ethers.Contract, string, Actor][] = [
      [trace.c, "REGISTRAR_ROLE", "registrar"], [trace.c, "QUALITY_ROLE", "quality"],
      [trade.c, "SELLER_ROLE", "seller"], [trade.c, "QUALITY_ROLE", "quality"],
      [trade.c, "LOGISTICS_ROLE", "logistics"], [trade.c, "ARBITER_ROLE", "arbiter"],
    ];
    for (const [c, role, actor] of grants) await (await c.grantRole(await c[role](), actorAddress(actor))).wait(1);

    await prisma.chainDeployment.updateMany({ where: { active: true }, data: { active: false } });
    const chainId = LOCAL_CHAIN_ID;
    await prisma.chainDeployment.createMany({
      data: [
        { contractName: "PaprikaTraceability", address: trace.address, chainId, deployBlock: trace.block, deployTxHash: trace.hash },
        { contractName: "PaprikaTradeAgreement", address: trade.address, chainId, deployBlock: trade.block, deployTxHash: trade.hash },
      ],
    });
    for (const d of [{ n: "PaprikaTraceability", x: trace }, { n: "PaprikaTradeAgreement", x: trade }]) {
      await prisma.blockchainTransaction.create({
        data: { txHash: d.x.hash, contractName: d.n, contractAddress: d.x.address, functionName: "constructor (despliegue)", args: [], actor: "admin", fromAddress: admin.address, status: "CONFIRMADA", blockNumber: d.x.block, confirmedAt: new Date(), userId },
      });
    }
    return { PaprikaTraceability: trace.address, PaprikaTradeAgreement: trade.address };
  });
}

export async function status() {
  const out: any = { rpcUrl: config.chainRpcUrl, connected: false, chainId: null, blockNumber: null, contracts: [] as any[], actors: [] as any[] };
  try {
    const net = await getProvider().getNetwork();
    out.chainId = Number(net.chainId);
    out.blockNumber = await getProvider().getBlockNumber();
    out.connected = out.chainId === LOCAL_CHAIN_ID;
  } catch (e) {
    out.error = "La red blockchain local no responde. Inicie Hardhat con \"npm run chain\".";
    return out;
  }
  for (const name of ["PaprikaTraceability", "PaprikaTradeAgreement"] as ContractName[]) {
    const d = await getDeployment(name);
    const code = d ? await getProvider().getCode(d.address) : "0x";
    out.contracts.push({ name, address: d?.address ?? null, deployBlock: d?.deployBlock ?? null, deployed: code !== "0x" });
  }
  for (const [k, v] of Object.entries(ACTORS)) {
    const addr = actorAddress(k as Actor);
    out.actors.push({ actor: k, label: v.label, address: addr, balanceEth: ethers.formatEther(await getProvider().getBalance(addr)) });
  }
  return out;
}

export const AGREEMENT_STATES = ["NONE", "PROPUESTO", "ACEPTADO", "FONDEADO", "EJECUTADO", "CANCELADO", "REEMBOLSADO", "EN_DISPUTA"] as const;
export const AGREEMENT_QUALITY = ["PENDIENTE", "APROBADA", "RECHAZADA"] as const;
export const AGREEMENT_DELIVERY = ["PENDIENTE", "ENTREGADA", "CONFIRMADA"] as const;
export const LOT_QUALITY = ["PENDIENTE", "APROBADO", "RECHAZADO", "CUARENTENA"] as const;

export async function readAgreement(code: string) {
  const { c } = await contract("PaprikaTradeAgreement");
  try {
    const a = await c.getAgreement(code);
    const [canRelease, reason] = await c.canRelease(code);
    const bal = await getProvider().getBalance(await c.getAddress());
    return {
      exists: true, agreementId: a.agreementId, lotId: a.lotId, seller: a.seller, buyer: a.buyer,
      quantityKg: Number(a.quantityKg), amountWei: a.amountWei.toString(), amountEth: ethers.formatEther(a.amountWei),
      referencePen: Number(a.referencePenCents) / 100, deadline: new Date(Number(a.deadline) * 1000).toISOString(),
      state: AGREEMENT_STATES[Number(a.state)], quality: AGREEMENT_QUALITY[Number(a.quality)], delivery: AGREEMENT_DELIVERY[Number(a.delivery)],
      depositedEth: ethers.formatEther(a.deposited), qualityCertHash: a.qualityCertHash, deliveryEvidenceHash: a.deliveryEvidenceHash,
      canRelease, canReleaseReason: reason, contractBalanceEth: ethers.formatEther(bal),
    };
  } catch (e) {
    const err = decodeError(e, "PaprikaTradeAgreement");
    if (err.errorName === "AgreementNotFound") return { exists: false };
    throw new AppError(502, err.errorMessage, "CHAIN_READ");
  }
}

export async function readLot(code: string) {
  const { c } = await contract("PaprikaTraceability");
  const exists = await c.exists(code);
  if (!exists) return { exists: false };
  const l = await c.getLot(code);
  return {
    exists: true, lotId: l.lotId, lotDataHash: l.lotDataHash, qualityCertHash: l.qualityCertHash,
    quality: LOT_QUALITY[Number(l.quality)], registeredBy: l.registeredBy, qualityBy: l.qualityBy,
    registeredAt: new Date(Number(l.registeredAt) * 1000).toISOString(), updatedAt: new Date(Number(l.updatedAt) * 1000).toISOString(),
    version: Number(l.version),
  };
}

export const ZERO32 = ethers.ZeroHash;
export const parseEth = (v: string) => ethers.parseEther(v);
export const formatEth = (v: bigint) => ethers.formatEther(v);
