import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenDeSistema } from "./meta";
import { datosDeLaPersona } from "./capi-datos";
import type { EventoCapi } from "./capi-registro";

export type { EventoCapi } from "./capi-registro";
export type { PersonaCapi } from "./capi-datos";

/* ==================================================================
   Meta Conversions API (action item de la reunión del 18/09).

   Le cuenta a Meta, desde el servidor, lo que pasa después del anuncio:
   quién se registró al webinar (Lead), quién agendó una llamada
   (Schedule) y quién compró (Purchase, con el valor). Con eso Meta
   optimiza la pauta hacia la gente que compra, no hacia la que sólo deja
   el mail, y la atribución no depende del píxel del navegador (que los
   bloqueadores y iOS cortan).

   Los datos de la persona van hasheados (SHA-256), como pide Meta. Cada
   evento lleva un event_id estable (el id del registro, de la agenda o
   de la venta): si el píxel de la landing manda el mismo, Meta los junta
   y no cuenta dos veces.

   Desde la reunión del 02/10 (F3-07) también sale el RegistroCalificado:
   quien se registra al webinar y califica (lib/capi-registro.ts). Los
   datos de la persona se normalizan y hashean en lib/capi-datos.ts.

   Variables (todas explicadas en lib/capi-estado.ts, y a la vista en
   Ajustes → Integraciones): META_PIXEL_ID, META_CAPI_TOKEN (si falta, se
   usa META_SYSTEM_TOKEN), y opcionales META_CAPI_TEST, META_CAPI_URL y
   META_CAPI_EVENTO_CALIFICADO.
   Sin píxel o sin token no se manda nada y nada se rompe.
   ================================================================== */

const VERSION = "v21.0";

const tokenCapi = () => process.env.META_CAPI_TOKEN?.trim() || tokenDeSistema();
export const capiConfigurada = () => Boolean(process.env.META_PIXEL_ID?.trim() && tokenCapi());

/** Arma el fbc con el fbclid de la URL, si la landing no mandó la cookie. */
export function fbcDeFbclid(fbclid?: string | null, cuando = Date.now()): string | undefined {
  return fbclid ? `fb.1.${cuando}.${fbclid}` : undefined;
}

/** El evento como lo pide la API (puro: se prueba sin red). */
export function eventoParaMeta(ev: EventoCapi, urlPorDefecto = process.env.META_CAPI_URL?.trim()): Record<string, unknown> | null {
  const user = datosDeLaPersona(ev.persona);
  if (Object.keys(user).length === 0) return null;
  const custom: Record<string, unknown> = { ...(ev.datos ?? {}) };
  if (ev.valor !== undefined) {
    custom.value = Math.round(ev.valor * 100) / 100;
    custom.currency = ev.moneda ?? "USD";
  }
  const origen = ev.origen ?? "website";
  /* Meta pide la página para los eventos de la web. */
  const url = ev.url || (origen === "website" ? urlPorDefecto : undefined);
  return {
    event_name: ev.nombre,
    event_time: Math.floor(new Date(ev.cuando).getTime() / 1000),
    event_id: ev.id,
    action_source: origen,
    ...(url ? { event_source_url: url } : {}),
    user_data: user,
    ...(Object.keys(custom).length ? { custom_data: custom } : {}),
  };
}

export async function enviarEventosMeta(eventos: EventoCapi[]): Promise<{ enviados: number; error?: string }> {
  const pixel = process.env.META_PIXEL_ID?.trim();
  const token = tokenCapi();
  if (!pixel || !token || eventos.length === 0) return { enviados: 0 };
  const data = eventos.map((ev) => eventoParaMeta(ev)).filter((x): x is Record<string, unknown> => x !== null);
  if (data.length === 0) return { enviados: 0 };
  const cuerpo: Record<string, unknown> = { data };
  if (process.env.META_CAPI_TEST?.trim()) cuerpo.test_event_code = process.env.META_CAPI_TEST.trim();
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    const j = (await r.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string } };
    if (!r.ok) return { enviados: 0, error: j.error?.message ?? `Meta respondió ${r.status}` };
    return { enviados: j.events_received ?? data.length };
  } catch (e) {
    return { enviados: 0, error: e instanceof Error ? e.message : "No se pudo hablar con Meta." };
  }
}

/** Manda los eventos que todavía no se mandaron y deja constancia en
 *  `capi_enviados`, así el mismo evento no se cuenta dos veces aunque pase
 *  más de lo que Meta tarda en juntar los repetidos (48 horas). Con el modo
 *  prueba (META_CAPI_TEST) no deja constancia: no cuentan. Sin la tabla
 *  (supabase/capi-enviados.sql) manda igual y confía en el event_id. */
export async function enviarEventosUnaVez(
  db: SupabaseClient | null, eventos: EventoCapi[],
): Promise<{ enviados: number; omitidos: number; error?: string }> {
  if (!capiConfigurada() || eventos.length === 0) return { enviados: 0, omitidos: 0 };
  let nuevos = eventos;
  if (db) {
    const ya = await db.from("capi_enviados").select("id").in("id", eventos.map((x) => x.id));
    if (!ya.error) {
      const hechos = new Set(((ya.data ?? []) as { id: string }[]).map((x) => x.id));
      nuevos = eventos.filter((x) => !hechos.has(x.id));
    }
  }
  if (nuevos.length === 0) return { enviados: 0, omitidos: eventos.length };
  const r = await enviarEventosMeta(nuevos);
  if (r.error) return { enviados: 0, omitidos: eventos.length - nuevos.length, error: r.error };
  if (db && !process.env.META_CAPI_TEST?.trim()) {
    const w = await db.from("capi_enviados").upsert(nuevos.map((x) => ({ id: x.id, evento: x.nombre })));
    if (w.error) console.error("[meta-capi] capi_enviados:", w.error.message);
  }
  return { enviados: r.enviados, omitidos: eventos.length - nuevos.length };
}
