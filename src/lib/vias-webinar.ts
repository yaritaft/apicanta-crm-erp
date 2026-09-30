import type { EstadoApp, Sesion, Webinar } from "./types";
import { claveDeFecha, resumirAgendas, type AgendaDelWebinar, type ViaLanzamiento } from "./agendas-webinar";
import { diaDeNegocio } from "./dia-negocio";
import { diaDelWebinar, diaUtm, leerUtm } from "./utm-estandar";

/* ==================================================================
   De dónde vinieron las agendas de un webinar y cuánto rindió cada vía:
   el vivo, el replay y el seguimiento del webinar, su clase cero y su
   Q&A. Yari (25/09): "tener esa segregación de saber de dónde vienen las
   agendas… para ver cuánto performa cada cosa que estamos haciendo".

   Las agendas son las mismas que cuenta la ficha y que completan la
   planilla (lib/agendas-webinar.ts), leídas de las llamadas de Calendly
   que ya tiene la app. Una venta del webinar es de la vía por la que
   agendó esa persona: su última agenda del lanzamiento hasta el día de la
   venta. La de quien no agendó por ningún link del lanzamiento (las de
   antes de que las agendas entraran solas, o las de alguien que llegó por
   otro lado) queda aparte, así la suma da las ventas del webinar.

   La ficha del webinar muestra la tabla de uno; el Dashboard suma la de
   los webinars de cada columna.
   ================================================================== */

/* Por qué link agendó: el del vivo, el de la grabación o el de los mails
   de después. "otro" es después sin decir cuál: los links viejos
   (PostWebinar), los que no traían utm_content o una corrección a mano. */
export type LinkVia = "vivo" | "replay" | "seguimiento" | "otro";

export const VIAS: ViaLanzamiento[] = ["webinar", "clase0", "qa"];
export const LINKS_VIA: LinkVia[] = ["vivo", "replay", "seguimiento", "otro"];

export const NOMBRE_VIA: Record<ViaLanzamiento, string> = { webinar: "Webinar", clase0: "Clase cero", qa: "Q&A" };
export const NOMBRE_LINK: Record<ViaLanzamiento, Record<LinkVia, string>> = {
  webinar: { vivo: "En el vivo", replay: "Replay", seguimiento: "Seguimiento", otro: "Después, sin decir el link" },
  clase0: { vivo: "En el vivo", replay: "Replay", seguimiento: "Seguimiento", otro: "Sin decir el link" },
  qa: { vivo: "En el vivo", replay: "Replay", seguimiento: "Seguimiento", otro: "Sin decir el link" },
};

export interface NumerosVia {
  /* Sin las canceladas, como "Llamadas en vivo" y "Llamadas después". */
  agendas: number;
  canceladas: number;
  /* De las que siguen en pie y no faltaron, las que califican. */
  calificadas: number;
  ventas: number;
  facturado: number;
  cobrado: number;
}

export interface GrupoVia {
  via: ViaLanzamiento;
  total: NumerosVia;
  /* Sólo los links que trajeron algo. */
  filas: { link: LinkVia; n: NumerosVia }[];
}

export interface RendimientoVias {
  grupos: GrupoVia[];
  /* Ventas del webinar de gente que no agendó por un link del lanzamiento. */
  sinAgenda: NumerosVia;
  total: NumerosVia;
  /* Si llegó alguna agenda con los links del lanzamiento. */
  hayAgendas: boolean;
}

export const cero = (): NumerosVia => ({ agendas: 0, canceladas: 0, calificadas: 0, ventas: 0, facturado: 0, cobrado: 0 });

function sumarA(a: NumerosVia, b: NumerosVia) {
  a.agendas += b.agendas; a.canceladas += b.canceladas; a.calificadas += b.calificadas;
  a.ventas += b.ventas; a.facturado += b.facturado; a.cobrado += b.cobrado;
}

/* ---------- Las agendas de cada webinar ---------- */

/* Las de Calendly de la app, agrupadas por el día del webinar que dice su
   link, una vez por estado: el Dashboard pide lo mismo para cada columna,
   y con miles de agendas no se puede recorrerlas todas por cada webinar.
   Los links viejos (Webinar + 23-09) van por el día y el mes. */
