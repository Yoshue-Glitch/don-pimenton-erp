"use client";
import * as React from "react";
import { Users, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, date, isoDay, workerLabel } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Badge, Kpi, Notice, Empty } from "@/components/ui";
import { LocalTable } from "@/components/DataTable";
import { CrudSection, useOptions } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { Can, useAuth, useToast } from "@/components/providers";

type T = "trabajadores" | "asistencia" | "vacaciones" | "capacitaciones" | "evaluaciones" | "costos";
export default function RRHH() {
  const [tab, setTab] = React.useState<T>("trabajadores");
  const [dlg, setDlg] = React.useState<null | "att" | "leave" | "train" | "eval">(null);
  const [rk, setRk] = React.useState(0);
  const { can } = useAuth();
  const toast = useToast();
  const summary = useApi<any>("/hr/summary", [rk]);
  const att = useApi<any[]>("/hr/attendance", [rk]);
  const leaves = useApi<any[]>("/hr/leaves", [rk]);
  const trainings = useApi<any[]>("/hr/trainings", [rk]);
  const evals = useApi<any[]>("/hr/evaluations", [rk]);
  const costs = useApi<any>(can("hr.sensitive") ? "/hr/labor-costs" : null, [rk]);
  const areas = useOptions("/admin/areas", (a) => a.name);
  const workers = useOptions("/hr/workers?pageSize=200", (w) => workerLabel(w));
  const close = () => { setDlg(null); setRk((k) => k + 1); };
  const CT = ["INDEFINIDO", "PLAZO_FIJO", "TEMPORAL_COSECHA", "LOCACION_SERVICIOS"].map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase() }));
  return (
    <div className="space-y-4">
      <PageHeader area="Administración y Finanzas · RR.HH." title="Recursos humanos" subtitle="Trabajadores, contratos, asistencia, vacaciones, capacitaciones, evaluaciones y costos laborales" icon={<Users className="h-5 w-5" />} />
      {!can("hr.sensitive") && <Notice icon={<Lock className="mt-0.5 h-3.5 w-3.5" />}>Su rol no tiene acceso a datos personales ni remuneraciones: se muestran enmascarados.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Trabajadores activos" value={summary.data?.total ?? "—"} /><Kpi label="Temporales de cosecha" value={summary.data?.temporary ?? "—"} tone="gold" />
        <Kpi label="Solicitudes pendientes" value={summary.data?.pendingLeaves ?? "—"} tone="agro" /><Kpi label="Capacitaciones" value={summary.data?.trainings ?? "—"} tone="ink" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "trabajadores", label: "Trabajadores" }, { id: "asistencia", label: "Asistencia" }, { id: "vacaciones", label: "Vacaciones y permisos" }, { id: "capacitaciones", label: "Capacitaciones" }, { id: "evaluaciones", label: "Evaluaciones" }, ...(can("hr.sensitive") ? [{ id: "costos" as T, label: "Costos laborales" }] : [])]} />
      <Card>
        {tab === "trabajadores" && <CrudSection path="/hr/workers" title="trabajador" writePerm="hr.write" newLabel="Nuevo trabajador" canDelete={false}
          filters={[{ key: "isTemporary", label: "Tipo", options: [{ value: "false", label: "Permanentes" }, { value: "true", label: "Temporales" }] }]}
          columns={[{ key: "code", header: "Código" }, { key: "n", header: "Puesto", render: (r: any) => <span className="font-medium">{r.position}{r.firstName ? <span className="block text-xs font-normal text-muted">{r.firstName} {r.lastName}</span> : null}</span> }, { key: "doc", header: "DNI", render: (r: any) => r.documentNumber },
            { key: "a", header: "Área", render: (r: any) => r.area.name }, { key: "ct", header: "Contrato", render: (r: any) => <Badge tone={r.isTemporary ? "gold" : "slate"}>{r.contractType.replace(/_/g, " ").toLowerCase()}</Badge> },
            { key: "h", header: "Ingreso", render: (r: any) => date(r.hireDate) }, { key: "s", header: "Remuneración", align: "right", render: (r: any) => r._masked ? <span className="text-muted">•••</span> : money(r.monthlySalary) }]}
          toEdit={(r: any) => ({ ...r, hireDate: String(r.hireDate).slice(0, 10), phone: r.phone ?? "", email: r.email ?? "" })}
          fields={[{ name: "position", label: "Puesto / cargo", required: true }, { name: "firstName", label: "Nombres (opcional)", hint: "Los puestos pueden registrarse sin nombre de persona" }, { name: "lastName", label: "Apellidos (opcional)" }, { name: "documentNumber", label: "DNI", required: true, pattern: /^\d{8,12}$/, patternMsg: "Solo dígitos (8-12)" },
            { name: "areaId", label: "Área", type: "select", required: true, options: areas }, { name: "hireDate", label: "Fecha de ingreso", type: "date", required: true },
            { name: "contractType", label: "Contrato", type: "select", required: true, options: CT }, { name: "monthlySalary", label: "Remuneración mensual (S/)", type: "number", required: true, min: 0 },
            { name: "phone", label: "Teléfono" }, { name: "email", label: "Correo", type: "email" }, { name: "isTemporary", label: "Personal temporal de cosecha", type: "checkbox" }, { name: "active", label: "Activo", type: "checkbox" }]} />}
        {tab === "asistencia" && <LocalTable rows={att.data ?? []} searchKeys={["worker.position", "worker.code", "worker.firstName"]} toolbar={<Can perm="hr.write"><Button size="sm" onClick={() => setDlg("att")}>Registrar asistencia</Button></Can>} columns={[
          { key: "d", header: "Fecha", render: (r: any) => date(r.date) }, { key: "w", header: "Trabajador", render: (r: any) => workerLabel(r.worker) }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "h", header: "Horas", align: "right", render: (r: any) => Number(r.hours) }]} />}
        {tab === "vacaciones" && <LocalTable rows={leaves.data ?? []} toolbar={<Can perm="hr.write"><Button size="sm" onClick={() => setDlg("leave")}>Nueva solicitud</Button></Can>} columns={[
          { key: "w", header: "Trabajador", render: (r: any) => workerLabel(r.worker) }, { key: "type", header: "Tipo" }, { key: "f", header: "Desde", render: (r: any) => date(r.startDate) }, { key: "t", header: "Hasta", render: (r: any) => date(r.endDate) },
          { key: "days", header: "Días", align: "right" }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "a", header: "", align: "right", render: (r: any) => r.status === "PENDIENTE" ? <Can perm="hr.write"><div className="flex justify-end gap-1">{[true, false].map((ok) => <Button key={String(ok)} size="sm" variant={ok ? "secondary" : "outline"} onClick={async () => { await api(`/hr/leaves/${r.id}/decision`, { body: { approve: ok } }); toast.success(ok ? "Aprobado" : "Rechazado"); setRk((k) => k + 1); }}>{ok ? "Aprobar" : "Rechazar"}</Button>)}</div></Can> : null }]} />}
        {tab === "capacitaciones" && <LocalTable rows={trainings.data ?? []} toolbar={<Can perm="hr.write"><Button size="sm" onClick={() => setDlg("train")}>Nueva capacitación</Button></Can>} columns={[
          { key: "title", header: "Capacitación", render: (r: any) => <span className="font-medium">{r.title}</span> }, { key: "d", header: "Fecha", render: (r: any) => date(r.date) }, { key: "hours", header: "Horas", align: "right", render: (r: any) => Number(r.hours) },
          { key: "provider", header: "Proveedor" }, { key: "p", header: "Participantes", render: (r: any) => r.participants.map((p: any) => workerLabel(p.worker)).join(", ") }]} />}
        {tab === "evaluaciones" && <LocalTable rows={evals.data ?? []} toolbar={<Can perm="hr.write"><Button size="sm" onClick={() => setDlg("eval")}>Nueva evaluación</Button></Can>} columns={[
          { key: "w", header: "Trabajador", render: (r: any) => workerLabel(r.worker) }, { key: "pos", header: "Puesto", render: (r: any) => r.worker.position }, { key: "period", header: "Periodo" },
          { key: "score", header: "Puntaje (0-20)", align: "right", render: (r: any) => <b>{Number(r.score)}</b> }, { key: "evaluator", header: "Evaluador" }, { key: "comments", header: "Comentarios" }]} />}
        {tab === "costos" && (costs.data ? <div><LocalTable rows={costs.data.areas.map((a: any) => ({ ...a, id: a.area }))} columns={[{ key: "area", header: "Área" }, { key: "workers", header: "Trabajadores", align: "right" }, { key: "temporary", header: "Temporales", align: "right" }, { key: "c", header: "Costo mensual", align: "right", render: (r: any) => money(r.monthlyCost) }]} /><div className="p-4"><Notice>{costs.data.note}</Notice></div></div> : <Empty />)}
      </Card>
      <FormDialog open={dlg === "att"} onClose={close} title="Registrar asistencia" initial={{ date: isoDay(), status: "PRESENTE", hours: 8 }} fields={[{ name: "workerId", label: "Trabajador", type: "select", required: true, options: workers }, { name: "date", label: "Fecha", type: "date", required: true }, { name: "status", label: "Estado", type: "select", required: true, options: ["PRESENTE", "TARDANZA", "FALTA", "PERMISO", "VACACIONES"].map((v) => ({ value: v, label: v })) }, { name: "hours", label: "Horas", type: "number", min: 0, max: 16 }]} onSubmit={(v) => api("/hr/attendance", { body: v })} />
      <FormDialog open={dlg === "leave"} onClose={close} title="Solicitud de vacaciones / permiso" fields={[{ name: "workerId", label: "Trabajador", type: "select", required: true, options: workers }, { name: "type", label: "Tipo", type: "select", required: true, options: ["VACACIONES", "PERMISO", "LICENCIA"].map((v) => ({ value: v, label: v })) }, { name: "startDate", label: "Desde", type: "date", required: true }, { name: "endDate", label: "Hasta", type: "date", required: true }, { name: "notes", label: "Notas", type: "textarea" }]} onSubmit={(v) => api("/hr/leaves", { body: v })} />
      <FormDialog open={dlg === "train"} onClose={close} title="Nueva capacitación" fields={[{ name: "title", label: "Título", required: true, full: true }, { name: "date", label: "Fecha", type: "date", required: true }, { name: "hours", label: "Horas", type: "number", required: true, min: 0.5, step: "any" }, { name: "provider", label: "Proveedor" }, { name: "topic", label: "Tema" }]} onSubmit={(v) => api("/hr/trainings", { body: v })} />
      <FormDialog open={dlg === "eval"} onClose={close} title="Nueva evaluación" fields={[{ name: "workerId", label: "Trabajador", type: "select", required: true, options: workers }, { name: "period", label: "Periodo", required: true, placeholder: "2026-S2" }, { name: "score", label: "Puntaje (0-20)", type: "number", required: true, min: 0, max: 20, step: "any" }, { name: "evaluator", label: "Evaluador", required: true }, { name: "comments", label: "Comentarios", type: "textarea" }]} onSubmit={(v) => api("/hr/evaluations", { body: v })} />
    </div>
  );
}
