/**
 * Datos de demostración del hub de exportación (frascos 4 oz → EE. UU.), cumplimiento,
 * logística inversa y plan de Responsabilidad Social. Todo es ficticio y está marcado como demo.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { inTx } from "../lib/prisma";
import { applyMovement } from "../modules/inventory.service";
import { COMPANY_COMPLIANCE, packLot, createShipment } from "../modules/trade.service";
import { setSequence } from "../lib/sequence";
import { DEMO_PASSWORD } from "./seedData";

const DAY = 86400000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

export const PORTAL_USERS = [
  { email: "logistica@donpimenton.pe", name: "Departamento de Exportaciones · Logística y documentación", role: "LOGISTICA", area: "EXP", customer: null },
  { email: "agente@aduanas-demo.pe", name: "Agencia de Aduanas Ficticia Demo (agente externo)", role: "AGENTE_ADUANA", area: null, customer: null },
  { email: "broker@foodbroker-demo.com", name: "Food Broker Demo (EE. UU.)", role: "BROKER", area: null, customer: "CLI-USA-001" },
  { email: "compras@importadordemo-usa.com", name: "Importador Demo USA LLC · Compras", role: "COMPRADOR", area: null, customer: "CLI-USA-001" },
];

export const RS_PROJECTS: [string, string, string, number, string, string, string, number, string][] = [
  // code, axis, name, budget, source, class, responsible, stage, gri
  ["PE-01", "ECONOMICO", "Formalización contable y hoja de control económico", 2400, "PROP", "OBL", "Gestora general", 1, "GRI 201"],
  ["PE-02", "ECONOMICO", "Asociación de productores con convenio (8 productores, prima por calidad)", 9800, "FOND", "EST", "Coordinador(a) de Exportaciones y Calidad", 2, "GRI 202, 203; 13.21-13.23"],
  ["PE-03", "ECONOMICO", "Evaluación de proveedores clave (criterios ambientales y sociales)", 1200, "PROP", "EST", "Coordinador(a) de Exportaciones y Calidad", 1, "GRI 204, 308, 414"],
  ["PE-04", "ECONOMICO", "Empleo formal: contrato, planilla, seguro vida ley y SST", 6480, "PROP", "OBL", "Gestora general", 1, "GRI 401, 403, 405"],
  ["PE-05", "ECONOMICO", "Capacitación exportadora (PROMPERÚ, Ruta Exportadora, ferias)", 3500, "FOND", "VOL", "Coordinador(a) de Exportaciones y Calidad", 2, "GRI 404"],
  ["PE-06", "ECONOMICO", "Cumplimiento FDA/FSMA, agente en EE. UU. y panel de análisis por lote", 9900, "ASOC", "OBL", "Coordinador(a) de Exportaciones y Calidad", 1, "GRI 416; 13.10"],
  ["PA-01", "AMBIENTAL", "Riego tecnificado por goteo y medición de agua por riego", 9200, "CRED", "EST", "Operario(a) de procesamiento y calidad", 2, "GRI 303; 13.7"],
  ["PA-02", "AMBIENTAL", "Eficiencia energética del secado y presecado solar", 7400, "CRED", "EST", "Operario(a) de procesamiento y calidad", 1, "GRI 302, 305; 13.1"],
  ["PA-03", "AMBIENTAL", "Compostaje del 100 % de residuos orgánicos de planta", 2600, "PROP", "OBL", "Operario(a) de procesamiento y calidad", 1, "GRI 306; 13.8"],
  ["PA-04", "AMBIENTAL", "Economía circular y logística inversa: sacos reutilizados, paletas retornables y recicladores", 5450, "ASOC", "EST", "Coordinador(a) de Exportaciones y Calidad", 2, "GRI 301-3, 306; 13.8"],
  ["PA-05", "AMBIENTAL", "Salud del suelo y manejo integrado de plagas", 2800, "PROP", "OBL", "Gestora general", 1, "GRI 13.5, 13.6"],
  ["PA-06", "AMBIENTAL", "Huella de carbono simplificada y adaptación climática", 1900, "FOND", "EST", "Coordinador(a) de Exportaciones y Calidad", 2, "GRI 201-2, 305; 13.2"],
  ["PA-07", "AMBIENTAL", "Biodiversidad: cercos vivos y polinizadores", 900, "PROP", "VOL", "Operario(a) de procesamiento y calidad", 3, "GRI 304; 13.3"],
  ["PA-08", "AMBIENTAL", "Plan de contingencias, residuos peligrosos (EO-RS) y simulacros", 5600, "CRED", "OBL", "Supervisor(a) de SST", 1, "GRI 403, 306"],
  ["PS-01", "SOCIAL", "Formación de mujeres productoras (30 al mes 24)", 2400, "FOND", "VOL", "Gestora general", 3, "GRI 405; 13.15"],
  ["PS-02", "SOCIAL", "Campañas de salud con aliados (120 atenciones)", 1600, "FOND", "VOL", "Gestora general", 3, "GRI 413"],
  ["PS-03", "SOCIAL", "Beca Semilla para hijos de trabajadores y productores", 1800, "ASOC", "VOL", "Gestora general", 3, "GRI 413"],
  ["PS-04", "SOCIAL", "Aula-taller comunal con la asociación", 3000, "PROP", "VOL", "Gestora general", 3, "GRI 203-1"],
  ["PS-05", "SOCIAL", "Mecanismo de quejas y mesas de diálogo (atención ≤ 15 días)", 1000, "PROP", "EST", "Coordinador(a) de Exportaciones y Calidad", 1, "GRI 413-2"],
  ["PS-06", "SOCIAL", "Contribución puntual a la comunidad de Caravelí", 1100, "PROP", "VOL", "Gestora general", 3, "GRI 413"],
  ["PS-07", "SOCIAL", "Brigada comunitaria de seguridad y simulacros", 1400, "PROP", "EST", "Supervisor(a) de SST", 3, "GRI 403"],
  ["PEt-01", "ETICO", "Código de ética y política de derechos humanos (trabajo infantil y forzoso)", 900, "PROP", "OBL", "Gestora general", 1, "GRI 408, 409; 13.16-13.17"],
  ["PEt-02", "ETICO", "Canal de denuncias confidencial", 480, "PROP", "OBL", "Oficial de cumplimiento", 1, "GRI 2-26, 406"],
  ["PEt-03", "ETICO", "Capacitación en ética y anticorrupción (100 % del personal)", 1300, "PROP", "EST", "Oficial de cumplimiento", 1, "GRI 205, 404"],
  ["PEt-04", "ETICO", "Debida diligencia y cláusulas éticas con productores y socios", 1100, "PROP", "OBL", "Coordinador(a) de Exportaciones y Calidad", 1, "GRI 414"],
  ["PEt-05", "ETICO", "Política anticorrupción y conflictos de interés", 600, "PROP", "OBL", "Asesor externo", 1, "GRI 205"],
  ["PEt-06", "ETICO", "Revisión legal de etiquetas para EE. UU.", 1500, "PROP", "OBL", "Asesor externo", 1, "GRI 417"],
  ["PEt-07", "ETICO", "Protección de datos personales (Ley N.° 29733)", 700, "PROP", "OBL", "Asesor externo", 1, "GRI 418"],
  ["PEt-08", "ETICO", "Auditoría anual de cumplimiento y pre-auditoría de comprador", 1200, "PROP", "EST", "Asesor externo", 2, "GRI 2-5"],
  ["PEt-09", "ETICO", "Informe de sostenibilidad GRI anual", 1400, "PROP", "EST", "Gestora general", 2, "GRI 1, 2, 3"],
  ["PT-01", "TRANSVERSAL", "Gestión, monitoreo y comunicación del plan de RS", 2000, "PROP", "EST", "Gestora general", 1, "GRI 2-29"],
];

export const RS_INDICATORS: [string, string, string, string, number | null, number, number, boolean, string, string | null][] = [
  ["RS-E1", "ECONOMICO", "Productores asociados con convenio", "productores", 0, 4, 8, false, "Coordinador(a)", null],
  ["RS-E2", "ECONOMICO", "Personal con contrato y planilla", "%", 0, 100, 100, false, "Gestora", "rrhh"],
  ["RS-E3", "ECONOMICO", "Cumplimiento de requisitos FDA y panel de lote", "%", 0, 100, 100, false, "Coordinador(a)", "compliance"],
  ["RS-A1", "AMBIENTAL", "Agua por kg", "m³/kg", 2.22, 2.0, 1.89, true, "Operario(a)", null],
  ["RS-A2", "AMBIENTAL", "Energía por kg", "kWh/kg", 3.4, 3.15, 2.73, true, "Operario(a)", "kpi3"],
  ["RS-A3", "AMBIENTAL", "GEI por kg", "kg CO₂e/kg", 1.14, 1.08, 0.97, true, "Coordinador(a)", null],
  ["RS-A4", "AMBIENTAL", "Residuos orgánicos compostados", "%", 0, 100, 100, false, "Operario(a)", "compost"],
  ["RS-A5", "AMBIENTAL", "Sacos y envases reutilizados (logística inversa)", "%", 0, 30, 30, false, "Coordinador(a)", "reuse"],
  ["RS-S1", "SOCIAL", "Mujeres formadas", "personas", 0, 15, 30, false, "Gestora", null],
  ["RS-S2", "SOCIAL", "Quejas y reclamos atendidos en ≤ 15 días", "%", null, 100, 100, false, "Coordinador(a)", "claims"],
  ["RS-S3", "SOCIAL", "Atenciones de salud", "atenciones", 0, 60, 120, false, "Gestora", null],
  ["RS-T1", "ETICO", "Personal capacitado en ética", "%", 0, 50, 100, false, "Oficial", null],
  ["RS-T2", "ETICO", "Socios con debida diligencia", "socios", 0, 3, 6, false, "Coordinador(a)", null],
  ["RS-T3", "ETICO", "Informes GRI publicados", "informes", 0, 1, 2, false, "Gestora", null],
  ["RS-P1", "TRANSVERSAL", "Ejecución presupuestal", "%", null, 90, 90, false, "Gestora", "budget"],
];

/** Año 1 / año 2 por plan (Tabla RS-44): Ético 5,840/3,340; transversal 1,000/1,000; resto ≈ 64 %. */
function splitYears(code: string, budget: number) {
  if (code === "PT-01") return [1000, 1000];
  const share = code.startsWith("PEt") ? 5840 / 9180 : 52168 / 81430;
  const y1 = Math.round(budget * share);
  return [y1, budget - y1];
}

