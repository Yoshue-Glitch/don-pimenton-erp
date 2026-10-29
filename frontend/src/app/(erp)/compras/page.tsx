"use client";
import * as React from "react";
import { ShoppingCart, Plus, Send, Check, X, FileText, PackageCheck, BadgeCheck, Wallet, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, date, num } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Modal, Notice, Badge, Field, Input, Select, ErrorBox } from "@/components/ui";
import { ServerTable, LocalTable, Table } from "@/components/DataTable";
import { CrudSection, useOptions } from "@/components/Crud";
import { FormDialog } from "@/components/FormDialog";
import { ModuleKpis } from "@/components/ModuleKpis";
import { Can, useAuth, useToast } from "@/components/providers";

export default function Compras() {
  const [tab, setTab] = React.useState<"solicitudes" | "ordenes" | "cxp" | "proveedores">("solicitudes");
  const [rk, setRk] = React.useState(0);
  const r = () => setRk((k) => k + 1);
  const [newReq, setNewReq] = React.useState(false);
  const [detail, setDetail] = React.useState<any>(null);
  const [quote, setQuote] = React.useState<any>(null);
  const [receive, setReceive] = React.useState<any>(null);
  const [conf, setConf] = React.useState<any>(null);
  const [pay, setPay] = React.useState<any>(null);
  const toast = useToast();
  const { user, can } = useAuth();
  const products = useOptions("/inventory/products?pageSize=100", (p) => `${p.name} (${p.unit})`);
  const suppliers = useOptions("/purchasing/suppliers?pageSize=100", (s) => s.name);
  const warehouses = useOptions("/inventory/warehouses", (w) => w.code);
  const areas = useOptions("/admin/areas", (a) => a.name);
  const payables = useApi<any[]>("/purchasing/payables", [rk]);
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toast.success(ok); r(); setDetail(null); } catch (e: any) { toast.error("Operación rechazada", e.message); } };
  return (
    <div className="space-y-4">
      <PageHeader area="Administración y Finanzas" title="Compras" subtitle="Solicitud → Revisión → Aprobación de Gerencia → Orden de compra → Recepción → Conformidad → Pago" icon={<ShoppingCart className="h-5 w-5" />}
        actions={<Can perm="purchases.write"><Button onClick={() => setNewReq(true)}><Plus className="h-4 w-4" />Nueva solicitud</Button></Can>} />
      <ModuleKpis module="compras" reloadKey={rk} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "solicitudes", label: "Solicitudes" }, { id: "ordenes", label: "Órdenes de compra" }, { id: "cxp", label: "Cuentas por pagar" }, { id: "proveedores", label: "Proveedores" }]} />
      <Card>
        {tab === "solicitudes" && <ServerTable path="/purchasing/requests" searchable={false} reloadKey={rk} onRowClick={setDetail}
          filters={[{ key: "status", label: "Estado", options: ["BORRADOR", "EN_REVISION", "APROBADA", "RECHAZADA", "ORDENADA"].map((v) => ({ value: v, label: v })) }]}
          columns={[{ key: "code", header: "Solicitud", render: (x: any) => <span className="font-semibold">{x.code}</span> }, { key: "d", header: "Fecha", render: (x: any) => date(x.date) },
            { key: "by", header: "Solicitante", render: (x: any) => x.requestedBy.name }, { key: "j", header: "Justificación", render: (x: any) => x.justification, hideOnMobile: true },
            { key: "i", header: "Ítems", render: (x: any) => x.items.map((i: any) => `${num(i.quantity)} ${i.product.unit.toLowerCase()} ${i.product.name}`).join("; "), hideOnMobile: true },
            { key: "t", header: "Estimado", align: "right", render: (x: any) => money(x.estimatedTotal) }, { key: "q", header: "Cotiz.", align: "center", render: (x: any) => x.quotes.length },
            { key: "s", header: "Estado", render: (x: any) => <StatusBadge status={x.status} /> }, { key: "ap", header: "Aprobó", render: (x: any) => x.approvedBy?.name ?? "—" }]} />}
        {tab === "ordenes" && <ServerTable path="/purchasing/orders" searchable={false} reloadKey={rk} columns={[
          { key: "code", header: "OC", render: (x: any) => <span className="font-semibold">{x.code}</span> }, { key: "d", header: "Fecha", render: (x: any) => date(x.date) }, { key: "s", header: "Proveedor", render: (x: any) => x.supplier.name },
          { key: "req", header: "Solicitud", render: (x: any) => x.request?.code ?? "—" }, { key: "i", header: "Ítems", render: (x: any) => x.items.map((i: any) => `${num(i.receivedQty)}/${num(i.quantity)} ${i.product.name}`).join("; "), hideOnMobile: true },
          { key: "t", header: "Total", align: "right", render: (x: any) => money(x.total, x.currency) }, { key: "st", header: "Estado", render: (x: any) => <StatusBadge status={x.status} /> },
          { key: "a", header: "", align: "right", render: (x: any) => <div className="flex justify-end gap-1">
            {["EMITIDA", "RECIBIDA_PARCIAL"].includes(x.status) && can("purchases.receive") && <Button size="sm" variant="outline" onClick={() => setReceive(x)}><PackageCheck className="h-3.5 w-3.5" />Recepcionar</Button>}
            {x.status === "RECIBIDA" && can("purchases.receive") && <Button size="sm" variant="secondary" onClick={() => setConf(x)}><BadgeCheck className="h-3.5 w-3.5" />Conformidad</Button>}
          </div> },
        ]} />}
        {tab === "cxp" && <LocalTable rows={payables.data ?? []} columns={[
          { key: "code", header: "CxP" }, { key: "s", header: "Proveedor", render: (x: any) => x.supplier.name }, { key: "o", header: "OC", render: (x: any) => x.purchaseOrder?.code ?? "—" }, { key: "doc", header: "Documento", render: (x: any) => x.documentRef },
          { key: "due", header: "Vence", render: (x: any) => date(x.dueDate) }, { key: "a", header: "Importe", align: "right", render: (x: any) => money(x.amount, x.currency) }, { key: "p", header: "Pagado", align: "right", render: (x: any) => money(x.paidAmount, x.currency) },
          { key: "st", header: "Estado", render: (x: any) => <StatusBadge status={x.status} /> },
          { key: "x", header: "", align: "right", render: (x: any) => x.status !== "PAGADA" ? <Can perm="purchases.pay"><Button size="sm" variant="secondary" onClick={() => setPay(x)}><Wallet className="h-3.5 w-3.5" />Pagar</Button></Can> : null },
        ]} />}
        {tab === "proveedores" && <CrudSection path="/purchasing/suppliers" title="proveedor" writePerm="purchases.write" newLabel="Nuevo proveedor" canDelete={false}
          columns={[{ key: "ruc", header: "RUC" }, { key: "name", header: "Razón social", render: (x: any) => <span className="font-medium">{x.name}</span> }, { key: "category", header: "Categoría" }, { key: "contact", header: "Contacto" }, { key: "phone", header: "Teléfono" }, { key: "a", header: "Activo", render: (x: any) => x.active ? <Badge tone="green">Sí</Badge> : <Badge>No</Badge> }]}
          toEdit={(x: any) => ({ ruc: x.ruc, name: x.name, category: x.category, contact: x.contact ?? "", phone: x.phone ?? "", email: x.email ?? "", address: x.address ?? "", active: x.active })}
          fields={[{ name: "ruc", label: "RUC", required: true, pattern: /^(10|20)\d{9}$/, patternMsg: "RUC de 11 dígitos" }, { name: "name", label: "Razón social", required: true }, { name: "category", label: "Categoría", required: true }, { name: "contact", label: "Contacto" }, { name: "phone", label: "Teléfono" }, { name: "email", label: "Correo", type: "email" }, { name: "address", label: "Dirección", full: true }, { name: "active", label: "Activo", type: "checkbox" }]} />}
      </Card>

      <RequestDialog open={newReq} onClose={() => { setNewReq(false); r(); }} products={products} areas={areas} />
      {detail && <RequestDetail req={detail} me={user!.id} can={can} onClose={() => setDetail(null)} onQuote={() => setQuote(detail)} act={act} />}
      <FormDialog open={!!quote} onClose={() => { setQuote(null); r(); }} title={`Registrar cotización — ${quote?.code ?? ""}`} successMessage="Cotización registrada"
        fields={[{ name: "supplierId", label: "Proveedor", type: "select", required: true, options: suppliers }, { name: "currency", label: "Moneda", type: "select", options: [{ value: "PEN", label: "PEN" }, { value: "USD", label: "USD" }] },
          { name: "total", label: "Total ofertado", type: "number", required: true, min: 0.01, step: "any" }, { name: "deliveryDays", label: "Plazo de entrega (días)", type: "number", required: true, min: 0 },
          { name: "paymentTerms", label: "Condición de pago" }, { name: "notes", label: "Notas" }]} initial={{ currency: "PEN" }}
        onSubmit={(v, key) => api(`/purchasing/requests/${quote.id}/quotes`, { body: v, idempotencyKey: key })} />
      <ReceiveDialog po={receive} warehouses={warehouses} onClose={() => { setReceive(null); r(); }} />
      <FormDialog open={!!conf} onClose={() => { setConf(null); r(); }} title={`Conformidad — ${conf?.code ?? ""}`} subtitle="Genera la cuenta por pagar" successMessage="Conformidad registrada"
        fields={[{ name: "documentRef", label: "Comprobante del proveedor", required: true, placeholder: "F001-000000" }, { name: "dueDays", label: "Plazo de pago (días)", type: "number", min: 0, max: 180 }]} initial={{ dueDays: 30 }}
        onSubmit={(v) => api(`/purchasing/orders/${conf.id}/conformity`, { body: v })} />
      <FormDialog open={!!pay} onClose={() => { setPay(null); r(); }} title={`Pago — ${pay?.code ?? ""}`} successMessage="Pago registrado" initial={{ amount: pay ? Number(pay.amount) - Number(pay.paidAmount) : "" }}
        fields={[{ name: "amount", label: "Importe", type: "number", required: true, min: 0.01, step: "any" }, { name: "method", label: "Medio de pago", required: true }, { name: "reference", label: "N.º de operación" }]}
        onSubmit={(v, key) => api(`/purchasing/payables/${pay.id}/pay`, { body: v, idempotencyKey: key })} />
    </div>
  );
}

