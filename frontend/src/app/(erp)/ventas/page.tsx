"use client";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeDollarSign, Plus, HandCoins } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, money, date } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Badge } from "@/components/ui";
import { ServerTable, LocalTable } from "@/components/DataTable";
import { CrudSection } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { ModuleKpis } from "@/components/ModuleKpis";
import { Can } from "@/components/providers";
import { OrderDialog } from "./OrderDialog";

type T = "pedidos" | "cotizaciones" | "clientes" | "cxc";
function VentasInner() {
  const sp = useSearchParams();
  const [tab, setTab] = React.useState<T>((sp.get("tab") as T) || "pedidos");
  const [dlg, setDlg] = React.useState<null | "order" | "quote">(null);
  const [collect, setCollect] = React.useState<any>(null);
  const [rk, setRk] = React.useState(0);
  const router = useRouter();
  const ar = useApi<any[]>("/sales/receivables", [rk]);
  return (
    <div className="space-y-4">
      <PageHeader area="Comercial" title="Ventas nacionales y clientes" subtitle="Clientes mayoristas, cotizaciones, pedidos con reserva de inventario, comprobantes internos y cobros" icon={<BadgeDollarSign className="h-5 w-5" />}
        actions={<Can perm="sales.write"><Button variant="outline" onClick={() => setDlg("quote")}>Nueva cotización</Button><Button onClick={() => setDlg("order")}><Plus className="h-4 w-4" />Nuevo pedido</Button></Can>} />
      <ModuleKpis module="ventas" reloadKey={rk} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pedidos", label: "Pedidos" }, { id: "cotizaciones", label: "Cotizaciones" }, { id: "clientes", label: "Clientes" }, { id: "cxc", label: "Cuentas por cobrar", count: (ar.data ?? []).filter((r) => r.status !== "COBRADO").length }]} />
      <Card>
        {tab === "pedidos" && <ServerTable path="/sales/orders" reloadKey={rk} onRowClick={(r: any) => router.push(`/ventas/pedidos/${r.id}`)}
          filters={[{ key: "status", label: "Estado", options: ["REGISTRADO", "RESERVADO", "DESPACHADO", "ENTREGADO", "COMPLETADO", "ANULADO"].map((v) => ({ value: v, label: v })) }]}
          columns={[
            { key: "code", header: "Pedido", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "date", header: "Fecha", render: (r: any) => date(r.date) },
            { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "i", header: "Detalle", render: (r: any) => r.items.map((i: any) => `${Number(i.quantity)} ${i.unit === "SACO" ? "sc" : "kg"} ${i.lot?.code ?? ""}`).join(", "), hideOnMobile: true },
            { key: "kg", header: "kg", align: "right", render: (r: any) => kg(r.totalKg) }, { key: "t", header: "Total", align: "right", render: (r: any) => <b>{money(r.total, r.currency)}</b> },
            { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "p", header: "Cobro", render: (r: any) => <StatusBadge status={r.paymentStatus} /> },
            { key: "sc", header: "Smart contract", render: (r: any) => r.agreements[0] ? <Badge tone="paprika">{r.agreements[0].status}</Badge> : "—", hideOnMobile: true },
          ]} />}
        {tab === "cotizaciones" && <ServerTable path="/sales/quotes" reloadKey={rk} searchable={false} columns={[
          { key: "code", header: "Cotización", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "d", header: "Fecha", render: (r: any) => date(r.date) },
          { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "v", header: "Vigencia", render: (r: any) => date(r.validUntil) },
          { key: "t", header: "Total", align: "right", render: (r: any) => money(r.total, r.currency) }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "a", header: "", align: "right", render: (r: any) => r.status === "ENVIADA" ? <Can perm="sales.write"><div className="flex justify-end gap-1">{["ACEPTADA", "RECHAZADA"].map((s) => <Button key={s} size="sm" variant="outline" onClick={async () => { await api(`/sales/quotes/${r.id}/status`, { body: { status: s } }); setRk((k) => k + 1); }}>{s === "ACEPTADA" ? "Aceptada" : "Rechazada"}</Button>)}</div></Can> : null },
        ]} />}
        {tab === "clientes" && <CrudSection path="/sales/customers" title="cliente" writePerm="sales.write" newLabel="Nuevo cliente" canDelete={false}
          filters={[{ key: "type", label: "Tipo", options: [{ value: "NACIONAL", label: "Nacional" }, { value: "INTERNACIONAL", label: "Internacional" }] }]}
          columns={[{ key: "code", header: "Código" }, { key: "name", header: "Razón social", render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: "doc", header: "Documento", render: (r: any) => `${r.documentType} ${r.documentNumber}` },
            { key: "type", header: "Tipo", render: (r: any) => <Badge tone={r.type === "NACIONAL" ? "green" : "blue"}>{r.type}</Badge> }, { key: "city", header: "Ciudad", render: (r: any) => `${r.city ?? "—"}, ${r.country}` },
            { key: "credit", header: "Crédito", align: "right", render: (r: any) => `${r.creditDays} días` }, { key: "bc", header: "Identidad blockchain", render: (r: any) => r.chainActor ? <Badge tone="paprika">{r.chainActor} (demo)</Badge> : "—", hideOnMobile: true }]}
          toEdit={(r: any) => ({ ...r, email: r.email ?? "", contact: r.contact ?? "", phone: r.phone ?? "", address: r.address ?? "", city: r.city ?? "" })}
          fields={[{ name: "type", label: "Tipo", type: "select", required: true, options: [{ value: "NACIONAL", label: "Nacional" }, { value: "INTERNACIONAL", label: "Internacional" }] },
            { name: "documentType", label: "Tipo de documento", type: "select", required: true, options: ["RUC", "DNI", "TAX_ID"].map((v) => ({ value: v, label: v })) },
            { name: "documentNumber", label: "Número de documento", required: true }, { name: "name", label: "Razón social", required: true }, { name: "contact", label: "Contacto" }, { name: "email", label: "Correo", type: "email" },
            { name: "phone", label: "Teléfono" }, { name: "city", label: "Ciudad" }, { name: "country", label: "País" }, { name: "creditDays", label: "Días de crédito", type: "number", min: 0, max: 180 }, { name: "address", label: "Dirección", full: true }]} />}
        {tab === "cxc" && <LocalTable rows={ar.data ?? []} searchKeys={["code", "customer.name", "documentRef"]} columns={[
          { key: "code", header: "CxC" }, { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "doc", header: "Documento", render: (r: any) => r.documentRef },
          { key: "o", header: "Origen", render: (r: any) => r.salesOrder?.code ?? r.exportOrder?.code ?? "—" }, { key: "due", header: "Vence", render: (r: any) => <span className={new Date(r.dueDate) < new Date() && r.status !== "COBRADO" ? "font-semibold text-red-600" : ""}>{date(r.dueDate)}</span> },
          { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "col", header: "Cobrado", align: "right", render: (r: any) => money(r.collected, r.currency) },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "x", header: "", align: "right", render: (r: any) => r.status !== "COBRADO" ? <Can perm="sales.write"><Button size="sm" variant="secondary" onClick={() => setCollect(r)}><HandCoins className="h-3.5 w-3.5" />Registrar cobro</Button></Can> : null },
        ]} />}
      </Card>
      <OrderDialog open={!!dlg} mode={dlg ?? "order"} onClose={(r) => { setDlg(null); setRk((k) => k + 1); if (r && dlg === "order") router.push(`/ventas/pedidos/${r.id}`); }} />
      <FormDialog open={!!collect} onClose={() => { setCollect(null); setRk((k) => k + 1); }} title={`Registrar cobro — ${collect?.code ?? ""}`} subtitle={collect ? `Saldo pendiente: ${money(Number(collect.amount) - Number(collect.collected), collect.currency)}` : ""} successMessage="Cobro registrado"
        initial={{ amount: collect ? Number(collect.amount) - Number(collect.collected) : "" }}
        fields={[{ name: "amount", label: "Importe", type: "number", required: true, min: 0.01, step: "any" }, { name: "date", label: "Fecha", type: "date" }, { name: "method", label: "Medio de pago", required: true, placeholder: "Transferencia, depósito…" }, { name: "reference", label: "N.º de operación" }]}
        onSubmit={(v, key) => api(`/sales/receivables/${collect.id}/collect`, { body: v, idempotencyKey: key })} />
    </div>
  );
}

export default function Ventas() {
  return <Suspense fallback={null}><VentasInner /></Suspense>;
}
