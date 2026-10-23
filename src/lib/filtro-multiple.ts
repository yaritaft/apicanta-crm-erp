/* ==================================================================
   Un filtro con varias opciones a la vez (Santi, 23/10: «en estado de
   llamada que se pueda elegir inasistió y reagendó, y ver las llamadas
   con esos estados»). En la URL va todo en un solo parámetro, separado
   por «|» (?estado=Inasistió|Reagendó), así los links de antes, con una
   sola opción, siguen andando y el link de lo que se ve se puede mandar.
   ================================================================== */

export const SEPARADOR_MULTIPLE = "|";

/** Lo que dice la URL, como lista: «A|B» → [A, B]; vacío → []. */
export const listaDeURL = (v: string | null | undefined): string[] =>
  (v ?? "").split(SEPARADOR_MULTIPLE).map((x) => x.trim()).filter(Boolean);

/** La lista para la URL, o null si no hay nada elegido (el parámetro se saca). */
export const aURL = (xs: readonly string[]): string | null => (xs.length ? xs.join(SEPARADOR_MULTIPLE) : null);

/** De lo que dice la URL, sólo lo que todavía existe: un estado que ya no está
    (un link viejo) se ignora en vez de dejar la lista vacía sin explicación. */
export const elegidosValidos = (v: string | null | undefined, existentes: readonly { valor: string }[]): string[] =>
  listaDeURL(v).filter((x) => existentes.some((o) => o.valor === x));

/** ¿Pasa esta llamada? Sin nada elegido pasan todas; con varias, las que tengan cualquiera. */
export const pasaFiltro = (elegidos: readonly string[], valor: string): boolean => elegidos.length === 0 || elegidos.includes(valor);

/** Lo que dice el botón: nada, la opción sola, o la primera y cuántas más. */
export function textoDelFiltro(elegidos: readonly string[], textoDe: (valor: string) => string, todos: string): string {
  if (elegidos.length === 0) return todos;
  const primera = textoDe(elegidos[0]);
  return elegidos.length === 1 ? primera : `${primera} +${elegidos.length - 1}`;
}
