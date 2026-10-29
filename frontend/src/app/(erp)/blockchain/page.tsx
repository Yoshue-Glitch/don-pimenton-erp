"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, RefreshCw, Rocket, ShieldCheck, ShieldAlert, Server, Wallet, PlayCircle, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, dateTime, short, num } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Tabs, Badge, Kpi, Notice, Mono, Input, ErrorBox, KeyValue, ConfirmDialog, Loading } from "@/components/ui";
import { ServerTable, LocalTable } from "@/components/DataTable";
import { Can, useToast } from "@/components/providers";

export default function BlockchainPanel() {
  const [tab, setTab] = React.useState<"acuerdos" | "tx" | "eventos" | "verificar" | "red">("acuerdos");
  const [rk, setRk] = React.useState(0);
  const st = useApi<any>("/blockchain/status", [rk]);
  const ag = useApi<any[]>("/blockchain/agreements", [rk]);
  const router = useRouter();
  const toast = useToast();
  const [deploy, setDeploy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const s = st.data;
  const c = s?.agreementCounts ?? {};
  const sync = async () => { setBusy(true); try { const r = await api("/blockchain/sync-events", { method: "POST" }); toast.success("Eventos sincronizados", `${r.synced} eventos leídos de la red local`); setRk((k) => k + 1); } catch (e: any) { toast.error("Error", e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <PageHeader area="Exportaciones · Blockchain" title="Panel blockchain y Smart Contracts" subtitle="Trazabilidad verificable de lotes y pagos condicionados en una red Ethereum LOCAL (Hardhat)" icon={<Link2 className="h-5 w-5" />}
        actions={<><Link href="/demo"><Button variant="secondary"><PlayCircle className="h-4 w-4" />Ejecutar demostración</Button></Link><Button variant="outline" loading={busy} onClick={sync}><RefreshCw className="h-4 w-4" />Sincronizar eventos</Button><Can perm={["blockchain.write", "demo.run"]}><Button variant="outline" onClick={() => setDeploy(true)}><Rocket className="h-4 w-4" />Desplegar contratos</Button></Can></>} />
      {st.loading && !s ? <Loading /> : s && (
        <>
          <Card className={s.connected ? "" : "border-red-300"}>
            <CardBody className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-2"><Server className={s.connected ? "h-5 w-5 text-emerald-600" : "h-5 w-5 text-red-600"} /><div><p className="text-sm font-semibold">{s.connected ? "Red local conectada" : "Red local NO disponible"}</p><p className="text-xs text-muted">{s.rpcUrl} · chainId {s.chainId ?? "—"} · bloque #{s.blockNumber ?? "—"}</p></div></div>
              {s.contracts.map((x: any) => <div key={x.name}><p className="text-xs text-muted">{x.name}</p><p className="flex items-center gap-1.5 text-sm">{x.address ? <Mono>{x.address}</Mono> : "No desplegado"}{x.deployed ? <Badge tone="green">código verificado</Badge> : <Badge tone="red">sin código</Badge>}</p></div>)}
            </CardBody>
            {!s.connected && <CardBody className="pt-0"><ErrorBox message={s.error ?? "Inicie la red local: cd blockchain && npm run node"} /></CardBody>}
          </Card>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Contratos creados" value={Object.values(c).reduce((a: number, b: any) => a + b, 0) as number} />
            <Kpi label="Pendientes" value={(c.PROPUESTO ?? 0) + (c.ACEPTADO ?? 0) + (c.BORRADOR ?? 0)} tone="gold" />
            <Kpi label="Activos (fondeados)" value={(c.FONDEADO ?? 0) + (c.EN_DISPUTA ?? 0)} tone="agro" />
            <Kpi label="Ejecutados" value={c.EJECUTADO ?? 0} tone="agro" />
            <Kpi label="Cancelados / reembolsados" value={(c.CANCELADO ?? 0) + (c.REEMBOLSADO ?? 0)} tone="red" />
            <Kpi label="Tx confirmadas" value={s.txCounts.CONFIRMADA ?? 0} tone="agro" />
            <Kpi label="Tx fallidas / rechazadas" value={s.txCounts.FALLIDA ?? 0} tone="red" />
          </div>
        </>
      )}
      <Notice tone="blue">Las operaciones se firman con cuentas deterministas de Hardhat custodiadas por el ERP <b>solo para la demostración local</b>. Se usa moneda nativa FICTICIA (ETH de prueba sin valor); los importes en soles son referencia empresarial y no representan transferencias bancarias. Las transacciones se muestran como exitosas únicamente después de su confirmación en un bloque. Las rechazadas por el contrato antes de minarse no tienen hash.</Notice>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "acuerdos", label: "Acuerdos comerciales" }, { id: "tx", label: "Historial de transacciones" }, { id: "eventos", label: "Eventos blockchain" }, { id: "verificar", label: "Verificar lote" }, { id: "red", label: "Cuentas de la red local" }]} />
      <Card>
        {tab === "acuerdos" && <LocalTable rows={ag.data ?? []} onRowClick={(r: any) => router.push(`/blockchain/acuerdos/${r.code}`)} searchKeys={["code", "lot.code", "customer.name"]} columns={[
          { key: "code", header: "Acuerdo", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "lot", header: "Lote", render: (r: any) => r.lot.code }, { key: "c", header: "Comprador", render: (r: any) => r.customer.name },
          { key: "o", header: "Pedido", render: (r: any) => r.salesOrder?.code ?? "—" }, { key: "amt", header: "Importe de prueba", align: "right", render: (r: any) => `${num(Number(r.amountWei) / 1e18, 3)} ETH` }, { key: "pen", header: "Ref. S/", align: "right", render: (r: any) => money(r.referencePen) },
          { key: "q", header: "Calidad", render: (r: any) => <StatusBadge status={r.qualityState === "APROBADA" ? "APROBADO" : r.qualityState === "RECHAZADA" ? "RECHAZADO" : "PENDIENTE"} label={r.qualityState.toLowerCase()} /> },
          { key: "d", header: "Entrega", render: (r: any) => <StatusBadge status={r.deliveryState === "CONFIRMADA" ? "CONFIRMADA" : r.deliveryState === "ENTREGADA" ? "ENTREGADO" : "PENDIENTE"} label={r.deliveryState.toLowerCase()} /> },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "addr", header: "Contrato", render: (r: any) => r.contractAddress ? <Mono>{short(r.contractAddress, 8)}</Mono> : "—", hideOnMobile: true },
        ]} />}
        {tab === "tx" && <ServerTable path="/blockchain/transactions" reloadKey={rk} filters={[{ key: "status", label: "Estado", options: ["CONFIRMADA", "FALLIDA", "PENDIENTE"].map((v) => ({ value: v, label: v })) }]} columns={[
          { key: "id", header: "#" }, { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "c", header: "Contrato", render: (r: any) => <span className="text-xs">{r.contractName.replace("Paprika", "")}</span> },
          { key: "fn", header: "Función", render: (r: any) => <Mono>{r.functionName}</Mono> }, { key: "actor", header: "Actor", render: (r: any) => <Badge tone={r.actor === "intruder" ? "red" : "slate"}>{r.actor}</Badge> },
          { key: "e", header: "Entidad", render: (r: any) => r.entityCode ?? "—" }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "b", header: "Bloque", align: "right", render: (r: any) => r.blockNumber ?? "—" }, { key: "h", header: "Hash / motivo", render: (r: any) => r.txHash ? <Mono>{short(r.txHash, 12)}</Mono> : <span className="text-xs text-red-600">{r.errorMessage}</span> },
          { key: "ev", header: "Eventos", render: (r: any) => <span className="text-xs">{r.events.map((e: any) => e.eventName).join(", ") || "—"}</span>, hideOnMobile: true },
          { key: "sc", header: "Escenario", render: (r: any) => r.scenario ? <Badge tone="gold">{r.scenario}</Badge> : "—", hideOnMobile: true },
        ]} />}
        {tab === "eventos" && <ServerTable path="/blockchain/events" reloadKey={rk} searchable={false} columns={[
          { key: "b", header: "Bloque", render: (r: any) => r.blockNumber }, { key: "c", header: "Contrato", render: (r: any) => <span className="text-xs">{r.contractName}</span> }, { key: "n", header: "Evento", render: (r: any) => <Badge tone="paprika">{r.eventName}</Badge> },
          { key: "args", header: "Datos", render: (r: any) => <span className="break-all font-mono text-[10px] text-muted">{Object.entries(r.args).filter(([k]) => !["key", "lotKey"].includes(k)).map(([k, v]) => `${k}=${String(v).length > 20 ? short(String(v), 8) : v}`).join(" · ")}</span> },
          { key: "h", header: "Tx", render: (r: any) => <Mono>{short(r.txHash, 8)}</Mono> },
        ]} />}
        {tab === "verificar" && <VerifyLot />}
        {tab === "red" && s && <LocalTable rows={s.actors.map((a: any) => ({ ...a, id: a.actor }))} columns={[{ key: "actor", header: "Rol on-chain", render: (r: any) => <Badge tone={r.actor === "intruder" ? "red" : "paprika"}>{r.actor}</Badge> }, { key: "label", header: "Representa" }, { key: "address", header: "Dirección", render: (r: any) => <Mono>{r.address}</Mono> }, { key: "b", header: "Saldo (ETH de prueba)", align: "right", render: (r: any) => <span className="flex items-center justify-end gap-1"><Wallet className="h-3.5 w-3.5 text-muted" />{num(r.balanceEth, 4)}</span> }]} />}
      </Card>
      <ConfirmDialog open={deploy} onClose={() => setDeploy(false)} title="Desplegar nuevos contratos" loading={busy} confirmText="Desplegar"
        message={<p>Se desplegarán nuevas instancias de <b>PaprikaTraceability</b> y <b>PaprikaTradeAgreement</b> en la red local y el ERP pasará a usarlas. Úselo si reinició Hardhat. Los registros anteriores permanecen en sus contratos originales.</p>}
        onConfirm={async () => { setBusy(true); try { await api("/blockchain/deploy", { method: "POST" }); toast.success("Contratos desplegados"); setRk((k) => k + 1); setDeploy(false); } catch (e: any) { toast.error("Error", e.message); } finally { setBusy(false); } }} />
    </div>
  );
}

