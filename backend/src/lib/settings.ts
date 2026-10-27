import { prisma, Tx } from "./prisma";

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "company.name": "Don Pimentón",
  "company.city": "Arequipa, Perú",
  "currency.base": "PEN",
  "currency.secondary": "USD",
  "fx.defaultUsdPen": 3.75,
  "tax.rates": [
    { code: "IGV", name: "IGV 18% (configurable)", rate: 0.18 },
    { code: "EXO", name: "Exonerado / Inafecto (validar con contador)", rate: 0 },
  ],
  "tax.defaultCode": "IGV",
  "inventory.dispatchPolicy": "ON_DISPATCH", // ON_DISPATCH | ON_DELIVERY
  "inventory.bagWeightKg": 25,
  "blockchain.penPerTestEth": 1000, // S/ 1,000 de referencia = 1 ETH ficticio de red local
  "modules.enabled": {
    agricultura: true, produccion: true, calidad: true, inventario: true, compras: true, ventas: true,
    logistica: true, finanzas: true, blockchain: true, exportaciones: true, rrhh: true,
  },
};

export async function getSetting<T = any>(key: string, db: Tx | typeof prisma = prisma): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row ? row.value : DEFAULT_SETTINGS[key]) as T;
}

export async function getAllSettings() {
  const rows = await prisma.setting.findMany();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}
