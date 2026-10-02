import type { VarianteBadge } from "@/components/ui/ui";

/* ---------- Estados ----------
   Las claves son las de Meta en minúscula (ver `claveEstado`). Las dos
   "apagado" no son un estado de Meta sino la entrega: el anuncio está activo
   pero su campaña o su conjunto no, así que no sale. Es lo que Meta muestra en
   la columna "Entrega". */
export const ESTADOS: Record<string, { f: string; m: string; variante: VarianteBadge }> = {
  active: { f: "Activa", m: "Activo", variante: "success" },
  paused: { f: "Pausada", m: "Pausado", variante: "warning" },
  campaign_paused: { f: "Campaña apagada", m: "Campaña apagada", variante: "neutral" },
  adset_paused: { f: "Conjunto apagado", m: "Conjunto apagado", variante: "neutral" },
  in_process: { f: "En proceso", m: "En proceso", variante: "info" },
  pending_review: { f: "En revisión", m: "En revisión", variante: "info" },
  preapproved: { f: "Preaprobada", m: "Preaprobado", variante: "info" },
  with_issues: { f: "Con problemas", m: "Con problemas", variante: "danger" },
  disapproved: { f: "Rechazada", m: "Rechazado", variante: "danger" },
  pending_billing_info: { f: "Falta el pago", m: "Falta el pago", variante: "warning" },
  archived: { f: "Archivada", m: "Archivado", variante: "neutral" },
  deleted: { f: "Eliminada", m: "Eliminado", variante: "neutral" },
  "sin-estado": { f: "Sin estado", m: "Sin estado", variante: "neutral" },
};
export const ORDEN_ESTADOS = Object.keys(ESTADOS);
export const posicionEstado = (k: string) => {
  const i = ORDEN_ESTADOS.indexOf(k);
  return i === -1 ? ORDEN_ESTADOS.length : i;
};

/** El estado de un anuncio, en palabras (un estado que Meta agregue mañana
    se muestra legible en vez de romper). */
export function estadoDeAnuncio(clave: string): { texto: string; variante: VarianteBadge } {
  const e = ESTADOS[clave];
  if (e) return { texto: e.m, variante: e.variante };
  const t = clave.replace(/_/g, " ");
  return { texto: t.charAt(0).toUpperCase() + t.slice(1), variante: "neutral" };
}
