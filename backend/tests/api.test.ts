import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app, login } from "./helpers";
import { prisma, inTx } from "../src/lib/prisma";
import { applyMovement } from "../src/modules/inventory.service";

describe("Autenticación y seguridad", () => {
  it("rechaza credenciales inválidas sin revelar si el usuario existe", async () => {
    const r = await request(app).post("/api/auth/login").set("X-Requested-With", "DonPimentonERP").send({ email: "admin@donpimenton.pe", password: "incorrecta" });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("Correo o contraseña incorrectos");
  });

  it("bloquea la cuenta tras 5 intentos fallidos", async () => {
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").set("X-Requested-With", "DonPimentonERP").send({ email: "exportaciones@donpimenton.pe", password: "mala" + i });
    const r = await request(app).post("/api/auth/login").set("X-Requested-With", "DonPimentonERP").send({ email: "exportaciones@donpimenton.pe", password: "DonPimenton#2026" });
    expect(r.status).toBe(423);
    await prisma.user.update({ where: { email: "exportaciones@donpimenton.pe" }, data: { failedAttempts: 0, lockedUntil: null } });
  });

  it("las contraseñas se almacenan con bcrypt (nunca en texto plano)", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "admin@donpimenton.pe" } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("requiere sesión y cabecera anti-CSRF", async () => {
    expect((await request(app).get("/api/dashboard")).status).toBe(401);
    const s = await login("admin@donpimenton.pe");
    const noHeader = await s.agent.post("/api/finance/transactions").send({});
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe("CSRF");
  });

  it("el cierre de sesión revoca el token", async () => {
    const s = await login("comercial@donpimenton.pe");
    expect((await s.get("/api/auth/me")).status).toBe(200);
    await s.post("/api/auth/logout");
    expect((await s.get("/api/auth/me")).status).toBe(401);
  });
});

