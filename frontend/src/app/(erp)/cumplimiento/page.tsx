"use client";
import * as React from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { date } from "@/lib/utils";
import { Card, CardHeader, PageHeader, StatusBadge, Button, Notice, Loading, Kpi } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can } from "@/components/providers";

/** Cumplimiento FDA y SUNAT (TI-10 módulo 8, regla R7). */
export default function Cumplimiento() {
  const { data, loading, reload } = useApi<any>("/trade/compliance");
  const [edit, setEdit] = React.useState<any>(null);
  if (loading && !data) return <Loading />;
  const items = data.items as any[];
  const c = (s: string) => items.filter((i) => i.computedStatus === s).length;
  return (
    <div className="space-y-4">
      <PageHeader area="Comercio exterior · R7" title="Cumplimiento FDA y SUNAT" subtitle="Registro FDA (FFR), FSMA/PCQI, FSVP, DIGESA, BPA, BPM, SUNAT, etiquetado EE. UU. Un registro obligatorio vencido bloquea pedidos, confirmaciones y despachos." icon={<ShieldCheck className="h-5 w-5" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi tone="green" label="Cumplidos" value={c("CUMPLIDO")} /><Kpi tone="amber" label="Por vencer" value={c("POR_VENCER")} /><Kpi tone="red" label="Vencidos" value={c("VENCIDO")} /><Kpi tone="blue" label="Requieren validación" value={c("REQUIERE_VALIDACION")} /><Kpi tone="ink" label="Pendientes" value={c("PENDIENTE")} />
      </div>
      {data.blockers.length > 0 ? <Notice tone="red" icon={<AlertTriangle className="h-4 w-4" />}>R7 activo — operaciones bloqueadas: {data.blockers.map((b: any) => `${b.name} (${b.reason})`).join("; ")}</Notice> : <Notice tone="green">Sin bloqueos R7: los registros obligatorios están vigentes.</Notice>}
      <Card>
        <CardHeader title="Registros de la empresa" subtitle={data.note} />
        <Table rows={items} columns={[
          { key: "code", header: "Código" }, { key: "name", header: "Registro / requisito" }, { key: "a", header: "Autoridad", render: (r: any) => r.authority },
          { key: "v", header: "Vigencia", render: (r: any) => r.validUntil ? <span>{date(r.validUntil)} <span className="text-xs text-muted">({r.daysLeft} días)</span></span> : "Sin vencimiento" },
          { key: "e", header: "Evidencia", render: (r: any) => r.evidence ?? <span className="text-paprika">Sin evidencia</span> }, { key: "r", header: "Responsable", render: (r: any) => r.responsible },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.computedStatus} /> },
          { key: "x", header: "", render: (r: any) => <Can perm="compliance.write"><Button size="sm" variant="outline" onClick={() => setEdit(r)}>Actualizar</Button></Can> },
        ]} />
      </Card>
      {items.find((i) => i.notes) && <Notice tone="blue">{items.filter((i) => i.notes).map((i) => <p key={i.id}><b>{i.code}:</b> {i.notes}</p>)}</Notice>}
      <FormDialog open={!!edit} onClose={() => setEdit(null)} title={`Actualizar ${edit?.code ?? ""}`} subtitle="Pruebe P6: ponga una fecha de vigencia pasada al registro DIGESA y cree un pedido" successMessage="Registro actualizado"
        initial={{ status: edit?.status, validUntil: edit?.validUntil?.slice(0, 10) ?? "", evidence: edit?.evidence ?? "" }}
        fields={[{ name: "status", label: "Estado", type: "select", options: ["CUMPLIDO", "PENDIENTE", "POR_VENCER", "VENCIDO", "NO_APLICABLE", "REQUIERE_VALIDACION"].map((v) => ({ value: v, label: v })) }, { name: "validUntil", label: "Vigente hasta", type: "date" }, { name: "evidence", label: "Evidencia documental", hint: "Obligatoria para declarar CUMPLIDO", full: true }]}
        onSubmit={async (v) => { await api(`/trade/compliance/${edit.id}`, { method: "PUT", body: { ...v, validUntil: v.validUntil || null, evidence: v.evidence || null } }); reload(); }} />
    </div>
  );
}
