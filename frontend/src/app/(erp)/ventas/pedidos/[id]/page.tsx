"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileDown, FileSignature, Truck, Ban, Receipt } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, money, date, dateTime, num } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, ConfirmDialog, Notice } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { Can, useToast } from "@/components/providers";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const { data: o, loading, error, reload } = useApi<any>(`/sales/orders/${id}`);
  const toast = useToast();
  const router = useRouter();
  const [cancel, setCancel] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (loading && !o) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const ag = o.agreements[0];
  const lots = new Set(o.items.flatMap((i: any) => i.reservations.map((r: any) => r.lot.code)));
  const act = async (k: string, fn: () => Promise<any>, ok: string) => { setBusy(k); try { await fn(); toast.success(ok); reload(); } catch (e: any) { toast.error("No se pudo completar", e.message); } finally { setBusy(null); } };
  return (
    <div className="space-y-4">
      <Link href="/ventas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Ventas</Link>
      <PageHeader title={`Pedido ${o.code}`} subtitle={`${o.customer.name} · ${date(o.date)}`} actions={<>
        <StatusBadge status={o.status} /><StatusBadge status={o.paymentStatus} />
        {o.documents.length === 0 && o.status !== "ANULADO" && <Can perm="sales.write"><Button variant="outline" loading={busy === "doc"} onClick={() => act("doc", () => api(`/sales/orders/${id}/document`, { method: "POST" }), "Comprobante interno emitido")}><Receipt className="h-4 w-4" />Emitir comprobante interno</Button></Can>}
        {o.status === "RESERVADO" && o.dispatches.length === 0 && <Can perm="logistics.write"><Button variant="outline" onClick={() => router.push(`/logistica?nuevo=${o.id}`)}><Truck className="h-4 w-4" />Crear despacho</Button></Can>}
        {!ag && o.status === "RESERVADO" && lots.size === 1 && o.customer.chainActor && <Can perm={["blockchain.write", "sales.write"]}><Button variant="secondary" loading={busy === "sc"} onClick={() => act("sc", async () => { const r = await api("/blockchain/agreements", { body: { salesOrderId: Number(id) } }); if (!r.ok) throw new Error(r.result?.errorMessage ?? "Transacción rechazada"); }, "Acuerdo inteligente creado en la red local")}><FileSignature className="h-4 w-4" />Crear acuerdo inteligente</Button></Can>}
        {ag && <Link href={`/blockchain/acuerdos/${ag.code}`}><Button variant="secondary"><FileSignature className="h-4 w-4" />{ag.code} · {ag.status}</Button></Link>}
        {["REGISTRADO", "RESERVADO"].includes(o.status) && !o.dispatches.some((d: any) => d.inventoryPosted) && <Can perm="sales.write"><Button variant="danger" onClick={() => setCancel(true)}><Ban className="h-4 w-4" />Anular</Button></Can>}
      </>} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Detalle y reservas" />
          <Table rows={o.items} columns={[
            { key: "p", header: "Producto", render: (r: any) => r.product.name }, { key: "q", header: "Cantidad", render: (r: any) => `${num(r.quantity, r.unit === "SACO" ? 0 : 2)} ${r.unit === "SACO" ? "sacos" : "kg"}` },
            { key: "kg", header: "kg", align: "right", render: (r: any) => kg(r.quantityKg) }, { key: "pu", header: "P. unit.", align: "right", render: (r: any) => money(r.unitPrice, o.currency) },
            { key: "d", header: "Dscto.", align: "right", render: (r: any) => `${num(r.discountPct, 1)} %` }, { key: "t", header: "Importe", align: "right", render: (r: any) => money(r.lineTotal, o.currency) },
            { key: "r", header: "Reservas por lote", render: (r: any) => r.reservations.map((x: any) => <div key={x.id} className="text-xs"><Link className="text-paprika hover:underline" href={`/inventario/lotes/${x.lot.code}`}>{x.lot.code}</Link> · {kg(x.quantityKg)} · <StatusBadge status={x.status} /></div>) },
          ]} />
          <CardBody className="border-t border-line">
            <div className="ml-auto max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted">Base imponible</span><span>{money(o.subtotal, o.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Descuentos</span><span>{money(o.discountTotal, o.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Impuesto ({num(Number(o.taxRate) * 100, 0)} %){o.priceIncludesTax ? " incl." : ""}</span><span>{money(o.taxTotal, o.currency)}</span></div>
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><span>Total</span><span className="text-paprika">{money(o.total, o.currency)}</span></div>
              {o.currency !== "PEN" && <p className="text-right text-xs text-muted">T.C. {o.exchangeRate} · {money(Number(o.total) * Number(o.exchangeRate))}</p>}
            </div>
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card><CardHeader title="Cliente" /><CardBody><KeyValue cols={1} items={[["Razón social", o.customer.name], ["Documento", `${o.customer.documentType} ${o.customer.documentNumber}`], ["Crédito", `${o.customer.creditDays} días`], ["Notas", o.notes]]} /></CardBody></Card>
          <Card><CardHeader title="Comprobantes internos" /><CardBody className="space-y-2">
            {o.documents.length === 0 ? <p className="text-sm text-muted">No emitido</p> : o.documents.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span><b>{d.code}</b> · {date(d.issueDate)}</span><Button size="sm" variant="outline" onClick={() => download(`/reports/sales-document/${d.id}.pdf`, `${d.code}.pdf`)}><FileDown className="h-3.5 w-3.5" />PDF</Button></div>
            ))}
            <Notice>Documento interno sin validez tributaria. Facturación electrónica: integración futura con un OSE/PSE autorizado (SUNAT).</Notice>
          </CardBody></Card>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Despachos" /><Table rows={o.dispatches} columns={[
          { key: "code", header: "Despacho" }, { key: "c", header: "Transportista", render: (r: any) => `${r.carrier.name} · ${r.vehicle.plate}` }, { key: "dep", header: "Salida", render: (r: any) => dateTime(r.departureAt) },
          { key: "del", header: "Entrega", render: (r: any) => dateTime(r.deliveredAt) }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} /></Card>
        <Card><CardHeader title="Cuentas por cobrar y cobros" /><Table rows={o.receivables.flatMap((r: any) => [{ ...r, kind: "cxc" }, ...r.transactions.map((t: any) => ({ ...t, kind: "tx" }))])} rowKey={(r: any) => `${r.kind}${r.id}`} columns={[
          { key: "code", header: "Código" }, { key: "k", header: "Tipo", render: (r: any) => r.kind === "cxc" ? "Cuenta por cobrar" : r.simulated ? "Cobro SIMULADO (smart contract)" : "Cobro" },
          { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) }, { key: "s", header: "Estado / ref.", render: (r: any) => r.kind === "cxc" ? <StatusBadge status={r.status} /> : <span className="text-xs">{r.referenceCode?.slice(0, 18)}</span> },
        ]} /></Card>
      </div>
      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} danger title="Anular pedido" message="Se liberarán las reservas de inventario. Esta acción queda registrada en auditoría." confirmText="Anular pedido" loading={busy === "cancel"}
        onConfirm={() => act("cancel", () => api(`/sales/orders/${id}/cancel`, { body: { reason: "Anulado por el usuario" } }), "Pedido anulado").then(() => setCancel(false))} />
    </div>
  );
}
