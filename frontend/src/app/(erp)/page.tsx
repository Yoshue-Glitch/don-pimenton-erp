"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import {
  TrendingUp, Banknote, Globe2, Factory, Boxes, CheckCircle2, Users, IdCard, CalendarDays, Layers, XCircle, ClipboardList, ShoppingCart,
  FileSignature, Link2, Coins, Percent, Sprout, Megaphone, Landmark, PlayCircle, Activity,
} from "lucide-react";
import { useApi } from "@/lib/hooks";
import { money, kg, num, date, dateTime, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, Kpi, Trend, Loading, ErrorBox, Badge, Button, Empty, StatusBadge } from "@/components/ui";
import { useAuth } from "@/components/providers";

const C = { red: "#A52A2A", green: "#2F6B45", forest: "#1C3F2B", gold: "#D9A441", blue: "#2B6CB0", salmon: "#E28A7E", sage: "#9DBFA6", gray: "#6B7280", amber: "#B26B00" };
const PIE = [C.red, C.green, C.gold, C.blue, C.salmon, C.sage, C.gray];
const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];
const MES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const mLabel = (k: string) => MES[Number(k.slice(5, 7)) - 1];
const usd = (v: number) => `US$ ${Math.round(v).toLocaleString("en-US")}`;
const moneyK = (v: number) => (Math.abs(v) >= 1000 ? `S/ ${(v / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} mil` : money(v));

function Peppers() {
  return (
    <svg viewBox="0 0 150 80" className="pointer-events-none absolute bottom-[-12px] right-[170px] hidden w-[150px] opacity-90 xl:block" aria-hidden>
      <g fill="#A52A2A"><path d="M20 30c-12 4-16 20-8 34 6 10 22 12 32 4C30 62 26 44 20 30z" /><path d="M70 22c-14 2-22 18-16 34 4 12 20 18 32 10C72 58 70 40 70 22z" fill="#8C2121" /><path d="M118 28c-12 4-16 20-8 34 6 10 22 12 32 4-14-6-18-24-24-38z" /></g>
      <g stroke="#2F6B45" strokeWidth="4" strokeLinecap="round" fill="none"><path d="M20 30c2-8 8-12 14-12" /><path d="M70 22c2-8 8-12 14-12" /><path d="M118 28c2-8 8-12 14-12" /></g>
    </svg>
  );
}

function AreaCard({ href, icon, name, value, sub, red }: { href: string; icon: React.ReactNode; name: string; value: React.ReactNode; sub: string; red?: boolean }) {
  return (
    <Link href={href} className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-line bg-card p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-agro">
      <span className={cn("flex h-[34px] w-[34px] items-center justify-center rounded-[10px] [&>svg]:h-[18px] [&>svg]:w-[18px]", red ? "bg-paprika-50 text-paprika" : "bg-agro-50 text-agro")}>{icon}</span>
      <small className="text-[11px] font-bold uppercase tracking-[.06em] text-muted">{name}</small>
      <b className="truncate text-lg font-extrabold text-fg">{value}</b>
      <em className="text-[11.5px] not-italic text-muted">{sub}</em>
    </Link>
  );
}

function FunnelRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="grid grid-cols-[96px_1fr_84px] items-center gap-3 text-[12.5px] sm:grid-cols-[150px_1fr_92px]">
      <span className="text-fg/90">{label}</span>
      <div className="h-7 overflow-hidden rounded-lg bg-soft"><i className="block h-full rounded-lg" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} /></div>
      <b className="text-right text-fg">{kg(value)}</b>
    </div>
  );
}

