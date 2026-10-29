"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Factory, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, date, num, money } from "@/lib/utils";
import { Card, CardHeader, PageHeader, StatusBadge, Button, Empty } from "@/components/ui";
import { ServerTable, Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { ModuleKpis } from "@/components/ModuleKpis";
import { Can } from "@/components/providers";

export default function Produccion() {
  const router = useRouter();
  const pending = useApi<any[]>("/production/pending-lots");
  const [open, setOpen] = React.useState<any>(null);
  return (
    <div className="space-y-4">
      <PageHeader area="Procesamiento y Calidad" title="Producción" subtitle="Recepción → Selección → Lavado → Deshidratación → Molienda → Control → Envasado → Almacén" icon={<Factory className="h-5 w-5" />} />
      <ModuleKpis module="produccion" />
      <Card>
        <CardHeader title="Materia prima pendiente de procesar" subtitle="Lotes enviados desde el módulo agrícola con saldo por procesar" />
        <Table rows={pending.data ?? []} empty={<Empty title="Sin materia prima pendiente" />} columns={[
          { key: "code", header: "Lote MP", render: (r: any) => <Link href={`/inventario/lotes/${r.code}`} className="font-semibold text-paprika hover:underline">{r.code}</Link> },
          { key: "c", header: "Campaña", render: (r: any) => `${r.campaign?.code ?? "—"} · ${r.campaign?.variety ?? ""}` },
          { key: "h", header: "Cosecha", render: (r: any) => `${r.harvest?.code ?? "—"} (${date(r.harvest?.date)})` },
          { key: "rem", header: "Saldo por procesar", align: "right", render: (r: any) => kg(r.remainingKg) },
          { key: "sent", header: "Estado", render: (r: any) => r.harvest?.sentToProcessing ? <StatusBadge status="ENVIADA" label="Recibido en planta" /> : <StatusBadge status="PENDIENTE" label="No enviado" /> },
          { key: "a", header: "", align: "right", render: (r: any) => <Can perm="production.write"><Button size="sm" disabled={!r.harvest?.sentToProcessing} onClick={() => setOpen(r)}><Plus className="h-3.5 w-3.5" />Orden de producción</Button></Can> },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Órdenes de producción" />
        <ServerTable path="/production/orders" onRowClick={(r: any) => router.push(`/produccion/${r.id}`)} reloadKey={pending.data}
          filters={[{ key: "status", label: "Estado", options: ["EN_PROCESO", "COMPLETADA", "ANULADA"].map((v) => ({ value: v, label: v })) }]}
          columns={[
            { key: "code", header: "Orden", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "lot", header: "Lote origen", render: (r: any) => r.sourceLot.code },
            { key: "start", header: "Inicio", render: (r: any) => date(r.startDate) }, { key: "resp", header: "Responsable", render: (r: any) => r.responsible.name, hideOnMobile: true },
            { key: "i", header: "Inicial", align: "right", render: (r: any) => kg(r.initialWeightKg) }, { key: "f", header: "Final", align: "right", render: (r: any) => r.finalWeightKg ? kg(r.finalWeightKg) : "—" },
            { key: "y", header: "Rend.", align: "right", render: (r: any) => r.yieldPct ? `${num(r.yieldPct, 2)} %` : "—" }, { key: "cost", header: "Costo", align: "right", render: (r: any) => Number(r.totalCost) ? money(r.totalCost) : "—", hideOnMobile: true },
            { key: "out", header: "Lotes terminados", render: (r: any) => r.outputLots.map((l: any) => l.code).join(", ") || "—" },
            { key: "st", header: "Estado", render: (r: any) => <div className="flex flex-col gap-0.5"><StatusBadge status={r.status} />{r.status === "EN_PROCESO" && <span className="text-[10px] text-muted">{r.currentStage.replace(/_/g, " ").toLowerCase()}</span>}</div> },
          ]} />
      </Card>
      <FormDialog open={!!open} onClose={() => setOpen(null)} title={`Nueva orden de producción — ${open?.code ?? ""}`} subtitle="La materia prima se descuenta del almacén ALM-MP al recepcionarse en planta"
        initial={{ initialWeightKg: open ? Number(open.remainingKg) : "" }} successMessage="Orden creada"
        fields={[{ name: "initialWeightKg", label: "Peso inicial a procesar (kg)", type: "number", required: true, min: 0.1, max: open ? Number(open.remainingKg) : undefined, step: "any" }, { name: "observations", label: "Observaciones", type: "textarea" }]}
        onSubmit={async (v, key) => { const o = await api("/production/orders", { body: { ...v, sourceLotId: open.id }, idempotencyKey: key }); router.push(`/produccion/${o.id}`); }} />
    </div>
  );
}
