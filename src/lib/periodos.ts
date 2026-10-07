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

/* Del primero a las 00:00 al último a las 23:59:59, en la hora de acá:
   el mismo borde que usa Finanzas para "Este mes". */
export function rangoDePeriodo(p: string): RangoMes {
  const [a, m] = p.split("-").map(Number);
  return { clave: p, etiqueta: nombrePeriodo(p), desde: new Date(a, m - 1, 1), hasta: new Date(a, m, 0, 23, 59, 59) };
}
