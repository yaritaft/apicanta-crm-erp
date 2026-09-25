import type { EstadoApp, ID, ReglaUtm, Venta } from "./types";
import { webinarDeUtm } from "./calendly";
import { proyectoDeWebinar } from "./angelo";
import { leerUtm, slugUtm, type Funnel } from "./utm-estandar";

/* ==================================================================
   De dónde viene una venta, por las UTMs.

   La venta toma su origen de los UTMs de quien compró: los de sus
   agendas de Calendly (la más reciente antes de la venta primero: el
   last touch) y los de su contacto (el first touch). Así el origen no
   depende de que el closer lo elija, y coincide con la planilla de
   finanzas (Estrategia utilizada y Proyecto).

   Con el estándar de UTMs (lib/utm-estandar.ts) casi todo sale solo:
   - la estrategia, del funnel (el prefijo de utm_campaign): webinar →
     la estrategia de webinar, vsl-yt → VSL YOUTUBE, vsl_martin → VSL
     Martin, vsl_organica → Orgánico, setter → Setter, referido →
     Referido. Clase cero y Q&A no tienen una de la planilla: se eligen
     en Ajustes → UTMs;
   - el webinar y su proyecto (WEB-dd/mm/aa), de la fecha: webinar_aaaammdd;
   - el setter, de setter_{nombre}; el referidor, de utm_content.
   Los links viejos del webinar (source Webinar + medium 23-09) también.

   Las reglas de Ajustes → UTMs mandan sobre eso: sirven para lo que no
   sigue el estándar o para cambiar la estrategia de un funnel. Una regla
   dice sólo lo que tiene que coincidir, y un valor que termina en * es
   "empieza con" (campaign clase0_* es toda clase cero). Si calzan dos,
   gana la que pide más.
   ================================================================== */

export const CAMPOS_UTM = ["source", "medium", "campaign", "content"] as const;
export type CampoUtm = typeof CAMPOS_UTM[number];
export type Utm = Partial<Record<CampoUtm, string>>;

/* {"utm_source": "Webinar"} o {"source": "Webinar"} → {source: "Webinar"} */
export function normalizarUtm(crudo?: Record<string, string> | null): Utm {
  const u: Utm = {};
  for (const [k, v] of Object.entries(crudo ?? {})) {
    const campo = k.toLowerCase().replace(/^utm_/, "") as CampoUtm;
    if ((CAMPOS_UTM as readonly string[]).includes(campo) && v?.trim()) u[campo] = v.trim();
  }
  return u;
}

/* {source: "email"} → {utm_source: "email"}: como lo guardan Calendly y Meta. */
const crudoDe = (u: Utm): Record<string, string> =>
  Object.fromEntries(Object.entries(u).filter(([, v]) => v).map(([k, v]) => [`utm_${k}`, v as string]));

/* Un valor de regla que termina en * es "empieza con". */
const calza = (regla?: string, valor?: string) => {
  const r = (regla ?? "").trim().toLowerCase();
  const v = (valor ?? "").trim().toLowerCase();
  return r.endsWith("*") ? v.startsWith(r.slice(0, -1)) : r === v;
};
const camposDe = (r: Partial<ReglaUtm>) => CAMPOS_UTM.filter((c) => r[c]?.trim());

export function reglaQueCalza(reglas: ReglaUtm[], utm: Utm): ReglaUtm | undefined {
  let mejor: ReglaUtm | undefined;
  let peso = 0;
  for (const r of reglas) {
    const campos = camposDe(r);
    if (campos.length === 0 || !campos.every((c) => calza(r[c], utm[c]))) continue;
    /* Un valor exacto pesa más que un "empieza con". */
    const p = campos.reduce((a, c) => a + (r[c]!.trim().endsWith("*") ? 1 : 2), 0);
    if (p > peso) { mejor = r; peso = p; }
  }
  return mejor;
}

/* "email · email · webinar_20260924", para mostrar una UTM en una línea. */
export function textoUtm(u: Utm): string {
  return CAMPOS_UTM.map((c) => u[c]).filter(Boolean).join(" · ") || "Sin UTM";
}

