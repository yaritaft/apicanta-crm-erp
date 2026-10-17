"use client";

import { CajaVista } from "@/components/finanzas/vistas/CajaVista";

/* La pantalla de siempre: su contenido vive en components/finanzas/vistas/CajaVista.tsx para poder
   mostrarse también adentro de los pasos de Finanzas. */
export default function Pagina() {
  return <CajaVista />;
}
