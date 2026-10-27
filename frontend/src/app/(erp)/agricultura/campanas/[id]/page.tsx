"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Plus, Wheat, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, money, date, num, isoDay } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, Kpi, Empty } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { useOptions } from "@/components/Crud";
import { Can, useToast } from "@/components/providers";

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: c, loading, error, reload } = useApi<any>(`/agriculture/campaigns/${id}`);
  const [act, setAct] = React.useState(false);
  const [harv, setHarv] = React.useState(false);
  const toast = useToast();
  const inputs = useOptions("/inventory/products?type=INSUMO&pageSize=100", (p) => `${p.name} (${p.unit})`);
  if (loading && !c) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  return (
    <div className="space-y-4">
      <Link href="/agricultura" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Campañas</Link>
      <PageHeader title={`Campaña ${c.code}`} subtitle={`${c.parcel.code} ${c.parcel.name} · ${c.variety}`} icon={<Wheat className="h-5 w-5" />}
        actions={<><StatusBadge status={c.status} /><Can perm="agri.write"><Button variant="outline" onClick={() => setAct(true)}><Plus className="h-4 w-4" />Actividad</Button><Button onClick={() => setHarv(true)}><Wheat className="h-4 w-4" />Registrar cosecha</Button></Can></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cosechado" value={kg(c.kpis.harvestedKg)} hint={`Estimado: ${kg(c.estimatedYieldKg)}`} />
        <Kpi label="Cumplimiento" value={c.kpis.yieldVsEstimatePct != null ? `${num(c.kpis.yieldVsEstimatePct, 1)} %` : "—"} tone="agro" />
        <Kpi label="Rendimiento por ha" value={c.kpis.yieldKgPerHa != null ? kg(c.kpis.yieldKgPerHa) : "—"} tone="gold" />
        <Kpi label="Costo total" value={money(c.costs.total)} hint={c.kpis.costPerKg ? `${money(c.kpis.costPerKg)} por kg fresco` : undefined} tone="ink" />
      </div>
      <Card><CardBody><KeyValue cols={4} items={[["Siembra", date(c.sowingDate)], ["Cosecha estimada", date(c.estHarvestDate)], ["Cosecha real", date(c.actualHarvestDate)], ["Superficie", `${c.parcel.areaHa} ha`], ["Ubicación", c.parcel.location], ["Notas", c.notes]]} /></CardBody></Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Historial de actividades" subtitle="Riego, fertilización, control de plagas, mantenimiento y cosecha" />
          <Table rows={c.activities} empty={<Empty title="Sin actividades" />} columns={[
            { key: "date", header: "Fecha", render: (r: any) => date(r.date) }, { key: "type", header: "Tipo", render: (r: any) => <StatusBadge status={r.type} /> },
            { key: "description", header: "Descripción" }, { key: "p", header: "Insumo", render: (r: any) => r.product ? `${r.product.name} · ${r.quantity}` : "—" },
            { key: "cost", header: "Costo", align: "right", render: (r: any) => money(r.cost) },
          ]} />
        </Card>
        <Card>
          <CardHeader title="Cosechas y lotes de materia prima" />
          <Table rows={c.harvests} empty={<Empty title="Sin cosechas" hint="Registre una cosecha para generar el lote de materia prima." />} columns={[
            { key: "code", header: "Cosecha", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "date", header: "Fecha", render: (r: any) => date(r.date) },
            { key: "kg", header: "kg", align: "right", render: (r: any) => kg(r.quantityKg) },
            { key: "lot", header: "Lote MP", render: (r: any) => r.lot ? <Link className="font-medium text-paprika hover:underline" href={`/inventario/lotes/${r.lot.code}`}>{r.lot.code}</Link> : "—" },
            { key: "s", header: "Procesamiento", render: (r: any) => r.sentToProcessing ? <StatusBadge status="ENVIADA" label="Enviada" /> : <Can perm="agri.write" fallback={<StatusBadge status="PENDIENTE" />}><Button size="sm" variant="outline" onClick={async () => { try { await api(`/agriculture/harvests/${r.id}/send-to-processing`, { method: "POST" }); toast.success("Enviado a procesamiento"); reload(); } catch (e: any) { toast.error("Error", e.message); } }}><Send className="h-3.5 w-3.5" />Enviar</Button></Can> },
          ]} />
        </Card>
      </div>
      <FormDialog open={act} onClose={() => { setAct(false); reload(); }} title="Registrar actividad agrícola" initial={{ date: isoDay(), cost: 0 }} successMessage="Actividad registrada"
        fields={[
          { name: "type", label: "Tipo", type: "select", required: true, options: ["SIEMBRA", "RIEGO", "FERTILIZACION", "CONTROL_PLAGAS", "MANTENIMIENTO", "COSECHA", "OTRO"].map((v) => ({ value: v, label: v })) },
          { name: "date", label: "Fecha", type: "date", required: true }, { name: "description", label: "Descripción", required: true, full: true },
          { name: "responsible", label: "Responsable", required: true }, { name: "cost", label: "Costo (S/)", type: "number", min: 0, step: "any" },
          { name: "productId", label: "Insumo utilizado (opcional)", type: "select", options: inputs }, { name: "quantity", label: "Cantidad de insumo", type: "number", min: 0, step: "any" },
          { name: "consumeStock", label: "Descontar insumo del almacén ALM-INS", type: "checkbox" },
        ]}
        onSubmit={(v, key) => api(`/agriculture/campaigns/${id}/activities`, { body: v, idempotencyKey: key })} />
      <FormDialog open={harv} onClose={() => { setHarv(false); reload(); }} title="Registrar cosecha" subtitle="Se generará automáticamente un lote único de materia prima (MP-AAAA-NNN) e ingresará a ALM-MP" initial={{ date: isoDay() }} successMessage="Cosecha registrada y lote generado"
        fields={[{ name: "date", label: "Fecha de cosecha", type: "date", required: true }, { name: "quantityKg", label: "Cantidad (kg de pimentón fresco)", type: "number", required: true, min: 0.1, step: "any" }, { name: "notes", label: "Observaciones", type: "textarea" }]}
        onSubmit={(v, key) => api(`/agriculture/campaigns/${id}/harvests`, { body: v, idempotencyKey: key })} />
    </div>
  );
}
