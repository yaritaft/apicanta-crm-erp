import type { SupabaseClient } from "@supabase/supabase-js";
import { partirNombre } from "./contratos";
import { PRODUCTOS_WISBOO } from "./accesos-alumnos";
import { cambiarGrupoEnProgramas, type Programa } from "./programas";
import { idSeguimiento } from "./seguimiento";

/* ==================================================================
   El onboarding y el outboarding del Loom de Yari, del lado del servidor.

   darAccesos: al firmar el contrato (o a mano, desde la ficha) se le da al
   alumno lo de su programa:
   - Wisboo: se lo busca por mail (o se lo crea) y se le «regala» cada
     curso (el cobro va por otra pasarela). Un curso que ya tenía cuenta
     como dado.
   - Telegram: un bot no puede meter a nadie en un grupo por su número.
     Se genera un link de invitación de UN SOLO USO por grupo, con el nombre
     del alumno; cuando entra, el aviso del bot (api/telegram/webhook) anota
     su usuario, y con eso el outboarding lo puede sacar.
   - Zoom: se lo inscribe a cada reunión (hace falta el registro activado).
     Queda listo para cuando se cargue la app de Zoom.
   Cada acceso queda en `accesos_alumno` con lo que hace falta para sacarlo.
   Es idempotente: correrlo dos veces no da nada dos veces.

   quitarAccesos (outboarding, siempre a mano): todo o algo puntual. Wisboo
   no deja borrar al alumno por API: se le quita el acceso a cada curso.
   ================================================================== */

const ESPERA_MS = 15_000;

export interface Persona { nombre: string; email: string; telefono?: string }

export type Plataforma = "wisboo" | "telegram" | "zoom";
export type EstadoAcceso = "pendiente" | "dado" | "entro" | "fallo" | "quitado";

export interface Acceso {
  id: string; alumnoId: string; contratoId: string | null; programa: string;
  plataforma: Plataforma; recurso: string; recursoNombre: string; estado: EstadoAcceso;
  externo: Record<string, unknown>; error: string | null;
  dadoEn: string | null; quitadoEn: string | null; origen: "automatico" | "manual"; quien: string;
  creadoEn?: string; actualizadoEn?: string;
}

export const idDeAcceso = (alumnoId: string, plataforma: Plataforma, recurso: string) =>
  `acc_${alumnoId}_${plataforma}_${recurso}`.replace(/[^\w-]/g, "_").slice(0, 180);

async function pedir(url: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS) });
  const json = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: r.status, json };
}

/* Un error de red puede traer la dirección (la de Telegram lleva el token): hacia afuera, un texto propio. */
function textoDeFallo(servicio: string, e: unknown): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return `${servicio} no contestó a tiempo.`;
  return e instanceof ErrorAcceso ? e.message : `No se pudo hablar con ${servicio}.`;
}
class ErrorAcceso extends Error {}

/* ---------- Wisboo ---------- */

