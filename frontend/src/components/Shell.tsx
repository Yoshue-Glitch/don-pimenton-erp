"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard, Network, Sprout, Factory, FlaskConical, Boxes, ShoppingCart, Users, Truck, Landmark, PackageSearch, IdCard,
  Globe2, Megaphone, FileSignature, Link2, PlayCircle, BarChart3, Settings, Bell, Search, Moon, Sun, LogOut, Menu, ChevronsLeft, ChevronsRight, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth, useTheme } from "./providers";

type NavItem = { href: string; label: string; icon: any; module?: string; perm?: string; sc?: boolean };
/** Navegación agrupada por las áreas del organigrama de Don Pimentón. */
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "General", items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.read" },
    { href: "/organigrama", label: "Organigrama", icon: Network, perm: "dashboard.read" },
  ] },
  { group: "Área Agrícola", items: [{ href: "/agricultura", label: "Campo y cosechas", icon: Sprout, module: "agricultura" }] },
  { group: "Procesamiento y Calidad", items: [
    { href: "/produccion", label: "Producción", icon: Factory, module: "produccion" },
    { href: "/calidad", label: "Control de calidad", icon: FlaskConical, module: "calidad" },
    { href: "/inventario", label: "Almacén e inventario", icon: Boxes, module: "inventario" },
  ] },
  { group: "Comercial", items: [
    { href: "/ventas", label: "Ventas nacionales", icon: ShoppingCart, module: "ventas" },
    { href: "/ventas?tab=clientes", label: "Clientes", icon: Users, module: "ventas" },
    { href: "/logistica", label: "Logística", icon: Truck, module: "logistica" },
  ] },
  { group: "Administración y Finanzas", items: [
    { href: "/finanzas", label: "Finanzas", icon: Landmark, module: "finanzas" },
    { href: "/compras", label: "Compras", icon: PackageSearch, module: "compras" },
    { href: "/rrhh", label: "Recursos Humanos", icon: IdCard, module: "rrhh" },
  ] },
  { group: "Exportaciones", items: [
    { href: "/exportaciones", label: "Exportaciones", icon: Globe2, module: "exportaciones" },
    { href: "/marketing", label: "Marketing y marca", icon: Megaphone, module: "marketing" },
    { href: "/smart-contract", label: "Smart Contract", icon: FileSignature, module: "blockchain", sc: true },
    { href: "/blockchain", label: "Panel blockchain", icon: Link2, module: "blockchain" },
  ] },
  { group: "Sistema", items: [
    { href: "/demo", label: "Demostración guiada", icon: PlayCircle, perm: "dashboard.read" },
    { href: "/reportes", label: "Reportes", icon: BarChart3, perm: "reports.read" },
    { href: "/configuracion", label: "Configuración", icon: Settings, perm: "__config" },
  ] },
];

