import type { Contacto, Cuota, EstadoApp, ID, Lead, Pago, Sesion, Venta, Webinar } from "./types";
import {
  calcularPyL, comisionesDelMes, cuotasPorCobrar, cuotasVencidas, gastosDelMes, pagosDelMes, type PyL,
} from "./finanzas";
import {
  filasMeta, leadsMes, leadsSinContactar, mrr, periodoAnterior, rangoDeFechas, tasaConversion, totalesMeta,
  valorPipeline, type MetricasMeta, type RangoMes,
} from "./metricas";
import { metricasDeWebinar, sumarMetricas, type MetricasWebinar } from "./webinar";
import { rachasAHoy } from "./reportes";
import { etapaDelAlumno, etapasDeServicio } from "./alumnos";
import { diaDeNegocio } from "@/components/ui/DateRangePicker";
import type { QueDesglosar } from "@/components/panel/Desglose";

/* ==================================================================
   Dashboard & KPIs: la tabla maestra del negocio.

   Filas: cada métrica, de la publicidad (TOFU) a la plata que queda.
   Columnas: "cortes" — un período, un mes, un embudo o un webinar.

   Acá no hay fórmulas nuevas: cada número sale de la misma función que
   lo calcula en su pantalla (calcularPyL, metricasDeWebinar, filasMeta,
   cuotasVencidas...). El Dashboard no puede dar distinto que Finanzas o
   que la planilla de Webinars, porque es la misma cuenta.
   ================================================================== */

export type SeccionKpi = "adquisicion" | "agenda" | "ventas" | "cobranza" | "rentabilidad" | "servicio";

export const SECCIONES: { id: SeccionKpi; titulo: string; etapa: string; sub: string }[] = [
  { id: "adquisicion", titulo: "Adquisición", etapa: "TOFU", sub: "Publicidad, formularios y gente que entra" },
  { id: "agenda", titulo: "Webinar y agenda", etapa: "MOFU", sub: "El vivo, las agendas y las llamadas" },
  { id: "ventas", titulo: "Ventas", etapa: "BOFU", sub: "Qué se vendió, cómo y a qué costo" },
  { id: "cobranza", titulo: "Cobranza", etapa: "Post-venta", sub: "Lo cobrado, lo que falta y quién está atrasado" },
  { id: "rentabilidad", titulo: "Rentabilidad", etapa: "Resultado", sub: "Costos, gastos y lo que queda" },
  { id: "servicio", titulo: "Servicio", etapa: "Alumnos", sub: "Quién está cursando y cómo viene" },
];

export type FormatoKpi = "moneda" | "cantidad" | "pct" | "x" | "dias" | "resultado";

/* ---------- Cortes: las columnas ---------- */

/* Qué parte del negocio se mira. Es aparte de las columnas: se puede ver
   un webinar día por día, o el embudo de webinar mes por mes. */
export interface FiltroKpi {
  embudoId?: ID;
  webinarId?: ID;
}

export interface Corte {
  clave: string;
  titulo: string;
  sub?: string;
  /* Días del negocio, inclusive. */
  desde: string;
  hasta: string;
  filtro?: FiltroKpi;
  /* Las fotos (por cobrar, pipeline, alumnos activos) son de HOY: se
     muestran sólo en la columna que representa el presente. Repetidas
     en cada día parecerían una serie que no es. */
  foto: boolean;
  destacado?: boolean;
  total?: boolean;
  /* Es un mes calendario: se compara contra el mes anterior, no contra
     "los mismos días para atrás". */
  mes?: boolean;
  /* Contra qué se compara, con "Comparar períodos" prendido. */
  previo?: Corte;
}

/* ---------- Índices: se arman una vez por estado ---------- */

interface Indices {
  ventaPorId: Map<ID, Venta>;
  cuotaPorId: Map<ID, Cuota>;
  cuotasPorVenta: Map<ID, Cuota[]>;
  tipoProducto: Map<ID, string>;
  contactoPorId: Map<ID, Contacto>;
  leadPorId: Map<ID, Lead>;
  /* Los embudos que son "el de webinar": los marcados así en Ajustes (en la
     planilla de Angelo se llama "Lanzamiento") o, si ninguno lo está, los
     que se llaman "webinar". No se deduce de las ventas: una venta de
     webinar cargada con otro embudo haría que ese embudo se lleve las
     agendas y los registros de webinar. */
  embudosWebinar: Set<ID>;
}

const INDICES = new WeakMap<EstadoApp, Indices>();

function indices(e: EstadoApp): Indices {
  let ix = INDICES.get(e);
  if (ix) return ix;
  const cuotasPorVenta = new Map<ID, Cuota[]>();
  for (const c of e.cuotas) {
    const xs = cuotasPorVenta.get(c.ventaId);
    if (xs) xs.push(c); else cuotasPorVenta.set(c.ventaId, [c]);
  }
  const marcados = e.embudos.filter((x) => x.esWebinar);
  const embudosWebinar = new Set((marcados.length ? marcados : e.embudos.filter((x) => /webinar/i.test(x.nombre))).map((x) => x.id));
  ix = {
    ventaPorId: new Map(e.ventas.map((v) => [v.id, v])),
    cuotaPorId: new Map(e.cuotas.map((c) => [c.id, c])),
    cuotasPorVenta,
    tipoProducto: new Map(e.productos.map((p) => [p.id, p.tipo])),
    contactoPorId: new Map(e.contactos.map((c) => [c.id, c])),
    leadPorId: new Map(e.leads.map((l) => [l.id, l])),
    embudosWebinar,
  };
  INDICES.set(e, ix);
  return ix;
}

/* ---------- Contexto: todo lo que un corte necesita, calculado una vez ---------- */

export class Contexto {
  private cache = new Map<string, unknown>();
  readonly ix: Indices;

  constructor(readonly e: EstadoApp, readonly corte: Corte) {
    this.ix = indices(e);
  }

  private memo<T>(k: string, f: () => T): T {
    if (!this.cache.has(k)) this.cache.set(k, f());
    return this.cache.get(k) as T;
  }

  get filtro(): FiltroKpi { return this.corte.filtro ?? {}; }
  /* Todo el negocio, sin filtro. Es el único corte donde existen el P&L,
     Meta, el pipeline y los alumnos: nada de eso tiene embudo todavía. */
  get general() { return !this.filtro.embudoId && !this.filtro.webinarId; }

