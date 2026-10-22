import type { Cuota } from "./types";

/* ==================================================================
   Una compra que todavía es sólo la reserva (Lili, 21/10: Cristian Lopez dejó
   USD 50 de reserva y la ficha lo mostraba como alumno de una Mentoría de 2.400;
   José Ponceleón dejó 100 de una venta de 500 y entra al Downsell recién el 15/11).

   Mientras lo único que pagó es la reserva, el programa no arrancó: no corren
   los días ni el vencimiento, y la ficha lo dice. Cuando paga la primera cuota
   que no es reserva, pasa a ser una compra común.
   ================================================================== */

export interface EstadoReserva {
  /* Lo que dejó de reserva (las cuotas de reserva pagadas). */
  pagado: number;
  /* Lo que le falta pagar de la venta. */
  falta: number;
}

/** La reserva que todavía no se completó (sólo pagó la reserva), o null si no es eso. */
export function reservaSinCompletar(cuotasVenta: readonly Pick<Cuota, "monto" | "esReserva" | "estado">[]): EstadoReserva | null {
  const reservas = cuotasVenta.filter((c) => c.esReserva);
  if (!reservas.some((c) => c.estado === "pagada")) return null;
  const resto = cuotasVenta.filter((c) => !c.esReserva);
  if (resto.some((c) => c.estado === "pagada")) return null;
  const pagado = reservas.filter((c) => c.estado === "pagada").reduce((a, c) => a + (c.monto || 0), 0);
  const falta = cuotasVenta.filter((c) => c.estado !== "pagada").reduce((a, c) => a + (c.monto || 0), 0);
  return { pagado, falta };
}
