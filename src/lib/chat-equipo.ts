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

/** Lo que hace falta saber de una ficha para los tildes de TODOS sus mensajes: se arma una vez por chat, no por mensaje
    (con 2000 mensajes recorrer el chat entero por cada uno se notaba; stress test del 20/10). */
export interface ContextoEntrega {
  gente: Map<string, string>;
  /* El último mensaje de cada uno, en ms: si escribió después, lo vio. */
  ultimoDe: Map<string, number>;
  lecturaDe: Map<string, ChatLectura>;
}

export function contextoDeEntrega(comentarios: Comentario[], lecturas: ChatLectura[]): ContextoEntrega {
  const ultimoDe = new Map<string, number>();
  for (const c of comentarios) {
    const q = autorDe(c), t = ms(c.creadoEn);
    if (t > (ultimoDe.get(q) ?? Number.NEGATIVE_INFINITY)) ultimoDe.set(q, t);
  }
  return { gente: participantes(comentarios, lecturas), ultimoDe, lecturaDe: new Map(lecturas.map((l) => [l.quien, l] as const)) };
}

/** Los tildes de un mensaje propio, con el contexto de su ficha ya armado. */
export function entregaCon(c: Comentario, ctx: ContextoEntrega, cola: { pendiente: boolean; error: boolean } = { pendiente: false, error: false }): DetalleEntrega {
  if (cola.pendiente) return { estado: cola.error ? "sin-enviar" : "enviando", leyeron: [], recibieron: [], faltan: [] };
  const t = ms(c.creadoEn);
  const autor = autorDe(c);
  const reaccionaron = new Set((c.reacciones ?? []).map((r) => claveDe(r.email, r.quien)));
  const d: DetalleEntrega = { estado: "enviado", leyeron: [], recibieron: [], faltan: [] };
  let cuantos = 0;
  for (const [quien, nombre] of ctx.gente) {
    if (quien === autor) continue;
    cuantos++;
    const l = ctx.lecturaDe.get(quien);
    const leyo = ms(l?.leidoHasta) >= t || (ctx.ultimoDe.get(quien) ?? Number.NEGATIVE_INFINITY) > t || reaccionaron.has(quien);
    if (leyo) d.leyeron.push(nombre);
    else if (ms(l?.recibidoHasta) >= t) d.recibieron.push(nombre);
    else d.faltan.push(nombre);
  }
  if (cuantos > 0 && d.faltan.length === 0) d.estado = d.recibieron.length === 0 ? "leido" : "recibido";
  return d;
}

/**
 * Los tildes de un mensaje propio. `comentarios` y `lecturas` son los de su ficha.
 * Escribir otro mensaje después en esa ficha, o reaccionar a este, cuenta como leído: lo tuvo en pantalla.
 */
export function entregaDe(
  c: Comentario, comentarios: Comentario[], lecturas: ChatLectura[],
  cola: { pendiente: boolean; error: boolean } = { pendiente: false, error: false },
): DetalleEntrega {
  return entregaCon(c, contextoDeEntrega(comentarios, lecturas), cola);
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
  for (const c of comentarios) { const xs = porFicha.get(c.contactoId); if (xs) xs.push(c); else porFicha.set(c.contactoId, [c]); }
  const lecturasDe = new Map<ID, ChatLectura[]>();
  for (const l of lecturas) { const xs = lecturasDe.get(l.contactoId); if (xs) xs.push(l); else lecturasDe.set(l.contactoId, [l]); }
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

/* ---------- Las menciones (@Nombre) ----------
   Reunión del 21/10: «que se puedan arrobar entre ustedes». Al escribir «@» se elige a alguien del equipo y queda
   «@Nombre Apellido» en el texto; al mostrar el mensaje, esos nombres se resaltan. (Los avisos a quien mencionan van
   con el sistema de notificaciones, que Juan Cruz habla con Yari.) */

const sinTildesMencion = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** La mención que se está escribiendo justo antes del cursor («hola @li» → desde el «@», busca «li»), o null. */
export function mencionEnCurso(texto: string, cursor: number): { desde: number; busca: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}._-]{0,30})$/u.exec(texto.slice(0, cursor));
  return m ? { desde: cursor - m[2].length - 1, busca: m[2] } : null;
}

/** A quiénes ofrecer para una mención: los que empiezan con lo escrito primero, después los que lo contienen. */
export function candidatosDeMencion(nombres: readonly string[], busca: string, max = 6): string[] {
  const b = sinTildesMencion(busca.trim());
  const unicos = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  const empieza = unicos.filter((n) => sinTildesMencion(n).split(/\s+/).some((p) => p.startsWith(b)));
  const contiene = unicos.filter((n) => !empieza.includes(n) && sinTildesMencion(n).includes(b));
  return [...empieza, ...contiene].slice(0, max);
}

/** El texto con la mención en curso cambiada por «@Nombre » y dónde queda el cursor. */
export function ponerMencion(texto: string, desde: number, cursor: number, nombre: string): { texto: string; cursor: number } {
  const nuevo = `${texto.slice(0, desde)}@${nombre} ${texto.slice(cursor)}`;
  return { texto: nuevo, cursor: desde + nombre.length + 2 };
}

/** El texto en partes, con las menciones de gente del equipo marcadas (el nombre más largo gana: «@Ana María» antes que «@Ana»). */
export function partesConMenciones(texto: string, nombres: readonly string[]): { texto: string; mencion?: string }[] {
  const lista = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!lista.length || !texto.includes("@")) return [{ texto }];
  const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(${lista.map(escapar).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const out: { texto: string; mencion?: string }[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > 0 && !/\s|[(¿¡"']/.test(texto[i - 1])) continue;
    if (i > ultimo) out.push({ texto: texto.slice(ultimo, i) });
    const nombre = lista.find((n) => sinTildesMencion(n) === sinTildesMencion(m[1])) ?? m[1];
    out.push({ texto: m[0], mencion: nombre });
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) out.push({ texto: texto.slice(ultimo) });
  return out;
}
