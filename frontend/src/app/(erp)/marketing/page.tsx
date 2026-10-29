"use client";
import * as React from "react";
import { Megaphone, Users, Banknote, TrendingUp } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useApi } from "@/lib/hooks";
import { money, num, date } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, Kpi, StatusBadge, Badge } from "@/components/ui";
import { CrudSection } from "@/components/Crud";

const CHANNELS = ["Instagram", "Facebook", "LinkedIn", "Email", "Web", "Feria"];
const STATES = [{ value: "PLANIFICADA", label: "Planificada" }, { value: "ACTIVA", label: "Activa" }, { value: "FINALIZADA", label: "Finalizada" }];

export default function Marketing() {
  const [rk] = React.useState(0);
  const { data: s } = useApi<any>("/marketing/summary", [rk]);
  return (
    <div className="space-y-[18px]">
      <PageHeader area="Departamento de Exportaciones" title="Marketing digital y marca" subtitle="Campañas, canales, inversión y prospectos generados." />
      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="red" icon={<Megaphone />} label="Inversión" value={s ? money(s.investment) : "—"} hint="Campañas ejecutadas" />
        <Kpi tone="green" icon={<Users />} label="Leads generados" value={s ? num(s.leads) : "—"} hint="Prospectos de clientes" />
        <Kpi tone="blue" icon={<Banknote />} label="Costo por lead" value={s?.costPerLead != null ? money(s.costPerLead) : "—"} hint="Promedio" />
        <Kpi tone="amber" icon={<TrendingUp />} label="Campañas activas" value={s?.active ?? "—"} hint={`${s?.planned ?? 0} planificadas`} />
      </div>
      <div className="grid gap-[18px] xl:grid-cols-[2fr_1fr]">
        <Card>
          <CrudSection path="/marketing/campaigns" title="campaña" writePerm="marketing.write" newLabel="Nueva campaña"
            filters={[{ key: "status", label: "Estado", options: STATES }, { key: "channel", label: "Canal", options: CHANNELS.map((c) => ({ value: c, label: c })) }]}
            columns={[
              { key: "code", header: "Código" }, { key: "name", header: "Campaña", render: (r: any) => <span className="font-medium">{r.name}</span> },
              { key: "channel", header: "Canal", render: (r: any) => <Badge tone="slate">{r.channel}</Badge> }, { key: "d", header: "Inicio", render: (r: any) => date(r.startDate) },
              { key: "b", header: "Presupuesto", align: "right", render: (r: any) => money(r.budgetPen) }, { key: "leads", header: "Leads", align: "right" },
              { key: "cpl", header: "Costo por lead", align: "right", render: (r: any) => (r.leads ? money(Number(r.budgetPen) / r.leads) : "—") },
              { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
            ]}
            toEdit={(r: any) => ({ name: r.name, channel: r.channel, startDate: String(r.startDate).slice(0, 10), budgetPen: r.budgetPen, leads: r.leads, status: r.status, notes: r.notes ?? "" })}
            fields={[
              { name: "name", label: "Campaña", required: true, full: true }, { name: "channel", label: "Canal", type: "select", required: true, options: CHANNELS.map((c) => ({ value: c, label: c })) },
              { name: "startDate", label: "Inicio", type: "date", required: true }, { name: "budgetPen", label: "Presupuesto (S/)", type: "number", required: true, min: 0, step: "any" },
              { name: "leads", label: "Prospectos (leads)", type: "number", min: 0 }, { name: "status", label: "Estado", type: "select", required: true, options: STATES },
              { name: "notes", label: "Notas", type: "textarea" },
            ]} />
        </Card>
        <Card>
          <CardHeader title="Leads por canal" subtitle={`${num(s?.leads ?? 0)} prospectos`} />
          <CardBody className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={s?.byChannel ?? []} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickLine={false} axisLine={false} /><YAxis type="category" dataKey="channel" width={70} tickLine={false} axisLine={false} />
                <Tooltip /><Bar dataKey="leads" name="Leads" fill="#2F6B45" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>
      <p className="text-[11px] text-muted">Campañas de demostración; los importes son referenciales.</p>
    </div>
  );
}
