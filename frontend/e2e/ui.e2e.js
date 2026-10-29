/**
 * Prueba E2E de la interfaz con Playwright (requiere API, frontend y Hardhat en ejecución).
 *   node e2e/ui.e2e.js            (BASE_URL=http://localhost:3000 por defecto)
 * Reinicia la demostración: NO ejecutar contra datos que se quieran conservar.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), "dp-e2e-"));
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error("FALLO: " + m); passed++; console.log("  ✓", m); };

async function login(p, email) {
  await p.goto(`${BASE}/login`);
  await p.fill("input[type=email]", email);
  await p.fill("input[type=password]", process.env.E2E_PASSWORD || "DonPimenton#2026");
  await p.click("button[type=submit]");
  await p.waitForURL(`${BASE}/`);
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));

  console.log("E2E-1 Inicio de sesión");
  await p.goto(`${BASE}/login`);
  await p.fill("input[type=email]", "admin@donpimenton.pe");
  await p.fill("input[type=password]", "incorrecta");
  await p.click("button[type=submit]");
  await p.waitForSelector("text=Correo o contraseña incorrectos");
  assert(true, "credenciales inválidas rechazadas");
  await login(p, "admin@donpimenton.pe");
  assert(true, "login válido redirige al dashboard");

  console.log("E2E-2 Escenario integral desde la interfaz");
  await p.goto(`${BASE}/demo`);
  await p.click("text=Reiniciar demostración");
  await p.fill("div[role=dialog] input", "REINICIAR");
  await p.click('div[role=dialog] button:has-text("Reiniciar")');
  await p.waitForSelector("text=Demostración reiniciada", { timeout: 60000 });
  assert(true, "reinicio de la demostración");
  await p.click("text=Ejecutar demostración completa");
  await p.waitForSelector("text=Escenario completado", { timeout: 180000 });
  const oks = await p.locator("li .bg-agro").count();
  assert(oks === 18, `18 pasos completados (${oks})`);
  const dl = p.waitForEvent("download");
  await p.click("text=Descargar reporte de trazabilidad (PDF)");
  const file = path.join(OUT, "trazabilidad.pdf");
  await (await dl).saveAs(file);
  assert(fs.readFileSync(file).subarray(0, 4).toString() === "%PDF", "PDF de trazabilidad descargado");
  for (const n of ["Lote rechazado", "Entrega no confirmada", "Usuario no autorizado"]) {
    const card = p.locator("div.rounded-2xl", { has: p.locator(`h3:text-is("${n}")`) }).first();
    await card.locator('button:has-text("Ejecutar")').click();
    await card.locator("text=Comportamiento esperado verificado").waitFor({ timeout: 90000 });
    assert(true, `escenario negativo "${n}" bloqueado correctamente`);
  }
  await p.screenshot({ path: path.join(OUT, "demo.png"), fullPage: true });

  console.log("E2E-3 Verificación blockchain");
  await p.goto(`${BASE}/blockchain`);
  await p.click('button:has-text("Verificar lote")');
  await p.click('button:text-is("Verificar")');
  await p.waitForSelector("text=ÍNTEGRO");
  assert(true, "lote DP-2026-001 verificado como íntegro");

  console.log("E2E-4 Formularios con validación y persistencia");
  await p.goto(`${BASE}/agricultura`);
  await p.click("text=Nueva campaña");
  const dlg = p.locator("div[role=dialog]");
  await dlg.locator('button:has-text("Guardar")').click();
  await p.waitForSelector("text=Campo obligatorio");
  assert(true, "campos obligatorios validados");
  await dlg.locator("select").first().selectOption({ index: 1 });
  await dlg.locator("input").nth(0).fill("Papri King");
  await dlg.locator("input[type=date]").nth(0).fill("2026-10-01");
  await dlg.locator("input[type=date]").nth(1).fill("2027-03-15");
  await dlg.locator("input[type=number]").fill("1500");
  await dlg.locator('button:has-text("Guardar")').click();
  await p.waitForURL(/agricultura\/campanas\/\d+/);
  await p.reload();
  await p.waitForSelector("text=Papri King");
  assert(true, "campaña creada y persistida tras recargar");

  console.log("E2E-5 Permisos en la interfaz");
  const a = await (await b.newContext()).newPage();
  await login(a, "auditor@donpimenton.pe");
  await a.goto(`${BASE}/calidad`); await a.waitForTimeout(2500);
  assert(await a.locator('button:has-text("Inspeccionar")').count() === 0, "auditor no ve acciones de calidad");
  await a.goto(`${BASE}/ventas`); await a.waitForTimeout(2500);
  assert(await a.locator('button:has-text("Nuevo pedido")').count() === 0, "auditor no ve 'Nuevo pedido'");
  const g = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login(g, "agricola@donpimenton.pe");
  const nav = await g.locator("aside nav").first().innerText();
  assert(nav.includes("Campo y cosechas") && !nav.includes("Finanzas") && !nav.includes("Smart Contract"), "responsable agrícola solo ve sus módulos");
  assert((await g.locator("header").innerText()).includes("Área Agrícola y Mantenimiento"), "los puestos se muestran por área, sin nombre de persona");

  console.log("E2E-6 Diseño de Gerencia: bienvenida, organigrama, marketing y Smart Contract");
  await p.goto(`${BASE}/`);
  await p.waitForSelector("text=¡Bienvenida, Martha!");
  assert(true, "bienvenida a Martha Torres en el dashboard");
  await p.waitForSelector("text=Cadena productiva"); await p.waitForSelector("text=Estado por área");
  assert(true, "dashboard con cadena productiva y estado por área");
  await p.goto(`${BASE}/organigrama`);
  await p.waitForSelector("text=Titular: Sra. Martha Torres");
  assert(true, "organigrama con la Gerencia General");
  await p.goto(`${BASE}/marketing`);
  await p.waitForSelector("text=Lanzamiento de marca Don Pimentón");
  assert(true, "módulo de marketing con campañas");
  await p.goto(`${BASE}/smart-contract`);
  await p.click('a:has-text("Smart Contract")  >> nth=-1');
  await p.waitForURL(/\/blockchain$/);
  assert(true, "el botón Smart Contract abre el panel blockchain real");

  console.log("E2E-7 Responsive y modo oscuro");
  const mp = await (await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" })).newPage();
  await login(mp, "gerencia@donpimenton.pe"); await mp.waitForTimeout(3000);
  assert(await mp.evaluate(() => document.documentElement.classList.contains("dark")), "modo oscuro aplicado");
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= 400), "sin desplazamiento horizontal en móvil");
  await mp.screenshot({ path: path.join(OUT, "mobile-dark.png") });

  assert(errors.length === 0, `sin errores JavaScript en página (${errors.join(" | ")})`);
  console.log(`\n${passed} verificaciones E2E superadas. Capturas en ${OUT}`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
