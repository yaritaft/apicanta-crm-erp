import { duracionLegible } from "./adjuntos-chat";
import type { ChatLectura, Comentario, ID } from "./types";

/* ==================================================================
   El chat del equipo de cada ficha, como WhatsApp: citar un mensaje al
   responder y los tildes de cada mensaje propio.

     🕓  todavía no llegó a la nube (está en la cola de este navegador);
     ✓   está en la nube, pero no les llegó a todos los del chat;
     ✓✓  les llegó a todos (lo tienen en su app);
     ✓✓  en azul: lo leyeron todos (abrieron el chat de esa ficha).

   «Todos» no es todo el equipo (un closer no ve a los alumnos, y un
   tilde que nunca se pone azul no dice nada): son LOS DEL CHAT de esa
   ficha, los que escribieron, reaccionaron o lo abrieron alguna vez,
   como los miembros de un grupo. Si nadie más lo abrió todavía, queda
   en un tilde. Al tocar los tildes se ve quién lo leyó y a quién no le
   llegó todavía.

   Lo que leyó y le llegó a cada uno se guarda por ficha (`chat_lecturas`,
   supabase/chat-adjuntos.sql): la fecha del último mensaje de otro que
   le llegó y la del último que leyó. Todo lo de acá es puro: lo usan el
   chat, el store y las pruebas.
   ================================================================== */

/** Quién es alguien en el chat: su mail (en la nube, siempre) o, sin nube, su nombre. En minúsculas. */
export function claveDe(email: string | null | undefined, nombre: string): string {
  return (email || nombre || "").trim().toLowerCase();
}

export const idDeLectura = (contactoId: ID, quien: string): ID => `${contactoId}:${quien}`;

const ms = (iso?: string): number => (iso ? +new Date(iso) : Number.NEGATIVE_INFINITY);
const autorDe = (c: Comentario) => claveDe(c.autorEmail, c.autor);

/** Un renglón que dice qué es un mensaje: para la cita y para «Respondiendo a…». */
export function resumenDeMensaje(c: Pick<Comentario, "texto" | "adjuntos">): string {
  const renglon = c.texto.split("\n").map((l) => l.trim()).find(Boolean);
  if (renglon) return renglon;
  const lista = c.adjuntos ?? [];
  const a = lista[0];
  if (!a) return "Mensaje";
  const mas = lista.length > 1 ? ` y ${lista.length - 1} más` : "";
  if (a.tipo === "audio") return `🎤 ${a.notaDeVoz ? "Nota de voz" : "Audio"}${a.duracion ? ` ${duracionLegible(a.duracion)}` : ""}${mas}`;
  if (a.tipo === "imagen") return `📷 ${lista.length > 1 && lista.every((x) => x.tipo === "imagen") ? `${lista.length} fotos` : `Foto${mas}`}`;
  if (a.tipo === "video") return `🎥 Video${mas}`;
  return `📄 ${a.nombre}${mas}`;
}

/** Los del chat de una ficha (clave → nombre): quienes escribieron, reaccionaron o lo abrieron alguna vez. */
export function participantes(comentarios: Comentario[], lecturas: ChatLectura[]): Map<string, string> {
  const gente = new Map<string, string>();
  for (const c of comentarios) {
    gente.set(autorDe(c), c.autor);
    for (const r of c.reacciones ?? []) if (!gente.has(claveDe(r.email, r.quien))) gente.set(claveDe(r.email, r.quien), r.quien);
  }
  for (const l of lecturas) if (l.leidoHasta && !gente.has(l.quien)) gente.set(l.quien, l.nombre || l.quien);
  gente.delete("");
  return gente;
}

export type Entrega = "enviando" | "sin-enviar" | "enviado" | "recibido" | "leido";

export interface DetalleEntrega {
  estado: Entrega;
  leyeron: string[];
  /* Les llegó, pero todavía no lo leyeron. */
  recibieron: string[];
  /* Todavía no les llegó. */
  faltan: string[];
}

/**
 * Los tildes de un mensaje propio. `comentarios` y `lecturas` son los de su ficha.
 * Escribir otro mensaje después en esa ficha, o reaccionar a este, cuenta como leído: lo tuvo en pantalla.
 */
