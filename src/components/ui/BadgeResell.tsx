import React from "react";
import { GraduationCap, Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/ui";
import { esLlamadaDeResell } from "@/lib/resells";
import { esSesionUnoAUno } from "@/lib/llamadas-de-venta";
import type { Sesion } from "@/lib/types";

/* La marca de una llamada de resell (la que se agenda con un alumno para renovar: eventos «auditoría», «resell» o «próximos pasos», o
   utm_source Resell). Donde se mezclan con las de venta (la Agenda, la ficha de la persona) se distinguen de un vistazo; en Mis llamadas
   y el CRM tienen su propia solapa, Resell (Mariano, 19/10). */
export function BadgeResell({ s }: { s: Pick<Sesion, "tipo" | "titulo" | "utm"> }) {
  /* La sesión 1 a 1 con el mentor (Yari, Nahuel…) tampoco es una llamada de venta: es un bono del contrato y queda en la ficha del alumno
     (Lili, 26/11; lib/llamadas-de-venta.ts). */
  if (esSesionUnoAUno(s)) {
    return (
      <span title="Sesión 1 a 1 con el mentor: es un bono del contrato, queda en la ficha del alumno (Servicio → Bonos) y no cuenta como llamada de venta">
        <Badge variante="info" icono={<GraduationCap size={12} aria-hidden />}>1 a 1</Badge>
      </span>
    );
  }
  if (!esLlamadaDeResell(s)) return null;
  return (
    <span title="Llamada de resell: se carga en la solapa Resell de Mis llamadas y el CRM">
      <Badge variante="info" icono={<Repeat2 size={12} aria-hidden />}>Resell</Badge>
    </span>
  );
}
