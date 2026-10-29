/**
 * Modelos de documentos de exportación (bilingües ES / EN) rellenados con los
 * datos de una orden internacional del ERP. Son modelos de referencia: los
 * certificados y documentos de transporte oficiales los emiten las entidades
 * correspondientes.
 */

export const MISSING = "[completar]";

export type Bi = [es: string, en: string];
export type Block =
  | { kind: "kv"; title?: Bi; rows: [Bi, string][] }
  | { kind: "table"; title?: Bi; head: Bi[]; rows: string[][]; foot?: [Bi, string][] }
  | { kind: "text"; title?: Bi; paragraphs: string[] }
  | { kind: "clauses"; title?: Bi; items: { title: Bi; en: string; es: string }[] }
  | { kind: "sign"; parties: string[] };

export interface DocModel {
  id: string;
  title: Bi;
  ref: string;
  purpose: string;
  /** Tipo de requisito de la orden al que puede adjuntarse (solo documentos que emite el propio exportador). */
  attachTo?: "FACTURA_COMERCIAL" | "PACKING_LIST" | "CONTRATO";
  /** Aviso cuando el documento oficial lo emite un tercero. */
  issuedBy?: string;
  blocks: Block[];
}

export const COMPANY = {
  name: "Don Pimentón S.A.C. (demo)",
  ruc: "RUC " + MISSING,
  address: "Arequipa, Perú",
  email: "exportaciones@donpimenton.pe",
  phone: MISSING,
  web: MISSING,
};

export const PRODUCT = {
  es: "Páprika deshidratada y molida (Capsicum annuum L.)",
  en: "Ground dried paprika (Capsicum annuum L.)",
  hs: "0904.22 — verificar la subpartida nacional con el agente de aduanas",
  packEs: "Sacos de polipropileno laminado de 25 kg netos",
  packEn: "25 kg net laminated polypropylene bags",
};

const fmtN = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (v?: string | null) => (v ? String(v).slice(0, 10) : MISSING);
const today = () => new Date().toISOString().slice(0, 10);

export interface Ctx {
  order: any;
  /** trazabilidad del lote (opcional, requiere permiso de inventario) */
  trace?: any | null;
}

function base(ctx: Ctx) {
  const o = ctx.order;
  const net = Number(o.netWeightKg), gross = Number(o.grossWeightKg), amount = Number(o.amount);
  const bags = Math.round(net / 25);
  const unit = net ? amount / net : 0;
  const cur = o.currency as string;
  const insp = ctx.trace?.inspections?.filter((i: any) => i.status === "APROBADO").slice(-1)[0];
  const buyer = o.customer ?? {};
  return {
    o, net, gross, amount, bags, unit, cur, insp, buyer,
    lot: o.lot?.code ?? MISSING,
    incoterm: `${o.incoterm} (${o.incotermVersion})`,
    buyerName: buyer.name ?? MISSING,
    buyerAddr: [buyer.address, buyer.city, buyer.country].filter(Boolean).join(", ") || MISSING,
    buyerTax: buyer.documentNumber ? `${buyer.documentType} ${buyer.documentNumber}` : MISSING,
    contact: buyer.contact ?? MISSING,
    partner: o.partner?.name,
    port: "Callao / Matarani, Perú — " + MISSING,
  };
}

