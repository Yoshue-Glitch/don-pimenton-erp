"use client";
import * as React from "react";
import { RotateCcw, Recycle, Siren, Leaf, Package, Clock } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { date, dateTime, num, money } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Notice, Kpi, Tabs, Loading, Input, Field, Badge } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can, useToast } from "@/components/providers";

const LABEL: Record<string, string> = { SACO_REUTILIZADO: "Sacos reutilizados", PALETA_RETORNABLE: "Paletas retornables", COMPOST: "Compost", RECICLAJE_VIDRIO: "Vidrio reciclado", RECICLAJE_CARTON: "Cartón reciclado", RECICLAJE_PLASTICO: "Plástico reciclado", RESIDUO_PELIGROSO: "Residuos peligrosos (EO-RS)", PRODUCTO_DEVUELTO: "Producto devuelto" };

export default function LogisticaInversa() {
  const { data, loading, reload } = useApi<any>("/reverse");
  const toast = useToast();
  const [tab, setTab] = React.useState<"reclamos" | "circular" | "recall">("reclamos");
  const [resolve, setResolve] = React.useState<any>(null);
  const [newClaim, setNewClaim] = React.useState(false);
  const [newCirc, setNewCirc] = React.useState(false);
  const [lot, setLot] = React.useState("");
  const [recall, setRecall] = React.useState<any>(null);
  if (loading && !data) return <Loading />;
  const k = data.kpis;
  const agg: Record<string, number> = {};
  for (const c of data.circular) agg[c.type] = (agg[c.type] ?? 0) + Number(c.quantity);
  return (
    <div className="space-y-4">
      <PageHeader area="Logística inversa · Plan de RS PA-04 y PS-05" title="Logística inversa y economía circular" subtitle="Reclamos (RMA) con disposición automática, devoluciones, simulacro de retiro de lote (meta < 4 h), retorno de sacos y paletas, compostaje y reciclaje." icon={<RotateCcw className="h-5 w-5" />}
        actions={<><Can perm="reverse.write"><Button variant="outline" onClick={() => setNewCirc(true)}><Recycle className="h-4 w-4" />Registrar retorno / reciclaje</Button></Can><Can perm="reverse.write"><Button onClick={() => setNewClaim(true)}>Nuevo reclamo</Button></Can></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="red" icon={<Package />} label="Reclamos abiertos" value={k.openClaims} hint={`${k.totalClaims} en total · notas de crédito ${money(k.creditUsd, "USD")}`} />
        <Kpi tone="green" icon={<Clock />} label="Atendidos en ≤ 15 días" value={k.within15Pct === null ? "—" : `${k.within15Pct} %`} hint="Meta del plan: 100 %" />
        <Kpi tone="amber" icon={<Recycle />} label="Sacos reutilizados" value={k.reusePct === null ? num(k.sacksReused) : `${k.reusePct} %`} hint={`${num(k.sacksReused)} sacos · meta ≥ 30 %`} />
        <Kpi tone="blue" icon={<Leaf />} label="Compost / reciclado" value={`${num(k.compostKg)} kg`} hint={`${num(k.recycledKg, 1)} kg reciclados · ${num(k.returnablePallets)} paletas retornables`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "reclamos", label: "Reclamos y devoluciones", count: data.claims.length }, { id: "circular", label: "Economía circular" }, { id: "recall", label: "Simulacro de retiro (recall)" }]} />
      {tab === "reclamos" && <Card><Table rows={data.claims} columns={[
        { key: "code", header: "RMA", render: (r: any) => <b>{r.code}</b> }, { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "s", header: "Embarque", render: (r: any) => r.shipment?.code ?? "—" },
        { key: "t", header: "Tipo", render: (r: any) => r.type }, { key: "d", header: "Descripción", render: (r: any) => <span className="text-xs">{r.description}</span> }, { key: "j", header: "Frascos", render: (r: any) => r.jars },
        { key: "src", header: "Origen", render: (r: any) => <Badge tone={r.source === "PORTAL" ? "blue" : "slate"}>{r.source}</Badge> }, { key: "dis", header: "Disposición", render: (r: any) => r.disposition ?? "—" },
        { key: "o", header: "Abierto", render: (r: any) => date(r.openedAt) }, { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        { key: "x", header: "", render: (r: any) => !["CERRADO", "RECHAZADO"].includes(r.status) ? <Can perm="reverse.write"><Button size="sm" onClick={() => setResolve(r)}>Resolver</Button></Can> : null },
      ]} /></Card>}
      {tab === "circular" && <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card><CardHeader title="Acumulado por flujo" /><CardBody><div className="h-[300px]"><ResponsiveContainer><BarChart data={Object.entries(agg).map(([t, v]) => ({ name: LABEL[t] ?? t, value: v }))} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" fill="#2F6B45" radius={4} /></BarChart></ResponsiveContainer></div></CardBody></Card>
        <Card><Table rows={data.circular} columns={[{ key: "d", header: "Fecha", render: (r: any) => date(r.date) }, { key: "t", header: "Flujo", render: (r: any) => LABEL[r.type] ?? r.type }, { key: "q", header: "Cantidad", align: "right", render: (r: any) => `${num(r.quantity, 1)} ${r.unit}` }, { key: "p", header: "Aliado", render: (r: any) => r.partner ?? "—" }, { key: "r", header: "Ref.", render: (r: any) => r.reference ?? "—" }]} /></Card>
      </div>}
      {tab === "recall" && <Card><CardHeader title="Simulacro de retiro de lote" subtitle="Identifica hacia atrás (parcela, cosecha, granel) y hacia adelante (paletas, embarques, clientes). Meta TI-20: < 4 horas." icon={<Siren className="h-5 w-5" />} />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-end gap-2"><Field label="Código de lote"><Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="LOTE-2026-10-001" /></Field>
            <Can perm="reverse.write"><Button onClick={async () => { try { setRecall(await api("/reverse/recall", { body: { lotCode: lot, reason: "Simulacro de retiro (demostración)" } })); reload(); } catch (e: any) { toast.error("Simulacro", e.message); } }}><Siren className="h-4 w-4" />Ejecutar simulacro</Button></Can></div>
          {recall && <div className="space-y-2 text-sm">
            <Notice tone="green">Lote {recall.lotCode}: afectados identificados en <b>{recall.seconds} s</b> (meta &lt; {recall.targetHours} h).</Notice>
            <p><b>Hacia atrás:</b> parcela {recall.affected.backward.parcel ?? "—"} · cosecha {recall.affected.backward.harvest ?? "—"} · materia prima {recall.affected.backward.rawLot ?? "—"} · granel {recall.affected.backward.bulkLot ?? "—"}</p>
            <p><b>Lotes relacionados:</b> {recall.affected.lots.map((l: any) => `${l.code} (${l.qualityStatus})`).join(", ")}</p>
            <p><b>Paletas:</b> {recall.affected.pallets.map((p: any) => `${p.sscc} [${p.status}]`).join(", ") || "—"}</p>
            <p><b>Clientes a notificar:</b> {recall.affected.customers.map((c: any) => `${c.name} (${c.country}, ${c.via})`).join("; ") || "ninguno"}</p>
          </div>}
          {data.drills.length > 0 && <p className="text-xs text-muted">Últimos simulacros: {data.drills.map((d: any) => `${d.code} · ${d.lotCode} · ${dateTime(d.startedAt)}`).join(" | ")}</p>}
        </CardBody></Card>}
      <FormDialog open={!!resolve} onClose={() => setResolve(null)} title={`Resolver ${resolve?.code ?? ""}`} subtitle="La disposición ejecuta automáticamente sus efectos: nota de crédito en Finanzas, reciclaje o compostaje en economía circular" successMessage="Reclamo resuelto"
        initial={{ decision: "APROBADO", disposition: resolve?.type === "ROTURA" ? "RECICLAJE" : "NOTA_CREDITO", creditUsd: resolve ? (resolve.jars * 2).toFixed(2) : 0 }}
        fields={[{ name: "decision", label: "Decisión", type: "select", options: [{ value: "APROBADO", label: "Aprobar" }, { value: "RECHAZADO", label: "Rechazar" }] }, { name: "disposition", label: "Disposición", type: "select", options: ["REPOSICION", "NOTA_CREDITO", "REPROCESO", "DESTRUCCION", "COMPOSTAJE", "RECICLAJE"].map((v) => ({ value: v, label: v.replace("_", " ") })) }, { name: "creditUsd", label: "Nota de crédito (US$)", type: "number", step: "any", min: 0 }, { name: "resolution", label: "Resolución / acción correctiva", type: "textarea", full: true }]}
        onSubmit={async (v) => { await api(`/reverse/claims/${resolve.id}/resolve`, { body: { ...v, creditUsd: Number(v.creditUsd || 0) } }); reload(); }} />
      <FormDialog open={newClaim} onClose={() => setNewClaim(false)} title="Nuevo reclamo (RMA)" successMessage="Reclamo registrado" initial={{ type: "ROTURA", jars: 0 }}
        fields={[{ name: "shipmentCode", label: "Código de embarque", required: true, placeholder: "EMB-2026-002" }, { name: "type", label: "Tipo", type: "select", options: ["CALIDAD", "ROTURA", "FALTANTE", "ETIQUETADO", "RETRASO", "OTRO"].map((v) => ({ value: v, label: v })) }, { name: "jars", label: "Frascos afectados", type: "number", min: 0 }, { name: "description", label: "Descripción", type: "textarea", full: true, required: true }]}
        onSubmit={async (v) => { await api("/reverse/claims", { body: v }); reload(); }} />
      <FormDialog open={newCirc} onClose={() => setNewCirc(false)} title="Registrar retorno / reciclaje" successMessage="Registro guardado" initial={{ date: new Date().toISOString().slice(0, 10), type: "SACO_REUTILIZADO", unit: "UND" }}
        fields={[{ name: "date", label: "Fecha", type: "date", required: true }, { name: "type", label: "Flujo", type: "select", options: Object.entries(LABEL).map(([v, l]) => ({ value: v, label: l })) }, { name: "quantity", label: "Cantidad", type: "number", step: "any", min: 0.001, required: true }, { name: "unit", label: "Unidad", type: "select", options: [{ value: "UND", label: "Unidades" }, { value: "KG", label: "kg" }] }, { name: "partner", label: "Aliado (reciclador, cliente…)", full: true }]}
        onSubmit={async (v) => { await api("/reverse/circular", { body: v }); reload(); }} />
    </div>
  );
}
