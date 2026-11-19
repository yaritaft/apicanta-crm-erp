import { origenDeUtm } from "./utms";
import type { EstadoApp, ID } from "./types";

/* ==================================================================
   La estrategia (embudo) con la que queda una venta nueva (Aldana, 31/10: «esas 8 ventas sin estrategia»).
   Sale de la UTM de quien compró; si no trae una con regla (un lead de Calendly sin UTM), la tiene que decir quien
   carga la venta. Antes el asistente la dejaba pasar en blanco y la venta quedaba sin estrategia: Marketing no la
   cuenta y Finanzas no puede cerrar el mes.
   ================================================================== */

export const FALTA_ESTRATEGIA = "Elegí la estrategia por la que entró la venta: sin eso Marketing no la cuenta y Finanzas no puede cerrar el mes";

/* ==================================================================
   El lanzamiento interno (Aldana, 19/11): el martes o el lunes se vende el upgrade a Hackear AI y Principals a quienes ya son alumnos. Es una
   venta interna, pero Agustín la comisiona (su esquema deja afuera la «Venta interna» común y cuenta la estrategia «Lanzamiento interno»).
   Antes dependía de que el closer eligiera esa estrategia a mano, y ni siquiera la ofrecía cuando la persona ya traía una UTM de su primera
   compra (la UTM manda): la venta quedaba como Webinar o VSL y Agustín cobraba o no según de dónde vino el alumno hace meses.
   Ahora hay una opción: «es del lanzamiento interno» pone esa estrategia, no mira la UTM y la deja excluida de marketing (no vino de los anuncios).
   ================================================================== */

export const EMBUDO_LANZAMIENTO_INTERNO: ID = "emb_lanzamiento_interno";
/* Lo que se vende en el lanzamiento: ante estos servicios el asistente pregunta si es del lanzamiento (con cualquier otro, la opción está igual en el resumen). */
export const SERVICIOS_DEL_LANZAMIENTO_INTERNO: readonly ID[] = ["prod_upgrade_ai", "prod_principals"];
export const esServicioDelLanzamientoInterno = (productoId?: ID): boolean => Boolean(productoId && SERVICIOS_DEL_LANZAMIENTO_INTERNO.includes(productoId));

/** La estrategia con la que va a quedar: la del lanzamiento interno si se marcó, si no la de la UTM, o la que se eligió a mano. Vacío si ninguna dice nada. */
export function estrategiaDeLaVenta(e: EstadoApp, contactoId: ID | undefined, fecha: string, elegida?: ID, lanzamientoInterno = false): ID | undefined {
  if (lanzamientoInterno) return EMBUDO_LANZAMIENTO_INTERNO;
  return origenDeUtm(e, contactoId, fecha)?.embudoId ?? (elegida || undefined);
}
