import { origenDeUtm } from "./utms";
import type { EstadoApp, ID } from "./types";

/* ==================================================================
   La estrategia (embudo) con la que queda una venta nueva (Aldana, 31/10: «esas 8 ventas sin estrategia»).
   Sale de la UTM de quien compró; si no trae una con regla (un lead de Calendly sin UTM), la tiene que decir quien
   carga la venta. Antes el asistente la dejaba pasar en blanco y la venta quedaba sin estrategia: Marketing no la
   cuenta y Finanzas no puede cerrar el mes.
   ================================================================== */

export const FALTA_ESTRATEGIA = "Elegí la estrategia por la que entró la venta: sin eso Marketing no la cuenta y Finanzas no puede cerrar el mes";

/** La estrategia con la que va a quedar: la de la UTM, o la que se eligió a mano. Vacío si ninguna dice nada. */
export function estrategiaDeLaVenta(e: EstadoApp, contactoId: ID | undefined, fecha: string, elegida?: ID): ID | undefined {
  return origenDeUtm(e, contactoId, fecha)?.embudoId ?? (elegida || undefined);
}