/** Logo de Don Pimentón (pimiento rojo con tallo verde). */
export function PepperLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 48" className={className} aria-hidden>
      <path d="M20 12C10 12 5 19 5 29c0 10 7 17 15 17s15-7 15-17c0-10-5-17-15-17z" fill="#A52A2A" />
      <path d="M14 16c-3 4-4 9-3 14" stroke="#fff" strokeOpacity=".35" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M11 13c4 3 14 3 18 0" stroke="#2F6B45" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M20 12c0-5 2-8 7-10" stroke="#2F6B45" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex h-[72px] shrink-0 items-center gap-2.5 bg-white px-5", collapsed && "justify-center px-0")}>
      <PepperLogo className="h-10 w-[34px] shrink-0" />
      {!collapsed && (
        <div>
          <b className="block font-display text-[21px] font-bold leading-none text-forest">Don Pimentón</b>
          <small className="mt-[3px] block text-[7.5px] font-bold tracking-[.18em] text-paprika">PIMENTÓN AREQUIPEÑO</small>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, modules, can, logout } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobile, setMobile] = React.useState(false);
  React.useEffect(() => { try { setCollapsed(localStorage.getItem("dp-sidebar") === "1"); } catch { /* sin almacenamiento */ } }, []);
  React.useEffect(() => setMobile(false), [pathname, params]);
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem("dp-sidebar", c ? "0" : "1"); } catch { /* */ } return !c; });

  const allowed = (n: NavItem) => {
    if (n.perm === "__config") return can("settings.manage") || can("users.manage") || can("audit.read");
    if (n.module) return modules.includes(n.module);
    return n.perm ? can(n.perm) : true;
  };
  const isActive = (href: string) => {
    const [path, query] = href.split("?");
    if (path === "/") return pathname === "/";
    if (!pathname.startsWith(path)) return false;
    const tab = params.get("tab");
    return query ? `tab=${tab}` === query : !(path === "/ventas" && tab === "clientes");
  };

  const nav = (isMobile: boolean) => (
    <nav className="nav-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4 pt-2.5">
      {NAV.map((g) => {
        const items = g.items.filter(allowed);
        if (!items.length) return null;
        return (
          <React.Fragment key={g.group}>
            {(!collapsed || isMobile) ? <p className="px-3.5 pb-1.5 pt-3.5 text-[10px] font-bold uppercase tracking-[.16em] text-[#9DBFA6]">{g.group}</p> : <div className="mx-3 my-2 border-t border-white/10" />}
            {items.map((n) => {
              const active = isActive(n.href);
              const Icon = n.icon;
              return (
                <Link key={n.href} href={n.href} title={n.label}
                  className={cn("flex items-center gap-3 rounded-[10px] px-3.5 py-[9px] font-medium transition-colors",
                    n.sc ? (active ? "bg-paprika-50 font-bold text-paprika" : "text-[#F2C9C0] hover:bg-white/[.08]")
                      : active ? "bg-agro-50 font-bold text-forest" : "text-[#DCE7DF] hover:bg-white/[.08]",
                    collapsed && !isMobile && "justify-center px-0")}>
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {(!collapsed || isMobile) && <span className="truncate">{n.label}</span>}
                </Link>
              );
            })}
          </React.Fragment>
        );
      })}
    </nav>
  );

  const foot = (
    <div className="relative hidden min-h-[96px] shrink-0 items-end overflow-hidden px-5 pb-[18px] [@media(min-height:980px)]:flex">
      <svg viewBox="0 0 240 100" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-full w-full opacity-35" aria-hidden>
        <path d="M0 100V60l40-26 30 18 50-42 45 34 30-14 45 24v46z" fill="#3E7A55" />
        <path d="M0 100V80l60-16 50 14 60-22 70 20v24z" fill="#5C9470" />
      </svg>
      <p className="relative text-sm leading-tight text-[#E9F0EA]">Calidad que<br />llega más lejos</p>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className={cn("sticky top-0 z-40 hidden h-screen shrink-0 flex-col bg-forest text-[#E9F0EA] transition-all duration-200 lg:flex", collapsed ? "w-[76px]" : "w-[250px]")}>
        <Brand collapsed={collapsed} />
        {nav(false)}
        {!collapsed && foot}
        <button onClick={toggleCollapsed} className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-white/50 hover:text-white">
          {collapsed ? <ChevronsRight className="mx-auto h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Plegar menú</>}
        </button>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobile(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="relative flex h-full w-[260px] animate-in flex-col bg-forest text-[#E9F0EA]" onClick={(e) => e.stopPropagation()}>
            <Brand />
            {nav(true)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobile(true)} userName={user?.name ?? ""} roleName={user?.roleName ?? ""} onLogout={logout} />
        <div className="border-b border-gold/30 bg-gold-50 px-4 py-1.5 text-center text-[11px] text-amberx dark:bg-gold/10 dark:text-gold">
          Entorno de demostración · datos ficticios · blockchain local Hardhat (sin dinero real) · comprobantes internos sin validez tributaria
        </div>
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-7">{children}</main>
        <footer className="px-6 pb-4 text-center text-[11px] text-muted">Don Pimentón · “Del campo al mercado, con calidad y trazabilidad” · Arequipa, Perú</footer>
      </div>
    </div>
  );
}

function Topbar({ onMenu, userName, roleName, onLogout }: { onMenu: () => void; userName: string; roleName: string; onLogout: () => void }) {
  const { dark, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<{ type: string; label: string; href: string }[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [alerts, setAlerts] = React.useState<any[]>([]);
  const [openBell, setOpenBell] = React.useState(false);
  const [openUser, setOpenUser] = React.useState(false);

  React.useEffect(() => { api("/dashboard").then((d) => setAlerts(d.alerts ?? [])).catch(() => {}); }, [pathname]);
  React.useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    const t = setTimeout(() => api(`/dashboard/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => setResults([])).finally(() => setSearching(false)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const initial = (userName.trim()[0] ?? "U").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center gap-4 border-b border-line bg-card px-4 sm:px-7">
      <button onClick={onMenu} className="rounded-lg p-1.5 text-fg lg:hidden" aria-label="Abrir menú"><Menu className="h-5 w-5" /></button>
      <div className="relative hidden max-w-[460px] flex-1 sm:block">
        <label className="flex items-center gap-2 rounded-[10px] border border-line bg-bg px-3 text-muted">
          <Search className="h-[18px] w-[18px] shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setResults(null), 200)} placeholder="Buscar lotes, pedidos, clientes, contratos…" className="w-full bg-transparent py-2.5 text-sm text-fg outline-none placeholder:text-muted" />
          {searching && <Loader2 className="h-4 w-4 animate-spin" />}
        </label>
        {results && (
          <div className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-xl border border-line bg-card shadow-xl">
            {results.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Sin resultados</p> : results.map((r, i) => (
              <button key={i} onMouseDown={() => { router.push(r.href); setQ(""); setResults(null); }} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-bg">
                <span className="font-medium text-fg">{r.label}</span><span className="text-xs text-muted">{r.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3 sm:gap-5">
        <button onClick={toggle} className="text-forest hover:opacity-80 dark:text-emerald-200" title={dark ? "Modo claro" : "Modo oscuro"}>{dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
        <div className="relative">
          <button onClick={() => { setOpenBell((o) => !o); setOpenUser(false); }} className="relative flex text-forest dark:text-emerald-200" title="Alertas">
            <Bell className="h-5 w-5" />
            {alerts.length > 0 && <span className="absolute -right-[7px] -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-paprika px-1 text-[10px] font-bold text-white">{alerts.length}</span>}
          </button>
          {openBell && (
            <div className="absolute right-0 top-9 z-40 w-[min(360px,90vw)] overflow-hidden rounded-xl border border-line bg-card shadow-xl">
              <p className="border-b border-line px-4 py-2.5 text-sm font-bold text-fg">Alertas ({alerts.length})</p>
              <div className="max-h-80 overflow-y-auto">
                {alerts.length === 0 ? <p className="px-4 py-4 text-sm text-muted">Todo en orden</p> : alerts.map((a, i) => (
                  <div key={i} className="flex gap-3 px-4 py-2.5 text-xs hover:bg-bg">
                    <span className={cn("mt-1 h-[9px] w-[9px] shrink-0 rounded-full", a.level === "danger" ? "bg-paprika" : a.level === "warning" ? "bg-amberx" : "bg-bluex")} />
                    <div><p className="text-[13px] font-bold text-fg">{a.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}</p><p className="text-muted">{a.message}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <button onClick={() => { setOpenUser((o) => !o); setOpenBell(false); }} className="flex items-center gap-2.5">
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-forest font-bold text-white">{initial}</span>
            <span className="hidden text-left md:block"><b className="block text-[13px] text-fg">{userName}</b><small className="text-[11px] text-muted">{roleName}</small></span>
          </button>
          {openUser && (
            <div className="absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-xl border border-line bg-card shadow-xl">
              <div className="border-b border-line px-4 py-3"><p className="text-sm font-bold text-fg">{userName}</p><p className="text-xs text-muted">{roleName}</p></div>
              <button onClick={onLogout} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-paprika hover:bg-bg"><LogOut className="h-4 w-4" />Cerrar sesión</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
