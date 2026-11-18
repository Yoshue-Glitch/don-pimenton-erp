"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bot, Download, FileCheck2, Anchor, Play, ShieldCheck, Coins, CreditCard, ListChecks, Ship, QrCode, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { num, date, dateTime, money, short } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, KeyValue, Notice, Badge, Loading, ErrorBox, Mono, Tabs, Input, Field } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can, useAuth, useToast } from "@/components/providers";
import { ShipMap } from "@/components/ShipMap";
import { FlowPipeline, EventLog, agreementNote } from "@/components/ExportFlow";

const usd = (v: any) => money(v, "USD");

export default function ShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: s, error, reload } = useApi<any>(`/trade/shipments/${id}`);
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = React.useState<"docs" | "aduana" | "cumplimiento" | "costos" | "pagos" | "paletas">("docs");
  const [customs, setCustoms] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setInterval(reload, 3000); return () => clearInterval(t); }, [reload]);
  if (error) return <ErrorBox message={error} />;
  if (!s) return <Loading />;
  const run = async (label: string, path: string, body: any = {}, method = "POST") => {
    setBusy(label);
    try { await api(path, { method, body }); toast.success(label); reload(); } catch (e: any) { toast.error(label, e.message); } finally { setBusy(null); }
  };
  const light = s.customs;
  return (
    <div className="space-y-4">
      <Link href="/comex" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Pedidos y paletas</Link>
      <PageHeader area={`Embarque · ${s.source === "PORTAL" ? "pedido del portal" : "pedido del ERP"} · operación ${s.projected ? "PROYECTADA" : "REAL"}`} title={`${s.code} · ${s.importer}`}
        subtitle={`${s.pallets} paleta(s) · ${num(s.cases)} cajas · ${num(s.jars)} frascos de 113 g · ${s.incoterm} ${s.incotermVersion} ${s.incotermPlace} · entrega ${date(s.deliveryDate)}`}
        actions={<>
          <StatusBadge status={s.status} />
          <Can perm="trade.write"><Button size="sm" variant={s.autopilot ? "secondary" : "outline"} onClick={() => run(s.autopilot ? "Piloto automático desactivado" : "Piloto automático activado", `/trade/shipments/${s.id}/autopilot`, { enabled: !s.autopilot })}><Bot className="h-4 w-4" />Piloto automático: {s.autopilot ? "ON" : "OFF"}</Button></Can>
          <Can perm="trade.write"><Button size="sm" variant="outline" loading={busy === "Ejecutar siguiente tarea"} onClick={() => run("Ejecutar siguiente tarea", `/trade/shipments/${s.id}/advance`)}><Play className="h-4 w-4" />Ejecutar tareas pendientes</Button></Can>
          {s.status === "COTIZACION" && <Can perm="trade.write"><Button size="sm" onClick={() => run("Cotización convertida en pedido", `/trade/shipments/${s.id}/convert`)}>Convertir en pedido</Button></Can>}
          {s.marginApproved === false && <Can perm="trade.approve"><Button size="sm" variant="gold" onClick={() => run("Margen aprobado (R8)", `/trade/shipments/${s.id}/approve-margin`)}>Aprobar margen ({Number(s.marginPct).toFixed(1)} %)</Button></Can>}
          <Button size="sm" variant="outline" onClick={() => download(`/trade/shipments/${s.id}/docs/expediente.pdf`, `expediente-${s.code}.pdf`)}><Download className="h-4 w-4" />Expediente PDF</Button>
        </>} />
      <Card>
        <CardHeader title="Smart contract automatizado" subtitle={s.agreement ? `${s.agreement.code} · ${s.onchain?.amountEth ?? "—"} ETH de prueba ≙ S/ ${Number(s.agreement.referencePen).toFixed(2)} · ${agreementNote(s.onchain) ?? ""}` : "Se crea automáticamente al confirmarse el pedido"} icon={<ShieldCheck className="h-5 w-5" />} actions={s.agreement && <StatusBadge status={s.agreement.status} />} />
        <CardBody><FlowPipeline s={s} /></CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-2">
          <ShipMap status={s.status} progress={s.voyageProgress} vessel={s.vessel} code={s.code} milestones={s.milestones} />
          {s.traceUrl && <p className="flex items-center gap-1.5 text-xs text-muted"><QrCode className="h-4 w-4" />QR de origen: <a className="text-bluex hover:underline" href={`/trazabilidad/${s.lot?.code}`} target="_blank">{s.traceUrl}</a></p>}
        </div>
        <Card>
          <CardHeader title="Bitácora del motor de automatización" subtitle="Eventos ERP y transacciones confirmadas on-chain" />
          <CardBody className="max-h-[470px] overflow-y-auto"><EventLog events={s.events} /></CardBody>
        </Card>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "docs", label: "Documentos (R2/R3)" }, { id: "aduana", label: "Aduanas (R4–R6)" }, { id: "cumplimiento", label: "Cumplimiento" }, ...(can("costs.read") ? [{ id: "costos" as const, label: "Costos y margen" }] : []), { id: "pagos", label: "Pagos", count: s.payments.length }, { id: "paletas", label: "Paletas", count: s.palletsList.length }]} />
      {tab === "docs" && <DocsTab s={s} reload={reload} />}
      {tab === "aduana" && (
        <Card>
          <CardHeader title="Seguimiento aduanero" subtitle={light.phase} icon={<Anchor className="h-5 w-5" />} actions={<><StatusBadge status={light.light} /><Can perm="customs.write"><Button size="sm" onClick={() => setCustoms(true)}>Registrar DAM / B/L</Button></Can>{s.docsStatus === "APROBADO" && !s.shipDate && <Can perm="customs.write"><Button size="sm" variant="secondary" onClick={() => run("Despacho registrado", `/trade/shipments/${s.id}/dispatch`)}><Ship className="h-4 w-4" />Registrar despacho</Button></Can>}</>} />
          <CardBody className="space-y-4">
            <KeyValue cols={4} items={[["DAM", s.damNumber], ["Numeración", dateTime(s.damDate)], ["Canal", s.channel ? <StatusBadge status={s.channel === "NARANJA" ? "AMBAR" : s.channel} label={s.channel} /> : "—"], ["Levante", dateTime(s.levanteDate)], ["B/L", s.blNumber], ["Manifiesto", s.manifest], ["Contenedor", s.container], ["Nave / naviera", `${s.vessel ?? "—"} · ${s.shippingLine ?? ""}`], ["Embarque", dateTime(s.shipDate)], ["Regularización", dateTime(s.regularizedAt)], ["Cierre de carga", dateTime(s.cargoCutoff)], ["ISF enviado (R6)", dateTime(s.isfSentAt)], ["Prior Notice", s.priorNoticeNo], ["Puertos", `${s.originPort} → ${s.destinationPort}`], ["Agente autorizado", s.agentEmail]]} />
            {light.alerts.map((a: any, i: number) => <Notice key={i} tone={a.level === "danger" ? "red" : a.level === "warning" ? "gold" : "blue"}>{a.message}</Notice>)}
            <p className="text-[11px] text-muted">Semáforo R4: verde hasta el día 20 desde la numeración, ámbar 21–27, rojo desde el 28. Alertas de regularización R5 a los 20, 25 y 28 días. Plazos configurables y sujetos a validación normativa. El ERP no transmite la DAM a SUNAT: la numera el agente de aduana.</p>
          </CardBody>
        </Card>
      )}
      {tab === "cumplimiento" && (
        <Card><CardHeader title="Checklist del embarque (FDA / SUNAT / CBP)" subtitle="No se declara cumplimiento sin evidencia documental" icon={<ListChecks className="h-5 w-5" />} />
          <Table rows={s.compliance} columns={[{ key: "name", header: "Requisito" }, { key: "a", header: "Autoridad", render: (r: any) => r.authority }, { key: "e", header: "Evidencia", render: (r: any) => r.evidence ?? <span className="text-muted">—</span> }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
            { key: "x", header: "", render: (r: any) => can("compliance.write") && r.status !== "CUMPLIDO" ? <Button size="sm" variant="outline" onClick={() => { const ev = prompt("Evidencia (nombre del documento de respaldo):"); if (ev) run("Requisito actualizado", `/trade/shipments/${s.id}/compliance/${r.id}`, { status: "CUMPLIDO", evidence: ev }, "PUT"); }}>Marcar con evidencia</Button> : null }]} />
        </Card>
      )}
      {tab === "costos" && s.finance && <CostsTab s={s} reload={reload} />}
      {tab === "pagos" && (
        <Card><CardHeader title="Pagos y cobranza" subtitle={`Cobrado US$ ${Number(s.paidUsd).toFixed(2)} de ${usd(s.amountUsd)}`} icon={<CreditCard className="h-5 w-5" />} />
          <Table rows={s.payments} columns={[{ key: "code", header: "Pago" }, { key: "p", header: "Medio", render: (r: any) => `${r.provider} · ${r.method}` }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "op", header: "Operación", render: (r: any) => r.operationNumber ?? r.externalId ?? "—" }, { key: "l", header: "Modo", render: (r: any) => <Badge tone={r.livemode ? "green" : "gold"}>{r.livemode ? "REAL" : "prueba"}</Badge> }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }]} />
        </Card>
      )}
      {tab === "paletas" && (
        <Card><Table rows={s.palletsList} columns={[{ key: "sscc", header: "SSCC", render: (r: any) => <Mono>(00) {r.sscc}</Mono> }, { key: "c", header: "Cajas", render: (r: any) => r.cases }, { key: "j", header: "Frascos", render: (r: any) => num(r.jars) }, { key: "n", header: "Neto kg", align: "right", render: (r: any) => Number(r.netKg).toFixed(3) }, { key: "g", header: "Bruto kg", align: "right", render: (r: any) => Number(r.grossKg).toFixed(3) }, { key: "b", header: "Best by", render: (r: any) => date(r.bestBy) }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }]} /></Card>
      )}
      <FormDialog open={customs} onClose={() => setCustoms(false)} title="Seguimiento aduanero" subtitle="Datos devueltos por el agente de aduana y la naviera" size="lg" successMessage="Datos aduaneros registrados"
        initial={{ damNumber: s.damNumber ?? "", damDate: s.damDate?.slice(0, 16) ?? "", channel: s.channel ?? "VERDE", levanteDate: s.levanteDate?.slice(0, 16) ?? "", blNumber: s.blNumber ?? "", manifest: s.manifest ?? "", container: s.container ?? "", vessel: s.vessel ?? "", shippingLine: s.shippingLine ?? "", shipDate: s.shipDate?.slice(0, 16) ?? "", regularizedAt: s.regularizedAt?.slice(0, 16) ?? "", cargoCutoff: s.cargoCutoff?.slice(0, 16) ?? "", isfSentAt: s.isfSentAt?.slice(0, 16) ?? "", priorNoticeNo: s.priorNoticeNo ?? "" }}
        fields={[{ name: "damNumber", label: "N.° de DAM" }, { name: "damDate", label: "Fecha de numeración", type: "datetime-local" }, { name: "channel", label: "Canal de control", type: "select", options: ["VERDE", "NARANJA", "ROJO"].map((v) => ({ value: v, label: v })) }, { name: "levanteDate", label: "Levante", type: "datetime-local" }, { name: "blNumber", label: "N.° de B/L" }, { name: "manifest", label: "Manifiesto" }, { name: "container", label: "Contenedor" }, { name: "vessel", label: "Nave" }, { name: "shippingLine", label: "Naviera" }, { name: "shipDate", label: "Fecha de embarque", type: "datetime-local" }, { name: "regularizedAt", label: "Regularización", type: "datetime-local" }, { name: "cargoCutoff", label: "Cierre de carga", type: "datetime-local" }, { name: "isfSentAt", label: "ISF enviado al importador", type: "datetime-local" }, { name: "priorNoticeNo", label: "N.° Prior Notice" }]}
        onSubmit={async (v) => { const body: any = {}; for (const [k, val] of Object.entries(v)) body[k] = val === "" ? null : val; await api(`/trade/shipments/${s.id}/customs`, { method: "PUT", body }); reload(); }} />
    </div>
  );
}

