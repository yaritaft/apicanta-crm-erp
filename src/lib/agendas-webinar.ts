/* ==================================================================
   Las agendas de Calendly de un webinar: cuáles son suyas y si se
   hicieron en el vivo o después.

   Es del webinar la agenda que trae utm_source=Webinar y la fecha del
   webinar ("23-09") en utm_medium (o en utm_content, como venían los
   links viejos). Se hizo en el vivo o después según utm_content:
   - EnVivo → en el vivo (el link que se muestra durante la transmisión);
   - PostWebinar → después (el link del seguimiento);
   - sin eso, por la hora: hasta que terminó la transmisión, en el vivo;
     después, después.
   Las canceladas se cuentan aparte, estén en el vivo o después.

   Lo usan el cron (que completa solo "Llamadas en vivo", "Llamadas
   después" y "Canceladas" de la planilla) y la ficha del webinar.
   ================================================================== */

export const CONTENIDO_VIVO = /^en[\s_-]?vivo$/i;
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
}

export interface AgendaDelWebinar {
  id: string;
  nombre: string;
  agendadaEn: string;
  llamada?: string;
  estado: string;
  closer?: string;
  momento: "vivo" | "despues";
  cancelada: boolean;
  /* Cómo se decidió el momento: por el link (utm_content) o por la hora. */
  por: "link" | "hora";
}

export interface ResumenAgendas {
  vivo: number;
  despues: number;
  canceladas: number;
  noVino: number;
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

export function esDelWebinar(s: SesionCalendly, clave: string): boolean {
  const u = s.utm ?? {};
  if (!/webinar/i.test(u.utm_source ?? "")) return false;
  return [u.utm_medium, u.utm_content, u.utm_campaign].some((x) => normalFecha(x) === clave);
}

export function resumirAgendas(
  sesiones: SesionCalendly[],
  webinar: { fecha: string; duracionMin?: number },
  vivo: { inicio?: string | null; fin?: string | null } = {},
): ResumenAgendas {
  const clave = claveDeFecha(webinar.fecha);
  const inicio = vivo.inicio ?? webinar.fecha;
  /* Si el vivo no terminó (o no se siguió), el fin es el que dice la ficha. */
  const fin = vivo.fin ?? new Date(+new Date(inicio) + (webinar.duracionMin || 180) * 60_000).toISOString();

  const agendas: AgendaDelWebinar[] = sesiones
    .filter((s) => esDelWebinar(s, clave))
    .map((s) => {
      const contenido = (s.utm?.utm_content ?? "").trim();
      let momento: AgendaDelWebinar["momento"];
      let por: AgendaDelWebinar["por"] = "link";
      if (CONTENIDO_VIVO.test(contenido)) momento = "vivo";
      else if (CONTENIDO_DESPUES.test(contenido)) momento = "despues";
      else { momento = +new Date(s.creadoEn) <= +new Date(fin) ? "vivo" : "despues"; por = "hora"; }
      return {
        id: s.id,
        nombre: s.invitado || "Sin nombre",
        agendadaEn: s.creadoEn,
        llamada: s.inicia ?? undefined,
        estado: s.estado ?? "agendada",
        closer: s.anfitrion ?? undefined,
        momento,
        cancelada: s.estado === "cancelada",
        por,
      };
    })
    .sort((a, b) => +new Date(b.agendadaEn) - +new Date(a.agendadaEn));

  return {
    vivo: agendas.filter((a) => !a.cancelada && a.momento === "vivo").length,
    despues: agendas.filter((a) => !a.cancelada && a.momento === "despues").length,
    canceladas: agendas.filter((a) => a.cancelada).length,
    noVino: agendas.filter((a) => a.estado === "no-show").length,
    agendas,
  };
}
