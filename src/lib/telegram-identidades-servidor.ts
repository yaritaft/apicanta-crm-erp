import type { SupabaseClient } from "@supabase/supabase-js";
import { idDeAcceso, telegram as telegramReal } from "./accesos-servidor";
import { programasGuardados } from "./contratos-servidor";
import { programaDeProducto, type Programa } from "./programas";
import { alumnoDeCodigo, codigoDeAlumno } from "./reporte-servidor";
import {
  BOTON_COMPARTIR, BOTON_DEL_ANUNCIO, TEXTOS_DEL_BOT, TEXTO_DEL_ANUNCIO, buscarPorTelefono, claveDeContacto, elUnicoActivo, enlaceDelBot,
  leerInicio, nombreEnTelegram, telefonosDeFila, type EntroPor, type FilaDeTelefonos, type PersonaTelegram, type PosibleTelegram,
  type TelefonosDeAlumno, type VinculoTelegram,
} from "./telegram-identidades";

/* ==================================================================
   Quién es quién en Telegram, del lado del servidor (Manu, 20/11).

   El bot (api/telegram/webhook) guarda en `telegram_personas` a cada cuenta
   que ve, y la ata a un alumno cuando sabe quién es:
   - entró a un grupo con el link personal que generó la app (ya se hacía);
   - tocó su link del bot (trae el código del alumno, el mismo del reporte
     semanal) o el link general y compartió su número: Telegram verifica
     que es el de esa cuenta y acá se cruza con los teléfonos de las fichas;
   - lo ató a mano alguien del equipo desde la ficha del alumno.
   Al atarla, sus grupos pasan a `accesos_alumno` (estado «entró», con su id):
   con eso «Quitar» y el outboarding automático la sacan como a cualquiera,
   también a los alumnos de antes de la app.

   Nada de esto escribe en la ficha de Customer Success (marcas del Airtable).
   ================================================================== */

export interface RespuestaDeTelegram { ok: boolean; result?: unknown; description?: string }
export type LlamarTelegram = (metodo: string, cuerpo?: Record<string, unknown>) => Promise<RespuestaDeTelegram>;
/** Un usuario tal como lo manda Telegram. */
export interface UsuarioTelegram { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }

/* Cuentas que no son personas: Telegram mismo, los admins anónimos de un grupo y los canales. */
const NO_SON_PERSONAS = new Set([777000, 1087968824, 136817688]);

/* Cada cuánto se vuelve a anotar que alguien sigue en el mismo grupo (cada mensaje llega al aviso: no se escribe cada vez). */
const CADA_CUANTO_MS = 6 * 3600_000;
const vistas = new Map<string, number>();
/** Sólo para las pruebas. */
export const olvidarVistas = (): void => { vistas.clear(); };

const iso = (d: Date) => d.toISOString();

/* ---------- Lectura ---------- */

export async function leerPersona(db: SupabaseClient, id: string): Promise<PersonaTelegram | null> {
  const r = await db.from("telegram_personas").select("*").eq("id", id).maybeSingle();
  return (r.data as PersonaTelegram | null) ?? null;
}

/* ---------- Ver a alguien ---------- */

/** Anota que el bot vio a esta cuenta: en un grupo (escribió, entró, salió) o en su chat. Crea la fila si es nueva; si ya existía, sólo
    pone al día su nombre, su @usuario y los grupos donde está. La primera vez en un grupo mira si es administrador (no es alumno). */
