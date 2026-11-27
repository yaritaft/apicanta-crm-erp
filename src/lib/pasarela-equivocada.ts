import type { ID, Movimiento, Procesador } from "./types";
import { quienPagoVsCliente } from "./conciliacion";

/* ==================================================================
   «¿Seguro que fue por Stripe?» (Aldana, 27/11).

   Los closers cargaban en Stripe lo que había entrado por Whop: el cobro
   arrancaba con la cuenta más usada ya elegida y nadie la cambiaba. Mariano
   cargó el pago de US$ 2.500 de Juan Marcelo Arpi como Stripe; en Stripe ese
   pago no existía, y en Whop sí («MARCELO ARPI», 26/11). El arqueo de la caja
   le dio a Aldana US$ 2.427 de más en Stripe.

   Las pasarelas con pagos automáticos (Stripe, Whop, dLocal…) dicen qué les
   entró. Si el cobro dice una pasarela, no está atado a un pago suyo, en esa
   pasarela no hay ningún pago de esta persona sin conciliar, y en OTRA sí,
   casi seguro se eligió la cuenta equivocada: se avisa en el momento, con el
   pago que sí está, para atarlo con un toque.

   Sin React ni red.
   ================================================================== */

export interface PagoEnOtraPasarela {
  mov: Movimiento;
  procesador: Procesador;
  disponible: number;
}

export interface DatosDelCobro {
  procesadorId: ID;
  monto: number;
  fecha: string;
  movimientoId?: ID;
}

/** Cuántos días de diferencia entre lo que dice el cobro y lo que vio la pasarela se aceptan (un pago de la noche se carga al otro día). */
const DIAS = 4;
const DIA = 86400000;

/**
 * El pago de esta persona que está en OTRA pasarela cuando en la elegida no hay ninguno; undefined si no hay nada que decir (la cuenta no es de
 * una pasarela, el cobro ya está atado, en la elegida sí hay un pago suyo, o no aparece en ninguna).
 * `disponible(mov)` dice cuánto le queda sin atar a cada pago (lo que ya usaron otros cobros).
 */
export function pagoEnOtraPasarela(
  cobro: DatosDelCobro,
  procesadores: readonly Procesador[],
  movimientos: readonly Movimiento[],
  cliente: { nombre?: string; email?: string },
  disponible: (mov: Movimiento) => number,
): PagoEnOtraPasarela | undefined {
  if (cobro.movimientoId) return undefined;
  const elegida = procesadores.find((p) => p.id === cobro.procesadorId);
  if (!elegida?.proveedor) return undefined;
  const t = Date.parse(cobro.fecha);
  const suyos = movimientos.filter((m) =>
    m.estado === "pendiente" && quienPagoVsCliente(m, cliente) === "es" && disponible(m) > 0.009
    && (!Number.isFinite(t) || Math.abs(Date.parse(m.fecha) - t) <= DIAS * DIA));
  /* En la pasarela elegida hay un pago suyo: está bien elegida (falta atarlo, y eso ya se ofrece). */
  if (suyos.some((m) => m.proveedor === elegida.proveedor)) return undefined;
  /* El más parecido en monto de los de las otras pasarelas. */
  const otros = suyos
    .filter((m) => m.proveedor !== elegida.proveedor)
    .map((m) => ({ mov: m, procesador: procesadorDe(procesadores, m), disponible: disponible(m) }))
    .filter((x): x is PagoEnOtraPasarela => Boolean(x.procesador) && x.procesador!.id !== elegida.id)
    .sort((a, b) => Math.abs(a.disponible - (cobro.monto || a.disponible)) - Math.abs(b.disponible - (cobro.monto || b.disponible)));
  return otros[0];
}

function procesadorDe(procesadores: readonly Procesador[], mov: Movimiento): Procesador | undefined {
  return (mov.procesadorId ? procesadores.find((p) => p.id === mov.procesadorId) : undefined)
    ?? procesadores.find((p) => p.proveedor === mov.proveedor && p.activo);
}
