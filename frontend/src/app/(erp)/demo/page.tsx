"use client";
import * as React from "react";
import Link from "next/link";
import { PlayCircle, Play, FastForward, RotateCcw, Check, X, Loader2, Circle, FileDown, ShieldX, Truck, UserX, Database, Link2 } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, short, dateTime } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, Button, Badge, Notice, ConfirmDialog, Loading, Mono, StatusBadge } from "@/components/ui";
import { Can, useAuth, useToast } from "@/components/providers";

const NEG = [
  { id: "rechazado", title: "Lote rechazado", desc: "El ERP no permite vender el lote y el contrato bloquea el pago; el comprador recupera sus fondos.", icon: ShieldX },
  { id: "entrega-no-confirmada", title: "Entrega no confirmada", desc: "Con fondos depositados y calidad aprobada, el pago queda retenido sin la confirmación del comprador.", icon: Truck },
  { id: "no-autorizado", title: "Usuario no autorizado", desc: "Una billetera sin rol intenta registrar calidad, entrega, liberar el pago o registrar un lote falso.", icon: UserX },
];

export default function Demo() {
  const { data, loading, reload } = useApi<any>("/demo");
  const { can } = useAuth();
  const toast = useToast();
  const [running, setRunning] = React.useState<number | null>(null);
  const [auto, setAuto] = React.useState(false);
  const [neg, setNeg] = React.useState<Record<string, any>>({});
  const [negBusy, setNegBusy] = React.useState<string | null>(null);
  const [reset, setReset] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const stop = React.useRef(false);
  if (loading && !data) return <Loading />;
  const results: any[] = data.run?.status === "REINICIADA" ? [] : data.run?.steps ?? [];
  const byStep = Object.fromEntries(results.map((r) => [r.step, r]));
  const next = data.steps.findIndex((_: string, i: number) => byStep[i + 1]?.status !== "OK") + 1;
  const allDone = next === 0;

  const runStep = async (n: number) => {
    setRunning(n);
    try {
      const r = await api(`/demo/step/${n}`, { method: "POST" });
      if (r.status === "OK") toast.success(`Paso ${n} completado`, r.title); else { toast.error(`Paso ${n} con error`, r.summary); stop.current = true; }
    } catch (e: any) { toast.error(`Paso ${n} con error`, e.body?.summary ?? e.message); stop.current = true; }
    await reload();
    setRunning(null);
  };
  const runAll = async () => {
    setAuto(true); stop.current = false;
    for (let n = next; n >= 1 && n <= data.steps.length && !stop.current; n++) await runStep(n);
    setAuto(false);
  };
  const runNeg = async (id: string) => {
    setNegBusy(id);
    try { const r = await api(`/demo/negative/${id}`, { method: "POST" }); setNeg((x) => ({ ...x, [id]: r })); r.allBlocked ? toast.success("Escenario negativo verificado", r.title) : toast.error("Resultado inesperado", r.error ?? r.title); }
    catch (e: any) { setNeg((x) => ({ ...x, [id]: e.body ?? { error: e.message } })); toast.error("Error en el escenario", e.message); }
    finally { setNegBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader area="Sistema" title="Demostración guiada" subtitle="Escenario integral: venta de páprika de Don Pimentón a Distribuidora Andina Demo (lote DP-2026-001)" icon={<PlayCircle className="h-5 w-5" />}
        actions={<Can perm="demo.run"><Button variant="outline" onClick={() => setReset(true)}><RotateCcw className="h-4 w-4" />Reiniciar demostración</Button></Can>} />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Materia prima", "1,000 kg"], ["Producto final", "200 kg = 8 sacos de 25 kg"], ["Precio de prueba", "S/ 15 por kg"], ["Valor total", "S/ 3,000 (IGV incluido)"]].map(([k, v]) => <Card key={k} className="p-4"><p className="text-xs text-muted">{k}</p><p className="mt-1 font-semibold">{v}</p></Card>)}
      </div>
      <Notice>Cada paso ejecuta los mismos servicios que usan los módulos del ERP (no hay atajos) y es idempotente: re-ejecutarlo no duplica registros. Los pasos marcados <Badge tone="paprika">BLOCKCHAIN</Badge> envían transacciones reales a la red local Hardhat y solo se muestran como exitosos tras su confirmación. Los valores productivos son ficticios.</Notice>
      {!can("demo.run") && <Notice tone="red">Su rol puede consultar la demostración pero no ejecutarla (permiso demo.run).</Notice>}

      <Card>
        <CardHeader title="Secuencia del escenario integral" subtitle={allDone ? "Escenario completado" : `Siguiente paso: ${next}. ${data.steps[next - 1]}`}
          actions={<Can perm="demo.run">
            {!allDone && <Button variant="outline" disabled={running !== null} onClick={() => runStep(next)}><Play className="h-4 w-4" />Ejecutar paso {next}</Button>}
            {!allDone && <Button disabled={running !== null} loading={auto} onClick={runAll}><FastForward className="h-4 w-4" />Ejecutar demostración completa</Button>}
            {auto && <Button variant="ghost" onClick={() => { stop.current = true; }}>Detener</Button>}
          </Can>} />
        <ol className="divide-y divide-line">
          {data.steps.map((title: string, i: number) => {
            const n = i + 1, r = byStep[n];
            const st = running === n ? "running" : r?.status === "OK" ? "ok" : r?.status === "ERROR" ? "error" : "todo";
            return (
              <li key={n} className={cn("flex gap-4 px-5 py-3.5", st === "running" && "bg-paprika-50/60 dark:bg-paprika/10")}>
                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold", st === "ok" ? "bg-agro text-white" : st === "error" ? "bg-red-600 text-white" : st === "running" ? "bg-paprika text-white" : "bg-soft text-muted")}>
                  {st === "ok" ? <Check className="h-4 w-4" /> : st === "error" ? <X className="h-4 w-4" /> : st === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : n}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-fg">{n}. {title}</p>
                    {r && <Badge tone={r.mode === "ERP" ? "slate" : "paprika"}>{r.mode === "ERP" ? <><Database className="h-3 w-3" />ERP</> : <><Link2 className="h-3 w-3" />{r.mode}</>}</Badge>}
                    {r?.at && <span className="text-[11px] text-muted">{dateTime(r.at)}</span>}
                  </div>
                  {r && <p className={cn("mt-0.5 text-sm", r.status === "ERROR" ? "text-red-600" : "text-fg/80")}>{r.summary}</p>}
                  {r?.txs?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-2">{r.txs.filter(Boolean).map((t: any) => <span key={t.id} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px]"><StatusBadge status={t.status} /><Mono>{t.fn}</Mono>{t.hash ? <>bloque #{t.block} · <Mono>{short(t.hash, 8)}</Mono></> : <span className="text-red-600">{t.error}</span>}</span>)}</div>}
                  {n === 18 && r?.status === "OK" && <Button size="sm" className="mt-2" onClick={() => download(r.data.url.replace("/api", ""), "trazabilidad-DP-2026-001.pdf").catch((e) => toast.error("Error", e.message))}><FileDown className="h-4 w-4" />Descargar reporte de trazabilidad (PDF)</Button>}
                  {n === 17 && r?.status === "OK" && <Link href="/blockchain" className="mt-1 inline-block text-xs text-paprika hover:underline">Ver en el panel blockchain →</Link>}
                  {n === 8 && r?.status === "OK" && <Link href="/inventario/lotes/DP-2026-001" className="mt-1 inline-block text-xs text-paprika hover:underline">Ver trazabilidad del lote →</Link>}
                </div>
                {can("demo.run") && st !== "running" && (st === "error" || n === next) && <Button size="sm" variant="ghost" disabled={running !== null} onClick={() => runStep(n)}>{st === "error" ? "Reintentar" : "Ejecutar"}</Button>}
                {st === "todo" && n !== next && <Circle className="h-4 w-4 text-line" />}
              </li>
            );
          })}
        </ol>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-bold">Escenarios negativos</h2>
        <div className="grid gap-4 xl:grid-cols-3">
          {NEG.map((s) => {
            const r = neg[s.id];
            const I = s.icon;
            return (
              <Card key={s.id} className="flex flex-col">
                <CardHeader title={s.title} icon={<I className="h-4 w-4" />} subtitle={s.desc} actions={<Can perm="demo.run"><Button size="sm" variant="outline" loading={negBusy === s.id} disabled={!!negBusy} onClick={() => runNeg(s.id)}>Ejecutar</Button></Can>} />
                <CardBody className="flex-1 space-y-2">
                  {!r ? <p className="text-xs text-muted">Sin ejecutar en esta sesión.</p> : r.error ? <p className="text-sm text-red-600">{r.error}</p> : <>
                    <div className="flex items-center gap-2">{r.allBlocked ? <Badge tone="green">Comportamiento esperado verificado</Badge> : <Badge tone="red">Resultado inesperado</Badge>}{r.onchain?.state && <Badge tone="slate">Estado on-chain: {r.onchain.state}</Badge>}</div>
                    {r.checks.map((c: any, i: number) => (
                      <div key={i} className="rounded-lg border border-line p-2 text-xs">
                        <div className="flex items-start gap-1.5"><Badge tone={c.layer === "ERP" ? "slate" : "paprika"}>{c.layer}</Badge><span className="font-medium text-fg">{c.action}</span></div>
                        <p className={cn("mt-1", c.blocked === (c.expectBlocked ?? true) ? "text-emerald-700 dark:text-emerald-300" : "text-red-600")}>{c.blocked ? "⛔ Bloqueado: " : "✔ Permitido: "}{c.message}</p>
                        {c.tx && <p className="mt-0.5 text-muted">tx {c.tx.status}{c.tx.hash ? ` · ${short(c.tx.hash, 8)}` : " · no minada (rechazada al estimar gas)"}</p>}
                      </div>
                    ))}
                  </>}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </div>
      <ConfirmDialog open={reset} onClose={() => setReset(false)} danger typeToConfirm="REINICIAR" title="Reiniciar demostración" loading={resetting} confirmText="Reiniciar"
        message={<div className="space-y-2"><p>Se restaurarán los <b>datos de demostración</b> iniciales (operaciones, inventarios, ventas, finanzas) y se desplegarán contratos nuevos en la red local para que los identificadores on-chain puedan reutilizarse sin duplicados.</p><p>Se conservan usuarios, roles, configuración y el registro de auditoría.</p></div>}
        onConfirm={async () => { setResetting(true); try { const r = await api("/demo/reset", { body: { confirm: "REINICIAR" } }); toast.success("Demostración reiniciada", r.chainError ? `Atención: ${r.chainError}` : "Contratos redesplegados"); setNeg({}); setReset(false); await reload(); } catch (e: any) { toast.error("Error", e.message); } finally { setResetting(false); } }} />
    </div>
  );
}
