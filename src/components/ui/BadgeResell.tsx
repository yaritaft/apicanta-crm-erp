import React from "react";
import { Repeat2 } from "lucide-react";
import { Badge } from "@/components/ui/ui";
import { esLlamadaDeResell } from "@/lib/resells";
import type { Sesion } from "@/lib/types";

/* La marca de una llamada de resell (la que se agenda con un alumno para renovar: eventos «auditoría», «resell» o «próximos pasos», o
   utm_source Resell). Donde se mezclan con las de venta (la Agenda, la ficha de la persona) se distinguen de un vistazo; en Mis llamadas
   y el CRM tienen su propia solapa, Resell (Mariano, 19/10). */
export function BadgeResell({ s }: { s: Pick<Sesion, "tipo" | "titulo" | "utm"> }) {
  if (!esLlamadaDeResell(s)) return null;
  return (
    <span title="Llamada de resell: se carga en la solapa Resell de Mis llamadas y el CRM">
      <Badge variante="info" icono={<Repeat2 size={12} aria-hidden />}>Resell</Badge>
    </span>
  );
}
