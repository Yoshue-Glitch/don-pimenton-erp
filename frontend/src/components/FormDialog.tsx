"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { newKey } from "@/lib/api";
import { useToast } from "./providers";
import { Button, Field, Input, Modal, Select, Textarea, ErrorBox } from "./ui";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "select" | "textarea" | "checkbox" | "email" | "password";
  options?: { value: string | number; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
  placeholder?: string;
  hint?: string;
  full?: boolean;
  pattern?: RegExp;
  patternMsg?: string;
  show?: (v: Record<string, any>) => boolean;
}

/** Formulario modal declarativo con validación en cliente y envío idempotente. */
export function FormDialog({ open, onClose, title, subtitle, fields, initial = {}, onSubmit, submitLabel = "Guardar", successMessage = "Registro guardado", size = "md", children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; fields: FieldDef[]; initial?: Record<string, any>;
  onSubmit: (values: Record<string, any>, idempotencyKey: string) => Promise<unknown>; submitLabel?: string; successMessage?: string; size?: "sm" | "md" | "lg" | "xl";
  children?: (values: Record<string, any>, set: (k: string, v: any) => void) => React.ReactNode;
}) {
  const [values, setValues] = React.useState<Record<string, any>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const keyRef = React.useRef(newKey());
  const toast = useToast();
  React.useEffect(() => {
    if (open) { setValues(initial); setErrors({}); setServerError(null); keyRef.current = newKey(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    for (const f of fields) {
      if (f.show && !f.show(values)) continue;
      const v = values[f.name];
      if (f.required && (v === undefined || v === null || v === "")) { e[f.name] = "Campo obligatorio"; continue; }
      if (f.type === "number" && v !== "" && v !== undefined && v !== null) {
        const n = Number(v);
        if (Number.isNaN(n)) e[f.name] = "Número inválido";
        else if (f.min !== undefined && n < f.min) e[f.name] = `Mínimo ${f.min}`;
        else if (f.max !== undefined && n > f.max) e[f.name] = `Máximo ${f.max}`;
      }
      if (f.pattern && v && !f.pattern.test(String(v))) e[f.name] = f.patternMsg ?? "Formato inválido";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true); setServerError(null);
    try {
      const payload: Record<string, any> = {};
      for (const f of fields) {
        if (f.show && !f.show(values)) continue;
        let v = values[f.name];
        if (v === "" || v === undefined) { if (!f.required) continue; }
        if (f.type === "number" && v !== null && v !== undefined && v !== "") v = Number(v);
        if (f.type === "select" && f.options?.length && typeof f.options[0].value === "number" && v !== "" && v !== null) v = Number(v);
        payload[f.name] = v;
      }
      for (const [k, v] of Object.entries(values)) if (!(k in payload) && !fields.some((f) => f.name === k)) payload[k] = v;
      await onSubmit(payload, keyRef.current);
      toast.success(successMessage);
      onClose();
    } catch (e: any) {
      setServerError(e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size={size}
      footer={<><Button variant="outline" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" form="form-dialog" loading={saving}>{submitLabel}</Button></>}>
      <form id="form-dialog" onSubmit={submit} className="space-y-4" noValidate>
        {serverError && <ErrorBox message={serverError} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.filter((f) => !f.show || f.show(values)).map((f) => (
            <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]} hint={f.hint} className={cn((f.full || f.type === "textarea") && "sm:col-span-2")}>
              {f.type === "select" ? (
                <Select value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">Seleccione…</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === "textarea" ? (
                <Textarea value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
              ) : f.type === "checkbox" ? (
                <div className="flex h-9 items-center"><input type="checkbox" className="h-4 w-4 accent-paprika" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} /></div>
              ) : (
                <Input type={f.type ?? "text"} value={values[f.name] ?? ""} min={f.min} max={f.max} step={f.step} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />
              )}
            </Field>
          ))}
        </div>
        {children?.(values, set)}
      </form>
    </Modal>
  );
}
