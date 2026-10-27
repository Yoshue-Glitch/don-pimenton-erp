import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const num = (v: Prisma.Decimal.Value | null | undefined) => Number(v ?? 0);
export const round2 = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const round3 = (v: Prisma.Decimal.Value) => D(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
