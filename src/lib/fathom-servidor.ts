import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decidirGrabacion, leerReunion, llamadaDe, segundosDeEspera, type Grabacion, type LlamadaCandidata } from "./fathom";
import { equiposDeVentas, leerEquipos } from "./fathom-equipos";
import { desdeDelDiagnostico, diagnosticar, leerMiembrosDeFathom, type Diagnostico, type LlamadaDiag, type MiembroDiag, type PasadaPorEquipo } from "./fathom-diagnostico";

/* ==================================================================
   Fathom del lado del servidor: su API (con FATHOM_API_KEY, que vive en
   Vercel y nunca llega al navegador), la firma de su webhook y guardar
   cada grabación atada a su llamada. Las que no tienen llamada de
   Calendly (personales o internas) no se guardan.

   El secreto del webhook lo devuelve Fathom al crearlo (api/fathom,
   «Conectar») y se guarda en `fathom_conexion`, que sólo lee el servidor.
   Si se prefiere crearlo a mano en Fathom, va en FATHOM_WEBHOOK_SECRET.
   ================================================================== */

const API = "https://api.fathom.ai/external/v1";

export const hayApiFathom = () => Boolean(process.env.FATHOM_API_KEY);

export async function fathom(ruta: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${ruta}`, {
    ...init,
    headers: { "X-Api-Key": process.env.FATHOM_API_KEY ?? "", "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

/* ---------- la firma del webhook ----------
   Fathom firma como Standard Webhooks: HMAC-SHA256 de «id.timestamp.cuerpo»
   con el secreto (whsec_… en base64), en base64, y lo manda como «v1,<firma>»
   (puede haber varias, separadas por espacio). Se rechaza lo que tenga más
   de 5 minutos: un pedido viejo reenviado no pasa. */
export function firmaValida(a: {
  cuerpo: string; id: string | null; timestamp: string | null; firma: string | null; secreto: string; ahora?: number;
}): boolean {
  if (!a.id || !a.timestamp || !a.firma || !a.secreto) return false;
  const ts = Number(a.timestamp);
  const ahora = Math.floor((a.ahora ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(ahora - ts) > 5 * 60) return false;
  let clave: Buffer;
  try { clave = Buffer.from(a.secreto.startsWith("whsec_") ? a.secreto.slice(6) : a.secreto, "base64"); } catch { return false; }
  if (clave.length === 0) return false;
  const esperada = createHmac("sha256", clave).update(`${a.id}.${a.timestamp}.${a.cuerpo}`).digest();
  return a.firma.split(/\s+/).some((x) => {
    const [version, valor] = x.split(",");
    if (version !== "v1" || !valor) return false;
    const dada = Buffer.from(valor, "base64");
    return dada.length === esperada.length && timingSafeEqual(dada, esperada);
  });
}

/** El secreto con el que se verifica el webhook: el de Vercel, o el que se
    guardó al conectar desde la app. */
export async function secretoWebhook(db: SupabaseClient): Promise<string | null> {
  if (process.env.FATHOM_WEBHOOK_SECRET) return process.env.FATHOM_WEBHOOK_SECRET;
  const r = await db.from("fathom_conexion").select("secreto").eq("id", 1).maybeSingle();
  return (r.data as { secreto?: string } | null)?.secreto ?? null;
}

/* ---------- guardar una grabación ---------- */

export interface ResultadoGrabacion {
  ok: boolean; guardada: boolean; sesionId: string | null; error?: string;
  /* Si ya estaba guardada de antes (una vuelta por equipo repite lo que trajo la general). */
  yaEstaba?: boolean;
}

/** Guarda una reunión de Fathom atada a su llamada de Calendly. La que no
    tiene llamada (personal o interna) no se guarda: `guardada: false`
    (lib/fathom, decidirGrabacion). Le pone el link a la llamada si no tenía
    (el closer lo podía pegar en el cierre del día: ése se respeta). */
export async function guardarGrabacion(db: SupabaseClient, payload: unknown): Promise<ResultadoGrabacion> {
  const g = leerReunion(payload);
  if (!g) return { ok: false, guardada: false, sesionId: null, error: "La reunión no trae recording_id." };

  const previa = await db.from("grabaciones").select("sesionId, emparejadaPor, creadoEn").eq("id", g.id).maybeSingle();
  const antes = previa.data as { sesionId: string | null; emparejadaPor: Grabacion["emparejadaPor"]; creadoEn: string } | null;

  let encontrada: string | null = null;
  if (antes?.emparejadaPor !== "a-mano") {
    const t = Date.parse(g.empieza ?? g.grabadaDesde ?? g.creadoEn ?? "");
    if (Number.isFinite(t)) {
      const [ll, eq] = await Promise.all([
        db.from("sesiones").select("id, email, inicia, anfitrion")
          .gte("inicia", new Date(t - 4 * 3600_000).toISOString()).lte("inicia", new Date(t + 4 * 3600_000).toISOString()),
        db.from("equipo").select("nombre, email"),
      ]);
      if (ll.error) return { ok: false, guardada: false, sesionId: null, error: ll.error.message };
      encontrada = llamadaDe(g, (ll.data ?? []) as LlamadaCandidata[], (eq.data ?? []) as { nombre: string; email?: string | null }[]);
    }
  }

  const d = decidirGrabacion(antes, encontrada);
  if (!d.guardar) return { ok: true, guardada: false, sesionId: null };

  const ahora = new Date().toISOString();
  const fila = { ...g, sesionId: d.sesionId, emparejadaPor: d.por, creadoEn: antes?.creadoEn ?? g.creadoEn ?? ahora, actualizadoEn: ahora };
  const r = await db.from("grabaciones").upsert(fila, { onConflict: "id" });
  if (r.error) return { ok: false, guardada: false, sesionId: d.sesionId, error: r.error.message };

  if (d.sesionId && g.shareUrl) {
    await db.from("sesiones").update({ grabacion: g.shareUrl }).eq("id", d.sesionId).or("grabacion.is.null,grabacion.eq.");
  }
  return { ok: true, guardada: true, sesionId: d.sesionId, yaEstaba: Boolean(antes) };
}

/* ---------- la API ---------- */

/** Guarda una reunión atada a mano a esa llamada (el cierre del día:
    «Buscar en Fathom»). No se desata sola, y su link queda en la llamada. */
export async function atarGrabacion(db: SupabaseClient, payload: unknown, sesionId: string): Promise<{ ok: boolean; shareUrl: string | null; error?: string }> {
  const g = leerReunion(payload);
  if (!g) return { ok: false, shareUrl: null, error: "La reunión no trae recording_id." };
  const previa = await db.from("grabaciones").select("creadoEn").eq("id", g.id).maybeSingle();
  const ahora = new Date().toISOString();
  const creadoEn = (previa.data as { creadoEn?: string } | null)?.creadoEn ?? g.creadoEn ?? ahora;
  const r = await db.from("grabaciones").upsert({ ...g, sesionId, emparejadaPor: "a-mano", creadoEn, actualizadoEn: ahora }, { onConflict: "id" });
  if (r.error) return { ok: false, shareUrl: null, error: r.error.message };
  if (g.shareUrl) await db.from("sesiones").update({ grabacion: g.shareUrl }).eq("id", sesionId);
  return { ok: true, shareUrl: g.shareUrl ?? null };
}

export interface PaginaReuniones { items: unknown[]; siguiente: string | null }

/** Las reuniones que grabó una persona (por su correo) entre dos momentos.
    Sin el contenido alcanza para elegir; con él (una sola, la elegida) es
    un pedido pesado. Es un día y medio de un closer, pero ya no se corta a
    las 4 páginas (F2-04): se sigue hasta 30 por si Fathom las da de a pocas. */
export async function reunionesDe(grabadoPor: string | null, desde: string, hasta: string, conContenido = false, equipo?: string | null): Promise<unknown[]> {
  const items: unknown[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 30; i++) {
    const q = new URLSearchParams({ created_after: desde, created_before: hasta });
    if (grabadoPor) q.append("recorded_by[]", grabadoPor);
    if (equipo) q.append("teams[]", equipo);
    if (conContenido) { q.set("include_summary", "true"); q.set("include_transcript", "true"); q.set("include_action_items", "true"); }
    if (cursor) q.set("cursor", cursor);
    const r = await fathom(`/meetings?${q}`);
    if (r.status === 429) throw new EsperarAFathom(segundosDeEspera(r.headers.get("retry-after"), Date.now()));
    if (!r.ok) {
      const error = await errorDe(r);
      console.error("[fathom] /meetings (de un closer):", error);
      throw new Error(error);
    }
    const j = (await r.json()) as { items?: unknown[]; next_cursor?: string | null };
    items.push(...(j.items ?? []));
    cursor = j.next_cursor ?? null;
    if (!cursor) break;
  }
  return items;
}

/** Fathom contestó 429: pide esperar `segundos` antes de volver a pedir.
    Las páginas con transcripción son «pedidos pesados»: 30 por minuto, y
    cuando tiene mucho trabajo, 5. */
export class EsperarAFathom extends Error {
  segundos: number;
  constructor(segundos: number) {
    super(`Fathom pidió esperar ${segundos} s.`);
    this.name = "EsperarAFathom";
    this.segundos = segundos;
  }
}

/** Una página de reuniones de Fathom, con resumen, transcripción y
    accionables, creadas desde `desde`. Con `equipo`, las de ese equipo de
    Fathom (`teams[]`: las «Team Calls»); sin él, todo lo que la clave ve. */
export async function reunionesDesde(desde: string, cursor?: string | null, equipo?: string | null): Promise<PaginaReuniones> {
  const q = new URLSearchParams({
    include_summary: "true", include_transcript: "true", include_action_items: "true",
    created_after: desde,
  });
  if (equipo) q.append("teams[]", equipo);
  if (cursor) q.set("cursor", cursor);
  const r = await fathom(`/meetings?${q}`);
  if (r.status === 429) throw new EsperarAFathom(segundosDeEspera(r.headers.get("retry-after"), Date.now()));
  if (!r.ok) {
    const error = await errorDe(r);
    console.error("[fathom] /meetings:", error);
    throw new Error(error);
  }
  const j = (await r.json()) as { items?: unknown[]; next_cursor?: string | null };
  return { items: j.items ?? [], siguiente: j.next_cursor ?? null };
}

/* Para qué grabaciones avisa: las del dueño de la clave, las que le
   comparten y, con plan Team, las del equipo. Sin plan Team, las dos
   primeras. */
const PARA_TODAS = ["my_recordings", "shared_external_recordings", "my_shared_with_team_recordings", "shared_team_recordings"];
const PARA_LAS_SUYAS = ["my_recordings", "shared_external_recordings"];

export async function crearWebhook(destino: string): Promise<{ id: string; secreto: string; paraElEquipo: boolean }> {
  for (const [triggered_for, paraElEquipo] of [[PARA_TODAS, true], [PARA_LAS_SUYAS, false]] as const) {
    const r = await fathom("/webhooks", {
      method: "POST",
      body: JSON.stringify({ destination_url: destino, triggered_for, include_transcript: true, include_summary: true, include_action_items: true }),
    });
    if (r.ok) {
      const j = (await r.json()) as { id?: string; secret?: string };
      if (!j.id || !j.secret) throw new Error("Fathom creó el webhook pero no devolvió su id o su secreto.");
      return { id: j.id, secreto: j.secret, paraElEquipo };
    }
    /* Sin plan Team las opciones del equipo se rechazan: se prueba con las otras. */
    if (!paraElEquipo || (r.status !== 400 && r.status !== 422)) throw new Error(await errorDe(r));
  }
  throw new Error("No se pudo crear el webhook.");
}

export async function borrarWebhook(id: string): Promise<void> {
  const r = await fathom(`/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(await errorDe(r));
}

