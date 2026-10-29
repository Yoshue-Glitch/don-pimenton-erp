"use client";
import { Sprout, CalendarDays, Layers, Leaf, Factory, CheckCircle2, TrendingUp, Coins, FlaskConical, Tag, AlertTriangle, ShoppingCart, Banknote, Truck, Users, Box, Globe2, Ship } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { kg, money, num } from "@/lib/utils";
import { Kpi } from "./ui";

const ICONS: Record<string, any> = { sprout: Sprout, calendar: CalendarDays, layers: Layers, leaf: Leaf, factory: Factory, check: CheckCircle2, trend: TrendingUp, coins: Coins, flask: FlaskConical, tag: Tag, alert: AlertTriangle, cart: ShoppingCart, money: Banknote, truck: Truck, users: Users, box: Box, globe: Globe2, ship: Ship };
const fmt = (v: any, unit?: string) => (unit === "kg" ? kg(v) : unit === "pen" ? money(v) : unit === "usd" ? `US$ ${Math.round(v).toLocaleString("en-US")}` : unit === "pct" ? `${num(v, 1)}%` : num(v));

/** Fila de indicadores de cabecera de un módulo (estilo del panel de Gerencia). */
export function ModuleKpis({ module, reloadKey }: { module: string; reloadKey?: unknown }) {
  const { data } = useApi<any[]>(`/dashboard/kpis/${module}`, [reloadKey]);
  if (!data?.length) return null;
  return (
    <div className="mb-[18px] grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
      {data.map((k) => { const I = ICONS[k.icon] ?? CheckCircle2; return <Kpi key={k.label} tone={k.tone} icon={<I />} label={k.label} value={fmt(k.value, k.unit)} hint={k.hint} />; })}
    </div>
  );
}
