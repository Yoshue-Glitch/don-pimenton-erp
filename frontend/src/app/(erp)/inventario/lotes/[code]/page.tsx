"use client";
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileDown, Link2, Sprout, Factory, ShieldCheck, Boxes, Truck, ShieldAlert } from "lucide-react";
import { api, download } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { kg, date, dateTime, num, short } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Button, Loading, ErrorBox, KeyValue, Mono, Notice } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { Can, useAuth, useToast } from "@/components/providers";

export default function LotTrace() {
  const { code } = useParams<{ code: string }>();
  const { data: t, loading, error, reload } = useApi<any>(`/inventory/lots/${code}/trace`);
  const { can } = useAuth();
  const toast = useToast();
  const [verify, setVerify] = React.useState<any>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (loading && !t) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  const stock = t.balances.reduce((a: any, b: any) => ({ a: a.a + Number(b.availableKg), r: a.r + Number(b.reservedKg), q: a.q + Number(b.quarantineKg) }), { a: 0, r: 0, q: 0 });
  const doVerify = async () => { setBusy("v"); try { setVerify(await api(`/blockchain/lots/${code}/verify`)); } catch (e: any) { toast.error("No se pudo verificar", e.message); } finally { setBusy(null); } };
  const anchor = async () => { setBusy("a"); try { const r = await api(`/blockchain/lots/${code}/anchor`, { method: "POST" }); if (r.ok) toast.success("Lote registrado en blockchain", "Transacción confirmada"); else toast.error("Transacción rechazada", r.message); reload(); } catch (e: any) { toast.error("Error", e.message); } finally { setBusy(null); } };
  return (
    <div className="space-y-4">
      <Link href="/inventario" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" />Inventarios</Link>
      <PageHeader area="Almacén · Trazabilidad" title={`Trazabilidad del lote ${t.code}`} subtitle={`${t.product.name} · ${kg(t.quantityKg)}${t.bags ? ` · ${t.bags} sacos` : ""}`}
        actions={<>
          <StatusBadge status={t.qualityStatus} /><StatusBadge status={t.chainStatus} label={`Blockchain: ${t.chainStatus.replace("_", " ").toLowerCase()}`} />
          {t.type === "PRODUCTO_TERMINADO" && can("blockchain.read") && <Button variant="outline" loading={busy === "v"} onClick={doVerify}><ShieldCheck className="h-4 w-4" />Verificar en blockchain</Button>}
          {t.type === "PRODUCTO_TERMINADO" && t.chainStatus !== "REGISTRADO" && <Can perm="blockchain.write"><Button variant="secondary" loading={busy === "a"} onClick={anchor}><Link2 className="h-4 w-4" />Registrar hash en blockchain</Button></Can>}
          <Can perm="reports.read"><Button onClick={() => download(`/reports/traceability/${t.code}.pdf`, `trazabilidad-${t.code}.pdf`).catch((e) => toast.error("Error", e.message))}><FileDown className="h-4 w-4" />Reporte PDF</Button></Can>
        </>} />
      {verify && (
        <Card className={verify.registered && verify.dataMatches && verify.certMatches ? "border-emerald-300" : "border-red-300"}>
          <CardHeader title="Verificación contra la blockchain local" icon={verify.registered && verify.dataMatches ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-red-600" />} subtitle={verify.verdict ?? verify.message} />
          {verify.registered && <CardBody><KeyValue items={[["Hash de datos recalculado (ERP)", <Mono key="1">{verify.recomputedDataHash}</Mono>], ["Hash de datos on-chain", <Mono key="2">{verify.onchain.lotDataHash}</Mono>], ["Hash certificado (ERP)", <Mono key="3">{verify.erpCertHash ?? "—"}</Mono>], ["Hash certificado on-chain", <Mono key="4">{verify.onchain.qualityCertHash}</Mono>], ["Calidad on-chain", <StatusBadge key="5" status={verify.onchain.quality} />], ["Registrado por", <Mono key="6">{verify.onchain.registeredBy}</Mono>], ["Versión", verify.onchain.version], ["Fecha de registro", dateTime(verify.onchain.registeredAt)]]} /></CardBody>}
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card><CardHeader title="Origen agrícola" icon={<Sprout className="h-4 w-4" />} /><CardBody>
          {t.campaign ? <KeyValue cols={1} items={[["Campaña", <Link key="c" className="text-paprika hover:underline" href={`/agricultura/campanas/${t.campaign.id}`}>{t.campaign.code} · {t.campaign.variety}</Link>], ["Parcela", `${t.campaign.parcel.code} ${t.campaign.parcel.name} — ${t.campaign.parcel.location}`], ["Cosecha", t.harvest ? `${t.harvest.code} · ${kg(t.harvest.quantityKg)} · ${date(t.harvest.date)}` : t.parentLot?.harvest ? `${t.parentLot.harvest.code} · ${kg(t.parentLot.harvest.quantityKg)} · ${date(t.parentLot.harvest.date)}` : "—"], ["Lote de materia prima", t.parentLot ? <Link key="p" className="text-paprika hover:underline" href={`/inventario/lotes/${t.parentLot.code}`}>{t.parentLot.code}</Link> : t.type === "MATERIA_PRIMA" ? "(este lote)" : "—"], ["Lotes derivados", t.childLots.map((c: any) => c.code).join(", ") || "—"]]} /> : <p className="text-sm text-muted">Sin campaña asociada</p>}
        </CardBody></Card>
        <Card><CardHeader title="Procesamiento" icon={<Factory className="h-4 w-4" />} /><CardBody>
          {t.productionOrder ? <KeyValue cols={1} items={[["Orden", <Link key="o" className="text-paprika hover:underline" href={`/produccion/${t.productionOrder.id}`}>{t.productionOrder.code}</Link>], ["Pesos", `${kg(t.productionOrder.initialWeightKg)} → ${kg(t.productionOrder.finalWeightKg)}`], ["Merma / rendimiento", `${kg(t.productionOrder.wasteKg)} · ${num(t.productionOrder.yieldPct, 2)} %`], ["Secado", `${num(t.productionOrder.dryingTempC, 0)} °C · ${num(t.productionOrder.dryingHours, 0)} h`], ["Producción / vencimiento", `${date(t.productionDate)} / ${date(t.expiryDate)}`]]} /> : <p className="text-sm text-muted">{t.type === "MATERIA_PRIMA" ? `Consumido en producción: ${kg(t.consumedKg)} de ${kg(t.quantityKg)}` : "—"}</p>}
        </CardBody></Card>
        <Card><CardHeader title="Stock actual" icon={<Boxes className="h-4 w-4" />} /><CardBody>
          <KeyValue cols={1} items={[["Disponible", kg(stock.a, 1)], ["Reservado", kg(stock.r, 1)], ["Cuarentena / bloqueado", kg(stock.q, 1)], ["Estado del lote", <StatusBadge key="s" status={t.status} />]]} />
          {["RECHAZADO", "CUARENTENA"].includes(t.qualityStatus) && <div className="mt-3"><Notice tone="red">Lote bloqueado: no puede reservarse ni despacharse.</Notice></div>}
        </CardBody></Card>
      </div>
      <Card><CardHeader title="Control de calidad" icon={<ShieldCheck className="h-4 w-4" />} />
        <Table rows={t.inspections} columns={[
          { key: "code", header: "Inspección" }, { key: "d", header: "Fecha", render: (r: any) => dateTime(r.date) }, { key: "i", header: "Inspector", render: (r: any) => r.inspector.name },
          { key: "res", header: "Resultados", render: (r: any) => `H ${r.moisturePct ?? "—"}% · ASTA ${r.astaColor ?? "—"} · G ${r.granulometry ?? "—"}%` },
          { key: "m", header: "Micro/contam.", render: (r: any) => `${r.microbiological} / ${r.contaminants}` },
          { key: "coa", header: "COA (SHA-256)", render: (r: any) => r.coaDocument ? <Mono>{short(r.coaDocument.sha256, 12)}</Mono> : "Informe interno" },
          { key: "s", header: "Decisión", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "by", header: "Por", render: (r: any) => r.decidedBy?.name ?? "—" },
        ]} />
      </Card>
      <Card><CardHeader title="Movimientos (kardex del lote)" icon={<Boxes className="h-4 w-4" />} />
        <Table rows={t.movements} columns={[
          { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "type", header: "Movimiento", render: (r: any) => r.type.replace(/_/g, " ").toLowerCase() },
          { key: "q", header: "kg", align: "right", render: (r: any) => num(r.quantityKg, 1) }, { key: "w", header: "Almacén", render: (r: any) => r.warehouse.code },
          { key: "ref", header: "Referencia", render: (r: any) => r.referenceCode }, { key: "reason", header: "Motivo", render: (r: any) => <span className="text-xs text-muted">{r.reason}</span> }, { key: "u", header: "Usuario", render: (r: any) => r.user.name },
        ]} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Ventas y despachos" icon={<Truck className="h-4 w-4" />} />
          <Table rows={t.salesOrderItems} columns={[
            { key: "o", header: "Pedido", render: (r: any) => <Link className="text-paprika hover:underline" href={`/ventas/pedidos/${r.order.id}`}>{r.order.code}</Link> }, { key: "c", header: "Cliente", render: (r: any) => r.order.customer.name },
            { key: "q", header: "Cantidad", render: (r: any) => `${num(r.quantity, 0)} ${r.unit === "SACO" ? "sacos" : "kg"}` }, { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.order.status} /> },
            { key: "d", header: "Despacho", render: (r: any) => r.order.dispatches.map((d: any) => `${d.code} (${d.status})`).join(", ") || "—" },
          ]} />
        </Card>
        <Card><CardHeader title="Transacciones blockchain" icon={<Link2 className="h-4 w-4" />} />
          <Table rows={t.chainTxs} columns={[
            { key: "f", header: "Función", render: (r: any) => r.functionName }, { key: "a", header: "Actor", render: (r: any) => r.actor },
            { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> }, { key: "b", header: "Bloque", render: (r: any) => r.blockNumber ?? "—" },
            { key: "h", header: "Hash", render: (r: any) => r.txHash ? <Mono>{short(r.txHash)}</Mono> : <span className="text-xs text-red-600">{r.errorMessage}</span> },
          ]} />
        </Card>
      </div>
    </div>
  );
}
