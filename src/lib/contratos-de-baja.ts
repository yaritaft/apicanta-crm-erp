import type { EstadoContrato } from "./contratos";

/* ==================================================================
   La baja de una venta arrastra su contrato y sus accesos (Liliana, 27/11).

   El caso que lo motivó: la venta se marcó reembolsada el 27/11 a la madrugada, pero el contrato de Hackear AI que le había
   mandado el closer siguió vivo en PandaDoc (lo había abierto y le faltaba firmar). Si lo firmaba, la app le daba los
   accesos: lo pagado estaba completo y al firmar nadie miraba si la venta seguía en pie. Lili lo anuló a mano al revisar.
   Lo mismo con los accesos: a quien se le devolvía la plata los conservaba hasta que alguien los sacara a mano.

   Desde acá, cuando una venta se cancela o se reembolsa y la persona no tiene otra venta activa (si la tiene, su servicio
   pasa a esa venta: lib/store.ts → efectoDeBaja, y no se toca nada):
   - el contrato que no firmó se anula en PandaDoc: ya no lo puede firmar;
   - los accesos que dio la app se sacan (lo mismo que «Quitar todo» en la ficha), una sola vez: si después Servicio se
     los vuelve a dar, no se los saca de nuevo;
   - Customer Success recibe un aviso en la campanita con lo que se hizo y lo que queda a mano;
   - y si igual llega una firma (la firmó un segundo antes), no se dan accesos ni sale el mail de bienvenida.
   Lo hace el servidor apenas se da de baja (/api/contratos/baja) y, si ese pedido no salió, la pasada de cada hora.

   Sin React ni base: la usan el servidor, la pantalla y las pruebas.
   ================================================================== */

export type EstadoDeVenta = "activa" | "cancelada" | "reembolsada" | string;

export const esVentaDeBaja = (estado: EstadoDeVenta | null | undefined): boolean => estado === "cancelada" || estado === "reembolsada";

/* Las bajas desde que se publicó esto se resuelven solas. Las de antes, no: a quien se dio de baja hace semanas no se le sacan
   los accesos de golpe sin que Servicio lo decida (se revisan a mano; la del caso que lo motivó ya la había resuelto Lili). */
export const DESDE_BAJAS_AUTOMATICAS = "2026-11-27T16:00:00.000Z";

/* Lo hecho queda en la venta (extra), así la pasada de cada hora no lo repite. */
export const CLAVE_SALIDA_POR_BAJA = "salidaPorBaja";

export interface SalidaPorBaja {
  en: string;
  /* Por qué: «reembolsada» o «cancelada». */
  estado: string;
  quitados: string[];
  aMano: string[];
  fallaron: string[];
  /* Los programas de los contratos que se anularon. */
  contratos: string[];
}

/** El contrato que todavía se puede firmar (o mandar): se anula. Uno firmado ya pasó; uno anulado o rechazado ya no se firma. */
export const contratoAnulable = (estado: EstadoContrato): boolean =>
  estado === "creando" || estado === "borrador" || estado === "enviado" || estado === "visto" || estado === "error";

/** Uno que nunca le llegó al alumno: si PandaDoc no lo deja anular, alcanza con anularlo en la app (no lo puede firmar). */
export const nuncaSalio = (estado: EstadoContrato): boolean => estado === "creando" || estado === "borrador" || estado === "error";

/** El motivo que queda en el historial del contrato y en PandaDoc. */
export const motivoDeLaBaja = (estado: EstadoDeVenta): string =>
  estado === "reembolsada" ? "Se reembolsó la venta" : "Se canceló la venta";

/** Por qué no se dan los accesos de un contrato: su venta está de baja y la persona no tiene otra activa. null si se pueden dar. */
export function sinAccesosPorLaBaja(venta: { estado: EstadoDeVenta } | null | undefined, otraVentaActiva: boolean): string | null {
  if (!venta || !esVentaDeBaja(venta.estado) || otraVentaActiva) return null;
  return `La venta está ${venta.estado === "reembolsada" ? "reembolsada" : "cancelada"}: no se dan los accesos. Si sigue en el programa, que Finanzas reactive la venta y tocá «Dar los accesos».`;
}

