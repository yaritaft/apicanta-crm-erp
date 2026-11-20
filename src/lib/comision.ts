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

/** El día (YYYY-MM-DD) de una fecha, en la hora de acá: un cobro de las 22 h del 31/10 en Argentina es del 31/10, no del 1/11. Una
 *  fecha sin hora ya es el día. */
export const diaArgentina = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);

type ConTasas = Pick<MiembroEquipo, "comisionRate" | "comisionServicios"> & Partial<Pick<MiembroEquipo, "comisionHistorial">>;

/** El % con el que alguien comisiona una venta: el de ese servicio, si lo
 *  tiene cargado aparte, o el general. Lo usan Finanzas, la caja y la
 *  planilla; la liquidación llega a lo mismo desde lo que cobra la persona
 *  (lib/honorarios.ts).
 *  Con `dia` (el del cobro), el % que valía ESE día (`comisionHistorial`): si la regla cambió el 1/12, un cobro de noviembre sigue
 *  con el % de noviembre. Sin `dia` (o sin historia), el de hoy. */
export const tasaDeComision = (m: ConTasas | undefined, productoId?: string, dia?: string): number => {
  if (!m) return 0;
  if (dia && m.comisionHistorial?.length) {
    const d = dia.slice(0, 10);
    const t = m.comisionHistorial.find((x) => (!x.desde || x.desde <= d) && (!x.hasta || x.hasta >= d));
    if (t) return (productoId !== undefined ? t.servicios?.[productoId] : undefined) ?? t.general ?? 0;
  }
  return (productoId !== undefined ? m.comisionServicios?.[productoId] : undefined) ?? m.comisionRate ?? 0;
};

/** El % de un grupo de cobros, cada uno con el de su día: lo que da sumar neto × % de cada uno, dividido por el neto. Si todos los
 *  cobros son del mismo %, ése. Sin cobros, el de hoy. */
export function tasaPonderada(m: ConTasas | undefined, productoId: string | undefined, cobros: { fecha: string; monto: number; feeMonto: number }[]): number {
  if (!m || cobros.length === 0) return tasaDeComision(m, productoId);
  const tasas = cobros.map((p) => tasaDeComision(m, productoId, diaArgentina(p.fecha)));
  if (tasas.every((t) => Math.abs(t - tasas[0]) < 1e-12)) return tasas[0];
  let neto = 0, comision = 0;
  cobros.forEach((p, i) => { const n = p.monto - p.feeMonto; neto += n; comision += n * tasas[i]; });
  return Math.abs(neto) > 1e-9 ? comision / neto : tasas[tasas.length - 1];
}

/** El % del setter en una venta: el de esa venta, si quien liquida lo fijó aparte (0 = no comisiona), o el que valía el día de la venta
 *  para esa persona. */
export const tasaDeSetterEnVenta = (
  setter: ConTasas | undefined,
  venta: { productoId?: string; comisionSetter?: number | null; fecha?: string },
): number => {
  const propio = venta.comisionSetter;
  return typeof propio === "number" && Number.isFinite(propio) && propio >= 0
    ? propio : tasaDeComision(setter, venta.productoId, venta.fecha ? diaArgentina(venta.fecha) : undefined);
};

/** Quién comisiona los cobros de una cuota: el que la heredó o, si nadie,
 *  el closer de la venta. */
export const closerDeCuota = (v: { closerId?: string }, c?: { closerId?: string }) => c?.closerId || v.closerId;
