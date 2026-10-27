"use client";
import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Truck, Plus, ChevronRight, Undo2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, dateTime } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Notice, Badge, Field, Input } from "@/components/ui";
import { ServerTable } from "@/components/DataTable";
import { CrudSection, useOptions } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { Can } from "@/components/providers";

const NEXT: Record<string, string> = { PREPARACION: "DESPACHADO", DESPACHADO: "EN_TRANSITO", EN_TRANSITO: "ENTREGADO", ENTREGADO: "CONFORME" };
const LBL: Record<string, string> = { DESPACHADO: "Despachar", EN_TRANSITO: "En tránsito", ENTREGADO: "Registrar entrega", CONFORME: "Registrar conformidad" };

function LogisticaInner() {
  const sp = useSearchParams();
  const [tab, setTab] = React.useState<"despachos" | "transportistas" | "vehiculos">("despachos");
  const [create, setCreate] = React.useState<string | null>(sp.get("nuevo"));
  const [adv, setAdv] = React.useState<any>(null);
  const [ret, setRet] = React.useState<any>(null);
  const [rk, setRk] = React.useState(0);
  const fileRef = React.useRef<File | null>(null);
  const orders = useOptions("/sales/orders?status=RESERVADO&pageSize=100", (o) => `${o.code} — ${o.customer.name} (${Number(o.totalKg)} kg)`);
  const carriers = useOptions("/logistics/carriers?pageSize=100", (c) => c.name);
  const vehicles = useApi<any>("/logistics/vehicles?pageSize=100");
  const { data: settings } = useApi<any>("/admin/settings");
  const lots = useOptions(ret ? "/inventory/lots?type=PRODUCTO_TERMINADO&pageSize=200" : null, (l) => l.code);
  return (
    <div className="space-y-4">
      <PageHeader title="Logística" subtitle="Preparación → Despachado → En tránsito → Entregado → Conforme" icon={<Truck className="h-5 w-5" />}
        actions={<Can perm="logistics.write"><Button onClick={() => setCreate("")}><Plus className="h-4 w-4" />Nueva orden de despacho</Button></Can>} />
      <Notice tone="blue">Política de salida configurada: <b>{settings?.["inventory.dispatchPolicy"] === "ON_DELIVERY" ? "descontar inventario al ENTREGAR" : "descontar inventario al DESPACHAR"}</b>. El sistema descuenta cada despacho una sola vez y bloquea lotes rechazados o en cuarentena.</Notice>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "despachos", label: "Órdenes de despacho" }, { id: "transportistas", label: "Transportistas" }, { id: "vehiculos", label: "Vehículos" }]} />
      <Card>
        {tab === "despachos" && <ServerTable path="/logistics/dispatches" searchable={false} reloadKey={rk} filters={[{ key: "status", label: "Estado", options: Object.keys(LBL).concat("PREPARACION").map((v) => ({ value: v, label: v })) }]} columns={[
          { key: "code", header: "Despacho", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "o", header: "Pedido", render: (r: any) => `${r.salesOrder.code} · ${r.salesOrder.customer.name}` },
          { key: "t", header: "Transporte", render: (r: any) => `${r.carrier.name} · ${r.vehicle.plate}`, hideOnMobile: true }, { key: "w", header: "Peso", align: "right", render: (r: any) => kg(r.weightKg) },
          { key: "dest", header: "Destino", hideOnMobile: true, render: (r: any) => r.destination }, { key: "dep", header: "Salida", render: (r: any) => dateTime(r.departureAt) }, { key: "del", header: "Entrega", render: (r: any) => dateTime(r.deliveredAt) },
          { key: "rb", header: "Recibió", render: (r: any) => r.receivedBy ?? "—", hideOnMobile: true }, { key: "ev", header: "Evidencia", render: (r: any) => r.evidenceDoc?.code ?? "—", hideOnMobile: true },
          { key: "inv", header: "Inventario", render: (r: any) => r.inventoryPosted ? <Badge tone="green">Descontado</Badge> : <Badge>Pendiente</Badge> },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "a", header: "", align: "right", render: (r: any) => <Can perm="logistics.write"><div className="flex justify-end gap-1">
            {NEXT[r.status] && <Button size="sm" onClick={() => setAdv(r)}>{LBL[NEXT[r.status]]}<ChevronRight className="h-3.5 w-3.5" /></Button>}
            {r.inventoryPosted && <Button size="sm" variant="ghost" title="Registrar devolución" onClick={() => setRet(r)}><Undo2 className="h-4 w-4" /></Button>}
          </div></Can> },
        ]} />}
        {tab === "transportistas" && <CrudSection path="/logistics/carriers" title="transportista" writePerm="logistics.write" newLabel="Nuevo transportista" canDelete={false}
          columns={[{ key: "ruc", header: "RUC" }, { key: "name", header: "Razón social" }, { key: "phone", header: "Teléfono" }, { key: "v", header: "Vehículos", render: (r: any) => r.vehicles.map((v: any) => v.plate).join(", ") }]}
          fields={[{ name: "ruc", label: "RUC", required: true, pattern: /^(10|20)\d{9}$/, patternMsg: "RUC de 11 dígitos" }, { name: "name", label: "Razón social", required: true }, { name: "phone", label: "Teléfono" }]} />}
        {tab === "vehiculos" && <CrudSection path="/logistics/vehicles" title="vehículo" writePerm="logistics.write" newLabel="Nuevo vehículo"
          columns={[{ key: "plate", header: "Placa" }, { key: "type", header: "Tipo" }, { key: "c", header: "Transportista", render: (r: any) => r.carrier.name }, { key: "cap", header: "Capacidad", align: "right", render: (r: any) => kg(r.capacityKg) }]}
          fields={[{ name: "plate", label: "Placa", required: true }, { name: "type", label: "Tipo", required: true }, { name: "carrierId", label: "Transportista", type: "select", required: true, options: carriers }, { name: "capacityKg", label: "Capacidad (kg)", type: "number", required: true, min: 1 }]} />}
      </Card>
      <FormDialog open={create !== null} onClose={() => { setCreate(null); setRk((k) => k + 1); }} title="Nueva orden de despacho" initial={{ salesOrderId: create ? Number(create) : "" }} successMessage="Orden de despacho creada"
        fields={[{ name: "salesOrderId", label: "Pedido reservado", type: "select", required: true, options: orders, full: true }, { name: "carrierId", label: "Transportista", type: "select", required: true, options: carriers },
          { name: "vehicleId", label: "Vehículo", type: "select", required: true, options: (vehicles.data?.items ?? []).map((v: any) => ({ value: v.id, label: `${v.plate} · ${v.type} (${v.carrier.name})` })) },
          { name: "destination", label: "Destino", required: true, full: true }, { name: "notes", label: "Notas", type: "textarea" }]}
        onSubmit={(v, key) => api("/logistics/dispatches", { body: v, idempotencyKey: key })} />
      <FormDialog open={!!adv} onClose={() => { setAdv(null); fileRef.current = null; setRk((k) => k + 1); }} title={adv ? `${LBL[NEXT[adv.status]]} — ${adv.code}` : ""} successMessage="Estado actualizado"
        fields={adv && NEXT[adv.status] === "ENTREGADO" ? [{ name: "receivedBy", label: "Responsable de recepción", required: true }, { name: "notes", label: "Notas", type: "textarea" }] : [{ name: "notes", label: "Notas", type: "textarea" }]}
        onSubmit={async (v) => {
          let evidenceDocId: number | undefined;
          if (NEXT[adv.status] === "CONFORME") {
            if (!fileRef.current) throw new Error("Adjunte la evidencia de conformidad (acta / guía firmada)");
            const fd = new FormData(); fd.append("file", fileRef.current); fd.append("title", `Evidencia de conformidad ${adv.code}`); fd.append("type", "EVIDENCIA_ENTREGA"); fd.append("entityType", "dispatch"); fd.append("entityId", adv.code);
            evidenceDocId = (await api("/documents", { form: fd })).id;
          }
          await api(`/logistics/dispatches/${adv.id}/advance`, { body: { ...v, status: NEXT[adv.status], evidenceDocId } });
        }}>
        {() => adv && NEXT[adv.status] === "CONFORME" ? <Field label="Evidencia de conformidad (PDF / imagen / texto)" required><Input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; }} /></Field> : null}
      </FormDialog>
      <FormDialog open={!!ret} onClose={() => { setRet(null); setRk((k) => k + 1); }} title={`Devolución — ${ret?.code ?? ""}`} subtitle="El producto devuelto ingresa a cuarentena para reevaluación de Calidad" successMessage="Devolución registrada"
        fields={[{ name: "lotId", label: "Lote", type: "select", required: true, options: lots }, { name: "quantityKg", label: "Cantidad (kg)", type: "number", required: true, min: 0.1, step: "any" }, { name: "reason", label: "Motivo", required: true, full: true }]}
        onSubmit={(v) => api(`/logistics/dispatches/${ret.id}/return`, { body: v })} />
    </div>
  );
}

export default function Logistica() {
  return <Suspense fallback={null}><LogisticaInner /></Suspense>;
}
