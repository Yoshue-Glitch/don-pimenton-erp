"use client";
import * as React from "react";
import Link from "next/link";
import { LogOut, Globe, ShoppingBag, LayoutGrid } from "lucide-react";
import { api } from "@/lib/api";
import { PepperLogo } from "@/components/Shell";
import { ChatWidget } from "@/components/ChatWidget";
import { PortalCtx } from "@/components/PortalContext";


export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<any>(undefined);
  const [lang, setLang] = React.useState<"es" | "en">("es");
  const reload = React.useCallback(() => { api("/auth/me").then((r) => setMe(r.user)).catch(() => setMe(null)); }, []);
  React.useEffect(() => { reload(); try { setLang((localStorage.getItem("dp-lang") as any) ?? "es"); } catch { /* */ } }, [reload]);
  const logout = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); setMe(null); window.location.href = "/portal"; };
  const isBuyer = me && ["COMPRADOR", "BROKER"].includes(me.role);
  return (
    <PortalCtx.Provider value={{ me, reload, lang, setLang: (l) => { setLang(l); try { localStorage.setItem("dp-lang", l); } catch { /* */ } } }}>
      <div className="min-h-screen bg-bg">
        <header className="sticky top-0 z-30 border-b border-line bg-card/95 backdrop-blur">
          <div className="mx-auto flex h-[68px] max-w-[1280px] items-center gap-4 px-4 sm:px-6">
            <Link href="/portal" className="flex items-center gap-2.5"><PepperLogo className="h-10 w-[34px]" /><div><b className="block font-display text-xl leading-none text-forest dark:text-emerald-100">Don Pimentón</b><small className="text-[8px] font-bold tracking-[.18em] text-paprika">BUYER PORTAL · PORTAL DEL COMPRADOR</small></div></Link>
            <nav className="ml-6 hidden gap-1 md:flex">
              <Link href="/portal" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-fg hover:bg-soft"><LayoutGrid className="h-4 w-4" />{lang === "en" ? "Catalog & orders" : "Catálogo y pedidos"}</Link>
              <Link href="/portal#comprar" className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-fg hover:bg-soft"><ShoppingBag className="h-4 w-4" />{lang === "en" ? "Buy" : "Comprar"}</Link>
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => { const l = lang === "es" ? "en" : "es"; setLang(l); try { localStorage.setItem("dp-lang", l); } catch { /* */ } }} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-bold text-fg"><Globe className="h-3.5 w-3.5" />{lang === "es" ? "EN" : "ES"}</button>
              {isBuyer ? <>
                <span className="hidden text-right text-xs md:block"><b className="block text-fg">{me.name}</b><span className="text-muted">{me.roleName}</span></span>
                <button onClick={logout} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-paprika hover:bg-soft"><LogOut className="h-4 w-4" /></button>
              </> : me && <Link href="/" className="rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white">Volver al ERP</Link>}
            </div>
          </div>
        </header>
        <div className="border-b border-gold/30 bg-gold-50 px-4 py-1.5 text-center text-[11px] text-amberx">{lang === "en" ? "Demo environment · fictitious data · local test blockchain (no crypto). Card payments go through a PCI-certified gateway when configured." : "Entorno de demostración · datos ficticios · blockchain local de prueba (sin criptomonedas). Los pagos con tarjeta pasan por una pasarela certificada PCI cuando está configurada."}</div>
        <main className="mx-auto max-w-[1280px] p-4 sm:p-6">{me === undefined ? null : children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">Don Pimentón · Caravelí, Arequipa — Product of Peru · “Del campo al mercado, con calidad y trazabilidad”</footer>
        <ChatWidget endpoint={isBuyer ? "/portal/assistant" : "/public/assistant"} title="Pimentín · buyer assistant" suggestions={lang === "en" ? ["What's in a pallet and how much does it cost?", "Which FDA requirements apply to me as importer?", "How does the smart contract payment work?", "Where is my order?"] : undefined} />
      </div>
    </PortalCtx.Provider>
  );
}
