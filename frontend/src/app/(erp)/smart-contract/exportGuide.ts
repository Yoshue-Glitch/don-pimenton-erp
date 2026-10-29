/**
 * Guía "Pasos oficiales para exportar" (Trazabilidad.pdf) estructurada para
 * la ruta de trazabilidad de cada orden internacional.
 */

/** Evidencia que el ERP puede comprobar para un paso (ver `stepStatus` en page.tsx). */
export type StepCheck =
  | "product" | "company" | "permits" | "market" | "letter" | "quote" | "buyers"
  | "incoterm" | "payment" | "contract" | "services" | "documents" | "dua" | "dua-process"
  | "shipment" | "collection" | "postsale" | "smart";

export interface GuideStep { n: number; title: string; items: string[]; tip?: string; check: StepCheck }
export interface GuidePhase { n: number; title: string; steps: GuideStep[] }

export const PHASES: GuidePhase[] = [
  { n: 1, title: "Preparación", steps: [
    { n: 1, title: "Análisis del producto", check: "product", items: ["Identificar producto a exportar", "Verificar estándares de calidad", "Determinar capacidad de producción", "Calcular costos reales"] },
    { n: 2, title: "Investigación de mercado", check: "market", items: ["Demanda del producto", "Análisis de competencia y precios", "Barreras arancelarias", "Requisitos sanitarios", "Temporadas de demanda"], tip: "Herramientas: TradeMap, SIICEX, Veritrade, PromPerú." },
    { n: 3, title: "Selección de mercado", check: "market", items: ["Evaluar tamaño del mercado", "Revisar Tratados de Libre Comercio", "Analizar facilidad de acceso", "Evaluar competitividad"] },
  ] },
  { n: 2, title: "Formalización", steps: [
    { n: 4, title: "Constitución legal", check: "company", items: ["RUC activo", "Registro en SUNAT como exportador", "Certificado digital (Clave SOL)"], tip: "Consignar la actividad de “Comercio Exterior” como exportador-importador-comercializador." },
    { n: 5, title: "Permisos y certificaciones", check: "permits", items: ["Certificado de origen", "Registro sanitario (DIGESA)", "Certificado fitosanitario (SENASA)", "Certificaciones ISO, HACCP, orgánicos"], tip: "¡Crítico! Sin certificaciones no se puede exportar." },
  ] },
  { n: 3, title: "Contacto comercial", steps: [
    { n: 6, title: "Carta de presentación", check: "letter", items: ["Presentación de la empresa", "Descripción de productos", "Propuesta de valor", "Datos de contacto"], tip: "Incluir membrete, descripción breve y certificaciones. Documento en inglés." },
    { n: 7, title: "Cotización internacional", check: "quote", items: ["Descripción detallada del producto", "Partida arancelaria", "Precio e INCOTERM", "Forma de pago", "Plazo de entrega", "Validez de la cotización"], tip: "Puede ir acompañada de ficha técnica o tarjeta comercial de exportación." },
    { n: 8, title: "Búsqueda de compradores", check: "buyers", items: ["Ferias internacionales", "Misiones comerciales PromPerú", "Plataformas B2B (Alibaba, TradeKey)", "LinkedIn", "Cámaras de comercio"] },
  ] },
  { n: 4, title: "Negociación", steps: [
    { n: 9, title: "Definir INCOTERMS", check: "incoterm", items: ["EXW: el comprador recoge", "FOB: entrega en puerto", "CIF: incluye flete y seguro", "DDP: entrega en destino"] },
    { n: 10, title: "Forma de pago", check: "payment", items: ["Carta de crédito (más segura)", "Transferencia anticipada", "Cobranza documentaria", "Cuenta abierta (con confianza)"], tip: "Recomendado: carta de crédito para el primer embarque, o pago condicionado con Smart Contract." },
    { n: 11, title: "Contrato internacional", check: "contract", items: ["Identificación de partes", "Especificaciones del producto", "INCOTERM y forma de pago", "Plazos de entrega", "Cláusulas de incumplimiento"], tip: "Formalizar con contratos revisados por abogados especializados." },
  ] },
  { n: 5, title: "Logística y documentación", steps: [
    { n: 12, title: "Contratar servicios", check: "services", items: ["Agente de carga: transporte internacional", "Agente de aduanas: tramitación de la DUA", "Seguro: protección de la mercancía"], tip: "Costo aproximado del despacho aduanero: USD 200–500." },
    { n: 13, title: "Documentos comerciales", check: "documents", items: ["Factura comercial", "Packing list (lista de empaque)", "Certificado de origen", "Bill of Lading o Air Waybill", "Certificados sanitarios / fitosanitarios", "Certificados de calidad"], tip: "¡Importante! Entregar al agente 2–3 días antes del embarque." },
    { n: 14, title: "DUA — Declaración Única de Aduanas", check: "dua", items: ["Documento oficial para exportar (antes DAM)", "Solo la tramita el agente de aduanas", "Sistema SIGAD de SUNAT", "Régimen 40: exportación definitiva"], tip: "¡Crítico! Sin DUA numerada no se puede exportar." },
    { n: 15, title: "Proceso de la DUA", check: "dua-process", items: ["A. Transmisión electrónica", "B. Numeración de la DUA", "C. Selección de canal (verde / naranja / rojo)", "D. Revisión (si aplica)", "E. Levante autorizado"] },
    { n: 16, title: "Embarque", check: "shipment", items: ["Traslado a puerto", "Carga al buque", "Emisión del documento de transporte", "Tracking del envío"] },
  ] },
  { n: 6, title: "Post-venta y cobro", steps: [
    { n: 17, title: "Gestión de cobro", check: "collection", items: ["Confirmar recepción de la mercancía", "Activar la cobranza según la forma de pago", "Seguimiento de transferencias", "Registro contable"] },
    { n: 18, title: "Servicio post-venta", check: "postsale", items: ["Confirmar satisfacción del cliente", "Resolver reclamos", "Mantener la relación comercial", "Solicitar testimoniales"] },
  ] },
];

