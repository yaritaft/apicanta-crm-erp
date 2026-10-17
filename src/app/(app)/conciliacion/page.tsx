"use client";

import { ConciliacionVista } from "@/components/finanzas/vistas/ConciliacionVista";

/* La pantalla de siempre: su contenido vive en components/finanzas/vistas/ConciliacionVista.tsx para poder
   mostrarse también adentro de los pasos de Finanzas. */
export default function Pagina() {
  return <ConciliacionVista />;
}
