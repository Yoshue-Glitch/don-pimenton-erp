/**
 * Asistente de IA de Don Pimentón (ERP y portal del comprador).
 *  - Modo CLAUDE (si ANTHROPIC_API_KEY está configurada): Claude con búsqueda web restringida a
 *    fuentes oficiales y confiables (FDA, CBP, SUNAT, SENASA, DIGESA, PROMPERÚ, MINCETUR, GS1, ICC…),
 *    más el contexto del plan de negocios y datos vivos del ERP. Las respuestas citan sus fuentes.
 *  - Modo LOCAL (sin clave): responde SOLO desde la base de conocimiento curada del plan y los datos
 *    del ERP, con enlaces a la fuente oficial; si no sabe, lo dice. Nunca inventa resultados.
 * Toda recomendación debe ser revisada por un responsable humano; las consultas quedan registradas.
 */
import { Router, Request } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";
import { ah, parse, idParam } from "../lib/http";
import { requirePerm, hasPerm } from "../auth/auth";
import { audit } from "../lib/audit";
import { D } from "../lib/decimal";
import * as T from "./trade.service";

export const assistantRouter = Router();

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const TRUSTED_DOMAINS = [
  "fda.gov", "cbp.gov", "ecfr.gov", "usitc.gov", "hts.usitc.gov", "usda.gov", "fsis.usda.gov", "federalregister.gov",
  "sunat.gob.pe", "gob.pe", "senasa.gob.pe", "digesa.minsa.gob.pe", "minsa.gob.pe", "promperu.gob.pe", "mincetur.gob.pe", "acuerdoscomerciales.gob.pe",
  "vuce.gob.pe", "bcrp.gob.pe", "sbs.gob.pe", "produce.gob.pe", "midagri.gob.pe", "inacal.gob.pe", "proinnovate.gob.pe", "agrobanco.com.pe",
  "gs1.org", "gs1pe.org.pe", "iccwbo.org", "fao.org", "who.int", "codexalimentarius.org", "astaspice.org", "globalreporting.org",
];
export const aiEnabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

type Src = { title: string; url: string };
type KB = { id: string; keys: string[]; title: string; answer: string; sources: Src[] };

