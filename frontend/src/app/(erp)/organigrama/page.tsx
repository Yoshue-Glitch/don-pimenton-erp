"use client";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { PageHeader, Loading } from "@/components/ui";

type NodeKind = "" | "top" | "ext" | "new" | "partner";
function Node({ kind = "", title, sub, href, count, left }: { kind?: NodeKind; title: string; sub: string; href?: string; count?: number; left?: boolean }) {
  const cls = cn(
    "block rounded-xl border px-4 py-3.5 transition-transform",
    left ? "text-left" : "text-center",
    href && "hover:-translate-y-0.5",
    kind === "top" && "border-paprika-700 bg-paprika-700 py-[18px] text-white",
    kind === "ext" && "border-[1.5px] border-dashed border-slate-400 bg-[#EEF1F4] dark:bg-white/5",
    kind === "new" && "relative border-paprika bg-paprika text-white",
    kind === "partner" && "mt-3.5 border-[1.5px] border-dashed border-gold bg-[#FDF3DC] dark:bg-gold/10",
    kind === "" && "border-[#E2D2B6] bg-beige dark:border-line dark:bg-soft",
  );
  const body = (
    <>
      {kind === "new" && <span className="absolute -top-2.5 right-2.5 rounded-full bg-gold px-2 py-0.5 text-[10px] font-extrabold text-white">NUEVO</span>}
      <b className="block text-sm">{title}</b>
      <small className={cn("mt-0.5 block text-xs", kind === "top" ? "text-[#F4D7D2]" : kind === "new" ? "text-[#F7D9D3]" : "text-muted")}>{sub}</small>
      {count !== undefined && <span className={cn("mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold", kind === "top" || kind === "new" ? "bg-white/20 text-white" : "bg-white/60 text-forest dark:bg-white/10 dark:text-emerald-200")}>{count} colaborador{count === 1 ? "" : "es"}</span>}
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Column({ head, children, exp }: { head: React.ReactNode; children: React.ReactNode; exp?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      {head}
      <div className={cn("flex flex-col gap-2.5 border-l-2 border-paprika-700 pl-3", exp && "[&_b]:text-paprika-700 dark:[&_b]:text-red-200")}>{children}</div>
    </div>
  );
}

export default function Organigrama() {
  const { data, loading } = useApi<any>("/dashboard/org");
  if (loading && !data) return <Loading />;
  const hc = (code: string) => data?.areas.find((a: any) => a.code === code)?.headcount ?? 0;
  const gm = data?.generalManager ?? "Martha Torres";
  return (
    <div>
      <PageHeader area="Estructura organizacional" title="Organigrama" subtitle="Cada área del organigrama tiene su módulo en el ERP. Haga clic en un área para abrirlo." />
      <div className="rounded-[18px] border border-line bg-card p-5 shadow-card sm:p-7">
        <div className="mb-7 grid items-center gap-5 md:grid-cols-[1fr_1.1fr_1fr]">
          <Node kind="ext" title="Asesoría externa" sub="Contador · asesor legal y laboral" href="/finanzas" />
          <Node kind="top" title="Gerencia General" sub={`Titular: Sra. ${gm}`} href="/" count={hc("GER")} />
          <Node title="Asistente administrativo y de RR.HH." sub="Staff de la Gerencia" href="/rrhh" />
        </div>
        <div className="grid gap-[18px] border-t-2 border-paprika-700 pt-[22px] sm:grid-cols-2 xl:grid-cols-5">
          <Column head={<Node title="Área Agrícola y Mantenimiento" sub="Responsable agrícola" href="/agricultura" count={hc("AGR")} />}>
            <Node left title="Personal de campo" sub="Permanente" href="/agricultura" />
            <Node left title="Personal de cosecha" sub="Por campaña (temporal)" href="/rrhh" />
            <Node left title="Mantenimiento" sub="Riego, maquinaria y parcelas" href="/agricultura" />
          </Column>
          <Column head={<Node title="Área de Procesamiento y Calidad" sub="Jefatura de planta" href="/produccion" count={hc("PRO")} />}>
            <Node left title="Producción" sub="Secado, molienda y envasado" href="/produccion" />
            <Node left title="Control de calidad e inocuidad" sub="Laboratorio y trazabilidad" href="/calidad" />
            <Node left title="Almacén" sub="Inventario y kardex" href="/inventario" />
          </Column>
          <Column head={<Node title="Área Comercial y Logística" sub="Responsable comercial" href="/ventas" count={hc("COM")} />}>
            <Node left title="Ventas nacionales" sub="Mayoristas de Arequipa" href="/ventas" />
            <Node left title="Clientes" sub="Cartera y cobranza" href="/ventas?tab=clientes" />
            <Node left title="Logística y despacho" sub="Transporte y entrega" href="/logistica" />
          </Column>
          <Column head={<Node title="Administración y Finanzas" sub="Área proyectada" href="/finanzas" count={hc("FIN") + hc("RRHH")} />}>
            <Node left title="Finanzas y tesorería" sub="Ingresos, egresos y caja" href="/finanzas" />
            <Node left title="Compras" sub="Proveedores e insumos" href="/compras" />
            <Node left title="Recursos Humanos" sub="Personal y planilla" href="/rrhh" />
          </Column>
          <Column exp head={<Node kind="new" title="Departamento de Exportaciones" sub="Área proyectada" href="/exportaciones" count={hc("EXP")} />}>
            <Node left title="Cuentas internacionales" sub="Clientes importadores" href="/exportaciones" />
            <Node left title="Marketing digital y marca" sub="Campañas y prospectos" href="/marketing" />
            <Node left title="Logística y documentación" sub="Embarques y requisitos" href="/exportaciones" />
            <Node kind="partner" title="Socio comercial de exportación" sub="Exportador o trading consolidador (Perú) · Food Broker (EE. UU.)" href="/smart-contract" />
          </Column>
        </div>
        <div className="mt-[22px] flex flex-wrap gap-[22px] text-xs text-muted">
          <span className="flex items-center gap-2"><i className="w-[26px] border-t-2 border-paprika-700" />Autoridad lineal</span>
          <span className="flex items-center gap-2"><i className="w-[26px] border-t-2 border-dashed border-slate-400" />Asesoría (staff)</span>
          <span className="flex items-center gap-2"><i className="w-[26px] border-t-2 border-dashed border-gold" />Socio comercial externo</span>
          <span className="flex items-center gap-2"><i className="h-3.5 w-3.5 rounded-[3px] bg-paprika" />Unidad nueva</span>
        </div>
      </div>
    </div>
  );
}