export async function verPersona(
  db: SupabaseClient, tg: LlamarTelegram, u: UsuarioTelegram,
  o: { chatId?: string; adentro?: boolean; entroPor?: EntroPor; esAdmin?: boolean; ahora?: Date } = {},
): Promise<void> {
  if (u.is_bot || NO_SON_PERSONAS.has(u.id)) return;
  const ahora = o.ahora ?? new Date();
  const adentro = o.adentro ?? true;
  const clave = `${u.id}:${o.chatId ?? ""}:${adentro}`;
  if (o.chatId && ahora.getTime() - (vistas.get(clave) ?? 0) < CADA_CUANTO_MS) return;

  const id = String(u.id);
  const previa = await leerPersona(db, id);
  const grupos = { ...(previa?.grupos ?? {}) };
  if (o.chatId) { if (adentro) grupos[o.chatId] = iso(ahora); else delete grupos[o.chatId]; }
  let equipo = previa?.equipo ?? o.esAdmin ?? false;
  if (o.esAdmin) equipo = true;
  else if (!previa && o.chatId && adentro) {
    const m = await tg("getChatMember", { chat_id: o.chatId, user_id: u.id }).catch(() => null);
    const estado = (m?.result as { status?: string } | undefined)?.status;
    equipo = estado === "creator" || estado === "administrator";
  }
  const fila: Record<string, unknown> = {
    id, usuario: u.username ?? previa?.usuario ?? null, nombre: nombreEnTelegram(u) || previa?.nombre || "", grupos, equipo, ultimoVisto: iso(ahora),
  };
  if (!previa) { fila.entroPor = o.entroPor ?? (o.chatId ? "mensaje" : "bot"); fila.primerVisto = iso(ahora); }
  const r = await db.from("telegram_personas").upsert(fila, { onConflict: "id" });
  if (r.error) throw new Error(`telegram_personas: ${r.error.message}`);
  if (o.chatId) vistas.set(clave, ahora.getTime());
}

/** Entró a un grupo con el link personal de un alumno (lo que ya anotaba el aviso): queda atada a ese alumno si todavía no lo estaba. */
export async function anotarEntradaPorLink(
  db: SupabaseClient, tg: LlamarTelegram, u: UsuarioTelegram, chatId: string, alumnoId: string, ahora = new Date(),
): Promise<void> {
  if (u.is_bot) return;
  await verPersona(db, tg, u, { chatId, adentro: true, entroPor: "link", ahora });
  const p = await leerPersona(db, String(u.id));
  if (!p) return;
  /* Entró con un link de alumno: no es del equipo, y si alguien lo había visto antes escribiendo, ahora se sabe cómo entró. */
  const cambios: Record<string, unknown> = { entroPor: "link", equipo: false };
  if (!p.alumnoId) Object.assign(cambios, { alumnoId, vinculo: "link", posibles: [], vinculadoEn: iso(ahora), vinculadoPor: "Link personal" });
  await db.from("telegram_personas").update(cambios).eq("id", p.id);
}

/* ---------- Atar y desatar ---------- */

/** Los grupos donde está el bot y que puede mirar. */
async function gruposDelBot(db: SupabaseClient): Promise<{ chatId: string; titulo: string }[]> {
  const r = await db.from("telegram_grupos").select('"chatId", titulo, "botEsAdmin"');
  return ((r.data ?? []) as { chatId: string; titulo: string; botEsAdmin: boolean }[]).filter((g) => g.botEsAdmin).map((g) => ({ chatId: g.chatId, titulo: g.titulo || g.chatId }));
}

/** El programa con el que queda anotado el grupo de un alumno que ya estaba adentro: el suyo si ese grupo es de su programa; si no, el único (o el
    primero) que lo tenga. Sólo importa para el Downsell de la ficha: el resto de la app no mira de qué programa viene un acceso de Telegram. */
export function programaDelGrupo(programas: readonly Programa[], delAlumno: Programa | null, chatId: string): string {
  const candidatos = programas.filter((p) => p.telegram.includes(chatId));
  if (delAlumno && candidatos.some((p) => p.id === delAlumno.id)) return delAlumno.id;
  return candidatos[0]?.id ?? delAlumno?.id ?? "";
}

/** Ata una cuenta a un alumno y deja en `accesos_alumno` cada grupo donde está (con su id): desde ahí «Quitar», «Quitar todo» y el outboarding
    automático la sacan. No toca la ficha de Customer Success. Devuelve los grupos donde la encontró. */