/* ---------- los equipos de Fathom (F2-04) ---------- */

/** Los equipos de ventas de Fathom por los que «Traer lo anterior» pide las
    llamadas de equipo: los de FATHOM_EQUIPOS (opcional, en Vercel) o los de
    GET /teams que parecen de ventas. Si Fathom no deja leer los equipos
    (un plan sin equipos), no hay ninguno y sigue sin ellos. */
export async function equiposDeVentasDeFathom(): Promise<string[]> {
  const dichos = process.env.FATHOM_EQUIPOS;
  const r = await paginas("/teams", new URLSearchParams(), 5, Date.now() + 30_000);
  if (r.error) console.error("[fathom] /teams:", r.error);
  return equiposDeVentas(leerEquipos(r.items), dichos);
}

/* Una lista paginada de Fathom (items + next_cursor), hasta `tope` páginas
   o hasta `limite` (un reloj, en ms): si Fathom pide esperar, espera un rato
   corto una o dos veces; después deja lo que alcanzó y lo dice (`completo`). */
async function paginas(ruta: string, params: URLSearchParams, tope: number, limite: number): Promise<{ items: unknown[]; completo: boolean; error?: string }> {
  const items: unknown[] = [];
  let cursor: string | null = null;
  let esperas = 0;
  for (let i = 0; i < tope; i++) {
    if (Date.now() > limite) return { items, completo: false };
    const q = new URLSearchParams(params);
    if (cursor) q.set("cursor", cursor);
    let r: Response;
    try { r = await fathom(`${ruta}${q.size ? `?${q}` : ""}`); }
    catch { return { items, completo: false, error: "No se pudo hablar con Fathom." }; }
    if (r.status === 429) {
      const espera = Math.min(30, segundosDeEspera(r.headers.get("retry-after"), Date.now()));
      if (++esperas > 2 || Date.now() + espera * 1000 > limite) return { items, completo: false };
      await new Promise((listo) => setTimeout(listo, espera * 1000));
      i--;
      continue;
    }
    if (!r.ok) return { items, completo: false, error: await errorDe(r) };
    const j = (await r.json().catch(() => ({}))) as { items?: unknown[]; next_cursor?: string | null };
    items.push(...(j.items ?? []));
    cursor = j.next_cursor ?? null;
    if (!cursor) return { items, completo: true };
  }
  return { items, completo: false };
}