export function buildModels(ctx: Ctx): DocModel[] {
  const b = base(ctx);
  const o = b.o;
  const ref = (p: string) => `${p}-${o.code}`;
  const money = (v: number) => `${b.cur} ${fmtN(v)}`;
  const partyRows: [Bi, string][] = [
    [["Exportador", "Exporter / Sender"], `${COMPANY.name} · ${COMPANY.ruc} · ${COMPANY.address}`],
    [["Importador", "Importer / Consignee"], `${b.buyerName} · ${b.buyerTax} · ${b.buyerAddr}`],
  ];
  if (o.mode === "INDIRECTA" && b.partner) partyRows.push([["Socio exportador", "Export partner"], b.partner]);

  const quality = b.insp
    ? `Humedad / Moisture ${b.insp.moisturePct ?? MISSING} % · Color ${b.insp.astaColor ?? MISSING} ASTA · Granulometría / Mesh ${b.insp.granulometry ?? MISSING} % ${b.insp.granulometryMesh ?? ""} · Microbiología / Microbiology ${b.insp.microbiological} · Contaminantes / Contaminants ${b.insp.contaminants}`
    : "Según certificado de análisis (COA) del lote / As per the lot Certificate of Analysis — " + MISSING;

  const goodsTable = (withPrice: boolean): Block => ({
    kind: "table",
    title: ["Detalle de la mercancía", "Description of goods"],
    head: withPrice
      ? [["Cantidad", "Quantity"], ["Descripción", "Description"], ["Partida", "HS code"], ["Precio unit.", "Unit price"], ["Total", "Total value"]]
      : [["Bultos", "Packages"], ["Descripción", "Description"], ["Peso neto", "Net weight"], ["Peso bruto", "Gross weight"], ["Dimensiones", "Dimensions"]],
    rows: withPrice
      ? [[`${fmtN(b.net, 0)} kg (${b.bags} × 25 kg)`, `${PRODUCT.en} / ${PRODUCT.es} — Lot ${b.lot}`, "0904.22", `${money(b.unit)}/kg`, money(b.amount)]]
      : [[`${b.bags} bags / sacos`, `${PRODUCT.en} — Lot ${b.lot}`, `${fmtN(b.net, 0)} kg`, `${fmtN(b.gross, 0)} kg`, "60 × 40 × 15 cm / saco — " + MISSING]],
    foot: withPrice ? [[["Total", "Total " + b.cur], money(b.amount)]] : [[["Total", "Total"], `${b.bags} bags · ${fmtN(b.net, 0)} kg net · ${fmtN(b.gross, 0)} kg gross`]],
  });

  const models: DocModel[] = [
    {
      id: "carta", title: ["Carta de presentación", "Letter of introduction"], ref: ref("LET"),
      purpose: "Primer contacto con el comprador: presenta la empresa, el producto, la propuesta de valor y los datos de contacto (paso 6).",
      blocks: [
        { kind: "kv", rows: [[["Fecha", "Date"], today()], [["Para", "To"], `${b.contact} — ${b.buyerName}, ${b.buyerAddr}`]] },
        { kind: "text", title: ["Cuerpo (inglés)", "Body"], paragraphs: [
          `Dear ${b.contact === MISSING ? "Sir or Madam" : b.contact},`,
          `It is an honor to introduce ${COMPANY.name}, a family agro-industrial company from Arequipa, Peru, dedicated to growing, dehydrating and milling high-quality paprika. We control the whole process — from our own fields to packing — which allows us to offer full lot traceability.`,
          `Our ground dried paprika is packed in ${PRODUCT.packEn}, and every lot is released with a Certificate of Analysis (moisture, ASTA colour, particle size, microbiology and contaminants). Lot data and quality certificates are registered on a blockchain traceability ledger, so your team can independently verify each shipment.`,
          `We would be pleased to be considered in your supplier database and to send you samples, our technical data sheet and a formal quotation.`,
          "Sincerely,",
        ] },
        { kind: "text", title: ["Versión en español", "Spanish version"], paragraphs: [
          `Es un honor presentarle a ${COMPANY.name}, empresa agroindustrial familiar de Arequipa (Perú) dedicada al cultivo, deshidratado y molienda de páprika de alta calidad, con trazabilidad completa de cada lote desde el campo hasta el envasado.`,
          "Cada lote se libera con su certificado de análisis y se registra en una plataforma de trazabilidad blockchain para que el comprador pueda verificarlo. Quedamos atentos para enviar muestras, ficha técnica y cotización formal.",
        ] },
        { kind: "kv", rows: [[["Firma", "Signature"], `Martha Torres — Gerencia General / General Manager`], [["Contacto", "Contact"], `${COMPANY.email} · ${COMPANY.phone}`], [["Adjuntos", "Enclosure(s)"], "Ficha técnica / Technical data sheet · Tarjeta comercial / Export commercial card"]] },
      ],
    },
    {
      id: "cotizacion", title: ["Cotización internacional", "International quotation"], ref: ref("QUO"),
      purpose: "Oferta formal con producto, partida, precio en moneda extranjera, INCOTERM, forma de pago, plazos y validez (paso 7).",
      blocks: [
        { kind: "kv", title: ["Partes", "Parties"], rows: partyRows },
        goodsTable(true),
        { kind: "kv", title: ["Condiciones", "Terms"], rows: [
          [["País de origen", "Country of origin"], "Perú / Peru"], [["INCOTERM", "INCOTERM"], b.incoterm],
          [["Puerto de embarque", "Port of loading"], b.port], [["Destino", "Destination"], o.destinationCountry],
          [["Forma de pago", "Payment terms"], "Carta de crédito irrevocable o pago condicionado vía Smart Contract / Irrevocable L/C or smart-contract escrow — " + MISSING],
          [["Plazo de entrega", "Delivery time"], o.etd ? `ETD ${day(o.etd)}` : MISSING], [["Validez", "Validity"], "30 días / 30 days"],
        ] },
        { kind: "sign", parties: [`${COMPANY.name} — Firma y sello / Signature and stamp`] },
      ],
    },
    {
      id: "ficha", title: ["Ficha técnica", "Technical data sheet"], ref: ref("TDS"),
      purpose: "Acompaña la cotización con las características técnicas, presentación y aspectos comerciales del producto.",
      blocks: [
        { kind: "kv", rows: [
          [["Producto", "Product name"], `${PRODUCT.es} / ${PRODUCT.en}`], [["Nombre científico", "Scientific name"], "Capsicum annuum L."],
          [["Partida arancelaria", "HS code"], PRODUCT.hs], [["Lote de referencia", "Reference lot"], b.lot],
          [["Características de calidad", "Quality characteristics"], quality],
          [["Especificaciones", "Specifications"], "Según especificación acordada con el cliente (configurable en el ERP) / As per the customer specification — " + MISSING],
          [["Características físicas", "Physical characteristics"], "Polvo fino de color rojo intenso, aroma característico / Fine bright-red powder, characteristic aroma"],
          [["Presentación", "Commercial presentation"], `${PRODUCT.packEs} / ${PRODUCT.packEn}`],
          [["Vida útil", "Shelf life"], "18 meses en lugar fresco y seco / 18 months in a cool, dry place"],
          [["Origen", "Origin"], "Arequipa, Perú"], [["Certificaciones", "Certifications"], "HACCP / BPM / otros — " + MISSING],
        ] },
      ],
    },
    {
      id: "tarjeta", title: ["Tarjeta comercial de exportación", "Export commercial card"], ref: ref("ECC"),
      purpose: "Resumen comercial de una página para ferias, correos y ruedas de negocio.",
      blocks: [
        { kind: "kv", title: ["Información de venta", "Sales information"], rows: [
          [["Producto", "Product"], PRODUCT.en], [["Partida", "HS code"], "0904.22"], [["Transporte", "Mode of transport"], "Marítimo / Ocean freight"],
          [["Precio referencial", "Reference price"], `${money(b.unit)}/kg ${o.incoterm}`], [["Forma de pago", "Payment"], "L/C · Smart Contract escrow"],
          [["Tiempo de entrega", "Delivery time"], "15–30 días tras la orden / 15–30 days after order"],
        ] },
        { kind: "kv", title: ["Descripción del producto", "Product description"], rows: [
          [["Calidad", "Quality"], quality], [["Empaque", "Packaging"], PRODUCT.packEn], [["Trazabilidad", "Traceability"], "Lote registrado en blockchain (hash de datos y del COA) / Lot registered on blockchain"],
        ] },
        { kind: "kv", title: ["Contacto", "Contact us"], rows: [[["Empresa", "Company"], COMPANY.name], [["Correo", "E-mail"], COMPANY.email], [["Web", "Web"], COMPANY.web]] },
      ],
    },
    {
      id: "factura", title: ["Factura comercial (proforma)", "Commercial invoice (pro forma)"], ref: ref("INV"), attachTo: "FACTURA_COMERCIAL",
      purpose: "Documento base del despacho: datos legales de las partes, descripción, valores e INCOTERM. La factura definitiva debe emitirse como comprobante electrónico autorizado.",
      blocks: [
        { kind: "kv", title: ["Partes", "Parties"], rows: [...partyRows, [["Fecha", "Date"], today()], [["N.º de factura", "Invoice No."], MISSING]] },
        goodsTable(true),
        { kind: "kv", title: ["Condiciones", "Terms"], rows: [[["INCOTERM", "INCOTERM"], b.incoterm], [["Puerto de embarque", "Port of loading"], b.port], [["País de destino", "Destination"], o.destinationCountry], [["Forma de pago", "Payment terms"], MISSING], [["Moneda", "Currency"], b.cur]] },
        { kind: "sign", parties: ["Firma y sello del exportador / Exporter signature and stamp"] },
      ],
    },
    {
      id: "packing", title: ["Lista de empaque", "Packing list"], ref: ref("PKL"), attachTo: "PACKING_LIST",
      purpose: "Detalla el contenido, cantidad, pesos y dimensiones de cada bulto; debe coincidir con la factura.",
      blocks: [
        { kind: "kv", title: ["Partes", "Parties"], rows: [...partyRows, [["Factura relacionada", "Related invoice"], MISSING], [["Contenedor", "Container No."], MISSING]] },
        goodsTable(false),
        { kind: "kv", rows: [[["Marcas", "Shipping marks"], `DON PIMENTÓN · ${b.lot} · ${o.destinationCountry} · BAG 1–${b.bags}`]] },
        { kind: "sign", parties: ["Firma del exportador / Exporter signature"] },
      ],
    },
    {
      id: "origen", title: ["Solicitud de certificado de origen", "Certificate of origin request"], ref: ref("COO"),
      issuedBy: "El certificado de origen lo emite una entidad autorizada (p. ej. Cámara de Comercio de Lima). Este modelo solo reúne los datos para solicitarlo.",
      purpose: "Datos para tramitar el certificado de origen y acceder a preferencias arancelarias (TLC).",
      blocks: [
        { kind: "kv", rows: [
          ...partyRows, [["Producto", "Goods"], `${PRODUCT.en} — HS 0904.22`], [["Cantidad", "Quantity"], `${fmtN(b.net, 0)} kg net / ${b.bags} bags`],
          [["Criterio de origen", "Origin criterion"], "Totalmente obtenido en Perú / Wholly obtained in Peru — validar con la entidad emisora"],
          [["Acuerdo comercial", "Trade agreement"], `${o.destinationCountry}: ` + MISSING], [["Factura comercial", "Commercial invoice"], MISSING],
        ] },
      ],
    },
    {
      id: "bl", title: ["Instrucciones de embarque (Bill of Lading)", "Shipping instructions (Bill of Lading)"], ref: ref("SI"),
      issuedBy: "El Bill of Lading lo emite la naviera o el agente de carga. Este modelo son las instrucciones que se le entregan.",
      purpose: "Información para que el agente de carga emita el documento de transporte (paso 16).",
      blocks: [
        { kind: "kv", rows: [
          [["Embarcador", "Shipper"], `${COMPANY.name}, ${COMPANY.address}`], [["Consignatario", "Consignee"], `${b.buyerName}, ${b.buyerAddr}`],
          [["Notificar a", "Notify party"], b.contact], [["Puerto de carga", "Port of loading"], b.port], [["Puerto de descarga", "Port of discharge"], `${o.destinationCountry} — ` + MISSING],
          [["Buque / viaje", "Vessel / voyage"], MISSING], [["Contenedor y precinto", "Container & seal"], MISSING],
          [["Mercancía", "Description"], `${b.bags} bags ${PRODUCT.en}, HS 0904.22, lot ${b.lot}`], [["Pesos", "Weights"], `Net ${fmtN(b.net, 0)} kg · Gross ${fmtN(b.gross, 0)} kg`],
          [["Flete", "Freight"], ["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].includes(o.incoterm) ? "Prepagado / Prepaid" : "Por cobrar / Collect"],
          [["N.º de B/L", "B/L No."], "Lo asigna la naviera / Assigned by carrier"],
        ] },
      ],
    },
    {
      id: "contrato", title: ["Contrato de compraventa internacional", "International sales contract"], ref: ref("CTR"), attachTo: "CONTRATO",
      purpose: "Formaliza la operación: partes, producto, INCOTERM, pago, plazos e incumplimiento, con pago condicionado al Smart Contract (paso 11). Debe revisarlo un abogado especializado.",
      blocks: [
        { kind: "kv", title: ["Partes", "Parties"], rows: [...partyRows, [["Fecha y lugar", "Date and place"], `${today()} · Arequipa, Perú`]] },
        { kind: "clauses", title: ["Cláusulas", "Clauses"], items: [
          { title: ["1. Objeto", "Subject"], en: `The Seller sells and the Buyer buys ${fmtN(b.net, 0)} kg (${b.bags} bags of 25 kg) of ${PRODUCT.en}, lot ${b.lot}, under the specifications of the attached technical data sheet.`, es: `El Vendedor vende y el Comprador compra ${fmtN(b.net, 0)} kg (${b.bags} sacos de 25 kg) de ${PRODUCT.es}, lote ${b.lot}, según la ficha técnica adjunta.` },
          { title: ["2. Precio", "Price"], en: `Total price ${money(b.amount)} (${money(b.unit)}/kg), ${b.incoterm}.`, es: `Precio total ${money(b.amount)} (${money(b.unit)}/kg), ${b.incoterm}.` },
          { title: ["3. Calidad e inspección", "Quality and inspection"], en: "Each lot is delivered with a Certificate of Analysis. Its SHA-256 hash is registered on the PaprikaTraceability ledger; a lot rejected or in quarantine cannot be shipped.", es: "Cada lote se entrega con certificado de análisis cuyo hash SHA-256 se registra en PaprikaTraceability; un lote rechazado o en cuarentena no puede embarcarse." },
          { title: ["4. Entrega", "Delivery"], en: `Delivery under ${b.incoterm} at ${b.port}. Estimated shipment: ${day(o.etd)}.`, es: `Entrega en condición ${b.incoterm} en ${b.port}. Embarque estimado: ${day(o.etd)}.` },
          { title: ["5. Pago condicionado (Smart Contract)", "Conditional payment (Smart Contract)"], en: "The Buyer deposits the price in the PaprikaTradeAgreement escrow. Funds are released to the Seller only when (i) Quality records conformity of the lot, (ii) Logistics records delivery evidence and (iii) the Buyer confirms receipt. Alternatively, the parties may agree an irrevocable letter of credit.", es: "El Comprador deposita el precio en el contrato PaprikaTradeAgreement. Los fondos se liberan al Vendedor solo cuando (i) Calidad registra la conformidad del lote, (ii) Logística registra la evidencia de entrega y (iii) el Comprador confirma la recepción. Alternativamente se puede pactar carta de crédito irrevocable." },
          { title: ["6. Documentos", "Documents"], en: "Commercial invoice, packing list, certificate of origin, transport document (B/L), phytosanitary/sanitary certificates as required by the destination, and Certificate of Analysis.", es: "Factura comercial, lista de empaque, certificado de origen, documento de transporte (B/L), certificados sanitarios/fitosanitarios exigidos por el destino y certificado de análisis." },
          { title: ["7. Incumplimiento y cancelación", "Breach and cancellation"], en: "If the lot is rejected, or delivery is not confirmed before the deadline, the Buyer may cancel and the escrow refunds the deposit. Late delivery penalties: " + MISSING, es: "Si el lote es rechazado o la entrega no se confirma antes de la fecha límite, el Comprador puede cancelar y el contrato reembolsa el depósito. Penalidades por demora: " + MISSING },
          { title: ["8. Controversias", "Disputes"], en: "Disputes are first handled through the escrow dispute procedure (arbiter); otherwise, by arbitration under " + MISSING + ".", es: "Las controversias se tratan primero mediante el procedimiento de disputa del contrato (árbitro); en su defecto, mediante arbitraje según " + MISSING + "." },
          { title: ["9. Ley aplicable", "Governing law"], en: "United Nations Convention on Contracts for the International Sale of Goods (CISG) and " + MISSING + ".", es: "Convención de las Naciones Unidas sobre los Contratos de Compraventa Internacional de Mercaderías (CISG) y " + MISSING + "." },
        ] },
        { kind: "sign", parties: [`El Vendedor / The Seller — ${COMPANY.name}`, `El Comprador / The Buyer — ${b.buyerName}`] },
      ],
    },
  ];
  return models;
}
