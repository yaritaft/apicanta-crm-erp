/* ==================================================================
   Cuando una pantalla no se puede abrir.

   Lo más común: se publicó una versión nueva mientras alguien tenía la app
   abierta, y al entrar a una pantalla el navegador pide un archivo de la
   versión vieja que ya no está («ChunkLoadError»). Recargar lo arregla. Esas
   se recargan solas, una vez por minuto como mucho (si no, una pantalla
   realmente rota quedaría recargándose para siempre). Cualquier otra falla
   muestra el detalle y deja reintentar.
   ================================================================== */

export const CLAVE_RECARGA = "apicanta:recarga-por-error-de-carga";

const ERROR_DE_CARGA = /ChunkLoadError|Loading chunk .+? failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** ¿El error es de un archivo de la app que no se pudo traer (una versión vieja abierta)? */
export const esErrorDeCarga = (error: { name?: string; message?: string } | null | undefined): boolean =>
  ERROR_DE_CARGA.test(`${error?.name ?? ""} ${error?.message ?? ""}`);

/** ¿Ya se recargó sola hace poco? Entonces no se vuelve a hacer: seguiría fallando. */
export function puedeRecargarSola(guardado: string | null | undefined, ahora: number, ventanaMs = 60_000): boolean {
  const antes = Number(guardado);
  return !(Number.isFinite(antes) && antes > 0 && ahora - antes < ventanaMs);
}
