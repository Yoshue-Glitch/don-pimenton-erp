"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, AreaChart, Area, PieChart, Pie, Cell, Legend } from "recharts";
import { Scale, Warehouse, Layers, CheckCircle2, XCircle, TrendingUp, Coins, Percent, ClipboardList, ShoppingCart, Globe2, FileSignature, Link2, AlertTriangle, Activity, PlayCircle } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { money, kg, num, dateTime } from "@/lib/utils";
import { Card, CardHeader, CardBody, Kpi, Loading, ErrorBox, PageHeader, Badge, Button, Empty } from "@/components/ui";

const C = { paprika: "#A52A2A", agro: "#285943", gold: "#C8A46B", ink: "#263238", orange: "#D97706", red: "#B91C1C", sky: "#0284C7" };

export default function Dashboard() {
  const { data, loading, error } = useApi<any>("/dashboard");
  const router = useRouter();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const k = data.kpis;
  const qualityPie = [
    { name: "Aprobados", value: data.quality.byStatus.APROBADO ?? 0, color: C.agro },
    { name: "Rechazados", value: data.quality.byStatus.RECHAZADO ?? 0, color: C.red },
    { name: "Cuarentena", value: data.quality.byStatus.CUARENTENA ?? 0, color: C.orange },
    { name: "Pendientes", value: (data.quality.byStatus.PENDIENTE ?? 0) + (data.quality.byStatus.EN_EVALUACION ?? 0), color: C.gold },
  ].filter((x) => x.value > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Indicadores calculados en tiempo real desde la base de datos" actions={<><Badge tone="gold">Datos de demostración</Badge><Link href="/demo"><Button size="sm" variant="secondary"><PlayCircle className="h-4 w-4" />Ejecutar demostración</Button></Link></>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Producción total" value={kg(k.produccionTotalKg)} hint="Producto terminado acumulado" icon={<Scale className="h-4 w-4" />} onClick={() => router.push("/produccion")} />
        <Kpi label="Disponible en almacén" value={kg(k.stockDisponibleKg)} hint={`${num(k.stockDisponibleKg / 25, 0)} sacos · ${kg(k.stockReservadoKg)} reserv.`} icon={<Warehouse className="h-4 w-4" />} tone="agro" onClick={() => router.push("/inventario")} />
        <Kpi label="Lotes activos" value={k.lotesActivos} hint={`${k.lotesPendientes} pendientes de evaluación`} icon={<Layers className="h-4 w-4" />} tone="gold" />
        <Kpi label="Lotes aprobados" value={k.lotesAprobados} icon={<CheckCircle2 className="h-4 w-4" />} tone="agro" onClick={() => router.push("/calidad")} />
        <Kpi label="Lotes rechazados" value={k.lotesRechazados} hint={`${k.lotesCuarentena} en cuarentena`} icon={<XCircle className="h-4 w-4" />} tone="red" onClick={() => router.push("/calidad")} />
        <Kpi label="Ventas del mes" value={money(k.ventasMesPen)} hint="Pedidos no anulados (PEN)" icon={<TrendingUp className="h-4 w-4" />} onClick={() => router.push("/ventas")} />
        <Kpi label="Costo de producción" value={money(k.costoProduccionMes)} hint={`Año: ${money(k.costoProduccionAnio)} · ${money(k.costoPorKgAnio)}/kg`} icon={<Coins className="h-4 w-4" />} tone="ink" />
        <Kpi label="Margen bruto estimado" value={`${num(k.margenBrutoPct, 1)} %`} hint={`${money(k.margenBrutoPen)} en el año (base sin IGV)`} icon={<Percent className="h-4 w-4" />} tone="agro" />
        <Kpi label="Pedidos pendientes" value={k.pedidosPendientes} icon={<ClipboardList className="h-4 w-4" />} tone="gold" onClick={() => router.push("/ventas")} />
        <Kpi label="Compras por aprobar" value={k.comprasPorAprobar} icon={<ShoppingCart className="h-4 w-4" />} tone="gold" onClick={() => router.push("/compras")} />
        <Kpi label="Exportaciones en proceso" value={k.exportacionesEnProceso} icon={<Globe2 className="h-4 w-4" />} tone="ink" onClick={() => router.push("/exportaciones")} />
        <Kpi label="Smart contracts activos" value={k.contratosActivos} hint={<span><span className="text-emerald-600">{k.txConfirmadas} tx confirmadas</span> · <span className="text-red-600">{k.txFallidas} fallidas</span></span>} icon={<FileSignature className="h-4 w-4" />} onClick={() => router.push("/blockchain")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Producción mensual" subtitle="kg de páprika procesada (órdenes completadas)" />
          <CardBody className="h-72">
            <ResponsiveContainer>
              <BarChart data={data.series}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} /><YAxis tickLine={false} width={50} />
                <Tooltip formatter={(v: any) => kg(v)} /><Bar dataKey="produccionKg" name="Producción" fill={C.paprika} radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ventas mensuales" subtitle="Importe total en PEN" />
          <CardBody className="h-72">
            <ResponsiveContainer>
              <AreaChart data={data.series}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.agro} stopOpacity={0.35} /><stop offset="100%" stopColor={C.agro} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} /><YAxis tickLine={false} width={60} tickFormatter={(v) => `S/${num(v / 1000, 0)}k`} />
                <Tooltip formatter={(v: any) => money(v)} /><Area type="linear" dataKey="ventasPen" name="Ventas" stroke={C.agro} strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Distribución del inventario" subtitle="Disponible / reservado / en cuarentena por producto" />
          <CardBody className="h-72">
            <ResponsiveContainer>
              <BarChart data={data.inventory} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickLine={false} /><YAxis type="category" dataKey="product" width={190} tickLine={false} tick={{ fontSize: 10 }} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="disponible" name="Disponible" stackId="a" fill={C.agro} /><Bar dataKey="reservado" name="Reservado" stackId="a" fill={C.gold} /><Bar dataKey="cuarentena" name="Cuarentena" stackId="a" fill={C.orange} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Indicadores de calidad" subtitle={`${data.quality.inspections} inspecciones decididas`} />
          <CardBody>
            <div className="h-44">
              <ResponsiveContainer>
                <PieChart><Pie data={qualityPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>{qualityPie.map((e) => <Cell key={e.name} fill={e.color} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-bold text-agro dark:text-emerald-300">{data.quality.approvalRatePct != null ? `${num(data.quality.approvalRatePct, 0)}%` : "—"}</p><p className="text-[10px] text-muted">Tasa de aprobación</p></div>
              <div><p className="text-lg font-bold text-fg">{data.quality.avgMoisturePct != null ? `${num(data.quality.avgMoisturePct, 1)}%` : "—"}</p><p className="text-[10px] text-muted">Humedad prom.</p></div>
              <div><p className="text-lg font-bold text-paprika">{data.quality.avgAsta != null ? num(data.quality.avgAsta, 0) : "—"}</p><p className="text-[10px] text-muted">ASTA prom.</p></div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Actividades recientes" icon={<Activity className="h-4 w-4" />} subtitle="Registro de auditoría" />
          <div className="divide-y divide-line">
            {data.recent.length === 0 ? <Empty title="Sin actividad" /> : data.recent.map((r: any) => (
              <div key={r.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium text-fg">{r.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())} · <span className="text-muted">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</span></p><p className="text-xs text-muted">{r.user}</p></div>
                <span className="shrink-0 text-xs text-muted">{dateTime(r.at)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Alertas" icon={<AlertTriangle className="h-4 w-4" />} subtitle="Stock mínimo, vencimientos, lotes bloqueados, contratos y cobranza" />
          <div className="divide-y divide-line">
            {data.alerts.length === 0 ? <Empty title="Sin alertas" /> : data.alerts.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <Badge tone={a.level === "danger" ? "red" : a.level === "warning" ? "amber" : "blue"}>{a.type.replace(/_/g, " ")}</Badge>
                <p className="text-fg/90">{a.message}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted"><Link2 className="h-3 w-3" />Los importes y rendimientos son datos ficticios de demostración; no representan resultados productivos validados de Don Pimentón.</p>
    </div>
  );
}
