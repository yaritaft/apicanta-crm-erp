import { createHash } from "node:crypto";
import { tokenDeSistema } from "./meta";

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

   Variables:
     META_PIXEL_ID      el píxel (dataset) al que van los eventos
     META_CAPI_TOKEN    el token de la Conversions API del píxel (Events
                        Manager → Configuración). Si falta, se usa
                        META_SYSTEM_TOKEN.
     META_CAPI_TEST     opcional: el código de prueba de Events Manager,
                        para ver los eventos en "Probar eventos" sin que
                        cuenten.
   Sin píxel o sin token no se manda nada y nada se rompe.
   ================================================================== */

const VERSION = "v21.0";

export const capiConfigurada = () => Boolean(process.env.META_PIXEL_ID?.trim() && tokenCapi());
const tokenCapi = () => process.env.META_CAPI_TOKEN?.trim() || tokenDeSistema();

export type EventoMeta = "Lead" | "Schedule" | "Purchase" | "CompleteRegistration";

export interface PersonaCapi {
  email?: string;
  telefono?: string;
  nombre?: string;
  pais?: string;       // ISO de dos letras, si se sabe
  externalId?: string; // el id del contacto en Apicanta
  ip?: string;
  userAgent?: string;
  fbp?: string;        // cookie _fbp de la landing
  fbc?: string;        // cookie _fbc (o armada con el fbclid)
}

export interface EventoCapi {
  nombre: EventoMeta;
  id: string;          // event_id: para no contarlo dos veces
  cuando: string;      // ISO
  url?: string;        // la página donde pasó
  persona: PersonaCapi;
  valor?: number;
  moneda?: string;
  /* website: pasó en la landing; system_generated: lo cargó el equipo (una venta). */
  origen?: "website" | "system_generated";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normal = (s?: string) => (s ?? "").trim().toLowerCase();

/* Meta pide el teléfono con código de país y sin símbolos. */
const soloDigitos = (s?: string) => (s ?? "").replace(/\D+/g, "");

function datosDe(p: PersonaCapi): Record<string, unknown> {
  const [nombre, ...resto] = normal(p.nombre).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  const d: Record<string, unknown> = {};
  if (normal(p.email)) d.em = [sha(normal(p.email))];
  if (soloDigitos(p.telefono).length >= 8) d.ph = [sha(soloDigitos(p.telefono))];
  if (nombre) d.fn = [sha(nombre)];
  if (resto.length) d.ln = [sha(resto[resto.length - 1])];
  if (p.pais && /^[a-z]{2}$/i.test(p.pais.trim())) d.country = [sha(normal(p.pais))];
  if (p.externalId) d.external_id = [sha(p.externalId)];
  if (p.ip) d.client_ip_address = p.ip;
  if (p.userAgent) d.client_user_agent = p.userAgent;
  if (p.fbp) d.fbp = p.fbp;
  if (p.fbc) d.fbc = p.fbc;
  return d;
}

/** Arma el fbc con el fbclid de la URL, si la landing no mandó la cookie. */
export function fbcDeFbclid(fbclid?: string | null, cuando = Date.now()): string | undefined {
  return fbclid ? `fb.1.${cuando}.${fbclid}` : undefined;
}

export async function enviarEventosMeta(eventos: EventoCapi[]): Promise<{ enviados: number; error?: string }> {
  const pixel = process.env.META_PIXEL_ID?.trim();
  const token = tokenCapi();
  if (!pixel || !token || eventos.length === 0) return { enviados: 0 };
  const data = eventos
    .filter((ev) => Object.keys(datosDe(ev.persona)).length > 0)
    .map((ev) => ({
      event_name: ev.nombre,
      event_time: Math.floor(new Date(ev.cuando).getTime() / 1000),
      event_id: ev.id,
      action_source: ev.origen ?? "website",
      ...(ev.url ? { event_source_url: ev.url } : {}),
      user_data: datosDe(ev.persona),
      ...(ev.valor !== undefined ? { custom_data: { value: Math.round(ev.valor * 100) / 100, currency: ev.moneda ?? "USD" } } : {}),
    }));
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
