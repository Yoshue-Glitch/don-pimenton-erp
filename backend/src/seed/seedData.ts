/**
 * Datos de DEMOSTRACIÓN (ficticios). El histórico se genera con los mismos
 * servicios de negocio que usa la API, para que inventarios, kardex, costos y
 * cuentas por cobrar sean coherentes entre sí.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { inTx } from "../lib/prisma";
import { PERMISSIONS, ROLES } from "../auth/permissions";
import { setSequence } from "../lib/sequence";
import { registerHarvest, sendHarvestToProcessing } from "../modules/agriculture";
import { createProductionOrder, advanceStage, completeOrder } from "../modules/production";
import { createInspection, decideInspection } from "../modules/quality";
import { createSalesOrder, collectReceivable } from "../modules/sales";
import { createDispatch, advanceDispatch } from "../modules/logistics";
import { applyMovement } from "../modules/inventory.service";

// En un despliegue público defina DEMO_PASSWORD para no usar la contraseña documentada.
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "DonPimenton#2026";

export const DEMO_USERS = [
  { email: "admin@donpimenton.pe", name: "Ana Torres (Administradora)", role: "ADMIN", area: "GER" },
  { email: "gerencia@donpimenton.pe", name: "Rosa Huamán (Gerente General)", role: "GERENCIA", area: "GER" },
  { email: "agricola@donpimenton.pe", name: "Julio Quispe (Agrícola)", role: "AGRICOLA", area: "AGR" },
  { email: "produccion@donpimenton.pe", name: "Carmen Flores (Producción)", role: "PRODUCCION", area: "PRO" },
  { email: "calidad@donpimenton.pe", name: "Luis Mamani (Calidad)", role: "CALIDAD", area: "PRO" },
  { email: "almacen@donpimenton.pe", name: "Pedro Ccama (Almacén)", role: "ALMACEN", area: "COM" },
  { email: "comercial@donpimenton.pe", name: "María Condori (Comercial)", role: "COMERCIAL", area: "COM" },
  { email: "finanzas@donpimenton.pe", name: "Jorge Salas (Finanzas)", role: "FINANZAS", area: "FIN" },
  { email: "exportaciones@donpimenton.pe", name: "Lucía Paredes (Exportaciones)", role: "EXPORTACIONES", area: "EXP" },
  { email: "auditor@donpimenton.pe", name: "Raúl Medina (Auditor)", role: "AUDITOR", area: null },
];

const AREAS = [
  { code: "GER", name: "Gerencia General", projected: false },
  { code: "AGR", name: "Área Agrícola y Mantenimiento", projected: false },
  { code: "PRO", name: "Área de Procesamiento y Calidad", projected: false },
  { code: "COM", name: "Área Comercial y Logística", projected: false },
  { code: "FIN", name: "Administración y Finanzas", projected: true },
  { code: "RRHH", name: "Recursos Humanos", projected: true },
  { code: "EXP", name: "Departamento de Exportaciones", projected: true },
  { code: "SOC", name: "Gestión de socios comerciales internacionales", projected: true },
];

/** Seguridad: áreas, permisos, roles y usuarios (idempotente, no borra sesiones ni auditoría). */
export async function seedSecurity(db: PrismaClient) {
  for (const a of AREAS) await db.area.upsert({ where: { code: a.code }, create: a, update: { name: a.name, projected: a.projected } });
  for (const p of PERMISSIONS) await db.permission.upsert({ where: { code: p.code }, create: p, update: { description: p.description, module: p.module, action: p.action } });
  const perms = await db.permission.findMany();
  for (const r of ROLES) {
    const role = await db.role.upsert({ where: { code: r.code }, create: { code: r.code, name: r.name, description: r.description }, update: { name: r.name, description: r.description } });
    const existing = await db.rolePermission.count({ where: { roleId: role.id } });
    if (existing === 0) await db.rolePermission.createMany({ data: perms.filter((p) => r.permissions.includes(p.code)).map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  for (const u of DEMO_USERS) {
    const role = await db.role.findUniqueOrThrow({ where: { code: u.role } });
    const area = u.area ? await db.area.findUnique({ where: { code: u.area } }) : null;
    await db.user.upsert({ where: { email: u.email }, create: { email: u.email, name: u.name, passwordHash: hash, roleId: role.id, areaId: area?.id }, update: {} });
  }
}

const BUSINESS_TABLES = [
  "BlockchainEvent", "BlockchainTransaction", "SmartAgreement", "ChainDeployment", "DemoRun", "IdempotencyKey", "Sequence",
  "ExportRequirement", "ExportOrder", "ExportPartner", "DispatchOrder", "Vehicle", "Carrier", "SalesDocument", "InventoryReservation",
  "SalesOrderItem", "SalesOrder", "SalesQuoteItem", "SalesQuote", "FinancialTransaction", "AccountReceivable", "AccountPayable", "GoodsReceipt",
  "PurchaseOrderItem", "PurchaseOrder", "SupplierQuote", "PurchaseRequestItem", "PurchaseRequest", "Supplier", "InventoryAdjustment",
  "InventoryMovement", "InventoryBalance", "QualityInspection", "QualitySpec", "Document", "ProductionStage", "ProductionOrder", "Lot",
  "Harvest", "AgriActivity", "Campaign", "Parcel", "Customer", "WarehouseLocation", "Warehouse", "Product", "Budget", "ExchangeRate",
  "TrainingParticipant", "Training", "Evaluation", "LeaveRequest", "Attendance", "WorkerContract", "Worker",
];

export async function resetBusinessData(db: PrismaClient) {
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${BUSINESS_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

const d = (s: string) => new Date(s);

export async function seedBaseData(db: PrismaClient) {
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@donpimenton.pe" } });
  const uid = admin.id;
  const area = async (code: string) => (await db.area.findUniqueOrThrow({ where: { code } })).id;

  // ---------------------------------------------------------- catálogo
  await db.warehouse.createMany({ data: [
    { code: "ALM-MP", name: "Almacén de materia prima (recepción)", address: "Planta Don Pimentón — Arequipa (demo)" },
    { code: "ALM-PT", name: "Almacén de producto terminado", address: "Planta Don Pimentón — Arequipa (demo)" },
    { code: "ALM-INS", name: "Almacén de insumos y empaques", address: "Planta Don Pimentón — Arequipa (demo)" },
  ] });
  const wh = Object.fromEntries((await db.warehouse.findMany()).map((w) => [w.code, w.id]));
  await db.warehouseLocation.createMany({ data: [
    { warehouseId: wh["ALM-PT"], code: "A-01", name: "Rack A — nivel 1" }, { warehouseId: wh["ALM-PT"], code: "Q-01", name: "Zona de cuarentena" },
    { warehouseId: wh["ALM-MP"], code: "REC", name: "Patio de recepción" }, { warehouseId: wh["ALM-INS"], code: "E-01", name: "Estante de insumos" },
  ] });
  await db.product.createMany({ data: [
    { code: "MP-PIM-FRESCO", name: "Pimentón fresco (materia prima)", type: "MATERIA_PRIMA", unit: "KG", standardCost: 1.2 },
    { code: "PT-PAP-MOL-25", name: "Páprika deshidratada y molida — saco 25 kg", type: "PRODUCTO_TERMINADO", unit: "KG", bagWeightKg: 25, minStock: 100, standardCost: 9.5, salePricePerKg: 15 },
    { code: "INS-FERT-NPK", name: "Fertilizante NPK 20-20-20", type: "INSUMO", unit: "KG", minStock: 100, standardCost: 4.8 },
    { code: "INS-BIO-CTRL", name: "Bioinsecticida (control biológico)", type: "INSUMO", unit: "L", minStock: 50, standardCost: 38 },
    { code: "EMP-SACO-25", name: "Saco de polipropileno laminado 25 kg", type: "EMPAQUE", unit: "UND", minStock: 50, standardCost: 2 },
  ] });
  const prod = Object.fromEntries((await db.product.findMany()).map((p) => [p.code, p.id]));

  // ---------------------------------------------------------- personas y terceros
  const workers = [
    ["Julio", "Quispe Apaza", "40111111", "AGR", "Responsable agrícola", "2018-03-01", "INDEFINIDO", 2200, false],
    ["Carmen", "Flores Ticona", "40222222", "PRO", "Jefa de planta", "2019-01-15", "INDEFINIDO", 2400, false],
    ["Luis", "Mamani Choque", "40333333", "PRO", "Analista de calidad", "2020-07-01", "INDEFINIDO", 2300, false],
    ["Pedro", "Ccama Huanca", "40444444", "COM", "Almacenero", "2021-02-01", "PLAZO_FIJO", 1600, false],
    ["María", "Condori Vilca", "40555555", "COM", "Ejecutiva comercial", "2019-09-01", "INDEFINIDO", 2500, false],
    ["Rosa", "Huamán Paz", "40666666", "GER", "Gerente general", "2015-01-01", "INDEFINIDO", 4500, false],
    ["Hugo", "Arce Lima", "40777777", "PRO", "Operario de secado", "2022-04-01", "PLAZO_FIJO", 1400, false],
    ["Elena", "Ramos Cutipa", "40888888", "AGR", "Operaria de campo", "2023-05-01", "PLAZO_FIJO", 1300, false],
    ["Marco", "Puma Roque", "41000001", "AGR", "Cosechador temporal", "2026-09-15", "TEMPORAL_COSECHA", 1130, true],
    ["Sonia", "Yupanqui Gómez", "41000002", "AGR", "Cosechadora temporal", "2026-09-15", "TEMPORAL_COSECHA", 1130, true],
    ["Iván", "Turpo Mendoza", "41000003", "AGR", "Cosechador temporal", "2026-09-15", "TEMPORAL_COSECHA", 1130, true],
    ["Nadia", "Laura Quispe", "41000004", "PRO", "Seleccionadora temporal", "2026-09-20", "TEMPORAL_COSECHA", 1130, true],
  ] as const;
  for (const [i, w] of workers.entries()) {
    await db.worker.create({ data: { code: `TRB-${String(i + 1).padStart(4, "0")}`, firstName: w[0], lastName: w[1], documentNumber: w[2], areaId: await area(w[3]), position: w[4], hireDate: d(w[5]), contractType: w[6], monthlySalary: w[7], isTemporary: w[8], phone: "9" + w[2], email: `${w[0].toLowerCase()}.demo@example.com`, contracts: { create: { type: w[6], startDate: d(w[5]), salary: w[7] } } } });
  }
  await setSequence(db as any, "TRB", workers.length);
  const wk = await db.worker.findMany({ orderBy: { id: "asc" } });

  await db.parcel.createMany({ data: [
    { code: "PAR-001", name: "Lote Majes A", location: "Valle de Majes, Caylloma, Arequipa (demo)", areaHa: 2.5, cropType: "Pimentón / páprika", responsibleId: wk[0].id, status: "ACTIVA" },
    { code: "PAR-002", name: "Lote Majes B", location: "Valle de Majes, Caylloma, Arequipa (demo)", areaHa: 1.8, cropType: "Pimentón / páprika", responsibleId: wk[0].id, status: "ACTIVA" },
    { code: "PAR-003", name: "Lote La Joya", location: "La Joya, Arequipa (demo)", areaHa: 1.2, cropType: "Pimentón / páprika", responsibleId: wk[7].id, status: "EN_DESCANSO" },
  ] });
  await setSequence(db as any, "PAR", 3);
  const parcel = Object.fromEntries((await db.parcel.findMany()).map((p) => [p.code, p.id]));

  await db.customer.createMany({ data: [
    { code: "CLI-0001", type: "NACIONAL", documentType: "RUC", documentNumber: "20999000001", name: "Distribuidora Andina Demo", contact: "Compras (ficticio)", city: "Arequipa", address: "Av. Ficticia 123, Arequipa", creditDays: 15, chainActor: "buyer" },
    { code: "CLI-0002", type: "NACIONAL", documentType: "RUC", documentNumber: "20999000002", name: "Comercial El Altiplano Demo E.I.R.L.", city: "Arequipa", creditDays: 7 },
    { code: "CLI-0003", type: "NACIONAL", documentType: "RUC", documentNumber: "10999000003", name: "Especias Misti Demo", city: "Arequipa", creditDays: 0 },
    { code: "CLI-0004", type: "NACIONAL", documentType: "RUC", documentNumber: "20999000004", name: "Mayorista Avelino Demo S.A.C.", city: "Arequipa", creditDays: 30 },
    { code: "CLI-0005", type: "INTERNACIONAL", documentType: "TAX_ID", documentNumber: "DE999000005", name: "Gewürz Handel Demo GmbH", city: "Hamburgo", country: "Alemania", creditDays: 30 },
    { code: "CLI-0006", type: "INTERNACIONAL", documentType: "TAX_ID", documentNumber: "MX999000006", name: "Especias del Norte Demo S.A. de C.V.", city: "Monterrey", country: "México", creditDays: 45 },
  ] });
  await setSequence(db as any, "CLI", 6);
  const cust = Object.fromEntries((await db.customer.findMany()).map((c) => [c.code, c.id]));

  await db.qualitySpec.createMany({ data: [
    { productId: prod["PT-PAP-MOL-25"], parameter: "HUMEDAD", maxValue: 11, unit: "%", notes: "Especificación interna de DEMOSTRACIÓN" },
    { productId: prod["PT-PAP-MOL-25"], parameter: "COLOR_ASTA", minValue: 100, unit: "ASTA", notes: "Especificación interna de DEMOSTRACIÓN" },
    { productId: prod["PT-PAP-MOL-25"], parameter: "GRANULOMETRIA", minValue: 95, unit: "% pasa malla 40", notes: "Especificación interna de DEMOSTRACIÓN" },
    { productId: prod["PT-PAP-MOL-25"], customerId: cust["CLI-0001"], parameter: "COLOR_ASTA", minValue: 110, unit: "ASTA", notes: "Requisito del cliente (ficticio)" },
    { productId: prod["PT-PAP-MOL-25"], customerId: cust["CLI-0005"], parameter: "COLOR_ASTA", minValue: 120, unit: "ASTA", notes: "Requisito del cliente internacional (ficticio)" },
    { productId: prod["PT-PAP-MOL-25"], customerId: cust["CLI-0005"], parameter: "HUMEDAD", maxValue: 10, unit: "%", notes: "Requisito del cliente internacional (ficticio)" },
  ] });

  await db.supplier.createMany({ data: [
    { ruc: "20999100001", name: "Agroinsumos Sur Demo S.A.C.", category: "Fertilizantes", contact: "Ventas (ficticio)", phone: "054-000001" },
    { ruc: "20999100002", name: "BioControl Andino Demo", category: "Control biológico", phone: "054-000002" },
    { ruc: "20999100003", name: "Envases Arequipa Demo S.R.L.", category: "Empaques", phone: "054-000003" },
    { ruc: "20999100004", name: "Plásticos del Pacífico Demo S.A.", category: "Empaques", phone: "01-0000004" },
  ] });
  const sup = Object.fromEntries((await db.supplier.findMany()).map((s) => [s.ruc, s.id]));

  const carrier = await db.carrier.create({ data: { ruc: "20999200001", name: "Transportes Misti Demo S.A.C.", phone: "959000001", vehicles: { create: [{ plate: "V1A-123", type: "Camión 5 t", capacityKg: 5000 }, { plate: "V2B-456", type: "Furgón 1.5 t", capacityKg: 1500 }] } } });
  await db.exportPartner.createMany({ data: [
    { name: "Agroexport Sur Demo S.A.C.", ruc: "20999300001", country: "Perú", services: "Acopio, consolidación y exportación (exportación indirecta)", contact: "Comercio exterior (ficticio)" },
    { name: "Agencia de Aduanas Ficticia Demo", ruc: "20999300002", country: "Perú", services: "Despacho aduanero, documentación" },
  ] });

  for (const [date, rate] of [["2026-07-01", 3.58], ["2026-08-01", 3.55], ["2026-09-01", 3.52], ["2026-10-01", 3.5], ["2026-10-26", 3.49]] as const) {
    await db.exchangeRate.create({ data: { date: d(date), currency: "USD", rate, source: "Manual (demo) — validar con fuente oficial" } });
  }
  for (let m = 1; m <= 12; m++) {
    await db.budget.createMany({ data: [
      { year: 2026, month: m, category: "VENTAS", type: "INGRESO", amountPen: 14000 },
      { year: 2026, month: m, category: "COSTOS_OPERATIVOS", type: "EGRESO", amountPen: 9000 },
    ] });
  }

  // ---------------------------------------------------------- stock inicial de insumos
  await inTx(async (tx) => {
    for (const [code, qty, cost] of [["INS-FERT-NPK", 500, 4.8], ["INS-BIO-CTRL", 40, 38], ["EMP-SACO-25", 120, 2]] as const) {
      await applyMovement(tx, { type: "ENTRADA", productId: prod[code], warehouseId: wh["ALM-INS"], quantityKg: qty, unitCost: cost, reason: "Saldo inicial de demostración", referenceType: "SALDO_INICIAL", referenceCode: "SI-2025", userId: uid, at: d("2025-11-01") });
    }
  });

  // ---------------------------------------------------------- histórico de producción y ventas
  const campaigns = [
    { code: "CAM-2025-001", parcel: "PAR-002", variety: "Papri King", sow: "2025-05-20", est: "2025-11-15", yieldKg: 4500 },
    { code: "CAM-2025-002", parcel: "PAR-001", variety: "Papri King", sow: "2025-09-01", est: "2026-02-20", yieldKg: 5000 },
    { code: "CAM-2026-001", parcel: "PAR-002", variety: "Sonora", sow: "2026-01-10", est: "2026-07-01", yieldKg: 7000 },
  ];
  const campId: Record<string, number> = {};
  for (const c of campaigns) {
    const camp = await db.campaign.create({ data: { code: c.code, parcelId: parcel[c.parcel], variety: c.variety, sowingDate: d(c.sow), estHarvestDate: d(c.est), estimatedYieldKg: c.yieldKg, status: "EN_CURSO" } });
    campId[c.code] = camp.id;
    const base = new Date(c.sow);
    const acts: [any, number, string, number][] = [["SIEMBRA", 0, "Trasplante", 900], ["RIEGO", 30, "Riego por gravedad", 450], ["FERTILIZACION", 50, "Fertilización NPK", 1100], ["CONTROL_PLAGAS", 80, "Control biológico", 600], ["MANTENIMIENTO", 100, "Deshierbo y mantenimiento de canales", 500]];
    for (const [type, off, desc, cost] of acts) {
      const date = new Date(base.getTime() + off * 86400000);
      const a = await db.agriActivity.create({ data: { campaignId: camp.id, type, date, description: desc, responsible: "Julio Quispe", cost } });
      await db.financialTransaction.create({ data: { code: `FIN-H-${camp.id}-${a.id}`, type: "EGRESO", category: "COSTO_AGRICOLA", date, description: `${type} — ${c.code}: ${desc}`, amount: cost, amountPen: cost, campaignId: camp.id, referenceType: "AGRI_ACTIVITY", referenceCode: `${c.code}#${a.id}`, userId: uid } });
    }
  }

  type Batch = { camp: string; raw: string; lot: string; date: string; rawKg: number; finalKg: number; approve: boolean; sales: [string, number, number, string, boolean][] };
  // sales: [cliente, sacos, precio por kg, fecha, cobrado]
  const batches: Batch[] = [
    { camp: "CAM-2025-001", raw: "MP-2025-021", lot: "DP-2025-021", date: "2025-11-10", rawKg: 2400, finalKg: 475, approve: true, sales: [["CLI-0002", 8, 14.5, "2025-11-25", true], ["CLI-0004", 10, 14.8, "2025-12-03", true]] },
    { camp: "CAM-2025-001", raw: "MP-2025-022", lot: "DP-2025-022", date: "2025-12-06", rawKg: 2000, finalKg: 400, approve: true, sales: [["CLI-0003", 6, 15, "2025-12-20", true], ["CLI-0002", 10, 14.5, "2026-01-12", true]] },
    { camp: "CAM-2025-002", raw: "MP-2026-011", lot: "DP-2026-011", date: "2026-02-15", rawKg: 2600, finalKg: 525, approve: true, sales: [["CLI-0004", 12, 15, "2026-03-02", true], ["CLI-0001", 9, 15, "2026-03-18", true]] },
    { camp: "CAM-2025-002", raw: "MP-2026-012", lot: "DP-2026-012", date: "2026-03-20", rawKg: 2200, finalKg: 450, approve: true, sales: [["CLI-0002", 10, 15.2, "2026-04-08", true], ["CLI-0003", 8, 15.5, "2026-05-06", true]] },
    { camp: "CAM-2026-001", raw: "MP-2026-013", lot: "DP-2026-013", date: "2026-06-18", rawKg: 2500, finalKg: 500, approve: false, sales: [] },
    { camp: "CAM-2026-001", raw: "MP-2026-014", lot: "DP-2026-014", date: "2026-07-25", rawKg: 2300, finalKg: 475, approve: true, sales: [["CLI-0004", 9, 15, "2026-08-10", true], ["CLI-0001", 6, 15, "2026-09-02", true]] },
    { camp: "CAM-2026-001", raw: "MP-2026-015", lot: "DP-2026-015", date: "2026-09-05", rawKg: 2000, finalKg: 400, approve: true, sales: [["CLI-0002", 5, 15.5, "2026-09-22", true], ["CLI-0004", 4, 15.5, "2026-10-12", false]] },
  ];
  let opN = 0;
  for (const b of batches) {
    const harvestDate = d(b.date);
    const { harvest, lot: raw } = await inTx((tx) => registerHarvest(tx, campId[b.camp], { date: harvestDate, quantityKg: b.rawKg, lotCode: b.raw }, uid));
    await inTx((tx) => sendHarvestToProcessing(tx, harvest.id, uid));
    const start = new Date(harvestDate.getTime() + 86400000);
    const order = await inTx((tx) => createProductionOrder(tx, { sourceLotId: raw.id, initialWeightKg: b.rawKg, startDate: start, code: `OP-${start.getFullYear()}-${String(++opN).padStart(4, "0")}` }, uid));
    const seq = [b.rawKg * 0.96, b.rawKg * 0.95, b.finalKg * 1.06, b.finalKg * 1.02, b.finalKg * 1.01, b.finalKg];
    for (const [i, out] of seq.entries()) {
      const at = new Date(start.getTime() + (i + 1) * 86400000);
      await inTx((tx) => advanceStage(tx, order.id, { outputKg: Math.round(out), at, ...(i === 2 ? { temperatureC: 58 + (opN % 4), durationH: 28 + (opN % 5) } : {}) }, uid));
    }
    const end = new Date(start.getTime() + 8 * 86400000);
    await inTx((tx) => completeOrder(tx, order.id, { finalWeightKg: b.finalKg, outputs: [{ quantityKg: b.finalKg, code: b.lot }], laborCost: Math.round(b.finalKg * 2.2), energyCost: Math.round(b.finalKg * 1.9), packagingCost: (b.finalKg / 25) * 2, otherCost: 60, expiryMonths: 18, at: end }, uid));
    const lot = await db.lot.findUniqueOrThrow({ where: { code: b.lot } });
    const qcAt = new Date(end.getTime() + 86400000);
    const insp = await inTx((tx) => createInspection(tx, b.approve
      ? { lotId: lot.id, date: qcAt, moisturePct: 8.8 + (opN % 5) * 0.4, astaColor: 112 + opN * 3, granulometry: 96.5 + (opN % 3), granulometryMesh: "Malla 40 (425 µm)", microbiological: "CONFORME", contaminants: "CONFORME" }
      : { lotId: lot.id, date: qcAt, moisturePct: 13.1, astaColor: 92, granulometry: 94, granulometryMesh: "Malla 40 (425 µm)", microbiological: "CONFORME", contaminants: "CONFORME", observations: "Humedad y color fuera de especificación (demo)" }, uid));
    await inTx((tx) => decideInspection(tx, insp.id, { status: b.approve ? "APROBADO" : "RECHAZADO", at: qcAt }, uid));

    for (const [cli, sacks, price, date, paid] of b.sales) {
      const at = d(date);
      const so = await inTx((tx) => createSalesOrder(tx, { customerId: cust[cli], date: at, currency: "PEN", taxCode: "IGV", priceIncludesTax: true, items: [{ productId: prod["PT-PAP-MOL-25"], lotId: lot.id, unit: "SACO", quantity: sacks, unitPrice: price * 25, discountPct: 0 }] }, uid));
      const vehicle = await db.vehicle.findFirstOrThrow({ where: { carrierId: carrier.id } });
      const disp = await inTx((tx) => createDispatch(tx, { salesOrderId: so.id, carrierId: carrier.id, vehicleId: vehicle.id, destination: "Arequipa (demo)" }, uid));
      const t1 = new Date(at.getTime() + 86400000);
      await inTx((tx) => advanceDispatch(tx, disp.id, { status: "DESPACHADO", at: t1 }, uid));
      await inTx((tx) => advanceDispatch(tx, disp.id, { status: "EN_TRANSITO", at: t1 }, uid));
      await inTx((tx) => advanceDispatch(tx, disp.id, { status: "ENTREGADO", at: t1, receivedBy: "Encargado de recepción (ficticio)" }, uid));
      if (paid) {
        const ar = await db.accountReceivable.findFirstOrThrow({ where: { salesOrderId: so.id } });
        await inTx((tx) => collectReceivable(tx, ar.id, { amount: Number(ar.amount), date: new Date(at.getTime() + 10 * 86400000), method: "Transferencia bancaria (demo)", reference: `OPE-${so.code}`, simulated: false }, uid));
      }
    }
  }
  // Correlativos para que los registros nuevos no colisionen con los reservados a la demostración (DP-2026-001…003)
  await setSequence(db as any, "DP-2026", 20);
  await setSequence(db as any, "MP-2026", 20);
  await setSequence(db as any, "OP-2026", 20);
  await setSequence(db as any, "OP-2025", 20);
  await setSequence(db as any, "CAM-2025", 2);
  await setSequence(db as any, "CAM-2026", 1);

  // Gastos generales mensuales (demo)
  for (let i = 0; i < 12; i++) {
    const date = new Date(2025, 10 + i, 28);
    if (date > new Date()) break;
    for (const [cat, desc, amount] of [["SERVICIOS", "Energía eléctrica planta (demo)", 650], ["ADMINISTRACION", "Servicios contables externos (demo)", 800], ["PLANILLA", "Planilla de personal permanente (demo)", 9500]] as const) {
      await db.financialTransaction.create({ data: { code: `FIN-G-${date.getFullYear()}${date.getMonth() + 1}-${cat}`, type: "EGRESO", category: cat, date, description: desc, amount, amountPen: amount, referenceType: "MANUAL", userId: uid } });
    }
  }

  // ---------------------------------------------------------- compras
  const agricola = await db.user.findUniqueOrThrow({ where: { email: "agricola@donpimenton.pe" } });
  const gerencia = await db.user.findUniqueOrThrow({ where: { email: "gerencia@donpimenton.pe" } });
  const req1 = await db.purchaseRequest.create({ data: { code: "SOL-2026-0001", requestedById: agricola.id, areaId: await area("AGR"), date: d("2026-08-20"), justification: "Fertilización de la campaña de verano", status: "ORDENADA", approvedById: gerencia.id, decidedAt: d("2026-08-21"), items: { create: [{ productId: prod["INS-FERT-NPK"], quantity: 300, estimatedPrice: 4.8 }] } } });
  const q1 = await db.supplierQuote.create({ data: { code: "CTP-2026-0001", requestId: req1.id, supplierId: sup["20999100001"], date: d("2026-08-20"), total: 1416, deliveryDays: 3, selected: true } });
  const po1 = await db.purchaseOrder.create({ data: { code: "OC-2026-0001", requestId: req1.id, supplierId: sup["20999100001"], quoteId: q1.id, date: d("2026-08-22"), subtotal: 1200, tax: 216, total: 1416, status: "PAGADA", conformityAt: d("2026-08-26"), items: { create: [{ productId: prod["INS-FERT-NPK"], quantity: 300, unitPrice: 4, receivedQty: 300 }] } } });
  await inTx((tx) => applyMovement(tx, { type: "ENTRADA", productId: prod["INS-FERT-NPK"], warehouseId: wh["ALM-INS"], quantityKg: 300, unitCost: 4, reason: "Recepción REC-2026-0001 de la OC OC-2026-0001", referenceType: "PURCHASE_ORDER", referenceCode: "OC-2026-0001", userId: uid, at: d("2026-08-25") }));
  await db.goodsReceipt.create({ data: { code: "REC-2026-0001", orderId: po1.id, warehouseId: wh["ALM-INS"], date: d("2026-08-25"), receivedBy: "Pedro Ccama", items: [] } });
  const ap = await db.accountPayable.create({ data: { code: "CXP-2026-0001", supplierId: sup["20999100001"], purchaseOrderId: po1.id, documentRef: "F001-000123 (demo)", issueDate: d("2026-08-26"), dueDate: d("2026-09-25"), amount: 1416, paidAmount: 1416, status: "PAGADA" } });
  await db.financialTransaction.create({ data: { code: "FIN-P-0001", type: "EGRESO", category: "PAGO_PROVEEDOR", date: d("2026-09-20"), description: "Pago CXP-2026-0001 (transferencia demo)", amount: 1416, amountPen: 1416, payableId: ap.id, referenceType: "PAGO", referenceCode: "CXP-2026-0001", userId: uid } });
  const req2 = await db.purchaseRequest.create({ data: { code: "SOL-2026-0002", requestedById: agricola.id, areaId: await area("PRO"), date: d("2026-10-20"), justification: "Reposición de sacos de 25 kg para la campaña actual", status: "EN_REVISION", items: { create: [{ productId: prod["EMP-SACO-25"], quantity: 500, estimatedPrice: 2 }, { productId: prod["INS-BIO-CTRL"], quantity: 30, estimatedPrice: 38 }] } } });
  await db.supplierQuote.createMany({ data: [
    { code: "CTP-2026-0002", requestId: req2.id, supplierId: sup["20999100003"], date: d("2026-10-21"), total: 2180, deliveryDays: 5, paymentTerms: "30 días" },
    { code: "CTP-2026-0003", requestId: req2.id, supplierId: sup["20999100004"], date: d("2026-10-21"), total: 1990, deliveryDays: 12, paymentTerms: "Contado" },
  ] });
  for (const [k, v] of [["SOL-2026", 2], ["CTP-2026", 3], ["OC-2026", 1], ["REC-2026", 1], ["CXP-2026", 1]] as const) await setSequence(db as any, k, v);

  // ---------------------------------------------------------- exportaciones (preparadas, sin ejecutar)
  const partner = await db.exportPartner.findFirstOrThrow({ where: { ruc: "20999300001" } });
  await db.exportOrder.create({ data: {
    code: "EXP-2026-0001", customerId: cust["CLI-0005"], partnerId: partner.id, mode: "INDIRECTA", destinationCountry: "Alemania", incoterm: "FOB", currency: "USD", exchangeRate: 3.5,
    productId: prod["PT-PAP-MOL-25"], netWeightKg: 2000, grossWeightKg: 2040, amount: 11600, logisticsCost: 650, status: "DOCUMENTACION", etd: d("2026-12-10"),
    notes: "Operación proyectada a través del socio exportador (demo)",
    requirements: { create: [
      { docType: "PACKING_LIST", name: "Packing list", mandatory: true }, { docType: "COA", name: "Certificado de análisis (COA) del lote", mandatory: true },
      { docType: "CERTIFICADO", name: "Certificados aplicables según destino (origen, fitosanitario u otros)", mandatory: true }, { docType: "CONTRATO", name: "Contrato / orden de compra con el socio exportador", mandatory: true },
    ] },
  } });
  await db.exportOrder.create({ data: {
    code: "EXP-2026-0002", customerId: cust["CLI-0006"], mode: "DIRECTA", destinationCountry: "México", incoterm: "CIF", currency: "USD", exchangeRate: 3.5,
    productId: prod["PT-PAP-MOL-25"], netWeightKg: 1000, grossWeightKg: 1020, amount: 6100, logisticsCost: 1200, status: "BORRADOR", notes: "Cotización exploratoria de exportación directa (demo)",
    requirements: { create: ["FACTURA_COMERCIAL", "PACKING_LIST", "COA", "CERTIFICADO", "DOC_TRANSPORTE", "DOC_ADUANERO"].map((t) => ({ docType: t as any, name: t.replace(/_/g, " ").toLowerCase(), mandatory: true })) },
  } });
  await setSequence(db as any, "EXP-2026", 2);

  // ---------------------------------------------------------- RR.HH.
  const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
  for (const w of wk) for (const [i, day] of days.entries()) {
    if (w.hireDate > d(day)) continue;
    await db.attendance.create({ data: { workerId: w.id, date: d(day), status: (w.id + i) % 11 === 0 ? "TARDANZA" : (w.id + i) % 17 === 0 ? "FALTA" : "PRESENTE", hours: 8 } });
  }
  await db.leaveRequest.createMany({ data: [
    { workerId: wk[3].id, type: "VACACIONES", startDate: d("2026-11-16"), endDate: d("2026-11-25"), days: 10, status: "PENDIENTE" },
    { workerId: wk[1].id, type: "VACACIONES", startDate: d("2026-08-03"), endDate: d("2026-08-14"), days: 12, status: "APROBADO" },
  ] });
  const t1 = await db.training.create({ data: { title: "Buenas Prácticas de Manufactura (BPM) en deshidratado", date: d("2026-06-12"), hours: 8, provider: "Capacitador externo (demo)", topic: "Inocuidad" } });
  const t2 = await db.training.create({ data: { title: "Cosecha y manipulación de pimentón", date: d("2026-09-16"), hours: 4, provider: "Área agrícola", topic: "Cosecha" } });
  await db.trainingParticipant.createMany({ data: [...[1, 2, 6].map((i) => ({ trainingId: t1.id, workerId: wk[i].id })), ...[0, 7, 8, 9, 10, 11].map((i) => ({ trainingId: t2.id, workerId: wk[i].id }))] });
  await db.evaluation.createMany({ data: [
    { workerId: wk[1].id, period: "2026-S1", score: 17, evaluator: "Rosa Huamán", comments: "Cumple metas de producción" },
    { workerId: wk[2].id, period: "2026-S1", score: 18, evaluator: "Rosa Huamán", comments: "Rigurosidad en control de calidad" },
    { workerId: wk[4].id, period: "2026-S1", score: 16, evaluator: "Rosa Huamán" },
  ] });
}
