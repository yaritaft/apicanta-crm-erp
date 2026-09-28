import type { Movimiento, Pago, ProveedorPasarela } from "./types";

/* ==================================================================
   Completar un cobro que ya estaba.

   Un cobro entra una sola vez (la referencia manda), pero a veces entra
   incompleto: el aviso de Stripe llega antes de que Stripe calcule su
   comisión, y la lista de Whop no traía quién pagó ni cuánto se quedó.
   Cuando la pasarela lo vuelve a traer con más datos, se completa lo que
   faltaba. Nunca se pisa lo que ya estaba escrito ni se toca la
   conciliación. Lo usan el cron (servidor.ts) y el botón Sincronizar
   (store.ts): la misma regla en los dos lados.
   ================================================================== */

/* Las pasarelas que se quedan una comisión por cobro. Un cobro suyo con fee
   0 no salió gratis: es que la comisión todavía no se sabe. Mercury, Trust
   y Binance sí reciben sin comisión. */
export const COBRAN_COMISION: ReadonlySet<ProveedorPasarela> = new Set<ProveedorPasarela>([
  "stripe", "whop", "hotmart", "dlocal", "mercadopago",
]);

export const feeDesconocido = (m: Pick<Movimiento, "fee" | "proveedor">): boolean =>
  m.fee === 0 && COBRAN_COMISION.has(m.proveedor);

type DatosDeCobro = Pick<Movimiento,
  "proveedor" | "monto" | "fee" | "neto" | "clienteNombre" | "clienteEmail" | "clienteTelefono" | "metodo" | "descripcion">;
export type ParcheDeCobro = Partial<Pick<Movimiento,
  "fee" | "neto" | "clienteNombre" | "clienteEmail" | "clienteTelefono" | "metodo" | "descripcion">>;

const vacio = (s?: string | null): boolean => !s || !s.trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

/* Antes la billetera de un cobro en USDT se guardaba cortada: "USDT de
   TPQNPnSLA9…". Si ahora viene entera, se reemplaza. */
const esLaCortada = (guardada?: string | null, traida?: string): boolean =>
  Boolean(guardada && traida && guardada.endsWith("…")
    && traida.length >= guardada.length && traida.startsWith(guardada.slice(0, -1)));

/** Lo que le falta a un cobro guardado y trajo la pasarela. Null si no hay nada que completar. */
export function parcheDeCobro(guardado: DatosDeCobro, traido: Partial<DatosDeCobro>): ParcheDeCobro | null {
  const p: ParcheDeCobro = {};
  if (vacio(guardado.clienteNombre) && !vacio(traido.clienteNombre)) p.clienteNombre = traido.clienteNombre!.trim();
  if (vacio(guardado.clienteEmail) && !vacio(traido.clienteEmail)) p.clienteEmail = traido.clienteEmail!.trim().toLowerCase();
  if (vacio(guardado.clienteTelefono) && !vacio(traido.clienteTelefono)) p.clienteTelefono = traido.clienteTelefono!.trim();
  if (vacio(guardado.metodo) && !vacio(traido.metodo)) p.metodo = traido.metodo!.trim();
  if ((vacio(guardado.descripcion) && !vacio(traido.descripcion)) || esLaCortada(guardado.descripcion, traido.descripcion)) {
    p.descripcion = traido.descripcion!.trim();
  }
  /* La comisión real, sólo si el monto es el mismo cobro. */
  const fee = traido.fee ?? 0;
  if (feeDesconocido(guardado) && fee > 0 && Math.abs((traido.monto ?? guardado.monto) - guardado.monto) < 0.01) {
    p.fee = r2(fee);
    p.neto = r2(traido.neto ?? guardado.monto - fee);
  }
  return Object.keys(p).length > 0 ? p : null;
}

/** Cuando se sabe la comisión real de un cobro ya conciliado, sus pagos la
 *  toman (en proporción, si el cobro se repartió), salvo los que alguien
 *  corrigió a mano. */
export function feeDelPago(
  pago: Pick<Pago, "monto" | "feeManual">, mov: Pick<Movimiento, "monto">, fee: number,
): { feeMonto: number; feeRate: number } | null {
  if (pago.feeManual || mov.monto <= 0) return null;
  const feeMonto = r2(fee * (pago.monto / mov.monto));
  return { feeMonto, feeRate: pago.monto > 0 ? Math.round((feeMonto / pago.monto) * 10000) / 10000 : 0 };
}
