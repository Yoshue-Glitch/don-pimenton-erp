"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { kg, money, date } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Notice, Badge } from "@/components/ui";
import { ServerTable } from "@/components/DataTable";
import { CrudSection, useOptions } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { ModuleKpis } from "@/components/ModuleKpis";
import { Can } from "@/components/providers";

const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];
export default function Exportaciones() {
  const [tab, setTab] = React.useState<"ordenes" | "socios" | "clientes">("ordenes");
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const customers = useOptions("/sales/customers?type=INTERNACIONAL&pageSize=100", (c) => `${c.name} (${c.country})`);
  const partners = useOptions("/exports/partners?pageSize=100", (p) => p.name);
  const products = useOptions("/inventory/products?type=PRODUCTO_TERMINADO", (p) => p.name);
  const lots = useOptions("/inventory/lots?type=PRODUCTO_TERMINADO&qualityStatus=APROBADO&pageSize=100", (l) => l.code);
  return (
    <div className="space-y-4">
      <PageHeader area="Departamento de Exportaciones" title="Exportaciones" subtitle="Módulo preparado para operaciones internacionales: indirecta (vía socio exportador) y directa" icon={<Globe2 className="h-5 w-5" />}
        actions={<Can perm="exports.write"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nueva orden internacional</Button></Can>} />
      <ModuleKpis module="exportaciones" />
      <Notice>El sistema no genera certificados oficiales ni marca requisitos legales como cumplidos sin evidencia documental adjunta y verificada. La aplicabilidad de cada documento depende del destino y debe validarse con el agente de aduanas o el socio exportador.</Notice>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "ordenes", label: "Órdenes internacionales" }, { id: "socios", label: "Socios exportadores" }, { id: "clientes", label: "Clientes internacionales" }]} />
      <Card>
        {tab === "ordenes" && <ServerTable path="/exports/orders" searchable={false} onRowClick={(r: any) => router.push(`/exportaciones/${r.id}`)} columns={[
          { key: "code", header: "Orden", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "c", header: "Cliente", render: (r: any) => r.customer.name },
          { key: "dest", header: "Destino", render: (r: any) => r.destinationCountry }, { key: "m", header: "Modalidad", render: (r: any) => <Badge tone={r.mode === "DIRECTA" ? "blue" : "gold"}>{r.mode}</Badge> },
          { key: "p", header: "Socio", render: (r: any) => r.partner?.name ?? "—", hideOnMobile: true }, { key: "inc", header: "Incoterm", render: (r: any) => `${r.incoterm} · ${r.incotermVersion}` },
          { key: "w", header: "Neto / bruto", align: "right", render: (r: any) => `${kg(r.netWeightKg)} / ${kg(r.grossWeightKg)}` }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) },
          { key: "req", header: "Documentos", render: (r: any) => { const ok = r.requirements.filter((x: any) => ["VERIFICADO", "NO_APLICA"].includes(x.status)).length; return <Badge tone={ok === r.requirements.length ? "green" : "amber"}>{ok}/{r.requirements.length} verificados</Badge>; } },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />}
        {tab === "socios" && <CrudSection path="/exports/partners" title="socio" writePerm="exports.write" newLabel="Nuevo socio" canDelete={false}
          columns={[{ key: "name", header: "Nombre" }, { key: "ruc", header: "RUC" }, { key: "country", header: "País" }, { key: "services", header: "Servicios" }, { key: "contact", header: "Contacto" }]}
          toEdit={(r: any) => ({ name: r.name, ruc: r.ruc ?? "", country: r.country, services: r.services, contact: r.contact ?? "", email: r.email ?? "" })}
          fields={[{ name: "name", label: "Nombre", required: true }, { name: "ruc", label: "RUC" }, { name: "country", label: "País", required: true }, { name: "contact", label: "Contacto" }, { name: "email", label: "Correo", type: "email" }, { name: "services", label: "Servicios", required: true, full: true }]} />}
        {tab === "clientes" && <ServerTable path="/sales/customers?type=INTERNACIONAL" columns={[{ key: "code", header: "Código" }, { key: "name", header: "Cliente" }, { key: "doc", header: "Tax ID", render: (r: any) => r.documentNumber }, { key: "country", header: "País" }, { key: "city", header: "Ciudad" }, { key: "credit", header: "Crédito", render: (r: any) => `${r.creditDays} días` }]} />}
      </Card>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Nueva orden internacional" size="lg" successMessage="Orden internacional creada con su lista de requisitos documentales" initial={{ mode: "INDIRECTA", currency: "USD", incoterm: "FOB", incotermVersion: "Incoterms® 2020", exchangeRate: 3.5 }}
        fields={[
          { name: "customerId", label: "Cliente internacional", type: "select", required: true, options: customers }, { name: "mode", label: "Modalidad", type: "select", required: true, options: [{ value: "INDIRECTA", label: "Indirecta (vía socio exportador)" }, { value: "DIRECTA", label: "Directa" }] },
          { name: "partnerId", label: "Socio exportador", type: "select", options: partners, show: (v) => v.mode === "INDIRECTA", required: true }, { name: "destinationCountry", label: "País de destino", required: true },
          { name: "incoterm", label: "Incoterm", type: "select", required: true, options: INCOTERMS.map((v) => ({ value: v, label: v })) }, { name: "incotermVersion", label: "Versión aplicable", required: true },
          { name: "currency", label: "Moneda", type: "select", options: ["USD", "EUR", "PEN"].map((v) => ({ value: v, label: v })) }, { name: "exchangeRate", label: "Tipo de cambio (PEN por unidad)", type: "number", required: true, min: 0.0001, step: "any" },
          { name: "productId", label: "Producto", type: "select", required: true, options: products }, { name: "lotId", label: "Lote aprobado (opcional)", type: "select", options: lots },
          { name: "netWeightKg", label: "Peso neto (kg)", type: "number", required: true, min: 1, step: "any" }, { name: "grossWeightKg", label: "Peso bruto (kg)", type: "number", required: true, min: 1, step: "any" },
          { name: "amount", label: "Importe", type: "number", required: true, min: 0.01, step: "any" }, { name: "logisticsCost", label: "Costos logísticos estimados", type: "number", min: 0, step: "any" },
          { name: "etd", label: "ETD", type: "date" }, { name: "eta", label: "ETA", type: "date" }, { name: "notes", label: "Notas", type: "textarea" },
        ]}
        onSubmit={async (v, key) => { const o = await api("/exports/orders", { body: v, idempotencyKey: key }); router.push(`/exportaciones/${o.id}`); }} />
    </div>
  );
}