const unirConY = (xs: readonly string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** El aviso a Customer Success: qué se hizo con su contrato y sus accesos, y qué falta a mano. null si no hay nada que contar. */
export function avisoDeLaBaja(a: {
  nombre: string; estado: EstadoDeVenta;
  /* Programas de los contratos anulados y de los que PandaDoc no dejó anular. */
  anulados: readonly string[]; noAnulados: readonly string[];
  /* null: no tiene servicio (ni accesos que mirar). */
  accesos: { quitados: number; plataformas: readonly string[]; aMano: readonly string[]; fallaron: readonly string[]; teniaDeLaApp: boolean } | null;
  /* La venta tenía contrato y no firmó ninguno (aunque ya estuviera anulado): no pudo recibir accesos por la app. */
  sinFirmar?: boolean;
}): { titulo: string; cuerpo: string; pendiente: boolean } | null {
  if (!a.anulados.length && !a.noAnulados.length && !a.accesos) return null;
  const que = a.estado === "reembolsada" ? "reembolsó" : "canceló";
  const partes: string[] = [];
  if (a.anulados.length) {
    partes.push(`Anulamos su contrato de ${unirConY(a.anulados)}, que no había firmado: ya no lo puede firmar.`);
  }
  if (a.noAnulados.length) {
    partes.push(`No pudimos anular en PandaDoc su contrato de ${unirConY(a.noAnulados)}: anulalo a mano desde su ficha → Contrato. Igual, si lo firma, la app no le da accesos.`);
  }
  const ac = a.accesos;
  if (ac) {
    if (ac.quitados > 0) {
      partes.push(`Le sacamos ${plural(ac.quitados, "1 acceso", `${ac.quitados} accesos`)} de la app${ac.plataformas.length ? ` (${unirConY(ac.plataformas)})` : ""}.`);
      if (ac.aMano.length) partes.push(`${unirConY(ac.aMano)} ${plural(ac.aMano.length, "no figura", "no figuran")} en la app: si los tiene de antes, sacáselos a mano.`);
    } else if (!ac.teniaDeLaApp) {
      partes.push(a.anulados.length || a.sinFirmar
        ? "Como no llegó a firmar, no tenía accesos de la app."
        : "No tenía accesos dados por la app: si tiene alguno de antes (Wisboo, Telegram, Zoom o WhatsApp), sacáselo a mano.");
    }
    if (ac.fallaron.length) partes.push(`No se pudo sacar: ${ac.fallaron.join(", ")}. Hacelo a mano desde su ficha → Servicio → Accesos.`);
  }
  const pendiente = a.noAnulados.length > 0 || Boolean(ac && (ac.fallaron.length > 0 || (ac.quitados > 0 && ac.aMano.length > 0) || (!ac.teniaDeLaApp && !a.anulados.length && !a.sinFirmar)));
  return {
    titulo: pendiente ? `Se ${que} la venta de ${a.nombre}: falta algo a mano` : `Se ${que} la venta de ${a.nombre}`,
    cuerpo: partes.join(" "),
    pendiente,
  };
}

/** Lo que se le cuenta a quien dio de baja la venta (el cartel de abajo), o null si no se hizo nada. */
export function avisoParaQuienDioDeBaja(r: { anulados: number; noAnulados: number; quitados: number; fallaron: number; avisado: boolean }): { texto: string; error: boolean } | null {
  const hechos: string[] = [];
  if (r.anulados) hechos.push(r.anulados === 1 ? "anulamos su contrato sin firmar" : `anulamos sus ${r.anulados} contratos sin firmar`);
  if (r.quitados) hechos.push(`le sacamos ${plural(r.quitados, "1 acceso", `${r.quitados} accesos`)} de la app`);
  const error = r.noAnulados > 0 || r.fallaron > 0;
  if (!hechos.length && !error) return null;
  const inicio = hechos.length ? `${hechos.join(" y ")}` : "";
  const falla = error ? `${inicio ? ", pero " : ""}algo no se pudo hacer solo` : "";
  const texto = `Por la baja: ${inicio}${falla}${r.avisado ? `. Le avisamos a Servicio${error ? " qué falta" : ""}.` : "."}`;
  return { texto: texto.charAt(0).toUpperCase() + texto.slice(1), error };
}
