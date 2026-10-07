/* ==================================================================
   Una llamada que se pasó a otro closer a mano.

   El closer de una llamada es el anfitrión del evento en Calendly
   (`sesiones.anfitrion`), y Calendly lo vuelve a escribir cada vez que el
   invitado reingresa: una cancelación, un no-show o una reprogramación
   llegan por el webhook y por el cron como una agenda más. Sin una marca,
   eso deshacía lo que decidió el director: «tal te atiende».

   La marca va en `sesiones.extra.pasada` (sin columna nueva, sin SQL) y
   dice quién la atiende ahora, quién figuraba en Calendly y quién la pasó.
   Mientras esté, la entrada de Calendly (lib/calendly-sync.ts) deja el
   anfitrión como está y sólo actualiza lo que Calendly dice, para poder
   volver a él. Una reprogramación es una agenda nueva: hereda la marca de
   la que reemplaza.

   Es un archivo aparte, sin dependencias, porque lo usan el servidor y la
   pantalla; el resto de la lógica de pasar llamadas está en
   lib/pasar-llamadas.ts.
   ================================================================== */

export interface PasadaDeCloser {
  /** Quién la atiende ahora (lo que quedó en `anfitrion`). */
  a: string;
  /** Lo que dice Calendly: su anfitrión del evento. Se actualiza solo. */
  calendly: string;
  /** Quién la pasó y cuándo. */
  por: string;
  en: string;
}

const texto = (v: unknown) => (typeof v === "string" ? v : "");

/** La marca de una llamada que se pasó a mano, si la tiene. */
export function pasadaDe(s: { extra?: Record<string, unknown> | null }): PasadaDeCloser | undefined {
  const p = s.extra?.pasada;
  if (!p || typeof p !== "object") return undefined;
  const x = p as Record<string, unknown>;
  const a = texto(x.a).trim();
  return a ? { a, calendly: texto(x.calendly), por: texto(x.por), en: texto(x.en) } : undefined;
}

/** Lo que va a quedar como anfitrión de una agenda que entra de Calendly.
 *  Sin marca, el de Calendly. Con marca (en la misma agenda o, si es una
 *  reprogramación, en la que reemplaza), el que se eligió a mano; la marca
 *  sigue y anota lo que dice Calendly ahora. */
export function anfitrionTrasCalendly(
  deCalendly: string | undefined,
  previo?: { anfitrion?: string | null; extra?: Record<string, unknown> | null } | null,
): { anfitrion: string | undefined; pasada?: PasadaDeCloser } {
  const p = previo ? pasadaDe({ extra: previo.extra }) : undefined;
  if (!p) return { anfitrion: deCalendly };
  return {
    anfitrion: previo?.anfitrion?.trim() || p.a,
    pasada: { ...p, calendly: deCalendly ?? p.calendly },
  };
}
