"use client";
import * as React from "react";
import { Gauge, Download, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, Badge, Loading, Select, Button, Notice } from "@/components/ui";

/** Indicadores KPI exactamente según la tabla TI-14. */
export default function KpiPage() {
  const [year, setYear] = React.useState("");
  const { data } = useApi<any[]>(`/trade/kpis${year ? `?year=${year}` : ""}`, [year]);
  const dash = useApi<any>("/trade/dashboard");
  if (!data) return <Loading />;
  const csv = () => {
    const rows = [["N", "Indicador", "Valor", "Unidad", "Meta", "Cumple", "Fórmula", "Tipo de dato"], ...data.map((k) => [k.n, k.name, k.value ?? "", k.unit, k.target, k.ok === null ? "sin dato" : k.ok ? "sí" : "no", k.formula, k.kind])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `kpi-don-pimenton${year ? "-" + year : ""}.csv`; a.click();
  };
  return (
    <div className="space-y-4">
      <PageHeader area="Gestión · TI-14" title="Indicadores KPI" subtitle="Recalculados en vivo desde la base de datos. Se distinguen datos reales (registros del ERP), supuestos (parámetros del plan) y datos de demostración." icon={<Gauge className="h-5 w-5" />}
        actions={<><Select value={year} onChange={(e) => setYear(e.target.value)} className="w-44"><option value="">Todas las campañas</option><option value="2025">Campaña 2025</option><option value="2026">Campaña 2026</option></Select><Button variant="outline" onClick={csv}><Download className="h-4 w-4" />Exportar CSV</Button><Button variant="outline" onClick={() => window.print()}>Imprimir</Button></>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.map((k) => (
          <Card key={k.n} className="p-4">
            <div className="flex items-start justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-wider text-muted">KPI {k.n}</span>{k.ok === null ? <MinusCircle className="h-5 w-5 text-muted" /> : k.ok ? <CheckCircle2 className="h-5 w-5 text-agro" /> : <XCircle className="h-5 w-5 text-paprika" />}</div>
            <p className="mt-1 text-sm font-bold text-fg">{k.name}</p>
            <p className={cn("mt-1 text-3xl font-extrabold", k.ok === false ? "text-paprika" : "text-fg")}>{k.value === null ? "—" : k.unit === "S/" ? `S/ ${k.value}` : `${k.value} ${k.unit}`}</p>
            <p className="text-xs text-muted">Meta: {k.target}{k.detail ? ` · ${k.detail}` : ""}</p>
            <p className="mt-2 text-[11px] text-muted">{k.formula}</p>
            <Badge tone={k.kind.startsWith("REAL") ? "green" : k.kind.startsWith("SUPUESTO") ? "blue" : "gold"} className="mt-2">{k.kind}</Badge>
          </Card>
        ))}
      </div>
      {dash.data && <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Tendencia: producción y rendimiento" subtitle="Por mes de cierre de la orden de producción" /><CardBody><div className="h-[280px]"><ResponsiveContainer><LineChart data={dash.data.monthly}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis yAxisId="a" /><YAxis yAxisId="b" orientation="right" unit="%" /><Tooltip /><Legend /><Line yAxisId="a" dataKey="productionKg" name="Producción (kg)" stroke="#2F6B45" strokeWidth={2.5} /><Line yAxisId="b" dataKey="yieldPct" name="Rendimiento %" stroke="#A52A2A" strokeWidth={2} /></LineChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHeader title="Plazos aduaneros (días)" subtitle="Numeración → embarque (meta ≤ 15) y embarque → regularización (meta ≤ 10)" /><CardBody><div className="h-[280px]"><ResponsiveContainer><BarChart data={data.filter((k) => k.n === 5 || k.n === 6).map((k) => ({ name: k.n === 5 ? "DAM → embarque" : "Embarque → regularización", valor: k.value ?? 0, meta: k.n === 5 ? 15 : 10 }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Legend /><Bar dataKey="valor" name="Promedio real" fill="#2B6CB0" radius={4} /><Bar dataKey="meta" name="Meta" fill="#D9A441" radius={4} /></BarChart></ResponsiveContainer></div></CardBody></Card>
      </div>}
      <Notice tone="blue">Línea base del plan: rendimiento 12.4 %, energía 3.40 kWh/kg (meta 2.73), costo variable S/ 2.96 por frasco. Los indicadores 7 y 8 solo se muestran a roles con acceso a costos.</Notice>
    </div>
  );
}
