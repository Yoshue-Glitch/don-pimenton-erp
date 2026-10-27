const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const sha = (s) => ethers.sha256(ethers.toUtf8Bytes(s));
const Q = { Pending: 0, Approved: 1, Rejected: 2, Quarantine: 3 };
const S = { None: 0, Proposed: 1, Accepted: 2, Funded: 3, Completed: 4, Cancelled: 5, Refunded: 6, Disputed: 7 };
const AMOUNT = ethers.parseEther("3"); // 3 ETH ficticios de red local ↔ S/ 3,000 de referencia

async function deploy() {
  const [admin, seller, buyer, quality, logistics, arbiter, intruder, registrar] = await ethers.getSigners();
  const Trace = await ethers.getContractFactory("PaprikaTraceability");
  const trace = await Trace.deploy(admin.address);
  const Trade = await ethers.getContractFactory("PaprikaTradeAgreement");
  const trade = await Trade.deploy(admin.address, await trace.getAddress());

  await trace.grantRole(await trace.REGISTRAR_ROLE(), registrar.address);
  await trace.grantRole(await trace.QUALITY_ROLE(), quality.address);
  await trade.grantRole(await trade.SELLER_ROLE(), seller.address);
  await trade.grantRole(await trade.QUALITY_ROLE(), quality.address);
  await trade.grantRole(await trade.LOGISTICS_ROLE(), logistics.address);
  await trade.grantRole(await trade.ARBITER_ROLE(), arbiter.address);
  return { trace, trade, admin, seller, buyer, quality, logistics, arbiter, intruder, registrar };
}

async function deadline(days = 30) {
  return BigInt((await time.latest()) + days * 86400);
}

async function approvedLot(ctx, lotId = "DP-2026-001") {
  await ctx.trace.connect(ctx.registrar).registerLot(lotId, sha(lotId + "-data"));
  await ctx.trace.connect(ctx.quality).recordQuality(lotId, Q.Approved, sha(lotId + "-coa"));
}

async function fundedAgreement(ctx, id = "SC-0001", lotId = "DP-2026-001") {
  await ctx.trade.connect(ctx.seller).createAgreement(id, lotId, ctx.buyer.address, 200, AMOUNT, 300000, await deadline());
  await ctx.trade.connect(ctx.buyer).acceptAgreement(id);
  await ctx.trade.connect(ctx.buyer).depositFunds(id, { value: AMOUNT });
}

describe("PaprikaTraceability", () => {
  it("registra un lote, evita duplicados y emite eventos", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.trace.connect(ctx.registrar).registerLot("DP-2026-001", sha("x")))
      .to.emit(ctx.trace, "LotRegistered");
    await expect(ctx.trace.connect(ctx.registrar).registerLot("DP-2026-001", sha("y")))
      .to.be.revertedWithCustomError(ctx.trace, "LotAlreadyRegistered");
    expect(await ctx.trace.totalLots()).to.equal(1n);
  });

  it("rechaza registros de actores no autorizados", async () => {
    const ctx = await loadFixture(deploy);
    await expect(ctx.trace.connect(ctx.intruder).registerLot("DP-X", sha("x")))
      .to.be.revertedWithCustomError(ctx.trace, "AccessControlUnauthorizedAccount");
    await ctx.trace.connect(ctx.registrar).registerLot("DP-X", sha("x"));
    await expect(ctx.trace.connect(ctx.registrar).recordQuality("DP-X", Q.Approved, sha("c")))
      .to.be.revertedWithCustomError(ctx.trace, "AccessControlUnauthorizedAccount");
  });

  it("verifica hashes y estado de calidad", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    const [d, c, q] = await ctx.trace.verifyLot("DP-2026-001", sha("DP-2026-001-data"), sha("DP-2026-001-coa"));
    expect(d).to.equal(true);
    expect(c).to.equal(true);
    expect(q).to.equal(BigInt(Q.Approved));
    const [d2] = await ctx.trace.verifyLot("DP-2026-001", sha("manipulado"), sha("DP-2026-001-coa"));
    expect(d2).to.equal(false);
    expect(await ctx.trace.isApproved("DP-2026-001")).to.equal(true);
  });

  it("versiona la actualización de datos del lote", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.trace.connect(ctx.registrar).registerLot("DP-1", sha("v1"));
    await expect(ctx.trace.connect(ctx.registrar).updateLotData("DP-1", sha("v2"))).to.emit(ctx.trace, "LotDataUpdated");
    expect((await ctx.trace.getLot("DP-1")).version).to.equal(2n);
  });
});