/* ---------- El estándar ---------- */

/** La estrategia de la planilla de cada funnel, si nadie la cambió con una regla. */
export function estrategiaDeFunnel(e: EstadoApp, funnel: Funnel, detalle?: string): ID | undefined {
  const por = (re: RegExp) => e.embudos.find((x) => re.test(x.nombre))?.id;
  switch (funnel) {
    case "webinar": return e.embudos.find((x) => x.esWebinar)?.id ?? por(/lanzamiento|webinar/i);
    case "vsl-yt": return por(/youtube/i);
    case "vsl":
      if (!detalle) return undefined;
      if (detalle === "organica") return por(/org[aá]nic/i);
      return e.embudos.find((x) => slugUtm(x.nombre) === `vsl-${slugUtm(detalle)}`)?.id;
    case "setter": return por(/setter/i);
    case "referido": return por(/referid/i);
    default: return undefined;
  }
}

/* setter_daniel → Daniel, del equipo; por el nombre entero o el primero. */
function setterPorNombre(e: EstadoApp, detalle: string): ID | undefined {
  const d = slugUtm(detalle);
  return e.equipo.find((x) => x.rol === "setter" && (slugUtm(x.nombre) === d || slugUtm(x.nombre.split(" ")[0]) === d))?.id;
}

/* "juan-perez" → "Juan Perez" */
const deSlug = (s: string) => s.split(/[-_]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export interface OrigenUtm {
  embudoId?: ID;
  proyecto?: string;
  webinarId?: ID;
  setterId?: ID;
  referidorNombre?: string;
  utm: Utm;
  /* De dónde salió: una regla de Ajustes o el estándar. */
  regla?: ReglaUtm;
  funnel?: Funnel;
}

/** Lo que dice una UTM del origen, o null si no dice nada. */
export function origenDe(e: EstadoApp, utm: Utm, cuando: string): OrigenUtm | null {
  const crudo = crudoDe(utm);
  const l = leerUtm(crudo);
  const o: OrigenUtm = { utm, funnel: l.funnel };
  if (l.funnel) {
    o.embudoId = estrategiaDeFunnel(e, l.funnel, l.detalle);
    if (l.funnel === "webinar") {
      const w = e.webinars.find((x) => x.id === webinarDeUtm(crudo, e.webinars, cuando));
      if (w) { o.webinarId = w.id; o.proyecto = proyectoDeWebinar(w.fecha); }
    }
    if (l.funnel === "setter" && l.detalle) o.setterId = setterPorNombre(e, l.detalle);
    if (l.funnel === "referido" && l.contenido) o.referidorNombre = deSlug(l.contenido);
  }
  const regla = reglaQueCalza(e.ajustes.reglasUtm ?? [], utm);
  if (regla) {
    o.regla = regla;
    if (regla.embudoId) o.embudoId = regla.embudoId;
    if (regla.proyecto) o.proyecto = regla.proyecto;
    if (regla.webinarId) o.webinarId = regla.webinarId;
  }
  return o.embudoId || o.webinarId || o.proyecto || o.regla ? o : null;
}

/* ---------- La persona ---------- */

/* El contacto de cualquier id de persona (lead o contacto). */
function contactoIdDe(e: EstadoApp, id: ID): ID {
  return e.leads.find((l) => l.id === id)?.contactoId ?? id;
}

/* Los UTMs de una persona, del más reciente al más viejo: sus agendas
   (hasta la fecha de la venta, si se da) y después su contacto. */
export function utmsDePersona(e: EstadoApp, idPersona: ID, hasta?: string): { utm: Utm; cuando: string }[] {
  const contactoId = contactoIdDe(e, idPersona);
  const tope = hasta ? new Date(hasta).getTime() + 12 * 3600000 : Infinity;
  const agendas = e.sesiones
    .filter((s) => (s.contactoId === contactoId || s.contactoId === idPersona) && s.utm && new Date(s.creadoEn).getTime() <= tope)
    .sort((a, b) => +new Date(b.creadoEn) - +new Date(a.creadoEn))
    .map((s) => ({ utm: normalizarUtm(s.utm), cuando: s.creadoEn }));
  const contacto = e.contactos.find((c) => c.id === contactoId);
  return [...agendas, { utm: normalizarUtm(contacto?.utm), cuando: contacto?.creadoEn ?? "" }]
    .filter((x) => Object.keys(x.utm).length > 0);
}

/** El origen de una venta: el del UTM más reciente de quien compró que diga algo. */
export function origenDeUtm(e: EstadoApp, idPersona: ID | undefined, fecha?: string): OrigenUtm | null {
  if (!idPersona) return null;
  for (const { utm, cuando } of utmsDePersona(e, idPersona, fecha)) {
    const o = origenDe(e, utm, cuando || fecha || new Date().toISOString());
    if (o) return o;
  }
  return null;
}

/* ---------- Ajustes → UTMs ---------- */

export interface UtmDetectada {
  utm: Utm;             // source + medium + campaign: lo que identifica el link
  personas: number;
  ultima: string;       // cuándo llegó la última
  origen: OrigenUtm | null;
}

/* Las UTMs con las que llegó gente, agrupadas por link (source, medium y
   campaign; el content suele ser el anuncio o el momento y abriría una
   fila por cada uno), con cuántas personas trajo y de qué quedó. */
export function utmsDetectadas(e: EstadoApp): UtmDetectada[] {
  const grupos = new Map<string, { utm: Utm; personas: Set<ID>; ultima: string }>();
  const sumar = (crudo: Record<string, string> | undefined, persona: ID, cuando: string) => {
    const u = normalizarUtm(crudo);
    if (u.source === "direct" && u.medium === "none") return;
    const link: Utm = { ...(u.source ? { source: u.source } : {}), ...(u.medium ? { medium: u.medium } : {}), ...(u.campaign ? { campaign: u.campaign } : {}) };
    if (!Object.keys(link).length) return;
    const clave = CAMPOS_UTM.map((c) => (link[c] ?? "").toLowerCase()).join("|");
    const g = grupos.get(clave) ?? { utm: link, personas: new Set<ID>(), ultima: cuando };
    g.personas.add(persona);
    if (cuando > g.ultima) g.ultima = cuando;
    grupos.set(clave, g);
  };
  for (const c of e.contactos) sumar(c.utm, c.id, c.creadoEn);
  for (const s of e.sesiones) sumar(s.utm, s.contactoId ?? s.id, s.creadoEn);

  return [...grupos.values()]
    .map((g) => ({ utm: g.utm, personas: g.personas.size, ultima: g.ultima, origen: origenDe(e, g.utm, g.ultima) }))
    .sort((a, b) => b.ultima.localeCompare(a.ultima));
}

/* Ventas a las que les falta algo del origen y que las UTMs completan. Sólo
   se llena lo que falta: lo que alguien eligió a mano no se pisa. */
export function ventasParaCompletar(e: EstadoApp): { venta: Venta; cambios: Partial<Venta> }[] {
  const out: { venta: Venta; cambios: Partial<Venta> }[] = [];
  for (const v of e.ventas) {
    if (v.embudoId && v.proyecto && v.webinarId) continue;
    const o = origenDeUtm(e, v.contactoId, v.fecha);
    if (!o) continue;
    const cambios: Partial<Venta> = {
      ...(!v.embudoId && o.embudoId ? { embudoId: o.embudoId } : {}),
      ...(!v.proyecto && o.proyecto ? { proyecto: o.proyecto } : {}),
      ...(!v.webinarId && o.webinarId ? { webinarId: o.webinarId } : {}),
      ...(!v.setterId && o.setterId ? { setterId: o.setterId } : {}),
      ...(!v.referidorNombre && o.referidorNombre ? { referidorNombre: o.referidorNombre } : {}),
    };
    if (Object.keys(cambios).length) out.push({ venta: v, cambios });
  }
  return out;
}
