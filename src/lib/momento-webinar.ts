import type { Webinar } from "./types";

/* ==================================================================
   Pre-webinar o del webinar (Daniel, 18/11).

   «Estamos haciendo una estrategia con leads ANTES de que empiece el webinar y en el CRM figuran como si fueran del webinar: queríamos
   diferenciar los que son pre de los que son del webinar como tal». Un lead que entró el 18/11 tenía en la ficha «Webinar · seguimiento,
   Taller 21/10» (el link con el que agendó era el de seguimiento de ese taller): nada decía que en realidad esperaba el del 25/11.

   La regla sale sola de las fechas, sin links nuevos ni nada que cargar:
     · el webinar de una persona es el PRIMERO que empieza después de que entró (para el que se anotó o al que iba a ir);
     · si ese webinar todavía no empezó, es «Pre-webinar»: la gente que hay que trabajar antes del vivo;
     · si ya empezó, es «Del webinar»: pasó por ese evento (asistió o no, eso lo dicen otras columnas).
   Cuando pasa el vivo, los «pre» de ese webinar pasan solos a «del webinar», sin tocar a nadie.

   Una persona que entró después del último webinar programado (no hay ninguno por delante) queda sin momento.
   ================================================================== */

export type MomentoId = "pre" | "webinar";

export interface MomentoWebinar {
  id: MomentoId;
  /* «Pre-webinar» / «Del webinar»: lo que dice la columna y el filtro. */
  texto: string;
  webinarId: string;
  titulo: string;
  /* El día y la hora del vivo, tal cual está en el webinar. */
  fecha: string;
}

export const MOMENTOS: { id: MomentoId; texto: string }[] = [
  { id: "pre", texto: "Pre-webinar" },
  { id: "webinar", texto: "Del webinar" },
];

export const textoDeMomento = (id: MomentoId): string => MOMENTOS.find((m) => m.id === id)?.texto ?? "";

type Evento = Pick<Webinar, "id" | "titulo" | "fecha" | "estado">;

/** Los webinars que cuentan (sin borradores), del más viejo al más nuevo, con la fecha ya leída. Se arma una vez y se usa para muchas personas. */
export function webinarsPorFecha(webinars: readonly Evento[]): { w: Evento; t: number }[] {
  return webinars
    .filter((w) => w.estado !== "borrador")
    .map((w) => ({ w, t: Date.parse(w.fecha) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
}

/** El momento de alguien que entró en `entro` (ISO), o null si no se sabe cuándo entró o no hay un webinar después. */
export function momentoDeEntrada(
  entro: string | null | undefined,
  ordenados: { w: Evento; t: number }[],
  ahora = Date.now(),
): MomentoWebinar | null {
  if (!entro) return null;
  const t = Date.parse(entro);
  if (Number.isNaN(t)) return null;
  const sig = ordenados.find((x) => x.t > t);
  if (!sig) return null;
  const id: MomentoId = sig.t > ahora ? "pre" : "webinar";
  return { id, texto: textoDeMomento(id), webinarId: sig.w.id, titulo: sig.w.titulo, fecha: sig.w.fecha };
}

/** Lo mismo, partiendo de la lista de webinars tal cual (para una sola persona, como la ficha). */
export const momentoDe = (entro: string | null | undefined, webinars: readonly Evento[], ahora = Date.now()): MomentoWebinar | null =>
  momentoDeEntrada(entro, webinarsPorFecha(webinars), ahora);