export async function atarPersona(
  db: SupabaseClient, tg: LlamarTelegram,
  a: { personaId: string; alumnoId: string; vinculo: VinculoTelegram; quien: string; ahora?: Date },
): Promise<{ grupos: { chatId: string; titulo: string }[] }> {
  const ahora = a.ahora ?? new Date();
  const persona = await leerPersona(db, a.personaId);
  if (!persona) throw new Error("No encuentro esa cuenta de Telegram.");
  const alumno = (await db.from("alumnos").select("id, ventaId").eq("id", a.alumnoId).maybeSingle()).data as { id: string; ventaId: string | null } | null;
  if (!alumno) throw new Error("No encuentro a ese alumno.");

  const grupos = await gruposDelBot(db);
  const dentro: { chatId: string; titulo: string }[] = [];
  const dondeEsta = { ...persona.grupos };
  for (const g of grupos) {
    let esta = persona.grupos[g.chatId] !== undefined;
    if (!esta) {
      const r = await tg("getChatMember", { chat_id: g.chatId, user_id: Number(persona.id) }).catch(() => null);
      const estado = (r?.result as { status?: string } | undefined)?.status;
      esta = Boolean(r?.ok) && (estado === "member" || estado === "restricted");
      if (esta) dondeEsta[g.chatId] = iso(ahora);
    }
    if (esta) dentro.push(g);
  }

  const { programas } = await programasGuardados(db);
  const productoId = alumno.ventaId ? ((await db.from("ventas").select("productoId").eq("id", alumno.ventaId).maybeSingle()).data as { productoId?: string | null } | null)?.productoId : null;
  const delAlumno = programaDeProducto(programas, productoId);
  const previas = ((await db.from("accesos_alumno").select("*").eq("alumnoId", alumno.id).eq("plataforma", "telegram")).data ?? []) as {
    id: string; recurso: string; estado: string; externo: Record<string, unknown>;
  }[];

  for (const g of dentro) {
    const externo = { telegramUserId: Number(persona.id), telegramUsuario: persona.usuario, identificado: a.vinculo };
    const previa = previas.find((x) => x.recurso === g.chatId);
    if (previa) {
      if (previa.estado === "entro" && String(previa.externo?.telegramUserId ?? "") === persona.id) continue;
      await db.from("accesos_alumno").update({
        estado: "entro", externo: { ...previa.externo, ...externo }, error: null, quitadoEn: null, actualizadoEn: iso(ahora),
      }).eq("id", previa.id);
    } else {
      await db.from("accesos_alumno").upsert({
        id: idDeAcceso(alumno.id, "telegram", g.chatId), alumnoId: alumno.id, contratoId: null, programa: programaDelGrupo(programas, delAlumno, g.chatId),
        plataforma: "telegram", recurso: g.chatId, recursoNombre: g.titulo, estado: "entro", externo: { ...externo, creadoPorIdentificacion: true },
        error: null, dadoEn: iso(ahora), quitadoEn: null, origen: "manual", quien: `Identificación de Telegram${a.quien ? ` (${a.quien})` : ""}`,
        actualizadoEn: iso(ahora),
      }, { onConflict: "id" });
    }
  }

  const r = await db.from("telegram_personas").update({
    alumnoId: alumno.id, vinculo: a.vinculo, posibles: [], equipo: false, grupos: dondeEsta, vinculadoEn: iso(ahora), vinculadoPor: a.quien,
  }).eq("id", persona.id);
  if (r.error) throw new Error(`telegram_personas: ${r.error.message}`);
  return { grupos: dentro };
}

/** Desata una cuenta de su alumno (se ató a la persona equivocada). Los accesos que se crearon al atarla se borran; los que ya existían
    pierden el id de Telegram, para que «Quitar» no saque a la cuenta equivocada. */
