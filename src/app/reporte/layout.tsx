import type { Metadata } from "next";

/* El reporte semanal es de cada alumno (se entra con su código): que no lo indexe ningún buscador. El título no nombra un
   programa: la misma página es el formulario de Hackear IT y el de Hackear Biz (26/10). */
export const metadata: Metadata = {
  title: "Formulario semanal",
  description: "Completá tu reporte semanal.",
  robots: { index: false, follow: false },
};

export default function LayoutReporte({ children }: { children: React.ReactNode }) {
  return children;
}
