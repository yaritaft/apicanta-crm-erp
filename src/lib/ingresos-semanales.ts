import type { Devolucion, EstadoApp, ID, Pago } from "./types";
import type { RangoMes } from "./metricas";
import { devolucionesDelMes, pagosDelMes } from "./finanzas";

/* ==================================================================
   Ingresos de la semana, por cuenta y por servicio.

   Angelo (02/10): para supervisar cada semana («no espero que pase todo el
   mes para conciliar, porque después es un kilón») quiere los ingresos
   semanales por cuenta y por producto: dentro de Stripe entraron varios
   productos, y con sólo la cuenta no se ve cuál.

   Es el Cash Collected (lib/finanzas: cashCollected) partido en una tabla:
   cada cobro del período está en una sola celda —la de su cuenta (el medio
   de pago) y su servicio (el de su venta)—, y lo devuelto en el período
   (sólo las devoluciones confirmadas, por el día en que se devolvió la plata)
   va en una fila aparte, «Devoluciones», en negativo y en la columna del
   servicio de la venta devuelta. El Cash Collected es lo cobrado menos lo
   devuelto (lib/devoluciones.ts): sin esa fila el total sería el bruto y no
   cerraría con el Dashboard ni con el estado de resultados. Así las filas, las
   columnas y el total cierran exacto con el Cash Collected del mismo rango.
   Se suma en centavos enteros: sin restos de punto flotante, el total es la
   suma de las celdas y las celdas son las de las listas que las abren (los
   cobros y, en la fila de devoluciones, las devoluciones).
   ================================================================== */

export const SIN_CUENTA = "sin-cuenta";
export const SIN_SERVICIO = "sin-servicio";
/** El id de la fila de lo devuelto: no es una cuenta, es lo que se resta de lo cobrado
 *  para llegar al Cash Collected. Va siempre al final. */
export const DEVOLUCIONES = "devoluciones";

export interface CeldaIngreso {
  /** Lo cobrado, en centavos enteros. Lo devuelto va restando: en la fila de devoluciones es
   *  negativo y en un total (de columna o general) es lo cobrado menos lo devuelto. */
  centavos: number;
  /** Lo mismo en dólares (centavos / 100). */
  monto: number;
  /** Cuántos cobros suma. */
  cobros: number;
  /** Cuántas devoluciones resta. */
  devoluciones: number;
}

export interface FilaIngreso {
  /** El id de la cuenta recaudadora, SIN_CUENTA o DEVOLUCIONES (la fila de lo devuelto). */
  id: string;
  nombre: string;
  /** Por el id del servicio, o SIN_SERVICIO. Sólo los que tienen cobros (o devoluciones). */
  porServicio: Record<string, CeldaIngreso>;
  total: CeldaIngreso;
}

export interface ColumnaIngreso {
  /** El id del servicio, o SIN_SERVICIO. */
  id: string;
  nombre: string;
  /** Lo cobrado de este servicio menos lo que se le devolvió: lo que aporta al Cash Collected. */
  total: CeldaIngreso;
  /** Sólo lo cobrado, antes de restar lo devuelto. */
  cobrado: CeldaIngreso;
}

export interface IngresosPorCuentaYServicio {
  /** Las cuentas con cobros, de la que más entró a la que menos («sin cuenta» al final) y, si hubo
   *  devoluciones en el rango, la fila «Devoluciones» después de todas (en negativo). */
  cuentas: FilaIngreso[];
  /** Los servicios con cobros o devoluciones, del que más se cobró al que menos («sin servicio» al final). */
  servicios: ColumnaIngreso[];
  /** El Cash Collected del rango: lo cobrado menos lo devuelto, igual que cashCollected(e, rango). */
  total: CeldaIngreso;
  /** Sólo lo cobrado. */
  cobrado: CeldaIngreso;
  /** Sólo lo devuelto, en negativo. */
  devuelto: CeldaIngreso;
  /** Los cobros del período: los que suma el Cash Collected. */
  pagos: Pago[];
  /** Las devoluciones confirmadas del período: las que resta el Cash Collected. */
  devoluciones: Devolucion[];
}

