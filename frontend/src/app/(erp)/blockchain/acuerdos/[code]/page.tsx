"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Circle, Coins, ShieldCheck, Truck, PackageCheck, HandCoins, Ban, Gavel, Handshake } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, dateTime, short, num, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, Mono, Notice, Badge, Modal, Field, Input } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { useAuth, useToast } from "@/components/providers";

const FLOW = [
  { k: "create", label: "Acuerdo creado (vendedor)", icon: Handshake },
  { k: "accept", label: "Aceptado (comprador)", icon: Handshake },
  { k: "deposit", label: "Fondos de prueba depositados", icon: Coins },
  { k: "quality", label: "Conformidad de calidad", icon: ShieldCheck },
  { k: "delivery", label: "Entrega registrada (logística)", icon: Truck },
  { k: "confirm", label: "Recepción confirmada (comprador)", icon: PackageCheck },
  { k: "release", label: "Pago liberado", icon: HandCoins },
];

export default function AgreementPage() {
  const { code } = useParams<{ code: string }>();
  const { data: a, loading, error, reload } = useApi<any>(`/blockchain/agreements/${code}`);
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<any>(null);
  const [ask, setAsk] = React.useState<null | "cancel" | "dispute">(null);
  const [reason, setReason] = React.useState("");
  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const on = a.onchain;
  const done: Record<string, boolean> = on?.exists ? {
    create: true, accept: on.state !== "PROPUESTO", deposit: ["FONDEADO", "EJECUTADO", "EN_DISPUTA"].includes(on.state) || Number(on.depositedEth) > 0 || on.state === "REEMBOLSADO",
    quality: on.quality !== "PENDIENTE", delivery: on.delivery !== "PENDIENTE", confirm: on.delivery === "CONFIRMADA", release: on.state === "EJECUTADO",
  } : {};
  const run = async (action: string, body: any = {}) => {
    setBusy(action); setLast(null);
    try {
      const r = await api(`/blockchain/agreements/${code}/${action}`, { body });
      setLast(r);
      if (r.ok) toast.success("Transacción confirmada", `Bloque #${r.tx.blockNumber} · ${short(r.tx.txHash)}`);
      else toast.error("El contrato rechazó la transacción", r.errorMessage);
      reload();
    } catch (e: any) { toast.error("Operación no permitida", e.message); } finally { setBusy(null); setAsk(null); setReason(""); }
  };
  const A = ({ action, label, icon: I, perm, variant = "outline", body }: any) => can(perm) ? <Button size="sm" variant={variant} loading={busy === action} disabled={!!busy} onClick={() => run(action, body)}><I className="h-4 w-4" />{label}</Button> : null;
  const st = on?.state;
  return (
    <div className="space-y-4">
      <Link href="/blockchain" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Blockchain</Link>
      <PageHeader area="Exportaciones · Blockchain" title={`Acuerdo comercial ${a.code}`} subtitle={`Lote ${a.lot.code} · ${a.customer.name}${a.salesOrder ? ` · pedido ${a.salesOrder.code}` : ""}`} actions={<StatusBadge status={a.status} />} />
      {a.chainError && <ErrorBox message={a.chainError} />}
      <Card>
        <CardHeader title="Flujo del contrato (estado leído de la blockchain)" subtitle={on?.exists ? `¿Liberación habilitada? ${on.canRelease ? "Sí" : "No"} — ${on.canReleaseReason}` : "El acuerdo aún no existe on-chain"} />
        <CardBody>
          <ol className="grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {FLOW.map((f) => <li key={f.k} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", done[f.k] ? "border-agro/30 bg-agro-50 text-agro dark:bg-agro/10 dark:text-emerald-300" : "border-line text-muted")}>{done[f.k] ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{f.label}</li>)}
          </ol>
          {["CANCELADO", "REEMBOLSADO", "EN_DISPUTA"].includes(st) && <div className="mt-3"><Notice tone={st === "EN_DISPUTA" ? "gold" : "red"}>Estado especial: <b>{st}</b>{st === "REEMBOLSADO" ? " — los fondos de prueba regresaron al comprador." : ""}</Notice></div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {st === "PROPUESTO" && <A action="accept" label="Aceptar (billetera del comprador demo)" icon={Handshake} perm="sales.write" variant="secondary" />}
            {st === "ACEPTADO" && <A action="deposit" label={`Depositar ${on.amountEth} ETH de prueba`} icon={Coins} perm="sales.write" variant="secondary" />}
            {st === "FONDEADO" && on.quality === "PENDIENTE" && <><A action="quality" label="Registrar conformidad de calidad" icon={ShieldCheck} perm="quality.approve" variant="secondary" body={{ approved: true }} /><A action="quality" label="Registrar calidad NO conforme" icon={Ban} perm="quality.approve" body={{ approved: false }} /></>}
            {st === "FONDEADO" && on.quality === "APROBADA" && on.delivery === "PENDIENTE" && <A action="delivery" label="Registrar entrega (logística)" icon={Truck} perm="logistics.write" variant="secondary" />}
            {st === "FONDEADO" && on.delivery === "ENTREGADA" && <A action="confirm" label="Confirmar recepción (comprador demo)" icon={PackageCheck} perm="sales.write" variant="secondary" />}
            {st === "FONDEADO" && <A action="release" label="Liberar pago" icon={HandCoins} perm="sales.write" variant="primary" />}
            {["PROPUESTO", "ACEPTADO", "FONDEADO"].includes(st) && can("sales.write") && <Button size="sm" variant="outline" onClick={() => setAsk("cancel")}><Ban className="h-4 w-4" />Cancelar / reembolsar</Button>}
            {st === "FONDEADO" && can("sales.write") && <Button size="sm" variant="outline" onClick={() => setAsk("dispute")}><Gavel className="h-4 w-4" />Abrir disputa</Button>}
            {st === "EN_DISPUTA" && <><A action="resolve" label="Resolver: reembolsar al comprador" icon={Gavel} perm="blockchain.arbitrate" body={{ releaseToSeller: false }} /><A action="resolve" label="Resolver: pagar al vendedor" icon={Gavel} perm="blockchain.arbitrate" variant="secondary" body={{ releaseToSeller: true }} /></>}
          </div>
          <p className="mt-2 text-[11px] text-muted">“Liberar pago” está disponible siempre que el acuerdo esté fondeado para que pueda comprobarse que el propio contrato rechaza la liberación si falta alguna condición.</p>
          {last && <div className="mt-3">{last.ok ? <Notice tone="green">Confirmada en el bloque #{last.tx.blockNumber}: <Mono>{last.tx.txHash}</Mono> · eventos: {last.events.map((e: any) => e.eventName).join(", ")}</Notice> : <Notice tone="red">Rechazada por el contrato ({last.errorName}): {last.errorMessage}. {last.tx?.txHash ? "" : "No se minó ninguna transacción."}</Notice>}</div>}
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Datos on-chain" /><CardBody>{on?.exists ? <KeyValue items={[["Contrato", <Mono key="c">{a.contractAddress}</Mono>], ["Vendedor", <Mono key="s">{on.seller}</Mono>], ["Comprador", <Mono key="b">{on.buyer}</Mono>], ["Cantidad comprometida", `${on.quantityKg} kg`], ["Importe de prueba", `${on.amountEth} ETH`], ["Referencia empresarial", money(on.referencePen)], ["Depositado", `${on.depositedEth} ETH`], ["Saldo del contrato", `${num(on.contractBalanceEth, 4)} ETH`], ["Fecha límite", dateTime(on.deadline)], ["Calidad / entrega", `${on.quality} / ${on.delivery}`], ["Hash certificado", <Mono key="q">{short(on.qualityCertHash, 12)}</Mono>], ["Hash evidencia entrega", <Mono key="e">{short(on.deliveryEvidenceHash, 12)}</Mono>]]} /> : <p className="text-sm text-muted">Sin datos on-chain.</p>}</CardBody></Card>
        <Card><CardHeader title="Datos ERP" /><CardBody><KeyValue items={[["Lote", `${a.lot.code} · calidad ${a.lot.qualityStatus}`], ["Cliente", a.customer.name], ["Pedido", a.salesOrder ? `${a.salesOrder.code} (${a.salesOrder.status})` : "— (acuerdo de escenario)"], ["Despacho", a.salesOrder?.dispatches?.[0] ? `${a.salesOrder.dispatches[0].code} (${a.salesOrder.dispatches[0].status})` : "—"], ["Cuenta por cobrar", a.salesOrder?.receivables?.[0] ? `${a.salesOrder.receivables[0].code} (${a.salesOrder.receivables[0].status})` : "—"], ["Sincronizado", dateTime(a.lastSyncedAt)]]} /></CardBody></Card>
      </div>
      <Card><CardHeader title="Transacciones del acuerdo" subtitle="Incluye las rechazadas por el contrato" />
        <Table rows={a.txs} columns={[
          { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "f", header: "Función", render: (r: any) => <Mono>{r.functionName}</Mono> }, { key: "a", header: "Actor", render: (r: any) => <Badge tone={r.actor === "intruder" ? "red" : "slate"}>{r.actor}</Badge> },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "b", header: "Bloque", render: (r: any) => r.blockNumber ?? "—" },
          { key: "h", header: "Hash / motivo", render: (r: any) => r.txHash ? <Mono>{short(r.txHash, 14)}</Mono> : <span className="text-xs text-red-600">{r.errorMessage}</span> }, { key: "e", header: "Eventos", render: (r: any) => r.events.map((e: any) => e.eventName).join(", ") || "—" },
        ]} />
      </Card>
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask === "cancel" ? "Cancelar acuerdo" : "Abrir disputa"} size="sm"
        footer={<><Button variant="outline" onClick={() => setAsk(null)}>Volver</Button><Button variant="danger" loading={!!busy} disabled={reason.length < 3} onClick={() => run(ask!, { reason })}>{ask === "cancel" ? "Cancelar" : "Abrir disputa"}</Button></>}>
        <div className="space-y-3 text-sm">
          {ask === "cancel" ? <p>Reglas del contrato: sin fondos, cualquiera de las partes puede cancelar. Con fondos, el comprador solo puede cancelar si la calidad fue rechazada o venció el plazo sin confirmación; el vendedor puede desistir y reembolsar. Si no se cumplen, el contrato rechazará la transacción.</p> : <p>La disputa congela los fondos de prueba hasta que Gerencia (árbitro) resuelva. El contrato nunca libera al vendedor si la calidad no está aprobada.</p>}
          <Field label="Motivo" required><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