  /* Qué se puede decir de webinars con este filtro: todos, uno solo, o
     nada (un embudo que no es el de webinar). */
  get alcanceWebinar(): "todos" | "uno" | "ninguno" {
    if (this.filtro.webinarId) return "uno";
    if (this.filtro.embudoId) return this.ix.embudosWebinar.has(this.filtro.embudoId) ? "todos" : "ninguno";
    return "todos";
  }

  get m(): RangoMes {
    const { desde, hasta, titulo } = this.corte;
    return this.memo("m", () => rangoDeFechas(desde, hasta, titulo));
  }

  /* Un instante cae en el corte por su día en Argentina: lo cargado a las
     22 es de ese día aunque el ISO ya diga el siguiente. */
  enDias(iso?: string | null): boolean {
    if (!iso) return false;
    const d = diaDeNegocio(iso);
    return d >= this.corte.desde && d <= this.corte.hasta;
  }

  /* Una venta pertenece al corte por su embudo o su webinar, sin mirar
     fechas. Sirve para las fotos (por cobrar, mora) y para los pagos. */
  ventaEnCorte(v: Venta | undefined): boolean {
    if (!v) return false;
    if (this.filtro.webinarId && v.webinarId !== this.filtro.webinarId) return false;
    if (this.filtro.embudoId && v.embudoId !== this.filtro.embudoId) return false;
    return true;
  }

  /** Todas las ventas del corte, canceladas incluidas. */
  ventasTodas(): Venta[] {
    return this.memo("ventasTodas", () => {
      const m = this.m;
      return this.e.ventas.filter((v) => {
        const t = new Date(v.fecha).getTime();
        return t >= m.desde.getTime() && t <= m.hasta.getTime() && this.ventaEnCorte(v);
      });
    });
  }

  /** Las ventas que cuentan: sin las canceladas, igual que Finanzas. */
  ventas(): Venta[] {
    return this.memo("ventas", () => this.ventasTodas().filter((v) => v.estado !== "cancelada"));
  }

  /** Los pagos que entraron en el período (de ventas de cualquier fecha). */
  pagos(): Pago[] {
    return this.memo("pagos", () => {
      const delMes = pagosDelMes(this.e, this.m);
      if (this.general) return delMes;
      return delMes.filter((p) => {
        const c = this.ix.cuotaPorId.get(p.cuotaId);
        return this.ventaEnCorte(c ? this.ix.ventaPorId.get(c.ventaId) : undefined);
      });
    });
  }

  cobrado(): number { return this.memo("cobrado", () => this.pagos().reduce((a, p) => a + p.monto, 0)); }
  facturado(): number { return this.memo("facturado", () => this.ventas().reduce((a, v) => a + v.precioAcordado, 0)); }
  fees(): number { return this.memo("fees", () => this.pagos().reduce((a, p) => a + p.feeMonto, 0)); }

  /** El estado de resultados, tal cual lo arma Finanzas. */
  py(): PyL | null {
    return this.memo("py", () => (this.general ? calcularPyL(this.e, this.m) : null));
  }

  /** Comisiones de closers y director de las ventas del corte. */
  comisiones(): { closers: number; director: number } {
    return this.memo("comisiones", () => {
      const cs = comisionesDelMes(this.e, this.m).filter((c) => this.ventaEnCorte(this.ix.ventaPorId.get(c.ventaId)));
      return {
        closers: cs.reduce((a, c) => a + c.comisionCloser, 0),
        director: cs.reduce((a, c) => a + c.comisionDirector, 0),
      };
    });
  }

  /** Los webinars con fecha en el corte, con los números de su planilla. */
  webinars(): Webinar[] {
    return this.memo("webinars", () => {
      if (this.alcanceWebinar === "ninguno") return [];
      return this.e.webinars.filter((w) =>
        (!this.filtro.webinarId || w.id === this.filtro.webinarId) && this.enDias(w.fecha));
    });
  }

  web(): MetricasWebinar | null {
    return this.memo("web", () => {
      const ws = this.webinars();
      if (ws.length === 0) return null;
      return sumarMetricas(ws.map((w) => metricasDeWebinar(this.e, w)));
    });
  }

  /** Lo de Meta, como la fila de totales de Marketing. */
  meta(): MetricasMeta | null {
    return this.memo("meta", () => {
      if (!this.general) return null;
      const filas = filasMeta(this.e, this.corte.desde, this.corte.hasta, "campania");
      return filas.length > 0 ? totalesMeta(filas) : null;
    });
  }

  /* De dónde viene una persona, una oportunidad o una llamada. null: con
     este filtro no se puede saber (un embudo que no es el de webinar
     todavía no deja rastro en los contactos ni en la agenda). */
  private contactoEsDelFiltro(c: Contacto | undefined): boolean {
    if (!c) return false;
    if (this.filtro.webinarId) return c.origenWebinarId === this.filtro.webinarId;
    return c.origenCanal === "webinar" || Boolean(c.origenWebinarId);
  }
  private leadEsDelFiltro(l: Lead | undefined): boolean {
    if (!l) return false;
    return this.filtro.webinarId ? l.webinarId === this.filtro.webinarId : Boolean(l.webinarId);
  }

  /** Las personas que entraron en el período. */
  contactos(): Contacto[] | null {
    return this.memo("contactos", () => {
      if (this.alcanceWebinar === "ninguno") return null;
      const xs = this.e.contactos.filter((x) => this.enDias(x.creadoEn));
      return this.general ? xs : xs.filter((x) => this.contactoEsDelFiltro(x));
    });
  }

  /** Las oportunidades que se abrieron en el período. */
  leadsNuevos(): Lead[] | null {
    return this.memo("leads", () => {
      if (this.alcanceWebinar === "ninguno") return null;
      const xs = leadsMes(this.e, this.m);
      return this.general ? xs : xs.filter((l) => this.leadEsDelFiltro(l));
    });
  }

  /** Las llamadas que se pueden atribuir al filtro (de cualquier fecha). */
  sesiones(): Sesion[] | null {
    return this.memo("sesiones", () => {
      if (this.alcanceWebinar === "ninguno") return null;
      if (this.general) return this.e.sesiones;
      return this.e.sesiones.filter((s) =>
        (!this.filtro.webinarId && s.canal === "webinar") ||
        this.contactoEsDelFiltro(s.contactoId ? this.ix.contactoPorId.get(s.contactoId) : undefined) ||
        this.leadEsDelFiltro(s.leadId ? this.ix.leadPorId.get(s.leadId) : undefined));
    });
  }

