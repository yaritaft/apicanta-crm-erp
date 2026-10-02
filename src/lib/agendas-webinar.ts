import { evaluarAgenda } from "./calificacion";
import { diaDelWebinar, diaUtm, EVENTOS, leerUtm, MOMENTOS_EVENTO, NOMBRE_FUNNEL, textoUtm } from "./utm-estandar";

/* ==================================================================
   Las agendas de Calendly de un webinar: cuáles son suyas, por qué vía
   llegaron y si se hicieron en el vivo o después.

   Es del webinar la agenda que trae su UTM. En el estándar (lib/
   utm-estandar.ts), utm_campaign=webinar_aaaammdd con la fecha entera;
   en el formato viejo, utm_source=Webinar y la fecha ("23-09") en
   utm_medium (o en utm_content, como venían los links de antes).

   También son suyas las de su clase cero y su Q&A: el lanzamiento entero
   (clase0_webinar_aaaammdd, qa_webinar_aaaammdd; los links de antes, con
   la fecha de la clase, son del último webinar hasta ese día). Cada agenda
   sabe por qué vía llegó, para ver cuánto rinde cada una (Yari, 25/09).

   Se hizo en el vivo o después según utm_content:
   - vivo (EnVivo en el viejo) → en el vivo, el link de la transmisión;
   - replay o seguimiento (PostWebinar en el viejo) → después;
   - sin eso, por la hora: hasta que terminó la transmisión, en el vivo;
     después, después.
   La clase cero y el Q&A son después del vivo del webinar, digan lo que
   digan: su "vivo" es el de la clase. Las canceladas se cuentan aparte,
   estén en el vivo o después.

   Y se puede corregir a mano (extra.atribucion en la sesión): pasar una
   agenda al vivo o a después, o sacarla del webinar. Manda sobre todo lo
   anterior; "automático" la devuelve a la regla.

   Lo usan el cron (que completa solo "Llamadas en vivo", "Llamadas
   después" y "Canceladas" de la planilla) y la ficha del webinar.
   ================================================================== */

export const CONTENIDO_VIVO = /^(en[\s_-]?)?vivo$/i;
/* El link de después del webinar: utm_content=PostWebinar (y variantes). */
export const CONTENIDO_DESPUES = /^(post[\s_-]?webinar|post|posterior|despues|después|replay|grabaci[oó]n|seguimiento)$/i;

export interface SesionCalendly {
  id: string;
  invitado?: string | null;
  creadoEn: string;
  inicia?: string | null;
  estado?: string | null;
  canal?: string | null;
  anfitrion?: string | null;
  utm?: Record<string, string> | null;
  extra?: Record<string, unknown> | null;
  /* Lo que contestó en el formulario de Calendly: de ahí sale si califica. */
  respuestas?: { pregunta: string; respuesta: string }[] | null;
  /* La persona: con esto se sabe por qué vía llegó cada venta. */
  contactoId?: string | null;
}

/* Por qué vía del lanzamiento llegó una agenda. */
export type ViaLanzamiento = "webinar" | "clase0" | "qa";

/* La corrección a mano, guardada en sesiones.extra.atribucion. */
export interface Atribucion {
  momento?: "vivo" | "despues";
  /* No es de este webinar aunque traiga sus UTMs. */
  fuera?: boolean;
  por?: string;
  en?: string;
}

export function atribucionDe(extra: Record<string, unknown> | null | undefined): Atribucion | undefined {
  const a = extra?.atribucion;
  return a && typeof a === "object" ? (a as Atribucion) : undefined;
}

/* ---------- De qué embudo vino ----------
   El badge de cada agenda: "Webinar 23-09 · EnVivo", "Webinar 23-09 · link
   viejo", "VSL · IG"… Sale de los UTMs y, si no hay, del tipo de evento. */

/* EnVivo y PostWebinar son los links viejos; vivo, replay y seguimiento, los
   del estándar. "viejo" es un link del webinar que no dice cuál es. */
export type LinkWebinar = "EnVivo" | "PostWebinar" | "viejo" | "vivo" | "replay" | "seguimiento";

const CANAL: Record<string, string> = { webinar: "Webinar", vsl: "VSL", setter: "Setter", otro: "Otro" };

