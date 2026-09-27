import type { EstadoApp, ID, Venta, Webinar } from "./types";
import { webinarDeProyecto } from "./angelo";
import { origenDeUtm } from "./utms";
import { diaDeNegocio } from "@/components/ui/DateRangePicker";

/* ==================================================================
   Qué webinar trajo cada venta.

   Sin el webinar atado, el profit y el ROAS de cada webinar dan vacío. Las
   ventas de la planilla de Angelo lo decían con el proyecto (WEB-13/04/26)
   hasta abril; desde mayo el embudo de webinar ("Lanzamiento") va con MENT
   o DOWN y el webinar no queda escrito. Se busca en este orden:

   1. El proyecto WEB-día/mes, si lo tiene.
   2. Los UTMs de quien compró (sus agendas de Calendly).
   3. La fecha: una venta del embudo de webinar es del último webinar
      anterior a la venta (por día de Argentina: lo vendido durante el vivo
      es de ese vivo), hasta que empieza el siguiente y no más de 21 días.

   Sólo se llena lo que falta: un webinar elegido a mano no se pisa.
   ================================================================== */

export type MotivoWebinar = "proyecto" | "utm" | "fecha";

export interface VentaParaAtar { venta: Venta; webinarId: ID; motivo: MotivoWebinar }

/* Los días que una venta sigue siendo del último webinar si no hubo otro. */
const DIAS_DEL_WEBINAR = 21;

/** Los embudos de webinar: los marcados así en Ajustes o, si ninguno, los
 *  que se llaman webinar o lanzamiento (el nombre de la planilla). */
export function embudosDeWebinar(e: EstadoApp): Set<ID> {
  const marcados = e.embudos.filter((x) => x.esWebinar);
  return new Set((marcados.length ? marcados : e.embudos.filter((x) => /webinar|lanzamiento/i.test(x.nombre))).map((x) => x.id));
}

export function webinarPorFecha(webinars: Webinar[], fechaVenta: string): Webinar | undefined {
  const dia = diaDeNegocio(fechaVenta);
  const orden = [...webinars].filter((w) => w.estado !== "borrador")
    .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha));
  let elegido: Webinar | undefined;
  for (const w of orden) {
    if (diaDeNegocio(w.fecha) <= dia) elegido = w; else break;
  }
  if (!elegido) return undefined;
  const dias = (new Date(`${dia}T12:00:00Z`).getTime() - new Date(`${diaDeNegocio(elegido.fecha)}T12:00:00Z`).getTime()) / 86400000;
  return dias <= DIAS_DEL_WEBINAR ? elegido : undefined;
}

export function ventasParaAtar(e: EstadoApp): VentaParaAtar[] {
  if (e.webinars.length === 0) return [];
  const deWebinar = embudosDeWebinar(e);
  const out: VentaParaAtar[] = [];
  for (const v of e.ventas) {
    if (v.webinarId && e.webinars.some((w) => w.id === v.webinarId)) continue;
    const porProyecto = webinarDeProyecto(v.proyecto, e.webinars, v.fecha);
    if (porProyecto) { out.push({ venta: v, webinarId: porProyecto.id, motivo: "proyecto" }); continue; }
    const porUtm = origenDeUtm(e, v.contactoId, v.fecha)?.webinarId;
    if (porUtm) { out.push({ venta: v, webinarId: porUtm, motivo: "utm" }); continue; }
    if (!v.embudoId || !deWebinar.has(v.embudoId)) continue;
    /* Un proyecto WEB- que no es de ningún webinar cargado no se adivina por fecha. */
    if (/^WEB-/i.test(v.proyecto ?? "")) continue;
    const porFecha = webinarPorFecha(e.webinars, v.fecha);
    if (porFecha) out.push({ venta: v, webinarId: porFecha.id, motivo: "fecha" });
  }
  return out;
}

/* ---------- Los webinars viejos de la planilla ----------
   Los proyectos WEB-día/mes de las ventas que no son de ningún webinar
   cargado: cada uno es un webinar que pasó. Sin año (WEB-1/10), el año sale
   de la primera venta: el vivo es ese día o antes. */

export interface WebinarDeProyecto { proyecto: string; fecha: string; ventas: number }

export function webinarsQueFaltan(e: EstadoApp): WebinarDeProyecto[] {
  const grupos = new Map<string, { ventas: Venta[] }>();
  for (const v of e.ventas) {
    const p = (v.proyecto ?? "").trim();
    if (!/^WEB-\d{1,2}\/\d{1,2}(\/\d{2,4})?$/i.test(p)) continue;
    if (webinarDeProyecto(p, e.webinars, v.fecha)) continue;
    const g = grupos.get(p.toUpperCase()) ?? { ventas: [] };
    g.ventas.push(v);
    grupos.set(p.toUpperCase(), g);
  }
  const out: WebinarDeProyecto[] = [];
  for (const [proyecto, g] of grupos) {
    const m = /^WEB-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i.exec(proyecto)!;
    const dia = Number(m[1]), mes = Number(m[2]);
    const primera = g.ventas.map((v) => diaDeNegocio(v.fecha)).sort()[0];
    let anio = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(primera.slice(0, 4));
    const iso = (a: number) => `${a}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    /* Sin año: si el vivo quedaría más de dos meses después de la primera
       venta, es del año anterior (una venta de enero de un webinar de diciembre). */
    if (!m[3] && new Date(iso(anio)).getTime() - new Date(primera).getTime() > 60 * 86400000) anio -= 1;
    /* A las 19 de Argentina, como los vivos de siempre. */
    out.push({ proyecto, fecha: `${iso(anio)}T22:00:00.000Z`, ventas: g.ventas.length });
  }
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** El webinar que se crea para un proyecto viejo: finalizado, con los
 *  números del embudo en cero para cargar desde el tracker de Yari. */
export function webinarNuevoDeProyecto(w: WebinarDeProyecto, id: ID, creadoEn: string): Webinar {
  const d = new Date(w.fecha);
  const fecha = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  return {
    id, titulo: `Taller ${fecha} - Yari Taft`, fecha: w.fecha, duracionMin: 120, estado: "finalizado",
    registrados: 0, asistentes: 0, inversion: 0, formularios: 0, grupoWpp: 0,
    llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0,
    llamadasNoCalificadas: 0, llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0,
    notas: `Creado desde la planilla de Angelo (proyecto ${w.proyecto}). Faltan la pauta y los números del embudo: cargalos desde tu tracker.`,
    creadoEn, extra: { origen: "planilla-angelo", proyecto: w.proyecto },
  };
}
