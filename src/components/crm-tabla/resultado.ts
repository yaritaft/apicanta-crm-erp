import type { VarianteBadge } from "@/components/ui/ui";

/* El color de cada resultado de una llamada, igual en la tabla, el EOD y la ficha. */
export const VARIANTE_RESULTADO: Record<string, VarianteBadge> = {
  "Con cierre": "success", "Sin cierre": "warning", "No se presentó": "danger", "Reprogramó": "neutral",
  "Sin cargar": "accent", "Por venir": "info", "Cancelada": "neutral",
};
