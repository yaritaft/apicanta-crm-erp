import type { ID } from "./types";

/* ==================================================================
   Los avisos de cada persona del equipo: la campanita de arriba, como
   en Blue OS (Juan Cruz, 23/10). Hoy, «X te mencionó» en el chat de una
   ficha. Los crea la base (supabase/avisos.sql, disparador de
   `comentarios`); la app los lee, los muestra y los marca leídos. Cada
   uno ve sólo los suyos (RLS por mail).
   ================================================================== */

export interface Aviso {
  id: ID;
  /* El mail de quien lo recibe, en minúsculas. */
  para: string;
  tipo: "mencion" | string;
  titulo: string;
  /* El mensaje (hasta 400 caracteres). */
  cuerpo: string | null;
  de: string | null;
  deEmail: string | null;
  /* La persona de la ficha: la clave del chat (lib/persona.ts → clave). */
  contactoId: ID | null;
  /* Su nombre, para decir de qué ficha es. */
  persona: string | null;
  comentarioId: ID | null;
  leidoEn: string | null;
  creadoEn: string;
}

export const AVISOS_A_MOSTRAR = 50;

export const sinLeer = (avisos: readonly Aviso[]): number => avisos.filter((a) => !a.leidoEn).length;

/** «recién», «hace 5 min», «hace 3 h», «ayer», «hace 4 días»: lo que lleva el aviso a la derecha. */
export function hace(iso: string, ahora: number = Date.now()): string {
  const min = Math.floor((ahora - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

/** El renglón de abajo del título: de qué ficha es. */
export const dondeEs = (a: Pick<Aviso, "persona"> & Partial<Pick<Aviso, "tipo">>): string =>
  a.persona ? `En la ficha de ${a.persona}` : a.tipo === "pandadoc" ? "Contratos de PandaDoc" : "En el chat de una ficha";

/** Un aviso nuevo en la lista: arriba, sin repetir (llega por Realtime y también al volver a leer). */
export function sumarAviso(lista: readonly Aviso[], nuevo: Aviso, tope = AVISOS_A_MOSTRAR): Aviso[] {
  const sin = lista.filter((a) => a.id !== nuevo.id);
  return [nuevo, ...sin].sort((x, y) => y.creadoEn.localeCompare(x.creadoEn)).slice(0, tope);
}

/** Leído en la lista que se ve, antes de que conteste la base (si falla, la próxima lectura lo corrige). */
export function marcarEnLista(lista: readonly Aviso[], cuales: (a: Aviso) => boolean, cuando: string): Aviso[] {
  return lista.map((a) => (!a.leidoEn && cuales(a) ? { ...a, leidoEn: cuando } : a));
}

/* ---------- El aviso entre partes de la app ----------
   El chat de una ficha apaga los avisos de esa ficha al leerse (como en Blue OS: leer el chat lo apaga en los dos
   lados). La campanita escucha y vuelve a leer. */
type Oyente = () => void;
const oyentes = new Set<Oyente>();
export function avisarCambioDeAvisos(): void {
  for (const fn of oyentes) { try { fn(); } catch { /* un oyente roto no tumba a los otros */ } }
}
export function alCambiarAvisos(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => { oyentes.delete(fn); };
}
