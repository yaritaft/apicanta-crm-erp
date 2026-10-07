import type { EstadoApp, ID, Pago } from "./types";
import type { RangoMes } from "./metricas";
import { pagosDelMes } from "./finanzas";

/* ==================================================================
   Ingresos de la semana, por cuenta y por servicio.

   Angelo (02/10): para supervisar cada semana («no espero que pase todo el
   mes para conciliar, porque después es un kilón») quiere los ingresos
   semanales por cuenta y por producto: dentro de Stripe entraron varios
   productos, y con sólo la cuenta no se ve cuál.

   Es el Cash Collected (lib/finanzas: cashCollected) partido en una tabla:
   cada cobro del período está en una sola celda —la de su cuenta (el medio
   de pago) y su servicio (el de su venta)—, así las filas, las columnas y el
   total cierran exacto con el Cash Collected del mismo rango. Se suma en
   centavos enteros: sin restos de punto flotante, el total es la suma de las
   celdas y las celdas son las de la lista que las abre.
   ================================================================== */

export const SIN_CUENTA = "sin-cuenta";
export const SIN_SERVICIO = "sin-servicio";

export interface CeldaIngreso {
  /** Lo cobrado, en centavos enteros. */
  centavos: number;
  /** Lo mismo en dólares (centavos / 100). */
  monto: number;
  cobros: number;
}

export interface FilaIngreso {
  /** El id de la cuenta recaudadora, o SIN_CUENTA. */
  id: string;
  nombre: string;
  /** Por el id del servicio, o SIN_SERVICIO. Sólo los que tienen cobros. */
  porServicio: Record<string, CeldaIngreso>;
  total: CeldaIngreso;
}

export interface ColumnaIngreso {
  /** El id del servicio, o SIN_SERVICIO. */
  id: string;
  nombre: string;
  total: CeldaIngreso;
}

export interface IngresosPorCuentaYServicio {
  /** Las cuentas con cobros, de la que más entró a la que menos («sin cuenta» al final). */
  cuentas: FilaIngreso[];
  /** Los servicios con cobros, del que más entró al que menos («sin servicio» al final). */
  servicios: ColumnaIngreso[];
  total: CeldaIngreso;
  /** Los cobros del período: la misma lista que suma el Cash Collected. */
  pagos: Pago[];
}

const vacia = (): CeldaIngreso => ({ centavos: 0, monto: 0, cobros: 0 });
const sumar = (c: CeldaIngreso, centavos: number) => {
  c.centavos += centavos;
  c.monto = c.centavos / 100;
  c.cobros += 1;
};

const porMonto = <T extends { id: string; nombre: string; total: CeldaIngreso }>(sinId: string) => (a: T, b: T) =>
  (a.id === sinId ? 1 : b.id === sinId ? -1 : 0) || b.total.centavos - a.total.centavos || a.nombre.localeCompare(b.nombre, "es");

/** La cuenta (medio de pago) y el servicio de un cobro, con sus nombres. */
export function cuentaYServicioDe(
  e: Pick<EstadoApp, "procesadores" | "productos" | "cuotas" | "ventas">, p: Pago,
  indice?: { cuotas: Map<ID, ID>; ventas: Map<ID, ID | undefined> },
): { cuentaId: string; cuenta: string; servicioId: string; servicio: string } {
  const ventaId = indice ? indice.cuotas.get(p.cuotaId) : e.cuotas.find((c) => c.id === p.cuotaId)?.ventaId;
  const productoId = ventaId ? (indice ? indice.ventas.get(ventaId) : e.ventas.find((v) => v.id === ventaId)?.productoId) : undefined;
  const proc = p.procesadorId ? e.procesadores.find((x) => x.id === p.procesadorId) : undefined;
  const prod = productoId ? e.productos.find((x) => x.id === productoId) : undefined;
  return {
    cuentaId: p.procesadorId ?? SIN_CUENTA,
    cuenta: proc?.nombre ?? (p.procesadorId ? "Cuenta borrada" : "Sin cuenta"),
    servicioId: productoId ?? SIN_SERVICIO,
    servicio: prod?.nombre ?? (productoId ? "Servicio borrado" : "Sin servicio"),
  };
}