  /** Cuotas de las ventas del corte, sin la reserva ni las canceladas. */
  cuotasDe(v: Venta): Cuota[] {
    return (this.ix.cuotasPorVenta.get(v.id) ?? []).filter((c) => !c.esReserva && c.estado !== "cancelada");
  }

  vencidas() {
    return this.memo("vencidas", () => cuotasVencidas(this.e).filter((c) => this.ventaEnCorte(this.ix.ventaPorId.get(c.ventaId))));
  }
}

/* ---------- La definición de cada fila ---------- */

export interface DefKpi {
  id: string;
  seccion: SeccionKpi;
  grupo: string;
  etiqueta: string;
  /* Qué es y cómo se calcula, en castellano. */
  ayuda: string;
  formato: FormatoKpi;
  /* Para pintar la variación: si subir es bueno o malo. */
  mejor?: "sube" | "baja";
  /* Un número de hoy, no de un período (ver Corte.foto). */
  foto?: boolean;
  /* Dónde se ve el detalle. */
  href?: string;
  /* El panel lateral que abre el número, en los cortes por fechas. */
  desglose?: QueDesglosar;
  /* Filas que sólo existen si tienen algo (una por categoría de gasto). */
  ocultarEnCero?: boolean;
  /* null: el número no existe para ese corte (se muestra "—"). */
  valor: (c: Contexto) => number | null;
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const pctDe = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);
/* Lo que sólo existe en el corte general (P&L, Meta, agenda...). */
const g = <T,>(c: Contexto, f: () => T): T | null => (c.general ? f() : null);
const w = (c: Contexto, f: (m: MetricasWebinar) => number | null): number | null => {
  const m = c.web();
  return m ? f(m) : null;
};