export const hayWisboo = () => Boolean(process.env.WISBOO_API_KEY && process.env.WISBOO_STORE_ID);
const wisbooBase = () => `https://api.wisboo.com/v1/stores/${encodeURIComponent(process.env.WISBOO_STORE_ID ?? "")}`;
const wisbooCabeza = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${process.env.WISBOO_API_KEY}`, "Content-Type": "application/json", ...extra });

async function usuarioWisboo(p: Persona): Promise<string> {
  const email = p.email.trim().toLowerCase();
  const busca = await pedir(`${wisbooBase()}/users?email=${encodeURIComponent(email)}&size=5`, { headers: wisbooCabeza() });
  if (busca.status === 401) throw new ErrorAcceso("Wisboo no acepta la clave.");
  const ya = (Array.isArray(busca.json?.data) ? busca.json!.data : []) as { id?: string; email?: string }[];
  const encontrado = ya.find((u) => (u.email ?? "").toLowerCase() === email);
  if (encontrado?.id) return encontrado.id;
  const { first_name, last_name } = partirNombre(p.nombre);
  const crea = await pedir(`${wisbooBase()}/users`, {
    method: "POST", headers: wisbooCabeza({ "X-Idempotency-Key": `apicanta-usuario-${email}` }),
    body: JSON.stringify({ email, name: first_name || p.nombre, last_name: last_name || "-", ...(p.telefono ? { phone: p.telefono } : {}) }),
  });
  const id = typeof crea.json?.id === "string" ? crea.json.id : null;
  if (!id) throw new ErrorAcceso(`Wisboo no creó el usuario (contestó ${crea.status}).`);
  return id;
}

async function accesoWisbooExistente(usuarioId: string, productoId: string): Promise<string | null> {
  const r = await pedir(`${wisbooBase()}/product_accesses?user_id[]=${encodeURIComponent(usuarioId)}&product_id[]=${encodeURIComponent(productoId)}&size=5`, { headers: wisbooCabeza() });
  const fila = (Array.isArray(r.json?.data) ? r.json!.data : [])[0] as { id?: string } | undefined;
  return fila?.id ?? null;
}

async function darCursoWisboo(usuarioId: string, productoId: string): Promise<{ accesoId: string | null; yaLoTenia: boolean }> {
  const r = await pedir(`${wisbooBase()}/product_accesses`, {
    method: "POST", headers: wisbooCabeza({ "X-Idempotency-Key": `apicanta-acceso-${usuarioId}-${productoId}` }),
    body: JSON.stringify({ user_id: usuarioId, product_id: productoId }),
  });
  if (typeof r.json?.id === "string") return { accesoId: r.json.id, yaLoTenia: false };
  /* 422 DUPLICATE_ERROR: ya lo tenía. Se busca su acceso para poder sacarlo después. */
  if (r.status === 422) return { accesoId: await accesoWisbooExistente(usuarioId, productoId), yaLoTenia: true };
  if (r.status === 404) throw new ErrorAcceso("Wisboo no encuentra ese curso.");
  throw new ErrorAcceso(`Wisboo no dio el acceso (contestó ${r.status}).`);
}

export async function linkMagicoWisboo(usuarioId: string): Promise<{ link: string; vence: string | null } | null> {
  if (!hayWisboo()) return null;
  try {
    const r = await pedir(`${wisbooBase()}/users/${encodeURIComponent(usuarioId)}/magic_links`, { method: "POST", headers: wisbooCabeza() });
    return typeof r.json?.link === "string" ? { link: r.json.link, vence: typeof r.json.expires_at === "string" ? r.json.expires_at : null } : null;
  } catch { return null; }
}

/* ---------- Telegram ---------- */

export const hayTelegram = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

type RespuestaTelegram = { ok: boolean; result?: unknown; description?: string; parameters?: { migrate_to_chat_id?: number } };

export async function telegram(metodo: string, cuerpo: Record<string, unknown> = {}): Promise<RespuestaTelegram> {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `Telegram contestó ${r.status}` }))) as RespuestaTelegram;
  return j;
}

export type ChatTelegram = { id: number | string; title?: string; type?: string };
export type MiembroTelegram = {
  status?: string; user?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
  can_invite_users?: boolean; can_restrict_members?: boolean;
};

/* Así contesta Telegram cuando el bot ya no está en el grupo o el grupo no existe más: se saca de la lista. */
const SIN_GRUPO = /chat not found|bot was kicked|bot is not a member|group chat was deactivated/i;

let idDelBot: number | null = null;
async function botId(): Promise<number | null> {
  if (idDelBot) return idDelBot;
  idDelBot = ((await telegram("getMe")).result as { id?: number } | undefined)?.id ?? null;
  return idDelBot;
}

/** Anota (o pone al día) un grupo donde está el bot, con sus permisos, para elegirlo en el programa. */
export async function anotarGrupoDeTelegram(db: SupabaseClient, chat: ChatTelegram, bot?: MiembroTelegram): Promise<"anotado" | "borrado" | "mudado" | "no es grupo" | "sin respuesta"> {
  if (chat.type !== "group" && chat.type !== "supergroup" && chat.type !== "channel") return "no es grupo";
  let m = bot;
  if (!m) {
    const id = await botId();
    if (!id) return "sin respuesta";
    const r = await telegram("getChatMember", { chat_id: chat.id, user_id: id });
    const nuevo = r.parameters?.migrate_to_chat_id;
    if (!r.ok && nuevo) {
      await mudarGrupoDeTelegram(db, String(chat.id), String(nuevo));
      await anotarGrupoDeTelegram(db, { id: nuevo, title: chat.title, type: "supergroup" });
      return "mudado";
    }
    if (!r.ok) {
      if (!SIN_GRUPO.test(r.description ?? "")) return "sin respuesta";
      await db.from("telegram_grupos").delete().eq("chatId", String(chat.id));
      return "borrado";
    }
    m = r.result as MiembroTelegram;
  }
  if (m?.status === "left" || m?.status === "kicked") {
    await db.from("telegram_grupos").delete().eq("chatId", String(chat.id));
    return "borrado";
  }
  const admin = m?.status === "administrator" || m?.status === "creator";
  await db.from("telegram_grupos").upsert({
    chatId: String(chat.id), titulo: chat.title ?? "", tipo: chat.type ?? "",
    botEsAdmin: admin, puedeInvitar: m?.status === "creator" || Boolean(admin && m?.can_invite_users),
    puedeExpulsar: m?.status === "creator" || Boolean(admin && m?.can_restrict_members), vistoEn: new Date().toISOString(),
  }, { onConflict: "chatId" });
  return "anotado";
}

/** Un grupo común que pasa a supergrupo cambia de id (Telegram lo hace solo, por ejemplo al hacer admin al bot):
    el id nuevo reemplaza al viejo en los programas y en los accesos ya dados, y el viejo sale de la lista. */
export async function mudarGrupoDeTelegram(db: SupabaseClient, viejo: string, nuevo: string): Promise<void> {
  if (viejo === nuevo) return;
  await db.from("telegram_grupos").delete().eq("chatId", viejo);
  await db.from("accesos_alumno").update({ recurso: nuevo, actualizadoEn: new Date().toISOString() })
    .eq("plataforma", "telegram").eq("recurso", viejo);
  const aj = await db.from("ajustes").select("programas").eq("id", 1).maybeSingle();
  const cambiados = cambiarGrupoEnProgramas(aj.data?.programas, viejo, nuevo);
  if (cambiados) await db.from("ajustes").update({ programas: cambiados }).eq("id", 1);
}

/** La pasada de cada hora: cada grupo anotado se vuelve a mirar (nombre, permisos, si pasó a supergrupo, si
    sacaron al bot). Devuelve un resumen para la respuesta del cron. */
export async function revisarGruposDeTelegram(db: SupabaseClient): Promise<string> {
  if (!hayTelegram()) return "sin bot";
  const r = await db.from("telegram_grupos").select('"chatId", titulo, tipo');
  if (r.error) return `no se pudo leer: ${r.error.message}`;
  const cuenta = new Map<string, number>();
  for (const g of (r.data ?? []) as { chatId: string; titulo: string; tipo: string }[]) {
    const c = await telegram("getChat", { chat_id: g.chatId });
    const chat: ChatTelegram = c.ok ? (c.result as ChatTelegram) : { id: g.chatId, title: g.titulo, type: g.tipo };
    const asi = await anotarGrupoDeTelegram(db, chat);
    cuenta.set(asi, (cuenta.get(asi) ?? 0) + 1);
  }
  return [...cuenta].map(([k, n]) => `${n} ${k}`).join(", ") || "sin grupos";
}

/* Telegram pide un nombre de link de hasta 32 caracteres. */
const nombreDeLink = (nombre: string) => nombre.trim().slice(0, 32) || "Alumno";

/* ---------- Zoom ---------- */

type RegistranteZoom = { id: string; email: string; joinUrl: string | null; estado: string };

/** La inscripción de una persona en la lista de Zoom: por su id si se sabe, si no por su mail. */
export function buscarRegistrante(lista: unknown, email: string, id: string | null): Omit<RegistranteZoom, "estado"> | null {
  const filas = Array.isArray(lista) ? (lista as Record<string, unknown>[]) : [];
  const mail = email.trim().toLowerCase();
  const x = filas.find((r) => (id && r.id === id) || (typeof r.email === "string" && r.email.trim().toLowerCase() === mail));
  return x && typeof x.id === "string" ? { id: x.id, email: String(x.email ?? ""), joinUrl: typeof x.join_url === "string" ? x.join_url : null } : null;
}

/** Busca su inscripción (aprobada, rechazada o pendiente) y, si no está aprobada, la vuelve a aprobar. null: no estaba. */
async function reactivarEnZoom(token: string, reunion: string, email: string, id: string | null): Promise<RegistranteZoom | null> {
  const cabeza = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  for (const estado of ["approved", "denied", "pending"]) {
    let pagina = "";
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const r = await pedir(`https://api.zoom.us/v2/meetings/${encodeURIComponent(reunion)}/registrants?status=${estado}&page_size=300${pagina ? `&next_page_token=${encodeURIComponent(pagina)}` : ""}`, { headers: cabeza });
      if (r.status >= 400) return null;
      const x = buscarRegistrante(r.json?.registrants, email, id);
      if (x) {
        if (estado !== "approved") {
          const ok = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(reunion)}/registrants/status`, {
            method: "PUT", headers: cabeza, body: JSON.stringify({ action: "approve", registrants: [{ id: x.id, email: x.email }] }),
            cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
          });
          if (!ok.ok) return null;
        }
        return { ...x, estado };
      }
      pagina = typeof r.json?.next_page_token === "string" ? r.json.next_page_token : "";
      if (!pagina) break;
    }
  }
  return null;
}

/** Por qué Zoom no inscribió a alguien, en castellano. 429 es su límite diario: no deja inscribir (ni volver a inscribir)
    muchas veces por día a la misma persona en la misma reunión. */
export function motivoZoom(status: number, json: Record<string, unknown> | null): string {
  if (status === 429) return "Zoom no deja inscribir otra vez a la misma persona en esta reunión hoy (es su límite por día). Reintentá mañana.";
  if (status === 404) return "Zoom no encuentra la reunión: ¿la borraron? Revisá el programa en Ajustes.";
  const msj = typeof json?.message === "string" ? json.message : "";
  if (/registration/i.test(msj)) return "La reunión no tiene la inscripción activada en Zoom: activale «Registro».";
  return `Zoom no lo inscribió (contestó ${status}${msj ? `: ${msj}` : ""}).`;
}

export const hayZoom = () => Boolean(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);

async function tokenZoom(): Promise<string> {
  const basico = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const r = await pedir(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID ?? "")}`, {
    method: "POST", headers: { Authorization: `Basic ${basico}` },
  });
  const t = r.json?.access_token;
  if (typeof t !== "string" || !t) throw new ErrorAcceso("Zoom no acepta las credenciales de la app.");
  return t;
}

