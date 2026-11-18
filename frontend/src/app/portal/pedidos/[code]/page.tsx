"use client";
import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, CreditCard, Smartphone, Landmark, FlaskConical, Download, PackageCheck, AlertTriangle, Link2, QrCode, ShieldCheck, Copy, CheckCircle2 } from "lucide-react";
import { api, download } from "@/lib/api";
import { num, date, dateTime, money, short, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Input, Field, Select, Notice, StatusBadge, Badge, Textarea, KeyValue } from "@/components/ui";
import { useToast } from "@/components/providers";
import { usePortal } from "@/components/PortalContext";
import { ShipMap } from "@/components/ShipMap";
import { FlowPipeline, EventLog, agreementNote } from "@/components/ExportFlow";

export default function PortalOrder() {
  const { code } = useParams<{ code: string }>();
  const q = useSearchParams();
  const { lang, me } = usePortal();
  const en = lang === "en";
  const toast = useToast();
  const [s, setS] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const load = React.useCallback(() => api(`/portal/orders/${code}`).then(setS).catch((e) => setErr(e.message)), [code]);
  React.useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, [load]);
  // regreso desde la pasarela: confirmar con la pasarela (no se confía en la URL)
  React.useEffect(() => { const p = q.get("pago"); if (p && q.get("estado") === "ok") api(`/portal/payments/${p}/refresh`, { body: {} }).then(() => { toast.success(en ? "Payment verified with the gateway" : "Pago verificado con la pasarela"); load(); }).catch(() => {}); }, [q]);
  if (err) return <Notice tone="red">{err}</Notice>;
  if (!s) return null;
  const readOnly = me?.role === "BROKER";
  const pending = Number(s.amountUsd) - Number(s.paidUsd);
  const act = async (label: string, path: string, body: any = {}) => { try { await api(path, { body }); toast.success(label); load(); } catch (e: any) { toast.error(label, e.message); } };
  return (
    <div className="space-y-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />{en ? "My orders" : "Mis pedidos"}</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-paprika">{en ? "Order" : "Pedido"} · {s.incoterm} {s.incotermVersion}</p><h1 className="text-2xl font-extrabold">{s.code}</h1>
          <p className="text-sm text-muted">{s.pallets} {en ? "pallet(s)" : "paleta(s)"} · {num(s.cases)} {en ? "cases" : "cajas"} · {num(s.jars)} {en ? "jars of 4 oz" : "frascos de 4 oz"} · US$ {num(s.amountUsd, 2)} · {en ? "delivery" : "entrega"} {date(s.deliveryDate)}</p></div>
        <div className="flex flex-wrap gap-2"><StatusBadge status={s.status} />{s.agreement && <StatusBadge status={s.agreement.status} label={`Smart contract: ${s.agreement.status}`} />}</div>
      </div>
      {s.status === "COTIZACION" && !readOnly && <Notice tone="blue">{en ? "This is a quotation." : "Esto es una cotización."} <Button size="sm" className="ml-2" onClick={() => act(en ? "Quotation accepted" : "Cotización aceptada", `/portal/orders/${s.code}/accept-quote`)}>{en ? "Accept and place order" : "Aceptar y hacer pedido"}</Button></Notice>}
      <Card><CardHeader title={en ? "Your protected payment (smart contract)" : "Su pago protegido (smart contract)"} subtitle={agreementNote(s.onchain) ?? (en ? "Created automatically when the order is confirmed" : "Se crea automáticamente al confirmarse el pedido")} icon={<ShieldCheck className="h-5 w-5" />} /><CardBody><FlowPipeline s={s} /></CardBody></Card>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <ShipMap status={s.status} progress={s.voyageProgress} vessel={s.vessel} code={s.code} milestones={s.milestones} height={470} />
        <div className="space-y-4">
          {s.status === "ENTREGADO" && !readOnly && s.onchain?.delivery === "ENTREGADA" && (
            <Card className="border-agro"><CardBody className="space-y-2"><p className="flex items-center gap-2 font-bold"><PackageCheck className="h-5 w-5 text-agro" />{en ? "Your goods were delivered" : "Su mercadería fue entregada"}</p><p className="text-sm text-muted">{en ? "Confirm receipt to let the smart contract verify all conditions and release the payment." : "Confirme la recepción para que el contrato verifique las condiciones y libere el pago."}</p><Button className="w-full" onClick={() => act(en ? "Receipt confirmed on-chain" : "Recepción confirmada on-chain", `/portal/orders/${s.code}/confirm-delivery`)}><CheckCircle2 className="h-4 w-4" />{en ? "Confirm receipt" : "Confirmar recepción"}</Button></CardBody></Card>
          )}
          {pending > 0.009 && !readOnly && s.status !== "COTIZACION" && <PayBox s={s} en={en} reload={load} />}
          {pending <= 0.009 && <Notice tone="green">{en ? "Fully paid." : "Pedido pagado en su totalidad."} US$ {num(s.paidUsd, 2)}</Notice>}
          <Card><CardHeader title={en ? "Documents" : "Documentos"} subtitle={en ? "Demo documents · not official" : "Documentos de demostración · no oficiales"} />
            <CardBody className="grid grid-cols-1 gap-1.5">{s.docs.map((d: any) => <button key={d.type} disabled={!s.palletsList.length && d.type !== "proforma"} onClick={() => download(`/portal/orders/${s.code}/docs/${d.type}.pdf`, `${d.type}-${s.code}.pdf`).catch((e) => toast.error(d.name, e.message))} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-left text-sm hover:border-agro disabled:opacity-40"><Download className="h-4 w-4 text-paprika" />{d.name}</button>)}</CardBody></Card>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title={en ? "Shipment data" : "Datos del embarque"} />
          <CardBody><KeyValue cols={2} items={[[en ? "Lot" : "Lote", s.lot?.code], ["COA", s.lot?.qualityStatus], [en ? "Pallets (SSCC)" : "Paletas (SSCC)", s.palletsList.map((p: any) => p.sscc).join(", ") || "—"], [en ? "Vessel" : "Nave", s.vessel], ["B/L", s.blNumber], [en ? "Container" : "Contenedor", s.container], ["DAM (SUNAT)", s.damNumber], ["Prior Notice", s.priorNoticeNo], [en ? "ISF data sent" : "Datos ISF enviados", dateTime(s.isfSentAt)], [en ? "Route" : "Ruta", `${s.originPort} → ${s.destinationPort}`]]} />
            {s.traceUrl && <a href={`/trazabilidad/${s.lot?.code}`} target="_blank" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-bluex hover:underline"><QrCode className="h-4 w-4" />{en ? "Origin story & blockchain verification" : "Historia de origen y verificación blockchain"}</a>}
          </CardBody></Card>
        <Card><CardHeader title={en ? "On-chain transactions" : "Transacciones on-chain"} subtitle="PaprikaTradeAgreement · red local" />
          <CardBody className="max-h-[300px] space-y-1.5 overflow-y-auto">{s.txs.length ? s.txs.map((t: any, i: number) => <p key={i} className="flex flex-wrap items-center gap-1.5 text-xs"><Link2 className="h-3.5 w-3.5 text-agro" /><b>{t.functionName}</b><span className="text-muted">({t.actor})</span><StatusBadge status={t.status} /><code className="text-muted">{short(t.txHash, 10)}</code>{t.blockNumber && <span className="text-muted">#{t.blockNumber}</span>}</p>) : <p className="text-sm text-muted">—</p>}</CardBody></Card>
      </div>
      {!readOnly && <ClaimBox s={s} en={en} reload={load} />}
      <Card><CardHeader title={en ? "Activity" : "Actividad"} /><CardBody className="max-h-[380px] overflow-y-auto"><EventLog events={s.events} /></CardBody></Card>
    </div>
  );
}

function PayBox({ s, en, reload }: { s: any; en: boolean; reload: () => void }) {
  const toast = useToast();
  const [method, setMethod] = React.useState<"TARJETA" | "YAPE" | "TRANSFERENCIA" | "PRUEBA">(s.providers.stripe || s.providers.mercadopago ? "TARJETA" : s.accounts.yapeNumber ? "YAPE" : "TRANSFERENCIA");
  const [pay, setPay] = React.useState<any>(null);
  const [op, setOp] = React.useState("");
  const [file, setFile] = React.useState<{ name: string; b64: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const pending = Number(s.amountUsd) - Number(s.paidUsd);
  const pen = pending * Number(s.exchangeRate);
  const start = async () => {
    setBusy(true);
    try {
      const r = await api<any>(`/portal/orders/${s.code}/pay`, { body: { method, provider: method === "TARJETA" ? (s.providers.stripe ? "STRIPE" : "MERCADOPAGO") : undefined } });
      if (r.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      setPay(r); if (r.status === "APROBADO") { toast.success(en ? "Test payment approved" : "Pago de prueba aprobado"); reload(); }
    } catch (e: any) { toast.error(en ? "Payment" : "Pago", e.message); } finally { setBusy(false); }
  };
  const send = async () => { try { await api(`/portal/payments/${pay.code}/voucher`, { body: { operationNumber: op, voucherName: file?.name, voucherBase64: file?.b64 } }); toast.success(en ? "Proof sent: Finance will verify it" : "Constancia enviada: Finanzas la verificará"); setPay(null); reload(); } catch (e: any) { toast.error("Constancia", e.message); } };
  const opts = [
    { id: "TARJETA", label: en ? "Card" : "Tarjeta", icon: CreditCard, on: s.providers.stripe || s.providers.mercadopago, sub: s.providers.stripe ? `Stripe · USD ${num(pending, 2)}` : s.providers.mercadopago ? `Mercado Pago · S/ ${num(pen, 2)}` : en ? "Gateway not configured" : "Pasarela sin configurar" },
    { id: "YAPE", label: "Yape", icon: Smartphone, on: !!s.accounts.yapeNumber, sub: `S/ ${num(pen, 2)}` },
    { id: "TRANSFERENCIA", label: en ? "Bank transfer" : "Transferencia", icon: Landmark, on: !!(s.accounts.cci || s.accounts.accountNumber), sub: en ? "CCI / SWIFT" : "CCI / SWIFT" },
    ...(s.providers.testMode ? [{ id: "PRUEBA", label: en ? "Test payment" : "Pago de prueba", icon: FlaskConical, on: true, sub: en ? "No real money" : "Sin dinero real" }] : []),
  ] as const;
  return (
    <Card><CardHeader title={en ? "Pay your order" : "Pagar el pedido"} subtitle={`${en ? "Pending" : "Pendiente"}: US$ ${num(pending, 2)} (≈ S/ ${num(pen, 2)} · TC ${Number(s.exchangeRate).toFixed(2)})`} icon={<CreditCard className="h-5 w-5" />} />
      <CardBody className="space-y-3">
        {!pay && <>
          <div className="grid grid-cols-2 gap-2">{opts.map((o) => { const I = o.icon; return <button key={o.id} disabled={!o.on} onClick={() => setMethod(o.id as any)} className={cn("rounded-xl border-2 p-2.5 text-left transition disabled:opacity-40", method === o.id ? "border-paprika bg-paprika-50" : "border-line hover:border-agro")}><I className="h-5 w-5 text-paprika" /><b className="block text-sm">{o.label}</b><small className="text-[11px] text-muted">{o.sub}</small></button>; })}</div>
          <Button className="w-full" loading={busy} onClick={start}>{method === "TARJETA" ? (en ? "Go to secure checkout" : "Ir al pago seguro") : method === "PRUEBA" ? (en ? "Approve test payment" : "Aprobar pago de prueba") : (en ? "Show payment details" : "Ver datos de pago")}</Button>
          <p className="text-[11px] text-muted">{en ? "Card details are entered only on the PCI-certified gateway page; Don Pimentón never sees them. Approved payments fund the smart-contract escrow automatically." : "Los datos de la tarjeta se ingresan solo en la página certificada PCI de la pasarela; Don Pimentón nunca los ve. Al aprobarse el pago, se fondea automáticamente el escrow del smart contract."}</p>
        </>}
        {pay?.instructions && <div className="space-y-2 text-sm">
          {pay.provider === "YAPE" ? <div className="rounded-xl bg-[#742284] p-3 text-white"><p className="text-xs opacity-80">Yape</p><p className="flex items-center gap-2 text-2xl font-black">{pay.instructions.yapeNumber}<button onClick={() => navigator.clipboard.writeText(pay.instructions.yapeNumber)}><Copy className="h-4 w-4" /></button></p><p className="text-xs">{pay.instructions.holder} · S/ {num(Number(pay.amount), 2)}</p>{pay.instructions.qr && <img src={pay.instructions.qr} alt="QR Yape" className="mt-2 h-40 rounded-lg bg-white p-1" />}</div>
            : <KeyValue cols={2} items={[[en ? "Bank" : "Banco", pay.instructions.bank], [en ? "Holder" : "Titular", pay.instructions.holder], [en ? "Account" : "Cuenta", pay.instructions.account], ["CCI", pay.instructions.cci], ["SWIFT", pay.instructions.swift], [en ? "Amount" : "Importe", money(pay.amount, pay.currency)]]} />}
          <p className="text-[11px] text-muted">{pay.instructions.note}</p>
          <Field label={en ? "Operation number" : "Número de operación"}><Input value={op} onChange={(e) => setOp(e.target.value)} /></Field>
          <Field label={en ? "Proof of payment (image or PDF)" : "Constancia (imagen o PDF)"}><input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => setFile({ name: f.name, b64: String(rd.result) }); rd.readAsDataURL(f); }} /></Field>
          <Button className="w-full" disabled={op.length < 4} onClick={send}>{en ? "Send for verification" : "Enviar para verificación"}</Button>
        </div>}
        {s.payments.length > 0 && <div className="space-y-1 border-t border-line pt-2">{s.payments.map((p: any) => <p key={p.code} className="flex items-center justify-between text-xs"><span>{p.code} · {p.provider} · {money(p.amount, p.currency)}</span><span className="flex items-center gap-1"><Badge tone={p.livemode ? "green" : "gold"}>{p.livemode ? "REAL" : "test"}</Badge><StatusBadge status={p.status} /></span></p>)}</div>}
      </CardBody></Card>
  );
}

function ClaimBox({ s, en, reload }: { s: any; en: boolean; reload: () => void }) {
  const toast = useToast();
  const [type, setType] = React.useState("ROTURA");
  const [jars, setJars] = React.useState(0);
  const [desc, setDesc] = React.useState("");
  return (
    <Card><CardHeader title={en ? "Claims, returns & disputes" : "Reclamos, devoluciones y disputas"} subtitle={en ? "Reverse logistics: each claim gets an RMA code and a resolution within 15 days" : "Logística inversa: cada reclamo recibe un código RMA y se atiende en ≤ 15 días"} icon={<AlertTriangle className="h-5 w-5" />} />
      <CardBody className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2"><Field label={en ? "Type" : "Tipo"}><Select value={type} onChange={(e) => setType(e.target.value)}>{["CALIDAD", "ROTURA", "FALTANTE", "ETIQUETADO", "RETRASO", "OTRO"].map((t) => <option key={t}>{t}</option>)}</Select></Field><Field label={en ? "Jars affected" : "Frascos afectados"}><Input type="number" min={0} value={jars} onChange={(e) => setJars(Number(e.target.value))} /></Field></div>
          <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={en ? "Describe the issue" : "Describa el problema"} />
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={desc.length < 5} onClick={async () => { try { const c = await api<any>(`/portal/orders/${s.code}/claims`, { body: { type, jars, description: desc } }); toast.success(`RMA ${c.code}`); setDesc(""); reload(); } catch (e: any) { toast.error("RMA", e.message); } }}>{en ? "Open claim (RMA)" : "Abrir reclamo (RMA)"}</Button>
            {s.agreement?.status === "FONDEADO" && <Button variant="danger" disabled={desc.length < 5} onClick={async () => { if (!confirm(en ? "Open a dispute? The arbiter will decide and automation stops." : "¿Abrir disputa? El árbitro resolverá y se detiene la automatización.")) return; try { await api(`/portal/orders/${s.code}/dispute`, { body: { reason: desc } }); toast.success(en ? "Dispute opened on-chain" : "Disputa abierta on-chain"); reload(); } catch (e: any) { toast.error("Disputa", e.message); } }}>{en ? "Open dispute" : "Abrir disputa"}</Button>}</div>
        </div>
        <div className="space-y-1.5">{s.claims.length ? s.claims.map((c: any) => <div key={c.code} className="rounded-lg border border-line p-2 text-xs"><div className="flex items-center justify-between"><b>{c.code} · {c.type}</b><StatusBadge status={c.status} /></div><p className="text-muted">{c.description}</p>{c.resolution && <p className="mt-1 text-agro">{c.disposition}: {c.resolution}</p>}</div>) : <p className="text-sm text-muted">{en ? "No claims." : "Sin reclamos."}</p>}</div>
      </CardBody></Card>
  );
}