export function entregaDe(
  c: Comentario, comentarios: Comentario[], lecturas: ChatLectura[],
  cola: { pendiente: boolean; error: boolean } = { pendiente: false, error: false },
): DetalleEntrega {
  const vacio = { leyeron: [], recibieron: [], faltan: [] };
  if (cola.pendiente) return { estado: cola.error ? "sin-enviar" : "enviando", ...vacio };
  const t = ms(c.creadoEn);
  const gente = participantes(comentarios, lecturas);
  gente.delete(autorDe(c));
  const lecturaDe = new Map(lecturas.map((l) => [l.quien, l] as const));
  const d: DetalleEntrega = { estado: "enviado", leyeron: [], recibieron: [], faltan: [] };
  for (const [quien, nombre] of gente) {
    const l = lecturaDe.get(quien);
    const leyo = ms(l?.leidoHasta) >= t
      || comentarios.some((x) => autorDe(x) === quien && ms(x.creadoEn) > t)
      || (c.reacciones ?? []).some((r) => claveDe(r.email, r.quien) === quien);
    if (leyo) d.leyeron.push(nombre);
    else if (ms(l?.recibidoHasta) >= t) d.recibieron.push(nombre);
    else d.faltan.push(nombre);
  }
  if (gente.size > 0 && d.faltan.length === 0) d.estado = d.recibieron.length === 0 ? "leido" : "recibido";
  return d;
}

/* El último mensaje de OTRO en una ficha: hasta ahí le llegó o leyó quien la tiene. */
function ultimoDeOtro(comentarios: Comentario[], quien: string): string | undefined {
  let ultimo: string | undefined;
  for (const c of comentarios) if (autorDe(c) !== quien && ms(c.creadoEn) > ms(ultimo)) ultimo = c.creadoEn;
  return ultimo;
}

const masTarde = (a?: string, b?: string) => (ms(a) >= ms(b) ? a : b);

/** Lo que cambia al abrir el chat de una ficha: leyó (y le llegó) hasta el último mensaje de otro. Null si ya estaba. */
export function lecturaAlLeer(contactoId: ID, comentarios: Comentario[], lecturas: ChatLectura[], quien: string, nombre: string): ChatLectura | null {
  const hasta = ultimoDeOtro(comentarios.filter((c) => c.contactoId === contactoId), quien);
  if (!hasta || !quien) return null;
  const id = idDeLectura(contactoId, quien);
  const antes = lecturas.find((l) => l.id === id);
  if (antes && ms(antes.leidoHasta) >= ms(hasta)) return null;
  return { id, contactoId, quien, nombre, recibidoHasta: masTarde(antes?.recibidoHasta, hasta), leidoHasta: hasta };
}

/**
 * Lo que cambia cuando a esta app le llegan mensajes (al abrirla o en vivo): en cada ficha de cuyo chat es
 * parte, le llegó hasta el último mensaje de otro. Sólo en esas: en las demás el tilde no la espera.
 */
export function recibidosAlLlegar(comentarios: Comentario[], lecturas: ChatLectura[], quien: string, nombre: string): ChatLectura[] {
  if (!quien) return [];
  const porFicha = new Map<ID, Comentario[]>();
  for (const c of comentarios) porFicha.set(c.contactoId, [...(porFicha.get(c.contactoId) ?? []), c]);
  const lecturasDe = new Map<ID, ChatLectura[]>();
  for (const l of lecturas) lecturasDe.set(l.contactoId, [...(lecturasDe.get(l.contactoId) ?? []), l]);
  const cambios: ChatLectura[] = [];
  for (const [contactoId, cs] of porFicha) {
    const ls = lecturasDe.get(contactoId) ?? [];
    if (!participantes(cs, ls).has(quien)) continue;
    const hasta = ultimoDeOtro(cs, quien);
    if (!hasta) continue;
    const id = idDeLectura(contactoId, quien);
    const antes = ls.find((l) => l.id === id);
    if (antes && ms(antes.recibidoHasta) >= ms(hasta)) continue;
    cambios.push({ ...(antes ?? { id, contactoId, quien, nombre }), nombre: antes?.nombre || nombre, recibidoHasta: hasta });
  }
  return cambios;
}
