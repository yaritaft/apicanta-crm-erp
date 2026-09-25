/* ==================================================================
   Entrada de Calendly a nuestra base, del lado del SERVIDOR.

   Usa la clave de servicio (saltea RLS): nunca importar esto desde un
   componente de cliente. Lo llaman el webhook de Calendly y el cron que
   repesca lo que un webhook haya perdido.

   Cada agenda deja tres cosas:
   - el CONTACTO: la persona, por email. Si ya existía, se completan los
     huecos con lo del formulario sin pisar lo que ya había (mismas reglas
     que el formulario de Leads, en `contactos.ts`);
   - un LEAD en "Sesión agendada", sólo si la persona no tenía ninguna
     oportunidad abierta;
   - la LLAMADA, con canal, UTMs, respuestas del formulario y anfitrión.

   Lo que el equipo cargó en la Agenda no se pisa: si una llamada ya se
   marcó como hecha, que Calendly la vuelva a mandar no la devuelve a
   "agendada". Calendly sólo decide si se canceló o si fue no-show.
   ================================================================== */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anfitrionDe, aniosDeTexto, calendly, canalDeEvento, enlaceDe, estadoDe, ETIQUETA_CANAL,
  idPersonaCalendly, idSesionCalendly, nivelDeIngles, respuestaA, respuestasDe, utmDe, webinarDeUtm,
  type EventoCalendly, type InvitadoCalendly,
} from "./calendly";
import { claveEmail, completar } from "./contactos";
import { nubeServidor } from "./servidor";
import type { Contacto, Lead, Sesion } from "./types";

/* "Sesión agendada" en las etapas de la base. */
const ETAPA_SESION = "et_sesion";
/* El mismo valor inicial que usa el alta de un lead a mano (VACIO en
   leads/page.tsx): el ticket del programa. */
const MONTO_INICIAL = 2400;

export interface ResultadoIngreso {
  sesionId: string;
  contactoId: string;
  leadId?: string;
  contactoNuevo: boolean;
  leadNuevo: boolean;
  estado: Sesion["estado"];
}

/* Lo que se consulta una vez por corrida y no por cada agenda. */
interface Contexto {
  db: SupabaseClient;
  webinars?: { id: string; fecha: string }[];
  etapaSesion?: string | null;
}

export function contextoCalendly(): Contexto {
  const db = nubeServidor();
  if (!db) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY: la entrada de Calendly no puede escribir.");
  return { db };
}

async function webinarsDe(ctx: Contexto) {
  if (!ctx.webinars) {
    const r = await ctx.db.from("webinars").select("id,fecha");
    ctx.webinars = (r.data ?? []) as { id: string; fecha: string }[];
  }
  return ctx.webinars;
}

async function etapaSesionDe(ctx: Contexto): Promise<string | null> {
  if (ctx.etapaSesion !== undefined) return ctx.etapaSesion;
  const r = await ctx.db.from("etapas").select("id,nombre,orden");
  const etapas = (r.data ?? []) as { id: string; nombre: string; orden: number }[];
  ctx.etapaSesion = etapas.find((x) => x.id === ETAPA_SESION)?.id
    ?? etapas.find((x) => /sesi.n agendada/i.test(x.nombre))?.id
    ?? null;
  return ctx.etapaSesion;
}

/* PostgREST: undefined no es "dejalo como está", es "no lo mandes". */
const limpio = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/* ilike con el email tal cual: sin comodines, así "a_b@x.com" no matchea "aXb@x.com". */
const exacto = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Guarda una agenda de Calendly.
 *
 * `desdeLaApi`: el invitado y el evento vinieron de la API (el cron los
 * listó). Si vinieron en el cuerpo de un webhook, se vuelven a pedir: un
 * cuerpo HTTP lo puede escribir cualquiera, la API no.
 */
