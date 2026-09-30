/* ==================================================================
   Las grabaciones de Fathom de cada llamada (fase 4 del feedback de
   Yari): el link, el resumen, los accionables y la transcripción llegan
   solos, sin que el closer pegue nada.

   Fathom avisa por webhook cuando una reunión está lista (api/fathom/
   webhook) y lo de antes se trae por su API (api/fathom). Cada reunión se
   ata a su llamada de Calendly por el correo del invitado y la hora, como
   en Blue OS. Acá, lo que no toca la red ni la base, para poder probarlo:
   cómo se lee una reunión de Fathom y con qué llamada va.
   ================================================================== */

export interface InvitadoGrabacion { nombre?: string; email?: string; externo?: boolean }
export interface FraseGrabacion { quien: string; texto: string; t: string }
export interface AccionableGrabacion { texto: string; hecho: boolean; quien?: string; t?: string; link?: string }

/* Una fila de la tabla `grabaciones` (supabase/fathom.sql). */
export interface Grabacion {
  id: string;
  fuente: "fathom";
  recordingId: string;
  /* La llamada (sesiones.id) con la que va, si se encontró. */
  sesionId?: string | null;
  /* Cómo se ató: por el correo y la hora, o a mano. */
  emparejadaPor?: "email-y-hora" | "a-mano" | null;
  titulo: string;
  url?: string | null;
  shareUrl?: string | null;
  empieza?: string | null;
  grabadaDesde?: string | null;
  grabadaHasta?: string | null;
  grabadoPor?: string | null;
  grabadoPorNombre?: string | null;
  invitados: InvitadoGrabacion[];
  /* En markdown, como lo arma Fathom. */
  resumen?: string | null;
  transcripcion?: FraseGrabacion[] | null;
  accionables: AccionableGrabacion[];
  idioma?: string | null;
  creadoEn?: string;
  actualizadoEn?: string;
}

const texto = (...vs: unknown[]): string | undefined => {
  for (const v of vs) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
};
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Una reunión de Fathom (el webhook o un item de GET /meetings) como una
    fila de `grabaciones`. null si no trae su recording_id. */
export function leerReunion(payload: unknown): Grabacion | null {
  const p = objeto(payload);
  const m = objeto(p.meeting ?? p);
  const recordingId = texto(m.recording_id, m.id, p.recording_id, p.id);
  if (!recordingId) return null;
  const grabo = objeto(m.recorded_by);
  const resumen = objeto(m.default_summary ?? p.default_summary);
  const transcripcion = lista(m.transcript ?? p.transcript).map((x) => {
    const o = objeto(x);
    return { quien: texto(objeto(o.speaker).display_name, o.speaker_name) ?? "", texto: texto(o.text) ?? "", t: texto(o.timestamp) ?? "" };
  }).filter((x) => x.texto);
  return {
    id: `fathom_${recordingId}`,
    fuente: "fathom",
    recordingId,
    titulo: texto(m.title, m.meeting_title) ?? "Reunión de Fathom",
    url: texto(m.url) ?? null,
    shareUrl: texto(m.share_url, m.url) ?? null,
    empieza: texto(m.scheduled_start_time) ?? null,
    grabadaDesde: texto(m.recording_start_time) ?? null,
    grabadaHasta: texto(m.recording_end_time) ?? null,
    grabadoPor: texto(grabo.email)?.toLowerCase() ?? null,
    grabadoPorNombre: texto(grabo.name) ?? null,
    invitados: lista(m.calendar_invitees).map((x) => {
      const o = objeto(x);
      return { nombre: texto(o.name), email: texto(o.email)?.toLowerCase(), externo: typeof o.is_external === "boolean" ? o.is_external : undefined };
    }),
    resumen: texto(resumen.markdown_formatted) ?? null,
    transcripcion: transcripcion.length ? transcripcion : null,
    accionables: lista(m.action_items).map((x) => {
      const o = objeto(x);
      return {
        texto: texto(o.description, o.text) ?? "",
        hecho: o.completed === true,
        quien: texto(objeto(o.assignee).name),
        t: texto(o.recording_timestamp),
        link: texto(o.recording_playback_url),
      };
    }).filter((a) => a.texto),
    idioma: texto(m.transcript_language) ?? null,
    creadoEn: texto(m.created_at),
  };
}

/* ---------- con qué llamada va ---------- */

export interface LlamadaCandidata { id: string; email?: string | null; inicia: string; anfitrion?: string | null }

const MARGEN = 4 * 3600_000;
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const corto = (s: string) => sinTildes(s).split(/\s+/).slice(0, 2).join(" ");

/** La llamada de Calendly de una grabación: la del invitado (por su correo,
    sin contar los del equipo) que empieza a menos de 4 horas; si hay más de
    una, la del closer que grabó y, si no, la más cercana en el tiempo. */
export function llamadaDe(
  g: Pick<Grabacion, "empieza" | "grabadaDesde" | "creadoEn" | "invitados" | "grabadoPor" | "grabadoPorNombre">,
  llamadas: LlamadaCandidata[],
  equipo: { nombre: string; email?: string | null }[],
): string | null {
  const t = Date.parse(g.empieza ?? g.grabadaDesde ?? g.creadoEn ?? "");
  if (!Number.isFinite(t)) return null;
  const internos = new Set(equipo.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean));
  if (g.grabadoPor) internos.add(g.grabadoPor.toLowerCase());
  const externos = new Set(g.invitados.map((i) => i.email?.toLowerCase() ?? "").filter((x) => x && !internos.has(x)));
  if (externos.size === 0) return null;
  const quienGrabo = equipo.find((m) => g.grabadoPor && (m.email ?? "").trim().toLowerCase() === g.grabadoPor.toLowerCase())?.nombre
    ?? g.grabadoPorNombre ?? "";
  const candidatas = llamadas
    .filter((l) => l.email && externos.has(l.email.trim().toLowerCase()))
    .map((l) => ({ l, delta: Math.abs(Date.parse(l.inicia) - t) }))
    .filter((x) => Number.isFinite(x.delta) && x.delta <= MARGEN);
  if (candidatas.length === 0) return null;
  const esDeQuienGrabo = (a?: string | null) => Boolean(quienGrabo && a && corto(a) === corto(quienGrabo));
  candidatas.sort((a, b) => Number(esDeQuienGrabo(b.l.anfitrion)) - Number(esDeQuienGrabo(a.l.anfitrion)) || a.delta - b.delta);
  return candidatas[0].l.id;
}

/** Cuánto duró, "34 min", de lo que grabó Fathom. */
export function duracion(g: Pick<Grabacion, "grabadaDesde" | "grabadaHasta">): string {
  const d = Date.parse(g.grabadaHasta ?? "") - Date.parse(g.grabadaDesde ?? "");
  if (!Number.isFinite(d) || d <= 0) return "";
  const min = Math.round(d / 60_000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
