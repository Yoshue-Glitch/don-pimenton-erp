import { execSync } from "child_process";

/** Prepara una base de datos de pruebas aislada: migraciones + datos de demostración + contratos. */
export default function setup() {
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://donpimenton:donpimenton@localhost:5432/donpimenton_test?schema=public", UPLOAD_DIR: "./uploads-test" };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
}
