"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Sprout, Factory, ShieldCheck, Boxes, ShoppingCart, BadgeDollarSign, Truck, Globe2, Users, Landmark,
  Link2, PlayCircle, FileText, Settings, Bell, Search, Moon, Sun, LogOut, Menu, ChevronsLeft, ChevronsRight, CalendarDays, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth, useTheme } from "./providers";

const NAV: { href: string; label: string; icon: any; module?: string; perm?: string; section?: string }[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.read", section: "General" },
  { href: "/agricultura", label: "Gestión agrícola", icon: Sprout, module: "agricultura", section: "Operaciones" },
  { href: "/produccion", label: "Producción", icon: Factory, module: "produccion" },
  { href: "/calidad", label: "Calidad e inocuidad", icon: ShieldCheck, module: "calidad" },
  { href: "/inventario", label: "Inventarios", icon: Boxes, module: "inventario" },
  { href: "/compras", label: "Compras", icon: ShoppingCart, module: "compras", section: "Comercial" },
  { href: "/ventas", label: "Ventas y clientes", icon: BadgeDollarSign, module: "ventas" },
  { href: "/logistica", label: "Logística", icon: Truck, module: "logistica" },
  { href: "/exportaciones", label: "Exportaciones", icon: Globe2, module: "exportaciones" },
  { href: "/rrhh", label: "Recursos humanos", icon: Users, module: "rrhh", section: "Gestión" },
  { href: "/finanzas", label: "Finanzas", icon: Landmark, module: "finanzas" },
  { href: "/blockchain", label: "Blockchain & Smart Contracts", icon: Link2, module: "blockchain", section: "Blockchain" },
  { href: "/demo", label: "Demostración guiada", icon: PlayCircle, perm: "dashboard.read" },
  { href: "/reportes", label: "Reportes", icon: FileText, perm: "reports.read", section: "Sistema" },
  { href: "/configuracion", label: "Configuración", icon: Settings, perm: "__config" },
];

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paprika text-white shadow-sm">
        <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" aria-hidden>
          <path d="M16 6c1.5-2 4-2.5 5.5-1.5" stroke="#C8A46B" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M16 7c-6 0-9 5-8.5 11 .4 5 4 8 8.5 8s8.1-3 8.5-8C25 12 22 7 16 7Z" fill="currentColor" />
          <path d="M12.5 12.5c-1 1.5-1.5 3.5-1.2 5.5" stroke="#F8F5EE" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-extrabold tracking-tight text-white">DON PIMENTÓN <span className="text-gold">ERP</span></p>
          <p className="text-[10px] text-white/60">Agroindustrial Management & Blockchain</p>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, modules, can, logout } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => { try { setCollapsed(localStorage.getItem("dp-sidebar") === "1"); } catch { /* */ } }, []);
  React.useEffect(() => setMobile(false), [pathname]);
  const toggleCollapsed = () => { setCollapsed((c) => { try { localStorage.setItem("dp-sidebar", c ? "0" : "1"); } catch { /* */ } return !c; }); };

  const visible = NAV.filter((n) => {
    if (n.perm === "__config") return can("settings.manage") || can("users.manage") || can("audit.read");
    if (n.module) return modules.includes(n.module);
    return n.perm ? can(n.perm) : true;
  });

  const nav = (isMobile: boolean) => (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
      {visible.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const Icon = n.icon;
        return (
          <React.Fragment key={n.href}>
            {n.section && (!collapsed || isMobile) && <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white/40 first:pt-1">{n.section}</p>}
            <Link href={n.href} title={n.label} className={cn("group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white", collapsed && !isMobile && "justify-center px-0")}>
              <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-gold" : "text-white/60 group-hover:text-white")} />
              {(!collapsed || isMobile) && <span className="truncate">{n.label}</span>}
            </Link>
          </React.Fragment>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar escritorio */}
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-ink transition-all duration-200 lg:flex", collapsed ? "w-[72px]" : "w-64")}>
        <div className={cn("flex h-16 items-center border-b border-white/10 px-4", collapsed && "justify-center px-0")}><Logo collapsed={collapsed} /></div>
        {nav(false)}
        <button onClick={toggleCollapsed} className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-white/50 hover:text-white">
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Plegar menú</>}
        </button>
      </aside>
      {/* Sidebar móvil */}
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobile(false)}>
          <div className="absolute inset-0 bg-ink/60" />
          <aside className="relative flex h-full w-72 flex-col bg-ink animate-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-16 items-center border-b border-white/10 px-4"><Logo /></div>
            {nav(true)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobile(true)} userName={user?.name ?? ""} roleName={user?.roleName ?? ""} onLogout={logout} />
        <div className="border-b border-gold/30 bg-gold-50 px-4 py-1.5 text-center text-[11px] text-amber-900 dark:bg-gold/10 dark:text-gold">
          Entorno de demostración · datos ficticios · blockchain local Hardhat (sin dinero real) · comprobantes internos sin validez tributaria
        </div>
        <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 sm:p-6">{children}</main>
        <footer className="px-6 pb-4 text-center text-[11px] text-muted">Don Pimentón ERP · “Del campo al mercado, con calidad y trazabilidad” · Arequipa, Perú</footer>
      </div>
    </div>
  );
}