export function catalogo(e: EstadoApp): DefKpi[] {
  const lista: DefKpi[] = [];
  const add = (seccion: SeccionKpi, grupo: string, defs: Omit<DefKpi, "seccion" | "grupo">[]) => {
    for (const d of defs) lista.push({ ...d, seccion, grupo });
  };

  /* ================= TOFU: Adquisición ================= */

  add("adquisicion", "Inversión", [
    { id: "inv_ads", etiqueta: "Inversión en publicidad", formato: "moneda", href: "/finanzas",
      ayuda: "Los gastos cargados como Meta Ads, Google Ads o TikTok Ads. Es la base del ROAS y el CAC de Finanzas.",
      valor: (c) => g(c, () => c.py()!.inversionAds) },
    { id: "w_pauta", etiqueta: "Pauta de captación (webinars)", formato: "moneda", href: "/webinars",
      ayuda: "La pauta cargada en la planilla de cada webinar del período.", valor: (c) => w(c, () => c.webinars().reduce((a, x) => a + x.inversion, 0)) },
    { id: "w_dm", etiqueta: "DM Ads (webinars)", formato: "moneda", href: "/webinars",
      ayuda: "Los anuncios a mensaje directo de cada webinar.", valor: (c) => w(c, () => c.webinars().reduce((a, x) => a + x.inversionDmAds, 0)) },
    { id: "w_wapi", etiqueta: "WhatsApp API (webinars)", formato: "moneda", href: "/webinars",
      ayuda: "Lo que cobró WhatsApp por los mensajes de cada webinar.", valor: (c) => w(c, () => c.webinars().reduce((a, x) => a + x.costoWhatsappApi, 0)) },
    { id: "w_inv", etiqueta: "Inversión total del webinar", formato: "moneda", href: "/webinars",
      ayuda: "Pauta + DM Ads + WhatsApp API: los tres gastos del webinar.", valor: (c) => w(c, (m) => m.inversionTotal) },
  ]);

  add("adquisicion", "Meta (sincronizado)", [
    { id: "meta_gasto", etiqueta: "Gasto en Meta", formato: "moneda", href: "/marketing",
      ayuda: "Lo que informa el Administrador de anuncios para los días del período.", valor: (c) => g(c, () => c.meta()?.inversion ?? null) },
    { id: "meta_impr", etiqueta: "Impresiones", formato: "cantidad", href: "/marketing",
      ayuda: "Veces que se mostró un anuncio.", valor: (c) => g(c, () => c.meta()?.impresiones ?? null) },
    { id: "meta_ctr", etiqueta: "CTR", formato: "pct", mejor: "sube", href: "/marketing",
      ayuda: "Clicks sobre impresiones.", valor: (c) => g(c, () => c.meta()?.ctr ?? null) },
    { id: "meta_cpc", etiqueta: "CPC", formato: "moneda", mejor: "baja", href: "/marketing",
      ayuda: "Gasto sobre clicks.", valor: (c) => g(c, () => c.meta()?.cpc ?? null) },
    { id: "meta_cpm", etiqueta: "CPM", formato: "moneda", mejor: "baja", href: "/marketing",
      ayuda: "Lo que cuestan mil impresiones.", valor: (c) => g(c, () => c.meta()?.cpm ?? null) },
    { id: "meta_leads", etiqueta: "Leads según Meta", formato: "cantidad", mejor: "sube", href: "/marketing",
      ayuda: "Las conversiones que Meta cuenta como lead.", valor: (c) => g(c, () => c.meta()?.leads ?? null) },
    { id: "meta_cpl", etiqueta: "Costo por lead (Meta)", formato: "moneda", mejor: "baja", href: "/marketing",
      ayuda: "Gasto en Meta sobre los leads que informa Meta.", valor: (c) => g(c, () => { const m = c.meta(); return m && m.leads > 0 ? m.cpl : null; }) },
  ]);

  add("adquisicion", "Captación del webinar", [
    { id: "w_form", etiqueta: "Formularios completados", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Gente que completó el formulario de registro al webinar.", valor: (c) => w(c, (m) => m.formularios) },
    { id: "w_cpf", etiqueta: "Costo por formulario", formato: "moneda", mejor: "baja", href: "/webinars",
      ayuda: "Inversión del webinar sobre formularios completados.", valor: (c) => w(c, (m) => m.cplFormulario) },
    { id: "w_grupo", etiqueta: "Se unieron al grupo", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Los que entraron al grupo de WhatsApp.", valor: (c) => w(c, (m) => m.grupoWpp) },
    { id: "w_cpg", etiqueta: "Costo por unión al grupo", formato: "moneda", mejor: "baja", href: "/webinars",
      ayuda: "Inversión del webinar sobre los que entraron al grupo.", valor: (c) => w(c, (m) => m.cplGrupo) },
    { id: "w_form_grupo", etiqueta: "Formulario → grupo", formato: "pct", mejor: "sube", href: "/webinars",
      ayuda: "De los que completaron el formulario, cuántos entraron al grupo.", valor: (c) => w(c, (m) => m.asistenciaFormulario) },
  ]);

  add("adquisicion", "Personas", [
    { id: "personas", etiqueta: "Personas nuevas", formato: "cantidad", mejor: "sube", href: "/leads",
      ayuda: "Contactos que entraron en el período: por el formulario, por una agenda o por otro canal. Filtrando un webinar, los que se registraron a ese webinar.",
      valor: (c) => c.contactos()?.length ?? null },
    { id: "leads_nuevos", etiqueta: "Leads nuevos", formato: "cantidad", mejor: "sube", href: "/leads", desglose: { tipo: "leads" },
      ayuda: "Oportunidades que se abrieron en el período.", valor: (c) => c.leadsNuevos()?.length ?? null },
  ]);

  /* ================= MOFU: Webinar y agenda ================= */

  add("agenda", "Webinar", [
    { id: "w_n", etiqueta: "Webinars", formato: "cantidad", href: "/webinars",
      ayuda: "Webinars con fecha en el período.", valor: (c) => (c.alcanceWebinar === "ninguno" ? null : c.webinars().length || null) },
    { id: "w_asist", etiqueta: "Asistieron al vivo", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Los que estuvieron en el vivo.", valor: (c) => w(c, (m) => m.asistentes) },
    { id: "w_asist_pct", etiqueta: "Asistencia al taller", formato: "pct", mejor: "sube", href: "/webinars",
      ayuda: "Asistentes al vivo sobre los que entraron al grupo.", valor: (c) => w(c, (m) => m.asistenciaTaller) },
    { id: "w_ll_vivo", etiqueta: "Agendas en el vivo", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Llamadas agendadas durante el vivo.", valor: (c) => w(c, () => c.webinars().reduce((a, x) => a + x.llamadasVivo, 0)) },
    { id: "w_ll_post", etiqueta: "Agendas después del vivo", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Llamadas agendadas después, con el replay o el seguimiento.", valor: (c) => w(c, () => c.webinars().reduce((a, x) => a + x.llamadasPosterior, 0)) },
    { id: "w_ll", etiqueta: "Agendas del webinar", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "En el vivo + después.", valor: (c) => w(c, (m) => m.llamadas) },
    { id: "w_pct_agenda", etiqueta: "Grupo → agenda", formato: "pct", mejor: "sube", href: "/webinars",
      ayuda: "De los que entraron al grupo, cuántos agendaron.", valor: (c) => w(c, (m) => m.porcentajeAgenda) },
    { id: "w_cpll", etiqueta: "Costo por agenda (webinar)", formato: "moneda", mejor: "baja", href: "/webinars",
      ayuda: "Inversión del webinar sobre las agendas que trajo.", valor: (c) => w(c, (m) => m.cpLlamada) },
    { id: "w_ll_calif", etiqueta: "Llamadas calificadas", formato: "cantidad", mejor: "sube", href: "/webinars",
      ayuda: "Llamadas hechas con gente que sí calificaba.", valor: (c) => w(c, (m) => m.llamadasCalificadas) },
    { id: "w_cpllc", etiqueta: "Costo por llamada calificada", formato: "moneda", mejor: "baja", href: "/webinars",
      ayuda: "Inversión del webinar sobre llamadas calificadas.", valor: (c) => w(c, (m) => m.cpLlamadaCalificada) },
  ]);

  /* Las llamadas del filtro: todas sin filtro; con un webinar, las de la
     gente que vino de ese webinar. null si el filtro no se puede atribuir. */
  const agendadas = (c: Contexto) => c.sesiones()?.filter((s) => c.enDias(s.creadoEn)) ?? null;
  const pasadas = (c: Contexto, estado: string) => c.sesiones()?.filter((s) => s.estado === estado && c.enDias(s.inicia)).length ?? null;

  add("agenda", "Agenda (Calendly)", [
    { id: "ag_nuevas", etiqueta: "Llamadas agendadas", formato: "cantidad", mejor: "sube", href: "/agenda",
      ayuda: "Agendas que entraron en el período. Filtrando un webinar, las de la gente que vino de ese webinar.", valor: (c) => agendadas(c)?.length ?? null },
    { id: "ag_costo", etiqueta: "Costo por agenda", formato: "moneda", mejor: "baja", href: "/agenda",
      ayuda: "Inversión en publicidad sobre las llamadas agendadas en el período.",
      valor: (c) => g(c, () => div(c.py()!.inversionAds, agendadas(c)?.length ?? 0)) },
    { id: "ag_hechas", etiqueta: "Llamadas hechas", formato: "cantidad", mejor: "sube", href: "/agenda",
      ayuda: "Llamadas del período que se hicieron.", valor: (c) => pasadas(c, "hecha") },
    { id: "ag_noshow", etiqueta: "No vinieron", formato: "cantidad", mejor: "baja", href: "/agenda",
      ayuda: "Llamadas del período a las que la persona no se presentó.", valor: (c) => pasadas(c, "no-show") },
    { id: "ag_canceladas", etiqueta: "Canceladas", formato: "cantidad", mejor: "baja", href: "/agenda",
      ayuda: "Llamadas del período que se cancelaron.", valor: (c) => pasadas(c, "cancelada") },
    { id: "ag_show", etiqueta: "Asistencia a llamadas", formato: "pct", mejor: "sube", href: "/agenda",
      ayuda: "Hechas sobre hechas + no vinieron.",
      valor: (c) => { const h = pasadas(c, "hecha"), n = pasadas(c, "no-show"); return h === null || n === null ? null : pctDe(h, h + n); } },
    { id: "ag_porvenir", etiqueta: "Llamadas por venir", formato: "cantidad", foto: true, href: "/agenda",
      ayuda: "Agendadas que todavía no pasaron.",
      valor: (c) => c.sesiones()?.filter((s) => s.estado === "agendada" && new Date(s.inicia).getTime() >= Date.now()).length ?? null },
  ]);

  add("agenda", "Pipeline de ventas", [
    { id: "pipe_abierto", etiqueta: "Pipeline abierto", formato: "moneda", foto: true, href: "/pipeline",
      ayuda: "Lo que valen los leads que todavía no se definieron.", valor: (c) => g(c, () => valorPipeline(c.e).bruto) },
    { id: "pipe_pond", etiqueta: "Pipeline ponderado", formato: "moneda", foto: true, href: "/pipeline", desglose: { tipo: "pipeline" },
      ayuda: "El pipeline abierto ajustado por la probabilidad de cada etapa.", valor: (c) => g(c, () => valorPipeline(c.e).ponderado) },
    { id: "pipe_sincontactar", etiqueta: "Leads sin contactar", formato: "cantidad", mejor: "baja", foto: true, href: "/pipeline",
      ayuda: "Leads en la primera etapa del pipeline.", valor: (c) => g(c, () => leadsSinContactar(c.e).length) },
    { id: "pipe_cierre", etiqueta: "Tasa de cierre del pipeline", formato: "pct", mejor: "sube", foto: true, href: "/pipeline", desglose: { tipo: "cierre" },
      ayuda: "De los leads que ya se definieron, cuántos se ganaron.", valor: (c) => g(c, () => tasaConversion(c.e)) },
  ]);

  /* ================= BOFU: Ventas ================= */

  const deTipo = (c: Contexto, tipo: string) => c.ventas().filter((v) => v.productoId && c.ix.tipoProducto.get(v.productoId) === tipo).length;
  const enCuotas = (c: Contexto, n: number, oMas = false) =>
    c.ventas().filter((v) => { const k = c.cuotasDe(v).length; return oMas ? k >= n : k === n; }).length;

  add("ventas", "Ventas", [
    { id: "v_n", etiqueta: "Ventas", formato: "cantidad", mejor: "sube", href: "/ventas",
      ayuda: "Ventas cerradas en el período, sin las canceladas.", valor: (c) => c.ventas().length },
    { id: "v_principal", etiqueta: "Programas (mentorías)", formato: "cantidad", mejor: "sube", href: "/ventas",
      ayuda: "Ventas de un producto principal. Para Yari, una venta es una mentoría: el downsell y la reserva no cuentan como venta.",
      valor: (c) => deTipo(c, "principal") },
    { id: "v_downsell", etiqueta: "Downsells", formato: "cantidad", href: "/ventas", ayuda: "Ventas del downsell.", valor: (c) => deTipo(c, "downsell") },
    { id: "v_upsell", etiqueta: "Upsells", formato: "cantidad", href: "/ventas", ayuda: "Ventas de un upsell.", valor: (c) => deTipo(c, "upsell") },
    { id: "v_1", etiqueta: "En 1 pago", formato: "cantidad", href: "/ventas", ayuda: "Ventas con una sola cuota, sin contar la reserva.", valor: (c) => enCuotas(c, 1) },
    { id: "v_2", etiqueta: "En 2 cuotas", formato: "cantidad", href: "/ventas", ayuda: "Sin contar la reserva.", valor: (c) => enCuotas(c, 2) },
    { id: "v_3", etiqueta: "En 3 cuotas", formato: "cantidad", href: "/ventas", ayuda: "Sin contar la reserva.", valor: (c) => enCuotas(c, 3) },
    { id: "v_4", etiqueta: "En 4 cuotas o más", formato: "cantidad", href: "/ventas", ayuda: "Sin contar la reserva.", valor: (c) => enCuotas(c, 4, true) },
    { id: "v_fact", etiqueta: "Facturado", formato: "moneda", mejor: "sube", href: "/ventas",
      ayuda: "Revenue: el precio acordado de las ventas del período.", valor: (c) => c.facturado() },
    { id: "v_ticket", etiqueta: "Ticket promedio", formato: "moneda", mejor: "sube", href: "/ventas",
      ayuda: "Facturado sobre ventas.", valor: (c) => div(c.facturado(), c.ventas().length) },
  ]);

  add("ventas", "Conversión", [
    { id: "v_ag_venta", etiqueta: "Agenda → venta", formato: "pct", mejor: "sube", href: "/agenda",
      ayuda: "Ventas del período sobre llamadas agendadas en el período.",
      valor: (c) => { const a = agendadas(c); return a ? pctDe(c.ventas().length, a.length) : null; } },
    { id: "w_cierre", etiqueta: "Cierre sobre calificadas (webinar)", formato: "pct", mejor: "sube", href: "/webinars",
      ayuda: "Ventas del webinar sobre sus llamadas calificadas.", valor: (c) => w(c, (m) => m.tasaCierre) },
    { id: "w_grupo_venta", etiqueta: "Grupo → venta (webinar)", formato: "pct", mejor: "sube", href: "/webinars",
      ayuda: "Ventas del webinar sobre los que entraron al grupo.", valor: (c) => w(c, (m) => m.convLeadVenta) },
  ]);

  add("ventas", "Costo de adquisición y retorno", [
    { id: "cac", etiqueta: "CAC", formato: "moneda", mejor: "baja", href: "/finanzas",
      ayuda: "Inversión en publicidad sobre ventas del período. Es el de Finanzas.",
      valor: (c) => g(c, () => { const p = c.py()!; return p.ventas > 0 ? p.cac : null; }) },
    { id: "w_cac", etiqueta: "CAC del webinar", formato: "moneda", mejor: "baja", href: "/webinars",
      ayuda: "Inversión del webinar sobre sus ventas.", valor: (c) => w(c, (m) => (m.ventas > 0 ? m.cpa : null)) },
    { id: "roas_cc", etiqueta: "ROAS sobre lo cobrado", formato: "x", mejor: "sube", href: "/finanzas",
      ayuda: "Cash collected sobre inversión en publicidad.", valor: (c) => g(c, () => c.py()!.roasCC || null) },
    { id: "roas_rev", etiqueta: "ROAS sobre lo facturado", formato: "x", mejor: "sube", href: "/finanzas",
      ayuda: "Facturado sobre inversión en publicidad: como si todos pagaran todas las cuotas.", valor: (c) => g(c, () => c.py()!.roasRev || null) },
    { id: "w_roas_cc", etiqueta: "ROAS del webinar (cobrado)", formato: "x", mejor: "sube", href: "/webinars",
      ayuda: "Lo cobrado de las ventas del webinar sobre su inversión.", valor: (c) => w(c, (m) => m.roasCC) },
    { id: "w_roas_rev", etiqueta: "ROAS del webinar (facturado)", formato: "x", mejor: "sube", href: "/webinars",
      ayuda: "Lo facturado por el webinar sobre su inversión.", valor: (c) => w(c, (m) => m.roasRev) },
  ]);

  /* ================= Post-venta: Cobranza ================= */

  const clientesAtrasados = (c: Contexto, dias: number) => new Set(c.vencidas().filter((x) => x.diasAtraso >= dias).map((x) => x.ventaId)).size;

  add("cobranza", "Cobrado", [
    { id: "c_cc", etiqueta: "Cash collected", formato: "moneda", mejor: "sube", href: "/finanzas", desglose: { tipo: "ingresos" },
      ayuda: "La plata que entró en el período, de ventas de cualquier fecha.", valor: (c) => c.cobrado() },
    { id: "c_tasa", etiqueta: "Tasa de cobro", formato: "pct", mejor: "sube", href: "/finanzas",
      ayuda: "Cash collected sobre facturado: de todo lo que vendemos, cuánto entra.", valor: (c) => pctDe(c.cobrado(), c.facturado()) },
    { id: "c_reservas", etiqueta: "Cobrado en reservas", formato: "moneda", href: "/ventas",
      ayuda: "Lo que entró como reserva o seña.",
      valor: (c) => c.pagos().filter((p) => c.ix.cuotaPorId.get(p.cuotaId)?.esReserva).reduce((a, p) => a + p.monto, 0) },
  ]);

  add("cobranza", "Lo que falta cobrar", [
    { id: "c_porcobrar", etiqueta: "Por cobrar", formato: "moneda", foto: true, href: "/finanzas/detalle", desglose: { tipo: "cobrar" },
      ayuda: "Cuotas pendientes, vencidas o no.",
      valor: (c) => cuotasPorCobrar(c.e).filter((x) => c.ventaEnCorte(c.ix.ventaPorId.get(x.cuota.ventaId))).reduce((a, x) => a + x.saldo, 0) },
    { id: "c_vencido", etiqueta: "Vencido", formato: "moneda", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Lo que ya se tendría que haber cobrado y no entró.", valor: (c) => c.vencidas().reduce((a, x) => a + x.saldo, 0) },
    { id: "c_vencidas", etiqueta: "Cuotas vencidas", formato: "cantidad", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Cuotas con saldo y el vencimiento ya pasado.", valor: (c) => c.vencidas().length },
    { id: "c_mora", etiqueta: "Tasa de mora", formato: "pct", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Cuotas vencidas sin pagar sobre todas las que ya vencieron. El que se atrasa pero sigue: no es una cancelación.",
      valor: (c) => {
        const exigibles = c.e.cuotas.filter((x) => x.vence && new Date(x.vence).getTime() < Date.now() && x.estado !== "cancelada"
          && c.ventaEnCorte(c.ix.ventaPorId.get(x.ventaId)));
        return exigibles.length ? (c.vencidas().length / exigibles.length) * 100 : 0;
      } },
    { id: "c_7", etiqueta: "Clientes con 7 días o más de atraso", formato: "cantidad", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Ventas con al menos una cuota vencida hace 7 días o más.", valor: (c) => clientesAtrasados(c, 7) },
    { id: "c_15", etiqueta: "Clientes con 15 días o más", formato: "cantidad", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Ventas con al menos una cuota vencida hace 15 días o más.", valor: (c) => clientesAtrasados(c, 15) },
    { id: "c_20", etiqueta: "Clientes con 20 días o más", formato: "cantidad", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Ventas con al menos una cuota vencida hace 20 días o más: las que tendrían que tener a alguien encima.", valor: (c) => clientesAtrasados(c, 20) },
    { id: "c_peor", etiqueta: "El más atrasado", formato: "dias", mejor: "baja", foto: true, href: "/finanzas/detalle",
      ayuda: "Los días de atraso de la cuota más vieja sin pagar.", valor: (c) => c.vencidas()[0]?.diasAtraso ?? 0 },
  ]);

  add("cobranza", "Bajas", [
    { id: "c_canceladas", etiqueta: "Ventas canceladas", formato: "cantidad", mejor: "baja", href: "/ventas",
      ayuda: "Ventas del período que se dieron de baja: se van y sus cuotas futuras se cancelan.",
      valor: (c) => c.ventasTodas().filter((v) => v.estado === "cancelada").length },
    { id: "c_cancel_pct", etiqueta: "Tasa de cancelación", formato: "pct", mejor: "baja", href: "/ventas",
      ayuda: "Canceladas sobre todas las ventas del período.",
      valor: (c) => pctDe(c.ventasTodas().filter((v) => v.estado === "cancelada").length, c.ventasTodas().length) },
    { id: "c_reembolsadas", etiqueta: "Reembolsadas", formato: "cantidad", mejor: "baja", href: "/ventas",
      ayuda: "Ventas del período marcadas como reembolsadas.", valor: (c) => c.ventasTodas().filter((v) => v.estado === "reembolsada").length },
  ]);

  add("cobranza", "Conciliación", [
    { id: "c_sinconciliar", etiqueta: "Cobros sin conciliar", formato: "moneda", foto: true, href: "/conciliacion",
      ayuda: "Plata que entró a una pasarela y todavía no se imputó a ninguna cuota: se ve, pero no cuenta como cobrada.",
      valor: (c) => g(c, () => c.e.movimientos.filter((x) => x.estado === "pendiente").reduce((a, x) => a + x.monto, 0)) },
  ]);

  /* ================= Rentabilidad ================= */

  add("rentabilidad", "Costos de la venta", [
    { id: "r_fees", etiqueta: "Procesadores de pago", formato: "moneda", mejor: "baja", href: "/finanzas",
      ayuda: "Lo que se quedaron Stripe, Hotmart y compañía de los pagos del corte.", valor: (c) => c.fees() },
    { id: "r_closers", etiqueta: "Comisión de closers", formato: "moneda", href: "/finanzas/detalle",
      ayuda: "Cash collected menos procesador, por el porcentaje de cada closer. Si cerró Yari, no comisiona nadie.",
      valor: (c) => c.comisiones().closers },
    { id: "r_director", etiqueta: "Comisión del director", formato: "moneda", href: "/finanzas/detalle",
      ayuda: "Cash collected menos procesador, por el porcentaje del director.", valor: (c) => c.comisiones().director },
    { id: "r_directos", etiqueta: "Otros costos directos", formato: "moneda", href: "/finanzas",
      ayuda: "Setters, financieras y el resto de los gastos marcados como directos.", valor: (c) => g(c, () => c.py()!.otrosDirectos) },
    { id: "r_bruto", etiqueta: "Utilidad bruta (cobrado)", formato: "resultado", mejor: "sube", href: "/finanzas",
      ayuda: "Cash collected menos todos los costos directos.", valor: (c) => g(c, () => c.py()!.brutoCC) },
  ]);

  /* Los gastos segregados: una fila por categoría, en el orden de lo que
     más pesa en total. Las que en ningún corte tienen nada no aparecen, y
     los honorarios del dueño van abajo, en el resultado. */
  const porCategoria = new Map<string, number>();
  for (const x of e.gastos) {
    if (x.grupo === "dueno") continue;
    porCategoria.set(x.categoria, (porCategoria.get(x.categoria) ?? 0) + x.monto);
  }
  add("rentabilidad", "Gastos", [
    { id: "r_opex", etiqueta: "Gastos operativos", formato: "moneda", mejor: "baja", href: "/finanzas",
      ayuda: "Todo lo que cuesta tener el negocio andando.", valor: (c) => g(c, () => c.py()!.gastosOperativos) },
    ...[...porCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([cat]) => ({
      id: `r_cat:${cat}`, etiqueta: cat, formato: "moneda" as const, ocultarEnCero: true, href: "/finanzas/detalle?vista=gastos",
      ayuda: `Los gastos cargados como «${cat}».`,
      valor: (c: Contexto) => g(c, () => gastosDelMes(c.e, c.m!).filter((x) => x.categoria === cat && x.grupo !== "dueno").reduce((a, x) => a + x.monto, 0)),
    })),
  ]);

  add("rentabilidad", "Resultado", [
    { id: "r_operativo", etiqueta: "Profit del negocio sin el CEO", formato: "resultado", mejor: "sube", href: "/finanzas",
      ayuda: "Resultado operativo sobre lo cobrado: utilidad bruta menos gastos operativos. De acá sale el reparto.",
      valor: (c) => g(c, () => c.py()!.operativoCC) },
    { id: "r_growth", etiqueta: "Growth partner", formato: "moneda", href: "/finanzas",
      ayuda: "Su porcentaje del profit sin el CEO, sin las ventas excluidas de marketing.", valor: (c) => g(c, () => c.py()!.growth) },
    { id: "r_socio", etiqueta: "Socio", formato: "moneda", href: "/finanzas",
      ayuda: "Su porcentaje del profit sin el CEO.", valor: (c) => g(c, () => c.py()!.socio) },
    { id: "r_ceo", etiqueta: "Honorarios del CEO", formato: "moneda", href: "/finanzas",
      ayuda: "Lo cargado como honorarios del dueño.", valor: (c) => g(c, () => c.py()!.honorariosCeo) },
    { id: "r_neto_cc", etiqueta: "Profit neto (cobrado)", formato: "resultado", mejor: "sube", href: "/finanzas", desglose: { tipo: "resultado" },
      ayuda: "El del estado de resultados: profit sin el CEO menos honorarios del CEO. El reparto no se resta.",
      valor: (c) => g(c, () => c.py()!.netoCC) },
    { id: "r_neto_rev", etiqueta: "Profit neto (facturado)", formato: "resultado", mejor: "sube", href: "/finanzas",
      ayuda: "La misma cuenta, sobre lo facturado.", valor: (c) => g(c, () => c.py()!.netoRev) },
    { id: "r_margen", etiqueta: "Margen neto", formato: "pct", mejor: "sube", href: "/finanzas",
      ayuda: "Profit neto sobre lo cobrado.", valor: (c) => g(c, () => { const p = c.py()!; return pctDe(p.netoCC, p.cashCollected); }) },
    { id: "r_queda", etiqueta: "Queda para el negocio", formato: "resultado", mejor: "sube", href: "/finanzas",
      ayuda: "Profit neto menos growth partner y socio: lo que ganó el negocio después de pagarle a todo el mundo.",
      valor: (c) => g(c, () => { const p = c.py()!; return p.netoCC - p.growth - p.socio; }) },
  ]);

  add("rentabilidad", "Profit del webinar", [
    { id: "w_profit_cc", etiqueta: "Profit del webinar (cobrado)", formato: "resultado", mejor: "sube", href: "/webinars",
      ayuda: "Lo cobrado menos pauta, DM Ads, WhatsApp API, comisiones y procesador.", valor: (c) => w(c, (m) => m.beneficioCC) },
    { id: "w_profit_rev", etiqueta: "Profit del webinar (facturado)", formato: "resultado", mejor: "sube", href: "/webinars",
      ayuda: "Lo facturado menos los mismos descuentos.", valor: (c) => w(c, (m) => m.beneficioRev) },
  ]);

  /* ================= Servicio ================= */

  const activos = (c: Contexto) => c.e.alumnos.filter((a) => a.estado === "activo");
  add("servicio", "Alumnos", [
    { id: "s_activos", etiqueta: "Alumnos activos", formato: "cantidad", mejor: "sube", foto: true, href: "/alumnos",
      ayuda: "Alumnos con estado activo.", valor: (c) => g(c, () => activos(c).length) },
    { id: "s_nuevos", etiqueta: "Alumnos nuevos", formato: "cantidad", mejor: "sube", href: "/alumnos",
      ayuda: "Alumnos que empezaron en el período.", valor: (c) => g(c, () => c.e.alumnos.filter((a) => c.enDias(a.inicio)).length) },
    { id: "s_mrr", etiqueta: "MRR", formato: "moneda", mejor: "sube", foto: true, href: "/alumnos", desglose: { tipo: "mrr" },
      ayuda: "Lo que entra todos los meses por cuotas de alumnos activos.", valor: (c) => g(c, () => mrr(c.e)) },
    { id: "s_progreso", etiqueta: "Progreso promedio", formato: "pct", mejor: "sube", foto: true, href: "/alumnos",
      ayuda: "Del programa, entre los activos.",
      valor: (c) => g(c, () => { const xs = activos(c); return xs.length ? xs.reduce((a, x) => a + x.progreso, 0) / xs.length : null; }) },
    { id: "s_sinreportar", etiqueta: "Sin reportar hace 2 semanas o más", formato: "cantidad", mejor: "baja", foto: true, href: "/reportes",
      ayuda: "Activos que no mandaron su reporte semanal en las últimas 2 semanas o más.",
      valor: (c) => g(c, () => { const r = rachasAHoy(c.e); return activos(c).filter((a) => (r.get(a.id) ?? 0) >= 2).length; }) },
  ]);

  const etapas = etapasDeServicio(e);
  add("servicio", "Pipeline de servicio", etapas.map((et) => ({
    id: `s_etapa:${et.id}`, etiqueta: et.nombre, formato: "cantidad" as const, foto: true, href: "/alumnos?vista=pipeline",
    ayuda: `Alumnos en la etapa «${et.nombre}» del pipeline de servicio.`,
    valor: (c: Contexto) => g(c, () => c.e.alumnos.filter((a) => etapaDelAlumno(etapas, a)?.id === et.id).length),
  })));

  return lista;
}

/* ---------- Evaluar ---------- */

export function valorEn(def: DefKpi, c: Contexto): number | null {
  if (def.foto && !c.corte.foto) return null;
  const v = def.valor(c);
  return v === null || !Number.isFinite(v) ? null : v;
}

/* ---------- Armar las columnas de cada vista ---------- */

const isoDia = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Los 6 meses calendario que terminan en el mes de `hasta`, y el Total
 *  de los seis al final. Las fotos de hoy van sólo en el Total, igual que
 *  en la vista por día. */
export function cortesPorMes(hasta: string): Corte[] {
  const [y, m] = hasta.split("-").map(Number);
  const out: Corte[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const desde = isoDia(d.getFullYear(), d.getMonth(), 1);
    const fin = isoDia(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    out.push({
      clave: desde.slice(0, 7), titulo: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      desde, hasta: fin, foto: false, mes: true,
    });
  }
  out.push({
    clave: "total", titulo: "Total", sub: "6 meses", desde: out[0].desde, hasta: out[out.length - 1].hasta,
    foto: true, destacado: true, total: true,
  });
  return out;
}

const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
/* Más de esto, día por día no se lee: pasa a una columna por mes. */
export const MAX_DIAS = 92;

/** Una columna por día del rango y el Total al final. El Total no es la
 *  suma de las columnas: se calcula sobre el rango entero, así las tasas y
 *  los costos unitarios salen bien (el promedio de 23 CPL no es el CPL del
 *  mes). Las fotos de hoy van sólo en el Total. */
export function cortesPorDia(desde: string, hasta: string, sub: string): Corte[] {
  const [y, m, d] = desde.split("-").map(Number);
  const inicio = new Date(y, m - 1, d);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  const fin = new Date(y2, m2 - 1, d2);
  const dias = Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1;
  const out: Corte[] = [];

  if (dias <= MAX_DIAS) {
    for (let i = 0; i < dias; i++) {
      const t = new Date(y, m - 1, d + i);
      const dia = isoDia(t.getFullYear(), t.getMonth(), t.getDate());
      out.push({
        clave: dia, titulo: `${t.getDate()} ${MESES[t.getMonth()].toLowerCase()}`, sub: DIAS_SEMANA[t.getDay()],
        desde: dia, hasta: dia, foto: false,
      });
    }
  } else {
    /* Un mes por columna, recortado a los bordes del rango. */
    let t = new Date(y, m - 1, 1);
    while (t <= fin) {
      const primero = isoDia(t.getFullYear(), t.getMonth(), 1);
      const ultimo = isoDia(t.getFullYear(), t.getMonth(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate());
      const a = primero < desde ? desde : primero;
      const b = ultimo > hasta ? hasta : ultimo;
      out.push({
        clave: primero.slice(0, 7), titulo: `${MESES[t.getMonth()]} ${String(t.getFullYear()).slice(2)}`,
        sub: a === primero && b === ultimo ? undefined : `${Number(a.slice(8))}–${Number(b.slice(8))}`,
        desde: a, hasta: b, foto: false, mes: a === primero && b === ultimo,
      });
      t = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    }
  }

  out.push({ clave: "total", titulo: "Total", sub, desde, hasta, foto: true, destacado: true, total: true });
  return out;
}

/** Los webinars que se pueden elegir en el filtro, el más nuevo primero. */
export function webinarsParaFiltro(e: EstadoApp): Webinar[] {
  return e.webinars
    .filter((x) => x.estado !== "borrador")
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
}

/** Aplica el filtro de embudo o webinar a todas las columnas. */
export function conFiltro(cortes: Corte[], filtro: FiltroKpi): Corte[] {
  if (!filtro.embudoId && !filtro.webinarId) return cortes;
  return cortes.map((c) => ({ ...c, filtro }));
}

/* ---------- Comparar períodos ----------
   Cada columna se compara con "la misma cosa, un paso para atrás": el
   período con el anterior del mismo largo, un mes con el mes anterior,
   un embudo con ese embudo en el período anterior, un webinar con el
   webinar anterior. */

export function conPrevios(cortes: Corte[]): Corte[] {
  const rangoStr = (desde: string, hasta: string) => {
    const f = (x: string) => `${Number(x.slice(8, 10))} ${MESES[Number(x.slice(5, 7)) - 1].toLowerCase()}`;
    return desde === hasta ? f(desde) : `${f(desde)} – ${f(hasta)}`;
  };

  const previoDe = (c: Corte): Corte => {
    if (c.mes) {
      const [y, m] = c.desde.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      const desde = isoDia(d.getFullYear(), d.getMonth(), 1);
      const hasta = isoDia(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
      return { clave: `${c.clave}:previo`, titulo: `${MESES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, desde, hasta, filtro: c.filtro, foto: false, mes: true };
    }
    const p = periodoAnterior(c.desde, c.hasta);
    return { clave: `${c.clave}:previo`, titulo: "Período anterior", sub: rangoStr(p.desde, p.hasta), desde: p.desde, hasta: p.hasta, filtro: c.filtro, foto: false };
  };

  return cortes.map((c) => ({ ...c, previo: previoDe(c) }));
}
