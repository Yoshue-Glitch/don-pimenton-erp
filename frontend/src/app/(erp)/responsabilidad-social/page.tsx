"use client";
import * as React from "react";
import { HeartHandshake, Leaf, Users, Scale, Coins } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ComposedChart, Line } from "recharts";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Badge, Loading, Kpi, Tabs, Notice, Button } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { Can, useToast } from "@/components/providers";

const AXIS: Record<string, string> = { ECONOMICO: "Económico", AMBIENTAL: "Ambiental", SOCIAL: "Social", ETICO: "Ético", TRANSVERSAL: "Gestión transversal" };
const SRC: Record<string, string> = { PROP: "Recursos propios", FOND: "Fondos concursables", CRED: "Crédito agrario", ASOC: "Asociación y aliados" };
const CLS: Record<string, string> = { OBL: "Obligatorio", EST: "Estratégico", VOL: "Voluntario" };
const COL = ["#A52A2A", "#2F6B45", "#D9A441", "#2B6CB0", "#9DBFA6"];

export default function RS() {
  const { data, reload } = useApi<any>("/rs");
  const toast = useToast();
  const [tab, setTab] = React.useState<"tablero" | "proyectos" | "presupuesto">("tablero");
  const [axis, setAxis] = React.useState("");
  if (!data) return <Loading />;
  const t = data.totals;
  const acc = data.quarterly.reduce((a: number[], v: number) => [...a, (a[a.length - 1] ?? 0) + v], [] as number[]);
  return (
    <div className="space-y-4">
      <PageHeader area="Gestión · Plan de Responsabilidad Social (GRI 13)" title="Responsabilidad social" subtitle="31 proyectos en 4 ejes + gestión transversal, 24 meses. Tablero con semáforo del Comité de RS: verde ≥ 90 % de la meta, amarillo 70–89 %, rojo < 70 %. Indicadores alimentados automáticamente por el ERP." icon={<HeartHandshake className="h-5 w-5" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="red" icon={<Coins />} label="Presupuesto total del plan" value={money(t.total)} hint={`Subtotal ${money(t.subtotal)} + 10 % imprevistos`} />
        <Kpi tone="green" icon={<Leaf />} label="Proyectos" value={data.projects.length} hint={`${data.projects.filter((p: any) => p.status === "EN_CURSO").length} en curso`} />
        <Kpi tone="amber" icon={<Scale />} label="Ejecutado" value={money(t.executed)} hint={`${(t.executed / t.subtotal * 100).toFixed(1)} % del subtotal`} />
        <Kpi tone="blue" icon={<Users />} label="Indicadores en verde" value={`${data.indicators.filter((i: any) => i.light === "VERDE").length} / ${data.indicators.length}`} hint={`${data.indicators.filter((i: any) => i.auto).length} automáticos desde el ERP`} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "tablero", label: "Tablero de control (RS-55)" }, { id: "proyectos", label: "31 proyectos" }, { id: "presupuesto", label: "Presupuesto y financiamiento" }]} />
      {tab === "tablero" && <Card><Table rows={data.indicators} columns={[
        { key: "axis", header: "Eje", render: (r: any) => AXIS[r.axis] ?? r.axis }, { key: "name", header: "Indicador clave", render: (r: any) => <div><b>{r.name}</b>{r.auto && <Badge tone="green" className="ml-2">auto ERP</Badge>}</div> },
        { key: "b", header: "Línea base", render: (r: any) => r.baseline ?? "A medir" }, { key: "c", header: "Actual", render: (r: any) => <b>{r.current ?? "—"} {r.current !== null ? r.unit : ""}</b> },
        { key: "m12", header: "Meta M12", render: (r: any) => `${r.target12} ${r.unit}` }, { key: "m24", header: "Meta M24", render: (r: any) => `${r.target24} ${r.unit}` },
        { key: "p", header: "Avance", render: (r: any) => r.progressPct === null ? "—" : <div className="flex items-center gap-2"><div className="h-2 w-20 overflow-hidden rounded-full bg-soft"><div className={cn("h-full", r.light === "VERDE" ? "bg-agro" : r.light === "AMARILLO" ? "bg-gold" : "bg-paprika")} style={{ width: `${r.progressPct}%` }} /></div><span className="text-xs">{r.progressPct} %</span></div> },
        { key: "l", header: "Semáforo", render: (r: any) => <StatusBadge status={r.light} /> }, { key: "r", header: "Responsable", render: (r: any) => r.responsible },
      ]} /></Card>}
      {tab === "proyectos" && <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">{["", ...Object.keys(AXIS)].map((a) => <Button key={a} size="sm" variant={axis === a ? "secondary" : "outline"} onClick={() => setAxis(a)}>{a ? AXIS[a] : "Todos"}</Button>)}</div>
        <Table rows={data.projects.filter((p: any) => !axis || p.axis === axis)} columns={[
          { key: "code", header: "Código", render: (r: any) => <b>{r.code}</b> }, { key: "name", header: "Proyecto", render: (r: any) => <div><p>{r.name}</p><p className="text-[11px] text-muted">{r.gri}</p></div> },
          { key: "b", header: "Presupuesto", align: "right", render: (r: any) => money(r.budgetPen) }, { key: "y", header: "Año 1 / Año 2", render: (r: any) => <span className="text-xs">{money(r.year1Pen)} / {money(r.year2Pen)}</span> },
          { key: "s", header: "Fuente", render: (r: any) => SRC[r.source] }, { key: "c", header: "Clase", render: (r: any) => <Badge tone={r.expenseClass === "OBL" ? "red" : r.expenseClass === "EST" ? "blue" : "gold"}>{CLS[r.expenseClass]}</Badge> },
          { key: "st", header: "Etapa", render: (r: any) => `Etapa ${r.stage}` }, { key: "r", header: "Responsable", render: (r: any) => <span className="text-xs">{r.responsible}</span> },
          { key: "p", header: "Avance", render: (r: any) => <Can perm="rs.write" fallback={<>{r.progressPct} %</>}><select className="rounded border border-line bg-bg px-1 py-0.5 text-xs" value={r.progressPct} onChange={async (e) => { await api(`/rs/projects/${r.id}`, { method: "PUT", body: { progressPct: Number(e.target.value), executedPen: Math.round(Number(r.budgetPen) * Number(e.target.value) / 100 * 0.95), status: Number(e.target.value) > 0 ? "EN_CURSO" : "PLANIFICADO" } }); toast.success(`${r.code} actualizado`); reload(); }}>{[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => <option key={v} value={v}>{v} %</option>)}</select></Can> },
          { key: "e", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} /></Card>}
      {tab === "presupuesto" && <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Flujo trimestral y acumulado (RS-45)" subtitle="T1–T4 = año 1 · T5–T8 = año 2 (S/, con imprevistos)" /><CardBody><div className="h-[290px]"><ResponsiveContainer><ComposedChart data={data.quarterly.map((v: number, i: number) => ({ q: `T${i + 1}`, v, acc: acc[i] }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="q" /><YAxis /><Tooltip formatter={(v: any) => money(v)} /><Legend /><Bar dataKey="v" name="Trimestre" fill="#2F6B45" radius={4} /><Line dataKey="acc" name="Acumulado" stroke="#A52A2A" strokeWidth={2.5} /></ComposedChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHeader title="Presupuesto por eje" /><CardBody><div className="h-[290px]"><ResponsiveContainer><BarChart data={Object.entries(data.byAxis).map(([k, v]: any) => ({ name: AXIS[k], "Año 1": Math.round(v.year1), "Año 2": Math.round(v.year2) }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis /><Tooltip formatter={(v: any) => money(v)} /><Legend /><Bar dataKey="Año 1" stackId="a" fill="#A52A2A" /><Bar dataKey="Año 2" stackId="a" fill="#D9A441" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></CardBody></Card>
        {[["Fuentes de financiamiento (RS-46)", data.bySource, SRC], ["Clase de gasto (RS-49)", data.byClass, CLS]].map(([title, obj, map]: any) => (
          <Card key={title}><CardHeader title={title} /><CardBody><div className="h-[260px]"><ResponsiveContainer><PieChart><Pie data={Object.entries(obj).map(([k, v]) => ({ name: map[k], value: v }))} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} label={(e: any) => `${(e.percent * 100).toFixed(1)} %`}>{Object.keys(obj).map((_, i) => <Cell key={i} fill={COL[i % COL.length]} />)}</Pie><Tooltip formatter={(v: any) => money(v)} /><Legend /></PieChart></ResponsiveContainer></div></CardBody></Card>
        ))}
        <Card className="lg:col-span-2"><CardHeader title="Regla de liberación por etapas (RS-51)" /><CardBody className="grid gap-3 md:grid-cols-3">{data.stages.map((s: any) => <div key={s.n} className="rounded-xl border border-line p-3"><span className="font-display text-2xl italic text-paprika">0{s.n}</span><p className="font-bold">{s.name}</p><p className="text-xs text-muted">{s.rule}</p></div>)}</CardBody></Card>
      </div>}
      <Notice>{data.note}</Notice>
    </div>
  );
}
