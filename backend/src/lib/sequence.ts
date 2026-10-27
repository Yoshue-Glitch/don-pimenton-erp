import { Tx } from "./prisma";

/** Genera códigos correlativos atómicos: nextCode(tx, "OP", 2026) → "OP-2026-0001". */
export async function nextCode(tx: Tx, prefix: string, year: number | null = new Date().getFullYear(), pad = 4): Promise<string> {
  const key = year ? `${prefix}-${year}` : prefix;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return `${key}-${String(rows[0].value).padStart(pad, "0")}`;
}

export async function setSequence(tx: Tx, key: string, value: number) {
  await tx.$executeRaw`INSERT INTO "Sequence" ("key","value") VALUES (${key}, ${value})
    ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Sequence"."value", ${value})`;
}
