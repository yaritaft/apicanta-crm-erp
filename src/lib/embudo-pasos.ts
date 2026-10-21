/* La conversión de cada escalón de un embudo (components/charts, Funnel). */

export interface PasoDeEmbudo {
  etiqueta: string;
  valor: number;
  /* Una segunda parte apilada en la misma barra (lo del vivo y lo de después): el paso vale valor + valor2. */
  valor2?: number;
  /* Sobre qué escalón se mide (su posición en la lista). Sin esto, sobre el anterior. */
  sobre?: number;
}

export const totalDelPaso = (p: { valor: number; valor2?: number }) => p.valor + (p.valor2 ?? 0);

/** Qué porcentaje del escalón de referencia llegó a este (0 a 100 o más); null si es el primero o la referencia está en cero. */
export function conversionDelPaso(pasos: readonly PasoDeEmbudo[], i: number): number | null {
  const base = pasos[pasos[i].sobre ?? i - 1];
  if (!base || (pasos[i].sobre === undefined && i === 0)) return null;
  const total = totalDelPaso(base);
  return total > 0 ? (totalDelPaso(pasos[i]) / total) * 100 : null;
}
