import type { EstadoApp } from "./types";
import { moverPeriodo, nombrePeriodo, periodoDeFecha } from "./periodos";

/* ==================================================================
   «Ese mes ya está cerrado».

   Mes cerrado (Yari y Juan Cruz, 02/10): al cerrar la liquidación de un mes,
   «ya no se puede volver a tocar; a nivel contable lo cerraste». Se avisa y
   no se bloquea (D5): una devolución o un gasto que llega tarde se puede
   cargar igual, pero la liquidación cerrada no se reescribe, y lo que se
   descuenta a una persona entra en el mes que sigue.

   Quien carga gastos y devoluciones (Administración, el director) no ve las
   liquidaciones —son de los dueños—, así que un mes también se da por
   cerrado si Finanzas tiene los gastos que cargó esa liquidación al
   cerrarse: eso sí lo ve cualquiera que ve Finanzas.
   ================================================================== */

type ConLiquidaciones = Pick<EstadoApp, "liquidaciones"> & Partial<Pick<EstadoApp, "gastos">>;

/** Los meses con la liquidación cerrada ("2026-09"). */
export function mesesCerrados(e: ConLiquidaciones): Set<string> {
  const out = new Set<string>();
  for (const l of e.liquidaciones ?? []) if (l.estado === "cerrada") out.add(l.periodo);
  for (const g of e.gastos ?? []) {
    const id = g.extra?.liquidacionId;
    if (typeof id === "string" && id.startsWith("liq_")) out.add(id.slice(4));
  }
  return out;
}

export interface MesCerrado {
  /* El mes de la fecha: «2026-09» y «septiembre 2026». */
  periodo: string;
  nombre: string;
  /* El primero que sigue abierto: ahí entra lo que llega tarde. */
  siguiente: string;
  nombreSiguiente: string;
}

/** Si esa fecha cae en un mes con la liquidación cerrada, cuál es y cuál es
 *  el primero abierto que sigue; si no, null. */
export function mesCerradoDe(e: ConLiquidaciones, fechaIso: string | null | undefined): MesCerrado | null {
  const periodo = periodoDeFecha(fechaIso);
  if (!periodo) return null;
  const cerrados = mesesCerrados(e);
  if (!cerrados.has(periodo)) return null;
  let siguiente = moverPeriodo(periodo, 1);
  for (let i = 0; i < 36 && cerrados.has(siguiente); i++) siguiente = moverPeriodo(siguiente, 1);
  return { periodo, nombre: nombrePeriodo(periodo), siguiente, nombreSiguiente: nombrePeriodo(siguiente) };
}

/** El primer día del mes que sigue, a mediodía: la fecha a la que se «pasa»
 *  algo que llegó tarde. */
export function primerDiaDe(periodo: string): string {
  const [a, m] = periodo.split("-").map(Number);
  return new Date(a, m - 1, 1, 12).toISOString();
}
