"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ Toasts
type Toast = { id: number; kind: "success" | "error" | "info"; title: string; message?: string };
const ToastCtx = React.createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => {
  const { push } = React.useContext(ToastCtx);
  return React.useMemo(() => ({
    success: (title: string, message?: string) => push({ kind: "success", title, message }),
    error: (title: string, message?: string) => push({ kind: "error", title, message }),
    info: (title: string, message?: string) => push({ kind: "info", title, message }),
  }), [push]);
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.kind === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex animate-in items-start gap-3 rounded-xl border bg-card p-3 shadow-lg", t.kind === "error" ? "border-red-200 dark:border-red-900" : t.kind === "success" ? "border-emerald-200 dark:border-emerald-900" : "border-line")}>
            {t.kind === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : t.kind === "error" ? <XCircle className="h-5 w-5 shrink-0 text-red-600" /> : <Info className="h-5 w-5 shrink-0 text-sky-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t.title}</p>
              {t.message && <p className="mt-0.5 break-words text-xs text-muted">{t.message}</p>}
            </div>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ Auth
export interface Me { id: number; email: string; name: string; role: string; roleName: string; permissions: string[] }
interface AuthState { user: Me | null; modules: string[]; loading: boolean; can: (p: string) => boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const AuthCtx = React.createContext<AuthState>({ user: null, modules: [], loading: true, can: () => false, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => React.useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<Me | null>(null);
  const [modules, setModules] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  const refresh = React.useCallback(async () => {
    try {
      const r = await api<{ user: Me; modules: string[] }>("/auth/me");
      setUser(r.user); setModules(r.modules);
    } catch {
      setUser(null);
      router.replace("/login");
    } finally { setLoading(false); }
  }, [router]);
  React.useEffect(() => { refresh(); }, [refresh]);
  const logout = React.useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    router.replace("/login");
  }, [router]);
  const perms = React.useMemo(() => new Set(user?.permissions ?? []), [user]);
  const can = React.useCallback((p: string) => perms.has(p), [perms]);
  return <AuthCtx.Provider value={{ user, modules, loading, can, refresh, logout }}>{children}</AuthCtx.Provider>;
}

/** Muestra el contenido solo si el usuario tiene el permiso (las acciones sin permiso no se renderizan). */
export function Can({ perm, children, fallback = null }: { perm: string | string[]; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { can } = useAuth();
  const ok = Array.isArray(perm) ? perm.every(can) : can(perm);
  return <>{ok ? children : fallback}</>;
}

// ------------------------------------------------------------------ Tema claro / oscuro
export function useTheme() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("dp-theme", next ? "dark" : "light"); } catch { /* sin almacenamiento */ }
  };
  return { dark, toggle };
}
