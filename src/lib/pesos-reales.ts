import type { EstadoApp, Pago } from "./types";

/* ==================================================================
   Los pesos que ENTRARON en un cobro en pesos (Aldana, 29/10): «si a mí no
   me ponen cuánto fue lo que recibimos nosotros, no puedo pasar la venta».
   Antes alcanzaba con el tipo de cambio que propone la app, y los pesos
   salían de los dólares por ese cambio: la Financiera figuraba con dos
   millones donde habían entrado uno y medio. Además, el comprobante del
   cliente puede traer más (su banco o su tarjeta le cobra de más, y eso no
   es nuestro): lo que vale es el monto del link de pago o lo que acreditó
   la Financiera.
   ================================================================== */

/** ¿Falta escribir los pesos de este cobro? Sí en uno nuevo en una cuenta en pesos, sin cobro de pasarela atado y sin pesos escritos. Un
 *  cobro que ya estaba cargado y se corrige no lo pide: puede ser de antes de esta regla. */
export function faltanLosPesos(
  e: Pick<EstadoApp, "pagos">,
  p: { id: string; movimientoId?: string; montoArs?: number },
  enPesos: boolean,
): boolean {
  if (!enPesos || p.movimientoId) return false;
  if (p.montoArs && p.montoArs > 0) return false;
  return !e.pagos.some((x: Pick<Pago, "id">) => x.id === p.id);
}

export const textoDePesosQueFaltan = (nombre: string) =>
  `Escribí cuántos pesos recibimos de ${nombre}: el monto del link de pago o lo que acreditó la Financiera, sin lo que su banco o su tarjeta le cobró de más`;