describe("PaprikaTradeAgreement — flujo feliz", () => {
  it("completa el acuerdo y libera los fondos de prueba al vendedor", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    expect(await ethers.provider.getBalance(await ctx.trade.getAddress())).to.equal(AMOUNT);

    await ctx.trade.connect(ctx.quality).recordQuality("SC-0001", true, sha("coa"));
    await ctx.trade.connect(ctx.logistics).recordDelivery("SC-0001", sha("guia"));
    await ctx.trade.connect(ctx.buyer).confirmReceipt("SC-0001");
    const [ok] = await ctx.trade.canRelease("SC-0001");
    expect(ok).to.equal(true);

    const tx = ctx.trade.connect(ctx.seller).releasePayment("SC-0001");
    await expect(tx).to.changeEtherBalances([ctx.seller, ctx.trade], [AMOUNT, -AMOUNT]);
    await expect(tx).to.emit(ctx.trade, "PaymentReleased");
    expect((await ctx.trade.getAgreement("SC-0001")).state).to.equal(BigInt(S.Completed));
  });

  it("evita pagos duplicados", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await ctx.trade.connect(ctx.quality).recordQuality("SC-0001", true, sha("coa"));
    await ctx.trade.connect(ctx.logistics).recordDelivery("SC-0001", sha("guia"));
    await ctx.trade.connect(ctx.buyer).confirmReceipt("SC-0001");
    await ctx.trade.connect(ctx.seller).releasePayment("SC-0001");
    await expect(ctx.trade.connect(ctx.seller).releasePayment("SC-0001"))
      .to.be.revertedWithCustomError(ctx.trade, "InvalidState");
  });

  it("impide reutilizar identificadores de acuerdo y comprometer dos veces el mismo lote", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await expect(ctx.trade.connect(ctx.seller).createAgreement("SC-0001", "DP-OTRO", ctx.buyer.address, 1, 1, 1, await deadline()))
      .to.be.revertedWithCustomError(ctx.trade, "AgreementExists");
    await expect(ctx.trade.connect(ctx.seller).createAgreement("SC-0002", "DP-2026-001", ctx.buyer.address, 1, 1, 1, await deadline()))
      .to.be.revertedWithCustomError(ctx.trade, "LotAlreadyCommitted");
  });

  it("exige el importe exacto del depósito", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.trade.connect(ctx.seller).createAgreement("SC-9", "DP-9", ctx.buyer.address, 200, AMOUNT, 1, await deadline());
    await ctx.trade.connect(ctx.buyer).acceptAgreement("SC-9");
    await expect(ctx.trade.connect(ctx.buyer).depositFunds("SC-9", { value: 1n }))
      .to.be.revertedWithCustomError(ctx.trade, "WrongAmount");
  });
});

