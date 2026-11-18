"use client";
import * as React from "react";
import { FileText, Download, ScanText } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Notice, Select, Textarea, Field, Loading } from "@/components/ui";
import { useToast } from "@/components/providers";

const DOCS: [string, string][] = [["factura", "Factura comercial (demo)"], ["packing", "Packing list"], ["paletas", "Contenido de paletas"], ["agente", "Instrucciones al agente"], ["isf", "Datos ISF 10+2"], ["priornotice", "Datos Prior Notice"], ["coa", "COA (no oficial)"], ["origen", "Certificación de origen"], ["etiquetas", "Etiquetas GS1 + QR"], ["proforma", "Proforma"], ["confirmacion", "Confirmación de pedido"], ["expediente", "Expediente del embarque"]];

export default function Documentos() {
  const { data, loading } = useApi<any[]>("/trade/shipments");
  const toast = useToast();
  const [sel, setSel] = React.useState<string>("");
  const [text, setText] = React.useState("PACKING LIST\nEmbarque EMB-2026-002 · Subpartida 0904.22.10.00\nBultos: 96 cajas\nPeso neto: 260.352 kg\nPeso bruto: 580.072 kg\nB/L: DPSIM1CLLPEF");
  const [ocr, setOcr] = React.useState<any>(null);
  if (loading && !data) return <Loading />;
  const ships = data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader area="Comercio exterior · TI-10 módulo 6 · R2 y R3" title="Documentos de exportación" subtitle="Factura, packing list, contenido de paletas, instrucciones al agente, datos ISF y Prior Notice, COA, origen y expediente. Si hay discrepancias de peso, descripción o subpartida, la aprobación queda bloqueada." icon={<FileText className="h-5 w-5" />} />
      <Notice>El ERP no transmite información oficial a SUNAT, VUCE, FDA ni CBP: prepara los datos. La transmisión corresponde al agente de aduana, al importador o a su broker.</Notice>
      {ships.map((s) => (
        <Card key={s.id}>
          <CardHeader title={`${s.code} · ${s.importer}`} subtitle={`${s.pallets} paleta(s) · ${s.jars} frascos · ${s.incoterm}`} actions={<><StatusBadge status={s.docsStatus} label={`Documentos: ${s.docsStatus}`} /><StatusBadge status={s.status} /></>} />
          <CardBody className="flex flex-wrap gap-2">
            {s._count?.palletsList > 0 ? DOCS.map(([k, n]) => <Button key={k} size="sm" variant="outline" onClick={() => download(`/trade/shipments/${s.id}/docs/${k}.pdf`, `${k}-${s.code}.pdf`).catch((e) => toast.error(n, e.message))}><Download className="h-3.5 w-3.5" />{n}</Button>) : <p className="text-sm text-muted">El paquete completo se habilita al reservar paletas.</p>}
            {!(s._count?.palletsList > 0) && <Button size="sm" variant="outline" onClick={() => download(`/trade/shipments/${s.id}/docs/proforma.pdf`, `proforma-${s.code}.pdf`)}><Download className="h-3.5 w-3.5" />Proforma</Button>}
          </CardBody>
        </Card>
      ))}
      <Card>
        <CardHeader title="Extracción y comparación de documentos (asistente)" subtitle="Pegue el texto de una factura, packing list o B/L: el sistema extrae pesos, bultos, subpartida y B/L, y los compara con el ERP" icon={<ScanText className="h-5 w-5" />} />
        <CardBody className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <Field label="Embarque a comparar"><Select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">—</option>{ships.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</Select></Field>
            <Field label="Texto del documento"><Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            <Button onClick={async () => { try { setOcr(await api("/assistant/extract", { body: { text, shipmentId: sel || undefined } })); } catch (e: any) { toast.error("Extracción", e.message); } }}>Extraer y comparar</Button>
          </div>
          {ocr && <div className="space-y-2 text-sm">
            <p className="font-bold">Campos extraídos</p>
            <pre className="overflow-x-auto rounded-xl bg-soft p-3 text-xs">{JSON.stringify(ocr.fields, null, 2)}</pre>
            {ocr.issues.length ? <Notice tone="red">{ocr.issues.map((i: string) => <p key={i}>{i}</p>)}</Notice> : <Notice tone="green">Sin inconsistencias frente al ERP{sel ? "" : " (seleccione un embarque para comparar)"}</Notice>}
            <p className="text-[11px] text-muted">{ocr.note}</p>
          </div>}
        </CardBody>
      </Card>
    </div>
  );
}