export default function Dashboard() {
  const { data, loading, error } = useApi<any>("/dashboard");
  const { user } = useAuth();
  const router = useRouter();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const k = data.kpis, o = data.overview;
  const cur = o.current;
  const isGM = user?.role === "ADMIN";
  const first = (user?.name ?? "").split(" ")[0];
  const todayLong = new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Lima" });
  const monthLong = `${MES_L[Number(o.month.slice(5, 7)) - 1]} ${o.month.slice(0, 4)}`;
  const series = o.series.map((s: any) => ({ ...s, mes: mLabel(s.key) }));
  const f = o.funnel;
  const fmax = Math.max(f.cosechadoKg, f.procesadoKg, 1);
  const vendidoKg = f.ventaNacionalKg + f.exportadoKg;
  const qualityPie = [
    { name: "Aprobados", value: data.quality.byStatus.APROBADO ?? 0, color: C.green },
    { name: "Rechazados", value: data.quality.byStatus.RECHAZADO ?? 0, color: C.red },
    { name: "Cuarentena", value: data.quality.byStatus.CUARENTENA ?? 0, color: C.amber },
    { name: "Pendientes", value: (data.quality.byStatus.PENDIENTE ?? 0) + (data.quality.byStatus.EN_EVALUACION ?? 0), color: C.gold },
  ].filter((x) => x.value > 0);
  const totUsd = o.exportPipelineUsd;

  return (
    <div className="space-y-[18px]">
      {/* Bienvenida */}
      <div className="relative flex flex-col items-start justify-between gap-5 overflow-hidden rounded-[18px] border border-line bg-[linear-gradient(110deg,#fff_45%,#F3E3DB_100%)] px-7 py-6 dark:bg-[linear-gradient(110deg,rgb(var(--card))_45%,#3a2622_100%)] md:flex-row md:items-center">
        <div>
          <h1 className="text-[26px] font-extrabold text-fg sm:text-[30px]">{isGM ? `¡Bienvenida, ${first}!` : `Panel de ${user?.name ?? ""}`}</h1>
          <p className="text-muted">{isGM ? "Panel gerencial · " : ""}Don Pimentón · datos de demostración</p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-forest px-3 py-1.5 text-[11.5px] font-bold text-white"><CalendarDays className="h-3.5 w-3.5" />Resumen de {monthLong} · {todayLong}</span>
        </div>
        <Peppers />
        <div className="relative z-[1] text-left font-display text-[26px] italic leading-[1.1] text-paprika md:text-right">Pimentón<br />Arequipeño</div>
      </div>

      {/* Indicadores gerenciales */}
      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="green" icon={<TrendingUp />} label="Ingresos del mes" value={moneyK(cur.ingresos)} hint="Cobros, ventas y otros ingresos" trend={<Trend value={o.trends.ingresos} />} onClick={() => router.push("/finanzas")} />
        <Kpi tone={cur.resultado >= 0 ? "blue" : "red"} icon={<Banknote />} label="Resultado del mes" value={moneyK(cur.resultado)} hint={`Margen ${cur.ingresos ? Math.round((cur.resultado / cur.ingresos) * 100) : 0}%`} trend={<Trend value={o.trends.resultado} />} />
        <Kpi tone="red" icon={<Globe2 />} label="Exportaciones" value={usd(totUsd)} hint={`En cartera · ${num(cur.exportKg)} kg embarcados este mes`} onClick={() => router.push("/exportaciones")} />
        <Kpi tone="amber" icon={<Factory />} label="Producción del mes" value={kg(cur.produccionKg)} hint="Páprika procesada" trend={<Trend value={o.trends.produccionKg} />} onClick={() => router.push("/produccion")} />
        <Kpi tone="green" icon={<Boxes />} label="Stock disponible" value={kg(k.stockDisponibleKg)} hint={`${num(k.stockDisponibleKg / 25)} sacos · producto terminado`} onClick={() => router.push("/inventario")} />
        <Kpi tone="blue" icon={<CheckCircle2 />} label="Calidad aprobada" value={data.quality.approvalRatePct != null ? `${num(data.quality.approvalRatePct)}%` : "—"} hint="Lotes conformes" onClick={() => router.push("/calidad")} />
        <Kpi tone="amber" icon={<Users />} label="Clientes activos" value={o.customers.active} hint={`${o.customers.international} internacionales`} onClick={() => router.push("/ventas?tab=clientes")} />
        <Kpi tone="red" icon={<IdCard />} label="Colaboradores" value={o.workers.active} hint={o.workers.payrollPen != null ? `Planilla ${moneyK(o.workers.payrollPen)}` : "Activos en planilla"} onClick={() => router.push("/rrhh")} />
      </div>

      <p className="pt-1 text-[13px] font-bold uppercase tracking-[.12em] text-muted">Operación, calidad y blockchain</p>
      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="green" icon={<Layers />} label="Lotes" value={`${k.lotesActivos} activos`} hint={`${k.lotesAprobados} aprobados · ${k.lotesPendientes} por evaluar`} />
        <Kpi tone="red" icon={<XCircle />} label="Lotes rechazados" value={k.lotesRechazados} hint={`${k.lotesCuarentena} en cuarentena · bloqueados para despacho`} />
        <Kpi tone="amber" icon={<Coins />} label="Costo de producción" value={money(k.costoProduccionMes)} hint={`Año: ${moneyK(k.costoProduccionAnio)} · ${money(k.costoPorKgAnio)}/kg`} />
        <Kpi tone="blue" icon={<Percent />} label="Margen bruto estimado" value={`${num(k.margenBrutoPct, 1)} %`} hint={`${moneyK(k.margenBrutoPen)} en el año (sin IGV)`} />
        <Kpi tone="amber" icon={<ClipboardList />} label="Pedidos pendientes" value={k.pedidosPendientes} hint={`Ventas del mes: ${money(k.ventasMesPen)}`} onClick={() => router.push("/ventas")} />
        <Kpi tone="red" icon={<ShoppingCart />} label="Compras por aprobar" value={k.comprasPorAprobar} hint="Esperan a Gerencia" onClick={() => router.push("/compras")} />
        <Kpi tone="green" icon={<FileSignature />} label="Smart contracts activos" value={k.contratosActivos} hint={`${k.exportacionesEnProceso} exportaciones en proceso`} onClick={() => router.push("/blockchain")} />
        <Kpi tone="blue" icon={<Link2 />} label="Transacciones blockchain" value={`${k.txConfirmadas} confirmadas`} hint={`${k.txFallidas} rechazadas o fallidas`} onClick={() => router.push("/blockchain")} />
      </div>

      <div className="grid gap-[18px] xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Ingresos vs. egresos" subtitle="últimos 6 meses (S/)" />
          <CardBody className="h-[300px]">
            <ResponsiveContainer>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `S/ ${num(v / 1000)}k`} />
                <Tooltip formatter={(v: any) => money(v)} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ingresos" name="Ingresos" fill={C.green} radius={[5, 5, 0, 0]} />
                <Bar dataKey="egresos" name="Egresos" fill={C.red} radius={[5, 5, 0, 0]} />
                <Line dataKey="resultado" name="Resultado" stroke={C.gold} strokeWidth={2.5} dot={{ r: 4, fill: C.gold }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Exportaciones por destino" subtitle="valor US$ en cartera" />
          <CardBody className="flex flex-wrap items-center gap-5">
            {o.exportsByCountry.length === 0 ? <Empty title="Sin exportaciones registradas" /> : <>
              <div className="relative h-[170px] w-[170px]">
                <ResponsiveContainer><PieChart><Pie data={o.exportsByCountry} dataKey="usd" nameKey="country" innerRadius={55} outerRadius={82} stroke="#fff" strokeWidth={2}>{o.exportsByCountry.map((_: any, i: number) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip formatter={(v: any) => usd(v)} /></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><b className="text-[15px] font-extrabold text-fg">{usd(totUsd)}</b><span className="text-[11px] text-muted">en cartera</span></div>
              </div>
              <div className="flex min-w-[140px] flex-1 flex-col gap-2.5 text-[12.5px]">
                {o.exportsByCountry.map((c: any, i: number) => (
                  <span key={c.country} className="flex items-start gap-2"><i className="mt-[3px] h-[11px] w-[11px] shrink-0 rounded-full" style={{ background: PIE[i % PIE.length] }} /><span>{c.country}<br /><b>{usd(c.usd)}</b> · {Math.round((c.usd / totUsd) * 100)}%</span></span>
                ))}
              </div>
            </>}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-[18px] xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Producción vs. ventas" subtitle="kg por mes · nacional y exportación" />
          <CardBody className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v: any) => kg(v)} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="produccionKg" name="Producción" fill={C.green} radius={[4, 4, 0, 0]} />
                <Bar dataKey="exportKg" name="Exportación" stackId="v" fill={C.red} />
                <Bar dataKey="ventasNacKg" name="Venta nacional" stackId="v" fill={C.gold} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Cadena productiva" subtitle="acumulado de la temporada" />
          <CardBody className="flex flex-col gap-3.5">
            <FunnelRow label="Cosechado (fresco)" value={f.cosechadoKg} max={fmax} color={C.sage} />
            <FunnelRow label="Procesado (páprika)" value={f.procesadoKg} max={fmax} color={C.green} />
            <FunnelRow label="Exportado" value={f.exportadoKg} max={fmax} color={C.red} />
            <FunnelRow label="Venta nacional" value={f.ventaNacionalKg} max={fmax} color={C.gold} />
            <p className="border-t border-line pt-3 text-[11.5px] text-muted">
              Rendimiento de secado (fresco a páprika): <b className="text-fg">{f.rendimientoSecadoPct != null ? `${num(f.rendimientoSecadoPct, 1)}%` : "—"}</b> · Exportación: <b className="text-fg">{vendidoKg ? Math.round((f.exportadoKg / vendidoKg) * 100) : 0}%</b> del volumen vendido
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-[18px] xl:grid-cols-3">
        <Card>
          <CardHeader title="Alertas" subtitle={`${data.alerts.length} por revisar`} />
          <ul className="flex flex-col gap-0.5 p-3">
            {data.alerts.length === 0 ? <Empty title="Todo en orden" /> : data.alerts.slice(0, 6).map((a: any, i: number) => (
              <li key={i} className="flex items-start gap-3 rounded-[10px] px-2 py-2.5 hover:bg-bg">
                <span className={cn("mt-[5px] h-[9px] w-[9px] shrink-0 rounded-full", a.level === "danger" ? "bg-paprika" : a.level === "warning" ? "bg-amberx" : "bg-bluex")} />
                <div><b className="block text-[13px] text-fg">{a.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}</b><small className="text-xs text-muted">{a.message}</small></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Próximos embarques" actions={<Link href="/exportaciones" className="text-xs font-semibold text-bluex">Ver todos →</Link>} />
          <CardBody>
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-[12.5px]">
                <thead><tr className="bg-soft text-left"><th className="px-2.5 py-2 font-bold">Embarque</th><th className="px-2.5 py-2 font-bold">Destino</th><th className="px-2.5 py-2 font-bold">Estado</th></tr></thead>
                <tbody>
                  {o.upcomingShipments.length === 0 ? <tr><td colSpan={3} className="p-6 text-center text-muted">Sin embarques</td></tr> : o.upcomingShipments.map((r: any) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-2.5 py-2"><Link href={`/exportaciones/${r.id}`} className="font-bold text-fg hover:underline">{r.code}</Link><br /><small className="text-muted">{r.etd ? date(r.etd) : "Fecha por definir"}</small></td>
                      <td className="px-2.5 py-2">{r.country}<br /><small className="text-muted">{r.currency === "USD" ? usd(r.amount) : money(r.amount, r.currency)}</small></td>
                      <td className="px-2.5 py-2"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link href="/smart-contract"><Button variant="secondary" className="mt-3.5 w-full"><FileSignature className="h-4 w-4" />Smart Contract</Button></Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Leads por canal" subtitle={`${num(o.marketing.leads)} prospectos`} />
          <CardBody className="h-[250px]">
            {o.marketing.leadsByChannel.length === 0 ? <Empty title="Sin campañas" /> : (
              <ResponsiveContainer>
                <BarChart data={o.marketing.leadsByChannel} layout="vertical" margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} /><YAxis type="category" dataKey="channel" width={70} tickLine={false} axisLine={false} />
                  <Tooltip /><Bar dataKey="leads" name="Leads" fill={C.green} radius={[0, 5, 5, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="pt-1 text-[13px] font-bold uppercase tracking-[.12em] text-muted">Estado por área</p>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 2xl:grid-cols-7">
        <AreaCard href="/agricultura" icon={<Sprout />} name="Agrícola" value={kg(f.cosechadoKg)} sub="cosecha acumulada" />
        <AreaCard href="/produccion" icon={<Factory />} name="Procesamiento" value={`${k.lotesPendientes} por evaluar`} sub={`${data.quality.approvalRatePct != null ? num(data.quality.approvalRatePct) : "—"}% calidad aprobada`} />
        <AreaCard href="/ventas" icon={<ShoppingCart />} name="Comercial" value={moneyK(k.ventasMesPen)} sub="ventas nacionales del mes" />
        <AreaCard href="/finanzas" icon={<Landmark />} name="Finanzas" value={moneyK(o.cashPen)} sub="caja acumulada" />
        <AreaCard href="/rrhh" icon={<IdCard />} name="RR.HH." value={`${o.workers.active} activos`} sub={o.workers.payrollPen != null ? `${moneyK(o.workers.payrollPen)} en planilla` : "colaboradores"} />
        <AreaCard href="/exportaciones" icon={<Globe2 />} name="Exportaciones" value={usd(totUsd)} sub="en cartera" red />
        <AreaCard href="/marketing" icon={<Megaphone />} name="Marketing" value={`${num(o.marketing.leads)} leads`} sub={`${o.marketing.active} campañas activas`} red />
      </div>

      <div className="grid gap-[18px] xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Distribución del inventario" subtitle="Disponible / reservado / en cuarentena por producto" />
          <CardBody className="h-72">
            <ResponsiveContainer>
              <BarChart data={data.inventory} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} /><YAxis type="category" dataKey="product" width={190} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="disponible" name="Disponible" stackId="a" fill={C.green} /><Bar dataKey="reservado" name="Reservado" stackId="a" fill={C.gold} /><Bar dataKey="cuarentena" name="Cuarentena" stackId="a" fill={C.red} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Indicadores de calidad" subtitle={`${data.quality.inspections} inspecciones decididas`} />
          <CardBody>
            <div className="h-44">
              <ResponsiveContainer><PieChart><Pie data={qualityPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>{qualityPie.map((e) => <Cell key={e.name} fill={e.color} />)}</Pie><Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /></PieChart></ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-extrabold text-agro dark:text-emerald-300">{data.quality.approvalRatePct != null ? `${num(data.quality.approvalRatePct)}%` : "—"}</p><p className="text-[10px] text-muted">Aprobación</p></div>
              <div><p className="text-lg font-extrabold text-fg">{data.quality.avgMoisturePct != null ? `${num(data.quality.avgMoisturePct, 1)}%` : "—"}</p><p className="text-[10px] text-muted">Humedad prom.</p></div>
              <div><p className="text-lg font-extrabold text-paprika">{data.quality.avgAsta != null ? num(data.quality.avgAsta) : "—"}</p><p className="text-[10px] text-muted">ASTA prom.</p></div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Actividades recientes" icon={<Activity className="h-4 w-4" />} subtitle="Registro de auditoría" actions={<><Badge tone="gold">Datos de demostración</Badge><Link href="/demo"><Button size="sm" variant="secondary"><PlayCircle className="h-4 w-4" />Ejecutar demostración</Button></Link></>} />
        <div className="divide-y divide-line">
          {data.recent.length === 0 ? <Empty title="Sin actividad" /> : data.recent.map((r: any) => (
            <div key={r.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0"><p className="truncate font-medium text-fg">{r.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())} · <span className="text-muted">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</span></p><p className="text-xs text-muted">{r.user}</p></div>
              <span className="shrink-0 text-xs text-muted">{dateTime(r.at)}</span>
            </div>
          ))}
        </div>
      </Card>
      <p className="text-[11px] text-muted">Los importes y rendimientos son datos ficticios de demostración; no representan resultados productivos validados de Don Pimentón.</p>
    </div>
  );
}
