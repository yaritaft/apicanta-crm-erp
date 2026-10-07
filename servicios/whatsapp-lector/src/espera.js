/** Cuánto esperar antes de volver a intentar, cada vez más: 2 s, 4 s, 8 s… hasta
    un tope (5 minutos). `intento` arranca en 1. Con un poco de azar para que
    varios no reintenten a la vez; `azar() === 0.5` lo deja justo. */
export function esperaCreciente(intento, { baseMs = 2000, topeMs = 300_000, factor = 2, azar = Math.random } = {}) {
  const n = Math.max(1, Math.trunc(Number(intento) || 1));
  const crudo = Math.min(topeMs, baseMs * factor ** (n - 1));
  const variacion = 0.8 + 0.4 * azar();
  return Math.round(Math.min(topeMs, crudo * variacion));
}

export const dormir = (ms) => new Promise((listo) => setTimeout(listo, ms));
