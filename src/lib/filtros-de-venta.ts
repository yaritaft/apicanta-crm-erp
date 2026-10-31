import type { Venta } from "./types";

/* Los filtros de la lista de ventas que también valen para los cobros (components/cobros/ListaCobros.tsx). «sin»: lo que no tiene ese dato. */
const SIN = "sin";
export interface FiltrosDeVenta { vendedor: string; setter: string; servicio: string; estrategia: string; proyecto: string }

/** Una venta pasa los filtros de la lista: vendedor, setter, servicio, estrategia y proyecto. */
export function pasaFiltrosDeVenta(v: Venta | undefined, f: FiltrosDeVenta): boolean {
  return (!f.vendedor || (v?.closerId || SIN) === f.vendedor)
    && (!f.setter || (v?.setterId || SIN) === f.setter)
    && (!f.servicio || (v?.productoId || SIN) === f.servicio)
    && (!f.estrategia || (v?.embudoId || SIN) === f.estrategia)
    && (!f.proyecto || (v?.proyecto?.trim() || SIN) === f.proyecto);
}
