/* Qué hacer con ?nuevo=1 y ?ver=<id> cada vez que cambia la URL.

   Son de un solo uso: se abre lo pedido y la página los saca de la URL. Pero
   la pantalla sigue montada, así que el próximo link (otra búsqueda con ⌘K
   desde la misma Agenda, por ejemplo) tiene que abrir de nuevo. Por eso el
   «ya lo usé» se libera cuando la URL queda sin ninguno de los dos. */
export interface AperturaURL { nuevo: boolean; ver: string | null }

export function leerApertura(params: { get(k: string): string | null }, consumido: boolean):
  { abrir: AperturaURL | null; consumido: boolean } {
  const nuevo = params.get("nuevo") === "1";
  const ver = params.get("ver");
  if (!nuevo && !ver) return { abrir: null, consumido: false };
  if (consumido) return { abrir: null, consumido: true };
  return { abrir: { nuevo, ver }, consumido: true };
}