/* ---------- Dar ---------- */

export interface ResultadoAccesos {
  dados: number; fallaron: number; yaEstaban: number;
  accesos: Acceso[];
  /* Los links de Telegram y el de Wisboo, para mandarle al alumno. */
  links: { plataforma: Plataforma; nombre: string; url: string }[];
}

/** Da los accesos del programa. `nombres` traduce ids a nombres legibles (grupos y reuniones). */
export async function darAccesos(db: SupabaseClient, a: {
  alumnoId: string; persona: Persona; programa: Programa; contratoId?: string | null;
  origen: "automatico" | "manual"; quien: string;
  /* Sólo algunos (un reintento puntual). Sin esto, todos los del programa. */
  solo?: { plataforma: Plataforma; recurso: string }[];
}): Promise<ResultadoAccesos> {
  const ahora = new Date().toISOString();
  const previos = await accesosDe(db, a.alumnoId);
  const previo = (pl: Plataforma, rec: string) => previos.find((x) => x.plataforma === pl && x.recurso === rec);
  const quiere = (pl: Plataforma, rec: string) => !a.solo || a.solo.some((s) => s.plataforma === pl && s.recurso === rec);
  const salida: ResultadoAccesos = { dados: 0, fallaron: 0, yaEstaban: 0, accesos: [], links: [] };
  const grupos = await nombresDeGrupos(db);

  const anotar = async (x: Omit<Acceso, "id" | "alumnoId" | "contratoId" | "programa" | "origen" | "quien">) => {
    const fila: Acceso = {
      id: idDeAcceso(a.alumnoId, x.plataforma, x.recurso), alumnoId: a.alumnoId, contratoId: a.contratoId ?? null,
      programa: a.programa.id, origen: a.origen, quien: a.quien, ...x,
    };
    await db.from("accesos_alumno").upsert({ ...fila, actualizadoEn: new Date().toISOString() }, { onConflict: "id" });
    salida.accesos.push(fila);
    if (x.estado === "fallo") salida.fallaron++;
    else salida.dados++;
  };

  /* Wisboo: un usuario, un acceso por curso. */
  const cursos = a.programa.wisboo.filter((p) => quiere("wisboo", p));
  if (cursos.length) {
    let usuarioId: string | null = null;
    let errorUsuario: string | null = null;
    if (!hayWisboo()) errorUsuario = "Falta la clave de Wisboo en Vercel.";
    else {
      try { usuarioId = await usuarioWisboo(a.persona); } catch (e) { errorUsuario = textoDeFallo("Wisboo", e); }
    }
    for (const producto of cursos) {
      const nombre = PRODUCTOS_WISBOO.find((p) => p.id === producto)?.nombre ?? producto;
      const ya = previo("wisboo", producto);
      if (ya && (ya.estado === "dado" || ya.estado === "entro")) { salida.yaEstaban++; salida.accesos.push(ya); continue; }
      if (!usuarioId) { await anotar({ plataforma: "wisboo", recurso: producto, recursoNombre: nombre, estado: "fallo", externo: {}, error: errorUsuario, dadoEn: null, quitadoEn: null }); continue; }
      try {
        const r = await darCursoWisboo(usuarioId, producto);
        await anotar({
          plataforma: "wisboo", recurso: producto, recursoNombre: nombre, estado: "dado",
          externo: { usuarioId, accesoId: r.accesoId, yaLoTenia: r.yaLoTenia }, error: null, dadoEn: ahora, quitadoEn: null,
        });
      } catch (e) {
        await anotar({ plataforma: "wisboo", recurso: producto, recursoNombre: nombre, estado: "fallo", externo: { usuarioId }, error: textoDeFallo("Wisboo", e), dadoEn: null, quitadoEn: null });
      }
    }
    if (usuarioId) {
      const magico = await linkMagicoWisboo(usuarioId);
      if (magico) salida.links.push({ plataforma: "wisboo", nombre: "Wisboo (entrar a los cursos)", url: magico.link });
    }
  }

  /* Telegram: un link de un solo uso por grupo. */
  for (const chat of a.programa.telegram.filter((c) => quiere("telegram", c))) {
    const nombre = grupos.get(chat) ?? chat;
    const ya = previo("telegram", chat);
    if (ya && (ya.estado === "dado" || ya.estado === "entro")) {
      salida.yaEstaban++; salida.accesos.push(ya);
      const link = typeof ya.externo.link === "string" ? ya.externo.link : null;
      if (link && ya.estado === "dado") salida.links.push({ plataforma: "telegram", nombre, url: link });
      continue;
    }
    if (!hayTelegram()) { await anotar({ plataforma: "telegram", recurso: chat, recursoNombre: nombre, estado: "fallo", externo: {}, error: "Falta el token del bot de Telegram en Vercel.", dadoEn: null, quitadoEn: null }); continue; }
    try {
      const r = await telegram("createChatInviteLink", {
        chat_id: chat, name: nombreDeLink(a.persona.nombre), member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      });
      const link = (r.result as { invite_link?: string } | undefined)?.invite_link;
      if (!r.ok || !link) throw new ErrorAcceso(`Telegram no dio el link: ${r.description ?? "sin motivo"}. ¿El bot es administrador del grupo con permiso para invitar?`);
      await anotar({ plataforma: "telegram", recurso: chat, recursoNombre: nombre, estado: "dado", externo: { link }, error: null, dadoEn: ahora, quitadoEn: null });
      salida.links.push({ plataforma: "telegram", nombre, url: link });
    } catch (e) {
      await anotar({ plataforma: "telegram", recurso: chat, recursoNombre: nombre, estado: "fallo", externo: {}, error: textoDeFallo("Telegram", e), dadoEn: null, quitadoEn: null });
    }
  }

  /* Zoom: una inscripción por reunión. */
  const reuniones = a.programa.zoom.filter((m) => quiere("zoom", m));
  if (reuniones.length) {
    let token: string | null = null;
    let errorToken: string | null = hayZoom() ? null : "Falta conectar Zoom (la app Server-to-Server OAuth).";
    if (!errorToken) { try { token = await tokenZoom(); } catch (e) { errorToken = textoDeFallo("Zoom", e); } }
    const { first_name, last_name } = partirNombre(a.persona.nombre);
    for (const reunion of reuniones) {
      const ya = previo("zoom", reunion);
      if (ya && (ya.estado === "dado" || ya.estado === "entro")) {
        salida.yaEstaban++; salida.accesos.push(ya);
        if (typeof ya.externo.joinUrl === "string") salida.links.push({ plataforma: "zoom", nombre: ya.recursoNombre, url: ya.externo.joinUrl });
        continue;
      }
      /* Si falla, la fila conserva el nombre de la reunión y la inscripción que ya tenía (para reactivarla después). */
      const nombreReunion = ya?.recursoNombre || reunion;
      const externoPrevio = ya?.externo ?? {};
      if (!token) { await anotar({ plataforma: "zoom", recurso: reunion, recursoNombre: nombreReunion, estado: "fallo", externo: externoPrevio, error: errorToken, dadoEn: null, quitadoEn: null }); continue; }
      /* Ya estuvo inscripto (se le quitó, o falló): se reactiva su inscripción en vez de crear otra. Zoom deja crear sólo
         3 por día para la misma persona en la misma reunión, y reactivar no cuenta. */
      if (ya) {
        const re = await reactivarEnZoom(token, reunion, a.persona.email, typeof externoPrevio.registranteId === "string" ? externoPrevio.registranteId : null).catch(() => null);
        if (re) {
          await anotar({ plataforma: "zoom", recurso: reunion, recursoNombre: nombreReunion, estado: "dado", externo: { registranteId: re.id, joinUrl: re.joinUrl }, error: null, dadoEn: ahora, quitadoEn: null });
          if (re.joinUrl) salida.links.push({ plataforma: "zoom", nombre: nombreReunion, url: re.joinUrl });
          continue;
        }
      }
      try {
        const r = await pedir(`https://api.zoom.us/v2/meetings/${encodeURIComponent(reunion)}/registrants`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ email: a.persona.email.trim(), first_name: first_name || a.persona.nombre, last_name: last_name || "-", auto_approve: true }),
        });
        const registrante = r.json?.registrant_id;
        if (typeof registrante !== "string") throw new ErrorAcceso(motivoZoom(r.status, r.json));
        const tema = typeof r.json?.topic === "string" ? r.json.topic : reunion;
        await anotar({ plataforma: "zoom", recurso: reunion, recursoNombre: tema, estado: "dado", externo: { registranteId: registrante, joinUrl: r.json?.join_url ?? null }, error: null, dadoEn: ahora, quitadoEn: null });
        if (typeof r.json?.join_url === "string") salida.links.push({ plataforma: "zoom", nombre: tema, url: r.json.join_url });
      } catch (e) {
        await anotar({ plataforma: "zoom", recurso: reunion, recursoNombre: nombreReunion, estado: "fallo", externo: externoPrevio, error: textoDeFallo("Zoom", e), dadoEn: null, quitadoEn: null });
      }
    }
  }
  await marcarEnLaFicha(db, a.alumnoId);
  return salida;
}

