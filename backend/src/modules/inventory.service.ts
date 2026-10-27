import { MovementType, Prisma } from "@prisma/client";
import { Tx } from "../lib/prisma";
import { D, round3 } from "../lib/decimal";
import { nextCode } from "../lib/sequence";
import { unprocessable } from "../lib/errors";

type Bucket = "availableKg" | "reservedKg" | "quarantineKg";

/** Efecto de cada tipo de movimiento sobre los saldos (disponible / reservado / cuarentena). */
const EFFECTS: Record<MovementType, Partial<Record<Bucket, 1 | -1>>> = {
  ENTRADA: { availableKg: 1 },
  SALIDA: { reservedKg: -1 }, // salida de un pedido reservado
  RESERVA: { availableKg: -1, reservedKg: 1 },
  LIBERACION_RESERVA: { reservedKg: -1, availableKg: 1 },
  TRANSFERENCIA_SALIDA: { availableKg: -1 },
  TRANSFERENCIA_ENTRADA: { availableKg: 1 },
  AJUSTE_POSITIVO: { availableKg: 1 },
  AJUSTE_NEGATIVO: { availableKg: -1 },
  INGRESO_CUARENTENA: { quarantineKg: 1 },
  LIBERACION_CUARENTENA: { quarantineKg: -1, availableKg: 1 },
  BLOQUEO_CUARENTENA: { availableKg: -1, quarantineKg: 1 },
  CONSUMO_PRODUCCION: { availableKg: -1 },
  DEVOLUCION: { quarantineKg: 1 },
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  ENTRADA: "Entrada", SALIDA: "Salida", RESERVA: "Reserva", LIBERACION_RESERVA: "Liberación de reserva",
  TRANSFERENCIA_SALIDA: "Transferencia (salida)", TRANSFERENCIA_ENTRADA: "Transferencia (entrada)",
  AJUSTE_POSITIVO: "Ajuste (+)", AJUSTE_NEGATIVO: "Ajuste (−)", INGRESO_CUARENTENA: "Ingreso a cuarentena",
  LIBERACION_CUARENTENA: "Liberación de cuarentena", BLOQUEO_CUARENTENA: "Bloqueo a cuarentena",
  CONSUMO_PRODUCCION: "Consumo en producción", DEVOLUCION: "Devolución",
};

export interface MovementInput {
  type: MovementType;
  productId: number;
  warehouseId: number;
  lotId?: number | null;
  quantityKg: Prisma.Decimal.Value;
  reason: string;
  referenceType: string;
  referenceCode: string;
  userId: number;
  unitCost?: Prisma.Decimal.Value;
  bagWeightKg?: number | null;
  at?: Date;
  /** para SALIDA: de qué saldo sale (por defecto, reservado) */
  from?: Bucket;
}

/** Bloquea (FOR UPDATE) o crea la fila de saldo correspondiente. */
async function lockBalance(tx: Tx, productId: number, warehouseId: number, lotId: number | null) {
  await tx.$executeRaw`INSERT INTO "InventoryBalance" ("productId","warehouseId","lotId","availableKg","reservedKg","quarantineKg","updatedAt")
    VALUES (${productId}, ${warehouseId}, ${lotId}, 0, 0, 0, now())
    ON CONFLICT ("productId","warehouseId","lotId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: number; availableKg: Prisma.Decimal; reservedKg: Prisma.Decimal; quarantineKg: Prisma.Decimal }[]>`
    SELECT "id","availableKg","reservedKg","quarantineKg" FROM "InventoryBalance"
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId} AND "lotId" IS NOT DISTINCT FROM ${lotId}
    FOR UPDATE`;
  return rows[0];
}

/** Registra un movimiento y actualiza saldos de forma atómica. Nunca permite saldos negativos. */
export async function applyMovement(tx: Tx, m: MovementInput) {
  const qty = round3(m.quantityKg);
  if (qty.lte(0)) throw unprocessable("La cantidad del movimiento debe ser mayor a cero");
  const lotId = m.lotId ?? null;
  const bal = await lockBalance(tx, m.productId, m.warehouseId, lotId);
  const effects = { ...EFFECTS[m.type] };
  if (m.type === "SALIDA" && m.from && m.from !== "reservedKg") { delete effects.reservedKg; effects[m.from] = -1; }

  const next: Record<Bucket, Prisma.Decimal> = { availableKg: D(bal.availableKg), reservedKg: D(bal.reservedKg), quarantineKg: D(bal.quarantineKg) };
  for (const [bucket, sign] of Object.entries(effects) as [Bucket, 1 | -1][]) {
    next[bucket] = next[bucket].plus(qty.times(sign));
    if (next[bucket].lt(0)) {
      const labels: Record<Bucket, string> = { availableKg: "disponible", reservedKg: "reservado", quarantineKg: "en cuarentena" };
      throw unprocessable(`Stock ${labels[bucket]} insuficiente: hay ${D(bal[bucket]).toFixed(3)} kg y se requieren ${qty.toFixed(3)} kg. No se permite stock negativo.`);
    }
  }
  await tx.inventoryBalance.update({ where: { id: bal.id }, data: next });

  const agg = await tx.inventoryBalance.aggregate({
    where: { productId: m.productId, warehouseId: m.warehouseId },
    _sum: { availableKg: true, reservedKg: true, quarantineKg: true },
  });
  const physical = D(agg._sum.availableKg).plus(D(agg._sum.reservedKg)).plus(D(agg._sum.quarantineKg));
  const code = await nextCode(tx, "MOV", (m.at ?? new Date()).getFullYear(), 5);
  return tx.inventoryMovement.create({
    data: {
      code, type: m.type, productId: m.productId, warehouseId: m.warehouseId, lotId,
      quantityKg: qty, bags: m.bagWeightKg ? qty.div(m.bagWeightKg).toDecimalPlaces(2) : null,
      unitCost: D(m.unitCost ?? 0), balanceAfter: physical, reason: m.reason,
      referenceType: m.referenceType, referenceCode: m.referenceCode, userId: m.userId, createdAt: m.at ?? new Date(),
    },
  });
}

export async function lotBalances(tx: Tx, lotId: number) {
  const rows = await tx.inventoryBalance.findMany({ where: { lotId } });
  return rows.reduce(
    (acc, r) => ({ available: acc.available.plus(r.availableKg), reserved: acc.reserved.plus(r.reservedKg), quarantine: acc.quarantine.plus(r.quarantineKg) }),
    { available: D(0), reserved: D(0), quarantine: D(0) },
  );
}

export async function warehouseByCode(tx: Tx, code: string) {
  const w = await tx.warehouse.findUnique({ where: { code } });
  if (!w) throw unprocessable(`No existe el almacén ${code}`);
  return w;
}
