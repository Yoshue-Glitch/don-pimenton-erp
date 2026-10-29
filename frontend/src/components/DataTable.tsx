"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, Search, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/hooks";
import { Button, Input, Select, Loading, Empty, ErrorBox } from "./ui";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  hideOnMobile?: boolean;
}

export function Table<T extends { id?: any }>({ columns, rows, onRowClick, empty, rowKey }: { columns: Column<T>[]; rows: T[]; onRowClick?: (r: T) => void; empty?: React.ReactNode; rowKey?: (r: T, i: number) => React.Key }) {
  if (!rows.length) return <>{empty ?? <Empty />}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line bg-soft text-left">
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-[14px] py-3 text-xs font-bold text-fg", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideOnMobile && "hidden md:table-cell")}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : r.id ?? i} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("border-b border-line/70 last:border-0 transition-colors", onRowClick && "cursor-pointer hover:bg-soft/70")}>
              {columns.map((c) => (
                <td key={c.key} className={cn("whitespace-nowrap px-[14px] py-[11px] align-middle text-fg", c.align === "right" && "text-right tabular-nums", c.align === "center" && "text-center", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                  {c.render ? c.render(r) : ((r as any)[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface Filter { key: string; label: string; options: { value: string; label: string }[] }

/** Tabla conectada a un endpoint paginado {items,total,page,pageSize} con búsqueda y filtros. */
export function ServerTable<T extends { id?: any }>({ path, columns, filters = [], searchable = true, onRowClick, reloadKey, toolbar, pageSize = 15, empty }: { path: string; columns: Column<T>[]; filters?: Filter[]; searchable?: boolean; onRowClick?: (r: T) => void; reloadKey?: unknown; toolbar?: React.ReactNode; pageSize?: number; empty?: React.ReactNode }) {
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [vals, setVals] = React.useState<Record<string, string>>({});
  React.useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(debounced ? { q: debounced } : {}), ...Object.fromEntries(Object.entries(vals).filter(([, v]) => v)) });
  const sep = path.includes("?") ? "&" : "?";
  const { data, loading, error, reload } = useApi<{ items: T[]; total: number; page: number; pageSize: number }>(`${path}${sep}${qs}`, [reloadKey]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {searchable && (
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="pl-8" />
          </div>
        )}
        {filters.map((f) => (
          <Select key={f.key} value={vals[f.key] ?? ""} onChange={(e) => { setVals((v) => ({ ...v, [f.key]: e.target.value })); setPage(1); }} className="w-auto min-w-[150px]">
            <option value="">{f.label}: todos</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <Button variant="ghost" size="icon" onClick={reload} title="Actualizar"><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
        </div>
      </div>
      {error ? <div className="p-4"><ErrorBox message={error} /></div> : loading && !data ? <Loading /> : <Table columns={columns} rows={data?.items ?? []} onRowClick={onRowClick} empty={empty} />}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
          <span>{data.total} registro(s) · página {data.page} de {pages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tabla de arreglo con búsqueda y paginación en el cliente. */
export function LocalTable<T extends { id?: any }>({ rows, columns, searchKeys = [], pageSize = 15, onRowClick, toolbar, empty }: { rows: T[]; columns: Column<T>[]; searchKeys?: string[]; pageSize?: number; onRowClick?: (r: T) => void; toolbar?: React.ReactNode; empty?: React.ReactNode }) {
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const filtered = q ? rows.filter((r) => searchKeys.some((k) => String(k.split(".").reduce((o: any, p) => o?.[p], r) ?? "").toLowerCase().includes(q.toLowerCase()))) : rows;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div>
      {(searchKeys.length > 0 || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {searchKeys.length > 0 && (
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Buscar…" className="pl-8" />
            </div>
          )}
          <div className="ml-auto flex gap-2">{toolbar}</div>
        </div>
      )}
      <Table columns={columns} rows={slice} onRowClick={onRowClick} empty={empty} />
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
          <span>{filtered.length} registro(s) · página {page} de {pages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
