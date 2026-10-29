"use client";
import * as React from "react";
import { Settings, Save, UserPlus, KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { dateTime, cn } from "@/lib/utils";
import { Card, CardHeader, CardBody, PageHeader, Button, Tabs, Badge, Notice, Field, Input, Select, Loading, StatusBadge } from "@/components/ui";
import { ServerTable, LocalTable } from "@/components/DataTable";
import { FormDialog } from "@/components/FormDialog";
import { useOptions } from "@/components/Crud";
import { useAuth, useToast } from "@/components/providers";

const MODS: [string, string, boolean][] = [
  ["agricultura", "Gestión agrícola", true], ["produccion", "Producción", true], ["calidad", "Calidad e inocuidad", true], ["inventario", "Inventarios", true], ["ventas", "Ventas y clientes", true],
  ["compras", "Compras y proveedores", false], ["logistica", "Logística", false], ["blockchain", "Blockchain & Smart Contracts", false],
  ["finanzas", "Administración y Finanzas (proyectado)", false], ["rrhh", "Recursos Humanos (proyectado)", false], ["exportaciones", "Departamento de Exportaciones (proyectado)", false],
];

export default function Configuracion() {
  const { can, refresh } = useAuth();
  const tabs = [
    ...(can("settings.manage") ? [{ id: "modulos" as const, label: "Módulos" }, { id: "parametros" as const, label: "Parámetros" }] : []),
    ...(can("users.manage") ? [{ id: "usuarios" as const, label: "Usuarios" }, { id: "permisos" as const, label: "Roles y permisos" }] : []),
    ...(can("audit.read") ? [{ id: "auditoria" as const, label: "Auditoría" }] : []),
  ];
  const [tab, setTab] = React.useState<(typeof tabs)[number]["id"]>(tabs[0]?.id ?? "auditoria");
  return (
    <div className="space-y-4">
      <PageHeader area="Sistema" title="Configuración" subtitle="Módulos, parámetros, usuarios, permisos y auditoría" icon={<Settings className="h-5 w-5" />} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "modulos" && <Modules onSaved={refresh} />}
      {tab === "parametros" && <Params />}
      {tab === "usuarios" && <Users />}
      {tab === "permisos" && <Roles onSaved={refresh} />}
      {tab === "auditoria" && <Card><ServerTable path="/admin/audit" columns={[
        { key: "d", header: "Fecha", render: (r: any) => dateTime(r.createdAt) }, { key: "u", header: "Usuario", render: (r: any) => r.user?.name ?? "Sistema" },
        { key: "a", header: "Acción", render: (r: any) => <Badge tone={/DENEGADO|FALLIDO/.test(r.action) ? "red" : "slate"}>{r.action}</Badge> }, { key: "e", header: "Entidad", render: (r: any) => `${r.entity}${r.entityId ? ` #${r.entityId}` : ""}` },
        { key: "det", header: "Detalle", render: (r: any) => <span className="break-all font-mono text-[10px] text-muted">{r.details ? JSON.stringify(r.details).slice(0, 160) : ""}</span> }, { key: "ip", header: "IP", render: (r: any) => <span className="text-xs">{r.ip ?? "—"}</span>, hideOnMobile: true },
      ]} /></Card>}
    </div>
  );
}

function Modules({ onSaved }: { onSaved: () => void }) {
  const { data, reload } = useApi<any>("/admin/settings");
  const toast = useToast();
  const [m, setM] = React.useState<Record<string, boolean> | null>(null);
  React.useEffect(() => { if (data) setM(data["modules.enabled"]); }, [data]);
  if (!m) return <Loading />;
  const save = async () => { try { await api("/admin/settings/modules.enabled", { method: "PUT", body: { value: m } }); toast.success("Módulos actualizados"); reload(); onSaved(); } catch (e: any) { toast.error("Error", e.message); } };
  return (
    <Card><CardHeader title="Activación de módulos" subtitle="Los módulos proyectados pueden activarse o desactivarse; el núcleo operativo permanece activo" actions={<Button onClick={save}><Save className="h-4 w-4" />Guardar</Button>} />
      <CardBody className="grid gap-2 sm:grid-cols-2">
        {MODS.map(([k, label, core]) => (
          <label key={k} className={cn("flex items-center justify-between rounded-lg border border-line px-4 py-3", core && "opacity-70")}>
            <span className="text-sm">{label} {core && <Badge>núcleo</Badge>}</span>
            <button type="button" disabled={core} onClick={() => setM({ ...m, [k]: !m[k] })} className={cn("relative h-6 w-11 rounded-full transition-colors", m[k] !== false ? "bg-agro" : "bg-line")}><span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", m[k] !== false ? "left-[22px]" : "left-0.5")} /></button>
          </label>
        ))}
      </CardBody>
    </Card>
  );
}

function Params() {
  const { data, reload } = useApi<any>("/admin/settings");
  const toast = useToast();
  const [v, setV] = React.useState<any>(null);
  React.useEffect(() => { if (data) setV({ policy: data["inventory.dispatchPolicy"], fx: data["fx.defaultUsdPen"], pen: data["blockchain.penPerTestEth"], taxes: data["tax.rates"], def: data["tax.defaultCode"] }); }, [data]);
  if (!v) return <Loading />;
  const save = async () => {
    try {
      await api("/admin/settings/inventory.dispatchPolicy", { method: "PUT", body: { value: v.policy } });
      await api("/admin/settings/fx.defaultUsdPen", { method: "PUT", body: { value: Number(v.fx) } });
      await api("/admin/settings/blockchain.penPerTestEth", { method: "PUT", body: { value: Number(v.pen) } });
      await api("/admin/settings/tax.rates", { method: "PUT", body: { value: v.taxes.map((t: any) => ({ ...t, rate: Number(t.rate) })) } });
      await api("/admin/settings/tax.defaultCode", { method: "PUT", body: { value: v.def } });
      toast.success("Parámetros guardados"); reload();
    } catch (e: any) { toast.error("Error", e.message); }
  };
  return (
    <Card><CardHeader title="Parámetros del sistema" actions={<Button onClick={save}><Save className="h-4 w-4" />Guardar</Button>} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Política de salida de inventario" hint="Momento en que el despacho descuenta el stock"><Select value={v.policy} onChange={(e) => setV({ ...v, policy: e.target.value })}><option value="ON_DISPATCH">Al despachar</option><option value="ON_DELIVERY">Al entregar</option></Select></Field>
          <Field label="Tipo de cambio USD por defecto (PEN)"><Input type="number" step="any" value={v.fx} onChange={(e) => setV({ ...v, fx: e.target.value })} /></Field>
          <Field label="Referencia S/ por 1 ETH de prueba" hint="Solo para convertir importes de demostración"><Input type="number" value={v.pen} onChange={(e) => setV({ ...v, pen: e.target.value })} /></Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Impuestos configurados</p>
          {v.taxes.map((t: any, i: number) => (
            <div key={i} className="mb-2 grid grid-cols-6 gap-2">
              <Input value={t.code} onChange={(e) => setV({ ...v, taxes: v.taxes.map((x: any, j: number) => j === i ? { ...x, code: e.target.value } : x) })} />
              <Input className="col-span-3" value={t.name} onChange={(e) => setV({ ...v, taxes: v.taxes.map((x: any, j: number) => j === i ? { ...x, name: e.target.value } : x) })} />
              <Input type="number" step="0.01" value={t.rate} onChange={(e) => setV({ ...v, taxes: v.taxes.map((x: any, j: number) => j === i ? { ...x, rate: e.target.value } : x) })} />
              <label className="flex items-center gap-1 text-xs"><input type="radio" className="accent-paprika" checked={v.def === t.code} onChange={() => setV({ ...v, def: t.code })} />Por defecto</label>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setV({ ...v, taxes: [...v.taxes, { code: "NEW", name: "Nuevo impuesto", rate: 0 }] })}>Agregar impuesto</Button>
        </div>
        <Notice>La configuración tributaria real (IGV, exoneraciones, detracciones, facturación electrónica) requiere validación por un especialista antes de su uso en producción.</Notice>
      </CardBody>
    </Card>
  );
}

function Users() {
  const { data, reload } = useApi<any[]>("/admin/users");
  const roles = useOptions("/admin/roles", () => "", () => 0);
  const { data: rd } = useApi<any>("/admin/roles");
  const roleOpts = (rd?.roles ?? []).map((r: any) => ({ value: r.id, label: r.name }));
  const areas = useOptions("/admin/areas", (a) => a.name);
  const [create, setCreate] = React.useState(false);
  const [edit, setEdit] = React.useState<any>(null);
  void roles;
  return (
    <Card>
      <LocalTable rows={data ?? []} searchKeys={["email", "name"]} toolbar={<Button size="sm" onClick={() => setCreate(true)}><UserPlus className="h-4 w-4" />Nuevo usuario</Button>} columns={[
        { key: "name", header: "Nombre", render: (r: any) => <span className="font-medium">{r.name}</span> }, { key: "email", header: "Correo" }, { key: "role", header: "Rol", render: (r: any) => <Badge tone="paprika">{r.role.name}</Badge> },
        { key: "area", header: "Área", render: (r: any) => r.area?.name ?? "—" }, { key: "last", header: "Último acceso", render: (r: any) => dateTime(r.lastLoginAt) },
        { key: "s", header: "Estado", render: (r: any) => r.lockedUntil && new Date(r.lockedUntil) > new Date() ? <Badge tone="red">Bloqueado</Badge> : <StatusBadge status={r.active ? "ACTIVO" : "INACTIVA"} label={r.active ? "Activo" : "Inactivo"} /> },
        { key: "a", header: "", align: "right", render: (r: any) => <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><KeyRound className="h-4 w-4" />Editar</Button> },
      ]} />
      <FormDialog open={create} onClose={() => { setCreate(false); reload(); }} title="Nuevo usuario" successMessage="Usuario creado"
        fields={[{ name: "name", label: "Nombre", required: true }, { name: "email", label: "Correo", type: "email", required: true }, { name: "password", label: "Contraseña", type: "password", required: true, hint: "Mín. 10 caracteres con mayúscula, minúscula y número" }, { name: "roleId", label: "Rol", type: "select", required: true, options: roleOpts }, { name: "areaId", label: "Área", type: "select", options: areas }]}
        onSubmit={(v) => api("/admin/users", { body: v })} />
      <FormDialog open={!!edit} onClose={() => { setEdit(null); reload(); }} title={`Editar ${edit?.email ?? ""}`} successMessage="Usuario actualizado" initial={edit ? { name: edit.name, roleId: rd?.roles.find((r: any) => r.code === edit.role.code)?.id, active: edit.active } : {}}
        fields={[{ name: "name", label: "Nombre", required: true }, { name: "roleId", label: "Rol", type: "select", required: true, options: roleOpts }, { name: "password", label: "Nueva contraseña (opcional)", type: "password" }, { name: "active", label: "Activo", type: "checkbox" }, { name: "unlock", label: "Desbloquear cuenta", type: "checkbox" }]}
        onSubmit={(v) => api(`/admin/users/${edit.id}`, { method: "PUT", body: v })} />
    </Card>
  );
}

function Roles({ onSaved }: { onSaved: () => void }) {
  const { data, reload } = useApi<any>("/admin/roles");
  const toast = useToast();
  const [sel, setSel] = React.useState<number | null>(null);
  const [perms, setPerms] = React.useState<Set<string>>(new Set());
  React.useEffect(() => { if (data && sel === null) setSel(data.roles[0].id); }, [data, sel]);
  React.useEffect(() => { const r = data?.roles.find((x: any) => x.id === sel); if (r) setPerms(new Set(r.permissions)); }, [sel, data]);
  if (!data) return <Loading />;
  const role = data.roles.find((r: any) => r.id === sel);
  const groups = data.permissions.reduce((acc: any, p: any) => { (acc[p.module] ??= []).push(p); return acc; }, {});
  const save = async () => { try { await api(`/admin/roles/${sel}/permissions`, { method: "PUT", body: { permissions: [...perms] } }); toast.success("Permisos guardados", role.name); reload(); onSaved(); } catch (e: any) { toast.error("No se pudo guardar", e.message); } };
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit"><div className="divide-y divide-line">{data.roles.map((r: any) => (
        <button key={r.id} onClick={() => setSel(r.id)} className={cn("block w-full px-4 py-3 text-left hover:bg-soft", sel === r.id && "bg-soft")}><p className="text-sm font-semibold">{r.name}</p><p className="text-xs text-muted">{r.permissions.length} permisos · {r.users} usuario(s)</p></button>
      ))}</div></Card>
      {role && <Card>
        <CardHeader title={role.name} subtitle={role.description} actions={<Button onClick={save}><Save className="h-4 w-4" />Guardar permisos</Button>} />
        <CardBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(groups).map(([mod, ps]: any) => (
            <div key={mod} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-paprika">{mod}</p>
              {ps.map((p: any) => (
                <label key={p.code} className="flex items-start gap-2 py-1 text-xs">
                  <input type="checkbox" className="mt-0.5 accent-paprika" checked={perms.has(p.code)} onChange={(e) => { const n = new Set(perms); e.target.checked ? n.add(p.code) : n.delete(p.code); setPerms(n); }} />
                  <span><span className="font-mono">{p.code}</span><br /><span className="text-muted">{p.description}</span></span>
                </label>
              ))}
            </div>
          ))}
        </CardBody>
      </Card>}
    </div>
  );
}
