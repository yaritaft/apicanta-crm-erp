import type {
  AdInsight, CanalOrigen, Contacto, Cuota, EstadoApp, GrupoWppResumen, Lead, NivelIngles, Sesion, Venta, Webinar,
} from "./types";
import { closerDeCuota, cobraDirector, cobraEnFecha, tasaDeComision } from "./finanzas";
import { devolucionesDe, esDevolucionConfirmada, reversasDeComision } from "./devoluciones";
import { descuentaPorCierre, ventasSinCierre } from "./cierre-del-dia";

/* ==================================================================
   Las métricas que Yari viene trackeando webinar a webinar desde 2023.
   Los nombres son los suyos: así puede comparar con su planilla.
   ================================================================== */

export interface MetricasWebinar {
  /* Inversión */
  inversionTotal: number;      // pauta + DM Ads + WhatsApp API
  /* Embudo */
  formularios: number;
  grupoWpp: number;
  asistentes: number;
  llamadas: number;
  llamadasCalificadas: number;
  ventas: number;
  /* Costos unitarios */
  cplFormulario: number;
  cplGrupo: number;
  cpLlamada: number;
  cpLlamadaCalificada: number;
  cpa: number;                 // costo por adquisición
  /* Conversiones */
  asistenciaFormulario: number; // grupo / formularios
  asistenciaTaller: number;     // asistentes / grupo
  porcentajeAgenda: number;     // llamadas / grupo
  agendaSobreAsisten: number;   // llamadas / asistentes
  convLeadVenta: number;        // ventas / grupo
  tasaCierre: number;           // ventas / llamadas agendadas (todas las del webinar, no sólo las calificadas)
  /* Plata */
  facturado: number;
  /* El Cash Collected de las ventas del webinar: lo que entró menos lo que se
     devolvió de ellas. */
  cobrado: number;
  /* Lo que se devolvió de las ventas del webinar (ya restado de `cobrado`). */
  devoluciones: number;
  comisiones: number;
  /* Lo que se quedaron los procesadores de pago */
  procesador: number;
  /* Los gastos de Finanzas atribuidos a este webinar (se eligen al cargarlos). */
  otrosGastos: number;
  roasRev: number;
  roasCC: number;
  beneficioRev: number;
  beneficioCC: number;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const pctDiv = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/* Lo que se SUMA entre webinars. Todo lo demás (costos, tasas, ROAS) se
   deriva de esto, en un solo lugar: así el total de la planilla sale con
   la misma fórmula que cada fila, y no del promedio de los porcentajes —
   el promedio de cinco ROAS no es el ROAS de los cinco. */
type Base = Pick<MetricasWebinar,
  | "inversionTotal" | "formularios" | "grupoWpp" | "asistentes" | "llamadas"
  | "llamadasCalificadas" | "ventas" | "facturado" | "cobrado" | "devoluciones" | "comisiones" | "procesador" | "otrosGastos">;

const CLAVES_BASE: (keyof Base)[] = [
  "inversionTotal", "formularios", "grupoWpp", "asistentes", "llamadas",
  "llamadasCalificadas", "ventas", "facturado", "cobrado", "devoluciones", "comisiones", "procesador", "otrosGastos",
];

function derivar(b: Base): MetricasWebinar {
  /* Profit del webinar = plata − (pauta + DM + WAPI) − comisiones − procesador,
     y los gastos que se cargaron como de este webinar. */
  const descuentos = b.inversionTotal + b.comisiones + b.procesador + b.otrosGastos;
  return {
    ...b,
    cplFormulario: div(b.inversionTotal, b.formularios),
    cplGrupo: div(b.inversionTotal, b.grupoWpp),
    cpLlamada: div(b.inversionTotal, b.llamadas),
    cpLlamadaCalificada: div(b.inversionTotal, b.llamadasCalificadas),
    cpa: div(b.inversionTotal, b.ventas),

    asistenciaFormulario: pctDiv(b.grupoWpp, b.formularios),
    asistenciaTaller: pctDiv(b.asistentes, b.grupoWpp),
    porcentajeAgenda: pctDiv(b.llamadas, b.grupoWpp),
    agendaSobreAsisten: pctDiv(b.llamadas, b.asistentes),
    convLeadVenta: pctDiv(b.ventas, b.grupoWpp),
    /* Sobre TODAS las agendas del webinar, no sobre las calificadas: «Calificadas» depende de una regla estricta
       (7 de 76 el 21/10) y hacía que el cierre diera más de 100%. */
    tasaCierre: pctDiv(b.ventas, b.llamadas),

    roasRev: div(b.facturado, b.inversionTotal),
    roasCC: div(b.cobrado, b.inversionTotal),
    /* Lo devuelto también resta de lo facturado: la venta sigue contando, pero
       esa plata ya no es ganancia (como en el estado de resultados). */
    beneficioRev: b.facturado - b.devoluciones - descuentos,
    beneficioCC: b.cobrado - descuentos,
  };
}

/* ==================================================================
   Lo que Meta sabe de cada webinar

   Las campañas de captación se llaman «[WEBINAR 23/09] …»: su gasto es la
   pauta del webinar y sus leads, los formularios completados. Los DM Ads
   son las campañas «DM …» (DM WP API): cada día de gasto va al próximo
   webinar, el que ese día se estaba calentando. WhatsApp API no es de
   Meta Ads: se factura en la cuenta de WhatsApp Business (ver abajo).

   Lo cargado a mano manda: Meta sólo llena lo que está en cero.
   El costo de WhatsApp API (lo que cobra Meta por los mensajes de la API) sale de la cuenta de WhatsApp Business, día por día, y se
   reparte igual que los DM Ads (lib/meta-whatsapp.ts, tabla whatsapp_costos).
   ================================================================== */

export interface MetaDelWebinar { pauta: number; formularios: number; dmAds: number }

const RE_CAMPANIA_WEBINAR = /WEBINAR\s*(\d{1,2})\s*\/\s*(\d{1,2})/i;
const RE_CAMPANIA_DM = /(^|[^a-z])DM([^a-z]|$)/i;

/* El día de Argentina de un instante (los vivos son a las 19). */
const diaAr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86400000;

/* Las memorias de abajo se indexan por la IDENTIDAD de los arreglos del estado. Un `e.costosWpp ?? []` crea un arreglo nuevo en cada llamada:
   con la API de WhatsApp sin conectar (sin costos), ninguna memoria acertaba nunca y el Dashboard recalculaba los 8.000 días de gasto de Meta
   por cada webinar y cada columna (15 s con el mes de septiembre). Lo vacío es siempre el mismo arreglo. */
const SIN_FILAS: never[] = [];

/* Se calcula una vez por cada combinación de anuncios y webinars: la
   planilla lo pide para cada fila a cada celda que se carga. */
const META_WEBINAR = new WeakMap<object, WeakMap<object, Map<string, MetaDelWebinar>>>();

/** Qué día y qué webinar le toca a cada día de gasto de Meta, y de qué tipo
 *  es: pauta de captación (las campañas «[WEBINAR dd/mm]») o DM Ads (las
 *  «DM …»). Es LA regla de las campañas del webinar: la usan los números de
 *  la planilla y el informe del webinar (lib/informe-webinar.ts). */
export interface InsightDeWebinar { insight: AdInsight; webinarId: string; tipo: "pauta" | "dm" }

const REPARTO_INSIGHTS = new WeakMap<object, WeakMap<object, { ads: unknown; campaigns: unknown; out: InsightDeWebinar[] }>>();

export function repartirInsights(e: EstadoApp): InsightDeWebinar[] {
  const insights = e.adInsights ?? SIN_FILAS;
  const out: InsightDeWebinar[] = [];
  if (!insights.length || !e.webinars.length) return out;
  /* Se reparte una vez por combinación de anuncios, campañas y webinars (lo piden el gasto de cada webinar y cada columna del Dashboard). */
  let porWebinars = REPARTO_INSIGHTS.get(insights);
  if (!porWebinars) { porWebinars = new WeakMap(); REPARTO_INSIGHTS.set(insights, porWebinars); }
  const previo = porWebinars.get(e.webinars);
  if (previo && previo.ads === e.ads && previo.campaigns === e.campaigns) return previo.out;
  porWebinars.set(e.webinars, { ads: e.ads, campaigns: e.campaigns, out });
  const campania = new Map((e.campaigns ?? []).map((c) => [c.id, c.nombre] as const));
  const campaniaDeAd = new Map((e.ads ?? []).map((a) => [a.id, campania.get(a.campaignId) ?? ""] as const));
  const webinars = [...e.webinars].map((w) => ({ w, dia: diaAr(w.fecha) })).sort((a, b) => a.dia.localeCompare(b.dia));
  for (const i of insights) {
    const nombre = campaniaDeAd.get(i.adId) ?? "";
    const m = RE_CAMPANIA_WEBINAR.exec(nombre);
    if (m) {
      /* El webinar de ese día y mes cuyo vivo está cerca de cuando corrió el anuncio. */
      const dd = Number(m[1]), mm = Number(m[2]);
      const w = webinars.find(({ dia }) => Number(dia.slice(8, 10)) === dd && Number(dia.slice(5, 7)) === mm
        && diasEntre(i.dia, dia) >= -10 && diasEntre(i.dia, dia) <= 45);
      if (w) out.push({ insight: i, webinarId: w.w.id, tipo: "pauta" });
      continue;
    }
    if (RE_CAMPANIA_DM.test(nombre)) {
      const w = webinars.find(({ dia }) => dia >= i.dia && diasEntre(i.dia, dia) <= 21);
      if (w) out.push({ insight: i, webinarId: w.w.id, tipo: "dm" });
    }
  }
  return out;
}

/** Los días de gasto de Meta de las campañas de un webinar. */
export const insightsDelWebinar = (e: EstadoApp, w: Webinar): InsightDeWebinar[] =>
  repartirInsights(e).filter((x) => x.webinarId === w.id);

function metaPorWebinar(e: EstadoApp): Map<string, MetaDelWebinar> {
  const insights = e.adInsights ?? SIN_FILAS;
  let porWebinars = META_WEBINAR.get(insights);
  if (!porWebinars) { porWebinars = new WeakMap(); META_WEBINAR.set(insights, porWebinars); }
  const guardado = porWebinars.get(e.webinars);
  if (guardado) return guardado;
  const out = new Map<string, MetaDelWebinar>();
  porWebinars.set(e.webinars, out);
  const de = (id: string) => {
    let m = out.get(id);
    if (!m) { m = { pauta: 0, formularios: 0, dmAds: 0 }; out.set(id, m); }
    return m;
  };
  for (const { insight: i, webinarId, tipo } of repartirInsights(e)) {
    const x = de(webinarId);
    if (tipo === "pauta") { x.pauta += i.inversion; x.formularios += i.leads; }
    else x.dmAds += i.inversion;
  }
  for (const m of out.values()) {
    m.pauta = Math.round(m.pauta * 100) / 100;
    m.dmAds = Math.round(m.dmAds * 100) / 100;
  }
  return out;
}

export function metaDelWebinar(e: EstadoApp, w: Webinar): MetaDelWebinar | undefined {
  return metaPorWebinar(e).get(w.id);
}

/* ==================================================================
   Lo que el lector de WhatsApp sabe de cada webinar

   El lector (servicios/whatsapp-lector) mira los grupos del webinar y cuenta
   quién entró. «Se unieron al grupo» sale de ahí, en vivo, sin cargarlo a mano:
   todos los que pasaron por los grupos atados al webinar (los que están más los
   que salieron, cada persona una vez) y los que WhatsApp muestra sin teléfono.
   Lo cargado a mano manda: el lector sólo llena lo que está en cero, igual que Meta.
   ================================================================== */

/** Los grupos de WhatsApp de un webinar, tal como los suma la vista (undefined si el lector no tiene ninguno atado). */
export const gruposWppDelWebinar = (e: EstadoApp, w: Webinar): GrupoWppResumen | undefined =>
  e.gruposWpp?.find((g) => g.webinarId === w.id);

/** Cuántos se unieron: los que pasaron por los grupos y los que no se les ve el teléfono. */
export const seUnieronAlGrupo = (g: GrupoWppResumen) => g.entraron + g.sinTelefono;

/* Cada día de costo de WhatsApp API va al próximo webinar, el que ese día se estaba calentando (la misma regla que los DM Ads: el vivo es ese
   día o hasta 21 días después). Se calcula una vez por combinación de costos y webinars. */
const COSTO_WPP = new WeakMap<object, WeakMap<object, Map<string, number>>>();
const REPARTO_WPP = new WeakMap<object, WeakMap<object, { dia: string; webinarId: string; costo: number }[]>>();

/** A qué webinar va cada día de costo de WhatsApp API (el próximo vivo, hasta 21 días después). */
function repartirCostosWpp(e: EstadoApp): { dia: string; webinarId: string; costo: number }[] {
  const costos = e.costosWpp ?? SIN_FILAS;
  if (!costos.length || !e.webinars.length) return [];
  let porWebinars = REPARTO_WPP.get(costos);
  if (!porWebinars) { porWebinars = new WeakMap(); REPARTO_WPP.set(costos, porWebinars); }
  const guardado = porWebinars.get(e.webinars);
  if (guardado) return guardado;
  const out: { dia: string; webinarId: string; costo: number }[] = [];
  porWebinars.set(e.webinars, out);
  const webinars = [...e.webinars].filter((w) => w.estado !== "borrador").map((w) => ({ w, dia: diaAr(w.fecha) })).sort((a, b) => a.dia.localeCompare(b.dia));
  for (const c of costos) {
    const destino = webinars.find(({ dia }) => dia >= c.dia && diasEntre(c.dia, dia) <= 21);
    if (destino) out.push({ dia: c.dia, webinarId: destino.w.id, costo: c.costo });
  }
  return out;
}

function costosWppPorWebinar(e: EstadoApp): Map<string, number> {
  const costos = e.costosWpp ?? SIN_FILAS;
  if (!costos.length || !e.webinars.length) return new Map();
  let porWebinars = COSTO_WPP.get(costos);
  if (!porWebinars) { porWebinars = new WeakMap(); COSTO_WPP.set(costos, porWebinars); }
  const guardado = porWebinars.get(e.webinars);
  if (guardado) return guardado;
  const out = new Map<string, number>();
  porWebinars.set(e.webinars, out);
  for (const r of repartirCostosWpp(e)) out.set(r.webinarId, (out.get(r.webinarId) ?? 0) + r.costo);
  for (const [k, v] of out) out.set(k, Math.round(v * 100) / 100);
  return out;
}

/** Lo que cobró WhatsApp por los mensajes de la API de ese webinar (0 si no se sabe). */
export const costoWhatsappDelWebinar = (e: EstadoApp, w: Webinar): number => costosWppPorWebinar(e).get(w.id) ?? 0;

/* ==================================================================
   El gasto de los webinars, día por día

   «Pauta de captación», «DM Ads» y «WhatsApp API» de un webinar se gastan a lo largo de las semanas de antes del vivo. En una tabla por día
   (Dashboard) contarlos todos el día del vivo dejaba el resto de los días en blanco y no cuadraba con el gasto de Meta. Acá cada día de gasto
   cae en SU día y en el webinar al que pertenece (las mismas reglas de arriba), y se puede pedir de un webinar o de todos juntos.
   Lo cargado a mano en la planilla manda, como siempre: no tiene días, así que se cuenta el día del vivo.
   ================================================================== */

export interface GastoDeWebinar { pauta: number; dmAds: number; whatsappApi: number }

interface GastoDiario { pauta: Map<string, number>; dm: Map<string, number>; whatsapp: Map<string, number> }
const GASTO_DIARIO = new WeakMap<object, WeakMap<object, WeakMap<object, Map<string, GastoDiario>>>>();

function gastoDiarioPorWebinar(e: EstadoApp): Map<string, GastoDiario> {
  const insights = e.adInsights ?? SIN_FILAS;
  const costos = e.costosWpp ?? SIN_FILAS;
  let a = GASTO_DIARIO.get(insights);
  if (!a) { a = new WeakMap(); GASTO_DIARIO.set(insights, a); }
  let b = a.get(e.webinars);
  if (!b) { b = new WeakMap(); a.set(e.webinars, b); }
  const guardado = b.get(costos);
  if (guardado) return guardado;
  const out = new Map<string, GastoDiario>();
  b.set(costos, out);
  const de = (id: string) => {
    let x = out.get(id);
    if (!x) { x = { pauta: new Map(), dm: new Map(), whatsapp: new Map() }; out.set(id, x); }
    return x;
  };
  const sumar = (m: Map<string, number>, dia: string, n: number) => m.set(dia, (m.get(dia) ?? 0) + n);
  for (const { insight: i, webinarId, tipo } of repartirInsights(e)) sumar(tipo === "pauta" ? de(webinarId).pauta : de(webinarId).dm, i.dia, i.inversion);
  for (const r of repartirCostosWpp(e)) sumar(de(r.webinarId).whatsapp, r.dia, r.costo);
  return out;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Lo que gastó un webinar entre dos días de Argentina (inclusive): cada día de gasto en su día. Lo cargado a mano en la planilla, el día del vivo. */
export function gastoDelWebinarEnDias(e: EstadoApp, w: Webinar, desde: string, hasta: string): GastoDeWebinar {
  const vivo = diaAr(w.fecha);
  const dentro = vivo >= desde && vivo <= hasta;
  const d = gastoDiarioPorWebinar(e).get(w.id);
  const suma = (m: Map<string, number> | undefined) => {
    let t = 0;
    if (m) for (const [dia, n] of m) if (dia >= desde && dia <= hasta) t += n;
    return t;
  };
  return {
    pauta: centavos(w.inversion > 0 ? (dentro ? w.inversion : 0) : suma(d?.pauta)),
    dmAds: centavos(w.inversionDmAds > 0 ? (dentro ? w.inversionDmAds : 0) : suma(d?.dm)),
    whatsappApi: centavos(w.costoWhatsappApi > 0 ? (dentro ? w.costoWhatsappApi : 0) : suma(d?.whatsapp)),
  };
}

/** Lo mismo de varios webinars juntos. */
export function gastoDeWebinarsEnDias(e: EstadoApp, ws: Webinar[], desde: string, hasta: string): GastoDeWebinar {
  const t: GastoDeWebinar = { pauta: 0, dmAds: 0, whatsappApi: 0 };
  for (const w of ws) {
    const x = gastoDelWebinarEnDias(e, w, desde, hasta);
    t.pauta += x.pauta; t.dmAds += x.dmAds; t.whatsappApi += x.whatsappApi;
  }
  return { pauta: centavos(t.pauta), dmAds: centavos(t.dmAds), whatsappApi: centavos(t.whatsappApi) };
}

/** Cuántos se registraron en la landing para ese webinar (0 si no se sabe). */
export const registrosDelWebinar = (e: EstadoApp, w: Webinar): number =>
  e.registrosPorWebinar?.find((r) => r.webinarId === w.id)?.registros ?? 0;

/** Los formularios de un webinar y de dónde salen. Lo cargado a mano manda. Si no hay nada, salen de Meta y, en un webinar sin campañas de Meta
    (los de antes de conectarla), de los registros de la landing. Y el número que la app cuenta sola al registrarse alguien
    (`extra.formulariosAuto`, que sólo ve a los que entraron por la ruta de registro) nunca se muestra por debajo de lo que dicen Meta o los
    registros de la landing: en un webinar en curso decía 147 cuando ya había 1.309 registrados. */
export function formulariosDelWebinar(e: EstadoApp, w: Webinar): { valor: number; origen: "mano" | "meta" | "landing" | "contado" } {
  const m = metaDelWebinar(e, w);
  const reg = registrosDelWebinar(e, w);
  const contado = typeof w.extra?.formulariosAuto === "number" ? w.extra.formulariosAuto : undefined;
  if (w.formularios && w.formularios !== contado) return { valor: w.formularios, origen: "mano" };
  const de = [
    { valor: w.formularios, origen: "contado" as const },
    { valor: m?.formularios ?? 0, origen: "meta" as const },
    { valor: reg, origen: "landing" as const },
  ];
  /* Sin nada contado, Meta antes que la landing; con un contado de la app, el mayor de los tres. */
  const mejor = w.formularios
    ? de.reduce((a, b) => (b.valor > a.valor ? b : a))
    : (de[1].valor ? de[1] : de[2]);
  return mejor;
}

/** El webinar con lo que falta cargar tomado de Meta, del lector de WhatsApp y de los registros de la landing. Lo cargado a mano manda. */
export function numerosDelWebinar(e: EstadoApp, w: Webinar): Webinar {
  const m = metaDelWebinar(e, w);
  const g = gruposWppDelWebinar(e, w);
  const reg = registrosDelWebinar(e, w);
  const wa = costoWhatsappDelWebinar(e, w);
  if (!m && !g && !reg && !wa) return w;
  const f = formulariosDelWebinar(e, w);
  return {
    ...w,
    ...(wa ? { costoWhatsappApi: w.costoWhatsappApi || wa } : {}),
    ...(m ? {
      inversion: w.inversion || m.pauta,
      inversionDmAds: w.inversionDmAds || m.dmAds,
    } : {}),
    ...(m || reg ? { formularios: f.valor } : {}),
    ...(g ? { grupoWpp: w.grupoWpp || seUnieronAlGrupo(g) } : {}),
  };
}

/** Qué números del webinar salen del lector de WhatsApp (los que están en cero a mano). */
export function camposDeWhatsapp(e: EstadoApp, w: Webinar): Set<CampoManual> {
  const g = gruposWppDelWebinar(e, w);
  return new Set<CampoManual>(!w.grupoWpp && g && seUnieronAlGrupo(g) > 0 ? ["grupoWpp"] : []);
}

/** De dónde sale un número que no se cargó a mano, para decirlo al lado de la celda (undefined: lo cargó alguien). */
export function origenAutomatico(e: EstadoApp, w: Webinar, campo: CampoManual): string | undefined {
  if (campo === "costoWhatsappApi") return !w.costoWhatsappApi && costoWhatsappDelWebinar(e, w) > 0 ? "De la facturación de WhatsApp Business (Meta)" : undefined;
  if (campo === "formularios") {
    const f = formulariosDelWebinar(e, w);
    if (f.origen === "meta" && f.valor > 0) return "De sus campañas de Meta";
    if (f.origen === "landing" && f.valor > 0) return "De los registros de la landing (Formularios)";
    return undefined;
  }
  if (camposDeMeta(e, w).has(campo)) return "De sus campañas de Meta";
  if (camposDeWhatsapp(e, w).has(campo)) return "De los grupos de WhatsApp: los que entraron, según el lector";
  return undefined;
}

/** Qué números del webinar salen de Meta (los que están en cero a mano). */
export function camposDeMeta(e: EstadoApp, w: Webinar): Set<CampoManual> {
  const m = metaDelWebinar(e, w);
  const out = new Set<CampoManual>();
  if (!m) return out;
  if (!w.inversion && m.pauta) out.add("inversion");
  if (!w.formularios && m.formularios) out.add("formularios");
  if (!w.inversionDmAds && m.dmAds) out.add("inversionDmAds");
  return out;
}

export function metricasDeWebinar(e: EstadoApp, webinar: Webinar): MetricasWebinar {
  const w = numerosDelWebinar(e, webinar);
  const inversionTotal = w.inversion + w.inversionDmAds + w.costoWhatsappApi;
  const llamadas = w.llamadasVivo + w.llamadasPosterior;

  const ventas = e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada");
  const facturado = ventas.reduce((a, v) => a + v.precioAcordado, 0);

  /* De qué venta es cada cuota, sólo para las ventas de este webinar. Con
     índices y no con filter+includes anidados: la planilla recalcula esto
     para cada webinar a cada celda que se carga. */
  const ventaPorId = new Map(ventas.map((v) => [v.id, v] as const));
  const cuotaDe = new Map<string, Cuota>();
  for (const c of e.cuotas) if (ventaPorId.has(c.ventaId)) cuotaDe.set(c.id, c);
  const pagos = e.pagos.filter((p) => cuotaDe.has(p.cuotaId));
  const fees = pagos.reduce((a, p) => a + p.feeMonto, 0);
  /* Lo devuelto de estas ventas resta de lo cobrado, igual que en Finanzas
     (la comisión de la pasarela sigue siendo la de los cobros). */
  const devuelto = devolucionesDe(e)
    .filter((d) => esDevolucionConfirmada(d) && d.ventaId && ventaPorId.has(d.ventaId))
    .reduce((a, d) => a + d.monto, 0);
  const cobrado = pagos.reduce((a, p) => a + p.monto, 0) - devuelto;

  /* Comisiones: closer + director sobre el neto de procesador de cada
     cobro, salvo que la venta la haya cerrado Yari. El closer es el de la
     cuota (el que la heredó, si el suyo se fue), y nadie cobra lo que entró
     después de irse (cobraEnFecha): lo mismo que Finanzas. Y con el interruptor
     del cierre del día prendido, la del closer de una venta que salió de un
     día sin cierre cargado ese mismo día tampoco (descuentaPorCierre). */
  const miembro = new Map(e.equipo.map((x) => [x.id, x] as const));
  const sinCierre = ventasSinCierre(e);
  let comisiones = 0;
  for (const p of pagos) {
    const c = cuotaDe.get(p.cuotaId) as Cuota;
    const v = ventaPorId.get(c.ventaId) as Venta;
    if (v.closerId && miembro.get(v.closerId)?.sinComision) continue;
    const neto = p.monto - p.feeMonto;
    const closerId = closerDeCuota(v, c);
    const closer = closerId ? miembro.get(closerId) : undefined;
    const director = v.directorId ? miembro.get(v.directorId) : undefined;
    if (cobraEnFecha(closer, p.fecha) && !descuentaPorCierre(sinCierre, v, closerId)) comisiones += neto * tasaDeComision(closer, v.productoId);
    if (cobraDirector(director, p.fecha)) comisiones += neto * tasaDeComision(director, v.productoId);
  }
  /* Y lo que se les revierte por las devoluciones: lo mismo que Finanzas. */
  if (devuelto > 0) {
    for (const r of reversasDeComision(e)) {
      if (r.sinDescuento || !ventaPorId.has(r.venta.id)) continue;
      for (const x of r.partes) comisiones -= x.reversa;
    }
  }

  return derivar({
    inversionTotal,
    formularios: w.formularios,
    grupoWpp: w.grupoWpp,
    asistentes: w.asistentes,
    llamadas,
    llamadasCalificadas: w.llamadasCalificadas,
    ventas: ventas.length,
    facturado,
    cobrado,
    devoluciones: devuelto,
    comisiones,
    procesador: fees,
    otrosGastos: e.gastos.filter((g) => g.webinarId === webinar.id).reduce((a, g) => a + g.monto, 0),
  });
}

/** Los números de varios webinars juntos, como si fueran uno. */
export function sumarMetricas(ms: MetricasWebinar[]): MetricasWebinar {
  const base = Object.fromEntries(CLAVES_BASE.map((k) => [k, 0])) as Base;
  for (const m of ms) for (const k of CLAVES_BASE) base[k] += m[k];
  return derivar(base);
}

/** Los números de los webinars QUE TIENEN PAUTA cargada, sumados: sirve para lo que compara plata con lo que costó (ROAS, ROI, profit, CAC).
    Un webinar sin pauta (los de antes de conectar Meta, que no tienen cuánto costaron) no tiene retorno que medir, y su plata sola inflaría el
    de los demás. Null si ninguno tiene pauta. */
export function sumarMetricasConPauta(ms: MetricasWebinar[]): MetricasWebinar | null {
  const con = ms.filter((m) => m.inversionTotal > 0);
  return con.length ? sumarMetricas(con) : null;
}

/** Todos los webinars ya pasados, del más viejo al más nuevo, con sus métricas. */
export function serieDeWebinars(e: EstadoApp) {
  return e.webinars
    .filter((w) => w.estado === "finalizado")
    .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    .map((w) => ({ webinar: w, m: metricasDeWebinar(e, w) }));
}

/* ==================================================================
   Lo que se carga a mano

   Un webinar es algo vivo: la pauta corre, el grupo se llena y las
   llamadas se agendan día a día. Estos son los números que alguien
   escribe; todo lo demás se calcula. La planilla y la ficha usan este
   mismo catálogo, así un campo nuevo aparece en los dos lados.
   ================================================================== */

export type CampoManual =
  | "inversion" | "inversionDmAds" | "costoWhatsappApi"
  | "formularios" | "grupoWpp" | "asistentes"
  | "llamadasVivo" | "llamadasPosterior" | "llamadasCanceladas"
  | "llamadasInasistidas" | "llamadasNoCalificadas" | "llamadasCalificadas";

export interface DefCampoManual {
  campo: CampoManual;
  /* Corto, para el encabezado de la planilla */
  titulo: string;
  /* Largo, para la ficha */
  largo: string;
  grupo: "Inversión" | "Captación" | "Llamadas";
  moneda: boolean;
  ayuda: string;
}

export const CAMPOS_MANUALES: DefCampoManual[] = [
  { campo: "inversion", titulo: "Pauta", largo: "Pauta de captación", grupo: "Inversión", moneda: true, ayuda: "Lo que se gastó en anuncios para que la gente se registre." },
  { campo: "inversionDmAds", titulo: "DM Ads", largo: "DM Ads", grupo: "Inversión", moneda: true, ayuda: "Los anuncios que llevan a una conversación por mensaje." },
  { campo: "costoWhatsappApi", titulo: "WhatsApp API", largo: "WhatsApp API", grupo: "Inversión", moneda: true, ayuda: "Lo que cobró WhatsApp por los mensajes y recordatorios." },
  { campo: "formularios", titulo: "Formularios", largo: "Formularios completados", grupo: "Captación", moneda: false, ayuda: "Gente que completó el formulario de registro." },
  { campo: "grupoWpp", titulo: "Grupo", largo: "Se unieron al grupo", grupo: "Captación", moneda: false, ayuda: "Los que entraron al grupo de WhatsApp." },
  { campo: "asistentes", titulo: "Asistentes", largo: "Asistieron al vivo", grupo: "Captación", moneda: false, ayuda: "El pico: la mayor cantidad de gente viendo a la vez en el vivo." },
  { campo: "llamadasVivo", titulo: "Llamadas en vivo", largo: "Agendadas en el vivo", grupo: "Llamadas", moneda: false, ayuda: "Llamadas agendadas durante el vivo." },
  { campo: "llamadasPosterior", titulo: "Llamadas después", largo: "Agendadas después", grupo: "Llamadas", moneda: false, ayuda: "Llamadas agendadas después del vivo: con el replay, el seguimiento, la clase cero o el Q&A." },
  { campo: "llamadasCanceladas", titulo: "Canceladas", largo: "Canceladas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas que se cancelaron." },
  { campo: "llamadasInasistidas", titulo: "No asistieron", largo: "No asistieron", grupo: "Llamadas", moneda: false, ayuda: "Llamadas a las que la persona no se presentó." },
  { campo: "llamadasNoCalificadas", titulo: "No calificadas", largo: "No calificadas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas hechas con gente que no calificaba para el programa." },
  { campo: "llamadasCalificadas", titulo: "Calificadas", largo: "Calificadas", grupo: "Llamadas", moneda: false, ayuda: "Llamadas hechas con gente que sí calificaba." },
];

export const CAMPO_MANUAL: Record<CampoManual, DefCampoManual> = Object.fromEntries(
  CAMPOS_MANUALES.map((c) => [c.campo, c]),
) as Record<CampoManual, DefCampoManual>;

/* ==================================================================
   La gente de un webinar

   Tres caminos traen a alguien: el contacto que se registró desde el
   webinar (origenWebinarId), el lead atribuido a él (webinarId) y la
   venta cargada con ese webinar como origen. Una misma persona puede
   venir por los tres: se junta en una sola fila, por su contacto.
   ================================================================== */

export interface PersonaDeWebinar {
  /* Clave estable de la fila: el contacto, o el lead, o la venta suelta. */
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  pais?: string;
  contactoId?: string;
  /* La oportunidad: es lo que abre /leads?ver=<id>. */
  leadId?: string;
  etapaId?: string;
  entro?: string;
  canal?: CanalOrigen;
  inglesNivel?: NivelIngles;
  aniosExperiencia?: number;
  /* Los del registro; si no hay, los de la agenda. */
  utm?: Record<string, string>;
  llamadas: Sesion[];
  /* La que importa: la próxima agendada, o si no la última que no se canceló. */
  llamada?: Sesion;
  ventas: Venta[];
  facturado: number;
  /* El Cash Collected de sus ventas: lo cobrado menos lo que se les devolvió, como en
     metricasDeWebinar (y lo que suma el informe del webinar). */
  cobrado: number;
}

const conValor = (s?: string) => (s && s.trim() ? s : undefined);

export function personasDeWebinar(e: EstadoApp, webinarId: string): PersonaDeWebinar[] {
  const personas = new Map<string, PersonaDeWebinar>();
  const leadPorId = new Map(e.leads.map((l) => [l.id, l] as const));
  const contactoPorId = new Map(e.contactos.map((c) => [c.id, c] as const));
  const claveDeLead = (l: Lead) => l.contactoId ?? l.id;

  const fila = (clave: string, nombre: string): PersonaDeWebinar => {
    const previa = personas.get(clave);
    if (previa) return previa;
    const nueva: PersonaDeWebinar = { id: clave, nombre, llamadas: [], ventas: [], facturado: 0, cobrado: 0 };
    personas.set(clave, nueva);
    return nueva;
  };

  /* Lo de la persona manda sobre lo de la oportunidad: el contacto es la
     fuente de verdad desde que se separaron. Se completan huecos, no se pisa. */
  const deContacto = (p: PersonaDeWebinar, c: Contacto) => {
    p.contactoId = c.id;
    p.nombre = conValor(c.nombre) ?? p.nombre;
    p.email = conValor(c.email) ?? p.email;
    p.telefono = conValor(c.telefono) ?? p.telefono;
    p.pais = conValor(c.pais) ?? p.pais;
    p.canal = c.origenCanal ?? p.canal;
    p.inglesNivel = c.inglesNivel ?? p.inglesNivel;
    p.aniosExperiencia = c.aniosExperiencia ?? p.aniosExperiencia;
    p.utm = c.utm ?? p.utm;
    p.entro = c.creadoEn ?? p.entro;
  };
  const deLead = (p: PersonaDeWebinar, l: Lead) => {
    /* Si la persona tiene varias oportunidades, la de ESTE webinar. */
    if (!p.leadId || l.webinarId === webinarId) {
      p.leadId = l.id;
      p.etapaId = l.etapaId;
    }
    p.nombre = p.nombre || l.nombre;
    p.email = p.email ?? conValor(l.email);
    p.telefono = p.telefono ?? conValor(l.telefono);
    p.pais = p.pais ?? conValor(l.pais);
    p.inglesNivel = p.inglesNivel ?? l.inglesNivel;
    p.aniosExperiencia = p.aniosExperiencia ?? l.aniosExperiencia;
    p.entro = p.entro ?? l.creadoEn;
  };

  /* Se registró a este webinar: en la landing (extra.registrosWebinar) o en
     un formulario de Meta (extra.formulariosMeta), aunque su origen sea otro
     webinar anterior. */
  const seRegistro = (c: Contacto) => [c.extra?.registrosWebinar, c.extra?.formulariosMeta]
    .some((xs) => Array.isArray(xs) && (xs as { webinarId?: string }[]).some((r) => r.webinarId === webinarId));
  for (const c of e.contactos) {
    if (c.origenWebinarId === webinarId || seRegistro(c)) deContacto(fila(c.id, c.nombre), c);
  }
  for (const l of e.leads) {
    if (l.webinarId !== webinarId) continue;
    const p = fila(claveDeLead(l), l.nombre);
    const c = l.contactoId ? contactoPorId.get(l.contactoId) : undefined;
    if (c && !p.contactoId) deContacto(p, c);
    deLead(p, l);
  }
  for (const v of e.ventas) {
    if (v.webinarId !== webinarId) continue;
    /* `ventas.contactoId` guarda hoy ids de LEADS (ver store.ts); se prueba
       primero como lead y después como contacto. */
    const lead = v.contactoId ? leadPorId.get(v.contactoId) : undefined;
    const contacto = !lead && v.contactoId ? contactoPorId.get(v.contactoId) : undefined;
    const clave = lead ? claveDeLead(lead) : contacto ? contacto.id : `venta:${v.id}`;
    const p = fila(clave, v.contactoNombre);
    if (contacto && !p.contactoId) deContacto(p, contacto);
    if (lead) {
      const c = lead.contactoId ? contactoPorId.get(lead.contactoId) : undefined;
      if (c && !p.contactoId) deContacto(p, c);
      if (!p.leadId) deLead(p, lead);
    }
    p.entro = p.entro ?? v.fecha;
    p.ventas.push(v);
  }

  /* Todo indexado de una pasada: con miles de llamadas, buscarlas persona
     por persona recorriendo la lista entera se nota. */
  const agrupar = <T,>(xs: T[], clave: (x: T) => string | undefined) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const k = clave(x);
      if (!k) continue;
      const lista = m.get(k);
      if (lista) lista.push(x); else m.set(k, [x]);
    }
    return m;
  };
  /* Oportunidades que la persona tenga por otro lado: sirven para encontrar
     sus llamadas y para poder abrirla en Leads. */
  const leadsPorContacto = agrupar(e.leads, claveDeLead);
  const llamadasPorContacto = agrupar(e.sesiones, (s) => s.contactoId);
  const llamadasPorLead = agrupar(e.sesiones, (s) => s.leadId);
  const cuotasPorVenta = agrupar(e.cuotas, (c) => c.ventaId);
  const cobradoPorCuota = new Map<string, number>();
  for (const pg of e.pagos) cobradoPorCuota.set(pg.cuotaId, (cobradoPorCuota.get(pg.cuotaId) ?? 0) + pg.monto);
  /* Lo devuelto de cada venta (sólo las confirmadas): resta de lo cobrado, igual que en metricasDeWebinar. */
  const devueltoPorVenta = new Map<string, number>();
  for (const d of devolucionesDe(e)) {
    if (d.ventaId && esDevolucionConfirmada(d)) devueltoPorVenta.set(d.ventaId, (devueltoPorVenta.get(d.ventaId) ?? 0) + d.monto);
  }

