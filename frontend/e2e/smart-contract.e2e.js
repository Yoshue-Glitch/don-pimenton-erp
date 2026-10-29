/**
 * E2E del apartado Smart Contract (ruta de exportación, modelos Word, evidencia, DUA).
 *   node e2e/smart-contract.e2e.js   (BASE_URL, E2E_PASSWORD opcionales)
 * Adjunta un documento a un requisito de la primera orden de exportación.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASS = process.env.E2E_PASSWORD || 'DonPimenton#2026';
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'dp-sc-'));
const ok = (c, m) => { if (!c) throw new Error('FALLO: ' + m); console.log('  ✓', m); };
async function login(p, email) {
  await p.goto(`${BASE}/login`); await p.fill('input[type=email]', email); await p.fill('input[type=password]', PASS);
  await p.click('button[type=submit]'); await p.waitForURL(`${BASE}/`);
}
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await login(p, 'exportaciones@donpimenton.pe');
  await p.goto(`${BASE}/smart-contract`); await p.waitForSelector('text=De los documentos al contrato inteligente');
  ok(true, 'resumen con mapa documento → función del contrato');
  await p.screenshot({ path: OUT + '/resumen.png', fullPage: true });
  await p.click('button:has-text("Ruta de exportación (18 pasos)")');
  await p.waitForSelector('text=pasos con evidencia en el ERP');
  ok(await p.locator('text=Fase 6').count() > 0 && await p.locator('text=Servicio post-venta').count() > 0, 'ruta de 6 fases y 18 pasos para la orden');
  await p.screenshot({ path: OUT + '/ruta.png', fullPage: true });
  await p.click('button:has-text("Modelos de documentos y contrato")');
  await p.waitForSelector('text=Contrato de compraventa internacional');
  const cards = p.locator('button:has-text("Word")');
  const n = await cards.count(); ok(n === 9, `9 modelos disponibles (${n})`);
  for (let i = 0; i < n; i++) {
    const dl = p.waitForEvent('download'); await cards.nth(i).click(); const d = await dl;
    const f = path.join(OUT, d.suggestedFilename()); await d.saveAs(f);
    const head = fs.readFileSync(f).subarray(0, 2).toString();
    ok(head === 'PK' && fs.statSync(f).size > 3000, `Word válido: ${d.suggestedFilename()} (${fs.statSync(f).size} bytes)`);
  }
  await p.click('button:has-text("Vista previa") >> nth=8');
  await p.waitForSelector('text=Pago condicionado (Smart Contract)');
  ok(true, 'vista previa del contrato con cláusula de pago condicionado');
  await p.screenshot({ path: OUT + '/contrato.png' });
  await p.keyboard.press('Escape');
  const attachBtns = p.locator('button:has-text("Adjuntar como evidencia")');
  ok(await attachBtns.count() >= 1, `botones de adjuntar visibles (${await attachBtns.count()})`);
  await attachBtns.first().click();
  await p.waitForSelector('text=Adjuntado como evidencia', { timeout: 20000 });
  await p.waitForTimeout(1500);
  ok(await p.locator('span:text-is("Adjuntado")').count() >= 1, 'requisito pasa a ADJUNTADO');
  await p.screenshot({ path: OUT + '/modelos.png', fullPage: true });
  await p.click('button:has-text("DUA, errores y recursos")');
  await p.waitForSelector('text=Errores comunes que retrasan la DUA'); await p.waitForSelector('text=Canal rojo');
  ok(true, 'pestaña DUA con canales, errores comunes y recursos');
  await p.screenshot({ path: OUT + '/dua.png', fullPage: true });
  const a = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await login(a, 'auditor@donpimenton.pe'); await a.goto(`${BASE}/smart-contract`);
  await a.click('button:has-text("Modelos de documentos y contrato")'); await a.waitForSelector('text=Contrato de compraventa internacional');
  ok(await a.locator('button:has-text("Adjuntar como evidencia")').count() === 0, 'auditor no puede adjuntar');
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await login(m, 'admin@donpimenton.pe'); await m.goto(`${BASE}/smart-contract`); await m.waitForTimeout(3000);
  ok(await m.evaluate(() => document.documentElement.scrollWidth <= 400), 'sin desplazamiento horizontal en móvil');
  ok(errs.length === 0, `sin errores JS (${errs.join(' | ')})`);
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
