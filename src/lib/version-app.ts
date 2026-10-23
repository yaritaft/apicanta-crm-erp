/* ==================================================================
   El cartel de «hay una versión nueva, actualizá» (Juan Cruz, 23/10:
   «que salga un cartelito para actualizar la app sí o sí»). Se dispara
   cuando se publica una versión nueva o cuando un dueño pide que todos
   actualicen (después de cambiar algo de Ajustes que el equipo tiene que
   ver ya). Lo de acá no depende de React, para las pruebas.
   ================================================================== */

export interface VersionPublicada {
  /* La de este deploy (next.config: VERSION_APP). */
  version: string;
  /* El último «Pedir a todos que actualicen» (ajustes.recargaPedida). */
  recarga: string | null;
}

/** ¿Esta pestaña tiene que actualizar? Se publicó otra versión, o se pidió actualizar después de que la abrió. */
export function hayQueActualizar(base: VersionPublicada, actual: VersionPublicada): boolean {
  if (base.version && actual.version && base.version !== actual.version) return true;
  return Boolean(actual.recarga) && actual.recarga !== base.recarga;
}

/* Cada cuánto se pregunta (y siempre al volver a la pestaña). */
export const CADA_CUANTO_MS = 90_000;
/* El margen para guardar lo que se está cargando: después, la app queda tapada hasta actualizar. */
export const ESPERA_PARA_BLOQUEAR_MS = 2 * 60_000;

/** «1:05»: lo que falta para que se bloquee. */
export function cuentaRegresiva(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
