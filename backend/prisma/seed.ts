import { PrismaClient } from "@prisma/client";
import { seedSecurity, resetBusinessData, seedBaseData, DEMO_USERS, DEMO_PASSWORD } from "../src/seed/seedData";
import { deployContracts } from "../src/blockchain/chain";

const db = new PrismaClient();

async function main() {
  if (process.argv.includes("--if-empty") && (await db.lot.count()) > 0) {
    console.log("La base ya tiene datos: se omite la carga de demostración (--if-empty).");
    return;
  }
  const t = Date.now();
  await seedSecurity(db);
  await resetBusinessData(db);
  await seedBaseData(db);
  console.log(`Datos de demostración cargados en ${((Date.now() - t) / 1000).toFixed(1)} s`);
  try {
    const c = await deployContracts();
    console.log("Contratos desplegados en la red local:", c);
  } catch (e: any) {
    console.warn("Blockchain local no disponible; despliegue los contratos luego desde el panel o con 'npm run deploy' en /blockchain.", e.message);
  }
  console.log("\nUsuarios demo (contraseña común: " + DEMO_PASSWORD + "):");
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(14)} ${u.email}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
