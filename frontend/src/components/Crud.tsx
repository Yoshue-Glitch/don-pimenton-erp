"use client";
import * as React from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ServerTable, Column, Filter } from "./DataTable";
import { FormDialog, FieldDef } from "./FormDialog";
import { Button, ConfirmDialog } from "./ui";
import { useAuth, useToast } from "./providers";

/** Sección CRUD de datos maestros: tabla paginada + alta/edición/baja con permisos. */
export function CrudSection<T extends { id: number }>({ path, columns, fields, writePerm, title, filters, toEdit, canDelete = true, extraActions, newLabel = "Nuevo" }: {
  path: string; columns: Column<T>[]; fields: FieldDef[]; writePerm: string; title: string; filters?: Filter[];
  toEdit?: (r: T) => Record<string, any>; canDelete?: boolean; extraActions?: (r: T, reload: () => void) => React.ReactNode; newLabel?: string;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = React.useState(0);
  const [editing, setEditing] = React.useState<T | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<T | null>(null);
  const [busy, setBusy] = React.useState(false);
  const reload = () => setReloadKey((k) => k + 1);
  const writable = can(writePerm);
  const cols: Column<T>[] = writable || extraActions ? [...columns, {
    key: "_actions", header: "", align: "right", render: (r) => (
      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {extraActions?.(r, reload)}
        {writable && <Button size="icon" variant="ghost" title="Editar" onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>}
        {writable && canDelete && <Button size="icon" variant="ghost" title="Eliminar" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
      </div>
    ),
  }] : columns;
  return (
    <>
      <ServerTable path={path} columns={cols} filters={filters} reloadKey={reloadKey}
        toolbar={writable && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />{newLabel}</Button>} />
      <FormDialog open={creating} onClose={() => setCreating(false)} title={`${newLabel}: ${title}`} fields={fields}
        onSubmit={async (v, key) => { await api(path, { body: v, idempotencyKey: key }); reload(); }} />
      <FormDialog open={!!editing} onClose={() => setEditing(null)} title={`Editar ${title}`} fields={fields} initial={editing ? (toEdit ? toEdit(editing) : editing) : {}}
        onSubmit={async (v) => { await api(`${path}/${editing!.id}`, { method: "PUT", body: v }); reload(); }} />
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} danger title={`Eliminar ${title}`} message="Esta acción no se puede deshacer. Si el registro tiene movimientos asociados, el sistema impedirá la eliminación." confirmText="Eliminar" loading={busy}
        onConfirm={async () => { setBusy(true); try { await api(`${path}/${deleting!.id}`, { method: "DELETE" }); toast.success("Registro eliminado"); reload(); setDeleting(null); } catch (e: any) { toast.error("No se pudo eliminar", e.message); } finally { setBusy(false); } }} />
    </>
  );
}

/** Opciones para selects a partir de un endpoint (lista o paginado). */
export function useOptions(path: string | null, label: (r: any) => string, value: (r: any) => any = (r) => r.id) {
  const { data } = useApi<any>(path);
  return React.useMemo(() => {
    const rows = Array.isArray(data) ? data : data?.items ?? [];
    return rows.map((r: any) => ({ value: value(r), label: label(r) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}

export const dateOnly = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
