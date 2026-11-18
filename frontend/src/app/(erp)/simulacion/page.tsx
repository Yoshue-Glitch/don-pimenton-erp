"use client";
import * as React from "react";
import Link from "next/link";
import { Rocket, Play, FastForward, RotateCcw, Download, CheckCircle2, XCircle, Circle, Link2, Loader2 } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, short } from "@/lib/utils";
import { Card, CardHeader, CardBody, Button, Badge, Notice } from "@/components/ui";
import { useToast, Can } from "@/components/providers";
import { ShipMap } from "@/components/ShipMap";
import { FlowPipeline } from "@/components/ExportFlow";

export default function Simulacion() {
  const { data, reload, setData } = useApi<any>("/export-demo/sim");
  const toast = useToast();
  const [running, setRunning] = React.useState(false);
  const stop = React.useRef(false);
  const [ship, setShip] = React.useState<any>(null);
  const [anim, setAnim] = React.useState(0);
  const run = data?.run;
  const results: any[] = run?.results ?? [];
  const okCount = results.filter((r) => r.status === "OK").length;
  const shipmentId = run?.ctx?.shipmentId;
  React.useEffect(() => {
    if (!shipmentId) { setShip(null); return; }
    const load = () => api(`/trade/shipments/${shipmentId}`).then(setShip).catch(() => {});
    load(); const t = setInterval(load, 3000); return () => clearInterval(t);
  }, [shipmentId, okCount]);
  // animación del viaje entre el paso 17 (zarpe) y el 18 (arribo)
  React.useEffect(() => {
    if (okCount !== 17) { setAnim(okCount >= 18 ? 1 : 0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setAnim(Math.min(0.97, (Date.now() - t0) / 14000)), 100);
    return () => clearInterval(id);
  }, [okCount]);

  const start = async () => { const r = await api("/export-demo/sim/start", { body: {} }); setData(r); toast.success("Simulación iniciada", "Escenario: Importador Demo USA · 1 paleta FCA · 2,304 frascos"); };
  const next = async () => {
    const r = await api<any>("/export-demo/sim/next", { body: {} });
    setData(r);
    if (r.last?.status === "ERROR") { toast.error(`Paso ${r.last.step}`, r.last.summary); return false; }
    return r.run.status !== "COMPLETADA";
  };
  const runAll = async () => {
    setRunning(true); stop.current = false;
    try {
      let more = true;
      while (more && !stop.current) {
        more = await next();
        const n = (await api<any>("/export-demo/sim")).run.results.filter((x: any) => x.status === "OK").length;
        await new Promise((r) => setTimeout(r, n === 17 ? 14500 : 900)); // pausa para ver navegar el barco
      }
    } catch (e: any) { toast.error("Simulación", e.message); } finally { setRunning(false); reload(); }
  };
  const steps: string[] = data?.steps ?? [];
  const status = okCount >= 18 ? "ENTREGADO" : okCount === 17 ? "EN_TRANSITO" : okCount >= 14 ? "CONFIRMADO" : "PEDIDO";
  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_85%_20%,rgba(165,42,42,.6),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] px-6 py-9 text-white sm:px-10">
        <span className="text-[11px] font-bold uppercase tracking-[.26em] text-[#F2C9C0]">Demostración integral · sección 19 del encargo</span>
        <h1 className="mt-3 max-w-[22ch] font-display text-[clamp(28px,4vw,46px)] leading-tight">Simulación de exportación <i className="font-medium text-[#F2B8AC]">de la parcela al pago</i></h1>
        <p className="mt-3 max-w-2xl text-[15px] text-white/85">Don Pimentón → Importador Demo USA · páprika molida 113 g · Incoterm FCA · 1 paleta = 2,304 frascos = 96 cajas ≈ 260.4 kg. Cada paso usa los mismos servicios del ERP y del smart contract; los precios y costos son datos de prueba.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Can perm="demo.run">
            <button onClick={start} disabled={running} className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-extrabold text-forest shadow-xl transition hover:-translate-y-0.5 hover:bg-paprika-50 disabled:opacity-50"><Rocket className="h-5 w-5 text-paprika" />{run ? "Reiniciar (nueva corrida)" : "INICIAR SIMULACIÓN DE EXPORTACIÓN"}</button>
            {run && run.status === "EN_CURSO" && <>
              <Button variant="gold" size="lg" onClick={() => next().catch((e) => toast.error("Paso", e.message))} disabled={running}><Play className="h-4 w-4" />Siguiente paso ({okCount + 1}/20)</Button>
              {!running ? <Button variant="outline" size="lg" className="border-white/40 bg-white/10 text-white" onClick={runAll}><FastForward className="h-4 w-4" />Ejecutar todo</Button> : <Button variant="outline" size="lg" className="border-white/40 bg-white/10 text-white" onClick={() => { stop.current = true; }}><Loader2 className="h-4 w-4 animate-spin" />Pausar</Button>}
            </>}
          </Can>
          {run?.status === "COMPLETADA" && <Button variant="gold" size="lg" onClick={() => download("/export-demo/sim/report.pdf", `reporte-simulacion-${run.ctx.shipment}.pdf`)}><Download className="h-4 w-4" />Reporte PDF final</Button>}
        </div>
        {run && <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gold transition-all duration-700" style={{ width: `${(okCount / 20) * 100}%` }} /></div>}
      </section>
      {!run && <Notice tone="blue">La simulación es reiniciable y ejecutable varias veces: cada corrida crea una campaña, cosecha, lote, orden, pedido y acuerdo nuevos (códigos SIM-n) sin borrar los anteriores.</Notice>}
      {run && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader title={`Corrida ${run.id} · ${run.ctx.shipment ?? "pedido por crear"}`} subtitle={`${okCount} de 20 pasos completados`} actions={<Badge tone={run.status === "COMPLETADA" ? "green" : "blue"}>{run.status}</Badge>} />
            <CardBody className="max-h-[760px] space-y-2 overflow-y-auto">
              {steps.map((t, i) => {
                const r = results.find((x) => x.step === i + 1);
                const curr = !r && i === okCount;
                return (
                  <div key={t} className={cn("rounded-xl border p-3 transition", r?.status === "OK" ? "border-agro/30 bg-agro-50/50 dark:bg-agro/10" : r?.status === "ERROR" ? "border-paprika/40 bg-paprika-50" : curr ? "border-gold bg-gold-50" : "border-line")}>
                    <div className="flex items-center gap-2">
                      {r?.status === "OK" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-agro" /> : r?.status === "ERROR" ? <XCircle className="h-5 w-5 shrink-0 text-paprika" /> : curr && running ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amberx" /> : <Circle className="h-5 w-5 shrink-0 text-muted" />}
                      <b className="text-sm">{i + 1}. {t}</b>
                      {r && <Badge tone={r.mode === "ERP" ? "slate" : "green"} className="ml-auto">{r.mode}</Badge>}
                    </div>
                    {r && <p className="mt-1.5 pl-7 text-[12.5px] text-fg/85">{r.summary}</p>}
                    {r?.data?.pdf && <button onClick={() => download(r.data.pdf, `${r.data.harvest ?? "reporte"}.pdf`)} className="ml-7 mt-1 text-xs font-semibold text-bluex hover:underline">Descargar PDF</button>}
                    {!!r?.txs?.length && <div className="mt-2 space-y-1 pl-7">{r.txs.filter(Boolean).slice(0, 12).map((x: any, j: number) => <p key={j} className="flex flex-wrap items-center gap-1.5 text-[11px]"><Link2 className="h-3 w-3 text-agro" /><b>{x.fn}</b><span className="text-muted">({x.actor})</span><Badge tone={x.status === "CONFIRMADA" ? "green" : "red"}>{x.status}</Badge><span className="font-mono text-muted">{short(x.hash, 12)}</span>{x.block && <span className="text-muted">bloque {x.block}</span>}</p>)}</div>}
                  </div>
                );
              })}
            </CardBody>
          </Card>
          <div className="space-y-4">
            <ShipMap status={status} progress={anim} vessel={ship?.vessel ?? "MSC DEMO EXPRESS"} code={run.ctx.shipment} milestones={ship?.milestones ?? []} height={500} />
            {ship && <Card><CardHeader title="Smart contract del embarque" subtitle={ship.agreement?.code ?? "Se crea en el paso 15"} /><CardBody><FlowPipeline s={ship} compact /></CardBody></Card>}
            {run.status === "COMPLETADA" && <Notice tone="green">Exportación completada. Revise el resultado en el <Link className="font-bold underline" href="/">Dashboard</Link>, <Link className="font-bold underline" href="/kpi">KPI</Link>, <Link className="font-bold underline" href={`/comex/${shipmentId}`}>detalle del embarque</Link> y el <Link className="font-bold underline" href="/blockchain">explorador blockchain</Link>.</Notice>}
          </div>
        </div>
      )}
    </div>
  );
}