const vacia = (): CeldaIngreso => ({ centavos: 0, monto: 0, cobros: 0, devoluciones: 0 });
const sumar = (c: CeldaIngreso, centavos: number) => {
  c.centavos += centavos;
  c.monto = c.centavos / 100;
  c.cobros += 1;
};
const restar = (c: CeldaIngreso, centavos: number) => {
  c.centavos -= centavos;
  c.monto = c.centavos / 100;
  c.devoluciones += 1;
};

const porMonto = <T extends { id: string; nombre: string }>(sinId: string, monto: (x: T) => number) => (a: T, b: T) =>
  (a.id === sinId ? 1 : b.id === sinId ? -1 : 0) || monto(b) - monto(a) || a.nombre.localeCompare(b.nombre, "es");

/** El servicio de una venta (por el id de su producto) con su nombre. */
function servicioDe(e: Pick<EstadoApp, "productos">, productoId: ID | undefined): { servicioId: string; servicio: string } {
  const prod = productoId ? e.productos.find((x) => x.id === productoId) : undefined;
  return {
    servicioId: productoId ?? SIN_SERVICIO,
    servicio: prod?.nombre ?? (productoId ? "Servicio borrado" : "Sin servicio"),
  };
}

/** La cuenta (medio de pago) y el servicio de un cobro, con sus nombres. */
export function cuentaYServicioDe(
  e: Pick<EstadoApp, "procesadores" | "productos" | "cuotas" | "ventas">, p: Pago,
  indice?: { cuotas: Map<ID, ID>; ventas: Map<ID, ID | undefined> },
): { cuentaId: string; cuenta: string; servicioId: string; servicio: string } {
  const ventaId = indice ? indice.cuotas.get(p.cuotaId) : e.cuotas.find((c) => c.id === p.cuotaId)?.ventaId;
  const productoId = ventaId ? (indice ? indice.ventas.get(ventaId) : e.ventas.find((v) => v.id === ventaId)?.productoId) : undefined;
  const proc = p.procesadorId ? e.procesadores.find((x) => x.id === p.procesadorId) : undefined;
  return {
    cuentaId: p.procesadorId ?? SIN_CUENTA,
    cuenta: proc?.nombre ?? (p.procesadorId ? "Cuenta borrada" : "Sin cuenta"),
    ...servicioDe(e, productoId),
  };
}

/** El producto de la venta de una devolución (sin venta, ninguno). */
const productoDeDevolucion = (e: Pick<EstadoApp, "ventas">, d: Devolucion, ventas?: Map<ID, ID | undefined>): ID | undefined =>
  d.ventaId ? (ventas ? ventas.get(d.ventaId) : e.ventas.find((v) => v.id === d.ventaId)?.productoId) : undefined;

/** Los cobros del rango partidos por cuenta y por servicio, y lo devuelto en el rango en su
 *  propia fila: el total es el Cash Collected (cobrado − devuelto). */
