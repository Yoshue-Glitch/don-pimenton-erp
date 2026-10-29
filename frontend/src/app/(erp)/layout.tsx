"use client";
import { Suspense } from "react";
import { AuthProvider, useAuth } from "@/components/providers";
import { Shell } from "@/components/Shell";
import { Loading } from "@/components/ui";

function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center bg-bg"><Loading label="Verificando sesión…" /></div>;
  return <Suspense fallback={null}><Shell>{children}</Shell></Suspense>;
}

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><Gate>{children}</Gate></AuthProvider>;
}
