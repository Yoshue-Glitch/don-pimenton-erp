"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Anchor, Clock, AlertTriangle, CheckCircle2, Ship } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { dateTime, num } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, StatusBadge, Kpi, Notice, Loading } from "@/components/ui";
import { Table } from "@/components/DataTable";
import { ShipMap } from "@/components/ShipMap";

/** Seguimiento aduanero (TI-10 módulo 7): DAM, canal, levante, B/L, manifiesto, contenedor y semáforo R4/R5. */
export default function Aduanas() {
  const { data, loading, reload } = useApi<any[]>("/trade/shipments");
  const router = useRouter();
  React.useEffect(() => { const t = setInterval(reload, 4000); return () => clearInterval(t); }, [reload]);
  if (loading && !data) return <Loading />;
  const rows = (data ?? []).filter((s) => s.status !== "COTIZACION");
  const sailing = rows.find((s) => s.status === "EN_TRANSITO") ?? rows.find((s) => ["ARRIBADO", "ENTREGADO"].includes(s.status));
  const count = (l: string) => rows.filter((s) => s.customs.light === l).length;
  return (
    <div className="space-y-4">
      <PageHeader area="Comercio exterior · R4, R5 y R6" title="Seguimiento aduanero" subtitle="Semáforo de plazos de la DAM (verde ≤ 20 días, ámbar 21–27, rojo ≥ 28) y alertas de regularización a los 20, 25 y 28 días. El agente de aduana solo ve sus embarques autorizados." icon={<Anchor className="h-5 w-5" />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi tone="green" icon={<CheckCircle2 />} label="En verde" value={count("VERDE")} hint="Dentro del plazo" />
        <Kpi tone="amber" icon={<Clock />} label="En ámbar" value={count("AMBAR")} hint="Días 21–27 / regularización" />
        <Kpi tone="red" icon={<AlertTriangle />} label="En rojo" value={count("ROJO")} hint="Desde el día 28" />
        <Kpi tone="blue" icon={<Ship />} label="Regularizadas" value={count("REGULARIZADO")} hint={`${num(rows.filter((s) => s.damNumber).length)} DAM registradas`} />
      </div>
      {sailing && <ShipMap status={sailing.status} progress={sailing.voyageProgress} vessel={sailing.vessel} code={sailing.code} height={380} />}
      <Card>
        <CardHeader title="Embarques" subtitle="Haga clic para registrar DAM, canal, levante, B/L y regularización" />
        <Table rows={rows} onRowClick={(r: any) => router.push(`/comex/${r.id}`)} columns={[
          { key: "code", header: "Embarque", render: (r: any) => <b>{r.code}</b> }, { key: "dam", header: "DAM", render: (r: any) => r.damNumber ?? "—" },
          { key: "num", header: "Numeración", render: (r: any) => dateTime(r.damDate) }, { key: "ch", header: "Canal", render: (r: any) => r.channel ?? "—" },
          { key: "bl", header: "B/L", render: (r: any) => r.blNumber ?? "—" }, { key: "ct", header: "Contenedor", render: (r: any) => r.container ?? "—" },
          { key: "sh", header: "Embarque", render: (r: any) => dateTime(r.shipDate) }, { key: "rg", header: "Regularización", render: (r: any) => dateTime(r.regularizedAt) },
          { key: "ph", header: "Plazo", render: (r: any) => <span className="text-xs">{r.customs.phase}</span> }, { key: "l", header: "Semáforo", render: (r: any) => <StatusBadge status={r.customs.light} /> },
        ]} />
      </Card>
      <Notice>Los plazos son configurables (Configuración → parámetros de exportación) y deben validarse con la normativa vigente (DESPA-PG.02) y el agente de aduana antes del uso real. El ERP prepara los datos; la numeración y transmisión oficial corresponden al agente.</Notice>
    </div>
  );
}
