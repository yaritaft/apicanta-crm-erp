import type { EstadoApp, Meta, MetricaClave } from "./types";
import { inicioSemana, mesClave, nombreMes } from "./format";

/* Todo lo que la app calcula vive acá: una sola fuente de verdad
   para los números del panel, finanzas, marketing y metas. */

export interface RangoMes { clave: string; etiqueta: string; desde: Date; hasta: Date }

export function ultimosMeses(n: number): RangoMes[] {
  const hoy = new Date();
  const out: RangoMes[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0, 23, 59, 59);
    out.push({ clave: mesClave(desde), etiqueta: nombreMes(mesClave(desde)), desde, hasta });
  }
  return out;
}

const enMes = (iso: string, m: RangoMes) => {
  const d = new Date(iso).getTime();
  return d >= m.desde.getTime() && d <= m.hasta.getTime();
};

/* ---------- Finanzas ---------- */

export function ingresosMes(e: EstadoApp, m: RangoMes, soloPagado = false): number {
  return e.transacciones
    .filter((t) => t.tipo === "ingreso" && enMes(t.fecha, m) && (!soloPagado || t.estado === "pagado"))
    .reduce((a, t) => a + t.monto, 0);
}

export function egresosMes(e: EstadoApp, m: RangoMes): number {
  return e.transacciones
    .filter((t) => t.tipo === "egreso" && enMes(t.fecha, m))
    .reduce((a, t) => a + t.monto, 0);
}

export function porCobrar(e: EstadoApp): number {
  return e.transacciones
    .filter((t) => t.tipo === "ingreso" && t.estado !== "pagado")
    .reduce((a, t) => a + t.monto, 0);
}

export function mrr(e: EstadoApp): number {
  return e.alumnos.filter((a) => a.estado === "activo").reduce((a, x) => a + x.cuotaMensual, 0);
}

/* ---------- Leads y pipeline ---------- */

export function leadsMes(e: EstadoApp, m: RangoMes) {
  return e.leads.filter((l) => enMes(l.creadoEn, m));
}

export function inscriptosMes(e: EstadoApp, m: RangoMes) {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  return e.leads.filter((l) => l.etapaId === ganada && enMes(l.actualizadoEn, m));
}

export function valorPipeline(e: EstadoApp): { bruto: number; ponderado: number } {
  const abiertas = e.etapas.filter((x) => !x.esGanada && !x.esPerdida).map((x) => x.id);
  let bruto = 0, ponderado = 0;
  for (const l of e.leads) {
    if (!abiertas.includes(l.etapaId)) continue;
    const et = e.etapas.find((x) => x.id === l.etapaId);
    bruto += l.monto;
    ponderado += l.monto * ((et?.probabilidad ?? 0) / 100);
  }
  return { bruto, ponderado };
}

export function tasaConversion(e: EstadoApp): number {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  const cerrados = e.leads.filter((l) => {
    const et = e.etapas.find((x) => x.id === l.etapaId);
    return et?.esGanada || et?.esPerdida;
  });
  if (cerrados.length === 0) return 0;
  return (cerrados.filter((l) => l.etapaId === ganada).length / cerrados.length) * 100;
}

export function leadsSinContactar(e: EstadoApp) {
  const primera = [...e.etapas].sort((a, b) => a.orden - b.orden)[0]?.id;
  return e.leads.filter((l) => l.etapaId === primera);
}

/* ---------- Agenda ---------- */

export function sesionesSemana(e: EstadoApp) {
  const desde = inicioSemana(new Date());
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 7);
  return e.sesiones.filter((s) => {
    const d = new Date(s.inicia);
    return d >= desde && d < hasta;
  });
}

export function proximasSesiones(e: EstadoApp, limite = 6) {
  const ahora = Date.now();
  return e.sesiones
    .filter((s) => s.estado === "agendada" && new Date(s.inicia).getTime() >= ahora - 3600000)
    .sort((a, b) => +new Date(a.inicia) - +new Date(b.inicia))
    .slice(0, limite);
}

export function tasaShow(e: EstadoApp): number {
  const pasadas = e.sesiones.filter((s) => s.estado === "hecha" || s.estado === "no-show");
  if (pasadas.length === 0) return 0;
  return (pasadas.filter((s) => s.estado === "hecha").length / pasadas.length) * 100;
}

/* ---------- Marketing ---------- */

export function inversionTotal(e: EstadoApp): number {
  return e.campanias.reduce((a, c) => a + c.inversion, 0);
}

export function leadsDeCampanias(e: EstadoApp): number {
  return e.campanias.reduce((a, c) => a + c.leads, 0);
}

