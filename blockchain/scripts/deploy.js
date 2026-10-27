// Despliega los contratos en la red local y asigna roles a las cuentas demo.
// Las cuentas son las 20 cuentas deterministas de Hardhat (mnemónico público
// "test test ... junk"): SOLO para la red local, nunca para redes públicas.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const ACTORS = {
  admin: 0,      // Administrador / despliegue
  seller: 1,     // Don Pimentón — Comercial (vendedor)
  buyer: 2,      // Distribuidora Andina Demo (comprador ficticio)
  quality: 3,    // Responsable de calidad
  logistics: 4,  // Logística
  arbiter: 5,    // Gerencia (árbitro de disputas)
  intruder: 6,   // Actor no autorizado (escenario negativo)
  registrar: 7,  // Producción (registra lotes)
};

async function main() {
  const signers = await hre.ethers.getSigners();
  const a = Object.fromEntries(Object.entries(ACTORS).map(([k, i]) => [k, signers[i]]));

  const trace = await (await hre.ethers.getContractFactory("PaprikaTraceability")).deploy(a.admin.address);
  await trace.waitForDeployment();
  const trade = await (await hre.ethers.getContractFactory("PaprikaTradeAgreement")).deploy(a.admin.address, await trace.getAddress());
  await trade.waitForDeployment();

  const grants = [
    [trace, "REGISTRAR_ROLE", a.registrar],
    [trace, "QUALITY_ROLE", a.quality],
    [trade, "SELLER_ROLE", a.seller],
    [trade, "QUALITY_ROLE", a.quality],
    [trade, "LOGISTICS_ROLE", a.logistics],
    [trade, "ARBITER_ROLE", a.arbiter],
  ];
  for (const [c, role, s] of grants) await (await c.grantRole(await c[role](), s.address)).wait();

  const deployTx = trace.deploymentTransaction();
  const receipt = await deployTx.wait();
  const art = (n) => hre.artifacts.readArtifactSync(n);
  const out = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployBlock: receipt.blockNumber,
    actors: Object.fromEntries(Object.entries(ACTORS).map(([k, i]) => [k, { index: i, address: signers[i].address }])),
    contracts: {
      PaprikaTraceability: { address: await trace.getAddress(), abi: art("PaprikaTraceability").abi },
      PaprikaTradeAgreement: { address: await trade.getAddress(), abi: art("PaprikaTradeAgreement").abi },
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hre.network.name}.json`), JSON.stringify(out, null, 2));
  console.log("PaprikaTraceability   ", out.contracts.PaprikaTraceability.address);
  console.log("PaprikaTradeAgreement ", out.contracts.PaprikaTradeAgreement.address);
  console.log("Guardado en deployments/" + hre.network.name + ".json");
}

main().catch((e) => { console.error(e); process.exit(1); });