export function embudoDe(s: { canal?: string | null; utm?: Record<string, string> | null }): {
  texto: string; link?: LinkWebinar; utm: string;
} {
  const u = s.utm ?? {};
  const utm = Object.entries(u).filter(([, v]) => v).map(([k, v]) => `${k.replace(/^utm_/, "")}=${v}`).join(" · ");
  /* El estándar: el funnel sale del prefijo de la campaña. En los eventos
     (webinar, clase cero, Q&A), la fecha y el link (vivo, replay,
     seguimiento) van aparte, como en el viejo. */
  const l = leerUtm(u);
  if (l.formato === "estandar" && l.funnel) {
    if (EVENTOS.includes(l.funnel)) {
      const ddmm = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
      const link = (MOMENTOS_EVENTO as readonly string[]).includes(l.contenido ?? "") ? l.contenido as LinkWebinar : undefined;
      /* "Clase cero del webinar 24-09"; los links de antes, "Clase cero 29-09". */
      const texto = l.funnel !== "webinar" && l.fechaWebinar ? `${NOMBRE_FUNNEL[l.funnel]} del webinar ${ddmm(l.fechaWebinar)}`
        : `${NOMBRE_FUNNEL[l.funnel]}${l.fecha ? ` ${ddmm(l.fecha)}` : ""}`;
      return { texto, link, utm };
    }
    return { texto: textoUtm(l) ?? NOMBRE_FUNNEL[l.funnel], utm };
  }
  /* direct / none: llegó sola, sin un link nuestro. */
  if (l.formato === "sin-utm" && u.utm_source === "direct") return { texto: CANAL[s.canal ?? ""] ? `${CANAL[s.canal ?? ""]} · directo` : "Directo", utm };
  if (/webinar/i.test(u.utm_source ?? "")) {
    const fecha = normalFecha(u.utm_medium) ?? normalFecha(u.utm_content) ?? normalFecha(u.utm_campaign);
    const c = (u.utm_content ?? "").trim();
    const link: LinkWebinar = CONTENIDO_VIVO.test(c) ? "EnVivo" : CONTENIDO_DESPUES.test(c) ? "PostWebinar" : "viejo";
    return { texto: `Webinar${fecha ? ` ${fecha}` : ""}`, link, utm };
  }
  const base = CANAL[s.canal ?? ""] ?? (u.utm_source ? u.utm_source : "Sin UTMs");
  const detalle = u.utm_source && CANAL[s.canal ?? ""] ? u.utm_source : u.utm_medium;
  return { texto: detalle && detalle !== base ? `${base} · ${detalle}` : base, utm };
}

export interface AgendaDelWebinar {
  id: string;
  /* Webinar, clase cero o Q&A de este webinar. */
  via: ViaLanzamiento;
  contactoId?: string;
  nombre: string;
  agendadaEn: string;
  llamada?: string;
  estado: string;
  closer?: string;
  momento: "vivo" | "despues";
  cancelada: boolean;
  /* Cómo se decidió: por el link (utm_content), por la hora o a mano. */
  por: "link" | "hora" | "manual";
  /* Sacada a mano del webinar: se muestra (para poder volverla), no cuenta. */
  fuera: boolean;
  embudo: string;
  link?: LinkWebinar;
  utm: string;
  corregidoPor?: string;
  /* Invierte +1000, inglés conversacional y carrera (lib/calificacion.ts). */
  calificada: boolean;
}

export interface ResumenAgendas {
  vivo: number;
  despues: number;
  canceladas: number;
  noVino: number;
  /* De las que siguen en pie (ni canceladas ni "no vino"): las que califican
     y las que no, para "Llamadas calificadas / No calificadas". */
  calificadas: number;
  noCalificadas: number;
  agendas: AgendaDelWebinar[];
}

/* "23-09": el día y el mes del webinar en Argentina, como en los UTMs. */
export function claveDeFecha(iso: string): string {
  const p = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit",
  }).formatToParts(new Date(iso));
  const d = p.find((x) => x.type === "day")?.value ?? "";
  const m = p.find((x) => x.type === "month")?.value ?? "";
  /* es-AR devuelve el mes sin cero ("9"): se completa a mano. */
  return `${d.padStart(2, "0")}-${m.padStart(2, "0")}`;
}

