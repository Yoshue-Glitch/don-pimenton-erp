"use client";
import * as React from "react";
import Link from "next/link";
import {
  FileSignature, ArrowUpRight, PlayCircle, Link2, CheckCircle2, CircleDashed, CircleDot, Hand, Info, FileText, Download, Paperclip, Eye,
  Ship, ShieldCheck, AlertTriangle, Lightbulb, ExternalLink, Route,
} from "lucide-react";
import { api, newKey } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, date, cn, short } from "@/lib/utils";
import { Card, CardHeader, CardBody, StatusBadge, Badge, Notice, Tabs, Select, Field, Button, Modal, Mono, Empty, Loading } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { useAuth, useToast } from "@/components/providers";
import { PHASES, SMART_LINKS, DUA_PROCESS, DUA_CHANNELS, AGENT_DOCS, COMMON_ERRORS, TIPS, RESOURCES, EXPORTA_FACIL_MAX_USD, type StepCheck } from "./exportGuide";
import { buildModels, type DocModel } from "./docModels";
import { DocPreview } from "./DocPreview";
import { modelToDocx, sha256Hex, docxFile } from "./docxExport";

const usd = (v: number) => `US$ ${Math.round(v).toLocaleString("en-US")}`;
type State = "ok" | "partial" | "todo" | "manual" | "info";
const SHIPPED = ["EMBARCADA", "EN_TRANSITO", "ENTREGADA", "COBRADA"];

