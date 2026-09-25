/* ==================================================================
   Calendly: el cliente de la API y cómo se traduce una agenda a lo
   nuestro.

   Una agenda de Calendly trae más que una llamada: el tipo de evento dice
   el canal ("Llamada de Asesoramiento - Webinar / VSL / Setter"), el
   formulario califica a la persona (inglés, años programando, lenguajes,
   sueldo) y los UTMs dicen de qué embudo vino (`Webinar` + la fecha del
   webinar, `Resell`, `setter-ia`, orgánico de Instagram).

   Lo que NO trae es el anuncio de Meta: los UTMs de Calendly identifican el
   embudo, no el anuncio. Ese dato nace antes, en el registro de la landing.

   Lo puro de este archivo (la traducción) sirve en cualquier lado; las
   llamadas a la API usan CALENDLY_TOKEN y sólo corren en el servidor.
   ================================================================== */

import type { CanalOrigen, EstadoSesion, NivelIngles } from "./types";
import { leerUtm } from "./utm-estandar";

const API = "https://api.calendly.com";

/* Cloudflare, delante de la API, contesta 403 a los pedidos que llegan con
   el User-Agent por defecto de Node o de Python. Con uno propio pasa. */
const UA = "apicanta-erp/1.0 (+https://apicanta-erp.vercel.app)";

export const hayCalendly = () => Boolean(process.env.CALENDLY_TOKEN);

export async function calendly<T>(ruta: string): Promise<T> {
  const token = process.env.CALENDLY_TOKEN;
  if (!token) throw new Error("Falta CALENDLY_TOKEN.");
  const r = await fetch(ruta.startsWith("http") ? ruta : API + ruta, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) {
    const cuerpo = (await r.text()).slice(0, 300);
    throw new Error(`Calendly ${r.status} en ${ruta.replace(API, "")}: ${cuerpo}`);
  }
  return (await r.json()) as T;
}

/* ---------- Lo que devuelve la API (sólo lo que usamos) ---------- */

export interface InvitadoCalendly {
  uri: string;
  email: string;
  name: string;
  status: "active" | "canceled";
  event: string;
  created_at: string;
  updated_at: string;
  questions_and_answers?: { question: string; answer: string; position?: number }[];
  tracking?: Partial<Record<"utm_campaign" | "utm_source" | "utm_medium" | "utm_content" | "utm_term", string | null>>;
  text_reminder_number?: string | null;
  rescheduled?: boolean;
  old_invitee?: string | null;
  cancellation?: { reason?: string | null; created_at?: string | null } | null;
  no_show?: { created_at?: string } | null;
}

export interface EventoCalendly {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
  location?: { type?: string; location?: string | null; join_url?: string | null } | null;
  event_memberships?: { user_name?: string; user_email?: string }[];
}

/* ---------- Ids fijos ----------

   Derivados del uuid del invitado: volver a traer la misma agenda (el cron
   la repesca, Calendly reintenta el webhook) la pisa en vez de duplicarla.
   La persona y su primera oportunidad comparten id, igual que en la
   migración de contactos. */

export const uuidDe = (uri: string): string => uri.split("/").filter(Boolean).pop() ?? uri;
export const idSesionCalendly = (invitadoUri: string) => `cal_${uuidDe(invitadoUri)}`;
export const idPersonaCalendly = (invitadoUri: string) => `lea_cal_${uuidDe(invitadoUri)}`;

/* ---------- La traducción ---------- */

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function canalDeEvento(nombreEvento: string): CanalOrigen {
  const t = sinTildes(nombreEvento);
  if (t.includes("webinar")) return "webinar";
  if (t.includes("vsl")) return "vsl";
  if (t.includes("setter")) return "setter";
  return "otro";
}

export const ETIQUETA_CANAL: Record<CanalOrigen, string> = {
  webinar: "Webinar", vsl: "VSL", setter: "Setter", otro: "Otro",
};

export function respuestasDe(inv: InvitadoCalendly): { pregunta: string; respuesta: string }[] {
  return (inv.questions_and_answers ?? [])
    .filter((q) => q.answer && q.answer.trim() !== "")
    .map((q) => ({ pregunta: q.question.trim(), respuesta: q.answer.trim() }));
}

export function respuestaA(lista: { pregunta: string; respuesta: string }[], patron: RegExp): string | undefined {
  return lista.find((q) => patron.test(sinTildes(q.pregunta)))?.respuesta;
}

