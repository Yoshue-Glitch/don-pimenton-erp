"use client";
import * as React from "react";
import { Bot, Send, CheckCircle2, ExternalLink, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { dateTime, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, Button, Badge, Notice, Textarea, Tabs } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { Can, useToast } from "@/components/providers";

const TOOLS = [
  { id: "CHAT", label: "Consulta normativa y comercial", ph: "¿Cuál es el plazo para regularizar la DAM y qué pasa si me paso?" },
  { id: "COMPARAR", label: "Comparar factura, packing list y B/L", ph: "Compara los documentos del embarque EMB-2026-002" },
  { id: "PRONOSTICO", label: "Pronóstico de cosecha y demanda", ph: "Con los datos actuales, ¿cuántas paletas podríamos exportar el próximo trimestre?" },
  { id: "REDACCION", label: "Contenido comercial bilingüe", ph: "Redacta una ficha comercial bilingüe de la páprika 4 oz para brokers en Florida" },
  { id: "ANOMALIAS", label: "Anomalías de costos, mermas y energía", ph: "¿Hay anomalías en costos, mermas o consumo energético?" },
] as const;

export default function Asistente() {
  const status = useApi<any>("/assistant/status");
  const hist = useApi<any[]>("/assistant/history");
  const toast = useToast();
  const [tool, setTool] = React.useState<(typeof TOOLS)[number]["id"]>("CHAT");
  const [q, setQ] = React.useState("");
  const [ans, setAns] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const t = TOOLS.find((x) => x.id === tool)!;
  const ask = async () => { setBusy(true); try { setAns(await api("/assistant/ask", { body: { question: q || t.ph, tool } })); hist.reload(); } catch (e: any) { toast.error("Asistente", e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <PageHeader area="Sistema · TI-10 módulo 11" title="Asistente de inteligencia artificial" subtitle="Consulta la biblioteca normativa del plan y fuentes oficiales, compara documentos, apoya pronósticos, redacta contenido bilingüe y detecta anomalías. Toda recomendación debe validarla un responsable humano." icon={<Bot className="h-5 w-5" />} />
      {status.data && (status.data.enabled
        ? <Notice tone="green" icon={<Sparkles className="h-4 w-4" />}>IA conectada: {status.data.model} con búsqueda web limitada a {status.data.trustedDomains.length} dominios oficiales (FDA, CBP, SUNAT, SENASA, DIGESA, PROMPERÚ, MINCETUR, GS1, ICC…).</Notice>
        : <Notice>MODO DEMOSTRACIÓN: no hay una API de IA conectada (variable ANTHROPIC_API_KEY). Las respuestas salen solo de la base de conocimiento curada del plan y de los datos del ERP, con su fuente; el sistema no inventa resultados de análisis.</Notice>)}
      <Tabs value={tool} onChange={(v) => { setTool(v); setAns(null); }} tabs={TOOLS.map((x) => ({ id: x.id, label: x.label }))} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card><CardBody className="space-y-3">
          <Textarea rows={5} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.ph} />
          <Button onClick={ask} loading={busy}><Send className="h-4 w-4" />Consultar</Button>
        </CardBody></Card>
        <Card><CardHeader title="Respuesta" subtitle={ans ? `${ans.mode === "CLAUDE" ? "Claude + fuentes web" : "Base de conocimiento local"} · consulta #${ans.id}` : "—"} />
          <CardBody className="space-y-2 text-sm">
            {ans ? <>
              <div className="space-y-1.5 whitespace-pre-wrap leading-relaxed">{ans.answer.replace(/\*\*/g, "")}</div>
              {ans.sources?.length > 0 && <div className="border-t border-line pt-2">{ans.sources.map((s: any) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-bluex hover:underline"><ExternalLink className="h-3 w-3" />{s.title}</a>)}</div>}
              <p className="text-[11px] text-amberx">{ans.disclaimer}</p>
            </> : <p className="text-muted">Escriba una consulta o use la sugerencia.</p>}
          </CardBody></Card>
      </div>
      <Card><CardHeader title="Historial de consultas y validaciones" />
        <Table rows={hist.data ?? []} columns={[
          { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "c", header: "Canal", render: (r: any) => <Badge tone={r.channel === "PORTAL" ? "blue" : "slate"}>{r.channel}</Badge> }, { key: "t", header: "Herramienta", render: (r: any) => r.tool },
          { key: "q", header: "Consulta", render: (r: any) => <span className="line-clamp-2 text-xs">{r.question}</span> }, { key: "m", header: "Modo", render: (r: any) => r.mode },
          { key: "v", header: "Validación humana", render: (r: any) => r.validatedBy ? <span className="flex items-center gap-1 text-xs text-agro"><CheckCircle2 className="h-3.5 w-3.5" />{r.validatedBy}</span> : <Can perm="ai.validate" fallback={<span className="text-xs text-muted">Pendiente</span>}><Button size="sm" variant="outline" onClick={() => api(`/assistant/history/${r.id}/validate`, { body: {} }).then(hist.reload)}>Validar</Button></Can> },
        ]} />
      </Card>
    </div>
  );
}
