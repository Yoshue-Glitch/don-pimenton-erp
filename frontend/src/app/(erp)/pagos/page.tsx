"use client";
import * as React from "react";
import { CreditCard, Smartphone, Landmark, CheckCircle2, XCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, dateTime } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Notice, Badge, Loading, Kpi } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can, useToast } from "@/components/providers";

/** Pagos y cobranza: tarjeta (pasarela PCI), Yape y transferencia; verificación y conciliación con el smart contract. */
export default function Pagos() {
  const { data, loading, reload } = useApi<any>("/payments");
  const toast = useToast();
  const [cfg, setCfg] = React.useState(false);
  if (loading && !data) return <Loading />;
  const pv = data.providers, acc = data.accounts, items = data.items as any[];
  const verify = async (id: number, approve: boolean) => { try { await api(`/payments/${id}/verify`, { body: { approve } }); toast.success(approve ? "Pago aprobado: cobranza registrada y escrow fondeado" : "Pago rechazado"); reload(); } catch (e: any) { toast.error("Verificación", e.message); } };
  const Ch = ({ ok, live, name, icon, detail }: any) => (
    <div className="flex items-start gap-3 rounded-xl border border-line p-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${ok ? "bg-agro-50 text-agro" : "bg-soft text-muted"}`}>{icon}</span>
      <div className="min-w-0"><b className="text-sm">{name}</b> {ok ? <Badge tone={live ? "green" : "gold"}>{live ? "ACTIVO · cobros reales" : "ACTIVO · modo prueba"}</Badge> : <Badge tone="slate">Sin configurar</Badge>}<p className="mt-0.5 text-xs text-muted">{detail}</p></div>
    </div>
  );
  return (
    <div className="space-y-4">
      <PageHeader area="Comercio exterior · cobranza" title="Pagos y cobranza" subtitle="Tarjeta (Stripe en USD o Mercado Pago en PEN), Yape y transferencia bancaria / interbancaria. Al aprobarse el pago, el ERP registra la cobranza y fondea el escrow del smart contract." icon={<CreditCard className="h-5 w-5" />}
        actions={<Can perm="settings.manage"><Button onClick={() => setCfg(true)}>Configurar Yape y cuenta bancaria</Button></Can>} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Ch ok={pv.stripe} live={pv.stripeLive} name="Tarjeta · Stripe Checkout (USD)" icon={<CreditCard className="h-5 w-5" />} detail="Visa, Mastercard, Amex. Variables: STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET (webhook /api/payments/webhooks/stripe)." />
        <Ch ok={pv.mercadopago} live={pv.mercadopagoLive} name="Tarjeta / Yape · Mercado Pago (PEN)" icon={<CreditCard className="h-5 w-5" />} detail="Checkout Pro para compradores en Perú. Variable: MP_ACCESS_TOKEN (webhook /api/payments/webhooks/mercadopago)." />
        <Ch ok={!!acc.yapeNumber} live name="Yape directo" icon={<Smartphone className="h-5 w-5" />} detail={acc.yapeNumber ? `Número ${acc.yapeNumber} · ${acc.yapeHolder ?? ""}` : "Falta el número / QR de Yape del negocio"} />
        <Ch ok={!!(acc.cci || acc.accountNumber)} live name="Transferencia / interbancaria" icon={<Landmark className="h-5 w-5" />} detail={acc.cci ? `${acc.bankName ?? ""} · CCI ${acc.cci}${acc.swift ? " · SWIFT " + acc.swift : ""}` : "Faltan los datos de la cuenta del negocio"} />
      </div>
      <Notice tone="blue" icon={<ShieldCheck className="h-4 w-4" />}>Seguridad: el ERP nunca recibe ni almacena números de tarjeta (los ingresa el comprador en la página certificada PCI de la pasarela). Los pagos Yape / transferencia se aprueban solo tras verificar el número de operación; se rechazan números de operación duplicados. Los webhooks se validan con firma (Stripe) o consultando la API (Mercado Pago).</Notice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="green" label="Aprobados" value={items.filter((i) => i.status === "APROBADO").length} /><Kpi tone="blue" label="En verificación" value={items.filter((i) => i.status === "EN_VERIFICACION").length} /><Kpi tone="amber" label="Pendientes" value={items.filter((i) => i.status === "PENDIENTE").length} /><Kpi tone="red" label="Cobrado (USD)" value={money(items.filter((i) => i.status === "APROBADO").reduce((a, b) => a + (b.currency === "USD" ? Number(b.amount) : 0), 0), "USD")} />
      </div>
      <Card>
        <CardHeader title="Pagos recibidos" />
        <Table rows={items} columns={[
          { key: "code", header: "Pago", render: (r: any) => <b>{r.code}</b> }, { key: "s", header: "Pedido", render: (r: any) => `${r.shipment.code} · ${r.shipment.importer}` },
          { key: "m", header: "Medio", render: (r: any) => `${r.provider} · ${r.method}` }, { key: "a", header: "Importe", align: "right", render: (r: any) => money(r.amount, r.currency) },
          { key: "op", header: "Operación", render: (r: any) => r.operationNumber ?? r.externalId ?? "—" }, { key: "l", header: "Modo", render: (r: any) => <Badge tone={r.livemode ? "green" : "gold"}>{r.livemode ? "REAL" : "prueba"}</Badge> },
          { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "x", header: "", render: (r: any) => r.status === "EN_VERIFICACION" ? <Can perm="payments.verify"><div className="flex gap-1"><Button size="sm" onClick={() => verify(r.id, true)}><CheckCircle2 className="h-3.5 w-3.5" />Aprobar</Button><Button size="sm" variant="outline" onClick={() => verify(r.id, false)}><XCircle className="h-3.5 w-3.5" /></Button></div></Can> : r.status === "PENDIENTE" && ["STRIPE", "MERCADOPAGO"].includes(r.provider) ? <Button size="sm" variant="outline" onClick={() => api(`/payments/${r.id}/refresh`, { body: {} }).then(reload)}><RefreshCw className="h-3.5 w-3.5" />Consultar pasarela</Button> : null },
        ]} />
      </Card>
      <FormDialog open={cfg} onClose={() => setCfg(false)} title="Cuentas de cobro de Don Pimentón" subtitle="Se muestran al comprador en el portal. También pueden definirse con variables de entorno (YAPE_NUMBER, BANK_CCI…)." size="lg" successMessage="Cuentas de cobro guardadas"
        initial={{ ...acc, yapeNumber: acc.yapeNumber ?? "", cci: acc.cci ?? "" }}
        fields={[{ name: "yapeNumber", label: "Número Yape (9 dígitos)" }, { name: "yapeHolder", label: "Titular Yape" }, { name: "yapeQrUrl", label: "URL de la imagen del QR Yape (opcional)", full: true }, { name: "bankName", label: "Banco" }, { name: "accountHolder", label: "Titular de la cuenta" }, { name: "accountNumber", label: "N.° de cuenta" }, { name: "cci", label: "CCI (20 dígitos)" }, { name: "swift", label: "Código SWIFT (exterior)" }, { name: "currency", label: "Moneda de la cuenta", type: "select", options: [{ value: "USD", label: "USD" }, { value: "PEN", label: "PEN" }] }]}
        onSubmit={async (v) => { const body: any = {}; for (const [k, x] of Object.entries(v)) body[k] = x === "" ? null : x; await api("/payments/accounts", { method: "PUT", body }); reload(); }} />
    </div>
  );
}
