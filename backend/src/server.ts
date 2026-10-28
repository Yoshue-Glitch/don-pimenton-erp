import { createApp } from "./app";
import { config } from "./config";
import * as chain from "./blockchain/chain";

createApp().listen(config.port, () => {
  console.log(`Don Pimentón ERP API escuchando en http://localhost:${config.port}`);
  if (process.env.AUTO_DEPLOY_CONTRACTS === "1") ensureContracts();
});

/** Si la red local se reinició (contenedor nuevo), vuelve a desplegar los contratos. */
async function ensureContracts(attempt = 1): Promise<void> {
  try {
    const st = await chain.status();
    if (!st.connected) throw new Error(st.error ?? "red no disponible");
    if (st.contracts.every((c: any) => c.deployed)) return console.log("Contratos presentes en la red local");
    const out = await chain.deployContracts();
    console.log("Red local nueva: contratos desplegados", out);
  } catch (e: any) {
    if (attempt >= 30) return console.error("No se pudieron desplegar los contratos:", e.message);
    setTimeout(() => ensureContracts(attempt + 1), 2000);
  }
}
