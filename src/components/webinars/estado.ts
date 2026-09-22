import type { VarianteBadge } from "@/components/ui/ui";
import type { EstadoWebinar } from "@/lib/types";

/* Cómo se nombra y se pinta cada estado, igual en la planilla y en la ficha. */
export const ESTADO_WEBINAR: Record<EstadoWebinar, { texto: string; variante: VarianteBadge }> = {
  "borrador":   { texto: "Borrador",   variante: "neutral" },
  "programado": { texto: "Programado", variante: "accent" },
  "en-vivo":    { texto: "En vivo",    variante: "danger" },
  "finalizado": { texto: "Finalizado", variante: "success" },
};

export const ESTADOS: EstadoWebinar[] = ["borrador", "programado", "en-vivo", "finalizado"];

/* La lista guarda acá su dirección con filtros, para que "Volver" desde la
   ficha deje todo como estaba (período, webinars elegidos, estado). */
export const CLAVE_LISTA = "apicanta:webinars:lista";

/* El color de un ROAS: 3x o más es sano, de 1,5x a 3x hay que mirarlo, y
   abajo de 1,5x no se recupera lo invertido con margen. */
export function tonoRoas(r: number): string {
  return r >= 3 ? "var(--success)" : r >= 1.5 ? "var(--warning)" : "var(--danger)";
}
