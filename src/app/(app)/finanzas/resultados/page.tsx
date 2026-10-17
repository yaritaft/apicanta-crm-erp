"use client";

import { ResultadosVista } from "@/components/finanzas/vistas/ResultadosVista";

/* La pantalla de siempre: su contenido vive en components/finanzas/vistas/ResultadosVista.tsx para poder
   mostrarse también adentro de los pasos de Finanzas. */
export default function Pagina() {
  return <ResultadosVista />;
}
