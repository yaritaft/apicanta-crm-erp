import type { Devolucion } from "./types";

/* ==================================================================
   Por qué algo no corresponde a una venta.

   Revisión con Aldana (19/10): ningún ingreso ni egreso de una pasarela se
   deja de lado sin decir por qué. Un cobro que no es una venta (se reembolsó,
   nunca se cobró, está repetido…) queda «Sin venta» con su motivo escrito, y
   un reembolso que no es una devolución también. Quien los ignora elige el
   motivo; el texto que se guarda es el que lee el equipo después.
   ================================================================== */

export interface OpcionMotivo {
  id: string;
  texto: string;
  /* Una frase corta que aclara la opción. */
  ayuda?: string;
  /* Pide escribir algo (en «Otro» es obligatorio; en las demás, opcional). */
  pideDetalle?: "obligatorio" | "opcional";
}

/** Por qué un cobro que entró a una pasarela no es una venta. */
export const MOTIVOS_DE_COBRO: readonly OpcionMotivo[] = [
  { id: "reembolsado", texto: "Se reembolsó", ayuda: "La pasarela le devolvió la plata al cliente.", pideDetalle: "opcional" },
  { id: "no-cobrado", texto: "No se cobró", ayuda: "El intento de pago falló, se bloqueó o quedó abierto.", pideDetalle: "opcional" },
  { id: "repetido", texto: "Está repetido", ayuda: "El mismo cobro ya figura en otro lado.", pideDetalle: "opcional" },
  { id: "otra-via", texto: "El cliente pagó por otra vía", ayuda: "Por ejemplo, volvió a pagar por Stripe y ese cobro sí está conciliado.", pideDetalle: "opcional" },
  { id: "no-es-cliente", texto: "No es de un cliente", ayuda: "Una liquidación de la pasarela o una devolución del banco.", pideDetalle: "opcional" },
  { id: "otro", texto: "Otro motivo", pideDetalle: "obligatorio" },
];

/** Por qué un reembolso que informó una pasarela no es una devolución. */
export const MOTIVOS_DE_REEMBOLSO: readonly OpcionMotivo[] = [
  { id: "nunca-conto", texto: "El cobro que se devolvió nunca contó como cobrado", ayuda: "Nunca se concilió: devolverlo no resta nada.", pideDetalle: "opcional" },
  { id: "ya-cargada", texto: "Ya está cargada como devolución", ayuda: "Alguien la cargó a mano y es la misma plata.", pideDetalle: "opcional" },
  { id: "no-es-cliente", texto: "No es una devolución a un cliente", pideDetalle: "opcional" },
  { id: "otro", texto: "Otro motivo", pideDetalle: "obligatorio" },
];

/** Por qué se elimina una venta (Aldana, 24/10): lo que se escribe queda en Actividad junto a quién la eliminó. */
export const MOTIVOS_DE_ELIMINAR_VENTA: readonly OpcionMotivo[] = [
  { id: "repetida", texto: "Está cargada dos veces", ayuda: "Es la misma compra cargada otra vez: queda la otra.", pideDetalle: "opcional" },
  { id: "no-pago", texto: "El cliente no pagó", ayuda: "Se cargó pero la compra nunca se concretó.", pideDetalle: "opcional" },
  { id: "error", texto: "Se cargó por error", ayuda: "Persona, servicio o precio equivocados.", pideDetalle: "opcional" },
  { id: "otro", texto: "Otro motivo", pideDetalle: "obligatorio" },
];

const LARGO_MINIMO = 3;

/** ¿Alcanza lo elegido y escrito para guardar el motivo? */
export function motivoCompleto(opcion: OpcionMotivo | undefined, detalle: string): boolean {
  if (!opcion) return false;
  if (opcion.pideDetalle === "obligatorio") return detalle.trim().length >= LARGO_MINIMO;
  return true;
}

/** El motivo tal como se guarda: «Se reembolsó: lo devolvió Whop el 05/10». En «Otro motivo», sólo lo escrito. */
export function textoDeMotivo(opcion: OpcionMotivo, detalle: string): string {
  const d = detalle.trim();
  if (opcion.id === "otro") return d;
  return d ? `${opcion.texto}: ${d}` : opcion.texto;
}

/** Un cobro sin venta al que nadie le escribió el motivo. */
export const faltaElMotivo = (m: { estado?: string; motivo?: string | null }): boolean => m.estado === "ignorado" && !m.motivo?.trim();

/** Por qué se descartó un reembolso («No es una devolución»), si se dijo. */
export const motivoDeDescarte = (d: Pick<Devolucion, "extra">): string | undefined =>
  typeof d.extra?.motivoDescarte === "string" && d.extra.motivoDescarte.trim() ? d.extra.motivoDescarte.trim() : undefined;

/** El motivo de los cobros que el banco anula solo. */
export const MOTIVO_ANULADO = "El banco lo anuló (falló, se canceló o se revirtió): se dejó sin venta solo.";
/** El de los depósitos de Mercury que probablemente son una liquidación de Hotmart. */
export const MOTIVO_LIQUIDACION_PROBABLE = "Liquidación probable de Hotmart (arx, bridge o masspay): no es de un cliente. Si resulta serlo, se vuelve a pendientes.";
