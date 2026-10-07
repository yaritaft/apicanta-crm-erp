import type { CuotaVencida } from "./finanzas";
import { cuotaPasa, opcionesSobre, type FiltroPersonas, type OpcionFiltro } from "./buscar-cliente";

/* ==================================================================
   Finanzas → Cobros: las cuotas vencidas, por producto y por closer.

   Angelo (02/10): «el total de deuda de arriba, ¿se filtra por producto?» y
   «por closer, generalmente». El aviso de arriba y los chips de días de
   atraso siguen lo que se ve: las mismas cuotas que la tabla. Usa la misma
   regla de closer y servicio que «Cargar el pago de una cuota» y Clientes
   (lib/buscar-cliente.ts).
   ================================================================== */

export interface FiltroMora extends FiltroPersonas {
  /** Sólo las que llevan al menos estos días de atraso (7, 10, 12, 15 o 20). */
  atraso?: number;
}

/** Las cuotas vencidas que cumplen el atraso, el servicio y el closer elegidos
 *  (los dos últimos sobre la misma cuota). Sin filtro, todas. */
export function filtrarVencidas(vencidas: readonly CuotaVencida[], f: FiltroMora = {}): CuotaVencida[] {
  return vencidas.filter((v) => (!f.atraso || v.diasAtraso >= f.atraso) && cuotaPasa(v, f));
}

export interface TotalDeMora {
  cuotas: number;
  /** Cuántos clientes (ventas) deben alguna: el que debe dos cuotas es uno solo. */
  clientes: number;
  /** Lo que falta cobrar, en centavos enteros: sumar las cuotas de la tabla da exactamente esto. */
  saldo: number;
}

export function totalDeMora(vencidas: readonly CuotaVencida[]): TotalDeMora {
  let centavos = 0;
  const ventas = new Set<string>();
  for (const v of vencidas) { centavos += Math.round(v.saldo * 100); ventas.add(v.ventaId); }
  return { cuotas: vencidas.length, clientes: ventas.size, saldo: centavos / 100 };
}

/** Los desplegables: los closers y los servicios que tienen cuotas vencidas, cada uno con
 *  cuántas quedan si se lo elige, con el atraso y el otro filtro ya puestos. */
export function opcionesDeMora(
  vencidas: readonly CuotaVencida[],
  nombres: { servicio: (id?: string) => string | undefined; closer: (id?: string) => string | undefined },
  f: FiltroMora = {},
): { closers: OpcionFiltro[]; servicios: OpcionFiltro[] } {
  const base = vencidas.filter((v) => !f.atraso || v.diasAtraso >= f.atraso);
  return opcionesSobre(
    base.map((v) => ({ cuotas: [{ closerId: v.closerId, closer: nombres.closer(v.closerId), productoId: v.productoId, producto: nombres.servicio(v.productoId) }] })),
    f,
  );
}
