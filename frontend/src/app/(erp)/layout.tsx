"use client";
import { Suspense } from "react";
import { AuthProvider, useAuth } from "@/components/providers";
import { Shell } from "@/components/Shell";
import { Loading } from "@/components/ui";

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // Las cuentas externas del comprador o broker usan el portal, no el ERP interno
  if (user && ["COMPRADOR", "BROKER"].includes(user.role) && typeof window !== "undefined") { window.location.replace("/portal"); return null; }
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center bg-bg"><Loading label="Verificando sesión…" /></div>;
  return <Suspense fallback={null}><Shell>{children}</Shell></Suspense>;
}

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><Gate>{children}</Gate></AuthProvider>;
}