function VerifyLot() {
  const [code, setCode] = React.useState("DP-2026-001");
  const [res, setRes] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const go = async () => { setBusy(true); setErr(null); setRes(null); try { setRes(await api(`/blockchain/lots/${encodeURIComponent(code)}/verify`)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const ok = res?.registered && res.dataMatches && res.certMatches;
  return (
    <CardBody className="space-y-4">
      <p className="text-sm text-muted">El ERP recalcula el SHA-256 de los datos del lote desde PostgreSQL y lo compara con el hash registrado en <b>PaprikaTraceability</b>. Cualquier alteración posterior en la base de datos se detecta.</p>
      <div className="flex max-w-md gap-2"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DP-2026-001" /><Button loading={busy} onClick={go}><Search className="h-4 w-4" />Verificar</Button></div>
      {err && <ErrorBox message={err} />}
      {res && (
        <div className={`rounded-xl border p-4 ${ok ? "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-red-300 bg-red-50/50 dark:bg-red-950/20"}`}>
          <p className="mb-3 flex items-center gap-2 font-semibold">{ok ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldAlert className="h-5 w-5 text-red-600" />}{res.verdict ?? res.message}</p>
          {res.registered && <KeyValue items={[["Hash recalculado (ERP)", <Mono key="a">{res.recomputedDataHash}</Mono>], ["Hash on-chain", <Mono key="b">{res.onchain.lotDataHash}</Mono>], ["Certificado ERP", <Mono key="c">{res.erpCertHash}</Mono>], ["Certificado on-chain", <Mono key="d">{res.onchain.qualityCertHash}</Mono>], ["Calidad on-chain", <StatusBadge key="e" status={res.onchain.quality} />], ["Registrado por", <Mono key="f">{res.onchain.registeredBy}</Mono>], ["Fecha", dateTime(res.onchain.registeredAt)], ["Versión", res.onchain.version]]} />}
        </div>
      )}
    </CardBody>
  );
}
