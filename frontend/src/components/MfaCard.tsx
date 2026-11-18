"use client";
/** Doble factor (TOTP) para roles críticos: Gerencia, Calidad, Exportaciones, Logística, Finanzas. */
import * as React from "react";
import QRCode from "qrcode";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardBody, Button, Input, Badge, Notice } from "@/components/ui";
import { useAuth, useToast } from "@/components/providers";

export function MfaCard() {
  const { user, refresh } = useAuth() as any;
  const toast = useToast();
  const [setup, setSetup] = React.useState<any>(null);
  const [qr, setQr] = React.useState<string>("");
  const [code, setCode] = React.useState("");
  const enabled = (user as any)?.mfa;
  const start = async () => { const r = await api<any>("/auth/mfa/setup", { body: {} }); setSetup(r); setQr(await QRCode.toDataURL(r.uri, { width: 180, margin: 1 })); };
  const enable = async () => { try { await api("/auth/mfa/enable", { body: { code } }); toast.success("Doble factor activado", "Se pedirá el código en cada inicio de sesión"); setSetup(null); setCode(""); refresh(); } catch (e: any) { toast.error("Doble factor", e.message); } };
  const disable = async () => { try { await api("/auth/mfa/disable", { body: { code } }); toast.success("Doble factor desactivado"); setCode(""); refresh(); } catch (e: any) { toast.error("Doble factor", e.message); } };
  return (
    <Card><CardHeader title="Mi seguridad · doble factor (TOTP)" subtitle="Recomendado y exigible para Gerencia, Calidad, Exportaciones, Logística y Finanzas (TI-12)" icon={<KeyRound className="h-5 w-5" />} actions={<Badge tone={enabled ? "green" : "amber"}>{enabled ? "Activado" : "Desactivado"}</Badge>} />
      <CardBody className="space-y-3">
        {!enabled && !setup && <Button onClick={start}>Configurar aplicación autenticadora</Button>}
        {setup && <div className="flex flex-wrap items-start gap-4">{qr && <img src={qr} alt="QR para la app autenticadora" className="rounded-lg border border-line" />}<div className="space-y-2 text-sm"><p>Escanee el QR con Google/Microsoft Authenticator o ingrese la clave:</p><code className="block break-all rounded bg-soft p-2 text-xs">{setup.secret}</code><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} maxLength={6} placeholder="Código de 6 dígitos" className="w-44 tracking-[.3em]" /><Button onClick={enable} disabled={code.length !== 6}>Activar</Button></div></div>}
        {enabled && <div className="flex flex-wrap items-center gap-2"><Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} maxLength={6} placeholder="Código actual" className="w-40" /><Button variant="outline" onClick={disable} disabled={code.length !== 6}>Desactivar doble factor</Button></div>}
        <Notice tone="blue">Contraseñas con hash bcrypt, sesiones con token opaco (solo se guarda su SHA-256), bloqueo tras 5 intentos, permisos validados en el servidor y bitácora de auditoría de cada operación.</Notice>
      </CardBody></Card>
  );
}