/* ---------- Quitar ---------- */

/** Saca los accesos pedidos (o todos los que tiene). Lo que no se pudo sacar queda como estaba, con el error. */
export async function quitarAccesos(db: SupabaseClient, a: {
  alumnoId: string; ids?: string[]; quien: string;
}): Promise<{ quitados: number; fallaron: number; accesos: Acceso[] }> {
  const todos = await accesosDe(db, a.alumnoId);
  const elegidos = todos.filter((x) => (a.ids ? a.ids.includes(x.id) : true) && x.estado !== "quitado");
  const salida = { quitados: 0, fallaron: 0, accesos: [] as Acceso[] };
  let tokenZ: string | null = null;
  for (const x of elegidos) {
    let error: string | null = null;
    try {
      if (x.plataforma === "wisboo") {
        const accesoId = typeof x.externo.accesoId === "string" ? x.externo.accesoId : null;
        if (x.estado === "fallo" || !accesoId) { /* Nunca se dio: no hay nada que sacar en Wisboo. */ }
        else {
          if (!hayWisboo()) throw new ErrorAcceso("Falta la clave de Wisboo en Vercel.");
          const r = await fetch(`${wisbooBase()}/product_accesses/${encodeURIComponent(accesoId)}`, {
            method: "DELETE", headers: wisbooCabeza(), cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
          });
          if (!r.ok && r.status !== 404) throw new ErrorAcceso(`Wisboo no quitó el acceso (contestó ${r.status}).`);
        }
      } else if (x.plataforma === "telegram") {
        if (!hayTelegram()) throw new ErrorAcceso("Falta el token del bot de Telegram en Vercel.");
        const link = typeof x.externo.link === "string" ? x.externo.link : null;
        const usuario = typeof x.externo.telegramUserId === "number" || typeof x.externo.telegramUserId === "string" ? x.externo.telegramUserId : null;
        if (link) await telegram("revokeChatInviteLink", { chat_id: x.recurso, invite_link: link });
        if (usuario) {
          /* Expulsar = banear y desbanear: sale del grupo y puede volver con otro link si algún día vuelve. */
          const b = await telegram("banChatMember", { chat_id: x.recurso, user_id: usuario, revoke_messages: false });
          if (!b.ok) throw new ErrorAcceso(`Telegram no lo sacó del grupo: ${b.description ?? "sin motivo"}.`);
          await telegram("unbanChatMember", { chat_id: x.recurso, user_id: usuario, only_if_banned: true });
        } else if (x.estado === "entro") {
          throw new ErrorAcceso("No se sabe su usuario de Telegram: sacalo a mano del grupo.");
        }
      } else if (x.plataforma === "zoom") {
        const registrante = typeof x.externo.registranteId === "string" ? x.externo.registranteId : null;
        if (registrante) {
          if (!hayZoom()) throw new ErrorAcceso("Falta conectar Zoom.");
          tokenZ ??= await tokenZoom();
          const r = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(x.recurso)}/registrants/status`, {
            method: "PUT", headers: { Authorization: `Bearer ${tokenZ}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "cancel", registrants: [{ id: registrante }] }), cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
          });
          if (!r.ok) throw new ErrorAcceso(`Zoom no canceló la inscripción (contestó ${r.status}).`);
        }
      }
    } catch (e) { error = textoDeFallo(x.plataforma === "wisboo" ? "Wisboo" : x.plataforma === "telegram" ? "Telegram" : "Zoom", e); }
    const cambio = error
      ? { error, actualizadoEn: new Date().toISOString() }
      : { estado: "quitado" as const, quitadoEn: new Date().toISOString(), error: null, quien: a.quien, actualizadoEn: new Date().toISOString() };
    await db.from("accesos_alumno").update(cambio).eq("id", x.id);
    salida.accesos.push({ ...x, ...cambio } as Acceso);
    if (error) salida.fallaron++; else salida.quitados++;
  }
  await marcarEnLaFicha(db, a.alumnoId);
  return salida;
}

