import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/providers";

export const metadata: Metadata = {
  title: "Don Pimentón ERP | Agroindustrial Management & Blockchain",
  description: "Del campo al mercado, con calidad y trazabilidad",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#A52A2A" };

const themeScript = `try{var t=localStorage.getItem('dp-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
