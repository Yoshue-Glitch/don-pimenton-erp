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
    logistica: true, finanzas: true, blockchain: true, exportaciones: true, rrhh: true, marketing: true,
    comex: true, documentos: true, aduanas: true, cumplimiento: true, costos: true, kpi: true, asistente: true, rs: true, inversa: true, pagos: true, portal: true,
  },
  /** Parámetros del plan (OP-1 a OP-9, TI-11). Referencias del documento: configurables y sujetos a validación. */
  "export.params": {
    jarNetG: 113, jarsPerCase: 24, casesPerPallet: 96, jarTareG: 105, caseTareKg: 0.55, palletTareKg: 25,
    freshPerKg: 8.075, yieldPct: 12.4, selectionDiscardPct: 7, maxFinalMoisturePct: 11, bestByMonths: 12,
    gs1CompanyPrefix: "7759999", hsCode: "0904.22.10.00", htsCode: "0904.22.20",
    approvedDescription: "PIMENTÓN (PÁPRIKA) MOLIDO EN FRASCOS DE VIDRIO DE 113 G (4 OZ), 24 FRASCOS POR CAJA — PREMIUM GROUND PAPRIKA",
    defaultPriceUsd: 2.0, marginFloorPct: 20, incotermVersion: "Incoterms® 2020",
    damShipDays: 30, damGreenUntil: 20, damAmberUntil: 27, regularizationDays: 30, regularizationAlerts: [20, 25, 28], isfHoursBeforeCutoff: 48,
    originPort: "Callao (PECLL)", destinationPort: "Port Everglades, FL (USPEF)", voyageDays: 9,
  },
  /** Límites del panel de exportación (OP-8): referencias del plan, modificables por contrato/normativa. */
  "quality.exportLimits": {
    astaMin: 100, astaMax: 120, moistureMax: 11, awMax: 0.6, aflatoxinB1Max: 5, aflatoxinTotalMax: 10, ochratoxinAMax: 20,
    ecoliMax: 10, moldsYeastsMax: 10000, netWeightMinG: 113,
  },
  /** Costos de referencia por frasco (OP-48, S/). Datos de demostración del plan. */
  "costs.perJarPen": { AGRICOLA: 0.339, SECADO: 0.159, TRATAMIENTO: 0.17, MOLIENDA: 0.06, ENVASADO: 1.67, EMBALAJE: 0.229, LOGISTICO: 0.35, DOCUMENTAL: 0.391 },
  /** Cuentas de cobro (completar con datos reales en Configuración → Pagos). */
  "payments.accounts": { yapeNumber: null, yapeHolder: null, bankName: null, accountNumber: null, cci: null, swift: null, accountHolder: null, currency: "USD" },
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
