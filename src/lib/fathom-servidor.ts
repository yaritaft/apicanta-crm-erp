import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leerReunion, llamadaDe, type Grabacion, type LlamadaCandidata } from "./fathom";

/* ==================================================================
   Fathom del lado del servidor: su API (con FATHOM_API_KEY, que vive en
   Vercel y nunca llega al navegador), la firma de su webhook y guardar
   cada grabación atada a su llamada.

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

/** Guarda una reunión de Fathom y la ata a su llamada. Una grabación que se
    ató a mano no se desata sola. Le pone el link a la llamada si no tenía
    (el closer lo podía pegar en el cierre del día: ése se respeta). */
export async function guardarGrabacion(db: SupabaseClient, payload: unknown): Promise<{ ok: boolean; sesionId: string | null; error?: string }> {
  const g = leerReunion(payload);
  if (!g) return { ok: false, sesionId: null, error: "La reunión no trae recording_id." };

  const previa = await db.from("grabaciones").select("sesionId, emparejadaPor, creadoEn").eq("id", g.id).maybeSingle();
  const antes = previa.data as { sesionId: string | null; emparejadaPor: string | null; creadoEn: string } | null;

  let sesionId: string | null = null;
  let por: Grabacion["emparejadaPor"] = null;
  if (antes?.emparejadaPor === "a-mano") {
    sesionId = antes.sesionId;
    por = "a-mano";
  } else {
    const t = Date.parse(g.empieza ?? g.grabadaDesde ?? g.creadoEn ?? "");
    if (Number.isFinite(t)) {
      const [ll, eq] = await Promise.all([
        db.from("sesiones").select("id, email, inicia, anfitrion")
          .gte("inicia", new Date(t - 4 * 3600_000).toISOString()).lte("inicia", new Date(t + 4 * 3600_000).toISOString()),
        db.from("equipo").select("nombre, email"),
      ]);
      if (ll.error) return { ok: false, sesionId: null, error: ll.error.message };
      sesionId = llamadaDe(g, (ll.data ?? []) as LlamadaCandidata[], (eq.data ?? []) as { nombre: string; email?: string | null }[]);
      if (sesionId) por = "email-y-hora";
    }
  }

  const ahora = new Date().toISOString();
  const fila = { ...g, sesionId, emparejadaPor: por, creadoEn: antes?.creadoEn ?? g.creadoEn ?? ahora, actualizadoEn: ahora };
  const r = await db.from("grabaciones").upsert(fila, { onConflict: "id" });
  if (r.error) return { ok: false, sesionId, error: r.error.message };

  if (sesionId && g.shareUrl) {
    await db.from("sesiones").update({ grabacion: g.shareUrl }).eq("id", sesionId).or("grabacion.is.null,grabacion.eq.");
  }
  return { ok: true, sesionId };
}

/* ---------- la API ---------- */

export interface PaginaReuniones { items: unknown[]; siguiente: string | null }

/** Una página de reuniones de Fathom, con resumen, transcripción y
    accionables, creadas desde `desde`. */
export async function reunionesDesde(desde: string, cursor?: string | null): Promise<PaginaReuniones> {
  const q = new URLSearchParams({
    include_summary: "true", include_transcript: "true", include_action_items: "true",
    created_after: desde,
  });
  if (cursor) q.set("cursor", cursor);
  const r = await fathom(`/meetings?${q}`);
  if (!r.ok) throw new Error(await errorDe(r));
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

async function errorDe(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  if (r.status === 401 || r.status === 403) return "Fathom no aceptó la clave (FATHOM_API_KEY).";
  if (r.status === 429) return "Fathom pidió esperar (demasiados pedidos seguidos). Probá en un minuto.";
  return `Fathom contestó ${r.status}${t ? `: ${t.slice(0, 200)}` : ""}.`;
}