/* "23-09", "23/09" y "23-9" son la misma fecha. */
const normalFecha = (s: string | undefined) => {
  const m = /^(\d{1,2})[-/.](\d{1,2})$/.exec((s ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};

/* Por qué vía del lanzamiento de este webinar llegó una agenda, o null si
   no es de este webinar. `clave` es el día y mes del webinar ("24-09"),
   para el formato viejo; `dia`, la fecha entera (aaaa-mm-dd), para el
   estándar, que la trae; `dias`, los de todos los webinars, para saber
   de cuál es un link de clase cero o Q&A de antes, que sólo traía la
   fecha de la clase (sin ellos, se mira sólo este). */
export function viaDe(s: SesionCalendly, clave: string, dia: string, dias?: string[]): ViaLanzamiento | null {
  const u = s.utm ?? {};
  const l = leerUtm(u);
  if (l.formato === "estandar") {
    if (!l.funnel || !EVENTOS.includes(l.funnel)) return null;
    return diaDelWebinar(l, dias ?? [dia]) === dia ? l.funnel as ViaLanzamiento : null;
  }
  if (!/webinar/i.test(u.utm_source ?? "")) return null;
  return [u.utm_medium, u.utm_content, u.utm_campaign].some((x) => normalFecha(x) === clave) ? "webinar" : null;
}

/* `diasDeWebinars`: el día (aaaa-mm-dd) de cada webinar cargado, para los
   links de clase cero y Q&A de antes (ver viaDe). */
export function resumirAgendas(
  sesiones: SesionCalendly[],
  webinar: { fecha: string; duracionMin?: number },
  vivo: { inicio?: string | null; fin?: string | null } = {},
  diasDeWebinars?: string[],
  /* La persona de cada agenda, para que la estrella mire lo que el equipo
     le corrigió a mano (lib/perfil.ts). Sin esto, lo que contestó. */
  personaDe?: (s: SesionCalendly) => Parameters<typeof evaluarAgenda>[1],
): ResumenAgendas {
  const clave = claveDeFecha(webinar.fecha);
  const dia = diaUtm(webinar.fecha);
  const inicio = vivo.inicio ?? webinar.fecha;
  /* Si el vivo no terminó (o no se siguió), el fin es el que dice la ficha. */
  const fin = vivo.fin ?? new Date(+new Date(inicio) + (webinar.duracionMin || 180) * 60_000).toISOString();

  const agendas: AgendaDelWebinar[] = sesiones
    .map((s) => ({ s, via: viaDe(s, clave, dia, diasDeWebinars) }))
    .filter((x): x is { s: SesionCalendly; via: ViaLanzamiento } => x.via !== null)
    .map(({ s, via }) => {
      const contenido = (s.utm?.utm_content ?? "").trim();
      const a = atribucionDe(s.extra);
      const e = embudoDe(s);
      let momento: AgendaDelWebinar["momento"];
      let por: AgendaDelWebinar["por"] = "link";
      if (a?.momento) { momento = a.momento; por = "manual"; }
      /* La clase cero y el Q&A son después del vivo del webinar. */
      else if (via !== "webinar") momento = "despues";
      else if (CONTENIDO_VIVO.test(contenido)) momento = "vivo";
      else if (CONTENIDO_DESPUES.test(contenido)) momento = "despues";
      else { momento = +new Date(s.creadoEn) <= +new Date(fin) ? "vivo" : "despues"; por = "hora"; }
      return {
        fuera: Boolean(a?.fuera),
        embudo: e.texto,
        link: e.link,
        utm: e.utm,
        corregidoPor: a && (a.momento || a.fuera) ? a.por : undefined,
        id: s.id,
        via,
        contactoId: s.contactoId ?? undefined,
        nombre: s.invitado || "Sin nombre",
        agendadaEn: s.creadoEn,
        llamada: s.inicia ?? undefined,
        estado: s.estado ?? "agendada",
        closer: s.anfitrion ?? undefined,
        momento,
        cancelada: s.estado === "cancelada",
        por,
        calificada: evaluarAgenda(s, personaDe?.(s)).calificada,
      };
    })
    .sort((a, b) => +new Date(b.agendadaEn) - +new Date(a.agendadaEn));

  const cuentan = agendas.filter((a) => !a.fuera);
  return {
    vivo: cuentan.filter((a) => !a.cancelada && a.momento === "vivo").length,
    despues: cuentan.filter((a) => !a.cancelada && a.momento === "despues").length,
    canceladas: cuentan.filter((a) => a.cancelada).length,
    noVino: cuentan.filter((a) => a.estado === "no-show").length,
    calificadas: cuentan.filter((a) => !a.cancelada && a.estado !== "no-show" && a.calificada).length,
    noCalificadas: cuentan.filter((a) => !a.cancelada && a.estado !== "no-show" && !a.calificada).length,
    agendas,
  };
}
