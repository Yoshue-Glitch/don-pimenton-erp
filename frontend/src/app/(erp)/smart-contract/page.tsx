"use client";
import Link from "next/link";
import { FileSignature, ArrowUpRight, PlayCircle, Link2 } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { money, date } from "@/lib/utils";
import { Card, CardHeader, CardBody, StatusBadge, Badge, Notice } from "@/components/ui";
import { Table } from "@/components/DataTable";

const usd = (v: number) => `US$ ${Math.round(v).toLocaleString("en-US")}`;

export default function SmartContractPage() {
  const exp = useApi<any>("/exports/orders?pageSize=50");
  const orders = useApi<any>("/sales/orders?status=RESERVADO&pageSize=50");
  const status = useApi<any>("/blockchain/status");
  const pendingExports = (exp.data?.items ?? []).filter((r: any) => !["ENTREGADA", "COBRADA", "ANULADA"].includes(r.status));
  const reserved = (orders.data?.items ?? []).filter((o: any) => !o.agreements.length);
  const s = status.data;
  return (
    <div className="space-y-[18px]">
      <section className="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_85%_20%,rgba(165,42,42,.6),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] px-6 py-10 text-white sm:px-12 sm:py-14">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth=".5" className="absolute -bottom-16 -right-10 w-[360px] opacity-[.12]" aria-hidden>
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        <span className="text-[11px] font-bold uppercase tracking-[.26em] text-[#F2C9C0]">Departamento de Exportaciones</span>
        <h1 className="my-4 max-w-[17ch] font-display text-[clamp(30px,4.6vw,50px)] font-bold leading-[1.08]">Exporta con <i className="font-medium text-[#F2B8AC]">contratos inteligentes</i></h1>
        <p className="mb-8 max-w-[560px] text-[15.5px] leading-relaxed text-white/85">Acuerdos comerciales registrados en blockchain: la calidad del lote, la entrega y la confirmación del comprador se verifican en el contrato, y el pago solo se libera cuando se cumplen todas las condiciones.</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/blockchain" className="inline-flex items-center gap-3 rounded-xl bg-white px-8 py-[18px] text-base font-extrabold text-forest shadow-[0_18px_40px_-14px_rgba(0,0,0,.5)] transition-all hover:-translate-y-0.5 hover:bg-paprika-50">
            <FileSignature className="h-[22px] w-[22px] text-paprika" />Smart Contract<ArrowUpRight className="h-[22px] w-[22px] text-paprika" />
          </Link>
          <Link href="/demo" className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-6 py-[18px] font-bold text-white hover:bg-white/10"><PlayCircle className="h-5 w-5" />Ver la demostración</Link>
        </div>
        <p className="relative mt-6 flex items-center gap-2 text-xs text-white/60"><Link2 className="h-3.5 w-3.5" />
          {s ? (s.connected ? `Red local conectada · chainId ${s.chainId} · bloque #${s.blockNumber} · fondos de prueba sin valor real` : "Red blockchain local no disponible en este momento") : "Consultando la red local…"}
        </p>
      </section>
      <div className="grid gap-[18px] md:grid-cols-3">
        {[["01", "Se pactan las condiciones", "Lote, cantidad, importe, fecha límite y comprador quedan registrados en el contrato y no se pueden alterar."],
          ["02", "Se verifica el cumplimiento", "Calidad registra la conformidad del lote (contrastada con su hash de trazabilidad), logística la entrega y el comprador la recepción."],
          ["03", "El pago se libera solo", "Con todas las condiciones cumplidas, el contrato libera los fondos; si el lote es rechazado o falta la confirmación, el pago queda bloqueado."]].map(([n, t, d]) => (
          <div key={n} className="rounded-2xl border border-line bg-card p-[22px] shadow-card">
            <span className="font-display text-[30px] italic leading-none text-paprika">{n}</span>
            <h4 className="mb-1.5 mt-2.5 text-[15px] font-bold text-fg">{t}</h4>
            <p className="text-[13px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHeader title="Embarques candidatos a Smart Contract" actions={<Link href="/exportaciones" className="text-xs font-semibold text-bluex">Ver exportaciones →</Link>} />
        <Table rows={pendingExports} empty={<CardBody><p className="text-sm text-muted">No hay embarques pendientes.</p></CardBody>} columns={[
          { key: "code", header: "Código", render: (r: any) => <Link href={`/exportaciones/${r.id}`} className="font-bold hover:underline">{r.code}</Link> },
          { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "d", header: "Destino", render: (r: any) => r.destinationCountry },
          { key: "i", header: "Incoterm", render: (r: any) => r.incoterm }, { key: "v", header: "Valor", align: "right", render: (r: any) => <b>{r.currency === "USD" ? usd(Number(r.amount)) : money(r.amount, r.currency)}</b> },
          { key: "docs", header: "Documentos", render: (r: any) => { const ok = r.requirements.filter((x: any) => ["VERIFICADO", "NO_APLICA"].includes(x.status)).length; return <Badge tone={ok === r.requirements.length ? "green" : "amber"}>{ok === r.requirements.length ? "Completo" : `${ok}/${r.requirements.length}`}</Badge>; } },
          { key: "s", header: "Estado", render: (r: any) => <StatusBadge status={r.status} /> },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Pedidos nacionales listos para acuerdo inteligente" subtitle="Pedidos reservados de un único lote aprobado" />
        <Table rows={reserved} empty={<CardBody><p className="text-sm text-muted">No hay pedidos reservados sin acuerdo.</p></CardBody>} columns={[
          { key: "code", header: "Pedido", render: (r: any) => <Link href={`/ventas/pedidos/${r.id}`} className="font-bold hover:underline">{r.code}</Link> },
          { key: "c", header: "Cliente", render: (r: any) => r.customer.name }, { key: "d", header: "Fecha", render: (r: any) => date(r.date) },
          { key: "t", header: "Total", align: "right", render: (r: any) => money(r.total, r.currency) },
          { key: "a", header: "", align: "right", render: (r: any) => <Link href={`/ventas/pedidos/${r.id}`} className="text-xs font-semibold text-bluex">Crear acuerdo →</Link> },
        ]} />
      </Card>
      <Notice>Los contratos se ejecutan en una red Ethereum local (Hardhat) con moneda de prueba sin valor económico. Para operar con dinero real se requeriría una red pública, billeteras propias de cada parte y una auditoría de seguridad de los contratos.</Notice>
    </div>
  );
}