describe("Permisos por rol", () => {
  it("cada rol ve solo sus módulos", async () => {
    const agr = await login("agricola@donpimenton.pe");
    const me = await agr.get("/api/auth/me");
    expect(me.body.modules).toContain("agricultura");
    expect(me.body.modules).not.toContain("finanzas");
    expect((await agr.get("/api/finance/transactions")).status).toBe(403);
  });

  it("el auditor es de solo lectura", async () => {
    const aud = await login("auditor@donpimenton.pe");
    expect((await aud.get("/api/inventory/balances")).status).toBe(200);
    expect((await aud.post("/api/quality/inspections/1/decision").send({ status: "APROBADO" })).status).toBe(403);
    expect((await aud.post("/api/finance/transactions").send({ type: "INGRESO", category: "X", date: "2026-10-01", description: "test", amount: 1 })).status).toBe(403);
    expect((await aud.post("/api/blockchain/agreements/SC-X/release").send({})).status).toBe(403);
  });

  it("una compra no puede ser aprobada sin permiso ni por su propio solicitante", async () => {
    const req = await prisma.purchaseRequest.findUniqueOrThrow({ where: { code: "SOL-2026-0002" } });
    const agr = await login("agricola@donpimenton.pe");
    expect((await agr.post(`/api/purchasing/requests/${req.id}/decision`).send({ approve: true })).status).toBe(403);
    const ger = await login("gerencia@donpimenton.pe");
    const ok = await ger.post(`/api/purchasing/requests/${req.id}/decision`).send({ approve: true, note: "Aprobado en prueba" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("APROBADA");
  });

  it("los datos personales de RR.HH. se enmascaran sin permiso sensible", async () => {
    const ger = await login("gerencia@donpimenton.pe");
    const aud = await login("auditor@donpimenton.pe");
    const full = (await ger.get("/api/hr/workers")).body.items[0];
    const masked = (await aud.get("/api/hr/workers")).body.items[0];
    expect(full.monthlySalary).not.toBeNull();
    expect(masked.monthlySalary).toBeNull();
    expect(masked.documentNumber).toMatch(/^••••/);
  });
});

describe("Inventario", () => {
  it("no permite stock negativo", async () => {
    const p = await prisma.product.findUniqueOrThrow({ where: { code: "INS-BIO-CTRL" } });
    const w = await prisma.warehouse.findUniqueOrThrow({ where: { code: "ALM-INS" } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@donpimenton.pe" } });
    await expect(inTx((tx) => applyMovement(tx, { type: "SALIDA", from: "availableKg", productId: p.id, warehouseId: w.id, quantityKg: 100000, reason: "prueba", referenceType: "TEST", referenceCode: "T", userId: admin.id })))
      .rejects.toThrow(/insuficiente/);
    // y la base de datos lo impide aunque se salte la lógica de negocio
    await expect(prisma.$executeRaw`UPDATE "InventoryBalance" SET "availableKg" = -1 WHERE "productId" = ${p.id}`).rejects.toThrow(/check constraint/);
  });

  it("los ajustes requieren autorización de otro usuario con permiso", async () => {
    const alm = await login("almacen@donpimenton.pe");
    const p = await prisma.product.findUniqueOrThrow({ where: { code: "EMP-SACO-25" } });
    const w = await prisma.warehouse.findUniqueOrThrow({ where: { code: "ALM-INS" } });
    const a = await alm.post("/api/inventory/adjustments").send({ productId: p.id, warehouseId: w.id, quantityKg: -2, reason: "Sacos dañados por humedad" });
    expect(a.status).toBe(201);
    expect((await alm.post(`/api/inventory/adjustments/${a.body.id}/decision`).send({ approve: true })).status).toBe(403);
    const ger = await login("gerencia@donpimenton.pe");
    const before = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: p.id } });
    expect((await ger.post(`/api/inventory/adjustments/${a.body.id}/decision`).send({ approve: true })).status).toBe(200);
    const after = await prisma.inventoryBalance.findFirstOrThrow({ where: { productId: p.id } });
    expect(Number(after.availableKg)).toBe(Number(before.availableKg) - 2);
  });

  it("el kardex registra usuario, motivo y documento de referencia", async () => {
    const m = await prisma.inventoryMovement.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(m.userId).toBeGreaterThan(0);
    expect(m.reason.length).toBeGreaterThan(3);
    expect(m.referenceCode.length).toBeGreaterThan(0);
  });
});

describe("Idempotencia", () => {
  it("una operación repetida con la misma clave no crea duplicados", async () => {
    const fin = await login("finanzas@donpimenton.pe");
    const body = { type: "EGRESO", category: "SERVICIOS", date: "2026-10-20", description: "Agua planta (prueba idempotencia)", amount: 120 };
    const r1 = await fin.post("/api/finance/transactions").set("Idempotency-Key", "test-key-1").send(body);
    const r2 = await fin.post("/api/finance/transactions").set("Idempotency-Key", "test-key-1").send(body);
    expect(r1.status).toBe(201);
    expect(r2.headers["idempotent-replay"]).toBe("true");
    expect(r2.body.code).toBe(r1.body.code);
    expect(await prisma.financialTransaction.count({ where: { description: body.description } })).toBe(1);
  });

  it("USD exige tipo de cambio", async () => {
    const fin = await login("finanzas@donpimenton.pe");
    const r = await fin.post("/api/finance/transactions").send({ type: "INGRESO", category: "OTROS", date: "2026-10-20", description: "Sin TC", amount: 10, currency: "USD" });
    expect(r.status).toBe(422);
  });
});

describe("Exportaciones", () => {
  it("no permite marcar requisitos como verificados sin evidencia", async () => {
    const exp = await login("exportaciones@donpimenton.pe");
    const req = await prisma.exportRequirement.findFirstOrThrow({ where: { exportOrder: { code: "EXP-2026-0001" } } });
    const r = await exp.post(`/api/exports/requirements/${req.id}/verify`).send({ status: "VERIFICADO" });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/evidencia/);
  });
});

describe("Correlativos", () => {
  it("los códigos nuevos no colisionan con los datos sembrados", async () => {
    const agr = await login("agricola@donpimenton.pe");
    const parcel = await prisma.parcel.findUniqueOrThrow({ where: { code: "PAR-001" } });
    const r = await agr.post("/api/agriculture/campaigns").send({ parcelId: parcel.id, variety: "Papri King", sowingDate: "2026-10-01", estHarvestDate: "2027-03-15", estimatedYieldKg: 1500 });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe("CAM-2026-002");
  });
});