export async function ingresarInvitado(
  invitadoUri: string,
  datos: { invitado?: InvitadoCalendly; evento?: EventoCalendly; desdeLaApi?: boolean } = {},
  ctx: Contexto = contextoCalendly(),
): Promise<ResultadoIngreso> {
  const { db } = ctx;

  let inv = datos.desdeLaApi ? datos.invitado : undefined;
  if (!inv) inv = (await calendly<{ resource: InvitadoCalendly }>(invitadoUri)).resource;
  let ev = datos.desdeLaApi ? datos.evento : undefined;
  if (!ev) ev = (await calendly<{ resource: EventoCalendly }>(inv.event)).resource;

  const ahora = new Date().toISOString();
  const qa = respuestasDe(inv);
  /* Sin UTMs, lo que dice el estándar: llegó sola, sin un link nuestro. */
  const utm = utmDe(inv.tracking) ?? { utm_source: "direct", utm_medium: "none" };
  const canal = canalDeEvento(ev.name);
  const anfitrion = anfitrionDe(ev);
  const webinarId = webinarDeUtm(utm, await webinarsDe(ctx), inv.created_at);
  const telefono = inv.text_reminder_number
    || respuestaA(qa, /(whatsapp|telefono|celular|numero)/);
  const del = {
    telefono: telefono || undefined,
    inglesNivel: nivelDeIngles(respuestaA(qa, /ingles/)),
    aniosExperiencia: aniosDeTexto(respuestaA(qa, /(anos.*program|program.*anos)/)),
    tecnologias: respuestaA(qa, /(lenguaje|framework|tecnolog)/),
    formacion: respuestaA(qa, /(formacion|estudio)/),
    sueldoUsd: respuestaA(qa, /(ganas|sueldo|salario)/),
    instagram: respuestaA(qa, /instagram/),
  };

  /* ---------- 1. El contacto: el mismo email es la misma persona ---------- */
  const email = claveEmail(inv.email);
  const busqueda = email
    ? await db.from("contactos").select("*").ilike("email", exacto(email)).limit(1)
    : { data: [], error: null };
  if (busqueda.error) throw new Error(`contactos: ${busqueda.error.message}`);
  const previo = (busqueda.data?.[0] ?? null) as Contacto | null;

  const contacto: Contacto = previo
    ? {
        ...previo,
        telefono: completar(previo.telefono, del.telefono),
        inglesNivel: completar(previo.inglesNivel, del.inglesNivel),
        aniosExperiencia: completar(previo.aniosExperiencia, del.aniosExperiencia),
        tecnologias: completar(previo.tecnologias, del.tecnologias),
        formacion: completar(previo.formacion, del.formacion),
        sueldoUsd: completar(previo.sueldoUsd, del.sueldoUsd),
        instagram: completar(previo.instagram, del.instagram),
        origenCanal: completar(previo.origenCanal, canal),
        origenWebinarId: completar(previo.origenWebinarId, webinarId),
        utm: completar(previo.utm, utm),
      }
    : {
        id: idPersonaCalendly(inv.uri),
        nombre: inv.name, email: inv.email,
        ...del,
        origenCanal: canal, origenWebinarId: webinarId, utm,
        creadoEn: inv.created_at, extra: {},
      };

  const rc = await db.from("contactos").upsert(limpio(contacto), { defaultToNull: false });
  if (rc.error) throw new Error(`contactos: ${rc.error.message}`);

  /* ---------- 2. La oportunidad: sólo si no tenía ninguna ---------- */
  const suya = await db.from("leads").select("id").eq("contactoId", contacto.id).limit(1);
  if (suya.error) throw new Error(`leads: ${suya.error.message}`);
  let leadId = (suya.data?.[0] as { id: string } | undefined)?.id;
  let leadNuevo = false;

  if (!leadId && inv.status === "active") {
    const lead: Lead = {
      id: contacto.id, contactoId: contacto.id,
      nombre: contacto.nombre, email: contacto.email, telefono: contacto.telefono, pais: contacto.pais,
      fuente: ETIQUETA_CANAL[canal], inglesNivel: contacto.inglesNivel, aniosExperiencia: contacto.aniosExperiencia,
      etapaId: (await etapaSesionDe(ctx)) ?? "", monto: MONTO_INICIAL, moneda: "USD",
      responsable: anfitrion ?? "", etiquetas: [], webinarId,
      creadoEn: inv.created_at, actualizadoEn: ahora, extra: {},
    };
    const rl = await db.from("leads").upsert(limpio({ ...lead, etapaId: lead.etapaId || undefined }), { defaultToNull: false });
    if (rl.error) throw new Error(`leads: ${rl.error.message}`);
    leadId = lead.id;
    leadNuevo = true;
  }

  /* ---------- 3. La llamada ---------- */
  const sesionId = idSesionCalendly(inv.uri);
  const ya = await db.from("sesiones").select("estado,titulo,tipo,notas").eq("id", sesionId).limit(1);
  if (ya.error) throw new Error(`sesiones: ${ya.error.message}`);
  const antes = ya.data?.[0] as Pick<Sesion, "estado" | "titulo" | "tipo" | "notas"> | undefined;

  const estado = estadoDe(inv) ?? antes?.estado ?? "agendada";
  const minutos = Math.max(1, Math.round((+new Date(ev.end_time) - +new Date(ev.start_time)) / 60000));

  const sesion: Sesion = {
    id: sesionId,
    titulo: antes?.titulo || ev.name,
    tipo: antes?.tipo || ev.name,
    notas: antes?.notas,
    leadId, contactoId: contacto.id,
    invitado: inv.name, email: inv.email,
    inicia: ev.start_time, duracionMin: minutos,
    estado, enlace: enlaceDe(ev), origen: "calendly",
    creadoEn: inv.created_at, extra: {},
    canal, utm, respuestas: qa.length ? qa : undefined, anfitrion,
    calendlyEventoUri: ev.uri, calendlyInvitadoUri: inv.uri,
    reprogramadaDe: inv.old_invitee ? idSesionCalendly(inv.old_invitee) : undefined,
    canceladaEn: inv.status === "canceled" ? (inv.cancellation?.created_at || inv.updated_at) : undefined,
    motivoCancelacion: inv.status === "canceled"
      ? (inv.rescheduled ? "Reprogramada" : inv.cancellation?.reason || undefined)
      : undefined,
  };

  const rs = await db.from("sesiones").upsert(limpio(sesion), { defaultToNull: false });
  if (rs.error) throw new Error(`sesiones: ${rs.error.message}`);

  return { sesionId, contactoId: contacto.id, leadId, contactoNuevo: !previo, leadNuevo, estado };
}