function Topbar({ onMenu, userName, roleName, onLogout }: { onMenu: () => void; userName: string; roleName: string; onLogout: () => void }) {
  const { dark, toggle } = useTheme();
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ type: string; label: string; href: string }[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [alerts, setAlerts] = React.useState<any[]>([]);
  const [openBell, setOpenBell] = React.useState(false);
  const [openUser, setOpenUser] = React.useState(false);
  const pathname = usePathname();

  React.useEffect(() => {
    api("/dashboard").then((d) => setAlerts(d.alerts ?? [])).catch(() => {});
  }, [pathname]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(() => api(`/dashboard/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])).finally(() => setSearching(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const today = new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Lima" });
  const initials = userName.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("");

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-card/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-fg hover:bg-soft lg:hidden" aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setResults(null), 200)} placeholder="Buscar lotes, pedidos, clientes, contratos…" className="h-9 w-full rounded-lg border border-line bg-bg pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-paprika focus:outline-none" />
        {searching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted" />}
        {results && (
          <div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-line bg-card shadow-xl">
            {results.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Sin resultados</p> : results.map((r, i) => (
              <button key={i} onMouseDown={() => { router.push(r.href); setQ(""); setResults(null); }} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-soft">
                <span className="font-medium text-fg">{r.label}</span><span className="text-xs text-muted">{r.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <span className="hidden items-center gap-1.5 text-xs capitalize text-muted xl:flex"><CalendarDays className="h-4 w-4" />{today}</span>
        <button onClick={toggle} className="rounded-lg p-2 text-muted hover:bg-soft hover:text-fg" title={dark ? "Modo claro" : "Modo oscuro"}>{dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
        <div className="relative">
          <button onClick={() => { setOpenBell((o) => !o); setOpenUser(false); }} className="relative rounded-lg p-2 text-muted hover:bg-soft hover:text-fg" title="Notificaciones">
            <Bell className="h-5 w-5" />
            {alerts.length > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-paprika px-1 text-[10px] font-bold text-white">{alerts.length}</span>}
          </button>
          {openBell && (
            <div className="absolute right-0 top-11 z-40 w-[min(360px,90vw)] overflow-hidden rounded-xl border border-line bg-card shadow-xl">
              <p className="border-b border-line px-4 py-2.5 text-sm font-semibold text-fg">Alertas ({alerts.length})</p>
              <div className="max-h-80 overflow-y-auto">
                {alerts.length === 0 ? <p className="px-4 py-4 text-sm text-muted">Sin alertas activas</p> : alerts.map((a, i) => (
                  <div key={i} className="flex gap-2 border-b border-line/60 px-4 py-2.5 text-xs last:border-0">
                    <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", a.level === "danger" ? "bg-red-500" : a.level === "warning" ? "bg-amber-500" : "bg-sky-500")} />
                    <div><p className="font-medium text-fg">{a.type.replace(/_/g, " ")}</p><p className="text-muted">{a.message}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <button onClick={() => { setOpenUser((o) => !o); setOpenBell(false); }} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-soft">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-agro text-xs font-bold text-white">{initials}</span>
            <span className="hidden text-left leading-tight md:block"><span className="block text-xs font-semibold text-fg">{userName}</span><span className="block text-[10px] text-muted">{roleName}</span></span>
          </button>
          {openUser && (
            <div className="absolute right-0 top-11 z-40 w-56 overflow-hidden rounded-xl border border-line bg-card shadow-xl">
              <div className="border-b border-line px-4 py-3"><p className="text-sm font-semibold text-fg">{userName}</p><p className="text-xs text-muted">{roleName}</p></div>
              <button onClick={onLogout} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-soft"><LogOut className="h-4 w-4" />Cerrar sesión</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