export async function seedExport(db: PrismaClient) {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@donpimenton.pe" } });
  const uid = admin.id;
  const wh = Object.fromEntries((await db.warehouse.findMany()).map((w) => [w.code, w.id]));

  // ---------------------------------------------------------------- catálogo de exportación
  const prods = [
    { code: "PT-PAP-FRASCO-113", name: "Páprika molida premium — frasco de vidrio 113 g (4 oz)", type: "PRODUCTO_TERMINADO", unit: "KG", standardCost: 26.2, salePricePerKg: 63.72 },
    { code: "EMP-FRASCO-4OZ", name: "Frasco de vidrio 4 oz", type: "EMPAQUE", unit: "UND", minStock: 2304, standardCost: 0.95, stock: 30000 },
    { code: "EMP-TAPA-DOSIF", name: "Tapa dosificadora", type: "EMPAQUE", unit: "UND", minStock: 2304, standardCost: 0.3, stock: 30000 },
    { code: "EMP-SELLO-INDUC", name: "Sello de inducción", type: "EMPAQUE", unit: "UND", minStock: 2304, standardCost: 0.1, stock: 30000 },
    { code: "EMP-ETIQUETA-US", name: "Etiqueta autoadhesiva EE. UU. (frontal/posterior)", type: "EMPAQUE", unit: "UND", minStock: 4608, standardCost: 0.1, stock: 60000 },
    { code: "EMP-CAJA-24", name: "Caja shelf-ready para 24 frascos", type: "EMPAQUE", unit: "UND", minStock: 96, standardCost: 4.5, stock: 1500 },
    { code: "EMP-PALETA-GMA", name: "Paleta GMA con esquineras, fleje y film", type: "EMPAQUE", unit: "UND", minStock: 2, standardCost: 95, stock: 20 },
  ] as const;
  for (const p of prods) {
    const { stock, ...data } = p as any;
    const prod = await db.product.upsert({ where: { code: p.code }, create: data, update: {} });
    if (stock) await inTx((tx) => applyMovement(tx, { type: "ENTRADA", productId: prod.id, warehouseId: wh["ALM-INS"], quantityKg: stock, unitCost: data.standardCost, reason: "Stock inicial de empaques de exportación (demo)", referenceType: "SEED", referenceCode: p.code, userId: uid, at: new Date("2026-10-01") }));
  }

  // ---------------------------------------------------------------- cliente importador y cuentas externas
  const cust = await db.customer.upsert({
    where: { code: "CLI-USA-001" },
    create: { code: "CLI-USA-001", type: "INTERNACIONAL", documentType: "TAX_ID", documentNumber: "US-EIN-00-0000000", name: "Importador Demo USA LLC", contact: "Compras (ficticio)", email: "compras@importadordemo-usa.com", city: "Miami, FL", country: "Estados Unidos", address: "100 Demo Ave, Miami, FL (ficticio)", creditDays: 0, chainActor: "importer", fsvpContact: "FSVP: Importador Demo USA LLC — QI de inocuidad (ficticio)", importerNumber: "IOR-DEMO-0001" },
    update: {},
  });
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const u of PORTAL_USERS) {
    const role = await db.role.findUniqueOrThrow({ where: { code: u.role } });
    const area = u.area ? await db.area.findUnique({ where: { code: u.area } }) : null;
    const customerId = u.customer ? cust.id : null;
    await db.user.upsert({ where: { email: u.email }, create: { email: u.email, name: u.name, passwordHash: hash, roleId: role.id, areaId: area?.id, customerId }, update: { name: u.name, customerId } });
  }

  // ---------------------------------------------------------------- cumplimiento de empresa
  await db.complianceItem.deleteMany({ where: { scope: "EMPRESA" } });
  for (const [code, name, authority, days, responsible] of COMPANY_COMPLIANCE) {
    const evidence = code === "FSVP" ? null : `Evidencia de demostración: ${code}.pdf`;
    await db.complianceItem.create({ data: { code, name, authority, scope: "EMPRESA", mandatory: true, status: evidence ? "CUMPLIDO" : "REQUIERE_VALIDACION", validUntil: days === null ? null : daysFromNow(days), evidence, responsible, notes: code === "FDA-FFR" ? "La FDA exige renovar el registro de instalaciones entre el 1 de octubre y el 31 de diciembre de cada año par (21 CFR 1.230)." : null } });
  }

  // ---------------------------------------------------------------- análisis de exportación y envasado inicial (2 paletas disponibles)
  const bulk = await db.lot.findUniqueOrThrow({ where: { code: "DP-2026-010" } });
  await db.labAnalysis.create({ data: {
    code: "LAB-2026-0001", lotId: bulk.id, laboratory: "Laboratorio acreditado (ficticio) — Arequipa", analysisDate: new Date("2026-09-20"), asta: 112, moisturePct: 9.6, aw: 0.52, salmonella: "AUSENTE", ecoli: 3, moldsYeasts: 800, aflatoxinB1: 1.4, aflatoxinTotal: 2.9, ochratoxinA: 4.1, bannedDyes: "NO_DETECTADO", foreignMatter: "CONFORME", metalDetection: "CONFORME", netWeightG: 113.4,
    result: "APROBADO", approvedBy: "Procesamiento y Calidad · Calidad", approvedAt: new Date("2026-09-22"), evidence: "Informe de ensayo LAB-2026-0001 (demo)", coaHash: bulk.certHash,
  } });
  await setSequence(db as any, "LAB-2026", 1);
  const pack = await inTx((tx) => packLot(tx, { sourceLotCode: "DP-2026-010", pallets: 2, at: new Date("2026-10-28T10:00:00") }, uid));

  // ---------------------------------------------------------------- embarques históricos (proyectados, Fase 3) para los KPI
  const hist = [
    { code: "EMB-2026-H01", jars: 2304, price: 2.0, dam: "2026-07-02", ship: "2026-07-11", reg: "2026-07-19", del: "2026-07-21", due: "2026-07-25" },
    { code: "EMB-2026-H02", jars: 2304, price: 2.1, dam: "2026-08-20", ship: "2026-09-03", reg: "2026-09-15", del: "2026-09-14", due: "2026-09-12" },
  ];
  for (const h of hist) {
    const costs = await db.setting.findUnique({ where: { key: "costs.perJarPen" } });
    const perJar = (costs?.value as any) ?? { AGRICOLA: 0.339, SECADO: 0.159, TRATAMIENTO: 0.17, MOLIENDA: 0.06, ENVASADO: 1.67, EMBALAJE: 0.229, LOGISTICO: 0.35, DOCUMENTAL: 0.391 };
    await db.exportShipment.create({ data: {
      code: h.code, customerId: cust.id, importer: cust.name, broker: "Food Broker Demo (EE. UU.)", pallets: 1, cases: 96, jars: h.jars, netKg: 260.352, grossKg: 580.072, unitPriceUsd: h.price, amountUsd: h.jars * h.price, exchangeRate: 3.75,
      deliveryDate: new Date(h.due), status: "CERRADO", marginPct: 52, marginApproved: true, docsStatus: "APROBADO", damNumber: `118-2026-40-${h.code.slice(-2)}0011`, damDate: new Date(h.dam), channel: "VERDE", levanteDate: new Date(h.dam),
      blNumber: `BL-DEMO-${h.code.slice(-3)}`, manifest: "118-2026-1234", container: `DEMU${h.code.slice(-2)}12345`, vessel: "Nave demo", shippingLine: "Naviera demo", shipDate: new Date(h.ship), regularizedAt: new Date(h.reg),
      voyageStartedAt: new Date(h.ship), voyageProgress: 1, arrivedAt: new Date(h.del), deliveredAt: new Date(h.del), confirmedAt: new Date(h.del), paidUsd: h.jars * h.price, autopilot: false, otif: new Date(h.del) <= new Date(h.due),
      notes: "Embarque histórico de demostración (operación proyectada de la Fase 3)", createdAt: new Date(h.dam),
      costs: { create: Object.entries(perJar).map(([concept, v]) => ({ concept, amountPen: Number(v) * h.jars, budgetPen: Number(v) * h.jars, dataKind: "DEMO" })) },
    } });
  }
  await setSequence(db as any, "EMB-2026", 0);

  // pedido abierto del portal (pendiente de pago), para que el comprador vea un caso en curso
  await inTx((tx) => createShipment(tx, { customerId: cust.id, pallets: 1, unitPriceUsd: 2.0, incoterm: "FCA", deliveryDate: daysFromNow(35), broker: "Food Broker Demo (EE. UU.)", source: "PORTAL", status: "COTIZACION", notes: "Cotización solicitada desde el portal (demo)" }, uid));

  // ---------------------------------------------------------------- logística inversa
  await db.claim.create({ data: { code: "RMA-2026-001", customerId: cust.id, shipmentId: (await db.exportShipment.findUniqueOrThrow({ where: { code: "EMB-2026-H02" } })).id, lotCode: "DP-2026-010", type: "ROTURA", description: "12 frascos rotos en una caja al desconsolidar (demo)", jars: 12, status: "CERRADO", disposition: "NOTA_CREDITO", creditUsd: 25.2, resolution: "Nota de crédito y separadores reforzados en la siguiente paleta", openedAt: new Date("2026-09-15"), closedAt: new Date("2026-09-18") } });
  await setSequence(db as any, "RMA-2026", 1);
  const circ: [string, string, number, string, string][] = [
    ["2026-08-10", "SACO_REUTILIZADO", 24, "UND", "Clientes mayoristas (retorno de sacos)"], ["2026-09-12", "SACO_REUTILIZADO", 30, "UND", "Clientes mayoristas"],
    ["2026-09-30", "COMPOST", 420, "KG", "Compostera de planta"], ["2026-10-30", "COMPOST", 510, "KG", "Compostera de planta"],
    ["2026-10-05", "RECICLAJE_CARTON", 38, "KG", "Asociación de recicladores (convenio)"], ["2026-10-20", "RECICLAJE_VIDRIO", 6.5, "KG", "Asociación de recicladores (convenio)"],
    ["2026-10-22", "PALETA_RETORNABLE", 2, "UND", "Operador logístico (pool de paletas)"], ["2026-09-18", "PRODUCTO_DEVUELTO", 12, "UND", "RMA-2026-001 → reciclaje de vidrio"],
  ];
  for (const [date, type, q, unit, partner] of circ) await db.circularRecord.create({ data: { date: new Date(date), type, quantity: q, unit, partner } });

  // ---------------------------------------------------------------- Responsabilidad Social
  for (const [code, axis, name, budget, source, cls, responsible, stage, gri] of RS_PROJECTS) {
    const [y1, y2] = splitYears(code, budget);
    const progress = stage === 1 ? 35 + (code.charCodeAt(code.length - 1) % 5) * 10 : stage === 2 ? 10 : 0;
    await db.rsProject.upsert({ where: { code }, create: { code, axis, name, budgetPen: budget, year1Pen: y1, year2Pen: y2, executedPen: Math.round(budget * progress / 100 * 0.9), source, expenseClass: cls, responsible, stage, progressPct: progress, status: progress >= 100 ? "COMPLETADO" : progress > 0 ? "EN_CURSO" : "PLANIFICADO", gri }, update: {} });
  }
  const current: Record<string, number> = { "RS-E1": 2, "RS-A1": 2.15, "RS-A3": 1.12, "RS-S1": 6, "RS-S3": 22, "RS-T1": 40, "RS-T2": 1, "RS-T3": 0 };
  for (const [code, axis, name, unit, baseline, t12, t24, lower, responsible, source] of RS_INDICATORS) {
    await db.rsIndicator.upsert({ where: { code }, create: { code, axis, name, unit, baseline, target12: t12, target24: t24, current: current[code] ?? null, lowerIsBetter: lower, responsible, source }, update: {} });
  }
  return { pack: { lot: pack.lot.code, pallets: pack.palletList.map((p) => p.sscc) } };
}