/**
 * Repesca: lista las agendas de la organización en una ventana y guarda las
 * que no tenemos o cuyo estado cambió (una cancelación, una reprogramación).
 *
 * `limite` corta cuántos eventos nuevos procesa por corrida: la primera vez
 * hay semanas de agendas por delante y todo junto no entra en el tiempo de
 * una función. Lo que queda, lo toma la corrida siguiente.
 */
export async function sincronizarCalendly(
  { atras = 2, adelante = 60, limite = 60 }: { atras?: number; adelante?: number; limite?: number } = {},
) {
  const ctx = contextoCalendly();
  const yo = await calendly<{ resource: { current_organization: string } }>("/users/me");
  const org = yo.resource.current_organization;

  const params = new URLSearchParams({
    organization: org, count: "100", sort: "start_time:asc",
    min_start_time: new Date(Date.now() - atras * 864e5).toISOString(),
    max_start_time: new Date(Date.now() + adelante * 864e5).toISOString(),
  });
  const eventos: EventoCalendly[] = [];
  let siguiente: string | null = `/scheduled_events?${params}`;
  for (let pagina = 0; siguiente && pagina < 30; pagina++) {
    const r: { collection: EventoCalendly[]; pagination: { next_page?: string | null } } = await calendly(siguiente);
    eventos.push(...r.collection);
    siguiente = r.pagination.next_page ?? null;
  }

  /* Lo que ya tenemos, por evento, en tandas (un `in` con 300 URLs no entra en la URL). */
  const conocidos = new Map<string, string>();
  for (let i = 0; i < eventos.length; i += 50) {
    const r = await ctx.db.from("sesiones").select("calendlyEventoUri,estado")
      .in("calendlyEventoUri", eventos.slice(i, i + 50).map((e) => e.uri));
    if (r.error) throw new Error(`sesiones: ${r.error.message}`);
    for (const s of (r.data ?? []) as { calendlyEventoUri: string; estado: string }[]) {
      conocidos.set(s.calendlyEventoUri, s.estado);
    }
  }

  const pendientes = eventos.filter((ev) => {
    const nuestro = conocidos.get(ev.uri);
    return !nuestro || (ev.status === "canceled" && nuestro !== "cancelada");
  });

  let nuevas = 0, actualizadas = 0;
  const errores: string[] = [];
  for (const ev of pendientes.slice(0, limite)) {
    try {
      const invs = await calendly<{ collection: InvitadoCalendly[] }>(`${ev.uri}/invitees?count=100`);
      for (const inv of invs.collection) {
        await ingresarInvitado(inv.uri, { invitado: inv, evento: ev, desdeLaApi: true }, ctx);
        if (conocidos.has(ev.uri)) actualizadas++; else nuevas++;
      }
    } catch (e) {
      errores.push(`${ev.uri.split("/").pop()}: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return {
    eventos: eventos.length, pendientes: pendientes.length,
    nuevas, actualizadas, quedan: Math.max(0, pendientes.length - limite),
    errores: errores.slice(0, 5),
  };
}
