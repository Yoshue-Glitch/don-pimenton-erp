"use client";
import * as React from "react";
import { FileText, FileDown, FileSpreadsheet } from "lucide-react";
import { download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Card, CardHeader, CardBody, PageHeader, Button, Select, Field, Notice } from "@/components/ui";
import { useAuth, useToast } from "@/components/providers";

const XLS = [
  ["lotes", "Lotes y estado de calidad / blockchain", "inventory.read"], ["inventario", "Stock por producto, almacén y lote", "inventory.read"], ["kardex", "Kardex completo de movimientos", "inventory.read"],
  ["ventas", "Pedidos de venta", "sales.read"], ["finanzas", "Transacciones financieras (PEN/USD)", "finance.read"], ["blockchain", "Transacciones blockchain", "blockchain.read"],
];

export default function Reportes() {
  const { can } = useAuth();
  const toast = useToast();
  const lots = useApi<any>("/inventory/lots?type=PRODUCTO_TERMINADO&pageSize=200");
  const [lot, setLot] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const dl = async (k: string, path: string, name: string) => { setBusy(k); try { await download(path, name); toast.success("Descarga generada", name); } catch (e: any) { toast.error("No se pudo generar", e.message); } finally { setBusy(null); } };
  return (
    <div className="space-y-4">
      <PageHeader title="Reportes" subtitle="Trazabilidad en PDF y exportaciones a Excel generadas desde la base de datos" icon={<FileText className="h-5 w-5" />} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Reporte de trazabilidad por lote (PDF)" subtitle="Campo → planta → calidad → inventario → venta → verificación blockchain" icon={<FileDown className="h-4 w-4" />} />
          <CardBody className="space-y-3">
            <Field label="Lote de producto terminado"><Select value={lot} onChange={(e) => setLot(e.target.value)}><option value="">Seleccione…</option>{(lots.data?.items ?? []).map((l: any) => <option key={l.id} value={l.code}>{l.code} · {l.qualityStatus.toLowerCase()} · {Number(l.quantityKg)} kg</option>)}</Select></Field>
            <Button disabled={!lot} loading={busy === "pdf"} onClick={() => dl("pdf", `/reports/traceability/${lot}.pdf`, `trazabilidad-${lot}.pdf`)}><FileDown className="h-4 w-4" />Generar PDF</Button>
            <Notice>Documento de gestión con datos de demostración; no es un certificado oficial.</Notice>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Exportación a Excel" icon={<FileSpreadsheet className="h-4 w-4" />} />
          <div className="divide-y divide-line">
            {XLS.filter(([, , p]) => can(p)).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between px-5 py-3 text-sm"><span>{label}</span><Button size="sm" variant="outline" loading={busy === k} onClick={() => dl(k, `/reports/excel/${k}.xlsx`, `${k}.xlsx`)}><FileSpreadsheet className="h-4 w-4" />.xlsx</Button></div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