  const ahora = Date.now();
  for (const p of personas.values()) {
    const suyos = p.contactoId ? leadsPorContacto.get(p.contactoId) ?? [] : [];
    if (!p.leadId && suyos[0]) deLead(p, suyos[0]);
    const leadIds = new Set([p.leadId, ...suyos.map((l) => l.id)].filter(Boolean) as string[]);

    const llamadas = new Map<string, Sesion>();
    for (const s of p.contactoId ? llamadasPorContacto.get(p.contactoId) ?? [] : []) llamadas.set(s.id, s);
    for (const id of leadIds) for (const s of llamadasPorLead.get(id) ?? []) llamadas.set(s.id, s);
    p.llamadas = [...llamadas.values()].sort((a, b) => +new Date(b.inicia) - +new Date(a.inicia));
    const proxima = [...p.llamadas].reverse()
      .find((s) => s.estado === "agendada" && +new Date(s.inicia) >= ahora - 3600000);
    p.llamada = proxima ?? p.llamadas.find((s) => s.estado !== "cancelada") ?? p.llamadas[0];
    if (!p.utm && p.llamada?.utm) p.utm = p.llamada.utm;

    for (const v of p.ventas) {
      if (v.estado === "cancelada") continue;
      p.facturado += v.precioAcordado;
      p.cobrado += (cuotasPorVenta.get(v.id) ?? []).reduce((a, c) => a + (cobradoPorCuota.get(c.id) ?? 0), 0) - (devueltoPorVenta.get(v.id) ?? 0);
    }
  }

  return [...personas.values()];
}
