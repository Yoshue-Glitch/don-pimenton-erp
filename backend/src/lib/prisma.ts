import { PrismaClient, Prisma } from "@prisma/client";

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

/** Ejecuta una operación crítica dentro de una transacción serializable con reintentos. */
export async function inTx<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000, maxWait: 10000 });
    } catch (e: any) {
      const retryable = e?.code === "P2034" || /could not serialize|deadlock/i.test(String(e?.message));
      if (!retryable || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }
}
