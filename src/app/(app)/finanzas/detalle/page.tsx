"use client";

import { DetalleVista } from "@/components/finanzas/vistas/DetalleVista";

/* La pantalla de siempre: su contenido vive en components/finanzas/vistas/DetalleVista.tsx para poder
   mostrarse también adentro de los pasos de Finanzas. */
export default function Pagina() {
  return <DetalleVista />;
}