function DocsTab({ s, reload }: { s: any; reload: () => void }) {
  const toast = useToast();
  const [net, setNet] = React.useState("");
  const [gross, setGross] = React.useState("");
  const [res, setRes] = React.useState<any>(null);
  const validate = async (custom: boolean) => {
    try { const r = await api(`/trade/shipments/${s.id}/docs/validate`, { body: custom ? { declaredNetKg: net ? Number(net) : undefined, declaredGrossKg: gross ? Number(gross) : undefined } : {} }); setRes(r); r.ok ? toast.success("Paquete documental aprobado") : toast.error("Paquete documental rechazado", r.errors.join(" · ")); reload(); } catch (e: any) { toast.error("Validación", e.message); }
  };
  const docs = Object.entries(s.docTypes as Record<string, string>).filter(([k]) => k !== "reporte");
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card><CardHeader title="Paquete documental" subtitle={`Estado: ${s.docsStatus}`} icon={<FileCheck2 className="h-5 w-5" />} actions={<StatusBadge status={s.docsStatus} />} />
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {docs.map(([k, name]) => <button key={k} onClick={() => download(`/trade/shipments/${s.id}/docs/${k}.pdf`, `${k}-${s.code}.pdf`).catch((e) => toast.error(name, e.message))} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-agro"><Download className="h-4 w-4 shrink-0 text-paprika" />{name}</button>)}
        </CardBody>
      </Card>
      <Card><CardHeader title="Validación R2 / R3" subtitle="Pesos = suma de paletas y bultos · descripción y subpartida del catálogo" />
        <CardBody className="space-y-3">
          {(s.docsErrors ?? []).length > 0 && <Notice tone="red" icon={<AlertTriangle className="h-4 w-4" />}>{(s.docsErrors as string[]).map((e) => <p key={e}>{e}</p>)}</Notice>}
          {s.docsStatus === "APROBADO" && <Notice tone="green" icon={<CheckCircle2 className="h-4 w-4" />}>Aprobado el {dateTime(s.docsApprovedAt)}: neto {Number(s.declaredNetKg).toFixed(3)} kg · bruto {Number(s.declaredGrossKg).toFixed(3)} kg · subpartida {s.hsCode}</Notice>}
          <Can perm="docs.write">
            <Button onClick={() => validate(false)}>Generar y validar con los totales de las paletas</Button>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-line p-3">
              <p className="col-span-2 text-xs text-muted">Prueba P4: declarar pesos distintos en el packing list</p>
              <Field label="Neto declarado (kg)"><Input value={net} onChange={(e) => setNet(e.target.value)} placeholder="p. ej. 250" /></Field>
              <Field label="Bruto declarado (kg)"><Input value={gross} onChange={(e) => setGross(e.target.value)} placeholder="p. ej. 560" /></Field>
              <Button variant="outline" className="col-span-2" onClick={() => validate(true)}>Validar pesos declarados</Button>
            </div>
          </Can>
          {res && <p className="text-xs text-muted">Totales de paletas: {Number(res.totals.netKg).toFixed(3)} kg neto · {Number(res.totals.grossKg).toFixed(3)} kg bruto · {res.totals.cases} cajas · {res.totals.jars} frascos</p>}
        </CardBody>
      </Card>
    </div>
  );
}

function CostsTab({ s, reload }: { s: any; reload: () => void }) {
  const f = s.finance;
  const [rows, setRows] = React.useState<any[]>(f.costs);
  const toast = useToast();
  return (
    <Card><CardHeader title="Costos y margen por embarque" subtitle={`${f.formula.costPerJar} · Margen = ${f.formula.margin}`} icon={<Coins className="h-5 w-5" />} />
      <CardBody className="space-y-4">
        <KeyValue cols={4} items={[["Costo total", money(f.totalCostPen)], ["Costo por frasco", `S/ ${Number(f.costPerJarPen).toFixed(4)}`], ["Costo por paleta", money(f.costPerPalletPen)], ["Ingreso", `${usd(f.revenueUsd)} × ${Number(f.exchangeRate).toFixed(4)} = ${money(f.revenuePen)}`], ["Margen", <b key="m" className={Number(f.marginPct) < 20 ? "text-paprika" : "text-agro"}>{Number(f.marginPct).toFixed(2)} %</b>], ["Presupuesto", money(f.budgetPen)], ["Variación", money(f.varianceePen)], ["Por cobrar", usd(f.pendingUsd)]]} />
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-soft text-left text-xs"><th className="p-2">Concepto</th><th className="p-2 text-right">Presupuesto S/</th><th className="p-2 text-right">Real S/</th><th className="p-2">Tipo de dato</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.concept} className="border-t border-line"><td className="p-2 font-semibold">{r.concept}</td><td className="p-2 text-right">{Number(r.budgetPen).toFixed(2)}</td>
            <td className="p-2 text-right"><Can perm="costs.write" fallback={<>{Number(r.amountPen).toFixed(2)}</>}><input className="w-28 rounded border border-line bg-bg px-2 py-1 text-right" value={r.amountPen} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amountPen: e.target.value, dataKind: "REAL" } : x)))} /></Can></td>
            <td className="p-2"><Badge tone={r.dataKind === "REAL" ? "green" : r.dataKind === "SUPUESTO" ? "blue" : "gold"}>{r.dataKind}</Badge></td></tr>)}</tbody></table></div>
        <Can perm="costs.write"><Button onClick={async () => { try { await api(`/trade/shipments/${s.id}/costs`, { method: "PUT", body: rows.map((r) => ({ concept: r.concept, amountPen: Number(r.amountPen), dataKind: r.dataKind })) }); toast.success("Costos actualizados"); reload(); } catch (e: any) { toast.error("Costos", e.message); } }}>Guardar costos reales</Button></Can>
        <p className="text-[11px] text-muted">Costos de referencia por frasco del plan (tabla OP-48) marcados como DEMO; al registrar el costo real cambia a REAL. Moneda PEN con tipo de cambio registrado del pedido.</p>
      </CardBody>
    </Card>
  );
}
