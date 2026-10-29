/* ==================================================================
   El mínimo para dar los accesos (28/10).

   Luis Mejía dejó US$ 100 de reserva de un programa de US$ 3.000 y, al firmar el contrato del programa (el closer lo mandó con
   «plan de cuotas» en vez de «sólo la reserva»), la app le dio todos los accesos: Wisboo, Telegram y Zoom. Dante: «a pesar de
   haber pagado solamente 100 dólares, el sistema ya le da todos los accesos; como que no haya un mínimo».

   El mínimo: si lo único que entró de la venta es la reserva y el plan todavía tiene cuotas por cobrar, los accesos esperan al
   primer pago del programa. No frena nada más: sin pagos cargados no hay evidencia de que sea sólo la reserva (el contrato a
   veces se manda antes de cargar los cobros), y quien lo decide a mano con «Dar los accesos» siempre puede.

   Puro: sin red ni base, para poder probarlo.
   ================================================================== */

export interface CuotaDelPlan { id: string; monto: number; esReserva: boolean }
export interface PagoDeCuota { cuotaId: string; monto: number }

const plata = (n: number, moneda: string) => `${moneda === "USD" ? "US$" : moneda} ${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString("es-AR") : (Math.round(n * 100) / 100).toLocaleString("es-AR")}`;

/** Por qué todavía no se dan los accesos (sólo pagó la reserva), o null si se pueden dar. */
export function motivoSinPagoDelPrograma(
  cuotas: readonly CuotaDelPlan[] | null | undefined, pagos: readonly PagoDeCuota[] | null | undefined, moneda = "USD",
): string | null {
  if (!cuotas?.length) return null;
  const reserva = new Set(cuotas.filter((c) => c.esReserva).map((c) => c.id));
  const delPrograma = cuotas.filter((c) => !c.esReserva && c.monto > 0);
  if (reserva.size === 0 || delPrograma.length === 0) return null;
  let pagadoReserva = 0, pagadoPrograma = 0;
  for (const p of pagos ?? []) {
    if (reserva.has(p.cuotaId)) pagadoReserva += p.monto;
    else if (cuotas.some((c) => c.id === p.cuotaId)) pagadoPrograma += p.monto;
  }
  if (pagadoReserva <= 0 || pagadoPrograma > 0) return null;
  const total = cuotas.reduce((n, c) => n + c.monto, 0);
  return `Sólo pagó la reserva (${plata(pagadoReserva, moneda)} de ${plata(total, moneda)}): los accesos se dan solos apenas entre el primer pago del programa, o con «Dar los accesos».`;
}

/** En la carga de la venta (el asistente): ¿lo único que se cobró es la reserva y el plan sigue con cuotas por cobrar? Con eso, el
    contrato que corresponde es el de la reserva: el del programa da los accesos al firmar. */
export function soloSeCobroLaReserva(lineas: readonly { esReserva: boolean; monto: number; cobros: readonly unknown[] }[]): boolean {
  const reserva = lineas.filter((l) => l.esReserva);
  const resto = lineas.filter((l) => !l.esReserva && l.monto > 0);
  return reserva.some((l) => l.cobros.length > 0) && resto.length > 0 && resto.every((l) => l.cobros.length === 0);
}
