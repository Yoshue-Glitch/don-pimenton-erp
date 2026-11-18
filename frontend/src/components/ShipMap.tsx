"use client";
/**
 * Mapa animado de trazabilidad del embarque: Parcela (Caravelí) → Planta (Arequipa) → Callao →
 * Canal de Panamá → Canal de Yucatán → Estrecho de Florida → Port Everglades.
 * Geografía real (Natural Earth vía world-atlas) con proyección Mercator (d3-geo).
 * La posición del barco proviene del ERP (voyageProgress) y se anima suavemente entre lecturas.
 */
import * as React from "react";
import { geoMercator, geoPath, geoInterpolate, geoDistance, geoGraticule10 } from "d3-geo";
import { feature } from "topojson-client";
import { cn } from "@/lib/utils";

type LonLat = [number, number];
const PLACES: Record<string, { at: LonLat; label: string; sub: string }> = {
  parcela: { at: [-73.36, -15.77], label: "Parcela", sub: "Caravelí, Arequipa" },
  planta: { at: [-71.54, -16.4], label: "Planta", sub: "Arequipa" },
  callao: { at: [-77.15, -12.05], label: "Puerto del Callao", sub: "PECLL · DAM 118" },
  panama: { at: [-79.7, 9.1], label: "Canal de Panamá", sub: "Balboa → Colón" },
  destino: { at: [-80.12, 26.09], label: "Port Everglades", sub: "Florida · USPEF" },
};
const LAND: LonLat[] = [PLACES.parcela.at, [-72.6, -16.2], PLACES.planta.at, [-73.4, -15.2], [-75.6, -14.1], [-76.3, -13.3], PLACES.callao.at];
const SEA: LonLat[] = [PLACES.callao.at, [-79.2, -9.5], [-81.6, -4.5], [-81.2, 1.2], [-79.9, 6.4], [-79.55, 8.85], [-79.9, 9.4], [-80.6, 12.8], [-83.2, 17.2], [-85.1, 21.4], [-84.2, 23.4], [-81.6, 24.15], [-80.1, 24.8], [-79.9, 25.6], PLACES.destino.at];

function segments(points: LonLat[]) {
  const segs = points.slice(1).map((p, i) => ({ a: points[i], b: p, d: geoDistance(points[i], p) }));
  const total = segs.reduce((s, x) => s + x.d, 0);
  return { segs, total };
}
function pointAt(points: LonLat[], t: number): { p: LonLat; heading: LonLat } {
  const { segs, total } = segments(points);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (const s of segs) {
    if (target <= s.d || s === segs[segs.length - 1]) {
      const f = s.d ? Math.min(1, target / s.d) : 0;
      const ip = geoInterpolate(s.a, s.b);
      return { p: ip(f), heading: ip(Math.min(1, f + 0.02)) };
    }
    target -= s.d;
  }
  return { p: points[points.length - 1], heading: points[points.length - 1] };
}
function slice(points: LonLat[], t: number): LonLat[] {
  const { segs, total } = segments(points);
  let target = Math.max(0, Math.min(1, t)) * total;
  const out: LonLat[] = [points[0]];
  for (const s of segs) {
    if (target >= s.d) { out.push(s.b); target -= s.d; continue; }
    out.push(geoInterpolate(s.a, s.b)(s.d ? target / s.d : 0));
    break;
  }
  return out;
}

export type MapPhase = "PLANTA" | "TERRESTRE" | "MAR" | "DESTINO";
export function phaseOf(status?: string | null): MapPhase {
  if (!status) return "PLANTA";
  if (["EN_TRANSITO", "DESPACHADO"].includes(status)) return "MAR";
  if (["ARRIBADO", "ENTREGADO", "CERRADO"].includes(status)) return "DESTINO";
  if (["CONFIRMADO", "DOCUMENTACION"].includes(status)) return "TERRESTRE";
  return "PLANTA";
}

