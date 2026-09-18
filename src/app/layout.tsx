import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata: Metadata = {
  title: "Apicanta — ERP de Hackear IT",
  description: "Leads, pipeline, agenda, webinars, alumnos, marketing y finanzas en un solo lugar.",
};

export const viewport: Viewport = {
  themeColor: "#120a24",
  width: "device-width",
  initialScale: 1,
};

/* Aplica el tema guardado antes del primer pintado: sin parpadeo. */
const TEMA_INICIAL = `(function(){try{var s=localStorage.getItem("apicanta.erp.v1");if(s){var t=JSON.parse(s).ajustes&&JSON.parse(s).ajustes.tema;if(t)document.documentElement.dataset.theme=t}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: TEMA_INICIAL }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