export async function desatarPersona(db: SupabaseClient, personaId: string): Promise<void> {
  const persona = await leerPersona(db, personaId);
  if (!persona) throw new Error("No encuentro esa cuenta de Telegram.");
  if (persona.alumnoId) {
    const filas = ((await db.from("accesos_alumno").select("id, estado, externo").eq("alumnoId", persona.alumnoId).eq("plataforma", "telegram")).data ?? []) as {
      id: string; estado: string; externo: Record<string, unknown>;
    }[];
    for (const f of filas) {
      if (String(f.externo?.telegramUserId ?? "") !== persona.id) continue;
      if (f.externo.creadoPorIdentificacion) { await db.from("accesos_alumno").delete().eq("id", f.id); continue; }
      const resto = { ...f.externo };
      for (const k of ["telegramUserId", "telegramUsuario", "identificado"]) delete resto[k];
      await db.from("accesos_alumno").update({
        externo: resto, estado: f.estado === "entro" && typeof resto.link === "string" ? "dado" : f.estado, actualizadoEn: new Date().toISOString(),
      }).eq("id", f.id);
    }
  }
  const r = await db.from("telegram_personas").update({ alumnoId: null, vinculo: null, vinculadoEn: null, vinculadoPor: null }).eq("id", persona.id);
  if (r.error) throw new Error(`telegram_personas: ${r.error.message}`);
}

/* ---------- Los teléfonos de los alumnos ---------- */

let telefonosEnMemoria: { en: number; alumnos: TelefonosDeAlumno[] } | null = null;
const MEMORIA_MS = 5 * 60_000;
/** Sólo para las pruebas. */
export const olvidarTelefonos = (): void => { telefonosEnMemoria = null; };

/** Los teléfonos de todos los alumnos, normalizados (la función `telefonos_de_alumnos()`), guardados 5 minutos: una campaña trae cientos de avisos seguidos. */
export async function telefonosDeAlumnos(db: SupabaseClient, ahora = Date.now()): Promise<TelefonosDeAlumno[]> {
  if (telefonosEnMemoria && ahora - telefonosEnMemoria.en < MEMORIA_MS) return telefonosEnMemoria.alumnos;
  const filas: FilaDeTelefonos[] = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    const r = await db.rpc("telefonos_de_alumnos").range(desde, desde + 999);
    if (r.error) throw new Error(`telefonos_de_alumnos: ${r.error.message}`);
    const parte = (r.data ?? []) as FilaDeTelefonos[];
    filas.push(...parte);
    if (parte.length < 1000) break;
  }
  const alumnos = filas.map(telefonosDeFila);
  telefonosEnMemoria = { en: ahora, alumnos };
  return alumnos;
}

/* ---------- El chat del bot ---------- */

export interface MensajeDelBot {
  chat: { id: number; type?: string };
  from?: UsuarioTelegram;
  text?: string;
  contact?: { phone_number: string; user_id?: number; first_name?: string; last_name?: string };
}

