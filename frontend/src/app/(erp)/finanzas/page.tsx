"use client";
import * as React from "react";
import { Landmark, Plus } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, date, kg, num, isoDay } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Tabs, Badge, Kpi, Notice } from "@/components/ui";
import { ServerTable, LocalTable } from "@/components/DataTable";
import { CrudSection } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { Can } from "@/components/providers";

const M = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
type T = "flujo" | "movimientos" | "cxc" | "cxp" | "campanas" | "lotes" | "presupuestos" | "tc";
export default function Finanzas() {
  const [tab, setTab] = React.useState<T>("flujo");
  const [open, setOpen] = React.useState(false);
  const [rk, setRk] = React.useState(0);
  const [year, setYear] = React.useState(new Date().getFullYear());
  const summary = useApi<any>("/finance/summary", [rk]);
  const flow = useApi<any>(`/finance/cash-flow?year=${year}`, [rk]);
  const camps = useApi<any[]>("/finance/campaign-costs");
  const lots = useApi<any[]>("/finance/lot-profitability", [rk]);
  const ar = useApi<any[]>("/sales/receivables", [rk]);
  const ap = useApi<any[]>("/purchasing/payables", [rk]);
  const s = summary.data;
  return (
    <div className="space-y-4">
      <PageHeader title="Finanzas" subtitle="Ingresos, egresos, cuentas por cobrar y pagar, costos, presupuestos, flujo de caja y rentabilidad (PEN / USD)" icon={<Landmark className="h-5 w-5" />}
        actions={<Can perm="finance.write"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Registrar ingreso / egreso</Button></Can>} />
      {s && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cuentas por cobrar" value={money(s.receivablesPen)} hint={`${s.overdueReceivables} vencida(s)`} tone="agro" /><Kpi label="Cuentas por pagar" value={money(s.payablesPen)} tone="red" />
        <Kpi label="Ingresos acumulados" value={money(s.totalIncomePen)} /><Kpi label="Egresos acumulados" value={money(s.totalExpensePen)} tone="ink" />
      </div>}
      {s && <Notice>{s.disclaimer}</Notice>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "flujo", label: "Flujo de caja" }, { id: "movimientos", label: "Ingresos y egresos" }, { id: "cxc", label: "Por cobrar" }, { id: "cxp", label: "Por pagar" }, { id: "campanas", label: "Costos por campaña" }, { id: "lotes", label: "Rentabilidad por lote" }, { id: "presupuestos", label: "Presupuestos" }, { id: "tc", label: "Tipo de cambio" }]} />
      {tab === "flujo" && <Card>
        <CardHeader title={`Flujo de caja ${year}`} subtitle="Ingresos y egresos registrados vs. presupuesto (PEN)" actions={<div className="flex gap-1">{[year - 1, year, year + 1].map((y) => <Button key={y} size="sm" variant={y === year ? "primary" : "outline"} onClick={() => setYear(y)}>{y}</Button>)}</div>} />
        <CardBody className="h-80"><ResponsiveContainer><ComposedChart data={(flow.data?.months ?? []).map((m: any) => ({ ...m, mes: M[m.month - 1] }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="mes" /><YAxis width={70} tickFormatter={(v) => `S/${num(v / 1000, 0)}k`} /><Tooltip formatter={(v: any) => money(v)} /><Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="ingresos" name="Ingresos" fill="#285943" radius={[4, 4, 0, 0]} /><Bar dataKey="egresos" name="Egresos" fill="#A52A2A" radius={[4, 4, 0, 0]} /><Line dataKey="acumulado" name="Saldo acumulado" stroke="#C8A46B" strokeWidth={2} dot={false} /><Line dataKey="presupuestoIngresos" name="Ppto. ingresos" stroke="#285943" strokeDasharray="4 4" dot={false} /></ComposedChart></ResponsiveContainer></CardBody>
        <LocalTable rows={(flow.data?.months ?? []).map((m: any) => ({ ...m, id: m.month }))} pageSize={12} columns={[{ key: "m", header: "Mes", render: (r: any) => M[r.month - 1] }, { key: "i", header: "Ingresos", align: "right", render: (r: any) => money(r.ingresos) }, { key: "e", header: "Egresos", align: "right", render: (r: any) => money(r.egresos) }, { key: "n", header: "Neto", align: "right", render: (r: any) => <span className={r.neto < 0 ? "text-red-600" : "text-agro"}>{money(r.neto)}</span> }, { key: "a", header: "Acumulado", align: "right", render: (r: any) => money(r.acumulado) }, { key: "pi", header: "Ppto. ingresos", align: "right", render: (r: any) => money(r.presupuestoIngresos) }, { key: "pe", header: "Ppto. egresos", align: "right", render: (r: any) => money(r.presupuestoEgresos) }]} />
      </Card>}
      <Card>
        {tab === "movimientos" && <ServerTable path="/finance/transactions" reloadKey={rk} filters={[{ key: "type", label: "Tipo", options: [{ value: "INGRESO", label: "Ingresos" }, { value: "EGRESO", label: "Egresos" }] }]} columns={[
          { key: "code", header: "Código", render: (r: any) => <span className="font-mono text-xs">{r.code}</span> }, { key: "d", header: "Fecha", render: (r: any) => date(r.date) }, { key: "t", header: "Tipo", render: (r: any) => <Badge tone={r.type === "INGRESO" ? "green" : "red"}>{r.type}</Badge> },
          { key: "category", header: "Categoría", render: (r: any) => <span className="text-xs">{r.category}</span> }, { key: "description", header: "Descripción", render: (r: any) => <span className="text-xs">{r.description}{r.simulated && <Badge tone="gold" className="ml-1">simulado</Badge>}</span> },
          { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "fx", header: "T.C.", align: "right", render: (r: any) => r.currency === "PEN" ? "—" : Number(r.exchangeRate) }, { key: "pen", header: "PEN", align: "right", render: (r: any) => money(r.amountPen) },
          { key: "ref", header: "Vinculado a", render: (r: any) => r.campaign?.code ?? r.lot?.code ?? r.referenceCode ?? "—", hideOnMobile: true }]} />}
        {tab === "cxc" && <LocalTable rows={ar.data ?? []} columns={[{ key: "code", header: "CxC" }, { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "o", header: "Origen", render: (r: any) => r.salesOrder?.code ?? r.exportOrder?.code }, { key: "due", header: "Vence", render: (r: any) => date(r.dueDate) }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "s", header: "Saldo", align: "right", render: (r: any) => money(Number(r.amount) - Number(r.collected), r.currency) }, { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }]} />}
        {tab === "cxp" && <LocalTable rows={ap.data ?? []} columns={[{ key: "code", header: "CxP" }, { key: "s", header: "Proveedor", render: (r: any) => r.supplier.name }, { key: "doc", header: "Documento", render: (r: any) => r.documentRef }, { key: "due", header: "Vence", render: (r: any) => date(r.dueDate) }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "p", header: "Saldo", align: "right", render: (r: any) => money(Number(r.amount) - Number(r.paidAmount), r.currency) }, { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }]} />}
        {tab === "campanas" && <LocalTable rows={(camps.data ?? []).map((c: any) => ({ ...c, id: c.code }))} columns={[{ key: "code", header: "Campaña" }, { key: "parcel", header: "Parcela" }, { key: "variety", header: "Variedad" }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "h", header: "Cosechado", align: "right", render: (r: any) => kg(r.harvestedKg) }, { key: "a", header: "Actividades", align: "right", render: (r: any) => money(r.activitiesCost) }, { key: "o", header: "Otros", align: "right", render: (r: any) => money(r.otherCost) }, { key: "t", header: "Total", align: "right", render: (r: any) => <b>{money(r.totalCost)}</b> }, { key: "k", header: "S/ por kg", align: "right", render: (r: any) => r.costPerKg ? money(r.costPerKg) : "—" }, { key: "ha", header: "S/ por ha", align: "right", render: (r: any) => money(r.costPerHa) }]} />}
        {tab === "lotes" && <LocalTable rows={(lots.data ?? []).map((l: any) => ({ ...l, id: l.code }))} columns={[{ key: "code", header: "Lote" }, { key: "d", header: "Producción", render: (r: any) => date(r.productionDate) }, { key: "q", header: "Calidad", render: (r: any) => <StatusBadge status={r.qualityStatus} /> }, { key: "kg", header: "Producido", align: "right", render: (r: any) => kg(r.quantityKg) }, { key: "y", header: "Rend.", align: "right", render: (r: any) => r.yieldPct ? `${num(r.yieldPct, 1)} %` : "—" }, { key: "u", header: "Costo/kg", align: "right", render: (r: any) => money(r.unitCost) }, { key: "s", header: "Vendido", align: "right", render: (r: any) => kg(r.soldKg) }, { key: "rev", header: "Ingresos (sin IGV)", align: "right", render: (r: any) => money(r.revenue) }, { key: "c", header: "Costo de ventas", align: "right", render: (r: any) => money(r.costOfSales) }, { key: "m", header: "Margen", align: "right", render: (r: any) => <span className={r.grossMargin < 0 ? "text-red-600" : "text-agro"}>{money(r.grossMargin)}{r.marginPct != null ? ` (${r.marginPct} %)` : ""}</span> }]} />}
        {tab === "presupuestos" && <CrudSection path="/finance/budgets" title="presupuesto" writePerm="finance.write" newLabel="Nuevo presupuesto" columns={[{ key: "year", header: "Año" }, { key: "m", header: "Mes", render: (r: any) => M[r.month - 1] }, { key: "type", header: "Tipo", render: (r: any) => <Badge tone={r.type === "INGRESO" ? "green" : "red"}>{r.type}</Badge> }, { key: "category", header: "Categoría" }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amountPen) }]}
          fields={[{ name: "year", label: "Año", type: "number", required: true, min: 2020 }, { name: "month", label: "Mes", type: "select", required: true, options: M.map((m, i) => ({ value: i + 1, label: m })) }, { name: "type", label: "Tipo", type: "select", required: true, options: [{ value: "INGRESO", label: "Ingreso" }, { value: "EGRESO", label: "Egreso" }] }, { name: "category", label: "Categoría", required: true }, { name: "amountPen", label: "Importe (S/)", type: "number", required: true, min: 0 }]} />}
        {tab === "tc" && <CrudSection path="/finance/exchange-rates" title="tipo de cambio" writePerm="finance.write" newLabel="Nuevo tipo de cambio" columns={[{ key: "d", header: "Fecha", render: (r: any) => date(r.date) }, { key: "currency", header: "Moneda" }, { key: "rate", header: "PEN por unidad", align: "right", render: (r: any) => Number(r.rate).toFixed(4) }, { key: "source", header: "Fuente" }]}
          toEdit={(r: any) => ({ date: String(r.date).slice(0, 10), currency: r.currency, rate: r.rate, source: r.source })}
          fields={[{ name: "date", label: "Fecha", type: "date", required: true }, { name: "currency", label: "Moneda", type: "select", required: true, options: [{ value: "USD", label: "USD" }] }, { name: "rate", label: "Tipo de cambio", type: "number", required: true, min: 0.0001, step: "any" }, { name: "source", label: "Fuente" }]} />}
      </Card>
      <FormDialog open={open} onClose={() => { setOpen(false); setRk((k) => k + 1); }} title="Registrar ingreso / egreso" initial={{ type: "EGRESO", currency: "PEN", date: isoDay() }} successMessage="Movimiento financiero registrado"
        fields={[{ name: "type", label: "Tipo", type: "select", required: true, options: [{ value: "INGRESO", label: "Ingreso" }, { value: "EGRESO", label: "Egreso" }] }, { name: "category", label: "Categoría", required: true, placeholder: "SERVICIOS, ADMINISTRACION…" },
          { name: "date", label: "Fecha", type: "date", required: true }, { name: "currency", label: "Moneda", type: "select", required: true, options: [{ value: "PEN", label: "PEN" }, { value: "USD", label: "USD" }] },
          { name: "amount", label: "Importe", type: "number", required: true, min: 0.01, step: "any" }, { name: "exchangeRate", label: "Tipo de cambio utilizado", type: "number", step: "any", required: true, show: (v) => v.currency === "USD" },
          { name: "description", label: "Descripción", required: true, full: true }]}
        onSubmit={(v, key) => api("/finance/transactions", { body: v, idempotencyKey: key })} />
    </div>
  );
}
