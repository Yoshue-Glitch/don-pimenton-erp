"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, X, Inbox, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ Button
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-bold transition-all active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paprika/40",
  {
    variants: {
      variant: {
        primary: "bg-paprika text-white hover:bg-paprika-700 shadow-sm",
        secondary: "bg-forest text-white hover:bg-forest-2 shadow-sm",
        outline: "border border-line bg-card hover:border-agro text-fg",
        ghost: "hover:bg-soft text-fg",
        danger: "bg-red-600 text-white hover:bg-red-700",
        gold: "bg-gold text-ink hover:brightness-95",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-10 px-[18px]", lg: "h-12 px-7 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
));
Button.displayName = "Button";

// ------------------------------------------------------------------ Card
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-2xl border border-line bg-card shadow-card", className)} {...p} />;
}
export function CardHeader({ title, subtitle, actions, icon, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-paprika">{icon}</div>}
        <div>
          <h3 className="text-[15.5px] font-bold text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...p} />;

// ------------------------------------------------------------------ Badge de estado
const STATUS: Record<string, string> = {
  // verdes
  APROBADO: "green", APROBADA: "green", COMPLETADO: "green", COMPLETADA: "green", CONFIRMADA: "green", COBRADO: "green", PAGADA: "green", CONFORME: "green", EJECUTADO: "green", ENTREGADO: "green", ENTREGADA: "green", REGISTRADO: "green", ACTIVA: "green", ACTIVO: "green", VERIFICADO: "green", PRESENTE: "green", OK: "green", CUMPLE: "green", COSECHADA: "green", EMBARCADA: "green", COBRADA: "green", RECIBIDA: "green", CONSUMIDA: "green", "ÍNTEGRO": "green",
  // azules
  EN_EVALUACION: "blue", EN_PROCESO: "blue", EN_CURSO: "blue", EN_TRANSITO: "blue", DESPACHADO: "blue", RESERVADO: "blue", FONDEADO: "blue", ACEPTADO: "blue", ACEPTADA: "blue", EMITIDA: "blue", ORDENADA: "blue", EN_ALMACEN: "blue", CONFIRMADO: "blue", ADJUNTADO: "blue", DOCUMENTACION: "blue", ENVIADA: "blue", EN_REVISION: "blue", ENTREGADA_ON: "blue", PROPUESTO: "blue",
  // ámbar
  PENDIENTE: "amber", PARCIAL: "amber", PREPARACION: "amber", PLANIFICADA: "amber", BORRADOR: "slate", EN_DESCANSO: "amber", EN_PREPARACION: "amber", TARDANZA: "amber", RECIBIDA_PARCIAL: "amber", SIN_DATO: "amber", NO_REGISTRADO: "slate", CONFIRMADA_ON: "green",
  // naranja
  CUARENTENA: "orange", EN_DISPUTA: "orange", BLOQUEADO: "orange", REEMBOLSADO: "orange",
  // rojos
  RECHAZADO: "red", RECHAZADA: "red", FALLIDA: "red", FALLIDO: "red", ANULADO: "red", ANULADA: "red", CANCELADO: "red", NO_CONFORME: "red", NO_CUMPLE: "red", FALTA: "red", ERROR: "red", INACTIVA: "slate", AGOTADO: "slate", CONSUMIDO: "slate", LIBERADA: "slate", CERRADA: "slate", NO_APLICA: "slate",
};
const TONES: Record<string, string> = {
  green: "bg-agro-50 text-agro dark:bg-agro/20 dark:text-emerald-300",
  blue: "bg-bluex-50 text-bluex dark:bg-bluex/20 dark:text-sky-300",
  amber: "bg-amberx-50 text-amberx dark:bg-amberx/20 dark:text-amber-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  red: "bg-paprika-50 text-paprika dark:bg-paprika/25 dark:text-red-200",
  slate: "bg-[#EEF0F2] text-muted dark:bg-white/10 dark:text-slate-300",
  paprika: "bg-paprika-50 text-paprika dark:bg-paprika/25 dark:text-red-200",
  gold: "bg-gold-50 text-amberx dark:bg-gold/15 dark:text-gold",
};
export function Badge({ children, tone, className }: { children: React.ReactNode; tone?: keyof typeof TONES; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-[7px] px-2.5 py-1 text-[11.5px] font-bold leading-none", TONES[tone ?? "slate"], className)}>{children}</span>;
}
export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return <span className="text-muted">—</span>;
  return <Badge tone={(STATUS[status] as any) ?? "slate"}>{label ?? status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

// ------------------------------------------------------------------ Form controls
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn("h-9 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg placeholder:text-muted/70 focus:border-paprika focus:outline-none focus:ring-2 focus:ring-paprika/20 disabled:opacity-60", className)} {...p} />
));
Input.displayName = "Input";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn("h-9 w-full rounded-lg border border-line bg-card px-2.5 text-sm text-fg focus:border-paprika focus:outline-none focus:ring-2 focus:ring-paprika/20", className)} {...p}>{children}</select>
));
Select.displayName = "Select";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn("min-h-[70px] w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus:border-paprika focus:outline-none focus:ring-2 focus:ring-paprika/20", className)} {...p} />
));
Textarea.displayName = "Textarea";
export function Field({ label, error, hint, children, className, required }: { label: string; error?: string; hint?: string; children: React.ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-fg/80">{label}{required && <span className="text-paprika"> *</span>}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint ? <span className="block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

// ------------------------------------------------------------------ Modal
export function Modal({ open, onClose, title, subtitle, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose} role="dialog" aria-modal>
      <div className={cn("flex max-h-[92vh] w-full flex-col animate-in rounded-t-2xl border border-line bg-card shadow-2xl sm:rounded-2xl", w)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-soft" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmación para acciones sensibles (opcionalmente exige escribir una palabra). */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmText = "Confirmar", danger, typeToConfirm, loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: React.ReactNode; confirmText?: string; danger?: boolean; typeToConfirm?: string; loading?: boolean }) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { if (!open) setTyped(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2">{danger && <AlertTriangle className="h-4 w-4 text-red-600" />}{title}</span>} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancelar</Button><Button variant={danger ? "danger" : "primary"} loading={loading} disabled={!!typeToConfirm && typed !== typeToConfirm} onClick={onConfirm}>{confirmText}</Button></>}>
      <div className="space-y-3 text-sm text-fg/90">
        {message}
        {typeToConfirm && <Field label={`Escriba ${typeToConfirm} para confirmar`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Field>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Tabs
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: React.ReactNode; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors", value === t.id ? "border-paprika text-paprika" : "border-transparent text-muted hover:text-fg")}>
          {t.icon}{t.label}{t.count !== undefined && <span className="rounded-full bg-soft px-1.5 text-[10px] text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ misc
export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-5 w-5 animate-spin text-paprika", className)} />;
export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Spinner />{label}</div>;
}
export function Empty({ title = "Sin registros", hint, action }: { title?: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted/60" />
      <p className="text-sm font-medium text-fg/80">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted">{hint}</p>}
      {action}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>;
}
export function Notice({ children, tone = "gold", icon }: { children: React.ReactNode; tone?: "gold" | "blue" | "green" | "red"; icon?: React.ReactNode }) {
  const t = { gold: "border-gold/40 bg-gold-50 text-amber-900 dark:bg-gold/10 dark:text-gold", blue: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200", green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200", red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" }[tone];
  return <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", t)}>{icon}<div>{children}</div></div>;
}

export function PageHeader({ title, subtitle, actions, icon, area }: { title: string; subtitle?: string; actions?: React.ReactNode; icon?: React.ReactNode; area?: string }) {
  return (
    <div className="mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && !area && <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-paprika/10 text-paprika">{icon}</div>}
        <div>
          {area && <span className="mb-1.5 inline-block text-[10.5px] font-bold uppercase tracking-[.14em] text-paprika">{area}</span>}
          <h1 className="text-2xl font-extrabold tracking-tight text-fg sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

type KpiTone = "paprika" | "agro" | "gold" | "ink" | "red" | "green" | "amber" | "blue";
const KPI_TONES: Record<KpiTone, { box: string; ic: string }> = {
  green: { box: "bg-agro-50 dark:bg-agro/15", ic: "text-agro dark:text-emerald-300" },
  agro: { box: "bg-agro-50 dark:bg-agro/15", ic: "text-agro dark:text-emerald-300" },
  red: { box: "bg-paprika-50 dark:bg-paprika/20", ic: "text-paprika dark:text-red-200" },
  paprika: { box: "bg-paprika-50 dark:bg-paprika/20", ic: "text-paprika dark:text-red-200" },
  amber: { box: "bg-amberx-50 dark:bg-amberx/15", ic: "text-amberx dark:text-amber-300" },
  gold: { box: "bg-amberx-50 dark:bg-amberx/15", ic: "text-amberx dark:text-amber-300" },
  blue: { box: "bg-bluex-50 dark:bg-bluex/15", ic: "text-bluex dark:text-sky-300" },
  ink: { box: "bg-bluex-50 dark:bg-bluex/15", ic: "text-bluex dark:text-sky-300" },
};

/** Variación porcentual vs. mes anterior ("▲ +12% vs. mes anterior"). */
export function Trend({ value, inverse }: { value: number | null | undefined; inverse?: boolean }) {
  if (value === null || value === undefined) return <p className="mt-0.5 text-[11px] font-bold text-agro">Sin mes anterior para comparar</p>;
  const good = inverse ? value <= 0 : value >= 0;
  return <p className={cn("mt-0.5 text-[11px] font-bold", good ? "text-agro dark:text-emerald-300" : "text-paprika dark:text-red-300")}>{value >= 0 ? "▲ +" : "▼ "}{value}% vs. mes anterior</p>;
}

export function Kpi({ label, value, hint, icon, tone = "paprika", onClick, trend }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: KpiTone; onClick?: () => void; trend?: React.ReactNode }) {
  const t = KPI_TONES[tone];
  return (
    <div onClick={onClick} className={cn("flex min-w-0 items-center gap-3.5 rounded-2xl border border-line px-[18px] py-4 transition-shadow", t.box, onClick && "cursor-pointer hover:shadow-card")}>
      {icon && <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card [&>svg]:h-[22px] [&>svg]:w-[22px]", t.ic)}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-fg/80">{label}</p>
        <p className="truncate text-[23px] font-extrabold leading-tight tracking-tight text-fg">{value}</p>
        {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
        {trend}
      </div>
    </div>
  );
}

export function KeyValue({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", c)}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("rounded bg-soft px-1.5 py-0.5 font-mono text-[11px] text-fg/90", className)}>{children}</code>;
}