export function ingresosPorCuentaYServicio(e: EstadoApp, m: RangoMes): IngresosPorCuentaYServicio {
  const pagos = pagosDelMes(e, m);
  /* Las mismas devoluciones que resta cashCollected (lib/devoluciones.ts): confirmadas, por su fecha. */
  const devoluciones = devolucionesDelMes(e, m);
  const indice = {
    cuotas: new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const)),
    ventas: new Map(e.ventas.map((v) => [v.id, v.productoId] as const)),
  };
  const cuentas = new Map<string, FilaIngreso>();
  const servicios = new Map<string, ColumnaIngreso>();
  const total = vacia(), cobrado = vacia(), devuelto = vacia();
  const columna = (id: string, nombre: string) => {
    let col = servicios.get(id);
    if (!col) { col = { id, nombre, total: vacia(), cobrado: vacia() }; servicios.set(id, col); }
    return col;
  };

  for (const p of pagos) {
    const centavos = Math.round(p.monto * 100);
    const k = cuentaYServicioDe(e, p, indice);
    let fila = cuentas.get(k.cuentaId);
    if (!fila) { fila = { id: k.cuentaId, nombre: k.cuenta, porServicio: {}, total: vacia() }; cuentas.set(k.cuentaId, fila); }
    const col = columna(k.servicioId, k.servicio);
    const celda = (fila.porServicio[k.servicioId] ??= vacia());
    sumar(celda, centavos); sumar(fila.total, centavos);
    sumar(col.total, centavos); sumar(col.cobrado, centavos);
    sumar(cobrado, centavos); sumar(total, centavos);
  }

  /* Cada devolución resta en la columna del servicio de su venta, en una sola fila: la plata sale
     por la cuenta que elija quien la devuelve, y no tiene por qué ser la que cobró. */
  let filaDevoluciones: FilaIngreso | undefined;
  for (const d of devoluciones) {
    const centavos = Math.round(d.monto * 100);
    const k = servicioDe(e, productoDeDevolucion(e, d, indice.ventas));
    filaDevoluciones ??= { id: DEVOLUCIONES, nombre: "Devoluciones", porServicio: {}, total: vacia() };
    const col = columna(k.servicioId, k.servicio);
    const celda = (filaDevoluciones.porServicio[k.servicioId] ??= vacia());
    restar(celda, centavos); restar(filaDevoluciones.total, centavos);
    restar(col.total, centavos);
    restar(devuelto, centavos); restar(total, centavos);
  }

  const filas = [...cuentas.values()].sort(porMonto<FilaIngreso>(SIN_CUENTA, (f) => f.total.centavos));
  if (filaDevoluciones) filas.push(filaDevoluciones);
  return {
    cuentas: filas,
    servicios: [...servicios.values()].sort(porMonto<ColumnaIngreso>(SIN_SERVICIO, (c) => c.cobrado.centavos)),
    total, cobrado, devuelto, pagos, devoluciones,
  };
}

/** Los cobros de una celda (o de una fila, o de una columna, o de todo si no se dice
 *  ninguna): los que se suman para llegar a ese número. La fila de devoluciones no tiene cobros. */
export function cobrosDeCelda(
  e: Pick<EstadoApp, "procesadores" | "productos" | "cuotas" | "ventas">, r: IngresosPorCuentaYServicio,
  cuentaId?: string, servicioId?: string,
): Pago[] {
  if (cuentaId === DEVOLUCIONES) return [];
  const indice = {
    cuotas: new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const)),
    ventas: new Map(e.ventas.map((v) => [v.id, v.productoId] as const)),
  };
  return r.pagos.filter((p) => {
    const k = cuentaYServicioDe(e, p, indice);
    return (cuentaId === undefined || k.cuentaId === cuentaId) && (servicioId === undefined || k.servicioId === servicioId);
  });
}

/** Las devoluciones de una celda (o de la fila de devoluciones, o de una columna, o todas si no
 *  se dice ninguna): las que se restan para llegar a ese número. Las cuentas no tienen devoluciones:
 *  lo devuelto vive en su propia fila. */
export function devolucionesDeCelda(
  e: Pick<EstadoApp, "ventas">, r: IngresosPorCuentaYServicio, cuentaId?: string, servicioId?: string,
): Devolucion[] {
  if (cuentaId !== undefined && cuentaId !== DEVOLUCIONES) return [];
  if (servicioId === undefined) return r.devoluciones;
  const ventas = new Map(e.ventas.map((v) => [v.id, v.productoId] as const));
  return r.devoluciones.filter((d) => (productoDeDevolucion(e, d, ventas) ?? SIN_SERVICIO) === servicioId);
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