/* El formulario pregunta el inglés en texto libre ("Conversacional aunque
   cometo errores", "Nivel básico NO CONVERSACIONAL", "Muy bueno, ningún
   problema"). El ORDEN de las reglas importa: "no conversacional" tiene que
   ganarle a "conversacional", y "muy bueno, ningún problema" no puede caer en
   "ninguno" por contener "ningún". Lo que no se entiende queda sin nivel; el
   texto original se guarda igual en las respuestas de la llamada. */
export function nivelDeIngles(texto?: string): NivelIngles | undefined {
  if (!texto) return undefined;
  const t = sinTildes(texto);
  if (/no conversacional/.test(t)) return "basico";
  if (/(nativ|bilingu)/.test(t)) return "nativo";
  if (/(avanzado|fluido|fluent|muy bueno|excelente|\bc1\b|\bc2\b|b2\+|conversacional)/.test(t)) return "conversacional";
  if (/(intermedio|\bb1\b|\bb2\b|medio)/.test(t)) return "intermedio";
  if (/(basico|bajo|poco|\ba1\b|\ba2\b|principiante)/.test(t)) return "basico";
  if (/(nada|cero|^0$|\b0\b|no hablo|ninguno)/.test(t)) return "ninguno";
  return undefined;
}

/* "3", "3 años", "Hace 4 años", "menos de 1", "1 año y medio", "no trabajo". */
export function aniosDeTexto(texto?: string): number | undefined {
  if (!texto) return undefined;
  const t = sinTildes(texto);
  if (/menos de (un|1)\b/.test(t)) return 0;
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (m) {
    const n = Math.floor(parseFloat(m[1].replace(",", ".")));
    return Number.isFinite(n) && n >= 0 && n <= 60 ? n : undefined;
  }
  if (/(nunca|no trabajo|ninguno|nada|todavia no)/.test(t)) return 0;
  return undefined;
}

export function utmDe(tracking: InvitadoCalendly["tracking"]): Record<string, string> | undefined {
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = tracking?.[k];
    if (v && v.trim() !== "") utm[k] = v.trim();
  }
  return Object.keys(utm).length ? utm : undefined;
}

/* De qué webinar es una agenda. En el estándar (lib/utm-estandar.ts),
   utm_campaign=webinar_20260909 es el webinar de ese día. En el formato
   viejo, `utm_source=Webinar` + `utm_medium=09-09` es el del 9 de
   septiembre: si hay varios con ese día y mes (años distintos), el más
   cercano a la fecha de la agenda. */
const FORMATO_DIA_AR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
});
function diaArgentina(fecha: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? "" : FORMATO_DIA_AR.format(d);
}

export function webinarDeUtm(
  utm: Record<string, string> | undefined,
  webinars: { id: string; fecha: string }[],
  cuando: string,
): string | undefined {
  if (!utm) return undefined;
  const l = leerUtm(utm);
  if (l.formato === "estandar") {
    if (l.funnel !== "webinar" || !l.fecha) return undefined;
    return webinars.find((w) => diaArgentina(w.fecha ?? "") === l.fecha)?.id;
  }
  if (!/webinar/i.test(utm.utm_source ?? "")) return undefined;
  const m = (utm.utm_medium ?? utm.utm_content ?? "").match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return undefined;
  const dia = Number(m[1]), mes = Number(m[2]);
  const ref = new Date(cuando).getTime();
  /* El día del webinar en Argentina, no en UTC: uno a las 21:00 ya es el
     día siguiente en el ISO y no calzaba con el "09-09" del UTM. */
  const candidatos = webinars.filter((w) => {
    const [, mm, dd] = diaArgentina(w.fecha ?? "").split("-").map(Number);
    return mm === mes && dd === dia;
  });
  candidatos.sort((a, b) => Math.abs(new Date(a.fecha).getTime() - ref) - Math.abs(new Date(b.fecha).getTime() - ref));
  return candidatos[0]?.id;
}

/* Calendly sabe dos cosas del resultado: si se canceló y si el anfitrión la
   marcó como no-show. Que se hizo lo marca el equipo en la Agenda. */
export function estadoDe(inv: InvitadoCalendly): EstadoSesion | undefined {
  if (inv.status === "canceled") return "cancelada";
  if (inv.no_show) return "no-show";
  return undefined;
}

export function anfitrionDe(ev: EventoCalendly): string | undefined {
  const h = ev.event_memberships?.[0];
  return h?.user_name || h?.user_email || undefined;
}

export function enlaceDe(ev: EventoCalendly): string | undefined {
  const l = ev.location?.join_url || ev.location?.location || "";
  return /^https?:\/\//.test(l) ? l : undefined;
}
