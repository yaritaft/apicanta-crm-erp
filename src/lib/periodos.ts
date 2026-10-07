import type { RangoMes } from "./metricas";

/* ==================================================================
   Períodos: un mes, "2026-09".

   Lo usan la liquidación (honorarios.ts), las devoluciones y el aviso de
   «ese mes ya está cerrado». Viven acá, sin nada más adentro, para que
   cualquiera los importe sin arrastrar el motor de la liquidación.
   ================================================================== */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const esPeriodo = (p: string | null | undefined): p is string => Boolean(p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p));

export function periodoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** El mes de un instante, en la hora de acá (la misma con la que Finanzas
 *  corta los meses). Vacío si la fecha no se entiende. */
export function periodoDeFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : periodoDe(d);
}

export function moverPeriodo(p: string, n: number): string {
  const [a, m] = p.split("-").map(Number);
  return periodoDe(new Date(a, m - 1 + n, 1));
}

export function nombrePeriodo(p: string): string {
  const [a, m] = p.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** El último instante del día de `d`, en la hora de acá (23:59:59,999): el
 *  borde derecho de todos los rangos de la app, que se comparan con `<=`.
 *
 *  Tiene que ser el último MILISEGUNDO y no el último segundo. Con 23:59:59,000
 *  un cobro, una devolución o un gasto fechado a las 23:59:59,500 (lo que se
 *  carga en la pantalla se fecha con `new Date().toISOString()`, con
 *  milisegundos) quedaba afuera de todos los meses y de todos los días, sin
 *  error ni aviso. Un `Date` no tiene nada entre ese instante y las 00:00 del
 *  día siguiente: cada instante cae en un solo día. */
export function finDelDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/* Del primero a las 00:00:00,000 al último a las 23:59:59,999, en la hora de
   acá: el mismo borde que usa Finanzas para "Este mes". Un mes empieza justo
   un milisegundo después de que termina el anterior: ningún instante queda
   afuera ni en dos meses. */
export function rangoDePeriodo(p: string): RangoMes {
  const [a, m] = p.split("-").map(Number);
  return { clave: p, etiqueta: nombrePeriodo(p), desde: new Date(a, m - 1, 1), hasta: finDelDia(new Date(a, m, 0)) };
}
