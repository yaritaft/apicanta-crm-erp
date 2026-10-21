/* El ancho que cada uno le da a las columnas de una planilla (components/webinars/Planilla). Es una preferencia de quien mira, como qué columnas ve:
   se guarda en su navegador. */

export const ANCHO_MIN = 56;
export const ANCHO_MAX = 640;

/** El ancho dentro de lo razonable: ni una columna que desaparece ni una que se come la pantalla. */
export const anchoValido = (px: number) => Math.min(ANCHO_MAX, Math.max(ANCHO_MIN, Math.round(px)));

/** Lo que dice lo guardado (JSON de {columna: px}), sin creerle: lo que no es número o viene de una versión vieja se descarta. */
export function leerAnchos(guardado: string | null | undefined): Record<string, number> {
  if (!guardado) return {};
  let crudo: unknown;
  try { crudo = JSON.parse(guardado); } catch { return {}; }
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) return {};
  const salida: Record<string, number> = {};
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) salida[k] = anchoValido(v);
  }
  return salida;
}

export const claveDeAnchos = (planilla: string) => `apicanta:anchos:${planilla}`;
