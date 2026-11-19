/* Cuántas llamadas coinciden con la búsqueda y los filtros de la Agenda pero caen fuera del período elegido.

   Manuel (19/11): «cuando pongo el webinar del 11/11 me aparecen nada más 5 llamadas de webinar, 1 de clase 0 y
   1 de Q&A». Los datos estaban bien: ese lanzamiento tiene 131 agendas y 126 ya pasaron, y el período por
   defecto de la Agenda es «Todo lo próximo». Los números de cada desplegable cuentan sólo lo que deja ver el
   período (el número dice cuántas vas a ver si lo elegís), pero nada avisaba que el resto existía. Con esto la
   Agenda dice cuántas quedan afuera y ofrece verlas con un clic.

   Una llamada sin día no cuenta: ningún período la va a mostrar nunca, así que avisar de ella sería ruido. */
export function fueraDelPeriodo<T extends { id: string }>(
  todas: readonly T[],
  enPeriodo: readonly T[],
  tieneDia: (s: T) => boolean,
  coincide: (s: T) => boolean,
): number {
  const dentro = new Set(enPeriodo.map((s) => s.id));
  let n = 0;
  for (const s of todas) if (!dentro.has(s.id) && tieneDia(s) && coincide(s)) n++;
  return n;
}
