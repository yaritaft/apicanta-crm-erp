import type { Devolucion } from "./types";

/* ==================================================================
   Las disputas (contracargos) de Stripe, en tres estados (Juan Cruz, 23/10).

   Cuando el banco del cliente abre una disputa, Stripe ya retira la plata (el monto más 15 de comisión) y la deja retenida mientras se
   resuelve. Hasta que se resuelve no hay nada que cargar:

     · en disputa: se ve como propuesta con su etiqueta y SIN botones. Si se gana, vuelve sola; si se pierde, sigue.
     · ganada: no pasó nada. La plata volvió a Stripe, la venta sigue como ingreso y la propuesta se va sola.
     · perdida: aparece el botón para cargarla como gasto (lo que Stripe retiró deja de ser un «a ver qué pasa»).

   El estado lo trae la sincronización (lib/pasarelas-api.ts, «reembolsoDeContracargoStripe») y se guarda en `extra.estadoDisputa` de la
   propuesta; cada corrida lo actualiza. Sin saber todavía el estado (una propuesta guardada antes de esto) se trata como «en disputa»:
   no hacer nada es lo seguro.
   ================================================================== */

export type EstadoDisputa = "en-disputa" | "ganada" | "perdida";

const ES_DE_DISPUTA = /^stripe:disputa:/;

/** El estado de Stripe («needs_response», «under_review», «won», «lost», «charge_refunded») en los tres de acá. */
export function estadoDeDisputaStripe(status: string | undefined): EstadoDisputa {
  if (status === "won" || status === "charge_refunded") return "ganada";
  if (status === "lost") return "perdida";
  return "en-disputa";
}

/** El estado de la disputa de una devolución que informó Stripe; null si no es una disputa. */
export function disputaDe(d: Pick<Devolucion, "referencia" | "extra">): EstadoDisputa | null {
  if (!d.referencia || !ES_DE_DISPUTA.test(d.referencia)) return null;
  const x = d.extra?.estadoDisputa;
  return x === "ganada" || x === "perdida" || x === "en-disputa" ? x : "en-disputa";
}

/** Lo que Stripe retiró por la disputa: el monto más su comisión (si la sincronización la leyó); si no, el monto. */
export const retenidoDe = (d: Pick<Devolucion, "monto" | "extra">): number =>
  typeof d.extra?.retenido === "number" && d.extra.retenido > 0 ? d.extra.retenido : d.monto;

export const TEXTO_DE_DISPUTA: Record<EstadoDisputa, string> = {
  "en-disputa": "En disputa",
  "ganada": "Ganada",
  "perdida": "Perdida",
};

/** Lo que se le dice a quien mira una disputa que todavía no se resolvió. */
export const AVISO_EN_DISPUTA = "Stripe retuvo la plata mientras se resuelve. Si se gana, vuelve y no pasa nada; si se pierde, acá aparece el botón para cargarla como gasto.";
export const AVISO_GANADA = "Se ganó la disputa: la plata volvió a Stripe y la venta sigue como ingreso. No hay nada que cargar.";
export const MOTIVO_GANADA = "Disputa ganada: Stripe devolvió la plata y la venta sigue como ingreso.";
export const MOTIVO_PERDIDA_CARGADA = "Disputa perdida: se cargó como gasto.";

/** El borrador del gasto de una disputa perdida, listo para el asistente de gastos: lo que Stripe retiró, el día y la cuenta puestos. */
export function borradorDeDisputaPerdida(
  d: Pick<Devolucion, "monto" | "fecha" | "referencia" | "extra">, quien: string, nombreDeLaCuenta: string,
): { concepto: string; monto: string; fecha: string; cuenta: string; ingreso: boolean; bancoRef: string; proveedor: string; notas: string } {
  const retenido = retenidoDe(d);
  const balanceTx = typeof d.extra?.balanceTx === "string" ? d.extra.balanceTx : "";
  return {
    concepto: `Contracargo perdido · ${quien}`,
    monto: retenido.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(retenido) ? 0 : 2, maximumFractionDigits: 2 }),
    fecha: d.fecha, cuenta: nombreDeLaCuenta, ingreso: false,
    bancoRef: balanceTx ? `stripe:${balanceTx}` : d.referencia ?? "",
    proveedor: "Stripe",
    notas: `Disputa ${d.referencia ?? ""} perdida: Stripe retiró la plata del saldo (el monto de la disputa más su comisión).`.replace("  ", " "),
  };
}
