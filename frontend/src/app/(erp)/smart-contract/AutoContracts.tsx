"use client";
/** Contratos inteligentes automatizados: selector de embarque, mapa animado, pipeline, condiciones, eventos y verificación. */
import * as React from "react";
import Link from "next/link";
import { Bot, Link2, ShieldCheck, Settings2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, short, dateTime, money } from "@/lib/utils";
import { Card, CardHeader, CardBody, StatusBadge, Badge, Button, Select, Notice, KeyValue, Loading } from "@/components/ui";
import { Can, useToast } from "@/components/providers";
import { ShipMap } from "@/components/ShipMap";
import { FlowPipeline, EventLog, agreementNote } from "@/components/ExportFlow";
import { FormDialog } from "@/components/FormDialog";

export function AutoContracts() {
  const list = useApi<any[]>("/trade/shipments");
  const params = useApi<any>("/trade/params");
  const toast = useToast();
  const [sel, setSel] = React.useState<string>("");
  const [s, setS] = React.useState<any>(null);
  const [cfg, setCfg] = React.useState(false);
  const ships = (list.data ?? []).filter((x) => x.status !== "COTIZACION");
  React.useEffect(() => {
    if (!sel && ships.length) setSel(String((ships.find((x) => !["CERRADO", "ANULADO"].includes(x.status)) ?? ships[0]).id));
  }, [ships, sel]);
  React.useEffect(() => {
    if (!sel) return;
    const load = () => api(`/trade/shipments/${sel}`).then(setS).catch(() => {});
    load(); const t = setInterval(load, 2500); return () => clearInterval(t);
  }, [sel]);
  React.useEffect(() => { const t = setInterval(list.reload, 6000); return () => clearInterval(t); }, [list.reload]);
  const a = params.data?.automation;
  if (list.loading && !list.data) return <Loading />;
  if (!ships.length) return <Notice>No hay embarques de exportación. Cree un pedido en <Link href="/comex" className="font-bold underline">Pedidos y paletas</Link>, desde el portal del comprador o con la <Link href="/simulacion" className="font-bold underline">simulación</Link>.</Notice>;
  const on = s?.onchain;
  const cond = on?.exists ? [
    ["Fondos depositados en custodia", Number(on.depositedEth) > 0 || on.state === "EJECUTADO"], ["Calidad aprobada on-chain (lote APROBADO en PaprikaTraceability)", on.quality === "APROBADA"],
    ["Entrega registrada por logística", ["ENTREGADA", "CONFIRMADA"].includes(on.delivery)], ["Recepción confirmada por el comprador", on.delivery === "CONFIRMADA"], ["Pago liberado (una sola vez)", on.state === "EJECUTADO"],
  ] as [string, boolean][] : [];
  return (
    <div className="space-y-4">
      <Card><CardBody className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1 sm:max-w-md"><p className="mb-1 text-xs font-bold text-fg">Embarque / acuerdo</p>
          <Select value={sel} onChange={(e) => setSel(e.target.value)}>{ships.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.importer} · {x.status.replace(/_/g, " ").toLowerCase()}{x.agreement ? ` · ${x.agreement.code}` : ""}</option>)}</Select></div>
        {a && <p className="flex items-center gap-2 pb-2 text-xs text-muted"><Bot className="h-4 w-4 text-agro" />Motor de automatización {a.enabled ? "ACTIVO" : "detenido"} · ciclo {a.intervalMs / 1000} s · viaje demo {a.voyageSeconds} s · confirmación del comprador {a.simulateBuyerConfirm ? `automática (billetera demo, ${a.buyerConfirmDelaySeconds} s)` : "solo desde el portal"}</p>}
        <Can perm="settings.manage"><Button size="sm" variant="outline" className="mb-1" onClick={() => setCfg(true)}><Settings2 className="h-4 w-4" />Automatización</Button></Can>
      </CardBody></Card>
      {s && <>
        <Card>
          <CardHeader title={s.agreement ? `${s.agreement.code} · PaprikaTradeAgreement` : "Acuerdo por crear"} subtitle={on?.exists ? `${on.amountEth} ETH de prueba ≙ S/ ${on.referencePen} · plazo ${dateTime(on.deadline)} · ${agreementNote(on)}` : "El motor lo crea al confirmarse el pedido"} icon={<ShieldCheck className="h-5 w-5" />}
            actions={<>{s.agreement && <StatusBadge status={s.agreement.status} />}<Link href={`/comex/${s.id}`} className="text-xs font-semibold text-bluex hover:underline">Ver embarque →</Link></>} />
          <CardBody><FlowPipeline s={s} /></CardBody>
        </Card>
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <ShipMap status={s.status} progress={s.voyageProgress} vessel={s.vessel} code={s.code} milestones={s.milestones} height={500} />
          <div className="space-y-4">
            <Card><CardHeader title="Condiciones de liberación" subtitle="Verificadas por el contrato, no por la interfaz" />
              <CardBody className="space-y-2">{cond.length ? cond.map(([t, ok]) => <p key={t} className="flex items-center gap-2 text-sm">{ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-agro" /> : <XCircle className="h-4 w-4 shrink-0 text-muted" />}{t}</p>) : <p className="text-sm text-muted">Sin acuerdo on-chain todavía.</p>}
                {on?.exists && <KeyValue cols={2} items={[["Vendedor", <code key="s" className="text-[11px]">{short(on.seller, 8)}</code>], ["Comprador", <code key="b" className="text-[11px]">{short(on.buyer, 8)}</code>], ["Hash COA", <code key="c" className="text-[11px]">{short(on.qualityCertHash, 10)}</code>], ["Evidencia de entrega", <code key="e" className="text-[11px]">{short(on.deliveryEvidenceHash, 10)}</code>], ["Saldo del contrato", `${on.contractBalanceEth} ETH`], ["Estado on-chain", on.state]]} />}
              </CardBody></Card>
            <Card><CardHeader title="Línea de tiempo verificable" subtitle="PaprikaTraceability.getMilestones (hash por etapa)" />
              <CardBody className="space-y-1.5">{s.milestones.length ? s.milestones.map((m: any) => <div key={m.stage} className="flex items-center gap-2 text-xs"><Link2 className="h-3.5 w-3.5 text-agro" /><b className="w-24">{m.stage}</b><code className="text-muted">{short(m.docHash, 10)}</code><span className="ml-auto text-muted">{dateTime(m.timestamp)}</span></div>) : <p className="text-sm text-muted">Sin hitos registrados.</p>}
                {s.lot && <a href={`/trazabilidad/${s.lot.code}`} target="_blank" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-bluex hover:underline"><ExternalLink className="h-3.5 w-3.5" />Verificar hashes (consulta pública del QR)</a>}
              </CardBody></Card>
          </div>
        </div>
        <Card><CardHeader title="Historial de eventos" subtitle="Cada evento indica si está respaldado por una transacción confirmada o si es una actualización del ERP" /><CardBody className="max-h-[420px] overflow-y-auto"><EventLog events={s.events} /></CardBody></Card>
      </>}
      {a && <FormDialog open={cfg} onClose={() => setCfg(false)} title="Motor de automatización" subtitle="Valores de demostración: en producción el viaje dura días y la confirmación la hace el comprador" successMessage="Automatización actualizada"
        initial={{ enabled: String(a.enabled), voyageSeconds: a.voyageSeconds, simulateBuyerConfirm: String(a.simulateBuyerConfirm), buyerConfirmDelaySeconds: a.buyerConfirmDelaySeconds, autoTestFunds: String(a.autoTestFunds) }}
        fields={[{ name: "enabled", label: "Motor activo", type: "select", options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] }, { name: "voyageSeconds", label: "Duración del viaje en la demo (s)", type: "number", min: 10 }, { name: "simulateBuyerConfirm", label: "Confirmación automática del comprador (billetera demo)", type: "select", options: [{ value: "true", label: "Sí (demo)" }, { value: "false", label: "No: solo el comprador desde el portal" }] }, { name: "buyerConfirmDelaySeconds", label: "Espera antes de confirmar (s)", type: "number", min: 0 }, { name: "autoTestFunds", label: "Depositar fondos de prueba sin esperar pago real", type: "select", options: [{ value: "true", label: "Sí (demo)" }, { value: "false", label: "No: esperar el pago aprobado" }] }]}
        onSubmit={async (v) => { await api("/trade/automation", { method: "PUT", body: { enabled: v.enabled === "true", voyageSeconds: Number(v.voyageSeconds), simulateBuyerConfirm: v.simulateBuyerConfirm === "true", buyerConfirmDelaySeconds: Number(v.buyerConfirmDelaySeconds), autoTestFunds: v.autoTestFunds === "true" } }); params.reload(); toast.info("Reinicie la API para cambiar el intervalo del ciclo"); }} />}
    </div>
  );
}
