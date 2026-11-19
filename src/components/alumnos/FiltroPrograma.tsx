"use client";

import React from "react";
import { Select } from "@/components/ui/ui";
import { num } from "@/lib/format";

/* Filtrar a los alumnos por el programa contratado (Lili, 19/11: los viejos —Hackear IT— tienen contemplación y garantía extendida; el
   Downsell y los nuevos no, y todos juntos no se distinguen). Los nombres vienen de lib/clientes-cs.ts (familiaDePrograma): «HACKEAR IA»
   y «Hackear AI» son el mismo. Se elige uno y la lista, el tablero o el panel muestran sólo esos. */
export function FiltroPrograma({ valor, onCambiar, opciones, className }: {
  valor: string; onCambiar: (programa: string) => void; opciones: { programa: string; n: number }[]; className?: string;
}) {
  /* Si el link trae un programa que ya no está entre las opciones, se muestra igual para poder sacarlo. */
  const lista = valor && !opciones.some((o) => o.programa === valor) ? [...opciones, { programa: valor, n: 0 }] : opciones;
  return (
    <Select
      className={className} aria-label="Filtrar por programa" placeholder="Todos los programas" value={valor}
      opciones={lista.map((o) => ({ valor: o.programa, texto: `${o.programa} · ${num(o.n)}` }))}
      onChange={(ev) => onCambiar(ev.target.value)}
    />
  );
}