export function cpl(e: EstadoApp): number {
  const l = leadsDeCampanias(e);
  return l > 0 ? inversionTotal(e) / l : 0;
}

export function cac(e: EstadoApp): number {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  const ins = e.leads.filter((l) => l.etapaId === ganada).length;
  return ins > 0 ? inversionTotal(e) / ins : 0;
}

export function roas(e: EstadoApp): number {
  const inv = inversionTotal(e);
  if (inv === 0) return 0;
  const ingresos = e.transacciones.filter((t) => t.tipo === "ingreso").reduce((a, t) => a + t.monto, 0);
  return ingresos / inv;
}

export function metricasCampania(c: { inversion: number; impresiones: number; clicks: number; leads: number }) {
  return {
    ctr: c.impresiones > 0 ? (c.clicks / c.impresiones) * 100 : 0,
    cpc: c.clicks > 0 ? c.inversion / c.clicks : 0,
    cpl: c.leads > 0 ? c.inversion / c.leads : 0,
    cpm: c.impresiones > 0 ? (c.inversion / c.impresiones) * 1000 : 0,
  };
}

/* ---------- Webinars ---------- */

export function metricasWebinar(e: EstadoApp, webinarId: string) {
  const w = e.webinars.find((x) => x.id === webinarId);
  if (!w) return null;
  const leads = e.leads.filter((l) => l.webinarId === webinarId);
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  const inscriptos = leads.filter((l) => l.etapaId === ganada);
  const ingresos = inscriptos.reduce((a, l) => a + l.monto, 0);
  return {
    asistencia: w.registrados > 0 ? (w.asistentes / w.registrados) * 100 : 0,
    leads: leads.length,
    inscriptos: inscriptos.length,
    conversion: w.asistentes > 0 ? (inscriptos.length / w.asistentes) * 100 : 0,
    ingresos,
    roi: w.inversion > 0 ? ((ingresos - w.inversion) / w.inversion) * 100 : 0,
    costoPorRegistrado: w.registrados > 0 ? w.inversion / w.registrados : 0,
  };
}

/* ---------- Alumnos ---------- */

export function reportesSemanaActual(e: EstadoApp) {
  const semana = inicioSemana(new Date()).getTime();
  return e.reportes.filter((r) => inicioSemana(new Date(r.semanaDel)).getTime() === semana);
}

export function semanasSinReportar(e: EstadoApp, alumnoId: string): number {
  const propios = e.reportes
    .filter((r) => r.alumnoId === alumnoId)
    .sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel));
  let n = 0;
  for (const r of propios) {
    if (r.estado === "completado") break;
    n++;
  }
  return n;
}

/* ---------- Metas ---------- */

export function progresoMeta(e: EstadoApp, meta: Meta): { actual: number; pct: number } {
  const m = ultimosMeses(1)[0];
  const actual = valorMetrica(e, meta.metrica, m);
  return { actual, pct: meta.objetivo > 0 ? (actual / meta.objetivo) * 100 : 0 };
}

export function valorMetrica(e: EstadoApp, metrica: MetricaClave, m: RangoMes): number {
  switch (metrica) {
    case "ingresos": return ingresosMes(e, m);
    case "leads-nuevos": return leadsMes(e, m).length;
    case "inscriptos": return inscriptosMes(e, m).length;
    case "sesiones-hechas": return e.sesiones.filter((s) => s.estado === "hecha" && enMes(s.inicia, m)).length;
    case "alumnos-activos": return e.alumnos.filter((a) => a.estado === "activo").length;
    case "registrados-webinar": return e.webinars.filter((w) => enMes(w.fecha, m)).reduce((a, w) => a + w.registrados, 0);
    case "margen": {
      const i = ingresosMes(e, m), g = egresosMes(e, m);
      return i > 0 ? ((i - g) / i) * 100 : 0;
    }
    default: return 0;
  }
}

export const ETIQUETA_METRICA: Record<MetricaClave, string> = {
  "ingresos": "Ingresos del mes",
  "leads-nuevos": "Leads nuevos",
  "inscriptos": "Inscriptos",
  "sesiones-hechas": "Sesiones hechas",
  "alumnos-activos": "Alumnos activos",
  "margen": "Margen",
  "registrados-webinar": "Registrados a webinars",
};

/* ---------- Variación entre dos números ---------- */

export function variacion(actual: number, previo: number): number {
  if (previo === 0) return actual > 0 ? 100 : 0;
  return ((actual - previo) / previo) * 100;
}
