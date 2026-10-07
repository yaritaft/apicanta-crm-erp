"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { useAcceso } from "@/lib/acceso";
import { abrirDevolucion } from "@/lib/devolucion-ui";
import { puedeCargarDevolucion } from "@/lib/permisos";
import { alElegirDevolucion } from "@/lib/store";
import { CargarDevolucion } from "./CargarDevolucion";

/* ==================================================================
   Está montada en el layout de la app. Hace dos cosas:

   1. Tiene el formulario «Cargar una devolución» listo para abrirse desde
      cualquier pantalla (lib/devolucion-ui: abrirDevolucion).
   2. Cuando una llamada pasa a «Devolución» —desde el CRM, el cierre del día,
      la Agenda o la ficha—, abre ese formulario con la persona de la llamada:
      una cosa dispara la otra, sin depender del cierre del día.

   La devolución la carga Finanzas o el director comercial (decisión D6): el
   closer sólo la ve. Si es él quien pone la llamada en «Devolución», no se le
   abre nada: se le avisa quién la carga.
   ================================================================== */

export function DevolucionGlobal() {
  const { acceso } = useAcceso();
  const toast = useToast();
  const puede = puedeCargarDevolucion(acceso);

  useEffect(() => alElegirDevolucion(({ sesionId }) => {
    if (puede) abrirDevolucion({ sesionId });
    else toast("La llamada quedó en «Devolución». La devolución la carga Finanzas o el director comercial: avisales para que salga de la caja.");
  }), [puede, toast]);

  return <CargarDevolucion />;
}
