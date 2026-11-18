"use client";
/** Pipeline visual del smart contract automatizado y bitácora de eventos (ERP + portal). */
import * as React from "react";
import { CheckCircle2, Circle, Loader2, Link2, ShieldCheck, Lock, Ship, FileCheck2, Wallet, PackageCheck, BadgeCheck, Handshake, FilePlus2, Landmark, XCircle } from "lucide-react";
import { cn, dateTime, short } from "@/lib/utils";

export const FLOW = [
  { key: "create", label: "Acuerdo creado", who: "Don Pimentón", icon: FilePlus2 },
  { key: "accept", label: "Aceptado", who: "Comprador", icon: Handshake },
  { key: "deposit", label: "Fondos en custodia", who: "Comprador", icon: Wallet },
  { key: "quality", label: "Calidad on-chain", who: "Supervisor de Calidad", icon: BadgeCheck },
  { key: "docs", label: "Documentos R2/R3", who: "Logística", icon: FileCheck2 },
  { key: "dispatch", label: "Despacho y DAM", who: "Agente de aduana", icon: Ship },
  { key: "delivery", label: "Entrega registrada", who: "Logística", icon: PackageCheck },
  { key: "confirm", label: "Recepción confirmada", who: "Comprador", icon: ShieldCheck },
  { key: "release", label: "Pago liberado", who: "Smart contract", icon: Landmark },
] as const;

/** Estado de cada paso a partir del embarque y de la lectura on-chain. */
export function flowState(s: any) {
  const on = s?.onchain;
  const st = on?.state as string | undefined;
  const ok: Record<string, boolean> = {
    create: !!on?.exists, accept: !!st && st !== "PROPUESTO", deposit: ["FONDEADO", "EJECUTADO", "EN_DISPUTA"].includes(st ?? "") || Number(on?.depositedEth ?? 0) > 0,
    quality: on?.quality === "APROBADA", docs: s?.docsStatus === "APROBADO", dispatch: !!s?.shipDate,
    delivery: ["ENTREGADA", "CONFIRMADA"].includes(on?.delivery ?? ""), confirm: on?.delivery === "CONFIRMADA", release: st === "EJECUTADO",
  };
  const blocked = on?.quality === "RECHAZADA" || ["CANCELADO", "REEMBOLSADO"].includes(st ?? "");
  const current = FLOW.find((f) => !ok[f.key])?.key ?? null;
  return { ok, current, blocked, disputed: st === "EN_DISPUTA" };
}

export function FlowPipeline({ s, compact }: { s: any; compact?: boolean }) {
  const { ok, current, blocked, disputed } = flowState(s);
  return (
    <div className="overflow-x-auto pb-1">
      <div className={cn("flex min-w-[860px] items-stretch gap-0", compact && "min-w-[720px]")}>
        {FLOW.map((f, i) => {
          const done = ok[f.key];
          const active = current === f.key && !blocked;
          const Icon = f.icon;
          return (
            <React.Fragment key={f.key}>
              <div className={cn("flex w-[104px] shrink-0 flex-col items-center gap-1.5 text-center", compact && "w-[84px]")}>
                <div className={cn("relative flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all",
                  done ? "border-agro bg-agro text-white" : active ? "border-gold bg-gold-50 text-amberx" : blocked && current === f.key ? "border-paprika bg-paprika-50 text-paprika" : "border-line bg-card text-muted")}>
                  {active && <span className="absolute inset-0 animate-ping rounded-full border-2 border-gold/60" />}
                  {blocked && current === f.key ? <Lock className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <b className={cn("text-[11.5px] leading-tight", done ? "text-fg" : "text-muted")}>{f.label}</b>
                {!compact && <small className="text-[10px] text-muted">{f.who}</small>}
              </div>
              {i < FLOW.length - 1 && (
                <div className="mt-[21px] h-1 flex-1 overflow-hidden rounded-full bg-line">
                  <div className={cn("h-full", ok[FLOW[i + 1].key] || done && ok[f.key] && ok[FLOW[i + 1].key] ? "bg-agro" : done ? "dp-flow" : "")} style={{ width: done ? "100%" : "0%" }} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {blocked && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-paprika"><XCircle className="h-4 w-4" />Pago bloqueado por el contrato (calidad rechazada o acuerdo cancelado/reembolsado). Los fondos no quedan atrapados: se reembolsan al comprador.</p>}
      {disputed && <p className="mt-2 text-xs font-semibold text-orange-700">Acuerdo en disputa: el árbitro (Gerencia) resuelve; nunca puede pagar al vendedor sin calidad aprobada.</p>}
    </div>
  );
}

export function EventLog({ events, max = 40 }: { events: any[]; max?: number }) {
  if (!events?.length) return <p className="text-sm text-muted">Sin eventos todavía.</p>;
  return (
    <ol className="relative space-y-2.5 border-l-2 border-line pl-4">
      {events.slice(0, max).map((e) => (
        <li key={e.id} className="relative">
          <span className={cn("absolute -left-[23px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-card", e.level === "success" ? "bg-agro" : e.level === "danger" ? "bg-paprika" : e.level === "warning" ? "bg-amberx" : "bg-bluex")} />
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{dateTime(e.createdAt)}</span><span className="rounded bg-soft px-1.5 py-0.5 font-bold text-fg/80">{e.rule}</span>
            {e.txHash ? <span className="inline-flex items-center gap-1 font-semibold text-agro"><Link2 className="h-3 w-3" />tx {short(e.txHash, 10)} · confirmada on-chain</span> : <span className="text-muted">actualización del ERP</span>}
          </div>
          <p className="text-[13px] text-fg">{e.message}</p>
        </li>
      ))}
    </ol>
  );
}

export function Spin() { return <Loader2 className="h-4 w-4 animate-spin" />; }
export { CheckCircle2, Circle };
