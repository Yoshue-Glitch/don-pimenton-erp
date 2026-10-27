"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Sprout, Plus, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, money, date } from "@/lib/utils";
import { Card, PageHeader, Tabs, StatusBadge, Button } from "@/components/ui";
import { ServerTable } from "@/components/DataTable";
import { CrudSection, useOptions } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { Can, useToast } from "@/components/providers";

const ACT = ["SIEMBRA", "RIEGO", "FERTILIZACION", "CONTROL_PLAGAS", "MANTENIMIENTO", "COSECHA", "OTRO"].map((v) => ({ value: v, label: v.replace("_", " ").toLowerCase() }));

export default function Agricultura() {
  const [tab, setTab] = React.useState<"campanas" | "parcelas" | "actividades" | "cosechas">("campanas");
  const [newCamp, setNewCamp] = React.useState(false);
  const [rk, setRk] = React.useState(0);
  const router = useRouter();
  const toast = useToast();
  const parcels = useOptions("/agriculture/parcels?pageSize=100", (p) => `${p.code} — ${p.name}`);
  const workers = useOptions("/hr/workers?pageSize=100", (w) => `${w.firstName} ${w.lastName}`);
  return (
    <div className="space-y-4">
      <PageHeader title="Gestión agrícola" subtitle="Parcelas, campañas, seguimiento de actividades y cosechas" icon={<Sprout className="h-5 w-5" />}
        actions={<Can perm="agri.write"><Button onClick={() => setNewCamp(true)}><Plus className="h-4 w-4" />Nueva campaña</Button></Can>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "campanas", label: "Campañas" }, { id: "parcelas", label: "Parcelas" }, { id: "actividades", label: "Actividades" }, { id: "cosechas", label: "Cosechas" }]} />
      <Card>
        {tab === "campanas" && (
          <ServerTable path="/agriculture/campaigns" reloadKey={rk} onRowClick={(r: any) => router.push(`/agricultura/campanas/${r.id}`)}
            filters={[{ key: "status", label: "Estado", options: ["PLANIFICADA", "EN_CURSO", "COSECHADA", "CERRADA"].map((v) => ({ value: v, label: v })) }]}
            columns={[
              { key: "code", header: "Código", render: (r: any) => <span className="font-semibold">{r.code}</span> },
              { key: "parcel", header: "Parcela", render: (r: any) => r.parcel.code },
              { key: "variety", header: "Variedad" },
              { key: "sowingDate", header: "Siembra", render: (r: any) => date(r.sowingDate) },
              { key: "est", header: "Cosecha est. / real", render: (r: any) => `${date(r.estHarvestDate)} / ${date(r.actualHarvestDate)}`, hideOnMobile: true },
              { key: "y", header: "Rend. est. / real", align: "right", render: (r: any) => `${kg(r.estimatedYieldKg)} / ${kg(r.actualYieldKg)}` },
              { key: "c", header: "Costos", align: "right", render: (r: any) => money(r.costs.total) },
              { key: "status", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
            ]} />
        )}
        {tab === "parcelas" && (
          <CrudSection path="/agriculture/parcels" title="parcela" writePerm="agri.write" newLabel="Nueva parcela"
            filters={[{ key: "status", label: "Estado", options: ["ACTIVA", "EN_DESCANSO", "EN_PREPARACION", "INACTIVA"].map((v) => ({ value: v, label: v })) }]}
            columns={[
              { key: "code", header: "Código", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "name", header: "Nombre" },
              { key: "location", header: "Ubicación", hideOnMobile: true }, { key: "areaHa", header: "Superficie", align: "right", render: (r: any) => `${Number(r.areaHa).toFixed(2)} ha` },
              { key: "cropType", header: "Cultivo" }, { key: "resp", header: "Responsable", render: (r: any) => r.responsible ? `${r.responsible.firstName} ${r.responsible.lastName}` : "—" },
              { key: "status", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
            ]}
            toEdit={(r: any) => ({ name: r.name, location: r.location, areaHa: r.areaHa, cropType: r.cropType, responsibleId: r.responsibleId ?? "", status: r.status })}
            fields={[
              { name: "name", label: "Nombre", required: true }, { name: "location", label: "Ubicación", required: true, full: true },
              { name: "areaHa", label: "Superficie (ha)", type: "number", required: true, min: 0.01, step: "any" }, { name: "cropType", label: "Tipo de cultivo", required: true },
              { name: "responsibleId", label: "Responsable", type: "select", options: workers },
              { name: "status", label: "Estado", type: "select", required: true, options: ["ACTIVA", "EN_DESCANSO", "EN_PREPARACION", "INACTIVA"].map((v) => ({ value: v, label: v })) },
            ]} />
        )}
        {tab === "actividades" && (
          <ServerTable path="/agriculture/activities" searchable={false} filters={[{ key: "type", label: "Tipo", options: ACT }]}
            columns={[
              { key: "date", header: "Fecha", render: (r: any) => date(r.date) }, { key: "campaign", header: "Campaña", render: (r: any) => r.campaign.code },
              { key: "type", header: "Tipo", render: (r: any) => <StatusBadge status={r.type} /> }, { key: "description", header: "Descripción" },
              { key: "responsible", header: "Responsable", hideOnMobile: true }, { key: "p", header: "Insumo", render: (r: any) => r.product ? `${r.product.name} (${r.quantity} ${r.product.unit})` : "—", hideOnMobile: true },
              { key: "cost", header: "Costo", align: "right", render: (r: any) => money(r.cost) },
            ]} />
        )}
        {tab === "cosechas" && (
          <ServerTable path="/agriculture/harvests" searchable={false} reloadKey={rk}
            columns={[
              { key: "code", header: "Cosecha", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "date", header: "Fecha", render: (r: any) => date(r.date) },
              { key: "campaign", header: "Campaña", render: (r: any) => r.campaign.code }, { key: "kg", header: "Cantidad", align: "right", render: (r: any) => kg(r.quantityKg) },
              { key: "lot", header: "Lote MP", render: (r: any) => r.lot?.code ?? "—" },
              { key: "sent", header: "Procesamiento", render: (r: any) => r.sentToProcessing ? <StatusBadge status="ENVIADA" label="Enviada" /> : (
                <Can perm="agri.write" fallback={<StatusBadge status="PENDIENTE" />}>
                  <Button size="sm" variant="outline" onClick={async (e) => { e.stopPropagation(); try { await api(`/agriculture/harvests/${r.id}/send-to-processing`, { method: "POST" }); toast.success("Enviado a procesamiento", r.lot?.code); setRk((k) => k + 1); } catch (er: any) { toast.error("Error", er.message); } }}><Send className="h-3.5 w-3.5" />Enviar</Button>
                </Can>) },
            ]} />
        )}
      </Card>
      <FormDialog open={newCamp} onClose={() => setNewCamp(false)} title="Nueva campaña agrícola" successMessage="Campaña creada"
        fields={[
          { name: "parcelId", label: "Parcela", type: "select", required: true, options: parcels }, { name: "variety", label: "Variedad de pimentón", required: true, placeholder: "Papri King" },
          { name: "sowingDate", label: "Fecha de siembra", type: "date", required: true }, { name: "estHarvestDate", label: "Fecha estimada de cosecha", type: "date", required: true },
          { name: "estimatedYieldKg", label: "Rendimiento estimado (kg)", type: "number", required: true, min: 1 }, { name: "notes", label: "Notas", type: "textarea" },
        ]}
        onSubmit={async (v, key) => { const c = await api("/agriculture/campaigns", { body: v, idempotencyKey: key }); setRk((k) => k + 1); router.push(`/agricultura/campanas/${c.id}`); }} />
    </div>
  );
}
