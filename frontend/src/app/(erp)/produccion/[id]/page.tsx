"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, CircleDot, Circle, PackageCheck, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, date, dateTime, num, money, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, Kpi, Notice, Field, Input } from "@/components/ui";
import { FormDialog } from "@/components/FormDialog";
import { Can } from "@/components/providers";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: o, loading, error, reload } = useApi<any>(`/production/orders/${id}`);
  const [adv, setAdv] = React.useState(false);
  const [done, setDone] = React.useState(false);
  if (loading && !o) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const cur = o.stages.find((s: any) => s.stage === o.currentStage);
  const prevOut = (() => { const i = o.stages.findIndex((s: any) => s.stage === o.currentStage); return i > 0 ? o.stages[i - 1].outputKg : o.initialWeightKg; })();
  return (
    <div className="space-y-4">
      <Link href="/produccion" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Producción</Link>
      <PageHeader title={`Orden ${o.code}`} subtitle={`Lote origen ${o.sourceLot.code} · campaña ${o.sourceLot.campaign?.code ?? "—"} · responsable ${o.responsible.name}`}
        actions={<><StatusBadge status={o.status} />{o.status === "EN_PROCESO" && <Can perm="production.write">{o.currentStage !== "ALMACEN" ? <Button onClick={() => setAdv(true)}>Completar etapa: {o.stageLabels[o.currentStage]}<ChevronRight className="h-4 w-4" /></Button> : <Button variant="secondary" onClick={() => setDone(true)}><PackageCheck className="h-4 w-4" />Registrar producto terminado</Button>}</Can>}</>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Peso inicial" value={kg(o.initialWeightKg, 1)} />
        <Kpi label="Peso final" value={o.finalWeightKg ? kg(o.finalWeightKg, 1) : "—"} tone="agro" />
        <Kpi label="Merma" value={o.wasteKg ? kg(o.wasteKg, 1) : "—"} hint="inicial − final" tone="red" />
        <Kpi label="Rendimiento" value={o.yieldPct ? `${num(o.yieldPct, 2)} %` : "—"} hint="final / inicial × 100" tone="gold" />
        <Kpi label="Costo total" value={money(o.totalCost)} hint={o.finalWeightKg ? `${money(Number(o.totalCost) / Number(o.finalWeightKg))}/kg` : `MP: ${money(o.rawMaterialCost)}`} tone="ink" />
      </div>
      <Card>
        <CardHeader title="Etapas del proceso" />
        <CardBody>
          <ol className="relative grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            {o.stages.map((s: any) => {
              const state = s.completedAt ? "done" : s.startedAt ? "current" : "todo";
              return (
                <li key={s.id} className={cn("rounded-xl border p-3 text-xs", state === "done" ? "border-agro/30 bg-agro-50 dark:bg-agro/10" : state === "current" ? "border-paprika/40 bg-paprika-50 dark:bg-paprika/10" : "border-line")}>
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg">{state === "done" ? <Check className="h-4 w-4 text-agro" /> : state === "current" ? <CircleDot className="h-4 w-4 text-paprika" /> : <Circle className="h-4 w-4 text-muted" />}{s.seq}. {o.stageLabels[s.stage]}</div>
                  <p className="text-muted">{s.completedAt ? dateTime(s.completedAt) : s.startedAt ? "En curso" : "Pendiente"}</p>
                  {s.outputKg && <p className="mt-1 text-fg">{kg(s.inputKg ?? s.outputKg, 0)} → <b>{kg(s.outputKg, 0)}</b></p>}
                  {s.temperatureC && <p className="text-fg">{num(s.temperatureC, 0)} °C · {num(s.durationH, 0)} h</p>}
                  {s.notes && <p className="mt-1 text-muted">{s.notes}</p>}
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Datos de la orden" /><CardBody><KeyValue items={[["Inicio", dateTime(o.startDate)], ["Fin", dateTime(o.endDate)], ["Secado", o.dryingTempC ? `${num(o.dryingTempC, 1)} °C · ${num(o.dryingHours, 1)} h` : "—"], ["Costo MP", money(o.rawMaterialCost)], ["Mano de obra", money(o.laborCost)], ["Energía", money(o.energyCost)], ["Envases", money(o.packagingCost)], ["Otros", money(o.otherCost)], ["Observaciones", o.observations]]} /></CardBody></Card>
        <Card><CardHeader title="Lotes terminados generados" subtitle="Ingresan a cuarentena hasta su liberación por Calidad" /><CardBody className="space-y-2">
          {o.outputLots.length === 0 ? <p className="text-sm text-muted">Aún no se registró el producto terminado.</p> : o.outputLots.map((l: any) => (
            <Link key={l.id} href={`/inventario/lotes/${l.code}`} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 hover:bg-soft">
              <span className="font-semibold text-paprika">{l.code}</span><span className="text-sm">{kg(l.quantityKg)} {l.bags ? `· ${l.bags} sacos` : ""}</span><StatusBadge status={l.qualityStatus} />
            </Link>
          ))}
          <Notice>Los rendimientos y costos mostrados son valores de demostración y no representan un rendimiento productivo validado.</Notice>
        </CardBody></Card>
      </div>
      <FormDialog open={adv} onClose={() => { setAdv(false); reload(); }} title={`Completar etapa: ${o.stageLabels[o.currentStage]}`} subtitle={`Entrada de la etapa: ${kg(prevOut, 1)}`} initial={{ outputKg: Number(prevOut) }} successMessage="Etapa completada"
        fields={[
          { name: "outputKg", label: "Peso de salida (kg)", type: "number", required: true, min: 0, max: Number(prevOut), step: "any" },
          ...(o.currentStage === "DESHIDRATACION" ? [{ name: "temperatureC", label: "Temperatura de secado (°C)", type: "number" as const, required: true, min: 0, max: 200, step: "any" as const }, { name: "durationH", label: "Duración del secado (h)", type: "number" as const, required: true, min: 0, step: "any" as const }] : []),
          { name: "responsible", label: "Responsable" }, { name: "notes", label: "Observaciones", type: "textarea" },
        ]}
        onSubmit={(v) => api(`/production/orders/${id}/advance`, { body: v })} />
      <CompleteDialog open={done} onClose={() => { setDone(false); reload(); }} order={o} />
    </div>
  );
}

function CompleteDialog({ open, onClose, order }: { open: boolean; onClose: () => void; order: any }) {
  const envasado = order.stages.find((s: any) => s.stage === "ENVASADO")?.outputKg;
  return (
    <FormDialog open={open} onClose={onClose} title="Registrar producto terminado" subtitle="Calcula merma y rendimiento; permite dividir en varios lotes terminados" size="lg" successMessage="Producto terminado registrado en almacén (cuarentena)"
      initial={{ finalWeightKg: envasado ? Number(envasado) : "", splits: "", laborCost: 0, energyCost: 0, packagingCost: 0, otherCost: 0, expiryMonths: 18 }}
      fields={[
        { name: "finalWeightKg", label: "Peso final (kg)", type: "number", required: true, min: 0.1, max: Number(order.initialWeightKg), step: "any" },
        { name: "splits", label: "Dividir en lotes (kg separados por coma, opcional)", placeholder: "Ej.: 100, 100", hint: "La suma debe igualar el peso final. Vacío = un solo lote." },
        { name: "laborCost", label: "Mano de obra (S/)", type: "number", min: 0, step: "any" }, { name: "energyCost", label: "Energía (S/)", type: "number", min: 0, step: "any" },
        { name: "packagingCost", label: "Envases (S/)", type: "number", min: 0, step: "any" }, { name: "otherCost", label: "Otros (S/)", type: "number", min: 0, step: "any" },
        { name: "expiryMonths", label: "Vida útil (meses)", type: "number", min: 1, max: 60 }, { name: "observations", label: "Observaciones", type: "textarea" },
      ]}
      onSubmit={async ({ splits, ...v }) => {
        const outputs = splits ? String(splits).split(",").map((x) => ({ quantityKg: Number(x.trim()) })).filter((x) => x.quantityKg > 0) : undefined;
        await api(`/production/orders/${order.id}/complete`, { body: { ...v, outputs } });
      }}>
      {(v) => {
        const i = Number(order.initialWeightKg), f = Number(v.finalWeightKg || 0);
        return f > 0 ? <Notice tone="blue">Vista previa: merma <b>{kg(i - f, 1)}</b> · rendimiento <b>{num((f / i) * 100, 2)} %</b> · {num(f / 25, 1)} sacos de 25 kg</Notice> : null;
      }}
    </FormDialog>
  );
}
