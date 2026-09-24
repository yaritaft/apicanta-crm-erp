import type { EstadoApp, ID, ReglaUtm, Venta } from "./types";
import { webinarDeUtm } from "./calendly";
import { proyectoDeWebinar } from "./angelo";

/* ==================================================================
   De dónde viene una venta, por las UTMs.

   Cada link que se arma (el del webinar de hoy, el de un setter, el de
   una campaña) lleva sus UTMs. En Ajustes → UTMs se dice de qué
   estrategia, proyecto y webinar es cada una, y la venta toma su origen
   de ahí con los UTMs de quien compró: los de sus agendas de Calendly
   (la más reciente antes de la venta primero) y los de su contacto. Así
   el origen no depende de que el closer lo elija, y coincide con la
   planilla de finanzas (Estrategia utilizada y Proyecto).

   Una regla dice sólo lo que tiene que coincidir: source "Webinar" +
   medium "23-09" es el webinar del 23/09, venga del anuncio que venga.
   Si calzan dos, gana la que pide más cosas.
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

const igual = (a?: string, b?: string) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const camposDe = (r: Partial<ReglaUtm>) => CAMPOS_UTM.filter((c) => r[c]?.trim());

export function reglaQueCalza(reglas: ReglaUtm[], utm: Utm): ReglaUtm | undefined {
  let mejor: ReglaUtm | undefined;
  let pide = 0;
  for (const r of reglas) {
    const campos = camposDe(r);
    if (campos.length === 0 || !campos.every((c) => igual(r[c], utm[c]))) continue;
    if (campos.length > pide) { mejor = r; pide = campos.length; }
  }
  return mejor;
}

/* "Webinar · 23-09", para mostrar una UTM en una línea. */
export function textoUtm(u: Utm): string {
  return CAMPOS_UTM.map((c) => u[c]).filter(Boolean).join(" · ") || "Sin UTM";
}

/* El contacto de cualquier id de persona (lead o contacto). */
function contactoIdDe(e: EstadoApp, id: ID): ID {
  return e.leads.find((l) => l.id === id)?.contactoId ?? id;
}

/* Los UTMs de una persona, del más reciente al más viejo: sus agendas
   (hasta la fecha de la venta, si se da) y después su contacto. */
export function utmsDePersona(e: EstadoApp, idPersona: ID, hasta?: string): Utm[] {
  const contactoId = contactoIdDe(e, idPersona);
  const tope = hasta ? new Date(hasta).getTime() + 12 * 3600000 : Infinity;
  const agendas = e.sesiones
    .filter((s) => (s.contactoId === contactoId || s.contactoId === idPersona) && s.utm && new Date(s.creadoEn).getTime() <= tope)
    .sort((a, b) => +new Date(b.creadoEn) - +new Date(a.creadoEn))
    .map((s) => normalizarUtm(s.utm));
  const contacto = e.contactos.find((c) => c.id === contactoId);
  return [...agendas, normalizarUtm(contacto?.utm)].filter((u) => Object.keys(u).length > 0);
}

/* El origen de una venta según las reglas: el UTM más reciente de quien
   compró que calce con alguna. */
export function origenDeUtm(e: EstadoApp, idPersona: ID | undefined, fecha?: string): { regla: ReglaUtm; utm: Utm } | null {
  if (!idPersona) return null;
  for (const utm of utmsDePersona(e, idPersona, fecha)) {
    const regla = reglaQueCalza(e.ajustes.reglasUtm ?? [], utm);
    if (regla) return { regla, utm };
  }
  return null;
}

/* Lo que la venta toma de la regla: sólo lo que la regla dice. */
export function origenDeRegla(r: ReglaUtm): Pick<Venta, "embudoId" | "proyecto" | "webinarId"> {
  return {
    embudoId: r.embudoId || undefined,
    proyecto: r.proyecto || undefined,
    webinarId: r.webinarId || undefined,
  };
}

/* Para una UTM de webinar (source "Webinar" + la fecha en medium), lo que
   habría que asignarle: el webinar de ese día, su proyecto y la
   estrategia marcada como de webinar. Para las demás, nada. */
export function sugerenciaPara(e: EstadoApp, utm: Utm, cuando: string): Partial<ReglaUtm> | undefined {
  const webinarId = webinarDeUtm(
    { utm_source: utm.source ?? "", utm_medium: utm.medium ?? "", ...(utm.content ? { utm_content: utm.content } : {}) },
    e.webinars, cuando,
  );
  if (!webinarId) return undefined;
  const w = e.webinars.find((x) => x.id === webinarId);
  const estrategia = e.embudos.find((x) => x.esWebinar) ?? e.embudos.find((x) => /webinar|lanzamiento/i.test(x.nombre));
  return { webinarId, proyecto: w ? proyectoDeWebinar(w.fecha) : undefined, embudoId: estrategia?.id };
}

export interface UtmDetectada {
  utm: Utm;             // source + medium + campaign: lo que identifica el link
  personas: number;
  ultima: string;       // cuándo llegó la última
  regla?: ReglaUtm;
  sugerida?: Partial<ReglaUtm>;
}

/* Las UTMs con las que llegó gente, agrupadas por link (source, medium y
   campaign; el content suele ser el anuncio y abriría una fila por cada
   uno), con cuántas personas trajo y la regla que las cubre. */
export function utmsDetectadas(e: EstadoApp): UtmDetectada[] {
  const grupos = new Map<string, { utm: Utm; personas: Set<ID>; ultima: string }>();
  const sumar = (crudo: Record<string, string> | undefined, persona: ID, cuando: string) => {
    const u = normalizarUtm(crudo);
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

  const reglas = e.ajustes.reglasUtm ?? [];
  return [...grupos.values()]
    .map((g) => {
      const regla = reglaQueCalza(reglas, g.utm);
      return {
        utm: g.utm, personas: g.personas.size, ultima: g.ultima, regla,
        sugerida: regla ? undefined : sugerenciaPara(e, g.utm, g.ultima),
      };
    })
    .sort((a, b) => b.ultima.localeCompare(a.ultima));
}

/* Ventas a las que les falta algo del origen y que una regla completa. Sólo
   se llena lo que falta: lo que alguien eligió a mano no se pisa. */
export function ventasParaCompletar(e: EstadoApp): { venta: Venta; cambios: Partial<Venta> }[] {
  const out: { venta: Venta; cambios: Partial<Venta> }[] = [];
  for (const v of e.ventas) {
    if (v.embudoId && v.proyecto && v.webinarId) continue;
    const o = origenDeUtm(e, v.contactoId, v.fecha);
    if (!o) continue;
    const de = origenDeRegla(o.regla);
    const cambios: Partial<Venta> = {
      ...(!v.embudoId && de.embudoId ? { embudoId: de.embudoId } : {}),
      ...(!v.proyecto && de.proyecto ? { proyecto: de.proyecto } : {}),
      ...(!v.webinarId && de.webinarId ? { webinarId: de.webinarId } : {}),
    };
    if (Object.keys(cambios).length) out.push({ venta: v, cambios });
  }
  return out;
}
