import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const pen = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 });
const usd = new Intl.NumberFormat("es-PE", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const nf = (d = 0) => new Intl.NumberFormat("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });

export const money = (v: unknown, cur = "PEN") => {
  const n = Number(v ?? 0);
  if (cur === "USD") return usd.format(n);
  if (cur === "PEN") return pen.format(n).replace("PEN", "S/");
  return `${cur} ${nf(2).format(n)}`;
};
export const num = (v: unknown, d = 0) => nf(d).format(Number(v ?? 0));
export const kg = (v: unknown, d = 0) => `${nf(d).format(Number(v ?? 0))} kg`;
export const bags = (v: unknown, bag = 25) => `${nf(Number(v) % bag === 0 ? 0 : 1).format(Number(v ?? 0) / bag)} sacos`;
export const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const dateTime = (v: unknown) => (v ? new Date(String(v)).toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const short = (h?: string | null, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : "—");
export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Identificación de un trabajador: su nombre si lo tiene; si no, el cargo (puestos sin nombre de persona). */
export const workerLabel = (w?: { firstName?: string | null; lastName?: string | null; position?: string | null; code?: string } | null) => {
  if (!w) return "—";
  const name = [w.firstName, w.lastName].filter(Boolean).join(" ").trim();
  return name ? `${name}${w.position ? ` · ${w.position}` : ""}` : `${w.position ?? "Puesto"}${w.code ? ` (${w.code})` : ""}`;
};
