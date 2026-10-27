"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Upload, BadgeCheck, ChevronRight, Ban } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, money, date, short } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, Notice, Mono, Modal, Field, Input, Textarea } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { Can, useToast } from "@/components/providers";

export default function ExportDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: o, loading, error, reload } = useApi<any>(`/exports/orders/${id}`);
  const toast = useToast();
  const [up, setUp] = React.useState<any>(null);
  const [na, setNa] = React.useState<any>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (loading && !o) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); reload(); setUp(null); setNa(null); setFile(null); setNote(""); } catch (e: any) { toast.error("Operación rechazada", e.message); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <Link href="/exportaciones" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Exportaciones</Link>
      <PageHeader title={`Orden internacional ${o.code}`} subtitle={`${o.customer.name} · ${o.destinationCountry} · ${o.mode === "DIRECTA" ? "Exportación directa" : `Exportación indirecta vía ${o.partner?.name}`}`}
        actions={<><StatusBadge status={o.status} />{!["ENTREGADA", "COBRADA", "ANULADA"].includes(o.status) && <Can perm="exports.write"><Button disabled={busy} onClick={() => run(() => api(`/exports/orders/${id}/advance`, { method: "POST" }), "Estado actualizado")}>Avanzar estado<ChevronRight className="h-4 w-4" /></Button></Can>}</>} />
      <Card><CardBody><KeyValue cols={4} items={[["Incoterm", `${o.incoterm} (${o.incotermVersion})`], ["Moneda / T.C.", `${o.currency} · ${o.exchangeRate}`], ["Importe", money(o.amount, o.currency)], ["Equivalente PEN", money(Number(o.amount) * Number(o.exchangeRate))], ["Peso neto / bruto", `${kg(o.netWeightKg)} / ${kg(o.grossWeightKg)}`], ["Costos logísticos", money(o.logisticsCost, o.currency)], ["ETD / ETA", `${date(o.etd)} / ${date(o.eta)}`], ["Lote", o.lot ? `${o.lot.code} (${o.lot.qualityStatus})` : "Por asignar"], ["Cobrado", money(o.collectedAmount, o.currency)], ["Notas", o.notes]]} /></CardBody></Card>
      <Card>
        <CardHeader title="Documentación y requisitos" subtitle="Factura comercial, packing list, certificados, documentos de transporte y aduaneros, COA" />
        <Table rows={o.requirements} columns={[
          { key: "name", header: "Requisito", render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: "m", header: "Obligatorio", render: (r: any) => r.mandatory ? "Sí" : "No" },
          { key: "doc", header: "Evidencia", render: (r: any) => r.document ? <button className="text-left text-xs text-paprika hover:underline" onClick={() => download(`/documents/${r.document.id}/download`, r.document.fileName)}>{r.document.fileName}<br /><Mono>{short(r.document.sha256, 10)}</Mono></button> : "—" },
          { key: "v", header: "Verificación", render: (r: any) => r.verifiedBy ? <span className="text-xs">{r.verifiedBy}{r.notes ? ` — ${r.notes}` : ""}</span> : "—" },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "a", header: "", align: "right", render: (r: any) => <Can perm="exports.write"><div className="flex justify-end gap-1">
            {r.status !== "VERIFICADO" && <Button size="sm" variant="outline" onClick={() => setUp(r)}><Upload className="h-3.5 w-3.5" />Adjuntar</Button>}
            {r.status === "ADJUNTADO" && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/exports/requirements/${r.id}/verify`, { body: { status: "VERIFICADO" } }), "Requisito verificado")}><BadgeCheck className="h-3.5 w-3.5" />Verificar</Button>}
            {r.status === "PENDIENTE" && <Button size="sm" variant="ghost" title="No aplica" onClick={() => setNa(r)}><Ban className="h-3.5 w-3.5" /></Button>}
          </div></Can> },
        ]} />
        <CardBody><Notice tone="blue">Para pasar a EMBARCADA, todos los requisitos obligatorios deben estar VERIFICADOS (con evidencia) o justificados como NO APLICA.</Notice></CardBody>
      </Card>
      <Modal open={!!up} onClose={() => setUp(null)} title={`Adjuntar evidencia — ${up?.name ?? ""}`} footer={<><Button variant="outline" onClick={() => setUp(null)}>Cancelar</Button><Button loading={busy} disabled={!file} onClick={() => run(async () => {
        const fd = new FormData(); fd.append("file", file!); fd.append("title", up.name); fd.append("type", up.docType); fd.append("entityType", "export"); fd.append("entityId", o.code);
        const d = await api("/documents", { form: fd }); await api(`/exports/requirements/${up.id}/attach`, { body: { documentId: d.id } });
      }, "Documento adjuntado (pendiente de verificación)")}>Subir</Button></>}>
        <Field label="Archivo (PDF, imagen, Word, Excel o texto · máx. 10 MB)" hint="Se registra su hash SHA-256 para control de integridad."><Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </Modal>
      <Modal open={!!na} onClose={() => setNa(null)} title={`Marcar como no aplica — ${na?.name ?? ""}`} footer={<><Button variant="outline" onClick={() => setNa(null)}>Cancelar</Button><Button loading={busy} disabled={note.length < 5} onClick={() => run(() => api(`/exports/requirements/${na.id}/verify`, { body: { status: "NO_APLICA", notes: note } }), "Requisito marcado como no aplica")}>Guardar</Button></>}>
        <Field label="Justificación" required><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