describe("Identidades y nuevos módulos", () => {
  it("la Gerencia General es Martha Torres y el resto de puestos no tiene nombre de persona", async () => {
    const users = await prisma.user.findMany({ select: { email: true, name: true } });
    expect(users.find((u) => u.email === "admin@donpimenton.pe")?.name).toBe("Martha Torres");
    expect(users.find((u) => u.email === "agricola@donpimenton.pe")?.name).toBe("Área Agrícola y Mantenimiento");
    const named = await prisma.worker.findMany({ where: { firstName: { not: null } } });
    expect(named.map((w) => `${w.firstName} ${w.lastName}`)).toEqual(["Martha Torres"]);
  });

  it("el seed actualiza nombres en una base ya cargada sin reiniciar la demo", async () => {
    const { seedSecurity, syncDemoIdentities } = await import("../src/seed/seedData");
    await prisma.user.update({ where: { email: "admin@donpimenton.pe" }, data: { name: "Ana Torres (Administradora)" } });
    await prisma.worker.updateMany({ where: { documentNumber: "40111111" }, data: { firstName: "Julio", lastName: "Quispe" } });
    await seedSecurity(prisma as any);
    await syncDemoIdentities(prisma as any);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "admin@donpimenton.pe" } })).name).toBe("Martha Torres");
    expect((await prisma.worker.findUniqueOrThrow({ where: { documentNumber: "40111111" } })).firstName).toBeNull();
  });

  it("Marketing: lectura por rol, escritura solo con permiso", async () => {
    const exp = await login("exportaciones@donpimenton.pe");
    const list = await exp.get("/api/marketing/campaigns");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(7);
    const created = await exp.post("/api/marketing/campaigns").send({ name: "Degustación en supermercados", channel: "Feria", startDate: "2026-11-20", budgetPen: 600, status: "PLANIFICADA" });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("MKT-008");
    const sum = await exp.get("/api/marketing/summary");
    expect(sum.body.leads).toBe(202);
    const agr = await login("agricola@donpimenton.pe");
    expect((await agr.get("/api/marketing/campaigns")).status).toBe(403);
    const aud = await login("auditor@donpimenton.pe");
    expect((await aud.get("/api/marketing/campaigns")).status).toBe(200);
    expect((await aud.post("/api/marketing/campaigns").send({ name: "x", channel: "Web", startDate: "2026-11-01", budgetPen: 1 })).status).toBe(403);
  });

  it("organigrama y KPIs por módulo sin datos personales", async () => {
    const s = await login("produccion@donpimenton.pe");
    const org = await s.get("/api/dashboard/org");
    expect(org.status).toBe(200);
    expect(org.body.generalManager).toBe("Martha Torres");
    expect(org.body.areas.find((a: any) => a.code === "AGR").headcount).toBeGreaterThan(0);
    expect(JSON.stringify(org.body)).not.toMatch(/monthlySalary|documentNumber/);
    const k = await s.get("/api/dashboard/kpis/produccion");
    expect(k.status).toBe(200);
    expect(k.body).toHaveLength(4);
    expect((await s.get("/api/dashboard/kpis/compras")).status).toBe(200);
    const agr = await login("agricola@donpimenton.pe");
    expect((await agr.get("/api/dashboard/kpis/ventas")).status).toBe(403);
  });
});

describe("Dashboard", () => {
  it("calcula los KPI desde la base de datos", async () => {
    const s = await login("gerencia@donpimenton.pe");
    const r = await s.get("/api/dashboard");
    expect(r.status).toBe(200);
    const lots = await prisma.lot.aggregate({ where: { type: "PRODUCTO_TERMINADO" }, _sum: { quantityKg: true } });
    expect(r.body.kpis.produccionTotalKg).toBe(Number(lots._sum.quantityKg));
    expect(r.body.series).toHaveLength(12);
    expect(r.body.demoData).toBe(true);
    expect(r.body.overview.series).toHaveLength(6);
    const harvested = await prisma.harvest.aggregate({ _sum: { quantityKg: true } });
    expect(r.body.overview.funnel.cosechadoKg).toBe(Number(harvested._sum.quantityKg));
    expect(r.body.overview.workers.payrollPen).not.toBeNull(); // Gerencia tiene acceso a remuneraciones
  });
});