function RequestDialog({ open, onClose, products, areas }: any) {
  const [items, setItems] = React.useState([{ productId: "", quantity: "", estimatedPrice: "" }]);
  React.useEffect(() => { if (open) setItems([{ productId: "", quantity: "", estimatedPrice: "" }]); }, [open]);
  return (
    <FormDialog open={open} onClose={onClose} title="Nueva solicitud de compra" size="lg" successMessage="Solicitud creada (borrador)"
      fields={[{ name: "areaId", label: "Área solicitante", type: "select", options: areas }, { name: "justification", label: "Justificación", type: "textarea", required: true }]}
      onSubmit={(v, key) => {
        const its = items.filter((i) => i.productId).map((i) => ({ productId: Number(i.productId), quantity: Number(i.quantity), estimatedPrice: Number(i.estimatedPrice || 0) }));
        if (!its.length || its.some((i) => !(i.quantity > 0))) throw new Error("Agregue al menos un ítem con cantidad");
        return api("/purchasing/requests", { body: { ...v, items: its }, idempotencyKey: key });
      }}>
      {() => (
        <div className="space-y-2">
          <p className="text-xs font-medium">Ítems</p>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-6 gap-2">
              <Select className="col-span-3" value={it.productId} onChange={(e) => setItems((x) => x.map((y, j) => j === i ? { ...y, productId: e.target.value } : y))}><option value="">Producto…</option>{products.map((p: any) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
              <Input type="number" placeholder="Cant." value={it.quantity} onChange={(e) => setItems((x) => x.map((y, j) => j === i ? { ...y, quantity: e.target.value } : y))} />
              <Input type="number" placeholder="P. est." value={it.estimatedPrice} onChange={(e) => setItems((x) => x.map((y, j) => j === i ? { ...y, estimatedPrice: e.target.value } : y))} />
              <Button type="button" variant="ghost" onClick={() => setItems((x) => x.length > 1 ? x.filter((_, j) => j !== i) : x)}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setItems((x) => [...x, { productId: "", quantity: "", estimatedPrice: "" }])}><Plus className="h-4 w-4" />Ítem</Button>
        </div>
      )}
    </FormDialog>
  );
}

function RequestDetail({ req, me, can, onClose, onQuote, act }: any) {
  const { data: full, reload } = useApi<any>(`/purchasing/requests/${req.id}`);
  const { data: cmp } = useApi<any[]>(`/purchasing/requests/${req.id}/comparison`, [full]);
  const [sel, setSel] = React.useState<string>("");
  const [err, setErr] = React.useState<string | null>(null);
  const x = full ?? req;
  const own = x.requestedById === me;
  const createPO = async () => {
    setErr(null);
    const q = cmp?.find((c) => String(c.id) === sel);
    if (!q) return setErr("Seleccione la cotización ganadora");
    const totalEst = x.items.reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.estimatedPrice || 1), 0);
    const items = x.items.map((i: any) => { const share = (Number(i.quantity) * Number(i.estimatedPrice || 1)) / totalEst; return { productId: i.productId, quantity: Number(i.quantity), unitPrice: Math.round(((Number(q.total) / 1.18) * share / Number(i.quantity)) * 10000) / 10000 }; });
    await act(() => api("/purchasing/orders", { body: { requestId: x.id, quoteId: q.id, items, taxRate: 0.18 } }), "Orden de compra emitida");
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Solicitud ${x.code}`} subtitle={`${x.requestedBy?.name} · ${date(x.date)}`}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cerrar</Button>
        {x.status === "BORRADOR" && can("purchases.write") && <Button variant="outline" onClick={() => act(() => api(`/purchasing/requests/${x.id}/submit`, { method: "POST" }), "Enviada a revisión")}><Send className="h-4 w-4" />Enviar a revisión</Button>}
        {["BORRADOR", "EN_REVISION", "APROBADA"].includes(x.status) && can("purchases.write") && <Button variant="outline" onClick={onQuote}><FileText className="h-4 w-4" />Registrar cotización</Button>}
        {x.status === "EN_REVISION" && can("purchases.approve") && <>
          <Button variant="danger" disabled={own} onClick={() => act(() => api(`/purchasing/requests/${x.id}/decision`, { body: { approve: false } }), "Solicitud rechazada")}><X className="h-4 w-4" />Rechazar</Button>
          <Button variant="secondary" disabled={own} onClick={() => act(() => api(`/purchasing/requests/${x.id}/decision`, { body: { approve: true } }), "Solicitud aprobada")}><Check className="h-4 w-4" />Aprobar</Button></>}
        {x.status === "APROBADA" && can("purchases.write") && <Button onClick={createPO}>Emitir orden de compra</Button>}
      </>}>
      <div className="space-y-4">
        {err && <ErrorBox message={err} />}
        <div className="flex items-center gap-2"><StatusBadge status={x.status} />{x.approvedBy && <span className="text-xs text-muted">Decisión: {x.approvedBy.name} {x.decisionNote ? `— ${x.decisionNote}` : ""}</span>}</div>
        <p className="text-sm">{x.justification}</p>
        {x.status === "EN_REVISION" && !can("purchases.approve") && <Notice>La aprobación corresponde a Gerencia (permiso purchases.approve).</Notice>}
        {own && x.status === "EN_REVISION" && can("purchases.approve") && <Notice tone="red">Segregación de funciones: no puede aprobar su propia solicitud.</Notice>}
        <Table rows={x.items ?? []} columns={[{ key: "p", header: "Producto", render: (i: any) => i.product.name }, { key: "q", header: "Cantidad", align: "right", render: (i: any) => `${num(i.quantity)} ${i.product.unit.toLowerCase()}` }, { key: "e", header: "Precio est.", align: "right", render: (i: any) => money(i.estimatedPrice) }]} />
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Scale className="h-4 w-4 text-paprika" />Comparación de ofertas</p>
          <Table rows={cmp ?? []} empty={<p className="text-sm text-muted">Sin cotizaciones registradas</p>} columns={[
            { key: "sel", header: "", render: (q: any) => x.status === "APROBADA" ? <input type="radio" name="q" className="accent-paprika" checked={sel === String(q.id)} onChange={() => setSel(String(q.id))} /> : q.selected ? <Badge tone="green">Elegida</Badge> : null },
            { key: "s", header: "Proveedor", render: (q: any) => q.supplier.name }, { key: "t", header: "Total", align: "right", render: (q: any) => money(q.total, q.currency) },
            { key: "pen", header: "Total PEN", align: "right", render: (q: any) => money(q.totalPen) }, { key: "d", header: "Plazo", align: "right", render: (q: any) => `${q.deliveryDays} días` },
            { key: "pt", header: "Pago", render: (q: any) => q.paymentTerms ?? "—" }, { key: "sc", header: "Puntaje", align: "right", render: (q: any) => <b>{q.score}</b> },
          ]} />
          <p className="mt-1 text-[11px] text-muted">Puntaje: 60 % precio + 40 % plazo de entrega (referencial).</p>
        </div>
      </div>
    </Modal>
  );
}

function ReceiveDialog({ po, warehouses, onClose }: any) {
  const [qty, setQty] = React.useState<Record<number, string>>({});
  React.useEffect(() => { if (po) setQty(Object.fromEntries(po.items.map((i: any) => [i.id, String(Number(i.quantity) - Number(i.receivedQty))]))); }, [po]);
  if (!po) return null;
  return (
    <FormDialog open onClose={onClose} title={`Recepción de insumos — ${po.code}`} successMessage="Recepción registrada e ingresada al almacén" initial={{ warehouseId: warehouses.find((w: any) => w.label === "ALM-INS")?.value ?? "" }}
      fields={[{ name: "warehouseId", label: "Almacén", type: "select", required: true, options: warehouses }, { name: "receivedBy", label: "Recibido por", required: true }, { name: "notes", label: "Observaciones", type: "textarea" }]}
      onSubmit={(v) => api(`/purchasing/orders/${po.id}/receive`, { body: { ...v, items: po.items.map((i: any) => ({ orderItemId: i.id, quantity: Number(qty[i.id] || 0) })).filter((i: any) => i.quantity > 0) } })}>
      {() => <div className="space-y-2">{po.items.map((i: any) => <Field key={i.id} label={`${i.product.name} — pendiente ${num(Number(i.quantity) - Number(i.receivedQty))}`}><Input type="number" value={qty[i.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))} /></Field>)}</div>}
    </FormDialog>
  );
}
