"use client";
/** Chatbot "Pimentín": burbuja flotante en el ERP y en el portal del comprador. */
import * as React from "react";
import { MessageCircle, X, Send, Sparkles, ExternalLink, Loader2, Bot } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; url: string }[]; mode?: string };

function md(text: string) {
  // formato mínimo y seguro: **negrita**, saltos de línea y viñetas (sin HTML del modelo)
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : <React.Fragment key={j}>{p.replace(/^_(.*)_$/, "$1")}</React.Fragment>));
    return <p key={i} className={cn("min-h-[0.6em]", /^\s*[•\-]/.test(line) && "pl-2")}>{parts}</p>;
  });
}

export function ChatWidget({ endpoint = "/assistant/ask", title = "Pimentín · asistente de exportación", suggestions }: { endpoint?: string; title?: string; suggestions?: string[] }) {
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<any>(null);
  const end = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { if (open && !status) api("/assistant/status").then(setStatus).catch(() => setStatus({ mode: "LOCAL" })); }, [open, status]);
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  const sugg = suggestions ?? ["¿Qué incluye una paleta y cuánto cuesta?", "¿Qué requisitos FDA necesito para importar?", "¿Cómo funciona el pago con smart contract?", "¿Dónde está mi pedido?"];
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const history = msgs.map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setQ(""); setBusy(true);
    try {
      const r = await api<any>(endpoint, { body: { question: text, history } });
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources, mode: r.mode }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `No pude responder: ${e.message}` }]);
    } finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} className="no-print fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-paprika text-white shadow-xl transition hover:scale-105 hover:bg-paprika-700" aria-label="Abrir asistente">
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] font-black text-ink">IA</span>}
      </button>
      {open && (
        <div className="no-print fixed bottom-24 right-5 z-50 flex h-[min(620px,calc(100vh-8rem))] w-[min(400px,calc(100vw-2.5rem))] animate-in flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
          <div className="flex items-center gap-3 bg-gradient-to-r from-forest to-forest-2 px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><Bot className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><b className="block truncate text-sm">{title}</b><small className="text-[11px] text-white/75">{status?.mode === "CLAUDE" ? `IA conectada · búsqueda en fuentes oficiales` : "Modo base de conocimiento (sin IA externa)"}</small></div>
            <Sparkles className="h-4 w-4 text-gold" />
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-bg/60 p-3 text-[13px]">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="rounded-xl bg-card p-3 text-fg shadow-sm">¡Hola! Soy Pimentín. Respondo sobre el producto, precios, calidad, requisitos FDA/SUNAT, pagos, smart contract y el estado de sus pedidos, con datos del ERP y fuentes oficiales.</p>
                {sugg.map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-xl border border-line bg-card px-3 py-2 text-left text-[12.5px] text-fg hover:border-agro">{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn("max-w-[92%] rounded-2xl px-3 py-2 shadow-sm", m.role === "user" ? "ml-auto bg-forest text-white" : "bg-card text-fg")}>
                <div className="space-y-1 leading-relaxed">{md(m.content)}</div>
                {!!m.sources?.length && (
                  <div className="mt-2 space-y-1 border-t border-line pt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted">Fuentes</p>
                    {m.sources.slice(0, 5).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11.5px] text-bluex hover:underline"><ExternalLink className="h-3 w-3 shrink-0" /><span className="truncate">{s.title}</span></a>)}
                  </div>
                )}
                {m.role === "assistant" && <p className="mt-1.5 text-[10px] text-muted">{m.mode === "CLAUDE" ? "Claude + fuentes web oficiales" : "Base de conocimiento del plan"} · revisar con un responsable</p>}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" />Consultando…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(q); }} className="flex items-center gap-2 border-t border-line p-2.5">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escriba su pregunta… / Ask in English" className="h-10 flex-1 rounded-xl border border-line bg-bg px-3 text-sm text-fg outline-none focus:border-agro" maxLength={1000} />
            <button disabled={busy || !q.trim()} className="flex h-10 w-10 items-center justify-center rounded-xl bg-paprika text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      )}
    </>
  );
}