/** Cómo cada evidencia de la exportación alimenta el contrato inteligente PaprikaTradeAgreement. */
export const SMART_LINKS: { doc: string; fn: string; actor: string; effect: string }[] = [
  { doc: "Contrato internacional / cotización aceptada", fn: "createAgreement + acceptAgreement", actor: "Vendedor y comprador", effect: "Fija lote, cantidad, importe y fecha límite; no pueden alterarse." },
  { doc: "Depósito del comprador (sustituye o complementa la carta de crédito)", fn: "depositFunds", actor: "Comprador", effect: "Los fondos quedan en custodia del contrato hasta cumplir las condiciones." },
  { doc: "Certificado de análisis (COA) del lote", fn: "recordQuality", actor: "Calidad", effect: "Solo se acepta si el lote figura APROBADO en PaprikaTraceability (hash del COA)." },
  { doc: "Bill of Lading / acta de entrega", fn: "recordDelivery", actor: "Logística", effect: "Registra el hash de la evidencia de entrega; exige calidad aprobada." },
  { doc: "Confirmación de recepción del importador", fn: "confirmReceipt", actor: "Comprador", effect: "Única forma de habilitar el pago." },
  { doc: "Gestión de cobro", fn: "releasePayment", actor: "Vendedor o comprador", effect: "Libera el pago solo con calidad aprobada y recepción confirmada; nunca dos veces." },
  { doc: "Reclamo post-venta", fn: "openDispute / resolveDispute", actor: "Partes / Gerencia (árbitro)", effect: "Congela los fondos; el árbitro no puede pagar si la calidad no fue aprobada." },
];

export const DUA_PROCESS = [
  { k: "A", title: "Transmisión electrónica (por el agente)", text: "El agente ingresa los datos al sistema SIGAD; SUNAT valida automáticamente que la información esté correcta." },
  { k: "B", title: "Numeración de la DUA", text: "SUNAT asigna un número único a la declaración (formato 123-XXXX-XX-XXXXXX) con fecha y hora oficial de la exportación." },
  { k: "C", title: "Selección de canal", text: "Verde, naranja o rojo según el riesgo (ver detalle)." },
  { k: "D", title: "Revisión (si aplica)", text: "Revisión documentaria o inspección física según el canal asignado." },
  { k: "E", title: "Levante autorizado", text: "SUNAT autoriza la salida de la mercancía; se puede proceder al embarque y el agente entrega copia de la DUA con sello." },
];

export const DUA_CHANNELS = [
  { color: "green", name: "Canal verde", text: "No requiere revisión; levante automático (70–80 % de los casos)." },
  { color: "orange", name: "Canal naranja", text: "Revisión documentaria: el agente presenta originales en ventanilla y un especialista los revisa; si todo está bien, levante autorizado." },
  { color: "red", name: "Canal rojo", text: "Inspección física: coordinación con almacén aduanero; SUNAT verifica cantidad, calidad, etiquetado y empaque. El exportador o su representante debe estar presente." },
];

export const AGENT_DOCS = {
  mandatory: ["Factura comercial", "Lista de empaque (packing list)", "Copia del RUC del exportador", "Orden de embarque del agente de carga", "Número de contenedor (embarque marítimo)", "Certificado de origen (si aplica TLC)"],
  byProduct: ["Certificado sanitario / fitosanitario", "Vistos buenos o autorizaciones especiales", "Certificados de calidad", "Permiso de DIGESA (alimentos)", "Permiso de SENASA (productos agrícolas)"],
};

export const COMMON_ERRORS = [
  "Partida arancelaria incorrecta", "Valor FOB mal calculado", "Descripción incompleta del producto", "Faltan permisos o certificados",
  "Datos del importador incorrectos", "Peso o cantidad no coincide con los documentos", "Factura sin firma o mal elaborada",
];

export const TIPS = [
  ["Empieza pequeño", "La primera exportación puede ser una muestra."], ["Calcula bien los costos", "Incluye todos los gastos logísticos."],
  ["Protege tu cobro", "Carta de crédito en los primeros embarques."], ["Certifica tu producto", "Las certificaciones abren mercados."],
  ["Documenta todo", "Contratos, correos y acuerdos por escrito."], ["Busca asesoría", "PromPerú ofrece consultores gratuitos."],
];

export const RESOURCES = [
  { name: "PromPerú", url: "https://www.promperu.gob.pe", text: "Capacitaciones, ferias y contactos comerciales" },
  { name: "SUNAT", url: "https://www.sunat.gob.pe", text: "Trámites aduaneros, consulta de DUA, SIGAD" },
  { name: "SIICEX", url: "https://www.siicex.gob.pe", text: "Información de exportación y estadísticas" },
  { name: "SENASA", url: "https://www.senasa.gob.pe", text: "Certificaciones agrícolas y fitosanitarias" },
  { name: "DIGESA", url: "https://www.digesa.minsa.gob.pe", text: "Registro sanitario de alimentos" },
  { name: "TradeMap", url: "https://www.trademap.org", text: "Estadísticas de comercio internacional" },
  { name: "MINCETUR", url: "https://www.gob.pe/mincetur", text: "Política comercial y TLC" },
  { name: "Cámara de Lima", url: "https://www.camaralima.org.pe", text: "Certificados de origen y asesoría" },
];

/** Límite del régimen simplificado Exporta Fácil indicado en la guía. */
export const EXPORTA_FACIL_MAX_USD = 5000;
