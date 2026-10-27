/**
 * Prueba integral obligatoria (sección 16) contra PostgreSQL y la red Hardhat
 * local REAL. Requiere "npm run chain" en /blockchain.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { login } from "./helpers";
import { prisma } from "../src/lib/prisma";
import { getProvider } from "../src/blockchain/chain";

let admin: Awaited<ReturnType<typeof login>>;

beforeAll(async () => {
  admin = await login("admin@donpimenton.pe");
  const r = await admin.post("/api/demo/reset").send({ confirm: "REINICIAR" });
  expect(r.status).toBe(200);
  expect(r.body.chainError).toBeNull();
});

describe("Escenario integral: venta de páprika DP-2026-001", () => {
  it("ejecuta los 18 pasos con transacciones confirmadas", async () => {
    for (let n = 1; n <= 18; n++) {
      const r = await admin.post(`/api/demo/step/${n}`);
      expect(r.body.status, `paso ${n}: ${r.body.summary}`).toBe("OK");
      for (const t of r.body.txs ?? []) expect(t.status).toBe("CONFIRMADA");
    }
  });

  it("los módulos quedaron coherentes", async () => {
    const lot = await prisma.lot.findUniqueOrThrow({ where: { code: "DP-2026-001" }, include: { balances: true, productionOrder: true } });
    expect(Number(lot.quantityKg)).toBe(200);
    expect(lot.bags).toBe(8);
    expect(Number(lot.productionOrder!.yieldPct)).toBe(20);
    expect(Number(lot.productionOrder!.wasteKg)).toBe(800);
    expect(lot.qualityStatus).toBe("APROBADO");
    expect(lot.chainStatus).toBe("REGISTRADO");
    expect(lot.balances.reduce((s, b) => s + Number(b.availableKg) + Number(b.reservedKg) + Number(b.quarantineKg), 0)).toBe(0);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { code: "PED-DEMO-2026-001" }, include: { receivables: true } });
    expect(Number(order.total)).toBe(3000);
    expect(order.status).toBe("COMPLETADO");
    expect(order.receivables[0].status).toBe("COBRADO");
    const exits = await prisma.inventoryMovement.count({ where: { lotId: lot.id, type: "SALIDA" } });
    expect(exits).toBe(1); // el despacho descontó el inventario una sola vez
  });

  it("la transacción de liberación existe en la red local", async () => {
    const tx = await prisma.blockchainTransaction.findFirstOrThrow({ where: { functionName: "releasePayment", entityCode: "SC-DP-2026-001", status: "CONFIRMADA" } });
    const receipt = await getProvider().getTransactionReceipt(tx.txHash!);
    expect(receipt?.status).toBe(1);
    const verify = await admin.get("/api/blockchain/lots/DP-2026-001/verify");
    expect(verify.body.dataMatches).toBe(true);
    expect(verify.body.certMatches).toBe(true);
  });

  it("detecta manipulación de datos del lote en el ERP", async () => {
    await prisma.lot.update({ where: { code: "DP-2026-001" }, data: { quantityKg: 250 } });
    const v = await admin.get("/api/blockchain/lots/DP-2026-001/verify");
    expect(v.body.dataMatches).toBe(false);
    await prisma.lot.update({ where: { code: "DP-2026-001" }, data: { quantityKg: 200 } });
  });

  it("genera el reporte de trazabilidad en PDF", async () => {
    const r = await admin.get("/api/reports/traceability/DP-2026-001.pdf").buffer(true).parse((res: any, cb: any) => { const chunks: Buffer[] = []; res.on("data", (c: Buffer) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("application/pdf");
    expect((r.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("re-ejecutar un paso no duplica registros", async () => {
    const before = await prisma.salesOrder.count();
    expect((await admin.post("/api/demo/step/10")).body.status).toBe("OK");
    expect(await prisma.salesOrder.count()).toBe(before);
  });
});

describe("Escenarios negativos", () => {
  it("lote rechazado: el ERP y el contrato bloquean el pago", async () => {
    const r = await admin.post("/api/demo/negative/rechazado");
    expect(r.body.status).toBe("COMPLETADA");
    expect(r.body.allBlocked).toBe(true);
    expect(r.body.onchain.state).toBe("REEMBOLSADO");
  });

  it("entrega no confirmada: el pago permanece pendiente", async () => {
    const r = await admin.post("/api/demo/negative/entrega-no-confirmada");
    expect(r.body.allBlocked).toBe(true);
    expect(r.body.onchain.state).toBe("FONDEADO");
  });

  it("usuario no autorizado: el contrato rechaza la transacción", async () => {
    const r = await admin.post("/api/demo/negative/no-autorizado");
    expect(r.body.allBlocked).toBe(true);
    const failed = await prisma.blockchainTransaction.count({ where: { scenario: "NEG_NO_AUTORIZADO", status: "FALLIDA" } });
    expect(failed).toBeGreaterThanOrEqual(6);
    expect(await prisma.blockchainTransaction.count({ where: { scenario: "NEG_NO_AUTORIZADO", status: "CONFIRMADA" } })).toBe(0);
  });

  it("el ERP no despacha un lote rechazado", async () => {
    const com = await login("comercial@donpimenton.pe");
    const lot = await prisma.lot.findUniqueOrThrow({ where: { code: "DP-2026-002" } });
    const customer = await prisma.customer.findFirstOrThrow({ where: { code: "CLI-0002" } });
    const r = await com.post("/api/sales/orders").send({ customerId: customer.id, items: [{ productId: lot.productId, lotId: lot.id, unit: "SACO", quantity: 1, unitPrice: 375 }] });
    expect(r.status).toBe(422);
  });
});

describe("Reinicio de la demostración", () => {
  it("restaura el estado inicial sin duplicar registros", async () => {
    const r = await admin.post("/api/demo/reset").send({ confirm: "REINICIAR" });
    expect(r.status).toBe(200);
    expect(await prisma.lot.count({ where: { code: { startsWith: "DP-2026-00" } } })).toBe(0);
    const customers = await prisma.customer.count();
    await admin.post("/api/demo/reset").send({ confirm: "REINICIAR" });
    expect(await prisma.customer.count()).toBe(customers);
    // la demostración se puede volver a ejecutar desde cero (identificadores on-chain limpios)
    for (let n = 1; n <= 8; n++) expect((await admin.post(`/api/demo/step/${n}`)).body.status).toBe("OK");
  });
});
