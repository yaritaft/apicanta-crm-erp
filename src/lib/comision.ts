import type { MiembroEquipo } from "./types";

/* ==================================================================
   Las reglas chicas de cuándo y cuánto comisiona alguien, sin más
   dependencias: las usan Finanzas, la liquidación, el resultado de cada
   webinar y las devoluciones. Viven acá (y Finanzas las reexporta) para
   que las devoluciones las usen sin importar a Finanzas, que las
   importa a ellas.
   ================================================================== */

/* Quien se fue cobra sólo lo que entró mientras estaba (hasta su fecha de
   salida, si la tiene): las cuotas que entran después no le dejan nada.
   Vale para el director y para los closers (MiembroEquipo.hasta); por eso
   a los closers que se van se les pasan las cuotas a otro. */
export const cobraEnFecha = (m: { hasta?: string } | undefined, fechaPago: string) =>
  !m?.hasta || new Date(fechaPago).getTime() - 3 * 3600000 < new Date(`${m.hasta}T00:00:00Z`).getTime() + 86400000;
export const cobraDirector = cobraEnFecha;

/** El % con el que alguien comisiona una venta: el de ese servicio, si lo
 *  tiene cargado aparte, o el general. Lo usan Finanzas, la caja y la
 *  planilla; la liquidación llega a lo mismo desde lo que cobra la persona
 *  (lib/honorarios.ts). */
export const tasaDeComision = (m: Pick<MiembroEquipo, "comisionRate" | "comisionServicios"> | undefined, productoId?: string): number =>
  !m ? 0 : (productoId !== undefined ? m.comisionServicios?.[productoId] : undefined) ?? m.comisionRate ?? 0;

/** Quién comisiona los cobros de una cuota: el que la heredó o, si nadie,
 *  el closer de la venta. */
export const closerDeCuota = (v: { closerId?: string }, c?: { closerId?: string }) => c?.closerId || v.closerId;