/** Base de conocimiento curada a partir del Plan de Negocios 2026 y de fuentes oficiales (enlaces). */
export const KNOWLEDGE: KB[] = [
  { id: "empresa", keys: ["empresa", "don pimenton", "quien", "quienes", "historia", "ubicacion", "caraveli", "arequipa", "martha"], title: "La empresa",
    answer: "Don Pimentón es una empresa familiar de Arequipa (producción en Caravelí) dirigida por la Gerencia General (Martha Torres). Cultiva, deshidrata, muele y comercializa pimentón rojo (Capsicum annuum). Hoy vende sacos de 25 kg en el Mercado La Feria Los Incas de Arequipa y prepara la exportación de páprika molida en frascos de 4 oz (113 g) a Estados Unidos en cuatro fases: 1) preparación, formalización y certificación; 2) asociatividad con productores; 3) exportación indirecta con un socio exportador; 4) exportación directa.", sources: [{ title: "Plan de Negocios Internacionales 2026 — Don Pimentón (cap. 1)", url: "/docs/plan" }] },
  { id: "producto", keys: ["producto", "frasco", "4 oz", "113", "caja", "paleta", "presentacion", "pallet", "cajas", "frascos"], title: "Producto y empaque",
    answer: "Producto de exportación: páprika molida premium en frasco de vidrio de 4 oz (113 g netos) con tapa dosificadora y sello de inducción. 24 frascos por caja shelf-ready, 96 cajas por paleta = 2,304 frascos ≈ 260.4 kg netos por paleta (exactamente 260.352 kg). Peso bruto estimado ≈ 580 kg por paleta con frasco de ≈105 g, caja de ≈0.55 kg y paleta (confirmar pesando). Vida útil 12 meses con fecha «Best by». Códigos: GTIN en el frasco, GTIN-14 en la caja, SSCC en la paleta y QR de trazabilidad.", sources: [{ title: "Plan 2026 — Tablas OP-1 a OP-4", url: "/docs/plan" }, { title: "GS1 — Identificación de unidades logísticas (SSCC)", url: "https://www.gs1.org/standards/id-keys/sscc" }] },
  { id: "precio", keys: ["precio", "cuanto cuesta", "costo", "fca", "fob", "cotizacion", "cotizar", "price", "cost"], title: "Precio y condiciones",
    answer: "El plan no fija un precio cerrado: analiza precios FCA de US$ 1.20 a US$ 2.40 por frasco. El portal usa como referencia de prueba US$ 2.00 por frasco FCA Callao (2,304 frascos = US$ 4,608 por paleta). El costo variable estimado del plan es S/ 2.96 por frasco (46 % corresponde al frasco, la tapa y el sello). Incoterms ofrecidos: FCA o FOB (Incoterms® 2020). Si el margen estimado queda bajo el piso de Gerencia, el pedido requiere aprobación (regla R8).", sources: [{ title: "Plan 2026 — Tablas OP-48 y OP-50", url: "/docs/plan" }, { title: "ICC — Incoterms® 2020", url: "https://iccwbo.org/business-solutions/incoterms-rules/incoterms-2020/" }] },
  { id: "calidad", keys: ["calidad", "asta", "humedad", "aflatoxina", "salmonella", "coa", "analisis", "laboratorio", "ocratoxina", "aw", "especificacion"], title: "Calidad e inocuidad",
    answer: "Parámetros de referencia del plan (configurables por contrato y normativa): color 100–120 grados ASTA; humedad ≤ 11 %; actividad de agua ≤ 0.60 (sujeto a validación); Salmonella ausente en 25 g; aflatoxina B1 ≤ 5 µg/kg y aflatoxinas totales ≤ 10 µg/kg; además E. coli, mohos y levaduras, ocratoxina A, colorantes prohibidos (Sudán), materia extraña y control de metales. Regla R1: ningún lote se reserva para exportación sin un COA aprobado. El COA del ERP es de demostración y no reemplaza el informe de un laboratorio acreditado.", sources: [{ title: "Plan 2026 — Tabla OP-8", url: "/docs/plan" }, { title: "FDA — Spices: Risk Profile (Pathogens and Filth)", url: "https://www.fda.gov/food/cfsan-risk-safety-assessments/fda-risk-profile-pathogens-and-filth-spices" }] },
  { id: "fda", keys: ["fda", "registro fda", "ffr", "fsma", "fsvp", "prior notice", "aviso previo", "pcqi", "agente en eeuu", "duns"], title: "Requisitos FDA",
    answer: "Para vender alimentos en EE. UU.: la instalación debe estar registrada ante la FDA (Food Facility Registration, renovación bienal entre el 1 de octubre y el 31 de diciembre de los años pares) con un agente en EE. UU. y número UFI (DUNS); el plan de inocuidad FSMA debe estar a cargo de un PCQI; el importador cumple el programa FSVP de verificación de proveedores extranjeros; y cada envío requiere Prior Notice ante la FDA antes del arribo (lo presenta el importador o su broker). El etiquetado debe cumplir 21 CFR 101 y mostrar «Product of Peru». El ERP controla vigencias y bloquea pedidos con registros vencidos (regla R7).", sources: [{ title: "FDA — Food Facility Registration", url: "https://www.fda.gov/food/guidance-regulation-food-and-dietary-supplements/registration-food-facilities-and-other-submissions" }, { title: "FDA — Prior Notice of Imported Foods", url: "https://www.fda.gov/food/importing-food-products-united-states/prior-notice-imported-foods" }, { title: "FDA — FSVP", url: "https://www.fda.gov/food/food-safety-modernization-act-fsma/fsma-final-rule-foreign-supplier-verification-programs-fsvp-importers-food-humans-and-animals" }] },
  { id: "isf", keys: ["isf", "10+2", "cbp", "aduana eeuu", "importer security filing"], title: "ISF 10+2 (CBP)",
    answer: "El Importer Security Filing (ISF 10+2) lo presenta el importador ante CBP para carga marítima, a más tardar 24 horas antes de cargar en el buque en el puerto de origen. Por eso el plan fija la regla R6: Don Pimentón envía los datos ISF al importador al menos 48 horas antes del cierre de carga. El ERP genera la hoja de datos ISF (fabricante, vendedor, comprador, país de origen, HTS, lugar de llenado, consolidador…).", sources: [{ title: "CBP — Importer Security Filing 10+2", url: "https://www.cbp.gov/border-security/ports-entry/cargo-security/importer-security-filing-102" }] },
  { id: "dam", keys: ["dam", "sunat", "regularizacion", "numeracion", "levante", "canal", "plazo", "30 dias", "despa", "aduana peru", "semaforo"], title: "DAM y plazos SUNAT",
    answer: "En la exportación definitiva (procedimiento DESPA-PG.02) la mercancía debe embarcarse dentro de 30 días calendario desde la numeración de la DAM y la DAM se regulariza dentro de 30 días desde el término del embarque. El ERP aplica el semáforo del plan: verde hasta el día 20, ámbar del 21 al 27 y rojo desde el 28 (R4), con alertas de regularización a los 20, 25 y 28 días (R5). Los plazos son configurables y deben validarse con la normativa vigente y el agente de aduana. El ERP no transmite a SUNAT: prepara los datos.", sources: [{ title: "SUNAT — Exportación definitiva DESPA-PG.02", url: "https://www.sunat.gob.pe/legislacion/procedim/despacho/exportacion/exportac/procGeneral/despa-pg.02.htm" }] },
  { id: "arancel", keys: ["arancel", "hts", "subpartida", "partida", "0904", "tlc", "apc", "origen", "certificado de origen", "tratado"], title: "Clasificación y origen",
    answer: "Subpartida nacional 09.04.22.10.00 (páprika molida) y HTS de EE. UU. 0904.22.20. Con el Acuerdo de Promoción Comercial Perú–EE. UU. la páprika peruana de cosecha propia califica como «totalmente obtenida»; el origen se acredita con una certificación escrita del exportador, productor o importador (sin formulario oficial). Los registros que la respaldan se conservan al menos 5 años.", sources: [{ title: "MINCETUR — Acuerdo de Promoción Comercial Perú–EE. UU.", url: "https://www.acuerdoscomerciales.gob.pe/" }, { title: "USITC — Harmonized Tariff Schedule", url: "https://hts.usitc.gov/" }] },
  { id: "pago", keys: ["pago", "pagar", "tarjeta", "yape", "transferencia", "interbancario", "cci", "swift", "metodo de pago", "pay", "payment"], title: "Métodos de pago",
    answer: "El portal acepta: tarjeta de crédito/débito mediante una pasarela certificada PCI (el ERP nunca ve ni guarda los datos de la tarjeta), Yape (QR o número del negocio; se registra el número de operación y Finanzas lo verifica) y transferencia bancaria o interbancaria (CCI en Perú, SWIFT para el exterior) con número de operación y comprobante. Cuando el pago se aprueba, el ERP registra la cobranza y fondea el contrato inteligente (escrow espejo con fondos de prueba en una red local; no se mueven criptomonedas reales). Yape tiene límites diarios por usuario, por lo que se recomienda para muestras y pedidos pequeños.", sources: [{ title: "Yape — Ayuda", url: "https://www.yape.com.pe/" }, { title: "SBS — Información al usuario financiero", url: "https://www.sbs.gob.pe/usuarios" }] },
  { id: "smart", keys: ["smart contract", "contrato inteligente", "blockchain", "escrow", "liberar", "hash", "custodia", "ethereum", "hardhat"], title: "Smart contract",
    answer: "El acuerdo PaprikaTradeAgreement automatiza el pago condicionado: 1) Don Pimentón crea el acuerdo; 2) el comprador lo acepta; 3) se depositan fondos de prueba; 4-5) Calidad aprueba el lote y un servicio autorizado lo registra on-chain; 6) Logística registra la entrega; 7) el comprador confirma; 8) el contrato verifica TODAS las condiciones; 9) libera el pago; 10) el ERP guarda el hash. Un lote rechazado bloquea el pago y habilita el reembolso; no se paga sin confirmación de entrega; no se puede pagar dos veces; hay plazo, cancelación y disputa con árbitro. PaprikaTraceability guarda solo hashes de la ficha de cosecha, la producción, el COA y los documentos.", sources: [{ title: "Módulo Blockchain del ERP", url: "/smart-contract" }] },
  { id: "trazabilidad", keys: ["trazabilidad", "qr", "origen del producto", "parcela", "cosecha", "lote", "recall", "retiro"], title: "Trazabilidad",
    answer: "Cada frasco se rastrea hacia atrás (parcela, fecha de cosecha, lote de proceso) y hacia adelante (paleta SSCC, contenedor, importador). El código QR de la etiqueta abre la historia de origen y compara los hashes con los registrados en blockchain. El objetivo del plan ante un reclamo o retiro es identificar lotes y clientes afectados en menos de 4 horas (simulacro en Logística inversa).", sources: [{ title: "Plan 2026 — Tabla TI-20", url: "/docs/plan" }] },
  { id: "rs", keys: ["responsabilidad social", "rs", "sostenibilidad", "gri", "ambiental", "compost", "reciclaje", "agua", "energia", "huella"], title: "Responsabilidad social",
    answer: "El plan de RS tiene 31 proyectos en cuatro ejes (económico, ambiental, social y ético) más gestión transversal, con un presupuesto total de S/ 101,871 a 24 meses (S/ 92,610 + 10 % de imprevistos), financiado 50 % con recursos propios y el resto con fondos concursables, crédito agrario y la asociación. Metas a 24 meses: energía de 3.40 a 2.73 kWh/kg, agua de 2.22 a 1.89 m³/kg, 100 % de residuos orgánicos compostados, ≥ 30 % de sacos reutilizados, 8 productores asociados y 2 informes GRI.", sources: [{ title: "Plan 2026 — Tablas RS-44 a RS-58", url: "/docs/plan" }, { title: "GRI 13: Agricultura", url: "https://www.globalreporting.org/standards/standards-development/sector-standard-for-agriculture-aquaculture-and-fishing/" }] },
  { id: "inversa", keys: ["logistica inversa", "devolucion", "reclamo", "rma", "roto", "rotura", "faltante", "nota de credito", "retornable", "reutiliz"], title: "Logística inversa",
    answer: "Los reclamos (calidad, rotura, faltante, etiquetado, retraso) se registran como RMA desde el portal o el ERP, se evalúan y se cierran con una disposición: reposición, nota de crédito, reproceso, destrucción controlada, compostaje o reciclaje (vidrio, cartón). También se registran retornos de sacos y paletas retornables y el convenio con recicladores (proyecto PA-04). La meta social es atender las quejas en ≤ 15 días.", sources: [{ title: "Plan 2026 — Plan de RS (PA-04, PS-05)", url: "/docs/plan" }] },
  { id: "muestras", keys: ["muestra", "muestras", "sample", "probar"], title: "Muestras",
    answer: "Los compradores y brokers pueden solicitar una caja de muestra desde el portal. El plan contempla enviar muestras a 30 brokers e importadores en los meses 3 a 6.", sources: [{ title: "Plan 2026 — Plan de marketing", url: "/docs/plan" }] },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function localAnswer(q: string) {
  const nq = norm(q);
  const scored = KNOWLEDGE.map((k) => ({ k, score: k.keys.reduce((s, key) => s + (nq.includes(norm(key)) ? key.length : 0), 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { answer: "No tengo información verificada sobre eso en la base de conocimiento del plan. Puede preguntar por: producto y empaque, precio e Incoterms, calidad (ASTA, aflatoxinas), requisitos FDA, ISF, DAM y plazos SUNAT, origen y aranceles, métodos de pago, smart contract, trazabilidad, responsabilidad social, logística inversa o muestras. Para respuestas con búsqueda web en fuentes oficiales, la Gerencia puede configurar una clave de API de Claude.", sources: [] as Src[], topics: [] as string[] };
  const top = scored.slice(0, 2).map((x) => x.k);
  return { answer: top.map((k) => `**${k.title}.** ${k.answer}`).join("\n\n"), sources: top.flatMap((k) => k.sources), topics: top.map((k) => k.id) };
}

/** Datos vivos del ERP que el asistente puede usar (sin datos personales ni, para externos, costos). */
async function liveContext(req: Request, portal: boolean) {
  const p = await T.params();
  const [pallets, kpis] = await Promise.all([prisma.pallet.count({ where: { status: "DISPONIBLE" } }), hasPerm(req, "kpi.read") ? T.kpis() : Promise.resolve([])]);
  const where: any = portal ? { customerId: req.user!.customerId ?? -1 } : {};
  const ships = await prisma.exportShipment.findMany({ where, orderBy: { id: "desc" }, take: 8, include: { agreement: true } });
  return {
    fecha: new Date().toISOString().slice(0, 10), paletasDisponibles: pallets, frascosDisponibles: pallets * p.jarsPerCase * p.casesPerPallet, precioReferenciaUsd: p.defaultPriceUsd,
    puertoOrigen: p.originPort, puertoDestino: p.destinationPort, diasDeViaje: p.voyageDays,
    pedidos: ships.map((s) => ({ codigo: s.code, estado: s.status, paletas: s.pallets, frascos: s.jars, importeUsd: Number(s.amountUsd), pagadoUsd: Number(s.paidUsd), contrato: s.agreement?.status ?? null, dam: s.damNumber, bl: s.blNumber, progresoViaje: Math.round(s.voyageProgress * 100) + "%", entrega: s.deliveryDate.toISOString().slice(0, 10), ...(portal || !hasPerm(req, "costs.read") ? {} : { margenPct: Number(s.marginPct ?? 0) }) })),
    kpis: kpis.map((k: any) => ({ indicador: k.name, valor: k.value, unidad: k.unit, meta: k.target })),
  };
}

const SYSTEM = `Eres "Pimentín", el asistente comercial y de comercio exterior de Don Pimentón (Arequipa, Perú): exporta páprika molida en frascos de 4 oz (113 g) a Estados Unidos.
Reglas:
- Responde en el idioma del usuario (español por defecto; inglés si escribe en inglés), de forma breve, clara y útil para comprar o vender el producto.
- Usa primero la BASE DE CONOCIMIENTO del plan de negocios y los DATOS DEL ERP que se te entregan. Para normas, plazos, aranceles o requisitos regulatorios vigentes, busca en la web (solo fuentes oficiales permitidas) y cita la fuente.
- No inventes cifras, normas, precios ni estados de pedidos. Si un dato no está en las fuentes, dilo y sugiere a quién consultar (agente de aduana, broker, FDA, SUNAT).
- Las cifras del ERP son de demostración; los requisitos legales deben validarse con la autoridad. El ERP no transmite datos oficiales a SUNAT, VUCE, FDA ni CBP.
- Nunca pidas datos de tarjetas ni contraseñas en el chat: los pagos se hacen en la pantalla de pago del portal.
- Termina las recomendaciones operativas recordando que deben ser revisadas por un responsable humano.`;

async function claudeAnswer(question: string, history: { role: "user" | "assistant"; content: string }[], ctx: unknown, extra: string) {
  const client = new Anthropic();
  const kb = KNOWLEDGE.map((k) => `## ${k.title}\n${k.answer}\nFuentes: ${k.sources.map((s) => s.url).join(", ")}`).join("\n\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `${extra ? extra + "\n\n" : ""}DATOS DEL ERP (JSON):\n${JSON.stringify(ctx)}\n\nPREGUNTA: ${question}` },
  ];
  const sources: Src[] = [];
  let text = "";
  for (let i = 0; i < 4; i++) {
    const r = await client.beta.messages.create({
      model: MODEL, max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: `${SYSTEM}\n\nBASE DE CONOCIMIENTO (Plan de Negocios 2026):\n${kb}`, cache_control: { type: "ephemeral" } }],
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: TRUSTED_DOMAINS }],
      messages,
    } as any) as Anthropic.Beta.BetaMessage;
    if (r.stop_reason === "refusal") return { answer: "No puedo responder esa consulta. Reformúlela en relación con el producto, la compra o la exportación.", sources: [], model: r.model };
    for (const b of r.content as any[]) {
      if (b.type === "text") {
        text += b.text;
        for (const c of b.citations ?? []) if (c.url && !sources.some((s) => s.url === c.url)) sources.push({ title: c.title ?? c.url, url: c.url });
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const w of b.content) if (w.url && !sources.some((s) => s.url === w.url) && sources.length < 8) sources.push({ title: w.title ?? w.url, url: w.url });
    }
    if (r.stop_reason !== "pause_turn") return { answer: text.trim(), sources, model: r.model };
    messages.push({ role: "assistant", content: r.content as any });
  }
  return { answer: text.trim(), sources, model: MODEL };
}

export async function ask(req: Request, input: { question: string; history?: any[]; tool?: string; portal?: boolean }) {
  const portal = !!input.portal;
  const ctx = await liveContext(req, portal);
  let out: { answer: string; sources: Src[]; mode: "CLAUDE" | "LOCAL"; model?: string };
  if (aiEnabled()) {
    try {
      const extra = toolPrompt(input.tool);
      const r = await claudeAnswer(input.question, input.history ?? [], ctx, extra);
      out = { ...r, mode: "CLAUDE" };
    } catch (e: any) {
      const l = localAnswer(input.question);
      out = { answer: `${l.answer}\n\n_(La IA externa no respondió: ${e?.status ?? ""} ${e?.message?.slice(0, 120) ?? "error"}. Se muestra la respuesta de la base de conocimiento local.)_`, sources: l.sources, mode: "LOCAL" };
    }
  } else {
    const l = localAnswer(input.question);
    const orders = /pedido|orden|embarque|order|estado|status|donde|dónde|barco|llega/i.test(input.question) && ctx.pedidos.length
      ? "\n\n**Sus pedidos en el ERP:**\n" + ctx.pedidos.slice(0, 5).map((p) => `• ${p.codigo}: ${p.estado.replace(/_/g, " ").toLowerCase()} · ${p.frascos} frascos · US$ ${p.importeUsd.toFixed(2)} (pagado US$ ${p.pagadoUsd.toFixed(2)}) · contrato ${p.contrato ?? "pendiente"} · viaje ${p.progresoViaje}`).join("\n") : "";
    const stock = /stock|disponib|paleta|inventario|available/i.test(input.question) ? `\n\n**Disponible ahora:** ${ctx.paletasDisponibles} paleta(s) = ${ctx.frascosDisponibles.toLocaleString("es-PE")} frascos con COA aprobado.` : "";
    out = { answer: l.answer + orders + stock, sources: l.sources, mode: "LOCAL" };
  }
  const row = await prisma.aiQuery.create({ data: { userId: req.user?.id ?? null, channel: portal ? "PORTAL" : "ERP", tool: input.tool ?? "CHAT", question: input.question.slice(0, 2000), answer: out.answer.slice(0, 8000), sources: out.sources as any, mode: out.mode } });
  return { id: row.id, ...out, disclaimer: "Respuesta de apoyo: debe ser revisada por un responsable humano antes de usarla en operaciones reales.", demo: out.mode === "LOCAL" };
}

function toolPrompt(tool?: string) {
  switch (tool) {
    case "COMPARAR": return "TAREA: compara factura, packing list y B/L del embarque indicado usando los datos del ERP y señala cualquier inconsistencia de pesos, bultos, descripción o subpartida (reglas R2/R3).";
    case "PRONOSTICO": return "TAREA: apoya un pronóstico de cosecha y demanda con los datos disponibles; explica supuestos y rango de incertidumbre. No presentes el pronóstico como dato real.";
    case "REDACCION": return "TAREA: redacta contenido comercial bilingüe (español e inglés) sobre la páprika de Don Pimentón, sin afirmaciones no verificadas (p. ej. orgánico o certificaciones que no existan).";
    case "ANOMALIAS": return "TAREA: identifica anomalías en costos, mermas y consumo energético a partir de los KPI del ERP y sugiere qué revisar.";
    default: return "";
  }
}

const askSchema = z.object({ question: z.string().min(2).max(2000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).optional(), tool: z.enum(["CHAT", "COMPARAR", "PRONOSTICO", "REDACCION", "ANOMALIAS"]).optional() });

assistantRouter.get("/status", ah(async (_req, res) => res.json({ enabled: aiEnabled(), model: aiEnabled() ? MODEL : null, mode: aiEnabled() ? "CLAUDE" : "LOCAL", trustedDomains: TRUSTED_DOMAINS, topics: KNOWLEDGE.map((k) => k.title) })));
assistantRouter.post("/ask", requirePerm("ai.use"), ah(async (req, res) => res.json(await ask(req, parse(askSchema, req.body)))));
assistantRouter.get("/history", requirePerm("ai.use"), ah(async (req, res) => {
  const where = hasPerm(req, "ai.validate") ? {} : { userId: req.user!.id };
  res.json(await prisma.aiQuery.findMany({ where, orderBy: { id: "desc" }, take: 100 }));
}));
assistantRouter.post("/history/:id/validate", requirePerm("ai.validate"), ah(async (req, res) => {
  const out = await prisma.aiQuery.update({ where: { id: idParam(req) }, data: { validatedBy: req.user!.name, validatedAt: new Date() } });
  await audit(prisma, req.user!.id, "VALIDAR_IA", "ai_query", out.id, {});
  res.json(out);
}));

/** OCR / extracción: se usa el texto del documento (PDF o imagen requieren la IA externa). */
assistantRouter.post("/extract", requirePerm("ai.use"), ah(async (req, res) => {
  const { text } = parse(z.object({ text: z.string().min(5).max(50000) }), req.body);
  const num = (re: RegExp) => { const m = text.match(re); return m ? m[1] : null; };
  const fields = {
    netKg: num(/neto[^0-9]{0,20}([0-9.,]+)\s*kg/i), grossKg: num(/bruto[^0-9]{0,20}([0-9.,]+)\s*kg/i), cases: num(/([0-9.,]+)\s*(?:cajas|bultos|cartons)/i),
    hsCode: num(/(0904[.\d]*)/), bl: num(/B\/?L[^A-Z0-9]{0,10}([A-Z0-9-]{6,})/i), dam: num(/DAM[^0-9]{0,10}([0-9-]{8,})/i),
  };
  const ship = req.body.shipmentId ? await prisma.exportShipment.findUnique({ where: { id: Number(req.body.shipmentId) }, include: { palletsList: true } }) : null;
  const issues: string[] = [];
  if (ship) {
    const n = (v: string | null) => (v ? Number(v.replace(/,/g, "")) : null);
    const net = ship.palletsList.reduce((a, b) => a.plus(b.netKg), D(0)), gross = ship.palletsList.reduce((a, b) => a.plus(b.grossKg), D(0));
    if (fields.netKg && n(fields.netKg) !== Number(net)) issues.push(`Peso neto del documento ${fields.netKg} kg ≠ ERP ${net.toFixed(3)} kg`);
    if (fields.grossKg && n(fields.grossKg) !== Number(gross)) issues.push(`Peso bruto del documento ${fields.grossKg} kg ≠ ERP ${gross.toFixed(3)} kg`);
    if (fields.cases && n(fields.cases) !== ship.cases) issues.push(`Bultos del documento ${fields.cases} ≠ ERP ${ship.cases}`);
    if (fields.hsCode && !ship.hsCode.startsWith(fields.hsCode.slice(0, 7))) issues.push(`Subpartida ${fields.hsCode} ≠ catálogo ${ship.hsCode}`);
  }
  const row = await prisma.aiQuery.create({ data: { userId: req.user!.id, tool: "OCR", question: text.slice(0, 2000), answer: JSON.stringify({ fields, issues }), mode: "LOCAL" } });
  res.json({ id: row.id, fields, issues, mode: "LOCAL", note: "Extracción por reglas sobre el texto del documento. Para OCR de imágenes o PDF escaneados se requiere la integración de IA configurable. Revise el resultado antes de usarlo." });
}));
