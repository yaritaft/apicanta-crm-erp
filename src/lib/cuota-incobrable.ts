import type { Cuota } from "./types";

/* ---------- Cuotas que no se van a cobrar ----------
   Reunión del 15/10: «si un lead se da de baja, ¿qué pasa con la siguiente
   cuota?». Una cuota incobrable es una cuota cancelada con la marca
   «Incobrable: motivo» en sus notas: sale de lo que falta cobrar, de la mora
   y de la comisión como cualquier cuota cancelada, y queda a la vista el por
   qué. Sin columna nueva en la base. */

export const MARCA_INCOBRABLE = "Incobrable";

export const esIncobrable = (c: Pick<Cuota, "estado" | "notas">) =>
  c.estado === "cancelada" && (c.notas ?? "").startsWith(MARCA_INCOBRABLE);

/** El motivo escrito al marcarla (sin la marca ni lo que tuviera antes en las notas). */
export const motivoIncobrable = (c: Pick<Cuota, "notas">) =>
  (c.notas ?? "").replace(new RegExp(`^${MARCA_INCOBRABLE}:?\\s*`), "").split(" | ")[0].trim();

/** Las notas de una cuota al marcarla incobrable: la marca y el motivo, y lo que ya tenía después. */
export const notasDeIncobrable = (c: Pick<Cuota, "notas">, motivo: string) =>
  `${MARCA_INCOBRABLE}: ${motivo.trim()}${c.notas ? ` | ${c.notas}` : ""}`;

/** Las notas de una cuota que vuelve a cobrarse: lo que tenía antes de marcarla. */
export const notasSinIncobrable = (c: Pick<Cuota, "notas">): string | undefined => {
  const resto = (c.notas ?? "").split(" | ").slice(1).join(" | ").trim();
  return resto || undefined;
};
