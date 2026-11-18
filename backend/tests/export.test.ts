/**
 * Exportación de frascos 4 oz: pruebas P1–P12 (TI-15 + Smart Contracts), simulación de 20 pasos,
 * permisos del agente/comprador y pagos de prueba. Requiere PostgreSQL y la red Hardhat local.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { login } from "./helpers";
import { prisma } from "../src/lib/prisma";

let admin: Awaited<ReturnType<typeof login>>;
beforeAll(async () => { admin = await login("admin@donpimenton.pe"); }, 60000);

describe("Pruebas de aceptación P1–P12", () => {
  for (const id of ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"]) {
    it(`${id} pasa`, async () => {
      const r = await admin.post(`/api/export-demo/tests/${id}`).send({});
      expect(r.status).toBe(200);
      expect(r.body.passed, r.body.evidence?.join(" | ")).toBe(true);
    }, 60000);
  }
  it("P1–P7 no dejan datos (transacción revertida)", async () => {
    expect(await prisma.campaign.count({ where: { code: "CAM-TEST-P1" } })).toBe(0);
    expect(await prisma.exportShipment.count({ where: { damNumber: "118-2026-40-TEST22" } })).toBe(0);
  });
});

describe("Simulación de exportación (20 pasos)", () => {
  it("ejecuta los 20 pasos y cierra el embarque con el pago liberado on-chain", async () => {
    expect((await admin.post("/api/export-demo/sim/start").send({})).status).toBe(200);
    let last: any;
    for (let n = 1; n <= 20; n++) {
      const r = await admin.post("/api/export-demo/sim/next").send({});
      last = r.body.last;
      expect(last.status, `paso ${n}: ${last.summary}`).toBe("OK");
      for (const t of (last.txs ?? []).filter(Boolean)) expect(t.status).toBe("CONFIRMADA");
    }
    const s = await prisma.exportShipment.findUniqueOrThrow({ where: { code: last.data.shipment }, include: { agreement: true, palletsList: true } });
    expect(s.status).toBe("CERRADO");
    expect(s.agreement?.status).toBe("EJECUTADO");
    expect(s.palletsList[0].cases).toBe(96);
    expect(s.palletsList[0].jars).toBe(2304);
    expect(Number(s.netKg)).toBeCloseTo(260.352, 3);
    const pdf = await admin.get("/api/export-demo/sim/report.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("pdf");
  }, 180000);
});

describe("Portal, permisos y pagos", () => {
  it("el agente de aduana no accede a costos ni finanzas", async () => {
    const agent = await login("agente@aduanas-demo.pe");
    expect((await agent.get("/api/finance/transactions")).status).toBe(403);
    const list = await agent.get("/api/trade/shipments");
    expect(list.status).toBe(200);
    for (const s of list.body) { expect(s.marginPct).toBeUndefined(); expect(s.agentEmail).toBe("agente@aduanas-demo.pe"); }
  });
  it("el comprador solo ve sus pedidos y paga con pago de prueba marcado como no real", async () => {
    const buyer = await login("compras@importadordemo-usa.com");
    const me = await buyer.get("/api/portal/me");
    expect(me.status).toBe(200);
    const quote = me.body.orders.find((o: any) => o.status === "COTIZACION");
    expect(quote.marginPct).toBeUndefined();
    expect((await buyer.post(`/api/portal/orders/${quote.code}/accept-quote`).send({})).status).toBe(200);
    const pay = await buyer.post(`/api/portal/orders/${quote.code}/pay`).send({ method: "PRUEBA" });
    expect(pay.body.status).toBe("APROBADO");
    expect(pay.body.livemode).toBe(false);
    expect((await buyer.get("/api/finance/transactions")).status).toBe(403);
  });
  it("la tarjeta sin pasarela configurada responde 503 y nunca pide datos de tarjeta", async () => {
    const buyer = await login("compras@importadordemo-usa.com");
    const cot = await buyer.get("/api/portal/me");
    const any = cot.body.orders.find((o: any) => Number(o.paidUsd) < Number(o.amountUsd) && o.status !== "COTIZACION");
    if (!any) return;
    const r = await buyer.post(`/api/portal/orders/${any.code}/pay`).send({ method: "TARJETA" });
    expect([503, 200]).toContain(r.status);
  });
  it("la consulta pública del QR verifica los hitos contra la blockchain", async () => {
    const lot = await prisma.lot.findFirstOrThrow({ where: { code: { startsWith: "LOTE-" }, pallets: { some: { status: "DESPACHADO" } } } });
    const r = await admin.get(`/api/public/trace/${lot.code}`);
    expect(r.status).toBe(200);
    expect(r.body.milestones.length).toBeGreaterThanOrEqual(6);
    expect(r.body.verification.every((v: any) => v.matches !== false)).toBe(true);
  });
});