/** Estado de cada paso de la guía según la evidencia registrada en el ERP (nunca se da por cumplido sin evidencia). */
function stepStatus(check: StepCheck, o: any, agreement: any): { state: State; note: string } {
  const req = (t: string) => o.requirements.find((r: any) => r.docType === t);
  const reqState = (t: string, label: string): { state: State; note: string } => {
    const r = req(t);
    if (!r) return { state: "info", note: `${label}: no exigido para la modalidad ${o.mode.toLowerCase()}` };
    if (r.status === "VERIFICADO") return { state: "ok", note: `${label} verificado con evidencia` };
    if (r.status === "NO_APLICA") return { state: "ok", note: `${label}: no aplica (${r.notes ?? "justificado"})` };
    if (r.status === "ADJUNTADO") return { state: "partial", note: `${label} adjuntado, pendiente de verificación` };
    return { state: "todo", note: `${label} pendiente de evidencia` };
  };
  const mandatory = o.requirements.filter((r: any) => r.mandatory);
  const done = mandatory.filter((r: any) => ["VERIFICADO", "NO_APLICA"].includes(r.status)).length;
  switch (check) {
    case "product": return o.lot ? (o.lot.qualityStatus === "APROBADO" ? { state: "ok", note: `Lote ${o.lot.code} aprobado por Calidad${o.lot.chainStatus === "REGISTRADO" ? " y registrado en blockchain" : ""}` } : { state: "partial", note: `Lote ${o.lot.code} en estado ${o.lot.qualityStatus}` }) : { state: "todo", note: "Asignar un lote aprobado por Calidad a la orden" };
    case "market": return { state: "info", note: `Destino ${o.destinationCountry}: validar demanda, aranceles y requisitos con TradeMap, SIICEX y PromPerú` };
    case "company": return { state: "manual", note: "RUC activo, registro de exportador y Clave SOL se gestionan ante SUNAT (fuera del ERP)" };
    case "permits": return reqState("CERTIFICADO", "Certificados aplicables");
    case "letter": return { state: "manual", note: "Use el modelo de carta de presentación (pestaña Modelos)" };
    case "quote": return { state: "ok", note: `Oferta registrada: ${o.currency === "USD" ? usd(Number(o.amount)) : money(o.amount, o.currency)} · ${o.incoterm}` };
    case "buyers": return { state: "ok", note: `Comprador identificado: ${o.customer.name} (${o.customer.country})` };
    case "incoterm": return { state: "ok", note: `${o.incoterm} · ${o.incotermVersion}` };
    case "payment": return agreement ? { state: "ok", note: `Pago condicionado con Smart Contract ${agreement.code} (${agreement.status.toLowerCase()})` } : { state: "manual", note: "Definir: carta de crédito para el primer embarque o pago condicionado con Smart Contract" };
    case "contract": return req("CONTRATO") ? reqState("CONTRATO", "Contrato con el socio") : { state: "manual", note: "Use el modelo de contrato de compraventa internacional" };
    case "services": return o.mode === "INDIRECTA" && o.partner ? { state: "ok", note: `Socio exportador: ${o.partner.name} (agente de carga y aduanas a su cargo)` } : { state: "manual", note: "Contratar agente de carga, agente de aduanas y seguro" };
    case "documents": return mandatory.length ? { state: done === mandatory.length ? "ok" : done ? "partial" : "todo", note: `${done} de ${mandatory.length} documentos obligatorios con evidencia verificada` } : { state: "info", note: "Sin documentos obligatorios" };
    case "dua": {
      const amt = Number(o.amount) * (o.currency === "USD" ? 1 : 1 / Number(o.exchangeRate || 1));
      if (o.mode === "INDIRECTA") return { state: "info", note: "La DUA la tramita el socio exportador como exportador directo" };
      if (amt <= EXPORTA_FACIL_MAX_USD) return { state: "info", note: `Hasta USD ${EXPORTA_FACIL_MAX_USD.toLocaleString("en-US")} FOB puede evaluarse Exporta Fácil (envíos de hasta 30 kg)` };
      return reqState("DOC_ADUANERO", "Declaración aduanera (DUA)");
    }
    case "dua-process": return SHIPPED.includes(o.status) ? { state: "ok", note: "Levante autorizado (embarque registrado)" } : { state: "todo", note: "Pendiente: transmisión, numeración, canal y levante" };
    case "shipment": return SHIPPED.includes(o.status) ? { state: "ok", note: `Estado ${o.status.toLowerCase()}${o.etd ? ` · ETD ${date(o.etd)}` : ""}` } : { state: "todo", note: o.etd ? `Embarque previsto ${date(o.etd)}` : "Fecha de embarque por definir" };
    case "collection": {
      const ar = o.receivables ?? [];
      if (!ar.length) return { state: "todo", note: "La cuenta por cobrar se genera al embarcar" };
      const paid = ar.every((r: any) => r.status === "COBRADO");
      return { state: paid ? "ok" : "partial", note: paid ? "Cobro completo" : `Por cobrar: ${ar.map((r: any) => r.code).join(", ")}` };
    }
    case "postsale": return ["ENTREGADA", "COBRADA"].includes(o.status) ? { state: "manual", note: "Confirmar satisfacción y registrar reclamos (disputa del contrato si aplica)" } : { state: "todo", note: "Tras la entrega" };
    case "smart": return agreement ? { state: agreement.status === "EJECUTADO" ? "ok" : "partial", note: `Acuerdo ${agreement.code}: ${agreement.status.toLowerCase()}` } : { state: "todo", note: "Sin acuerdo inteligente para este lote" };
  }
}

const STATE_UI: Record<State, { icon: any; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: "text-agro dark:text-emerald-300", label: "Con evidencia" },
  partial: { icon: CircleDot, cls: "text-amberx dark:text-amber-300", label: "En curso" },
  todo: { icon: CircleDashed, cls: "text-paprika dark:text-red-300", label: "Por gestionar" },
  manual: { icon: Hand, cls: "text-bluex dark:text-sky-300", label: "Gestión externa" },
  info: { icon: Info, cls: "text-muted", label: "Referencia" },
};

