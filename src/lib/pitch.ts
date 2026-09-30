/* ==================================================================
   El pitch de venta, marcado a mano (Yari 29/09: "poder indicar
   manualmente en qué momento fue el pitch de venta, como para trackear
   eso a mano"). Se marca en el vivo con un botón, o después escribiendo
   la hora, y se corrige cuando se quiera. No depende de YouTube: con
   video, además, la curva de espectadores lo marca.
   ================================================================== */

const HORA = 3600_000;
/* Argentina no tiene horario de verano: −03:00 fijo, como en fechas.ts. */
const diaEnArgentina = (iso: string) => new Date(+new Date(iso) - 3 * HORA).toISOString().slice(0, 10);

/** La hora del pitch ("21:47", en Argentina) el día del webinar. Si queda
    muy antes del vivo, es que pasó la medianoche: un webinar de las 22
    con el pitch a las 00:30 lo tuvo al día siguiente. */
export function isoDelPitch(fechaWebinar: string, hora: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hora)) return null;
  const inicio = +new Date(fechaWebinar);
  if (Number.isNaN(inicio)) return null;
  let t = +new Date(`${diaEnArgentina(fechaWebinar)}T${hora}:00-03:00`);
  if (Number.isNaN(t)) return null;
  if (t < inicio - 3 * HORA) t += 24 * HORA;
  return new Date(t).toISOString();
}

/** En qué minuto del vivo arrancó, contando desde la hora del webinar. */
export const minutoDelPitch = (fechaWebinar: string, pitchEn: string) =>
  Math.round((+new Date(pitchEn) - +new Date(fechaWebinar)) / 60_000);

/** De las agendas del vivo (sin las canceladas ni las sacadas a mano del
    webinar), cuántas llegaron desde el pitch. */
export function agendasDesdeElPitch(
  agendas: { agendadaEn: string; momento: string; cancelada: boolean; fuera: boolean }[],
  pitchEn: string,
): { desde: number; delVivo: number } {
  const p = +new Date(pitchEn);
  const vivo = agendas.filter((a) => a.momento === "vivo" && !a.cancelada && !a.fuera);
  return { desde: vivo.filter((a) => +new Date(a.agendadaEn) >= p).length, delVivo: vivo.length };
}