/* ---------- La ficha de Customer Success ---------- */

/** Lo que hizo la app queda también en las marcas de la ficha (las del Airtable de Lili): «Acceso» (Completos, Downsell o
    Sin acceso) y las casillas de Wisboo y Zoom. Así nadie ve «Falta» en un alumno que ya tiene todo. */
export async function marcarEnLaFicha(db: SupabaseClient, alumnoId: string): Promise<void> {
  try { await cambiarFicha(db, alumnoId, marcasDeLaFicha(await accesosDe(db, alumnoId))); }
  catch (e) { console.error("[accesos] no se marcó la ficha", alumnoId, e instanceof Error ? e.message : String(e)); }
}

/** Cambia la ficha de Customer Success del alumno y, si todavía no tenía (un alumno recién vendido), la crea con el mismo id
    que le da la app (seg_<alumno>): el resto de la ficha nace vacío, con los valores por defecto de la tabla. */
export async function cambiarFicha(db: SupabaseClient, alumnoId: string, cambios: Record<string, unknown>): Promise<void> {
  const r = await db.from("seguimiento_alumnos").update(cambios).eq("alumnoId", alumnoId).select("id");
  if (r.error) throw new Error(r.error.message);
  if ((r.data ?? []).length > 0) return;
  const n = await db.from("seguimiento_alumnos").insert({ id: idSeguimiento(alumnoId), alumnoId, ...cambios, actualizadoPor: "Apicanta" });
  if (n.error && !/duplicate key/i.test(n.error.message)) throw new Error(n.error.message);
}

