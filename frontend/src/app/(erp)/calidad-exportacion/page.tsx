"use client";
import * as React from "react";
import { Microscope, Plus, CheckCircle2, XCircle, Settings2, Download } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { date, dateTime } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Notice, Kpi, Loading, Badge } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can, useToast } from "@/components/providers";

/** Calidad e inocuidad para exportación (OP-8): panel de laboratorio, COA de demostración, regla R1. */
export default function CalidadExportacion() {
  const labs = useApi<any[]>("/trade/lab");
  const params = useApi<any>("/trade/params");
  const bulk = useApi<any[]>("/trade/bulk-lots");
  const jars = useApi<any[]>("/trade/jar-lots");
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [lim, setLim] = React.useState(false);
  const [detail, setDetail] = React.useState<any>(null);
  if (!labs.data || !params.data) return <Loading />;
  const L = params.data.limits;
  const lots = [...(bulk.data ?? []).map((b) => b.code), ...(jars.data ?? []).map((j) => j.code)];
  const decide = async (id: number, decision: string) => { try { await api(`/trade/lab/${id}/decide`, { body: { decision } }); toast.success(decision === "APROBADO" ? "COA aprobado: lote liberado" : "Lote rechazado y bloqueado"); labs.reload(); bulk.reload(); } catch (e: any) { toast.error("Decisión", e.message); } };
  return (
    <div className="space-y-4">
      <PageHeader area="Campo y planta · OP-8 · R1" title="Calidad e inocuidad (COA de exportación)" subtitle="Panel por lote: ASTA, humedad, aw, Salmonella, E. coli, mohos y levaduras, aflatoxinas, ocratoxina A, colorantes prohibidos, materia extraña, metales y peso neto. Un resultado fuera de especificación retiene el lote automáticamente." icon={<Microscope className="h-5 w-5" />}
        actions={<><Can perm="quality.specs"><Button variant="outline" onClick={() => setLim(true)}><Settings2 className="h-4 w-4" />Límites</Button></Can><Can perm="lab.write"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Registrar análisis</Button></Can></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="green" label="COA aprobados" value={labs.data.filter((l) => l.result === "APROBADO").length} /><Kpi tone="amber" label="En evaluación" value={labs.data.filter((l) => l.result === "EN_EVALUACION").length} />
        <Kpi tone="red" label="Retenidos" value={labs.data.filter((l) => l.result === "RETENIDO").length} /><Kpi tone="blue" label="Rechazados" value={labs.data.filter((l) => l.result === "RECHAZADO").length} />
      </div>
      <Notice>Límites de referencia del plan (modificables según contrato y normativa): color {L.astaMin}–{L.astaMax} ASTA · humedad ≤ {L.moistureMax} % · aw ≤ {L.awMax} (sujeto a validación) · Salmonella ausente/25 g · aflatoxina B1 ≤ {L.aflatoxinB1Max} µg/kg · totales ≤ {L.aflatoxinTotalMax} µg/kg. R1: ningún lote se reserva sin COA aprobado. El COA generado es de demostración, NO oficial.</Notice>
      <Card><CardHeader title="Análisis de laboratorio" />
        <Table rows={labs.data} onRowClick={setDetail} columns={[
          { key: "code", header: "Análisis", render: (r: any) => <b>{r.code}</b> }, { key: "lot", header: "Lote", render: (r: any) => r.lot.code }, { key: "lab", header: "Laboratorio", render: (r: any) => <span className="text-xs">{r.laboratory}</span> },
          { key: "d", header: "Fecha", render: (r: any) => date(r.analysisDate) }, { key: "asta", header: "ASTA", render: (r: any) => r.asta ?? "—" }, { key: "h", header: "Humedad", render: (r: any) => r.moisturePct != null ? `${r.moisturePct} %` : "—" },
          { key: "af", header: "Afla B1 / tot.", render: (r: any) => `${r.aflatoxinB1 ?? "—"} / ${r.aflatoxinTotal ?? "—"}` }, { key: "nc", header: "Fuera de espec.", render: (r: any) => { const n = (r.evaluation ?? []).filter((e: any) => e.result === "NO_CUMPLE").length; return n ? <Badge tone="red">{n}</Badge> : <Badge tone="green">0</Badge>; } },
          { key: "ap", header: "Aprobó", render: (r: any) => r.approvedBy ? <span className="text-xs">{r.approvedBy}<br />{dateTime(r.approvedAt)}</span> : "—" }, { key: "s", header: "Resultado", render: (r: any) => <StatusBadge status={r.result} /> },
          { key: "x", header: "", render: (r: any) => ["EN_EVALUACION", "RETENIDO"].includes(r.result) ? <Can perm="lab.approve"><div className="flex gap-1" onClick={(e) => e.stopPropagation()}><Button size="sm" onClick={() => decide(r.id, "APROBADO")}><CheckCircle2 className="h-3.5 w-3.5" />Aprobar COA</Button><Button size="sm" variant="outline" onClick={() => decide(r.id, "RECHAZADO")}><XCircle className="h-3.5 w-3.5" /></Button></div></Can> : null },
        ]} /></Card>
      {detail && <Card><CardHeader title={`${detail.code} · lote ${detail.lot.code}`} subtitle={`Evidencia: ${detail.evidence ?? "—"} · hash COA ${detail.coaHash ?? "—"}`} actions={<Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Cerrar</Button>} />
        <Table rows={(detail.evaluation ?? []).map((e: any, i: number) => ({ ...e, id: i }))} columns={[{ key: "label", header: "Parámetro" }, { key: "v", header: "Resultado", render: (r: any) => `${r.value ?? "—"} ${r.unit}` }, { key: "l", header: "Límite", render: (r: any) => r.limit }, { key: "r", header: "Evaluación", render: (r: any) => <StatusBadge status={r.result} /> }]} /></Card>}
      <FormDialog open={open} onClose={() => setOpen(false)} title="Registrar análisis de laboratorio" subtitle="Pruebe P2: ingrese humedad 12.6 % o aflatoxina B1 7.5 µg/kg → el lote queda retenido" size="xl" successMessage="Análisis registrado y evaluado contra los límites"
        initial={{ laboratory: "Laboratorio acreditado (ficticio)", salmonella: "AUSENTE", bannedDyes: "NO_DETECTADO", foreignMatter: "CONFORME", metalDetection: "CONFORME", asta: 112, moisturePct: 9.6, aw: 0.52, ecoli: 3, moldsYeasts: 800, aflatoxinB1: 1.4, aflatoxinTotal: 2.9, ochratoxinA: 4, netWeightG: 113.2 }}
        fields={[
          { name: "lotCode", label: "Lote", type: "select", required: true, options: lots.map((c) => ({ value: c, label: c })) }, { name: "laboratory", label: "Laboratorio", required: true },
          { name: "asta", label: "Color (ASTA)", type: "number", step: "any" }, { name: "moisturePct", label: "Humedad (%)", type: "number", step: "any" }, { name: "aw", label: "Actividad de agua (aw)", type: "number", step: "any" },
          { name: "salmonella", label: "Salmonella (25 g)", type: "select", options: [{ value: "AUSENTE", label: "Ausente" }, { value: "PRESENTE", label: "Presente" }] }, { name: "ecoli", label: "E. coli (UFC/g)", type: "number", step: "any" }, { name: "moldsYeasts", label: "Mohos y levaduras (UFC/g)", type: "number", step: "any" },
          { name: "aflatoxinB1", label: "Aflatoxina B1 (µg/kg)", type: "number", step: "any" }, { name: "aflatoxinTotal", label: "Aflatoxinas totales (µg/kg)", type: "number", step: "any" }, { name: "ochratoxinA", label: "Ocratoxina A (µg/kg)", type: "number", step: "any" },
          { name: "bannedDyes", label: "Colorantes prohibidos", type: "select", options: [{ value: "NO_DETECTADO", label: "No detectado" }, { value: "DETECTADO", label: "Detectado" }] }, { name: "foreignMatter", label: "Materia extraña", type: "select", options: [{ value: "CONFORME", label: "Conforme" }, { value: "NO_CONFORME", label: "No conforme" }] },
          { name: "metalDetection", label: "Control de metales", type: "select", options: [{ value: "CONFORME", label: "Conforme" }, { value: "NO_CONFORME", label: "No conforme" }] }, { name: "netWeightG", label: "Peso neto por frasco (g)", type: "number", step: "any" }, { name: "analysisDate", label: "Fecha de análisis", type: "date" },
        ]}
        onSubmit={async (v) => { const body: any = {}; for (const [k, x] of Object.entries(v)) body[k] = x === "" ? undefined : ["asta", "moisturePct", "aw", "ecoli", "moldsYeasts", "aflatoxinB1", "aflatoxinTotal", "ochratoxinA", "netWeightG"].includes(k) ? Number(x) : x; const r = await api<any>("/trade/lab", { body }); if (r.retained) toast.error("Lote RETENIDO", "Resultado fuera de especificación: el lote no podrá reservarse (R1)"); labs.reload(); }} />
      <FormDialog open={lim} onClose={() => setLim(false)} title="Límites del panel de exportación" subtitle="Referencias del plan; ajústelas a la especificación del contrato y a la normativa aplicable" successMessage="Límites actualizados" initial={L}
        fields={Object.keys(L).map((k) => ({ name: k, label: k, type: "number" as const, step: "any" as const }))}
        onSubmit={async (v) => { await api("/trade/limits", { method: "PUT", body: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)])) }); params.reload(); }} />
    </div>
  );
}