/** Los cobros del rango partidos por cuenta y por servicio. */
export function ingresosPorCuentaYServicio(e: EstadoApp, m: RangoMes): IngresosPorCuentaYServicio {
  const pagos = pagosDelMes(e, m);
  const indice = {
    cuotas: new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const)),
    ventas: new Map(e.ventas.map((v) => [v.id, v.productoId] as const)),
  };
  const cuentas = new Map<string, FilaIngreso>();
  const servicios = new Map<string, ColumnaIngreso>();
  const total = vacia();

  for (const p of pagos) {
    const centavos = Math.round(p.monto * 100);
    const k = cuentaYServicioDe(e, p, indice);
    let fila = cuentas.get(k.cuentaId);
    if (!fila) { fila = { id: k.cuentaId, nombre: k.cuenta, porServicio: {}, total: vacia() }; cuentas.set(k.cuentaId, fila); }
    let col = servicios.get(k.servicioId);
    if (!col) { col = { id: k.servicioId, nombre: k.servicio, total: vacia() }; servicios.set(k.servicioId, col); }
    const celda = (fila.porServicio[k.servicioId] ??= vacia());
    sumar(celda, centavos); sumar(fila.total, centavos); sumar(col.total, centavos); sumar(total, centavos);
  }

  return {
    cuentas: [...cuentas.values()].sort(porMonto<FilaIngreso>(SIN_CUENTA)),
    servicios: [...servicios.values()].sort(porMonto<ColumnaIngreso>(SIN_SERVICIO)),
    total, pagos,
  };
}

/** Los cobros de una celda (o de una fila, o de una columna, o de todo si no se dice
 *  ninguna): los que se suman para llegar a ese número. */
export function cobrosDeCelda(
  e: Pick<EstadoApp, "procesadores" | "productos" | "cuotas" | "ventas">, r: IngresosPorCuentaYServicio,
  cuentaId?: string, servicioId?: string,
): Pago[] {
  const indice = {
    cuotas: new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const)),
    ventas: new Map(e.ventas.map((v) => [v.id, v.productoId] as const)),
  };
  return r.pagos.filter((p) => {
    const k = cuentaYServicioDe(e, p, indice);
    return (cuentaId === undefined || k.cuentaId === cuentaId) && (servicioId === undefined || k.servicioId === servicioId);
  });
}

/* ---------- La semana ---------- */

const aDia = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const deDia = (s: string) => { const [a, m, d] = s.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)); };

/** El día corrido `n` días (negativo: para atrás). Días calendario, "aaaa-mm-dd". */
export function moverDias(dia: string, n: number): string {
  const d = deDia(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return aDia(d);
}

/** El lunes de la semana de ese día. */
export function lunesDe(dia: string): string {
  const d = deDia(dia);
  return moverDias(dia, -((d.getUTCDay() + 6) % 7));
}

/** La semana de lunes a domingo que tiene ese día. */
export function semanaDe(dia: string): { desde: string; hasta: string } {
  const desde = lunesDe(dia);
  return { desde, hasta: moverDias(desde, 6) };
}

/** Cuántos días tiene el rango, los dos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  return Math.round((deDia(hasta).getTime() - deDia(desde).getTime()) / 86400000) + 1;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «5 al 11 oct», «28 sep al 4 oct» (con el año si cruza de año o no es el actual). */
export function etiquetaDeRango(desde: string, hasta: string, hoy?: string): string {
  const [ay, am, ad] = desde.split("-").map(Number);
  const [by, bm, bd] = hasta.split("-").map(Number);
  const anioActual = Number((hoy ?? "").slice(0, 4)) || by;
  const conAnio = ay !== by || by !== anioActual;
  const b = `${bd} ${MESES[bm - 1]}${conAnio ? ` ${by}` : ""}`;
  if (desde === hasta) return b;
  /* Del mismo mes: «5 al 11 oct». */
  if (ay === by && am === bm) return `${ad} al ${b}`;
  const a = `${ad} ${MESES[am - 1]}${conAnio ? ` ${ay}` : ""}`;
  return `${a} al ${b}`;
}