export default function SmartContractPage() {
  const [tab, setTab] = React.useState<"resumen" | "ruta" | "modelos" | "aduana">("resumen");
  const exp = useApi<any>("/exports/orders?pageSize=50");
  const orders = useApi<any>("/sales/orders?status=RESERVADO&pageSize=50");
  const status = useApi<any>("/blockchain/status");
  const all = (exp.data?.items ?? []).filter((r: any) => r.status !== "ANULADA");
  const [sel, setSel] = React.useState<string>("");
  React.useEffect(() => { if (!sel && all.length) setSel(String(all[0].id)); }, [all, sel]);
  const pendingExports = all.filter((r: any) => !["ENTREGADA", "COBRADA"].includes(r.status));
  const reserved = (orders.data?.items ?? []).filter((o: any) => !o.agreements.length);
  const s = status.data;

  return (
    <div className="space-y-[18px]">
      <section className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_85%_20%,rgba(165,42,42,.6),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] px-6 py-10 text-white sm:px-12 sm:py-14">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth=".5" className="absolute -bottom-16 -right-10 w-[360px] opacity-[.12]" aria-hidden>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-[.26em] text-[#F2C9C0]">Departamento de Exportaciones · Trazabilidad</span>
        <h1 className="my-4 max-w-[17ch] font-display text-[clamp(30px,4.6vw,50px)] font-bold leading-[1.08]">Exporta con <i className="font-medium text-[#F2B8AC]">contratos inteligentes</i></h1>
        <p className="mb-8 max-w-[600px] text-[15.5px] leading-relaxed text-white/85">Cada exportación sigue los 6 pasos oficiales — preparación, formalización, contacto comercial, negociación, logística y cobro — y sus documentos alimentan el contrato inteligente: el pago solo se libera cuando la calidad, la entrega y la confirmación del comprador quedan verificadas.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/blockchain" className="inline-flex items-center gap-3 rounded-xl bg-white px-8 py-[18px] text-base font-extrabold text-forest shadow-[0_18px_40px_-14px_rgba(0,0,0,.5)] transition-all hover:-translate-y-0.5 hover:bg-paprika-50">
            <FileSignature className="h-[22px] w-[22px] text-paprika" />Smart Contract<ArrowUpRight className="h-[22px] w-[22px] text-paprika" />
          </Link>
          <button onClick={() => setTab("ruta")} className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-[18px] font-bold text-white hover:bg-white/10"><Route className="h-5 w-5" />Ruta de exportación</button>
          <Link href="/demo" className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-[18px] font-bold text-white hover:bg-white/10"><PlayCircle className="h-5 w-5" />Ver la demostración</Link>
        </div>
        <p className="relative mt-6 flex items-center gap-2 text-xs text-white/60"><Link2 className="h-3.5 w-3.5" />
          {s ? (s.connected ? `Red local conectada · chainId ${s.chainId} · bloque #${s.blockNumber} · fondos de prueba sin valor real` : "Red blockchain local no disponible en este momento") : "Consultando la red local…"}
        </p>
      </section>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: "resumen", label: "Resumen" }, { id: "ruta", label: "Ruta de exportación (18 pasos)" }, { id: "modelos", label: "Modelos de documentos y contrato" }, { id: "aduana", label: "DUA, errores y recursos" }]} />

      {tab !== "resumen" && (
        <Card><CardBody className="flex flex-wrap items-end gap-4">
          <Field label="Orden internacional" className="min-w-[260px] flex-1 sm:max-w-md">
            <Select value={sel} onChange={(e) => setSel(e.target.value)}>
              {all.length === 0 && <option value="">Sin órdenes de exportación</option>}
              {all.map((r: any) => <option key={r.id} value={r.id}>{r.code} · {r.customer.name} · {r.destinationCountry} ({r.mode.toLowerCase()})</option>)}
            </Select>
          </Field>
          <p className="pb-2 text-xs text-muted">La ruta y los modelos se completan con los datos de la orden, su lote, sus requisitos documentales y el acuerdo inteligente.</p>
        </CardBody></Card>
      )}

      {tab === "resumen" && <Summary pendingExports={pendingExports} reserved={reserved} />}
      {tab !== "resumen" && sel && <OrderTabs id={sel} tab={tab} />}
      {tab !== "resumen" && !sel && !exp.loading && <Empty title="No hay órdenes internacionales" hint="Registre una orden en Exportaciones para generar su ruta y documentos." />}
    </div>
  );
}

