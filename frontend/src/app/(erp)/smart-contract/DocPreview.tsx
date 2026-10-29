"use client";
import { cn } from "@/lib/utils";
import { PepperLogo } from "@/components/Shell";
import { COMPANY, MISSING, type Block, type Bi, type DocModel } from "./docModels";

/** Resalta los campos que el usuario debe completar. */
function Val({ v }: { v: string }) {
  if (!v.includes(MISSING)) return <>{v}</>;
  const parts = v.split(MISSING);
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <mark className="rounded bg-amber-100 px-1 text-amber-900">{MISSING}</mark>}</span>)}</>;
}
const L = ({ t }: { t: Bi }) => <>{t[0]} <span className="font-normal text-muted">/ {t[1]}</span></>;

function BlockView({ b }: { b: Block }) {
  const title = "title" in b && b.title ? <p className="mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-forest dark:text-emerald-300"><L t={b.title} /></p> : null;
  if (b.kind === "kv") return (
    <div>{title}
      <table className="w-full border-collapse text-[12px]"><tbody>
        {b.rows.map(([k, v], i) => <tr key={i} className="border border-line"><td className="w-[34%] bg-soft px-2.5 py-1.5 align-top font-semibold"><L t={k} /></td><td className="px-2.5 py-1.5 align-top"><Val v={v} /></td></tr>)}
      </tbody></table>
    </div>
  );
  if (b.kind === "table") return (
    <div>{title}
      <table className="w-full border-collapse text-[12px]">
        <thead><tr>{b.head.map((h, i) => <th key={i} className="border border-line bg-soft px-2 py-1.5 text-left font-semibold">{h[0]}<br /><span className="font-normal text-muted">{h[1]}</span></th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-line px-2 py-1.5 align-top"><Val v={c} /></td>)}</tr>)}</tbody>
        {b.foot && <tfoot>{b.foot.map(([k, v], i) => <tr key={i}><td colSpan={b.head.length - 1} className="border border-line px-2 py-1.5 text-right font-bold"><L t={k} /></td><td className="border border-line px-2 py-1.5 font-bold">{v}</td></tr>)}</tfoot>}
      </table>
    </div>
  );
  if (b.kind === "text") return <div>{title}{b.paragraphs.map((p, i) => <p key={i} className="mb-2 text-[12.5px] leading-relaxed"><Val v={p} /></p>)}</div>;
  if (b.kind === "clauses") return (
    <div>{title}{b.items.map((c, i) => (
      <div key={i} className="mb-2.5 text-[12px]">
        <p className="font-bold"><L t={c.title} /></p>
        <p className="leading-relaxed"><Val v={c.en} /></p>
        <p className="italic leading-relaxed text-muted"><Val v={c.es} /></p>
      </div>
    ))}</div>
  );
  return <div className={cn("mt-8 grid gap-6", b.parties.length > 1 ? "sm:grid-cols-2" : "")}>{b.parties.map((p) => <div key={p} className="border-t border-fg/60 pt-1.5 text-center text-[11px]">{p}</div>)}</div>;
}

export function DocPreview({ model }: { model: DocModel }) {
  return (
    <div className="mx-auto max-w-[820px] rounded-lg border border-line bg-white p-6 text-ink shadow-card dark:bg-card dark:text-fg sm:p-8">
      <div className="flex items-start justify-between gap-4 border-b-2 border-paprika pb-3">
        <div className="flex items-center gap-2.5">
          <PepperLogo className="h-10 w-9" />
          <div><p className="font-display text-xl font-bold text-forest dark:text-emerald-200">{COMPANY.name}</p><p className="text-[10px] text-muted">{COMPANY.ruc} · {COMPANY.address} · {COMPANY.email}</p></div>
        </div>
        <div className="text-right"><p className="text-sm font-extrabold uppercase">{model.title[0]}</p><p className="text-xs text-muted">{model.title[1]}</p><p className="mt-1 font-mono text-[10px]">Ref. {model.ref}</p></div>
      </div>
      {model.issuedBy && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{model.issuedBy}</p>}
      {model.blocks.map((b, i) => <BlockView key={i} b={b} />)}
      <p className="mt-6 border-t border-line pt-2 text-center text-[9.5px] text-muted">Modelo de referencia generado por Don Pimentón ERP con datos de demostración — no es un documento oficial. Revise y complete los campos marcados antes de usarlo.</p>
    </div>
  );
}