/* ---------- el diagnóstico (Ajustes → Fathom → «Diagnosticar») ---------- */

/** Le pregunta a Fathom, con la clave del servidor, qué reuniones ve (sin
    filtrar y por cada equipo de ventas) y lo cruza con las llamadas de
    Calendly de la app. Sólo lee: no guarda nada. La clave no sale de acá:
    el resultado (lib/fathom-diagnostico) son cuentas y nombres de quien
    grabó, sin títulos ni contenido de las reuniones. */
export async function diagnosticarFathom(db: SupabaseClient): Promise<Diagnostico> {
  const ahora = Date.now();
  /* Un reloj para todo: el diagnóstico no pasa de unos 2 minutos y medio (la ruta tiene 5). */
  const limite = ahora + 150_000;
  const errores: string[] = [];
  const falta = (r: { error?: { message: string } | null }, que: string) => { if (r.error) errores.push(`${que}: ${r.error.message}`); };

  const primera = await db.from("sesiones").select("inicia").not("email", "is", null).order("inicia", { ascending: true }).limit(1).maybeSingle();
  const desde = desdeDelDiagnostico((primera.data as { inicia?: string } | null)?.inicia, ahora);

  const [eq, mi] = await Promise.all([
    paginas("/teams", new URLSearchParams(), 5, limite),
    paginas("/team_members", new URLSearchParams(), 10, limite),
  ]);
  if (eq.error) errores.push(`Equipos de Fathom: ${eq.error}`);
  if (mi.error && !eq.error) errores.push(`Integrantes de los equipos de Fathom: ${mi.error}`);
  const nombresDeEquipos = eq.error ? null : leerEquipos(eq.items);

  const q = () => new URLSearchParams({ created_after: desde });
  const generales = await paginas("/meetings", q(), 25, limite);
  const porEquipo: PasadaPorEquipo[] = [];
  for (const equipo of equiposDeVentas(nombresDeEquipos ?? [], process.env.FATHOM_EQUIPOS)) {
    const p = q();
    p.append("teams[]", equipo);
    const r = await paginas("/meetings", p, 25, limite);
    porEquipo.push({ equipo, items: r.items, completo: r.completo, error: r.error });
  }

  const [ll, equipoApp, conexion] = await Promise.all([
    db.from("sesiones").select("id, email, inicia, anfitrion, enlace, estado").gte("inicia", desde).limit(5000),
    db.from("equipo").select("nombre, email, rol, activo"),
    db.from("fathom_conexion").select("paraElEquipo").eq("id", 1).maybeSingle(),
  ]);
  falta(ll, "Llamadas de Calendly");
  falta(equipoApp, "Equipo");

  /* Cuáles de las reuniones que devolvió Fathom ya están guardadas. */
  const ids = new Set<string>();
  for (const x of [...generales.items, ...porEquipo.flatMap((p) => p.items)]) {
    const g = leerReunion(x);
    if (g) ids.add(g.recordingId);
  }
  const yaGuardadas: string[] = [];
  const lista = [...ids];
  for (let i = 0; i < lista.length; i += 200) {
    const r = await db.from("grabaciones").select("recordingId").in("recordingId", lista.slice(i, i + 200));
    if (r.error) { errores.push(`Grabaciones guardadas: ${r.error.message}`); break; }
    yaGuardadas.push(...((r.data ?? []) as { recordingId: string }[]).map((x) => x.recordingId));
  }

  const hayConexion = Boolean((conexion.data as { paraElEquipo?: boolean } | null) ?? process.env.FATHOM_WEBHOOK_SECRET);
  return diagnosticar({
    ahora, desde,
    generales: generales.items, generalesCompleto: generales.completo,
    equipos: nombresDeEquipos, miembros: mi.error ? null : leerMiembrosDeFathom(mi.items),
    porEquipo,
    conexion: { conectado: hayConexion, paraElEquipo: (conexion.data as { paraElEquipo?: boolean } | null)?.paraElEquipo ?? null },
    llamadas: (ll.data ?? []) as LlamadaDiag[],
    equipoApp: (equipoApp.data ?? []) as MiembroDiag[],
    yaGuardadas, errores,
    fallo: generales.error ? `Fathom no devolvió las reuniones. ${generales.error}` : undefined,
  });
}

async function errorDe(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  if (r.status === 401 || r.status === 403) return "Fathom no aceptó la clave (FATHOM_API_KEY).";
  if (r.status === 429) return "Fathom pidió esperar (demasiados pedidos seguidos). Probá en un minuto.";
  return `Fathom contestó ${r.status}${t ? `: ${t.slice(0, 200)}` : ""}.`;
}