const TECLADO_DEL_NUMERO = { keyboard: [[{ text: BOTON_COMPARTIR, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

export type Resultado = "ignorado" | "pedir" | "ayuda" | "codigo" | "codigo-malo" | "ya" | "ajeno" | "telefono" | "revisar" | "no-encontrado";

/** Lo que alguien le escribe al bot en su chat: «/start» (con su código, o sin él), o el número que comparte. */
export async function atenderPrivado(
  db: SupabaseClient, tg: LlamarTelegram, m: MensajeDelBot,
  o: { ahora?: Date; telefonos?: () => Promise<TelefonosDeAlumno[]> } = {},
): Promise<Resultado> {
  const u = m.from;
  if (!u || u.is_bot || NO_SON_PERSONAS.has(u.id)) return "ignorado";
  const ahora = o.ahora ?? new Date();
  const id = String(u.id);
  const responder = async (texto: string, teclado: "numero" | "quitar") => {
    await tg("sendMessage", {
      chat_id: m.chat.id, text: texto, reply_markup: teclado === "numero" ? TECLADO_DEL_NUMERO : { remove_keyboard: true },
    }).catch(() => null);
  };
  const nombreDe = async (alumnoId: string | null | undefined): Promise<string> =>
    alumnoId ? (((await db.from("alumnos").select("nombre").eq("id", alumnoId).maybeSingle()).data as { nombre?: string } | null)?.nombre ?? "") : "";

  await verPersona(db, tg, u, { adentro: true, entroPor: "bot", ahora });
  const persona = await leerPersona(db, id);

  /* Compartió su número. */
  if (m.contact) {
    if (m.contact.user_id !== u.id) { await responder(TEXTOS_DEL_BOT.contactoAjeno, "numero"); return "ajeno"; }
    const clave = claveDeContacto(m.contact.phone_number) ?? m.contact.phone_number.replace(/\D/g, "");
    await db.from("telegram_personas").update({ telefono: clave }).eq("id", id);
    if (persona?.alumnoId) { await responder(TEXTOS_DEL_BOT.yaEstaba(await nombreDe(persona.alumnoId)), "quitar"); return "ya"; }
    const { exactos, aproximados } = buscarPorTelefono(m.contact.phone_number, await (o.telefonos ?? (() => telefonosDeAlumnos(db)))());
    const unico = exactos.length === 1 ? exactos[0] : exactos.length > 1 ? elUnicoActivo(exactos) : null;
    if (unico) {
      await atarPersona(db, tg, { personaId: id, alumnoId: unico.alumnoId, vinculo: "telefono", quien: "Bot de Telegram (número compartido)", ahora });
      await responder(TEXTOS_DEL_BOT.listo(unico.nombre), "quitar");
      return "telefono";
    }
    const posibles: PosibleTelegram[] = [
      ...exactos.map((x) => ({ alumnoId: x.alumnoId, motivo: "varios" as const })),
      ...aproximados.slice(0, 5).map((x) => ({ alumnoId: x.alumnoId, motivo: "ultimos-digitos" as const })),
    ];
    await db.from("telegram_personas").update({ posibles }).eq("id", id);
    await responder(posibles.length ? TEXTOS_DEL_BOT.revisar : TEXTOS_DEL_BOT.noEncontrado, "quitar");
    return posibles.length ? "revisar" : "no-encontrado";
  }

  const inicio = leerInicio(m.text);
  if (inicio.esInicio) {
    /* Su link personal: trae el código del alumno (el mismo del reporte semanal). */
    if (inicio.codigo) {
      const alumno = await alumnoDeCodigo(db, inicio.codigo).catch(() => null);
      if (alumno) {
        if (persona?.alumnoId === alumno.id) { await responder(TEXTOS_DEL_BOT.yaEstaba(alumno.nombre), "quitar"); return "ya"; }
        await atarPersona(db, tg, { personaId: id, alumnoId: alumno.id, vinculo: "codigo", quien: "Bot de Telegram (link personal)", ahora });
        await responder(TEXTOS_DEL_BOT.listo(alumno.nombre), "quitar");
        return "codigo";
      }
      await responder(TEXTOS_DEL_BOT.codigoMalo, "numero");
      return "codigo-malo";
    }
    if (persona?.alumnoId) { await responder(TEXTOS_DEL_BOT.yaEstaba(await nombreDe(persona.alumnoId)), "quitar"); return "ya"; }
    await responder(TEXTOS_DEL_BOT.pedirNumero, "numero");
    return "pedir";
  }
  if (persona?.alumnoId) return "ignorado";
  await responder(TEXTOS_DEL_BOT.sinTeclado, "numero");
  return "ayuda";
}

/* ---------- Pedirles que se identifiquen ---------- */

let usuarioDelBot: string | null = null;
/** El @usuario del bot (para armar su link). */
export async function usuarioDeBot(tg: LlamarTelegram = telegramReal): Promise<string | null> {
  if (usuarioDelBot) return usuarioDelBot;
  const r = await tg("getMe").catch(() => null);
  usuarioDelBot = (r?.result as { username?: string } | undefined)?.username ?? null;
  return usuarioDelBot;
}

/** El link personal de un alumno (con su código) y el mensaje para pegarle por WhatsApp. */
export async function enlacePersonalDelBot(db: SupabaseClient, alumnoId: string, tg: LlamarTelegram = telegramReal): Promise<{ enlace: string } | null> {
  const bot = await usuarioDeBot(tg);
  if (!bot) return null;
  const codigo = await codigoDeAlumno(db, alumnoId);
  return codigo ? { enlace: enlaceDelBot(bot, codigo) } : null;
}

/** Deja en cada grupo donde el bot es administrador un mensaje con el botón que lleva al bot. Quien lo toca comparte su número y queda
    reconocido. Es lo único que llega a los alumnos que nunca escriben ni entran con un link. */
export async function anunciarEnLosGrupos(
  db: SupabaseClient, tg: LlamarTelegram, chatIds?: string[],
): Promise<{ enviados: { chatId: string; titulo: string }[]; fallaron: { chatId: string; titulo: string; error: string }[] }> {
  const bot = await usuarioDeBot(tg);
  if (!bot) throw new Error("No pude leer el @usuario del bot.");
  const salida = { enviados: [] as { chatId: string; titulo: string }[], fallaron: [] as { chatId: string; titulo: string; error: string }[] };
  for (const g of await gruposDelBot(db)) {
    if (chatIds && !chatIds.includes(g.chatId)) continue;
    const r = await tg("sendMessage", {
      chat_id: g.chatId, text: TEXTO_DEL_ANUNCIO,
      reply_markup: { inline_keyboard: [[{ text: BOTON_DEL_ANUNCIO, url: enlaceDelBot(bot) }]] },
    }).catch((e: unknown) => ({ ok: false, description: e instanceof Error ? e.message : "sin respuesta" }) as RespuestaDeTelegram);
    if (r.ok) salida.enviados.push(g);
    else salida.fallaron.push({ ...g, error: r.description ?? "sin motivo" });
  }
  return salida;
}

/* ---------- El resumen de Ajustes ---------- */

export interface ResumenDeIdentificacion {
  /* Alumnos activos que tienen (o tuvieron marcado) acceso a Telegram. */
  conAcceso: number;
  /* De ésos, a cuántos ya se los reconoce en Telegram. */
  identificados: number;
  /* Cuentas vistas que todavía no se sabe de quién son (sin contar al equipo). */
  sueltas: number;
  /* Cuentas con un número compartido que coincide a medias con alguien: las decide una persona. */
  porRevisar: number;
}

async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const salida: T[] = [];
  for (let desde = 0; desde < 50_000; desde += 1000) {
    const r = await pedir(desde, desde + 999);
    if (r.error) throw new Error(r.error.message);
    const parte = (r.data ?? []) as T[];
    salida.push(...parte);
    if (parte.length < 1000) break;
  }
  return salida;
}

export async function resumenDeIdentificacion(db: SupabaseClient): Promise<ResumenDeIdentificacion> {
  const activos = await todas<{ id: string }>((d, h) => db.from("alumnos").select("id").eq("estado", "activo").order("id").range(d, h));
  const marcados = await todas<{ alumnoId: string }>((d, h) => db.from("seguimiento_alumnos").select('"alumnoId"').eq("accesoWhatsapp", true).order("id").range(d, h));
  const conLink = await todas<{ alumnoId: string }>((d, h) => db.from("accesos_alumno").select('"alumnoId"').eq("plataforma", "telegram").in("estado", ["dado", "entro"]).order("id").range(d, h));
  const personas = await todas<{ alumnoId: string | null; equipo: boolean; posibles: unknown[] }>((d, h) => db.from("telegram_personas").select('"alumnoId", equipo, posibles').order("id").range(d, h));
  const quienes = new Set([...marcados, ...conLink].map((x) => x.alumnoId));
  const universo = activos.map((x) => x.id).filter((id) => quienes.has(id));
  const atados = new Set(personas.map((p) => p.alumnoId).filter((x): x is string => Boolean(x)));
  const sueltas = personas.filter((p) => !p.alumnoId && !p.equipo);
  return {
    conAcceso: universo.length,
    identificados: universo.filter((id) => atados.has(id)).length,
    sueltas: sueltas.length,
    porRevisar: sueltas.filter((p) => Array.isArray(p.posibles) && p.posibles.length > 0).length,
  };
}
