"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Package, Plus, Boxes, Ship, CheckCircle2, FileSignature, PackagePlus, Calculator } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { num, date, money } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Kpi, Tabs, Notice, Badge, Loading, Mono } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { Can, useAuth } from "@/components/providers";
import { useToast } from "@/components/providers";

const usd = (v: any) => money(v, "USD");

export default function Comex() {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = React.useState<"pedidos" | "paletas" | "granel">("pedidos");
  const [open, setOpen] = React.useState(false);
  const [pack, setPack] = React.useState(false);
  const ships = useApi<any[]>("/trade/shipments");
  const pallets = useApi<any[]>("/trade/pallets");
  const bulk = useApi<any[]>("/trade/bulk-lots");
  const params = useApi<any>("/trade/params");
  const customers = useApi<any>("/sales/customers?type=INTERNACIONAL&pageSize=100");
  React.useEffect(() => { const t = setInterval(() => { ships.reload(); pallets.reload(); }, 5000); return () => clearInterval(t); }, [ships.reload, pallets.reload]);
  const s = ships.data ?? [];
  const p = params.data?.params;
  return (
    <div className="space-y-4">
      <PageHeader area="Comercio exterior · TI-10 módulo 5" title="Pedidos y paletas de exportación" subtitle="Cotización → pedido → validación de calidad (R1) → reserva → confirmación → embarque. Producto: páprika molida en frascos de 113 g (4 oz)." icon={<Package className="h-5 w-5" />}
        actions={<>
          <Can perm="trade.write"><Button variant="outline" onClick={() => setPack(true)}><PackagePlus className="h-4 w-4" />Envasar lote</Button></Can>
          <Can perm="trade.write"><Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Nuevo pedido internacional</Button></Can>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="green" icon={<Boxes />} label="Paletas disponibles (COA aprobado)" value={num((pallets.data ?? []).filter((x) => x.status === "DISPONIBLE").length)} hint={`${num((pallets.data ?? []).filter((x) => x.status === "DISPONIBLE").reduce((a, b) => a + b.jars, 0))} frascos`} />
        <Kpi tone="blue" icon={<Package />} label="Pedidos internacionales" value={num(s.filter((x) => x.status !== "ANULADO").length)} hint={`${s.filter((x) => x.status === "COTIZACION").length} cotizaciones`} />
        <Kpi tone="amber" icon={<Ship />} label="Embarques activos" value={num(s.filter((x) => ["DESPACHADO", "EN_TRANSITO", "ARRIBADO", "ENTREGADO"].includes(x.status)).length)} hint="En tránsito o por confirmar" />
        <Kpi tone="red" icon={<CheckCircle2 />} label="Exportaciones completadas" value={num(s.filter((x) => x.status === "CERRADO").length)} hint={usd(s.filter((x) => x.status === "CERRADO").reduce((a, b) => a + Number(b.amountUsd), 0))} />
      </div>
      {p && <Notice tone="blue">Composición: {p.jarsPerCase} frascos × {p.jarNetG} g por caja · {p.casesPerPallet} cajas por paleta = {p.jarsPerCase * p.casesPerPallet} frascos · neto {params.data.pallet.netKg} kg (plan ≈ 260.4 kg) · bruto {params.data.pallet.grossKg} kg. Incoterms FCA/FOB ({p.incotermVersion}). Piso de margen de Gerencia: {p.marginFloorPct} % (R8). GTIN {params.data.gtin.gtin13} · GTIN-14 {params.data.gtin.gtin14}.</Notice>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pedidos", label: "Pedidos / embarques", count: s.length }, { id: "paletas", label: "Paletas SSCC", count: pallets.data?.length }, { id: "granel", label: "Lotes a granel para envasar" }]} />
      <Card>
        {tab === "pedidos" && (ships.loading && !ships.data ? <Loading /> : <Table rows={s} onRowClick={(r: any) => router.push(`/comex/${r.id}`)} columns={[
          { key: "code", header: "Pedido", render: (r: any) => <div><b>{r.code}</b><p className="text-[11px] text-muted">{r.source === "PORTAL" ? "Portal del comprador" : "ERP"} · {r.projected ? "proyectado" : "real"}</p></div> },
          { key: "c", header: "Importador", render: (r: any) => r.importer },
          { key: "q", header: "Cantidad", render: (r: any) => `${r.pallets} pal · ${num(r.cases)} cajas · ${num(r.jars)} frascos` },
          { key: "inc", header: "Incoterm", render: (r: any) => `${r.incoterm}` },
          { key: "a", header: "Importe", align: "right", render: (r: any) => usd(r.amountUsd) },
          ...(can("costs.read") ? [{ key: "m", header: "Margen", align: "right" as const, render: (r: any) => r.marginPct != null ? <span className={Number(r.marginPct) < (p?.marginFloorPct ?? 20) ? "font-bold text-paprika" : ""}>{Number(r.marginPct).toFixed(1)} %</span> : "—" }] : []),
          { key: "lot", header: "Lote", render: (r: any) => r.lot?.code ?? "—" },
          { key: "sc", header: "Smart contract", render: (r: any) => r.agreement ? <StatusBadge status={r.agreement.status} /> : <span className="text-xs text-muted">—</span> },
          { key: "dam", header: "Semáforo DAM", render: (r: any) => <StatusBadge status={r.customs.light} /> },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />)}
        {tab === "paletas" && <Table rows={pallets.data ?? []} columns={[
          { key: "sscc", header: "SSCC", render: (r: any) => <Mono>(00) {r.sscc}</Mono> }, { key: "lot", header: "Lote", render: (r: any) => r.lot.code },
          { key: "c", header: "Cajas / frascos", render: (r: any) => `${r.cases} / ${num(r.jars)}` }, { key: "n", header: "Neto / bruto", align: "right", render: (r: any) => `${Number(r.netKg).toFixed(3)} / ${Number(r.grossKg).toFixed(3)} kg` },
          { key: "loc", header: "Ubicación", render: (r: any) => r.location }, { key: "bb", header: "Best by", render: (r: any) => date(r.bestBy) },
          { key: "sh", header: "Pedido", render: (r: any) => r.shipment?.code ?? "—" }, { key: "q", header: "Calidad", render: (r: any) => <StatusBadge status={r.lot.qualityStatus} /> }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />}
        {tab === "granel" && <Table rows={bulk.data ?? []} columns={[
          { key: "code", header: "Lote a granel" }, { key: "d", header: "Producción", render: (r: any) => date(r.productionDate) },
          { key: "a", header: "Disponible", align: "right", render: (r: any) => `${Number(r.availableKg).toFixed(3)} kg` }, { key: "j", header: "Alcanza para", align: "right", render: (r: any) => `${num(Math.floor(Number(r.availableKg) * 1000 / 113))} frascos (${Math.floor(Number(r.availableKg) * 1000 / 113 / 2304)} pal.)` },
          { key: "lab", header: "Último análisis", render: (r: any) => r.lastLab ? <StatusBadge status={r.lastLab.result} label={`${r.lastLab.code} · ${r.lastLab.result}`} /> : "—" }, { key: "q", header: "Calidad", render: (r: any) => <StatusBadge status={r.qualityStatus} /> },
        ]} />}
      </Card>
      <FormDialog open={open} onClose={() => setOpen(false)} title="Nuevo pedido internacional" size="lg" successMessage="Pedido creado: el motor de automatización validará calidad, reservará y creará el smart contract"
        initial={{ pallets: 1, incoterm: "FCA", unitPriceUsd: p?.defaultPriceUsd ?? 2, status: "PEDIDO", deliveryDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), broker: "Food Broker Demo (EE. UU.)", autopilot: "true" }}
        fields={[
          { name: "customerId", label: "Cliente / importador", type: "select", required: true, options: (customers.data?.items ?? []).map((c: any) => ({ value: c.id, label: `${c.name} (${c.country})` })) },
          { name: "status", label: "Tipo", type: "select", options: [{ value: "PEDIDO", label: "Pedido" }, { value: "COTIZACION", label: "Cotización / proforma" }] },
          { name: "pallets", label: "Paletas (96 cajas × 24 frascos)", type: "number", min: 1, max: 20, required: true },
          { name: "incoterm", label: "Incoterm", type: "select", options: [{ value: "FCA", label: "FCA — Franco transportista (Callao)" }, { value: "FOB", label: "FOB — Libre a bordo (Callao)" }] },
          { name: "unitPriceUsd", label: "Precio por frasco (US$)", type: "number", step: "any", min: 0.01, required: true, hint: "Precio de prueba; bajo el piso de margen requiere aprobación de Gerencia" },
          { name: "deliveryDate", label: "Fecha de entrega", type: "date", required: true },
          { name: "broker", label: "Broker" }, { name: "paymentTerms", label: "Condiciones de pago", placeholder: "Escrow smart contract + pasarela" },
          { name: "autopilot", label: "Piloto automático", type: "select", options: [{ value: "true", label: "Sí: el motor ejecuta todas las tareas" }, { value: "false", label: "No: avance manual" }] },
          { name: "notes", label: "Notas", type: "textarea", full: true },
        ]}
        onSubmit={async (v, key) => { const r = await api("/trade/shipments", { body: { ...v, autopilot: v.autopilot !== "false" }, idempotencyKey: key }); ships.reload(); router.push(`/comex/${r.id}`); }}>
        {(v) => <QuotePreview pallets={Number(v.pallets)} price={Number(v.unitPriceUsd)} incoterm={v.incoterm} />}
      </FormDialog>
      <FormDialog open={pack} onClose={() => setPack(false)} title="Envasar páprika a granel en frascos de 4 oz" successMessage="Lote de frascos creado con sus paletas SSCC" initial={{ pallets: 1 }}
        fields={[{ name: "sourceLotCode", label: "Lote a granel (COA aprobado)", type: "select", required: true, options: (bulk.data ?? []).filter((b) => b.qualityStatus === "APROBADO" && Number(b.availableKg) >= 260.352).map((b) => ({ value: b.code, label: `${b.code} · ${Number(b.availableKg).toFixed(1)} kg` })) }, { name: "pallets", label: "Paletas a envasar", type: "number", min: 1, max: 10, required: true }]}
        onSubmit={async (v, key) => { const r = await api("/trade/pack", { body: v, idempotencyKey: key }); toast.info(`Lote ${r.lot.code}`, r.note); pallets.reload(); bulk.reload(); }} />
    </div>
  );
}

function QuotePreview({ pallets, price, incoterm }: { pallets: number; price: number; incoterm: string }) {
  const [q, setQ] = React.useState<any>(null);
  React.useEffect(() => {
    if (!pallets || !price) return;
    const t = setTimeout(() => api("/trade/quote", { body: { pallets, unitPriceUsd: price, incoterm } }).then(setQ).catch(() => setQ(null)), 300);
    return () => clearTimeout(t);
  }, [pallets, price, incoterm]);
  if (!q) return null;
  return (
    <div className="mt-2 rounded-xl border border-line bg-soft p-3 text-xs">
      <p className="mb-1 flex items-center gap-1 font-bold text-fg"><Calculator className="h-4 w-4" />Cotización automática</p>
      <p>{q.pallets} paleta(s) = <b>{q.cases} cajas</b> = <b>{num(q.jars)} frascos</b> · neto {Number(q.netKg).toFixed(3)} kg · bruto {Number(q.grossKg).toFixed(3)} kg · <b>US$ {Number(q.amountUsd).toFixed(2)}</b></p>
      {q.marginPct !== undefined && <p className="mt-1">Costo estimado S/ {Number(q.costPen).toFixed(2)} (S/ {Number(q.costPerJarPen).toFixed(4)} por frasco) · margen <b className={q.needsApproval ? "text-paprika" : "text-agro"}>{Number(q.marginPct).toFixed(2)} %</b>{q.needsApproval && <Badge tone="red" className="ml-2">Requiere aprobación de Gerencia (R8)</Badge>}</p>}
    </div>
  );
}
