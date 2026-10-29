"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, ArrowLeftRight, PlusCircle, SlidersHorizontal, Check, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, num, date, dateTime, money } from "@/lib/utils";
import { Card, PageHeader, StatusBadge, Button, Tabs, Badge, Empty, Kpi } from "@/components/ui";
import { ServerTable, LocalTable } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { CrudSection, useOptions } from "@/components/Crud";
import { Can, useToast } from "@/components/providers";

type T = "stock" | "resumen" | "kardex" | "lotes" | "productos" | "almacenes" | "ajustes";
const MOVS = ["ENTRADA", "SALIDA", "RESERVA", "LIBERACION_RESERVA", "TRANSFERENCIA_SALIDA", "TRANSFERENCIA_ENTRADA", "AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "INGRESO_CUARENTENA", "LIBERACION_CUARENTENA", "BLOQUEO_CUARENTENA", "CONSUMO_PRODUCCION", "DEVOLUCION"];

export default function Inventario() {
  const [tab, setTab] = React.useState<T>("stock");
  const [dlg, setDlg] = React.useState<null | "transfer" | "move" | "adjust">(null);
  const [rk, setRk] = React.useState(0);
  const router = useRouter();
  const toast = useToast();
  const balances = useApi<any[]>("/inventory/balances", [rk]);
  const summary = useApi<any[]>("/inventory/summary", [rk]);
  const adjustments = useApi<any[]>("/inventory/adjustments", [rk]);
  const products = useOptions("/inventory/products?pageSize=100", (p) => `${p.code} — ${p.name}`);
  const warehouses = useOptions("/inventory/warehouses?pageSize=50", (w) => `${w.code} — ${w.name}`);
  const lots = useOptions("/inventory/lots?pageSize=200", (l) => l.code);
  const pt = (summary.data ?? []).find((s) => s.type === "PRODUCTO_TERMINADO");
  return (
    <div className="space-y-4">
      <PageHeader area="Procesamiento y Calidad" title="Almacén e inventario" subtitle="Stock disponible, reservado y en cuarentena · kardex · trazabilidad por lote" icon={<Boxes className="h-5 w-5" />}
        actions={<Can perm="inventory.write"><Button variant="outline" onClick={() => setDlg("move")}><PlusCircle className="h-4 w-4" />Entrada/salida de insumos</Button><Button variant="outline" onClick={() => setDlg("transfer")}><ArrowLeftRight className="h-4 w-4" />Transferencia</Button><Button variant="outline" onClick={() => setDlg("adjust")}><SlidersHorizontal className="h-4 w-4" />Solicitar ajuste</Button></Can>} />
      {pt && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Páprika disponible" value={kg(pt.available)} hint={`${num(Number(pt.available) / 25, 0)} sacos de 25 kg`} tone="agro" />
          <Kpi label="Reservado" value={kg(pt.reserved)} hint={`${num(Number(pt.reserved) / 25, 0)} sacos`} tone="gold" />
          <Kpi label="En cuarentena / bloqueado" value={kg(pt.quarantine)} hint={`${num(Number(pt.quarantine) / 25, 0)} sacos`} tone="red" />
          <Kpi label="Stock mínimo" value={kg(pt.minStock)} hint={pt.belowMin ? "⚠ por debajo del mínimo" : "Nivel correcto"} tone="ink" />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "stock", label: "Stock por lote" }, { id: "resumen", label: "Resumen y mínimos" }, { id: "kardex", label: "Kardex" }, { id: "lotes", label: "Lotes" }, { id: "productos", label: "Productos e insumos" }, { id: "almacenes", label: "Almacenes" }, { id: "ajustes", label: "Ajustes", count: (adjustments.data ?? []).filter((a) => a.status === "PENDIENTE").length }]} />
      <Card>
        {tab === "stock" && <LocalTable rows={balances.data ?? []} searchKeys={["product.name", "lot.code", "warehouse.code"]} columns={[
          { key: "p", header: "Producto", render: (r: any) => <span className="font-medium">{r.product.name}</span> }, { key: "w", header: "Almacén", render: (r: any) => r.warehouse.code },
          { key: "l", header: "Lote", render: (r: any) => r.lot ? <Link className="text-paprika hover:underline" href={`/inventario/lotes/${r.lot.code}`}>{r.lot.code}</Link> : "—" },
          { key: "q", header: "Calidad", render: (r: any) => r.lot ? <StatusBadge status={r.lot.qualityStatus} /> : "—" },
          { key: "a", header: "Disponible", align: "right", render: (r: any) => <span className="font-semibold text-agro dark:text-emerald-300">{num(r.availableKg, 1)}</span> },
          { key: "r", header: "Reservado", align: "right", render: (r: any) => num(r.reservedKg, 1) }, { key: "c", header: "Cuarentena", align: "right", render: (r: any) => <span className="text-orange-600">{num(r.quarantineKg, 1)}</span> },
          { key: "u", header: "Unidad", render: (r: any) => r.product.unit.toLowerCase() },
          { key: "b", header: "Sacos (disp./res./cuar.)", align: "right", render: (r: any) => r.bags ? `${num(r.bags.available, 0)} / ${num(r.bags.reserved, 0)} / ${num(r.bags.quarantine, 0)}` : "—" },
          { key: "e", header: "Vence", render: (r: any) => r.lot?.expiryDate ? date(r.lot.expiryDate) : "—", hideOnMobile: true },
        ]} />}
        {tab === "resumen" && <LocalTable rows={summary.data ?? []} columns={[
          { key: "code", header: "Código" }, { key: "name", header: "Producto" }, { key: "type", header: "Tipo", render: (r: any) => <Badge>{r.type.replace("_", " ").toLowerCase()}</Badge> },
          { key: "a", header: "Disponible", align: "right", render: (r: any) => `${num(r.available, 1)} ${r.unit.toLowerCase()}` }, { key: "r", header: "Reservado", align: "right", render: (r: any) => num(r.reserved, 1) },
          { key: "q", header: "Cuarentena", align: "right", render: (r: any) => num(r.quarantine, 1) }, { key: "m", header: "Mínimo", align: "right", render: (r: any) => num(r.minStock, 0) },
          { key: "s", header: "Alerta", render: (r: any) => r.belowMin ? <Badge tone="red">Bajo mínimo</Badge> : <Badge tone="green">OK</Badge> },
        ]} />}
        {tab === "kardex" && <ServerTable path="/inventory/movements" reloadKey={rk} filters={[
          { key: "productId", label: "Producto", options: products.map((p: any) => ({ value: String(p.value), label: p.label })) },
          { key: "warehouseId", label: "Almacén", options: warehouses.map((p: any) => ({ value: String(p.value), label: p.label })) },
          { key: "type", label: "Tipo", options: MOVS.map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase() })) },
        ]} columns={[
          { key: "code", header: "Código", render: (r: any) => <span className="font-mono text-xs">{r.code}</span> }, { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) },
          { key: "t", header: "Movimiento", render: (r: any) => <Badge tone={/ENTRADA|LIBERACION_CUARENTENA|AJUSTE_POSITIVO/.test(r.type) ? "green" : /SALIDA|CONSUMO|NEGATIVO/.test(r.type) ? "red" : /CUARENTENA|DEVOL/.test(r.type) ? "orange" : "blue"}>{r.typeLabel}</Badge> },
          { key: "p", header: "Producto", render: (r: any) => r.product.name }, { key: "w", header: "Alm.", render: (r: any) => r.warehouse.code }, { key: "l", header: "Lote", render: (r: any) => r.lot?.code ?? "—" },
          { key: "q", header: "Cantidad", align: "right", render: (r: any) => `${num(r.quantityKg, 1)}${r.bags ? ` (${num(r.bags, 0)} sc)` : ""}` }, { key: "b", header: "Saldo", align: "right", render: (r: any) => num(r.balanceAfter, 1) },
          { key: "ref", header: "Documento", render: (r: any) => <span className="text-xs">{r.referenceCode}</span> }, { key: "reason", header: "Motivo", render: (r: any) => <span className="text-xs text-muted">{r.reason}</span>, hideOnMobile: true },
          { key: "u", header: "Usuario", render: (r: any) => <span className="text-xs">{r.user.name}</span>, hideOnMobile: true },
        ]} />}
        {tab === "lotes" && <ServerTable path="/inventory/lots" onRowClick={(r: any) => router.push(`/inventario/lotes/${r.code}`)} filters={[
          { key: "type", label: "Tipo", options: [{ value: "MATERIA_PRIMA", label: "Materia prima" }, { value: "PRODUCTO_TERMINADO", label: "Producto terminado" }] },
          { key: "qualityStatus", label: "Calidad", options: ["PENDIENTE", "EN_EVALUACION", "APROBADO", "RECHAZADO", "CUARENTENA"].map((v) => ({ value: v, label: v })) },
        ]} columns={[
          { key: "code", header: "Lote", render: (r: any) => <span className="font-semibold text-paprika">{r.code}</span> }, { key: "type", header: "Tipo", render: (r: any) => r.type === "MATERIA_PRIMA" ? "Materia prima" : "Producto terminado" },
          { key: "parent", header: "Origen", render: (r: any) => r.parentLot?.code ?? "—" }, { key: "op", header: "Orden", render: (r: any) => r.productionOrder?.code ?? "—", hideOnMobile: true },
          { key: "kg", header: "Inicial", align: "right", render: (r: any) => kg(r.quantityKg) }, { key: "s", header: "Stock (disp./res./cuar.)", align: "right", render: (r: any) => `${num(r.stock.available, 0)} / ${num(r.stock.reserved, 0)} / ${num(r.stock.quarantine, 0)}` },
          { key: "q", header: "Calidad", render: (r: any) => <StatusBadge status={r.qualityStatus} /> }, { key: "st", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "c", header: "Blockchain", render: (r: any) => <StatusBadge status={r.chainStatus} /> },
        ]} />}
        {tab === "productos" && <CrudSection path="/inventory/products" title="producto" writePerm="inventory.write" newLabel="Nuevo producto" canDelete={false}
          filters={[{ key: "type", label: "Tipo", options: ["MATERIA_PRIMA", "PRODUCTO_TERMINADO", "INSUMO", "EMPAQUE"].map((v) => ({ value: v, label: v })) }]}
          columns={[{ key: "code", header: "Código" }, { key: "name", header: "Nombre" }, { key: "type", header: "Tipo", render: (r: any) => <Badge>{r.type}</Badge> }, { key: "unit", header: "Unidad" },
            { key: "bag", header: "Saco", render: (r: any) => r.bagWeightKg ? kg(r.bagWeightKg) : "—" }, { key: "min", header: "Mínimo", align: "right", render: (r: any) => num(r.minStock, 0) },
            { key: "cost", header: "Costo std.", align: "right", render: (r: any) => money(r.standardCost) }, { key: "price", header: "Precio/kg", align: "right", render: (r: any) => r.salePricePerKg ? money(r.salePricePerKg) : "—" },
            { key: "a", header: "Activo", render: (r: any) => r.active ? <Badge tone="green">Sí</Badge> : <Badge>No</Badge> }]}
          toEdit={(r: any) => ({ code: r.code, name: r.name, type: r.type, unit: r.unit, bagWeightKg: r.bagWeightKg ?? "", minStock: r.minStock, standardCost: r.standardCost, salePricePerKg: r.salePricePerKg ?? "", active: r.active })}
          fields={[{ name: "code", label: "Código", required: true }, { name: "name", label: "Nombre", required: true },
            { name: "type", label: "Tipo", type: "select", required: true, options: ["MATERIA_PRIMA", "PRODUCTO_TERMINADO", "INSUMO", "EMPAQUE"].map((v) => ({ value: v, label: v })) },
            { name: "unit", label: "Unidad", type: "select", required: true, options: ["KG", "UND", "L"].map((v) => ({ value: v, label: v })) },
            { name: "bagWeightKg", label: "Peso por saco (kg)", type: "number", min: 0, step: "any" }, { name: "minStock", label: "Stock mínimo", type: "number", min: 0, step: "any" },
            { name: "standardCost", label: "Costo estándar (S/)", type: "number", min: 0, step: "any" }, { name: "salePricePerKg", label: "Precio de venta por kg (S/)", type: "number", min: 0, step: "any" },
            { name: "active", label: "Activo", type: "checkbox" }]} />}
        {tab === "almacenes" && <CrudSection path="/inventory/warehouses" title="almacén" writePerm="inventory.write" newLabel="Nuevo almacén" canDelete={false}
          columns={[{ key: "code", header: "Código" }, { key: "name", header: "Nombre" }, { key: "address", header: "Dirección" }, { key: "loc", header: "Ubicaciones", render: (r: any) => r.locations.map((l: any) => `${l.code} ${l.name}`).join(" · ") || "—" }]}
          fields={[{ name: "code", label: "Código", required: true }, { name: "name", label: "Nombre", required: true }, { name: "address", label: "Dirección", full: true }]} />}
        {tab === "ajustes" && <LocalTable rows={adjustments.data ?? []} empty={<Empty title="Sin ajustes" />} columns={[
          { key: "code", header: "Código" }, { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "p", header: "Producto", render: (r: any) => r.product.name },
          { key: "q", header: "Cantidad", align: "right", render: (r: any) => num(r.quantityKg, 2) }, { key: "reason", header: "Motivo" }, { key: "rq", header: "Solicitó", render: (r: any) => r.requestedBy.name },
          { key: "ap", header: "Autorizó", render: (r: any) => r.approvedBy?.name ?? "—" }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
          { key: "a", header: "", align: "right", render: (r: any) => r.status === "PENDIENTE" ? <Can perm="inventory.adjust.approve"><div className="flex justify-end gap-1">
            {[true, false].map((ok) => <Button key={String(ok)} size="sm" variant={ok ? "secondary" : "outline"} onClick={async () => { try { await api(`/inventory/adjustments/${r.id}/decision`, { body: { approve: ok } }); toast.success(ok ? "Ajuste autorizado" : "Ajuste rechazado"); setRk((k) => k + 1); } catch (e: any) { toast.error("No permitido", e.message); } }}>{ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{ok ? "Autorizar" : "Rechazar"}</Button>)}
          </div></Can> : null },
        ]} />}
      </Card>
      <FormDialog open={dlg === "transfer"} onClose={() => { setDlg(null); setRk((k) => k + 1); }} title="Transferencia entre almacenes" successMessage="Transferencia registrada"
        fields={[{ name: "productId", label: "Producto", type: "select", required: true, options: products }, { name: "lotId", label: "Lote (si aplica)", type: "select", options: lots },
          { name: "fromWarehouseId", label: "Almacén origen", type: "select", required: true, options: warehouses }, { name: "toWarehouseId", label: "Almacén destino", type: "select", required: true, options: warehouses },
          { name: "quantityKg", label: "Cantidad", type: "number", required: true, min: 0.001, step: "any" }, { name: "reason", label: "Motivo", required: true, full: true }]}
        onSubmit={(v, key) => api("/inventory/transfers", { body: v, idempotencyKey: key })} />
      <FormDialog open={dlg === "move"} onClose={() => { setDlg(null); setRk((k) => k + 1); }} title="Entrada / salida de insumos y empaques" subtitle="El producto terminado y la materia prima se mueven únicamente por sus procesos" successMessage="Movimiento registrado"
        fields={[{ name: "type", label: "Tipo", type: "select", required: true, options: [{ value: "ENTRADA", label: "Entrada" }, { value: "SALIDA", label: "Salida" }] },
          { name: "productId", label: "Producto", type: "select", required: true, options: products }, { name: "warehouseId", label: "Almacén", type: "select", required: true, options: warehouses },
          { name: "quantityKg", label: "Cantidad", type: "number", required: true, min: 0.001, step: "any" }, { name: "unitCost", label: "Costo unitario (S/)", type: "number", min: 0, step: "any" },
          { name: "referenceCode", label: "Documento de referencia", required: true }, { name: "reason", label: "Motivo", required: true, full: true }]}
        onSubmit={(v, key) => api("/inventory/movements", { body: v, idempotencyKey: key })} />
      <FormDialog open={dlg === "adjust"} onClose={() => { setDlg(null); setRk((k) => k + 1); }} title="Solicitar ajuste de inventario" subtitle="Requiere la autorización de otro usuario con permiso (segregación de funciones)" successMessage="Ajuste solicitado"
        fields={[{ name: "productId", label: "Producto", type: "select", required: true, options: products }, { name: "warehouseId", label: "Almacén", type: "select", required: true, options: warehouses },
          { name: "lotId", label: "Lote (si aplica)", type: "select", options: lots }, { name: "quantityKg", label: "Cantidad (+ / −)", type: "number", required: true, step: "any", hint: "Negativo para disminuir" },
          { name: "reason", label: "Motivo", required: true, full: true }]}
        onSubmit={(v, key) => api("/inventory/adjustments", { body: v, idempotencyKey: key })} />
    </div>
  );
}