const CALENDLY = new WeakMap<EstadoApp, { porDia: Map<string, Sesion[]>; dias: string[]; porWebinar: Map<string, AgendaDelWebinar[]> }>();
const DIA_MES = /^(\d{1,2})[-/.](\d{1,2})$/;

function deCalendly(e: EstadoApp) {
  let c = CALENDLY.get(e);
  if (!c) {
    const dias = e.webinars.map((w) => diaUtm(w.fecha));
    const porDia = new Map<string, Sesion[]>();
    const sumar = (k: string, s: Sesion) => porDia.set(k, [...(porDia.get(k) ?? []), s]);
    for (const s of e.sesiones) {
      if (!(s.origen === "calendly" || s.calendlyInvitadoUri) || !s.utm) continue;
      const l = leerUtm(s.utm);
      const dia = diaDelWebinar(l, dias);
      if (dia) sumar(dia, s);
      else if (l.formato === "viejo") {
        const claves = new Set<string>();
        for (const x of [s.utm.utm_medium, s.utm.utm_content, s.utm.utm_campaign]) {
          const m = DIA_MES.exec((x ?? "").trim());
          if (m) claves.add(`${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
        }
        for (const k of claves) sumar(`dm:${k}`, s);
      }
    }
    c = { porDia, dias, porWebinar: new Map() };
    CALENDLY.set(e, c);
  }
  return c;
}

/** Las agendas del lanzamiento de un webinar (el webinar, su clase cero y
 *  su Q&A), como las cuenta la ficha. Sin el vivo de YouTube, las que no
 *  dicen su link se ubican por la hora con la duración de la ficha. */
export function agendasDelLanzamiento(e: EstadoApp, w: Webinar): AgendaDelWebinar[] {
  const c = deCalendly(e);
  let r = c.porWebinar.get(w.id);
  if (!r) {
    const candidatas = [...(c.porDia.get(diaUtm(w.fecha)) ?? []), ...(c.porDia.get(`dm:${claveDeFecha(w.fecha)}`) ?? [])];
    r = resumirAgendas(candidatas, w, {}, c.dias).agendas.filter((a) => !a.fuera);
    c.porWebinar.set(w.id, r);
  }
  return r;
}

/** La vía y el link de una agenda. Corregida a mano al vivo es del vivo
 *  del webinar, llegue por el link que llegue. */
export function viaYLink(a: AgendaDelWebinar): { via: ViaLanzamiento; link: LinkVia } {
  if (a.momento === "vivo" && (a.via === "webinar" || a.por === "manual")) return { via: "webinar", link: "vivo" };
  if (a.link === "replay" || a.link === "seguimiento") return { via: a.via, link: a.link };
  if (a.via !== "webinar" && (a.link === "vivo" || a.link === "EnVivo")) return { via: a.via, link: "vivo" };
  return { via: a.via, link: "otro" };
}

/* ---------- Cuánto rindió cada vía ---------- */

const RENDIMIENTO = new WeakMap<EstadoApp, Map<string, RendimientoVias>>();

function deUnWebinar(e: EstadoApp, w: Webinar): RendimientoVias {
  let porWebinar = RENDIMIENTO.get(e);
  if (!porWebinar) { porWebinar = new Map(); RENDIMIENTO.set(e, porWebinar); }
  const ya = porWebinar.get(w.id);
  if (ya) return ya;

  const numeros = new Map<string, NumerosVia>();
  const de = (via: ViaLanzamiento, link: LinkVia) => {
    const k = `${via}:${link}`;
    let n = numeros.get(k);
    if (!n) { n = cero(); numeros.set(k, n); }
    return n;
  };

  const agendas = agendasDelLanzamiento(e, w);
  const porPersona = new Map<string, AgendaDelWebinar[]>();
  for (const a of agendas) {
    const { via, link } = viaYLink(a);
    const n = de(via, link);
    if (a.cancelada) n.canceladas++;
    else {
      n.agendas++;
      if (a.estado !== "no-show" && a.calificada) n.calificadas++;
    }
    if (a.contactoId) porPersona.set(a.contactoId, [...(porPersona.get(a.contactoId) ?? []), a]);
  }

  /* Las ventas, como las cuenta el resultado del webinar (metricasDeWebinar). */
  const ventas = e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada");
  const ids = new Set(ventas.map((v) => v.id));
  const ventaDeCuota = new Map<string, string>();
  for (const c of e.cuotas) if (ids.has(c.ventaId)) ventaDeCuota.set(c.id, c.ventaId);
  const cobradoPorVenta = new Map<string, number>();
  for (const p of e.pagos) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (v) cobradoPorVenta.set(v, (cobradoPorVenta.get(v) ?? 0) + p.monto);
  }
  /* La venta apunta a la oportunidad (lead) o al contacto; las agendas, al contacto. */
  const contactoDeLead = new Map(e.leads.map((l) => [l.id, l.contactoId]));
  const sinAgenda = cero();
  for (const v of ventas) {
    const persona = v.contactoId ? contactoDeLead.get(v.contactoId) ?? v.contactoId : undefined;
    /* Hasta el final del día de la venta, en Argentina. */
    const tope = Date.parse(`${diaDeNegocio(v.fecha)}T23:59:59-03:00`);
    const suyas = (persona ? porPersona.get(persona) ?? [] : []).filter((a) => Date.parse(a.agendadaEn) <= tope);
    /* La última que siguió en pie; si las canceló todas, la última. */
    const ultima = (xs: AgendaDelWebinar[]) =>
      xs.reduce<AgendaDelWebinar | undefined>((m, a) => (!m || Date.parse(a.agendadaEn) > Date.parse(m.agendadaEn) ? a : m), undefined);
    const agenda = ultima(suyas.filter((a) => !a.cancelada)) ?? ultima(suyas);
    const vl = agenda ? viaYLink(agenda) : undefined;
    const n = vl ? de(vl.via, vl.link) : sinAgenda;
    n.ventas++;
    n.facturado += v.precioAcordado;
    n.cobrado += cobradoPorVenta.get(v.id) ?? 0;
  }

  const r = armar(numeros, sinAgenda, agendas.length > 0);
  porWebinar.set(w.id, r);
  return r;
}

function armar(numeros: Map<string, NumerosVia>, sinAgenda: NumerosVia, hayAgendas: boolean): RendimientoVias {
  const total = cero();
  const grupos = VIAS.map((via) => {
    const g: GrupoVia = { via, total: cero(), filas: [] };
    for (const link of LINKS_VIA) {
      const n = numeros.get(`${via}:${link}`);
      if (!n) continue;
      g.filas.push({ link, n });
      sumarA(g.total, n);
    }
    sumarA(total, g.total);
    return g;
  });
  sumarA(total, sinAgenda);
  return { grupos, sinAgenda, total, hayAgendas };
}

/** Cuánto rindió cada vía del lanzamiento de uno o varios webinars (sumados). */
export function rendimientoPorVia(e: EstadoApp, ws: Webinar | Webinar[]): RendimientoVias {
  const lista = Array.isArray(ws) ? ws : [ws];
  if (lista.length === 1) return deUnWebinar(e, lista[0]);
  const numeros = new Map<string, NumerosVia>();
  const sinAgenda = cero();
  let hayAgendas = false;
  for (const w of lista) {
    const r = deUnWebinar(e, w);
    hayAgendas ||= r.hayAgendas;
    sumarA(sinAgenda, r.sinAgenda);
    for (const g of r.grupos) for (const f of g.filas) {
      const k = `${g.via}:${f.link}`;
      const n = numeros.get(k) ?? cero();
      sumarA(n, f.n);
      numeros.set(k, n);
    }
  }
  return armar(numeros, sinAgenda, hayAgendas);
}

/** Los números de una vía (y un link, si se da) en un rendimiento. */
export function numerosDe(r: RendimientoVias, via: ViaLanzamiento, link?: LinkVia): NumerosVia {
  const g = r.grupos.find((x) => x.via === via);
  if (!g) return cero();
  if (!link) return g.total;
  return g.filas.find((f) => f.link === link)?.n ?? cero();
}
