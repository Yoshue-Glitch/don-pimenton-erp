"use client";
import * as React from "react";
import Link from "next/link";
import { ShieldCheck, ClipboardCheck, CheckCircle2, XCircle, PauseCircle, FileUp } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, date, dateTime, num } from "@/lib/utils";
import { Card, CardHeader, PageHeader, StatusBadge, Button, Tabs, Notice, Empty, Modal, Field, Textarea, ErrorBox, Badge } from "@/components/ui";
import { ServerTable, Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { CrudSection, useOptions } from "@/components/Crud";
import { Can, useToast } from "@/components/providers";

const LAB = ["PENDIENTE", "CONFORME", "NO_CONFORME"].map((v) => ({ value: v, label: v.replace("_", " ") }));

export default function Calidad() {
  const [tab, setTab] = React.useState<"lotes" | "inspecciones" | "specs">("lotes");
  const lots = useApi<any[]>("/quality/lots");
  const [inspectLot, setInspectLot] = React.useState<any>(null);
  const [decide, setDecide] = React.useState<any>(null);
  const [rk, setRk] = React.useState(0);
  const customers = useOptions("/sales/customers?pageSize=100", (c) => c.name);
  const products = useOptions("/inventory/products?type=PRODUCTO_TERMINADO", (p) => p.name);
  const fileRef = React.useRef<File | null>(null);
  const pending = (lots.data ?? []).filter((l) => ["PENDIENTE", "EN_EVALUACION"].includes(l.qualityStatus));
  const refresh = () => { lots.reload(); setRk((k) => k + 1); };
  return (
    <div className="space-y-4">
      <PageHeader title="Calidad e inocuidad" subtitle="Control por lote · un lote rechazado o en cuarentena no puede despacharse" icon={<ShieldCheck className="h-5 w-5" />} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "lotes", label: "Lotes por evaluar", count: pending.length }, { id: "inspecciones", label: "Inspecciones" }, { id: "specs", label: "Especificaciones" }]} />
      {tab === "lotes" && (
        <Card>
          <CardHeader title="Lotes de producto terminado" subtitle="Estado de aprobación de cada lote" />
          <Table rows={lots.data ?? []} empty={<Empty />} columns={[
            { key: "code", header: "Lote", render: (r: any) => <Link className="font-semibold text-paprika hover:underline" href={`/inventario/lotes/${r.code}`}>{r.code}</Link> },
            { key: "d", header: "Producción", render: (r: any) => date(r.productionDate) },
            { key: "kg", header: "Cantidad", align: "right", render: (r: any) => `${kg(r.quantityKg)}${r.bags ? ` · ${r.bags} sacos` : ""}` },
            { key: "i", header: "Inspecciones", render: (r: any) => r.inspections.map((i: any) => i.code).join(", ") || "—" },
            { key: "q", header: "Estado", render: (r: any) => <StatusBadge status={r.qualityStatus} /> },
            { key: "a", header: "", align: "right", render: (r: any) => r.qualityStatus === "PENDIENTE" ? <Can perm="quality.write"><Button size="sm" onClick={() => setInspectLot(r)}><ClipboardCheck className="h-3.5 w-3.5" />Inspeccionar</Button></Can> : null },
          ]} />
        </Card>
      )}
      {tab === "inspecciones" && (
        <Card>
          <ServerTable path="/quality/inspections" reloadKey={rk} filters={[{ key: "status", label: "Estado", options: ["EN_EVALUACION", "APROBADO", "RECHAZADO", "CUARENTENA"].map((v) => ({ value: v, label: v })) }]}
            columns={[
              { key: "code", header: "Inspección", render: (r: any) => <span className="font-semibold">{r.code}</span> }, { key: "lot", header: "Lote", render: (r: any) => r.lot.code },
              { key: "date", header: "Fecha", render: (r: any) => dateTime(r.date), hideOnMobile: true }, { key: "insp", header: "Inspector", render: (r: any) => r.inspector.name, hideOnMobile: true },
              { key: "h", header: "Humedad", align: "right", render: (r: any) => r.moisturePct != null ? `${num(r.moisturePct, 1)} %` : "—" },
              { key: "asta", header: "ASTA", align: "right", render: (r: any) => r.astaColor ?? "—" }, { key: "g", header: "Granul.", align: "right", render: (r: any) => r.granulometry != null ? `${num(r.granulometry, 1)} %` : "—" },
              { key: "m", header: "Micro / contam.", render: (r: any) => <div className="flex gap-1"><StatusBadge status={r.microbiological} /><StatusBadge status={r.contaminants} /></div> },
              { key: "spec", header: "Especificación", render: (r: any) => { const e = (r.specEvaluation ?? []) as any[]; const bad = e.filter((x) => x.result !== "CUMPLE").length; return e.length ? <Badge tone={bad ? "red" : "green"}>{bad ? `${bad} fuera` : "Cumple"}</Badge> : "—"; } },
              { key: "coa", header: "COA", render: (r: any) => r.coaDocument ? <span title={r.coaDocument.sha256} className="text-xs">{r.coaDocument.code}</span> : "—", hideOnMobile: true },
              { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
              { key: "a", header: "", align: "right", render: (r: any) => r.status === "EN_EVALUACION" ? <Can perm="quality.approve"><Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setDecide(r); }}>Decidir</Button></Can> : null },
            ]} />
        </Card>
      )}
      {tab === "specs" && (
        <Card>
          <div className="p-4 pb-0"><Notice>Las especificaciones son configurables por producto y cliente. Los valores precargados son de <b>demostración</b> y no constituyen límites regulatorios universales.</Notice></div>
          <CrudSection path="/quality/specs" title="especificación" writePerm="quality.specs" newLabel="Nueva especificación"
            columns={[
              { key: "p", header: "Producto", render: (r: any) => r.product.name }, { key: "c", header: "Cliente", render: (r: any) => r.customer?.name ?? <Badge>General</Badge> },
              { key: "parameter", header: "Parámetro" }, { key: "min", header: "Mínimo", align: "right", render: (r: any) => r.minValue ?? "—" }, { key: "max", header: "Máximo", align: "right", render: (r: any) => r.maxValue ?? "—" },
              { key: "unit", header: "Unidad" }, { key: "demo", header: "Tipo", render: (r: any) => r.isDemo ? <Badge tone="gold">Demo</Badge> : <Badge tone="green">Validada</Badge> }, { key: "notes", header: "Notas", hideOnMobile: true },
            ]}
            toEdit={(r: any) => ({ productId: r.productId, customerId: r.customerId ?? "", parameter: r.parameter, minValue: r.minValue ?? "", maxValue: r.maxValue ?? "", unit: r.unit, notes: r.notes ?? "", isDemo: r.isDemo })}
            fields={[
              { name: "productId", label: "Producto", type: "select", required: true, options: products }, { name: "customerId", label: "Cliente (vacío = general)", type: "select", options: customers },
              { name: "parameter", label: "Parámetro", type: "select", required: true, options: [{ value: "HUMEDAD", label: "Humedad" }, { value: "COLOR_ASTA", label: "Color ASTA" }, { value: "GRANULOMETRIA", label: "Granulometría" }] },
              { name: "unit", label: "Unidad", required: true }, { name: "minValue", label: "Mínimo", type: "number", step: "any" }, { name: "maxValue", label: "Máximo", type: "number", step: "any" },
              { name: "notes", label: "Notas / fuente", full: true }, { name: "isDemo", label: "Valor de demostración", type: "checkbox" },
            ]} />
        </Card>
      )}
      <FormDialog open={!!inspectLot} onClose={() => { setInspectLot(null); fileRef.current = null; refresh(); }} title={`Inspección del lote ${inspectLot?.code ?? ""}`} subtitle="Los resultados se evalúan contra las especificaciones del producto (y del cliente, si se elige)" size="lg" successMessage="Inspección registrada (en evaluación)"
        initial={{ microbiological: "PENDIENTE", contaminants: "PENDIENTE", granulometryMesh: "Malla 40 (425 µm)" }}
        fields={[
          { name: "moisturePct", label: "Humedad (%)", type: "number", min: 0, max: 100, step: "any" }, { name: "astaColor", label: "Color (ASTA)", type: "number", min: 0, step: "any" },
          { name: "granulometry", label: "Granulometría (% que pasa)", type: "number", min: 0, max: 100, step: "any" }, { name: "granulometryMesh", label: "Malla" },
          { name: "microbiological", label: "Resultado microbiológico", type: "select", options: LAB }, { name: "contaminants", label: "Resultado de contaminantes", type: "select", options: LAB },
          { name: "specCustomerId", label: "Evaluar con especificación del cliente", type: "select", options: customers }, { name: "observations", label: "Observaciones", type: "textarea" },
        ]}
        onSubmit={async (v, key) => {
          let coaDocumentId: number | undefined;
          if (fileRef.current) {
            const fd = new FormData();
            fd.append("file", fileRef.current); fd.append("title", `COA / informe ${inspectLot.code}`); fd.append("type", "COA"); fd.append("entityType", "lot"); fd.append("entityId", inspectLot.code);
            coaDocumentId = (await api("/documents", { form: fd })).id;
          }
          await api("/quality/inspections", { body: { ...v, lotId: inspectLot.id, coaDocumentId }, idempotencyKey: key });
        }}>
        {() => (
          <Field label="Certificado / informe de análisis (COA) — PDF, imagen o texto" hint="Se calcula su SHA-256; ese hash se registrará en blockchain al anclar el lote.">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted hover:bg-soft">
              <FileUp className="h-4 w-4" /><input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt" className="text-xs" onChange={(e) => { fileRef.current = e.target.files?.[0] ?? null; }} />
            </label>
          </Field>
        )}
      </FormDialog>
      <DecisionDialog insp={decide} onClose={() => { setDecide(null); refresh(); }} />
    </div>
  );
}