export function ShipMap({ status, progress = 0, vessel, code, className, height = 460, milestones = [] }: { status?: string | null; progress?: number; vessel?: string | null; code?: string; className?: string; height?: number; milestones?: { stage: string }[] }) {
  const [world, setWorld] = React.useState<any>(null);
  const [shown, setShown] = React.useState(progress);
  const [truck, setTruck] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    import("world-atlas/countries-50m.json").then((m: any) => { if (alive) setWorld(feature(m.default ?? m, (m.default ?? m).objects.countries)); });
    return () => { alive = false; };
  }, []);
  // animación suave hacia el progreso que reporta el ERP
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      setShown((s) => (Math.abs(progress - s) < 0.0005 ? progress : s + (progress - s) * 0.06));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress]);
  const phase = phaseOf(status);
  // camión que recorre la ruta terrestre en bucle mientras se prepara el embarque
  React.useEffect(() => {
    if (phase !== "TERRESTRE" && phase !== "PLANTA") return;
    const id = setInterval(() => setTruck((t) => (t >= 1 ? 0 : t + 0.01)), 60);
    return () => clearInterval(id);
  }, [phase]);

  const W = 900, H = 620;
  const proj = React.useMemo(() => geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: "MultiPoint", coordinates: [[-93, -19.5], [-66, 29.5]] } as any), []);
  const path = React.useMemo(() => geoPath(proj), [proj]);
  const line = (pts: LonLat[]) => path({ type: "LineString", coordinates: pts } as any) ?? "";
  const xy = (p: LonLat) => proj(p) ?? [0, 0];

  const seaT = phase === "MAR" ? shown : phase === "DESTINO" ? 1 : 0;
  const ship = pointAt(SEA, seaT);
  const [sx, sy] = xy(ship.p);
  const [hx, hy] = xy(ship.heading);
  const angle = (Math.atan2(hy - sy, hx - sx) * 180) / Math.PI;
  const tr = pointAt(LAND, phase === "TERRESTRE" ? truck : phase === "PLANTA" ? truck * 0.35 : 1);
  const [tx, ty] = xy(tr.p);
  const done = new Set(milestones.map((m) => m.stage));
  const km = Math.round(segments(SEA).total * 6371);

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-[#0f2a3a]", className)} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Mapa de la ruta del embarque ${code ?? ""}`}>
        <defs>
          <radialGradient id="sea" cx="45%" cy="40%" r="80%"><stop offset="0%" stopColor="#1d5b78" /><stop offset="100%" stopColor="#0b2233" /></radialGradient>
          <linearGradient id="routeDone" x1="0" x2="1"><stop offset="0%" stopColor="#D9A441" /><stop offset="100%" stopColor="#F2C9C0" /></linearGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width={W} height={H} fill="url(#sea)" />
        <path d={path(geoGraticule10() as any) ?? ""} fill="none" stroke="#ffffff" strokeOpacity={0.05} />
        {world?.features.map((f: any, i: number) => (
          <path key={i} d={path(f) ?? ""} fill={["Peru", "United States of America"].includes(f.properties?.name) ? "#3E7A55" : "#24493a"} stroke="#0b2233" strokeWidth={0.6} opacity={0.95} />
        ))}
        {/* ruta terrestre (camión) */}
        <path d={line(LAND)} fill="none" stroke="#F8F5EF" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="4 5" />
        {/* ruta marítima pendiente (animada) y recorrida */}
        <path d={line(SEA)} fill="none" stroke="#9DBFA6" strokeOpacity={0.6} strokeWidth={2.2} strokeDasharray="7 7" className="dp-dash" />
        {seaT > 0 && <path d={line(slice(SEA, seaT))} fill="none" stroke="url(#routeDone)" strokeWidth={4} strokeLinecap="round" filter="url(#glow)" />}
        {/* lugares */}
        {Object.entries(PLACES).map(([k, pl]) => {
          const [x, y] = xy(pl.at);
          const right = k === "destino" || k === "panama";
          const active = (k === "destino" && phase === "DESTINO") || (k === "callao" && phase === "TERRESTRE") || ((k === "parcela" || k === "planta") && phase === "PLANTA");
          return (
            <g key={k}>
              {active && <circle cx={x} cy={y} r={10} fill="#D9A441" opacity={0.5} className="dp-ping" />}
              <circle cx={x} cy={y} r={5.5} fill={k === "destino" ? "#A52A2A" : "#D9A441"} stroke="#fff" strokeWidth={1.5} />
              <text x={right ? x + 10 : x - 10} y={y - 6} textAnchor={right ? "start" : "end"} className="fill-white text-[13px] font-bold" style={{ paintOrder: "stroke", stroke: "#0b2233", strokeWidth: 3 }}>{pl.label}</text>
              <text x={right ? x + 10 : x - 10} y={y + 9} textAnchor={right ? "start" : "end"} className="fill-[#cfe3da] text-[10.5px]" style={{ paintOrder: "stroke", stroke: "#0b2233", strokeWidth: 3 }}>{pl.sub}</text>
            </g>
          );
        })}
        {/* camión */}
        {phase !== "MAR" && phase !== "DESTINO" && (
          <g transform={`translate(${tx},${ty})`}>
            <rect x={-9} y={-6} width={13} height={9} rx={1.5} fill="#F8F5EF" /><rect x={4} y={-3} width={6} height={6} rx={1} fill="#D9A441" />
            <circle cx={-5} cy={4} r={2} fill="#1F2937" /><circle cx={6} cy={4} r={2} fill="#1F2937" />
          </g>
        )}
        {/* barco */}
        {(phase === "MAR" || phase === "DESTINO" || phase === "TERRESTRE") && (
          <g transform={`translate(${phase === "TERRESTRE" ? xy(PLACES.callao.at)[0] : sx},${phase === "TERRESTRE" ? xy(PLACES.callao.at)[1] : sy})`}>
            {phase === "MAR" && <circle r={16} fill="#ffffff" opacity={0.12} className="dp-ping" />}
            <g transform={`rotate(${phase === "MAR" ? angle : -30})`} className={phase === "MAR" ? "dp-bob" : ""}>
              <path d="M-16 -5 L10 -5 L17 0 L10 5 L-16 5 Z" fill="#A52A2A" stroke="#fff" strokeWidth={1.2} />
              <rect x={-12} y={-3.5} width={5} height={7} fill="#D9A441" /><rect x={-6} y={-3.5} width={5} height={7} fill="#2F6B45" /><rect x={0} y={-3.5} width={5} height={7} fill="#2B6CB0" />
              {phase === "MAR" && <path d="M-17 0 L-34 -6 M-17 0 L-34 6" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.2} />}
            </g>
          </g>
        )}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-black/45 px-3 py-2 text-white backdrop-blur">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#F2C9C0]">Ruta del embarque {code}</p>
        <p className="text-sm font-bold">{phase === "MAR" ? `Navegando · ${Math.round(shown * 100)} %` : phase === "DESTINO" ? "En destino · Port Everglades" : phase === "TERRESTRE" ? "En puerto del Callao · preparando embarque" : "En planta · producción y envasado"}</p>
        <p className="text-[11px] text-white/75">{vessel ?? "Nave por asignar"} · {km.toLocaleString("es-PE")} km por mar vía Canal de Panamá</p>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
        {["PARCELA", "COSECHA", "PRODUCCION", "CALIDAD", "ENVASADO", "PALETA", "EMBARQUE", "ENTREGA"].map((s) => (
          <span key={s} className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold backdrop-blur", done.has(s) ? "bg-[#D9A441] text-[#1F2937]" : "bg-black/40 text-white/70")}>{done.has(s) ? "⛓ " : ""}{s.charAt(0) + s.slice(1).toLowerCase()}</span>
        ))}
      </div>
    </div>
  );
}
