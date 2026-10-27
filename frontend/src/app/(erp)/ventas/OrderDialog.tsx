"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, newKey } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { money, num } from "@/lib/utils";
import { Button, Field, Input, Modal, Select, ErrorBox, Notice, Textarea } from "@/components/ui";
import { useOptions } from "@/components/Crud";
import { useToast } from "@/components/providers";

type Line = { productId: string; lotId: string; unit: "KG" | "SACO"; quantity: string; unitPrice: string; discountPct: string };
const empty = (): Line => ({ productId: "", lotId: "", unit: "SACO", quantity: "", unitPrice: "", discountPct: "0" });

/** Pedido o cotización con varias líneas; venta por kg o por saco. */
export function OrderDialog({ open, onClose, mode = "order" }: { open: boolean; onClose: (created?: any) => void; mode?: "order" | "quote" }) {
  const toast = useToast();
  const customers = useOptions("/sales/customers?pageSize=100&active=true", (c) => `${c.name}${c.type === "INTERNACIONAL" ? " (intl.)" : ""}`);
  const { data: products } = useApi<any>("/inventory/products?type=PRODUCTO_TERMINADO&pageSize=50");
  const { data: lots } = useApi<any>(open ? "/inventory/lots?type=PRODUCTO_TERMINADO&qualityStatus=APROBADO&pageSize=100" : null, [open]);
  const { data: settings } = useApi<any>("/admin/settings");
  const [h, setH] = React.useState({ customerId: "", currency: "PEN", exchangeRate: "", taxCode: "IGV", priceIncludesTax: true, notes: "", validUntil: "" });
  const [lines, setLines] = React.useState<Line[]>([empty()]);
  const [err, setErr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const key = React.useRef(newKey());
  React.useEffect(() => { if (open) { setLines([empty()]); setErr(null); key.current = newKey(); setH((x) => ({ ...x, customerId: "", notes: "" })); } }, [open]);
  const prods = products?.items ?? [];
  const rate = (settings?.["tax.rates"] ?? []).find((t: any) => t.code === h.taxCode)?.rate ?? 0;
  let net = 0, totalKg = 0;
  for (const l of lines) {
    const p = prods.find((x: any) => String(x.id) === l.productId);
    const q = Number(l.quantity || 0);
    net += q * Number(l.unitPrice || 0) * (1 - Number(l.discountPct || 0) / 100);
    totalKg += l.unit === "SACO" ? q * Number(p?.bagWeightKg ?? 25) : q;
  }
  const total = h.priceIncludesTax ? net : net * (1 + rate);
  const base = h.priceIncludesTax ? net / (1 + rate) : net;
  const upd = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const submit = async () => {
    setErr(null);
    if (!h.customerId) return setErr("Seleccione el cliente");
    if (lines.some((l) => !l.productId || !(Number(l.quantity) > 0) || !(Number(l.unitPrice) > 0))) return setErr("Complete producto, cantidad y precio en todas las líneas");
    if (mode === "quote" && !h.validUntil) return setErr("Indique la vigencia de la cotización");
    setSaving(true);
    try {
      const body: any = {
        customerId: Number(h.customerId), currency: h.currency, taxCode: h.taxCode, priceIncludesTax: h.priceIncludesTax, notes: h.notes || undefined,
        ...(h.currency === "USD" && h.exchangeRate ? { exchangeRate: Number(h.exchangeRate) } : {}),
        ...(mode === "quote" ? { validUntil: h.validUntil } : {}),
        items: lines.map((l) => ({ productId: Number(l.productId), lotId: l.lotId ? Number(l.lotId) : undefined, unit: l.unit, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct || 0) })),
      };
      const r = await api(mode === "order" ? "/sales/orders" : "/sales/quotes", { body, idempotencyKey: key.current });
      toast.success(mode === "order" ? `Pedido ${r.code} registrado` : `Cotización ${r.code} registrada`, mode === "order" ? "Stock aprobado reservado (FEFO)" : undefined);
      onClose(r);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={() => onClose()} size="xl" title={mode === "order" ? "Nuevo pedido de venta" : "Nueva cotización"} subtitle={mode === "order" ? "Al guardar se reserva stock de lotes APROBADOS. Los lotes rechazados o en cuarentena no se pueden vender." : undefined}
      footer={<><Button variant="outline" onClick={() => onClose()}>Cancelar</Button><Button loading={saving} onClick={submit}>{mode === "order" ? "Registrar y reservar" : "Guardar cotización"}</Button></>}>
      <div className="space-y-4">
        {err && <ErrorBox message={err} />}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Cliente" required className="sm:col-span-2"><Select value={h.customerId} onChange={(e) => setH({ ...h, customerId: e.target.value })}><option value="">Seleccione…</option>{customers.map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></Field>
          <Field label="Moneda"><Select value={h.currency} onChange={(e) => setH({ ...h, currency: e.target.value })}><option value="PEN">PEN (S/)</option><option value="USD">USD ($)</option></Select></Field>
          {h.currency === "USD" ? <Field label="Tipo de cambio" hint={`Por defecto ${settings?.["fx.defaultUsdPen"] ?? ""}`}><Input type="number" step="any" value={h.exchangeRate} onChange={(e) => setH({ ...h, exchangeRate: e.target.value })} /></Field>
            : mode === "quote" ? <Field label="Válida hasta" required><Input type="date" value={h.validUntil} onChange={(e) => setH({ ...h, validUntil: e.target.value })} /></Field> : <div />}
          <Field label="Impuesto"><Select value={h.taxCode} onChange={(e) => setH({ ...h, taxCode: e.target.value })}>{(settings?.["tax.rates"] ?? []).map((t: any) => <option key={t.code} value={t.code}>{t.name}</option>)}</Select></Field>
          <Field label="Precio incluye impuesto"><Select value={h.priceIncludesTax ? "1" : "0"} onChange={(e) => setH({ ...h, priceIncludesTax: e.target.value === "1" })}><option value="1">Sí</option><option value="0">No</option></Select></Field>
          {mode === "quote" && h.currency === "USD" && <Field label="Válida hasta" required><Input type="date" value={h.validUntil} onChange={(e) => setH({ ...h, validUntil: e.target.value })} /></Field>}
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => {
            const p = prods.find((x: any) => String(x.id) === l.productId);
            const lotOpts = (lots?.items ?? []).filter((x: any) => String(x.productId) === l.productId && x.stock.available > 0);
            return (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-12">
                <Field label="Producto" className="sm:col-span-3"><Select value={l.productId} onChange={(e) => { const pr = prods.find((x: any) => String(x.id) === e.target.value); upd(i, { productId: e.target.value, lotId: "", unitPrice: pr?.salePricePerKg ? String(Number(pr.salePricePerKg) * (l.unit === "SACO" ? Number(pr.bagWeightKg ?? 25) : 1)) : "" }); }}><option value="">Seleccione…</option>{prods.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
                <Field label="Lote" className="sm:col-span-2" hint="Vacío = FEFO"><Select value={l.lotId} onChange={(e) => upd(i, { lotId: e.target.value })}><option value="">Automático</option>{lotOpts.map((x: any) => <option key={x.id} value={x.id}>{x.code} ({num(x.stock.available / 25, 0)} sc)</option>)}</Select></Field>
                <Field label="Unidad" className="sm:col-span-1"><Select value={l.unit} onChange={(e) => { const u = e.target.value as any; upd(i, { unit: u, unitPrice: p?.salePricePerKg ? String(Number(p.salePricePerKg) * (u === "SACO" ? Number(p.bagWeightKg ?? 25) : 1)) : l.unitPrice }); }}><option value="SACO">Saco</option><option value="KG">kg</option></Select></Field>
                <Field label="Cantidad" className="sm:col-span-2"><Input type="number" min={0} step={l.unit === "SACO" ? 1 : "any"} value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></Field>
                <Field label={`Precio / ${l.unit === "SACO" ? "saco" : "kg"}`} className="sm:col-span-2"><Input type="number" min={0} step="any" value={l.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /></Field>
                <Field label="Dscto. %" className="sm:col-span-1"><Input type="number" min={0} max={100} step="any" value={l.discountPct} onChange={(e) => upd(i, { discountPct: e.target.value })} /></Field>
                <div className="flex justify-end sm:col-span-1"><Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, empty()])}><Plus className="h-4 w-4" />Agregar línea</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notas"><Textarea value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
          <div className="rounded-xl bg-soft p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">Peso total</span><b>{num(totalKg, 1)} kg · {num(totalKg / 25, 1)} sacos</b></div>
            <div className="flex justify-between"><span className="text-muted">Base imponible</span><span>{money(base, h.currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Impuesto ({num(rate * 100, 0)} %)</span><span>{money(total - base, h.currency)}</span></div>
            <div className="mt-1 flex justify-between border-t border-line pt-1 text-base"><span className="font-semibold">Total</span><b className="text-paprika">{money(total, h.currency)}</b></div>
          </div>
        </div>
        <Notice>Los comprobantes que emite el ERP son documentos internos de demostración, no comprobantes electrónicos SUNAT.</Notice>
      </div>
    </Modal>
  );
}