export function marcasDeLaFicha(accesos: Pick<Acceso, "plataforma" | "estado" | "programa">[]): { acceso: string; accesoWibo: boolean; accesoZoom: boolean } {
  const vigentes = accesos.filter((x) => x.estado === "dado" || x.estado === "entro");
  return {
    acceso: vigentes.length === 0 ? "Sin acceso" : vigentes.every((x) => x.programa === "downsell") ? "Downsell" : "Completos",
    accesoWibo: vigentes.some((x) => x.plataforma === "wisboo"),
    accesoZoom: vigentes.some((x) => x.plataforma === "zoom"),
  };
}

/* ---------- Lectura ---------- */

export async function accesosDe(db: SupabaseClient, alumnoId: string): Promise<Acceso[]> {
  const r = await db.from("accesos_alumno").select("*").eq("alumnoId", alumnoId);
  return (r.data ?? []) as Acceso[];
}

async function nombresDeGrupos(db: SupabaseClient): Promise<Map<string, string>> {
  const r = await db.from("telegram_grupos").select('"chatId", titulo');
  return new Map(((r.data ?? []) as { chatId: string; titulo: string }[]).map((g) => [g.chatId, g.titulo || g.chatId]));
}

/* El mensaje para WhatsApp vive en accesos-alumnos.ts (también lo arma la ficha). */
export { mensajeDeBienvenida } from "./accesos-alumnos";
