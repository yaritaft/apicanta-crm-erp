/* ==================================================================
   El barrido de Fathom por los links (lo que faltaba para que cada llamada
   tenga sola su transcripción).

   Los closers pegan el link de Fathom en el cierre del día (840 llamadas al
   26/10), pero la tabla `grabaciones` estaba vacía: la grabación sólo se
   guardaba si el correo del invitado y la hora coincidían con una llamada
   de Calendly, y el aviso de Fathom llega antes de que el closer pegue
   nada. La API de Fathom no deja pedir una grabación por su link
   (developers.fathom.ai/faq), pero cada reunión que devuelve trae su
   `share_url`. Entonces: se recorren las reuniones que la clave ve y, a
   cada una, se la ata a la llamada que tiene su link (lib/fathom, `idDeShare`).

   Acá, lo que no toca la red: cuándo empezar un barrido y cuándo seguir el
   que está en curso. El recorrido y el guardado, en lib/fathom-barrido-servidor.
   ================================================================== */

export interface EstadoBarrido {
  /* Dónde va el barrido en curso (el cursor opaco de fathom-equipos); null si no hay uno. */
  cursor: string | null;
  desde: string | null;
  tipo: "fresco" | "completo" | null;
  ultimoFresco: string | null;
  ultimoCompleto: string | null;
}

export const BARRIDO_VACIO: EstadoBarrido = { cursor: null, desde: null, tipo: null, ultimoFresco: null, ultimoCompleto: null };

export type DecisionBarrido =
  | { accion: "seguir" }
  | { accion: "empezar"; tipo: "fresco" | "completo"; desde: string }
  | { accion: "nada"; motivo: "sin-pendientes" | "esperando" };

const DIA = 86_400_000;
/** Una llamada es «fresca» durante 3 días: el closer pega el link ese día o el siguiente. */
const FRESCA = 3 * DIA;
/** Entre un barrido de lo fresco y el siguiente. */
export const ENTRE_FRESCOS = 30 * 60_000;
/** Entre un barrido de todo lo pendiente (lo que Fathom no mostró la vez anterior) y el siguiente. */
export const ENTRE_COMPLETOS = 20 * 3600_000;

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/** Qué hace el cron cada vez que pasa. `pendientes` son las llamadas con el
    link de Fathom pegado y sin su grabación guardada. `forzar` (el botón de
    Ajustes) no espera a que toque. */
export function decidirBarrido(e: EstadoBarrido, pendientes: { inicia: string }[], ahora: number, forzar = false): DecisionBarrido {
  if (e.cursor) return { accion: "seguir" };
  if (pendientes.length === 0) return { accion: "nada", motivo: "sin-pendientes" };
  const inicios = pendientes.map((p) => Date.parse(p.inicia)).filter(Number.isFinite);
  const piso = ahora - 365 * DIA;
  const desdeDe = (xs: number[]) => new Date(Math.max(Math.min(...xs) - DIA, piso)).toISOString();
  const frescas = inicios.filter((t) => t > ahora - FRESCA);
  const ultimoCompleto = ms(e.ultimoCompleto), ultimoFresco = Math.max(ms(e.ultimoFresco) || 0, ultimoCompleto || 0);
  const tocaCompleto = forzar || !Number.isFinite(ultimoCompleto) || ahora - ultimoCompleto >= ENTRE_COMPLETOS;
  if (tocaCompleto && inicios.length) return { accion: "empezar", tipo: "completo", desde: desdeDe(inicios) };
  if (frescas.length && (ahora - ultimoFresco >= ENTRE_FRESCOS)) return { accion: "empezar", tipo: "fresco", desde: desdeDe(frescas) };
  return { accion: "nada", motivo: "esperando" };
}
