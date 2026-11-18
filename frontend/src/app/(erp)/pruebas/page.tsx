"use client";
import * as React from "react";
import { ListChecks, Play, CheckCircle2, XCircle, Loader2, PlayCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { dateTime } from "@/lib/utils";
import { Card, PageHeader, Button, Badge, Notice, Loading } from "@/components/ui";
import { Can } from "@/components/providers";

/** Pruebas obligatorias P1–P7 (TI-15) y P8–P12 (Smart Contracts), ejecutables en vivo. */
export default function Pruebas() {
  const { data } = useApi<any[]>("/export-demo/tests");
  const [res, setRes] = React.useState<Record<string, any>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => { if (data) setRes(Object.fromEntries(data.filter((t) => t.last).map((t) => [t.id, t.last.details]))); }, [data]);
  if (!data) return <Loading />;
  const run = async (id: string) => { setBusy(id); try { const r = await api(`/export-demo/tests/${id}`, { body: {} }); setRes((x) => ({ ...x, [id]: r })); } finally { setBusy(null); } };
  const runAll = async () => { for (const t of data) await run(t.id); };
  const passed = Object.values(res).filter((r: any) => r?.passed).length;
  return (
    <div className="space-y-4">
      <PageHeader area="Sistema · TI-15 + Smart Contracts" title="Pruebas de aceptación P1–P12" subtitle="P1–P7 se ejecutan en una transacción que se revierte al final (no dejan datos). P8–P12 envían transacciones reales a la blockchain local con identificadores de prueba." icon={<ListChecks className="h-5 w-5" />}
        actions={<Can perm="demo.run"><Button onClick={runAll} loading={!!busy}><PlayCircle className="h-4 w-4" />Ejecutar las 12 pruebas</Button></Can>} />
      <Notice tone={passed === 12 ? "green" : "blue"}>{passed} de 12 pruebas aprobadas en la última ejecución.</Notice>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.map((t) => {
          const r = res[t.id];
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest font-black text-white">{t.id}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><b>{t.title}</b>{r && (r.passed ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" />PASA</Badge> : <Badge tone="red"><XCircle className="h-3 w-3" />FALLA</Badge>)}{r && Number(t.id.slice(1)) >= 8 && <Badge tone="blue">on-chain</Badge>}</div>
                  <p className="text-xs text-muted">Resultado esperado: {t.expected}</p>
                  {r && <ul className="mt-2 space-y-0.5 text-[12px] text-fg/85">{r.evidence.map((e: string, i: number) => <li key={i} className="break-words">• {e}</li>)}</ul>}
                  {r && <p className="mt-1 text-[10.5px] text-muted">{dateTime(r.at)} · {r.ms} ms{r.rolledBack ? " · transacción revertida" : ""}</p>}
                </div>
                <Can perm="demo.run"><Button size="sm" variant="outline" onClick={() => run(t.id)} disabled={!!busy}>{busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}</Button></Can>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