function DecisionDialog({ insp, onClose }: { insp: any; onClose: () => void }) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const toast = useToast();
  React.useEffect(() => { setNote(""); setErr(null); }, [insp]);
  if (!insp) return null;
  const evals = (insp.specEvaluation ?? []) as any[];
  const go = async (status: string) => {
    setBusy(status); setErr(null);
    try { const r = await api(`/quality/inspections/${insp.id}/decision`, { body: { status, note } }); toast.success(`Lote ${insp.lot.code}: ${status}`, `Hash del certificado ${r.certHash.slice(0, 14)}…`); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title={`Decisión de calidad — ${insp.lot.code}`} subtitle={`Inspección ${insp.code}`} size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button variant="outline" loading={busy === "CUARENTENA"} onClick={() => go("CUARENTENA")}><PauseCircle className="h-4 w-4" />Cuarentena</Button>
        <Button variant="danger" loading={busy === "RECHAZADO"} onClick={() => go("RECHAZADO")}><XCircle className="h-4 w-4" />Rechazar</Button>
        <Button variant="secondary" loading={busy === "APROBADO"} onClick={() => go("APROBADO")}><CheckCircle2 className="h-4 w-4" />Aprobar</Button>
      </>}>
      <div className="space-y-3">
        {err && <ErrorBox message={err} />}
        <Table rows={evals} rowKey={(r: any) => r.parameter} empty={<p className="text-sm text-muted">Sin especificaciones configuradas para este producto.</p>} columns={[
          { key: "parameter", header: "Parámetro" }, { key: "value", header: "Valor", align: "right" }, { key: "r", header: "Rango", render: (r: any) => `${r.min ?? "—"} a ${r.max ?? "—"} ${r.unit}` },
          { key: "source", header: "Fuente", render: (r: any) => `${r.source}${r.isDemo ? " (demo)" : ""}` }, { key: "result", header: "Resultado", render: (r: any) => <StatusBadge status={r.result} /> },
        ]} />
        <div className="flex gap-2 text-xs">Microbiológico: <StatusBadge status={insp.microbiological} /> Contaminantes: <StatusBadge status={insp.contaminants} /></div>
        <Notice tone="blue">Aprobar libera el stock de cuarentena a disponible. Rechazar o poner en cuarentena bloquea el lote para reservas y despachos. La aprobación exige resultados conformes y todos los parámetros dentro de especificación.</Notice>
        <Field label="Nota de la decisión"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
