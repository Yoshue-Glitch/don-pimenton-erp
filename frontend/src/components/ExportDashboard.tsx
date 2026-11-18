"use client";
/** Dashboard ejecutivo de exportación (sección 4): tarjetas y gráficos recalculados desde la base de datos. */
import * as React from "react";
import Link from "next/link";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend, ComposedChart, Line, AreaChart, Area } from "recharts";
import { Rocket, Factory, Percent, Layers, CheckCircle2, AlertTriangle, Boxes, Package, Ship, Globe2, Coins, TrendingUp, FileSignature, Bell } from "lucide-react";
import { api } from "@/lib/api";
import { num, money, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, Kpi, StatusBadge, Badge } from "@/components/ui";
import { ShipMap } from "./ShipMap";

const COL = ["#A52A2A", "#2F6B45", "#D9A441", "#2B6CB0", "#E28A7E", "#9DBFA6", "#6B7280", "#1C3F2B"];
const ST: Record<string, string> = { COTIZACION: "Cotización", PEDIDO: "Pedido", CALIDAD_VALIDADA: "Calidad validada", RESERVADO: "Reservado", CONFIRMADO: "Confirmado", DOCUMENTACION: "Documentación", DESPACHADO: "Despachado", EN_TRANSITO: "En tránsito", ARRIBADO: "Arribado", ENTREGADO: "Entregado", CERRADO: "Completado", ANULADO: "Anulado" };

