import type { Metadata } from "next";

/* El reporte semanal es de cada alumno (se entra con su código): que no lo indexe ningún buscador. */
export const metadata: Metadata = {
  title: "Reporte semanal — Hackear IT",
  description: "Completá tu reporte semanal.",
  robots: { index: false, follow: false },
};

export default function LayoutReporte({ children }: { children: React.ReactNode }) {
  return children;
}
