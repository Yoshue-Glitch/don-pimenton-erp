"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Sprout, Factory, FlaskConical, FileSignature } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input, Field, ErrorBox } from "@/components/ui";
import { PepperLogo } from "@/components/Shell";

const DEMO = [
  ["admin@donpimenton.pe", "Martha Torres · Gerencia General"], ["gerencia@donpimenton.pe", "Administración del sistema"], ["agricola@donpimenton.pe", "Área Agrícola"],
  ["produccion@donpimenton.pe", "Procesamiento · Producción"], ["calidad@donpimenton.pe", "Procesamiento · Calidad"], ["almacen@donpimenton.pe", "Comercial · Almacén"],
  ["comercial@donpimenton.pe", "Comercial · Ventas"], ["finanzas@donpimenton.pe", "Administración y Finanzas"], ["exportaciones@donpimenton.pe", "Exportaciones"], ["auditor@donpimenton.pe", "Auditoría (solo lectura)"],
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("admin@donpimenton.pe");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [hint, setHint] = React.useState<{ showPassword: boolean; password: string | null } | null>(null);
  React.useEffect(() => { api("/auth/demo-info").then(setHint).catch(() => setHint(null)); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      await api("/auth/login", { body: { email, password } });
      router.replace("/");
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_85%_15%,rgba(165,42,42,.55),transparent_50%),linear-gradient(135deg,#1C3F2B_0%,#12291C_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <svg viewBox="0 0 240 100" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-40 w-full opacity-30" aria-hidden>
          <path d="M0 100V60l40-26 30 18 50-42 45 34 30-14 45 24v46z" fill="#3E7A55" /><path d="M0 100V80l60-16 50 14 60-22 70 20v24z" fill="#5C9470" />
        </svg>
        <div className="relative flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white"><PepperLogo className="h-10 w-9" /></span>
          <div>
            <p className="font-display text-3xl font-bold leading-none">Don Pimentón</p>
            <p className="mt-1 text-[10px] font-bold tracking-[.2em] text-[#F2C9C0]">PIMENTÓN AREQUIPEÑO · ERP</p>
          </div>
        </div>
        <div className="relative space-y-6">
          <p className="max-w-md font-display text-[40px] font-bold leading-[1.08]">Del campo al mercado, <i className="font-medium text-[#F2B8AC]">con calidad y trazabilidad</i></p>
          <div className="grid max-w-lg grid-cols-2 gap-3 text-sm">
            {[[Sprout, "Campo y cosechas"], [Factory, "Producción y rendimiento"], [FlaskConical, "Calidad por lote"], [FileSignature, "Smart Contracts"]].map(([I, t]: any) => (
              <div key={t} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"><I className="h-4 w-4 text-gold" />{t}</div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-white/70">Calidad que llega más lejos · Arequipa, Perú · datos de demostración</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden"><PepperLogo className="h-10 w-9" /><p className="font-display text-2xl font-bold text-forest dark:text-emerald-200">Don Pimentón</p></div>
          <span className="text-[10.5px] font-bold uppercase tracking-[.14em] text-paprika">Acceso al ERP</span>
          <h1 className="mt-1 text-[28px] font-extrabold text-fg">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-muted">Ingrese con su usuario corporativo.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <ErrorBox message={error} />}
            <Field label="Correo electrónico">
              <div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-muted" /><Input className="h-10 pl-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
            </Field>
            <Field label="Contraseña">
              <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-muted" /><Input className="h-10 pl-9" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading}>Ingresar</Button>
          </form>
          <div className="mt-8 rounded-2xl border border-line bg-card p-4 shadow-card">
            <p className="text-xs font-bold text-fg">Usuarios de demostración</p>
            <p className="mt-0.5 text-[11px] text-muted">{hint?.showPassword ? <>Contraseña común: <code className="rounded bg-soft px-1">{hint.password}</code></> : "Contraseña común: solicítela al administrador del despliegue."}</p>
            <div className="mt-2 grid grid-cols-1 gap-1">
              {DEMO.map(([e, r]) => (
                <button key={e} type="button" onClick={() => setEmail(e)} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-bg ${email === e ? "bg-soft font-semibold" : ""}`}>
                  <span className="text-fg">{e}</span><span className="text-right text-muted">{r}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