export function ExportDashboard() {
  const [d, setD] = React.useState<any>(null);
  const [voy, setVoy] = React.useState<any>(null);
  React.useEffect(() => {
    const load = () => api("/trade/dashboard").then(setD).catch(() => {});
    load(); const t = setInterval(load, 6000); return () => clearInterval(t);
  }, []);
  React.useEffect(() => { const v = d?.voyages?.[0]; if (v) api(`/trade/shipments/${v.id}`).then(setVoy).catch(() => {}); else setVoy(null); }, [d?.voyages?.[0]?.id, d?.voyages?.[0]?.progress]);
  if (!d) return null;
  const c = d.cards;
  return (
    <div className="space-y-[18px]">
      <section className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_85%_20%,rgba(165,42,42,.6),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] px-7 py-7 text-white">
        <div className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[.26em] text-[#F2C9C0]">Exportación de páprika 4 oz → Estados Unidos · operación proyectada</span>
            <h2 className="mt-2 font-display text-[clamp(24px,3vw,36px)] leading-tight">Del campo al mercado, <i className="text-[#F2B8AC]">con trazabilidad en blockchain</i></h2>
            <p className="mt-1 max-w-2xl text-sm text-white/80">{num(c.jarsAvailable)} frascos listos para vender · {c.activeContracts} contratos inteligentes activos · {num(c.chainTxs)} transacciones confirmadas en la red local.</p>
          </div>
          <Link href="/simulacion" className="inline-flex shrink-0 items-center gap-3 rounded-xl bg-white px-7 py-4 text-base font-extrabold text-forest shadow-xl transition hover:-translate-y-0.5 hover:bg-paprika-50"><Rocket className="h-6 w-6 text-paprika" />INICIAR SIMULACIÓN DE EXPORTACIÓN</Link>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        <Kpi tone="green" icon={<Factory />} label="Producción total" value={`${num(c.productionKg)} kg`} hint="Producto terminado" />
        <Kpi tone="amber" icon={<Percent />} label="Rendimiento fruto-producto" value={c.yieldPct === null ? "—" : `${c.yieldPct} %`} hint="Meta ≥ 12.4 %" />
        <Kpi tone="blue" icon={<Layers />} label="Lotes en procesamiento" value={num(c.lotsProcessing)} hint="Órdenes en proceso" />
        <Kpi tone="green" icon={<CheckCircle2 />} label="Lotes aprobados" value={num(c.lotsApproved)} hint="COA / inspección" />
        <Kpi tone="red" icon={<AlertTriangle />} label="Lotes retenidos" value={num(c.lotsRetained)} hint="Retenidos o rechazados" />
        <Kpi tone="ink" icon={<Boxes />} label="Stock producto terminado" value={`${num(c.finishedStockKg, 1)} kg`} hint={`${num(c.jarsAvailable)} frascos disponibles`} />
        <Kpi tone="blue" icon={<Package />} label="Pedidos internacionales" value={num(c.intlOrders)} hint="Cotizaciones y pedidos" />
        <Kpi tone="amber" icon={<Ship />} label="Embarques activos" value={num(c.activeShipments)} hint="En tránsito / por confirmar" />
        <Kpi tone="green" icon={<Globe2 />} label="Exportaciones completadas" value={num(c.completedExports)} hint="Pago liberado y cerradas" />
        <Kpi tone="red" icon={<Coins />} label="Costos acumulados" value={c.accumulatedCostsPen === null ? "Restringido" : money(c.accumulatedCostsPen)} hint="Embarques de exportación" />
        <Kpi tone="green" icon={<TrendingUp />} label="Margen por embarque" value={c.marginPct === null ? "Restringido" : `${c.marginPct} %`} hint="(Ingreso − costos) ÷ ingreso" />
        <Kpi tone="paprika" icon={<FileSignature />} label="Contratos inteligentes activos" value={num(c.activeContracts)} hint="Propuestos, aceptados o fondeados" />
      </div>
      <div className="grid gap-[18px] xl:grid-cols-[1.5fr_1fr]">
        {voy ? <ShipMap status={voy.status} progress={voy.voyageProgress} vessel={voy.vessel} code={voy.code} milestones={voy.milestones} height={400} /> : (
          <Card><CardHeader title="Producción mensual y evolución de costos" subtitle="Calculado desde las órdenes de producción" /><CardBody><div className="h-[330px]"><ResponsiveContainer><ComposedChart data={d.monthly.slice(-12)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis yAxisId="a" /><YAxis yAxisId="b" orientation="right" /><Tooltip /><Legend /><Bar yAxisId="a" dataKey="productionKg" name="Producción (kg)" fill="#2F6B45" radius={4} /><Line yAxisId="b" dataKey="costPen" name="Costo (S/)" stroke="#A52A2A" strokeWidth={2.5} /></ComposedChart></ResponsiveContainer></div></CardBody></Card>
        )}
        <Card><CardHeader title="Alertas" subtitle={`${d.alerts.length} por revisar`} icon={<Bell className="h-5 w-5" />} />
          <CardBody className="max-h-[400px] space-y-1 overflow-y-auto p-3">
            {d.alerts.length === 0 ? <p className="p-3 text-sm text-muted">Todo en orden</p> : d.alerts.map((a: any, i: number) => (
              <Link key={i} href={a.href} className="flex items-start gap-3 rounded-xl p-2.5 hover:bg-bg">
                <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", a.level === "danger" ? "bg-paprika" : a.level === "warning" ? "bg-amberx" : "bg-bluex")} />
                <div><b className="block text-[13px] text-fg">{a.type}</b><small className="text-xs text-muted">{a.message}</small></div>
              </Link>
            ))}
          </CardBody></Card>
      </div>
      <div className="grid gap-[18px] lg:grid-cols-2 xl:grid-cols-4">
        {voy && <Card className="xl:col-span-2"><CardHeader title="Producción mensual y costos" /><CardBody><div className="h-[240px]"><ResponsiveContainer><ComposedChart data={d.monthly.slice(-12)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis yAxisId="a" /><YAxis yAxisId="b" orientation="right" /><Tooltip /><Bar yAxisId="a" dataKey="productionKg" name="Producción (kg)" fill="#2F6B45" radius={4} /><Line yAxisId="b" dataKey="costPen" name="Costo (S/)" stroke="#A52A2A" strokeWidth={2.5} /></ComposedChart></ResponsiveContainer></div></CardBody></Card>}
        <Card className={voy ? "" : "xl:col-span-2"}><CardHeader title="Rendimiento de producción" subtitle="% fruto → producto por mes" /><CardBody><div className="h-[240px]"><ResponsiveContainer><AreaChart data={d.monthly.slice(-12)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis unit="%" /><Tooltip /><Area dataKey="yieldPct" name="Rendimiento" stroke="#D9A441" fill="#D9A44155" /></AreaChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHeader title="Distribución de inventarios" /><CardBody><div className="h-[240px]"><ResponsiveContainer><PieChart><Pie data={d.inventory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{d.inventory.map((_: any, i: number) => <Cell key={i} fill={COL[i]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHeader title="Estado de exportaciones" /><CardBody><div className="h-[240px]"><ResponsiveContainer><BarChart data={d.exportStatus.map((x: any) => ({ ...x, name: ST[x.name] ?? x.name }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="value" name="Embarques" fill="#A52A2A" radius={4} /></BarChart></ResponsiveContainer></div></CardBody></Card>
        <Card><CardHeader title="Cumplimiento de calidad" subtitle="Lotes de producto terminado" /><CardBody><div className="h-[240px]"><ResponsiveContainer><PieChart><Pie data={d.quality.filter((x: any) => x.value)} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>{d.quality.map((x: any, i: number) => <Cell key={i} fill={{ APROBADO: "#2F6B45", RETENIDO: "#B26B00", RECHAZADO: "#A52A2A", EN_EVALUACION: "#D9A441" }[x.name as string] ?? COL[i]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer></div></CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title="Seguimiento de plazos aduaneros" subtitle="Semáforo R4/R5 de cada DAM" /><CardBody className="space-y-2">
          {d.customs.length === 0 ? <p className="text-sm text-muted">Sin DAM registradas</p> : d.customs.slice(0, 8).map((x: any) => (
            <div key={x.code} className="flex items-center gap-3 text-sm"><b className="w-28">{x.code}</b><div className="h-2.5 flex-1 overflow-hidden rounded-full bg-soft"><div className={cn("h-full", x.light === "ROJO" ? "bg-paprika" : x.light === "AMBAR" ? "bg-gold" : "bg-agro")} style={{ width: `${x.light === "REGULARIZADO" ? 100 : Math.min(100, ((x.days ?? 0) / 30) * 100)}%` }} /></div><StatusBadge status={x.light} /><span className="hidden w-64 truncate text-xs text-muted md:block">{x.phase}</span></div>
          ))}
        </CardBody></Card>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]"><Badge tone="green">REAL · {d.dataKinds.real}</Badge><Badge tone="blue">PROYECTADO · {d.dataKinds.projected}</Badge><Badge tone="gold">DEMO · {d.dataKinds.demo}</Badge></div>
    </div>
  );
}