describe("PaprikaTradeAgreement — escenarios negativos", () => {
  it("Lote rechazado: el contrato bloquea el pago y permite el reembolso", async () => {
    const ctx = await loadFixture(deploy);
    await ctx.trace.connect(ctx.registrar).registerLot("DP-2026-002", sha("d"));
    await ctx.trace.connect(ctx.quality).recordQuality("DP-2026-002", Q.Rejected, sha("informe"));
    await fundedAgreement(ctx, "SC-R", "DP-2026-002");

    // No puede registrarse como aprobado si en trazabilidad está rechazado
    await expect(ctx.trade.connect(ctx.quality).recordQuality("SC-R", true, sha("coa")))
      .to.be.revertedWithCustomError(ctx.trade, "LotNotApprovedOnChain");
    await ctx.trade.connect(ctx.quality).recordQuality("SC-R", false, sha("informe"));
    await expect(ctx.trade.connect(ctx.logistics).recordDelivery("SC-R", sha("g")))
      .to.be.revertedWithCustomError(ctx.trade, "QualityNotApproved");
    await expect(ctx.trade.connect(ctx.seller).releasePayment("SC-R"))
      .to.be.revertedWithCustomError(ctx.trade, "QualityNotApproved");

    await expect(ctx.trade.connect(ctx.buyer).cancelAgreement("SC-R", "Lote rechazado"))
      .to.changeEtherBalances([ctx.buyer, ctx.trade], [AMOUNT, -AMOUNT]);
    expect((await ctx.trade.getAgreement("SC-R")).state).to.equal(BigInt(S.Refunded));
  });

  it("Entrega no confirmada: el pago permanece pendiente", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await ctx.trade.connect(ctx.quality).recordQuality("SC-0001", true, sha("coa"));
    await expect(ctx.trade.connect(ctx.seller).releasePayment("SC-0001"))
      .to.be.revertedWithCustomError(ctx.trade, "DeliveryNotConfirmed");
    await ctx.trade.connect(ctx.logistics).recordDelivery("SC-0001", sha("guia"));
    await expect(ctx.trade.connect(ctx.seller).releasePayment("SC-0001"))
      .to.be.revertedWithCustomError(ctx.trade, "DeliveryNotConfirmed");
    expect(await ethers.provider.getBalance(await ctx.trade.getAddress())).to.equal(AMOUNT);
    // el comprador no puede cancelar unilateralmente antes del plazo
    await expect(ctx.trade.connect(ctx.buyer).cancelAgreement("SC-0001", "x"))
      .to.be.revertedWithCustomError(ctx.trade, "CancellationNotAllowed");
  });

  it("Usuario no autorizado: el contrato rechaza la transacción", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await expect(ctx.trade.connect(ctx.intruder).recordQuality("SC-0001", true, sha("coa")))
      .to.be.revertedWithCustomError(ctx.trade, "AccessControlUnauthorizedAccount");
    await ctx.trade.connect(ctx.quality).recordQuality("SC-0001", true, sha("coa"));
    await expect(ctx.trade.connect(ctx.intruder).recordDelivery("SC-0001", sha("g")))
      .to.be.revertedWithCustomError(ctx.trade, "AccessControlUnauthorizedAccount");
    await ctx.trade.connect(ctx.logistics).recordDelivery("SC-0001", sha("g"));
    await expect(ctx.trade.connect(ctx.intruder).confirmReceipt("SC-0001"))
      .to.be.revertedWithCustomError(ctx.trade, "NotBuyer");
    await ctx.trade.connect(ctx.buyer).confirmReceipt("SC-0001");
    await expect(ctx.trade.connect(ctx.intruder).releasePayment("SC-0001"))
      .to.be.revertedWithCustomError(ctx.trade, "NotParty");
    await expect(ctx.trade.connect(ctx.intruder).createAgreement("SC-Z", "DP-Z", ctx.buyer.address, 1, 1, 1, await deadline()))
      .to.be.revertedWithCustomError(ctx.trade, "AccessControlUnauthorizedAccount");
  });

  it("Plazo vencido sin confirmación: el comprador recupera sus fondos", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await time.increase(31 * 86400);
    await expect(ctx.trade.connect(ctx.buyer).cancelAgreement("SC-0001", "Vencido"))
      .to.emit(ctx.trade, "FundsRefunded");
  });

  it("Disputa: el árbitro no puede liberar al vendedor sin calidad aprobada", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    await fundedAgreement(ctx);
    await ctx.trade.connect(ctx.buyer).openDispute("SC-0001", sha("sacos dañados"));
    await expect(ctx.trade.connect(ctx.arbiter).resolveDispute("SC-0001", true))
      .to.be.revertedWithCustomError(ctx.trade, "QualityNotApproved");
    await expect(ctx.trade.connect(ctx.intruder).resolveDispute("SC-0001", false))
      .to.be.revertedWithCustomError(ctx.trade, "AccessControlUnauthorizedAccount");
    await expect(ctx.trade.connect(ctx.arbiter).resolveDispute("SC-0001", false))
      .to.changeEtherBalances([ctx.buyer], [AMOUNT]);
  });

  it("Protección de reentrada en la liberación de pagos", async () => {
    const ctx = await loadFixture(deploy);
    await approvedLot(ctx);
    const Mal = await ethers.getContractFactory("ReentrantSeller");
    const mal = await Mal.deploy(await ctx.trade.getAddress());
    await ctx.trade.grantRole(await ctx.trade.SELLER_ROLE(), await mal.getAddress());
    await mal.create("SC-M", "DP-2026-001", ctx.buyer.address, AMOUNT, await deadline());
    await ctx.trade.connect(ctx.buyer).acceptAgreement("SC-M");
    await ctx.trade.connect(ctx.buyer).depositFunds("SC-M", { value: AMOUNT });
    await ctx.trade.connect(ctx.quality).recordQuality("SC-M", true, sha("coa"));
    await ctx.trade.connect(ctx.logistics).recordDelivery("SC-M", sha("g"));
    await ctx.trade.connect(ctx.buyer).confirmReceipt("SC-M");
    await mal.release();
    expect(await mal.reentryBlocked()).to.equal(true);
    expect(await ethers.provider.getBalance(await mal.getAddress())).to.equal(AMOUNT);
  });
});
