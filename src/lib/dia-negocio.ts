/* ==================================================================
   El día del negocio (Argentina). Vive en lib y no en el selector de
   fechas para que lo puedan usar el servidor y las reglas sin importar un
   componente de pantalla ("use client"). DateRangePicker lo reexporta.
   ================================================================== */

export const TZ_NEGOCIO = "America/Argentina/Buenos_Aires";

/* El dia del NEGOCIO, no el de UTC.

   `creadoEn` guarda un INSTANTE. A las 22 de Argentina ya es la 01 del dia
   siguiente en UTC, asi que cortar el ISO con slice(0, 10) devolvia manana. Y
   como el rango se arma en hora argentina (TZ_NEGOCIO), todo lo cargado
   despues de las 21 quedaba afuera de "hoy": desaparecia de la lista justo
   cuando alguien lo acababa de cargar, sin ningun error ni aviso.

   Es la misma correccion que hoyEnArgentina() en el sync de Meta: el dia lo
   define el calendario del negocio, no el del servidor.

   Una fecha que ya viene SIN hora se devuelve tal cual. Pasarla por
   `new Date()` la leeria como medianoche UTC y en Argentina eso es el dia
   anterior: el arreglo correria un dia para atras todo lo que hoy anda bien. */
const fmtDiaNegocio = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ_NEGOCIO, year: "numeric", month: "2-digit", day: "2-digit",
});

export function diaDeNegocio(fecha: string | undefined | null): string {
  if (!fecha) return "";
  if (fecha.length <= 10) return fecha.slice(0, 10);
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha.slice(0, 10);
  try {
    return fmtDiaNegocio.format(d);
  } catch {
    return fecha.slice(0, 10);
  }
}

/** Un rango de días «aaaa-mm-dd» (los dos incluidos), como lo usan Finanzas en pasos y las pantallas embebidas. */
export interface RangoDeDias { desde: string; hasta: string }

/** ¿La fecha cae en el rango, mirando el día de Argentina? Sin fecha, no. */
export const enRangoDeDias = (fecha: string | undefined | null, r: RangoDeDias): boolean => {
  if (!fecha) return false;
  const d = diaDeNegocio(fecha);
  return d >= r.desde && d <= r.hasta;
};

/** El mes del negocio («2026-10») de un instante: el del calendario de Argentina, no el de la computadora de quien mira. */
export const mesDeNegocio = (ahora: number): string => diaDeNegocio(new Date(ahora).toISOString()).slice(0, 7);

/** Un día («2026-10-05») como el instante que guarda la base: el mediodía de Argentina. Un día suelto, como medianoche UTC,
    en Argentina es el día anterior apenas vuelve de la base (timestamptz): el mediodía no cambia de día en ningún huso cercano. */
export const diaAInstante = (dia: string): string => `${dia.slice(0, 10)}T15:00:00.000Z`;
