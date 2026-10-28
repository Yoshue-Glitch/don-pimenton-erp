"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Sprout, Factory, ShieldCheck, Link2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input, Field, ErrorBox } from "@/components/ui";

const DEMO = [
  ["admin@donpimenton.pe", "Administrador general"], ["gerencia@donpimenton.pe", "Gerencia"], ["agricola@donpimenton.pe", "Responsable agrícola"],
  ["produccion@donpimenton.pe", "Producción"], ["calidad@donpimenton.pe", "Calidad"], ["almacen@donpimenton.pe", "Almacén"],
  ["comercial@donpimenton.pe", "Comercial"], ["finanzas@donpimenton.pe", "Finanzas"], ["exportaciones@donpimenton.pe", "Exportaciones"], ["auditor@donpimenton.pe", "Auditor (solo lectura)"],
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
      <div className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-paprika/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-agro/40 blur-3xl" />
        <div className="relative">
          <p className="text-3xl font-extrabold tracking-tight">DON PIMENTÓN <span className="text-gold">ERP</span></p>
          <p className="mt-1 text-sm text-white/60">Agroindustrial Management & Blockchain</p>
        </div>
        <div className="relative space-y-6">
          <p className="max-w-md text-3xl font-semibold leading-tight">“Del campo al mercado, con calidad y trazabilidad”.</p>
          <div className="grid max-w-lg grid-cols-2 gap-3 text-sm">
            {[[Sprout, "Campañas y cosechas"], [Factory, "Procesamiento y rendimiento"], [ShieldCheck, "Calidad por lote"], [Link2, "Smart Contracts en red local"]].map(([I, t]: any) => (
              <div key={t} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5"><I className="h-4 w-4 text-gold" />{t}</div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-white/40">Microempresa agroindustrial familiar · Arequipa, Perú · Prototipo con datos de demostración</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><p className="text-2xl font-extrabold text-paprika">DON PIMENTÓN <span className="text-gold">ERP</span></p></div>
          <h1 className="text-2xl font-bold text-fg">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-muted">Acceda con su usuario corporativo.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {error && <ErrorBox message={error} />}
            <Field label="Correo electrónico">
              <div className="relative"><Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><Input className="pl-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
            </Field>
            <Field label="Contraseña">
              <div className="relative"><Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted" /><Input className="pl-9" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={loading}>Ingresar</Button>
          </form>
          <div className="mt-8 rounded-xl border border-line bg-card p-4">
            <p className="text-xs font-semibold text-fg">Usuarios de demostración</p>
            <p className="mt-0.5 text-[11px] text-muted">{hint?.showPassword ? <>Contraseña común: <code className="rounded bg-soft px-1">{hint.password}</code></> : "Contraseña común: solicítela al administrador del despliegue."}</p>
            <div className="mt-2 grid grid-cols-1 gap-1">
              {DEMO.map(([e, r]) => (
                <button key={e} type="button" onClick={() => setEmail(e)} className={`flex items-center justify-between rounded-md px-2 py-1 text-left text-[11px] hover:bg-soft ${email === e ? "bg-soft font-semibold" : ""}`}>
                  <span className="text-fg">{e}</span><span className="text-muted">{r}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