function Summary({ pendingExports, reserved }: { pendingExports: any[]; reserved: any[] }) {
  return (
    <>
      <div className="grid gap-[18px] md:grid-cols-3">
        {[["01", "Se pactan las condiciones", "Cotización y contrato fijan lote, cantidad, importe, INCOTERM y fecha límite; en el contrato inteligente no se pueden alterar."],
          ["02", "Se verifica el cumplimiento", "El COA del lote (hash en trazabilidad), el documento de transporte y la confirmación del importador se registran en el contrato."],
          ["03", "El pago se libera solo", "Con todas las condiciones cumplidas el contrato libera los fondos; si el lote es rechazado o falta la confirmación, el pago queda bloqueado."]].map(([n, t, d]) => (
          <div key={n} className="rounded-2xl border border-line bg-card p-[22px] shadow-card">
            <span className="font-display text-[30px] italic leading-none text-paprika">{n}</span>
            <h4 className="mb-1.5 mt-2.5 text-[15px] font-bold text-fg">{t}</h4>
            <p className="text-[13px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title="De los documentos al contrato inteligente" subtitle="Qué evidencia de la exportación verifica cada función de PaprikaTradeAgreement" />
        <Table rows={SMART_LINKS.map((x, i) => ({ ...x, id: i }))} columns={[
          { key: "doc", header: "Documento / evento", className: "whitespace-normal" }, { key: "fn", header: "Función", render: (r: any) => <Mono>{r.fn}</Mono> },
          { key: "actor", header: "Quién", render: (r: any) => r.actor }, { key: "effect", header: "Efecto en el contrato", className: "whitespace-normal text-muted" },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Embarques candidatos a Smart Contract" actions={<Link href="/exportaciones" className="text-xs font-semibold text-bluex">Ver exportaciones →</Link>} />
        <Table rows={pendingExports} empty={<CardBody><p className="text-sm text-muted">No hay embarques pendientes.</p></CardBody>} columns={[
          { key: "code", header: "Código", render: (r: any) => <Link href={`/exportaciones/${r.id}`} className="font-bold hover:underline">{r.code}</Link> },
          { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "d", header: "Destino", render: (r: any) => r.destinationCountry },
          { key: "i", header: "Incoterm", render: (r: any) => r.incoterm }, { key: "v", header: "Valor", align: "right", render: (r: any) => <b>{r.currency === "USD" ? usd(Number(r.amount)) : money(r.amount, r.currency)}</b> },
          { key: "docs", header: "Documentos", render: (r: any) => { const ok = r.requirements.filter((x: any) => ["VERIFICADO", "NO_APLICA"].includes(x.status)).length; return <Badge tone={ok === r.requirements.length ? "green" : "amber"}>{ok === r.requirements.length ? "Completo" : `${ok}/${r.requirements.length}`}</Badge>; } },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Pedidos nacionales listos para acuerdo inteligente" subtitle="Pedidos reservados de un único lote aprobado" />
        <Table rows={reserved} empty={<CardBody><p className="text-sm text-muted">No hay pedidos reservados sin acuerdo.</p></CardBody>} columns={[
          { key: "code", header: "Pedido", render: (r: any) => <Link href={`/ventas/pedidos/${r.id}`} className="font-bold hover:underline">{r.code}</Link> },
          { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "d", header: "Fecha", render: (r: any) => date(r.date) },
          { key: "t", header: "Total", align: "right", render: (r: any) => money(r.total, r.currency) },
          { key: "a", header: "", align: "right", render: (r: any) => <Link href={`/ventas/pedidos/${r.id}`} className="text-xs font-semibold text-bluex">Crear acuerdo →</Link> },
        ]} />
      </Card>
      <Notice>Los contratos se ejecutan en una red Ethereum local (Hardhat) con moneda de prueba sin valor económico. Para operar con dinero real se requeriría una red pública, billeteras propias de cada parte y una auditoría de seguridad de los contratos.</Notice>
    </>
  );
}

function OrderTabs({ id, tab }: { id: string; tab: "ruta" | "modelos" | "aduana" }) {
  const { can } = useAuth();
  const { data: o, loading, reload } = useApi<any>(`/exports/orders/${id}`);
  const ag = useApi<any[]>(can("blockchain.read") ? "/blockchain/agreements" : null);
  const trace = useApi<any>(o?.lot && can("inventory.read") ? `/inventory/lots/${o.lot.code}/trace` : null, [o?.lot?.code]);
  if (loading && !o) return <Loading />;
  if (!o) return null;
  const agreement = o.lot ? (ag.data ?? []).find((a: any) => a.lot.code === o.lot.code) : null;
  if (tab === "ruta") return <RoadMap o={o} agreement={agreement} />;
  if (tab === "modelos") return <Models o={o} trace={trace.data} onAttached={reload} />;
  return <Customs o={o} />;
}

function RoadMap({ o, agreement }: { o: any; agreement: any }) {
  const steps = PHASES.flatMap((p) => p.steps);
  const states = steps.map((st) => stepStatus(st.check, o, agreement));
  const ok = states.filter((x) => x.state === "ok").length;
  const pct = Math.round((ok / steps.length) * 100);
  const smart = stepStatus("smart", o, agreement);
  const SmartI = STATE_UI[smart.state].icon;
  return (
    <div className="space-y-[18px]">
      <Card><CardBody>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-[.14em] text-paprika">Trazabilidad de la exportación</p>
            <p className="text-lg font-extrabold text-fg">{o.code} · {o.customer.name} → {o.destinationCountry}</p>
            <p className="text-xs text-muted">{o.mode === "DIRECTA" ? "Exportación directa" : `Exportación indirecta vía ${o.partner?.name ?? "socio"}`} · {o.incoterm} ({o.incotermVersion}) · lote {o.lot?.code ?? "sin asignar"}</p>
          </div>
          <div className="min-w-[220px]">
            <p className="mb-1 text-right text-xs text-muted"><b className="text-fg">{ok}</b> de {steps.length} pasos con evidencia en el ERP</p>
            <div className="h-2.5 overflow-hidden rounded-full bg-soft"><i className="block h-full rounded-full bg-agro" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          {(Object.keys(STATE_UI) as State[]).map((k) => { const I = STATE_UI[k].icon; return <span key={k} className="flex items-center gap-1.5"><I className={cn("h-4 w-4", STATE_UI[k].cls)} />{STATE_UI[k].label}</span>; })}
        </div>
      </CardBody></Card>

      <div className="grid gap-[18px] xl:grid-cols-2">
        {PHASES.map((p) => (
          <Card key={p.n}>
            <div className="rounded-t-2xl bg-[linear-gradient(90deg,#1C3F2B,#2F6B45)] px-5 py-3 text-white"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#9DBFA6]">Fase {p.n}</p><p className="font-bold">{p.title}</p></div>
            <div className="divide-y divide-line">
              {p.steps.map((st) => {
                const r = stepStatus(st.check, o, agreement);
                const I = STATE_UI[r.state].icon;
                return (
                  <div key={st.n} className="flex gap-3 px-5 py-3.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paprika text-xs font-extrabold text-white">{st.n}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-fg">{st.title}</p><span className={cn("flex items-center gap-1 text-[11px] font-bold", STATE_UI[r.state].cls)}><I className="h-4 w-4" />{STATE_UI[r.state].label}</span></div>
                      <p className={cn("mt-0.5 text-xs", STATE_UI[r.state].cls)}>{r.note}</p>
                      <ul className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12px] text-muted sm:grid-cols-2">{st.items.map((it) => <li key={it}>✓ {it}</li>)}</ul>
                      {st.tip && <p className="mt-1.5 rounded-md bg-gold-50 px-2 py-1 text-[11px] text-amberx dark:bg-gold/10">{st.tip}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Smart Contract de la operación" icon={<FileSignature className="h-4 w-4" />} subtitle="Pago condicionado PaprikaTradeAgreement" actions={<Link href={agreement ? `/blockchain/acuerdos/${agreement.code}` : "/blockchain"}><Button size="sm" variant="secondary"><FileSignature className="h-4 w-4" />{agreement ? "Abrir acuerdo" : "Panel blockchain"}</Button></Link>} />
        <CardBody className="space-y-3">
          <p className={cn("flex items-center gap-2 text-sm font-bold", STATE_UI[smart.state].cls)}><SmartI className="h-4 w-4" />{smart.note}</p>
          {o.lot ? <p className="text-xs text-muted">Trazabilidad del lote: <Link href={`/inventario/lotes/${o.lot.code}`} className="font-semibold text-bluex">{o.lot.code}</Link> · calidad {o.lot.qualityStatus.toLowerCase()} · blockchain {o.lot.chainStatus.replace("_", " ").toLowerCase()}</p> : <Notice>Asigne un lote aprobado a la orden para vincular su certificado de calidad (hash) con el contrato.</Notice>}
          <ol className="grid gap-2 text-xs sm:grid-cols-3 xl:grid-cols-7">
            {SMART_LINKS.map((x, i) => <li key={i} className="rounded-lg border border-line p-2"><Mono>{x.fn}</Mono><p className="mt-1 text-muted">{x.doc}</p></li>)}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}

function Models({ o, trace, onAttached }: { o: any; trace: any; onAttached: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const models = React.useMemo(() => buildModels({ order: o, trace }), [o, trace]);
  const [open, setOpen] = React.useState<DocModel | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [hashes, setHashes] = React.useState<Record<string, string>>({});
  const canAttach = can("exports.write") && can("documents.write");
  const fileName = (m: DocModel) => `${m.ref}.docx`;

  const download = async (m: DocModel) => {
    setBusy(`d-${m.id}`);
    try {
      const blob = await modelToDocx(m);
      const h = await sha256Hex(blob);
      setHashes((x) => ({ ...x, [m.id]: h }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fileName(m); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("Modelo descargado", `${fileName(m)} · SHA-256 ${short(h, 10)}`);
    } catch (e: any) { toast.error("No se pudo generar el documento", e.message); } finally { setBusy(null); }
  };
  const attach = async (m: DocModel) => {
    const r = o.requirements.find((x: any) => x.docType === m.attachTo);
    if (!r) return;
    setBusy(`a-${m.id}`);
    try {
      const blob = await modelToDocx(m);
      const h = await sha256Hex(blob);
      const fd = new FormData();
      fd.append("file", docxFile(blob, fileName(m))); fd.append("title", `${m.title[0]} ${o.code}`); fd.append("type", m.attachTo!); fd.append("entityType", "export"); fd.append("entityId", o.code);
      const doc = await api("/documents", { form: fd, idempotencyKey: newKey() });
      await api(`/exports/requirements/${r.id}/attach`, { body: { documentId: doc.id } });
      setHashes((x) => ({ ...x, [m.id]: h }));
      toast.success("Adjuntado como evidencia", `${r.name} → pendiente de verificación · SHA-256 ${short(doc.sha256, 10)}${doc.sha256 === h ? " (coincide)" : ""}`);
      onAttached();
    } catch (e: any) { toast.error("No se pudo adjuntar", e.message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-[18px]">
      <Notice>Modelos de referencia bilingües (ES / EN) generados con los datos de {o.code}. Los campos marcados <mark className="rounded bg-amber-100 px-1 text-amber-900">[completar]</mark> deben llenarse antes de enviarlos. Los certificados y el Bill of Lading oficiales los emiten la entidad certificadora y la naviera; aquí solo se preparan sus datos. Al adjuntar, el requisito queda <b>ADJUNTADO</b> y debe verificarse en Exportaciones.</Notice>
      <div className="grid gap-[18px] md:grid-cols-2 xl:grid-cols-3">
        {models.map((m) => {
          const req = m.attachTo ? o.requirements.find((x: any) => x.docType === m.attachTo) : null;
          return (
            <Card key={m.id} className="flex flex-col">
              <CardHeader title={m.title[0]} subtitle={m.title[1]} icon={<FileText className="h-4 w-4" />} />
              <CardBody className="flex flex-1 flex-col gap-3">
                <p className="text-[12.5px] text-muted">{m.purpose}</p>
                {m.issuedBy && <p className="text-[11px] text-amberx">{m.issuedBy}</p>}
                {req && <p className="text-xs">Requisito de la orden: <b>{req.name}</b> <StatusBadge status={req.status} /></p>}
                {hashes[m.id] && <p className="text-[11px] text-muted">Huella SHA-256: <Mono>{short(hashes[m.id], 12)}</Mono></p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setOpen(m)}><Eye className="h-4 w-4" />Vista previa</Button>
                  <Button size="sm" variant="secondary" loading={busy === `d-${m.id}`} onClick={() => download(m)}><Download className="h-4 w-4" />Word</Button>
                  {req && canAttach && req.status !== "VERIFICADO" && <Button size="sm" loading={busy === `a-${m.id}`} onClick={() => attach(m)}><Paperclip className="h-4 w-4" />Adjuntar como evidencia</Button>}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} size="xl" title={open ? `${open.title[0]} / ${open.title[1]}` : ""} subtitle={open?.ref}
        footer={open && <><Button variant="outline" onClick={() => setOpen(null)}>Cerrar</Button><Button variant="secondary" loading={busy === `d-${open.id}`} onClick={() => download(open)}><Download className="h-4 w-4" />Descargar Word</Button></>}>
        {open && <DocPreview model={open} />}
      </Modal>
    </div>
  );
}

function Customs({ o }: { o: any }) {
  const req = o.requirements;
  const pending = req.filter((r: any) => r.mandatory && !["VERIFICADO", "NO_APLICA"].includes(r.status));
  const buyerOk = !!(o.customer.documentNumber && (o.customer.address || o.customer.city) && o.customer.country);
  const checks: { label: string; ok: boolean | null; note: string }[] = [
    { label: COMMON_ERRORS[0], ok: null, note: "Páprika molida: 0904.22 — confirmar la subpartida nacional con el agente de aduanas" },
    { label: COMMON_ERRORS[1], ok: o.incoterm === "FOB" ? true : null, note: o.incoterm === "FOB" ? "La orden ya está pactada en FOB" : `Pactada en ${o.incoterm}: calcular el valor FOB descontando flete y seguro` },
    { label: COMMON_ERRORS[2], ok: !!o.product, note: o.product ? `Producto: ${o.product.name}` : "Falta el producto" },
    { label: COMMON_ERRORS[3], ok: pending.length === 0, note: pending.length ? `Pendientes: ${pending.map((p: any) => p.name).join("; ")}` : "Todos los requisitos obligatorios verificados" },
    { label: COMMON_ERRORS[4], ok: buyerOk, note: buyerOk ? `${o.customer.name} · ${o.customer.documentNumber} · ${o.customer.city ?? ""} ${o.customer.country}` : "Completar documento, dirección y país del importador" },
    { label: COMMON_ERRORS[5], ok: Number(o.grossWeightKg) >= Number(o.netWeightKg), note: `Neto ${Number(o.netWeightKg).toLocaleString("es-PE")} kg · bruto ${Number(o.grossWeightKg).toLocaleString("es-PE")} kg (deben coincidir en factura, packing list y DUA)` },
    { label: COMMON_ERRORS[6], ok: null, note: "La factura modelo incluye espacio para firma y sello; revisar antes de enviarla al agente" },
  ];
  const chan: Record<string, string> = { green: "bg-[#A7CDB1]/60 text-forest", orange: "bg-[#F6B482]/60 text-[#7A3B00]", red: "bg-[#E8908A]/60 text-[#6E1B1B]" };
  return (
    <div className="space-y-[18px]">
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Card>
          <CardHeader title="Proceso de la DUA" icon={<Ship className="h-4 w-4" />} subtitle="Declaración Única de Aduanas (antes DAM) · régimen 40, exportación definitiva" />
          <CardBody className="space-y-3">
            {DUA_PROCESS.map((p) => <div key={p.k} className="flex gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-forest text-xs font-bold text-white">{p.k}</span><div><p className="text-sm font-bold text-fg">{p.title}</p><p className="text-xs text-muted">{p.text}</p></div></div>)}
            <div className="space-y-2 pt-1">{DUA_CHANNELS.map((c) => <div key={c.name} className={cn("rounded-lg px-3 py-2 text-xs", chan[c.color])}><b>{c.name}:</b> {c.text}</div>)}</div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Documentos que necesita el agente de aduanas" icon={<FileText className="h-4 w-4" />} subtitle="Entregarlos mínimo 2–3 días antes del embarque" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-paprika">Obligatorios</p><ul className="space-y-1 text-[12.5px]">{AGENT_DOCS.mandatory.map((d) => <li key={d}>✓ {d}</li>)}</ul></div>
            <div><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-paprika">Según el producto</p><ul className="space-y-1 text-[12.5px]">{AGENT_DOCS.byProduct.map((d) => <li key={d}>✓ {d}</li>)}</ul></div>
            <div className="sm:col-span-2"><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Requisitos registrados en {o.code}</p>
              <div className="flex flex-wrap gap-2">{req.map((r: any) => <span key={r.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11.5px]">{r.name}<StatusBadge status={r.status} /></span>)}</div>
            </div>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Errores comunes que retrasan la DUA" icon={<AlertTriangle className="h-4 w-4" />} subtitle={`Revisión de ${o.code} con los datos registrados`} />
        <div className="divide-y divide-line">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-3 px-5 py-2.5 text-sm">
              {c.ok === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-agro" /> : c.ok === false ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-paprika" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-bluex" />}
              <div><p className="font-semibold text-fg">{c.label}</p><p className="text-xs text-muted">{c.note}</p></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-[18px] xl:grid-cols-2">
        <Card>
          <CardHeader title="Tips finales" icon={<Lightbulb className="h-4 w-4" />} />
          <CardBody className="grid gap-3 sm:grid-cols-2">{TIPS.map(([t, d]) => <div key={t} className="rounded-xl bg-bluex-50 p-3 dark:bg-bluex/15"><p className="text-sm font-bold text-bluex dark:text-sky-300">✓ {t}</p><p className="text-xs text-fg/80">{d}</p></div>)}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Recursos clave para exportar" icon={<ShieldCheck className="h-4 w-4" />} subtitle="Portales oficiales y de referencia" />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {RESOURCES.map((r) => <a key={r.name} href={r.url} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-line p-3 transition-colors hover:border-agro"><p className="flex items-center gap-1 text-sm font-bold text-fg">{r.name}<ExternalLink className="h-3 w-3 text-muted" /></p><p className="text-[11px] text-bluex">{r.url.replace("https://", "")}</p><p className="text-xs text-muted">{r.text}</p></a>)}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
