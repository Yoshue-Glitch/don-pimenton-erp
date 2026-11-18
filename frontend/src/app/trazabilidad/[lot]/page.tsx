"use client";
/** Consulta pública del QR de trazabilidad: historia de origen verificable contra la blockchain local. */
import * as React from "react";
import { useParams } from "next/navigation";
import { MapPin, Sprout, Factory, FlaskConical, Package, Boxes, Ship, CheckCircle2, XCircle, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { date, dateTime, short, cn } from "@/lib/utils";
import { Card, CardBody, Badge, Notice, StatusBadge } from "@/components/ui";
import { PepperLogo } from "@/components/Shell";
import { ShipMap } from "@/components/ShipMap";

const STAGES: [string, string, any][] = [["PARCELA", "Parcela", MapPin], ["COSECHA", "Cosecha", Sprout], ["PRODUCCION", "Producción", Factory], ["CALIDAD", "Calidad (COA)", FlaskConical], ["ENVASADO", "Envasado", Package], ["PALETA", "Paleta (SSCC)", Boxes], ["EMBARQUE", "Embarque", Ship], ["ENTREGA", "Entrega", CheckCircle2]];

export default function TracePage() {
  const { lot } = useParams<{ lot: string }>();
  const [d, setD] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { api(`/public/trace/${encodeURIComponent(lot)}`).then(setD).catch((e) => setErr(e.message)); }, [lot]);
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-card px-5 py-3"><PepperLogo className="h-10 w-[34px]" /><div><b className="font-display text-xl text-forest">Don Pimentón</b><p className="text-[10px] font-bold tracking-[.16em] text-paprika">HISTORIA DE ORIGEN · ORIGIN STORY</p></div></header>
      <main className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
        {err && <Notice tone="red">{err}</Notice>}
        {d && <>
          <div><p className="text-[11px] font-bold uppercase tracking-[.14em] text-paprika">Lote · Lot</p><h1 className="text-3xl font-extrabold">{d.lot}</h1><p className="text-muted">{d.product} · producido {date(d.productionDate)} · Best by {date(d.bestBy)}</p><div className="mt-2 flex flex-wrap gap-2"><StatusBadge status={d.quality} label={`Calidad: ${d.quality}`} />{d.onchain?.exists ? <Badge tone="green"><Link2 className="h-3 w-3" />Registrado en blockchain</Badge> : <Badge tone="slate">No registrado en blockchain</Badge>}</div></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><CardBody><p className="text-xs text-muted">Origen</p><b>{d.origin ? `${d.origin.parcel} · ${d.origin.location}` : "—"}</b><p className="text-xs text-muted">{d.origin ? `${d.origin.areaHa} ha · ${d.origin.crop}` : ""}</p></CardBody></Card>
            <Card><CardBody><p className="text-xs text-muted">Cosecha</p><b>{d.harvest?.code ?? "—"}</b><p className="text-xs text-muted">{date(d.harvest?.date)}</p></CardBody></Card>
            <Card><CardBody><p className="text-xs text-muted">COA (laboratorio)</p><b>{d.coa?.code ?? "—"}</b><p className="text-xs text-muted">{d.coa ? `${d.coa.laboratory} · ${date(d.coa.approvedAt)}` : ""}</p></CardBody></Card>
            <Card><CardBody><p className="text-xs text-muted">Embarque</p><b>{d.shipment?.code ?? "—"}</b><p className="text-xs text-muted">{d.shipment ? `${d.shipment.status} · ${d.shipment.destinationPort}` : ""}</p></CardBody></Card>
          </div>
          {d.shipment && <ShipMap status={d.shipment.status} progress={d.shipment.voyageProgress} vessel={d.shipment.vessel} code={d.shipment.code} milestones={d.milestones} height={380} />}
          <Card><CardBody>
            <p className="mb-3 font-bold">Línea de tiempo verificable · PaprikaTraceability</p>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {STAGES.map(([k, label, I]) => { const m = d.milestones.find((x: any) => x.stage === k); const v = d.verification.find((x: any) => x.stage === k); return (
                <li key={k} className={cn("rounded-xl border p-3", m ? "border-agro/40 bg-agro-50/50" : "border-line opacity-60")}>
                  <div className="flex items-center gap-2"><I className="h-4 w-4 text-paprika" /><b className="text-sm">{label}</b>{v && (v.matches ? <CheckCircle2 className="ml-auto h-4 w-4 text-agro" /> : v.matches === false ? <XCircle className="ml-auto h-4 w-4 text-paprika" /> : null)}</div>
                  {m ? <><code className="mt-1 block text-[10.5px] text-muted">{short(m.docHash, 12)}</code><p className="text-[10.5px] text-muted">{dateTime(m.timestamp)}</p>{v && <p className={cn("text-[10.5px] font-bold", v.matches ? "text-agro" : "text-paprika")}>{v.matches ? "Hash coincide con el ERP" : v.matches === false ? "¡Los datos cambiaron!" : ""}</p>}</> : <p className="text-[11px] text-muted">Pendiente</p>}
                </li>); })}
            </ol>
            {d.coa?.hash && <p className="mt-3 text-xs text-muted">Hash del COA (SHA-256): <code>{d.coa.hash}</code></p>}
          </CardBody></Card>
          <Notice>{d.note}</Notice>
        </>}
      </main>
    </div>
  );
}
