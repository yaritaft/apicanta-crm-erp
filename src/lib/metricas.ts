import type { Ad, Contacto, EstadoApp, ID, Lead, Meta, MetricaClave } from "./types";
import { inicioSemana, mesClave, nombreMes } from "./format";
import { calcularPyL, cashCollected, porCobrarTotal } from "./finanzas";
import { diaDeNegocio } from "@/components/ui/DateRangePicker";

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

/* Puente entre el DateRangePicker y todo el calculo, que ya trabajaba con
   rangos aunque se llamaran "mes". El borde derecho va al final del dia: si
   `hasta` quedara a las 00:00, un pago de esa misma tarde caeria afuera. */
export function rangoDeFechas(desde: string, hasta: string, etiqueta: string): RangoMes {
  const [ay, am, ad] = desde.split("-").map(Number);
  const [by, bm, bd] = hasta.split("-").map(Number);
  return {
    clave: `${desde}_${hasta}`,
    etiqueta,
    desde: new Date(ay, am - 1, ad),
    hasta: new Date(by, bm - 1, bd, 23, 59, 59),
  };
}

/* El periodo inmediatamente anterior, del mismo largo. Es contra lo que se
   compara: "vs. periodo anterior" tiene que significar los mismos dias, no
   "el mes pasado", o comparar 7 dias contra 30. */
export function periodoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const a = new Date(`${desde}T00:00:00`), b = new Date(`${hasta}T00:00:00`);
  const dias = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    desde: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - dias)),
    hasta: iso(new Date(a.getFullYear(), a.getMonth(), a.getDate() - 1)),
  };
}

const enMes = (iso: string, m: RangoMes) => {
  const d = new Date(iso).getTime();
  return d >= m.desde.getTime() && d <= m.hasta.getTime();
};

/* ---------- Finanzas ----------
   El cálculo real vive en lib/finanzas.ts; acá quedan los atajos
   que usan el panel y las metas.                                  */

export function ingresosMes(e: EstadoApp, m: RangoMes): number {
  return cashCollected(e, m);
}

export function egresosMes(e: EstadoApp, m: RangoMes): number {
  const p = calcularPyL(e, m);
  return p.totalDirectos + p.gastosOperativos + p.honorariosCeo;
}

export function porCobrar(e: EstadoApp): number {
  return porCobrarTotal(e);
}

export function alumnosActivos(e: EstadoApp) {
  return e.alumnos.filter((a) => a.estado === "activo");
}

export function mrr(e: EstadoApp): number {
  return alumnosActivos(e).reduce((a, x) => a + x.cuotaMensual, 0);
}

/* ---------- Leads y pipeline ---------- */

export function leadsMes(e: EstadoApp, m: RangoMes) {
  return e.leads.filter((l) => enMes(l.creadoEn, m));
}

export function inscriptosMes(e: EstadoApp, m: RangoMes) {
  const ganada = e.etapas.find((x) => x.esGanada)?.id;
  return e.leads.filter((l) => l.etapaId === ganada && enMes(l.actualizadoEn, m));
}

/* Cada lead abierto con lo que vale ponderado por la probabilidad de su
   etapa. El total del Panel y su desglose salen de esta misma lista. */
export function leadsDelPipeline(e: EstadoApp) {
  const abiertas = new Set(e.etapas.filter((x) => !x.esGanada && !x.esPerdida).map((x) => x.id));
  return e.leads
    .filter((l) => abiertas.has(l.etapaId))
    .map((l) => {
      const etapa = e.etapas.find((x) => x.id === l.etapaId);
      const probabilidad = etapa?.probabilidad ?? 0;
      return { lead: l, etapa, probabilidad, ponderado: l.monto * (probabilidad / 100) };
    });
}

export function valorPipeline(e: EstadoApp): { bruto: number; ponderado: number } {
  const filas = leadsDelPipeline(e);
  return {
    bruto: filas.reduce((a, f) => a + f.lead.monto, 0),
    ponderado: filas.reduce((a, f) => a + f.ponderado, 0),
  };
}

/* Los leads que ya se definieron, separados. La tasa y su desglose salen de acá. */
export function leadsCerrados(e: EstadoApp) {
  const etapaDe = (l: { etapaId: string }) => e.etapas.find((x) => x.id === l.etapaId);
  return {
    ganados: e.leads.filter((l) => etapaDe(l)?.esGanada),
    perdidos: e.leads.filter((l) => etapaDe(l)?.esPerdida),
  };
}

export function tasaConversion(e: EstadoApp): number {
  const { ganados, perdidos } = leadsCerrados(e);
  const cerrados = ganados.length + perdidos.length;
  return cerrados === 0 ? 0 : (ganados.length / cerrados) * 100;
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

/* Si Meta las reporto, se usan las de Meta. Las cuentas de abajo son el
   respaldo para las campanias cargadas a mano, y no dan exactamente lo mismo:
   el CTR de Meta sale sobre impresiones servidas y redondea distinto. Entre
   un numero propio y uno que cierra contra el Ads Manager, gana el segundo.

   El CPL no viene de Meta: depende de que conversion contemos como lead, y eso
   lo decide la app. */
export function metricasCampania(c: {
  inversion: number; impresiones: number; clicks: number; leads: number;
  ctr?: number; cpc?: number; cpm?: number;
}) {
  return {
    ctr: c.ctr ?? (c.impresiones > 0 ? (c.clicks / c.impresiones) * 100 : 0),
    cpc: c.cpc ?? (c.clicks > 0 ? c.inversion / c.clicks : 0),
    cpm: c.cpm ?? (c.impresiones > 0 ? (c.inversion / c.impresiones) * 1000 : 0),
    cpl: c.leads > 0 ? c.inversion / c.leads : 0,
  };
}

/* Lo que una campania devolvio en plata.

   La cadena es venta → contacto → lead → lead.campania, y ese ultimo paso es
   por NOMBRE, no por id: hoy `campania` es texto libre en el lead. Alcanza
   mientras los nombres se escriban igual, pero se rompe si alguien renombra
   una campania en Meta. El arreglo de verdad es un `campaniaId` en el lead.

   Ya no la usa ninguna pantalla: Marketing atribuye por PERSONA, con el
   anuncio de origen del contacto (ver `filasMeta`). Queda hasta que se unan
   las ramas en curso, por si alguna la llama; despues se puede borrar. */
export function negocioDeCampania(e: EstadoApp, nombre: string) {
  const leadsDeLaCampania = new Set(
    e.leads.filter((l) => l.campania === nombre).map((l) => l.id),
  );
  const ventas = e.ventas.filter(
    (v) => v.estado !== "cancelada" && v.contactoId && leadsDeLaCampania.has(v.contactoId),
  );
  const facturado = ventas.reduce((s, v) => s + v.precioAcordado, 0);
  const idsVenta = new Set(ventas.map((v) => v.id));
  const cuotas = e.cuotas.filter((c) => idsVenta.has(c.ventaId));
  const idsCuota = new Set(cuotas.map((c) => c.id));
  const cobrado = e.pagos
    .filter((p) => idsCuota.has(p.cuotaId))
    .reduce((s, p) => s + p.monto, 0);
  return { ventas: ventas.length, leads: leadsDeLaCampania.size, facturado, cobrado };
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

/* ---------- Campañas desde la jerarquía de Meta ----------

   Reemplaza la lectura de `campanias`, que guardaba UN número por campaña y
   por eso el filtro de fechas no podía recortar el gasto.

   Acá el gasto se arma sumando las filas de `ad_insights` que caen dentro del
   rango, subiendo de anuncio a campaña. Eso es lo que hace que "últimos 7
   días" devuelva el gasto de esos 7 días. */

export interface FilaCampania {
  id: ID;
  nombre: string;
  objetivo: string;
  estado: string;
  inversion: number;
  impresiones: number;
  clicks: number;
  clicksEnlace: number;
  leads: number;
  ctr: number;
  cpm: number;
  cpc: number;
  ctrEnlace: number;
  cpcEnlace: number;
  cpl: number;
  /* Cuántos días y cuántos anuncios aportaron. Un CPL bajísimo con un solo día
     de datos no es un CPL bajo, es una muestra chica. */
  dias: number;
  anuncios: number;
}

export function campaniasDelRango(
  e: EstadoApp, desde: string, hasta: string,
): FilaCampania[] {
  /* Es el nivel campaña de `filasMeta`, recortado a las que tuvieron días de
     datos en el rango, que es lo que esta función devolvió siempre. Una sola
     cuenta: el Panel y la tabla de Marketing no pueden dar distinto. Las
     personas que suma `filasMeta` acá no entran, así que el resultado es el
     mismo de antes, número por número. */
  return filasMeta(e, desde, hasta, "campania", { incluirSinActividad: true })
    .filter((f) => f.dias > 0)
    .map((f) => ({
      id: f.id, nombre: f.nombre, objetivo: f.objetivo, estado: f.estado,
      inversion: f.inversion, impresiones: f.impresiones, clicks: f.clicks,
      clicksEnlace: f.clicksEnlace, leads: f.leads,
      ctr: f.ctr, cpm: f.cpm, cpc: f.cpc,
      ctrEnlace: f.ctrEnlace, cpcEnlace: f.cpcEnlace, cpl: f.cpl,
      dias: f.dias, anuncios: f.anuncios,
    }));
}

/* ---------- Marketing por nivel: campaña → conjunto → anuncio ----------

   Las tres tablas de Marketing son las del Administrador de anuncios: los
   mismos números a tres alturas. Salen de UNA función para que los niveles no
   puedan discutir entre sí: los conjuntos de una campaña suman lo que dice la
   fila de la campaña porque las dos se arman con las mismas filas de
   ad_insights, recorridas en el mismo orden.

   A lo de Meta se le suma lo nuestro: las personas que entraron por cada
   anuncio (contactos con `origenAdId`) y lo que esas personas compraron. Es lo
   que reemplaza a `negocioDeCampania`, que atribuía por el NOMBRE de la
   campaña y se rompía con cualquier renombre. */

export type NivelMeta = "campania" | "conjunto" | "anuncio";

export interface FiltroMeta {
  /* Sólo lo que cuelga de esta campaña, este conjunto o este anuncio. */
  campaignId?: ID | null;
  adsetId?: ID | null;
  adId?: ID | null;
  /* Por defecto sólo aparece lo que tuvo actividad en el rango: días con datos
     de Meta o personas que entraron. Con esto aparece todo lo que cuelga del
     filtro aunque esté en cero: sirve para encontrar lo pausado que no gastó. */
  incluirSinActividad?: boolean;
}

/* Lo que se suma de fila en fila. */
interface SumasMeta {
  inversion: number;
  impresiones: number;
  clicks: number;
  clicksEnlace: number;
  leads: number;
  /* Suma del alcance de cada día. Meta cuenta personas DISTINTAS en el
     período; sumando días, quien lo vio el lunes y el martes cuenta dos veces.
     null si Meta nunca lo informó: un 0 diría "no lo vio nadie". */
  alcance: number | null;
  /* Las impresiones de los días que traen alcance: la frecuencia se calcula
     sólo sobre esos, o un día sin alcance la inflaría. */
  impresionesConAlcance: number;
  /* Lo nuestro: contactos que entraron por estos anuncios en el rango, y lo
     que compraron (en cualquier fecha: el ciclo de venta es largo, y la
     venta de octubre es hija del anuncio de septiembre). */
  personas: number;
  ventas: number;
  facturado: number;
  cobrado: number;
}

export interface MetricasMeta extends SumasMeta {
  ctr: number;
  cpm: number;
  cpc: number;
  ctrEnlace: number;
  cpcEnlace: number;
  cpl: number;
  /* Impresiones por persona alcanzada, día por día: la frecuencia diaria
     promedio. Alta con el CTR cayendo es fatiga de creativo. */
  frecuencia: number | null;
  costoPorPersona: number;
  /* Cobrado sobre inversión, no facturado: una venta en cuotas que no se
     cobró todavía no devolvió nada. */
  roas: number;
  costoPorVenta: number;
}

export interface FilaMeta extends FilaCampania, MetricasMeta {
  nivel: NivelMeta;
  /* El estado de entrega, normalizado (ver `claveEstado`). `estado` queda
     tal cual lo mandó Meta. */
  entrega: string;
  campaignId: ID;
  campaignNombre: string;
  /* El conjunto de la fila: el propio en el nivel conjunto, el padre en el
     nivel anuncio. */
  adsetId?: ID;
  adsetNombre?: string;
}

const SUMAS_EN_CERO: SumasMeta = {
  inversion: 0, impresiones: 0, clicks: 0, clicksEnlace: 0, leads: 0,
  alcance: null, impresionesConAlcance: 0,
  personas: 0, ventas: 0, facturado: 0, cobrado: 0,
};

/* Las derivadas se RECALCULAN sobre las sumas; no se promedian. El promedio de
   siete CTR no es el CTR de la semana: un día con tres impresiones pesaría
   igual que uno con treinta mil. La misma cuenta sirve para cada fila y para
   la de totales. */
function derivar(s: SumasMeta): MetricasMeta {
  return {
    ...s,
    ctr: s.impresiones > 0 ? (s.clicks / s.impresiones) * 100 : 0,
    cpm: s.impresiones > 0 ? (s.inversion / s.impresiones) * 1000 : 0,
    cpc: s.clicks > 0 ? s.inversion / s.clicks : 0,
    ctrEnlace: s.impresiones > 0 ? (s.clicksEnlace / s.impresiones) * 100 : 0,
    cpcEnlace: s.clicksEnlace > 0 ? s.inversion / s.clicksEnlace : 0,
    cpl: s.leads > 0 ? s.inversion / s.leads : 0,
    frecuencia: s.alcance ? s.impresionesConAlcance / s.alcance : null,
    costoPorPersona: s.personas > 0 ? s.inversion / s.personas : 0,
    roas: s.inversion > 0 ? s.cobrado / s.inversion : 0,
    costoPorVenta: s.ventas > 0 ? s.inversion / s.ventas : 0,
  };
}

/* Meta manda el estado en mayúsculas (ACTIVE, PAUSED, ARCHIVED, DELETED) y el
   sync lo guarda en minúsculas; lo que entró por otro camino puede venir de
   cualquiera de las dos formas, y la tabla vieja lo guardaba en castellano.
   Todo se compara contra esta clave. */
const ALIAS_ESTADO: Record<string, string> = {
  activa: "active", activo: "active", pausada: "paused", pausado: "paused",
  archivada: "archived", archivado: "archived", finalizada: "archived",
};

export function claveEstado(estado: string | null | undefined): string {
  const k = (estado ?? "").trim().toLowerCase();
  return ALIAS_ESTADO[k] ?? k;
}

/* Lo que Meta llama "entrega": un anuncio activo adentro de una campaña
   pausada no sale. El estado propio dice lo que se configuró; éste dice si
   corre, que es lo que se quiere ver al filtrar por "Activo". */
function entregaDe(propio: string, conjunto?: string, campania?: string): string {
  const p = claveEstado(propio);
  if (p !== "active") return p || "sin-estado";
  const c = claveEstado(campania);
  if (c && c !== "active") return "campaign_paused";
  const s = claveEstado(conjunto);
  if (s && s !== "active") return "adset_paused";
  return p;
}

export interface NegocioPersona { ventas: number; facturado: number; cobrado: number }

/* Lo que compró cada persona, por id de contacto.

   `venta.contactoId` guarda a veces el id del contacto y a veces el de un
   lead (las ventas de antes de separar contactos). En los migrados el
   contacto lleva el mismo id que su lead; en los nuevos, el lead dice cuál es
   su contacto. Las canceladas no cuentan, igual que en Finanzas. */
export function negocioPorPersona(e: EstadoApp): Map<ID, NegocioPersona> {
  const contactos = new Set(e.contactos.map((c) => c.id));
  const contactoDeLead = new Map(e.leads.map((l) => [l.id, l.contactoId ?? l.id]));
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId]));
  const cobradoDeVenta = new Map<ID, number>();
  for (const p of e.pagos) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (v) cobradoDeVenta.set(v, (cobradoDeVenta.get(v) ?? 0) + p.monto);
  }

  const out = new Map<ID, NegocioPersona>();
  for (const v of e.ventas) {
    if (v.estado === "cancelada" || !v.contactoId) continue;
    const persona = contactos.has(v.contactoId) ? v.contactoId : contactoDeLead.get(v.contactoId);
    if (!persona) continue;
    const n = out.get(persona) ?? { ventas: 0, facturado: 0, cobrado: 0 };
    n.ventas += 1;
    n.facturado += v.precioAcordado;
    n.cobrado += cobradoDeVenta.get(v.id) ?? 0;
    out.set(persona, n);
  }
  return out;
}

/* Las filas de un nivel en el rango, con lo de Meta y lo nuestro. */
export function filasMeta(
  e: EstadoApp, desde: string, hasta: string, nivel: NivelMeta, filtro: FiltroMeta = {},
): FilaMeta[] {
  const ads = new Map(e.ads.map((a) => [a.id, a]));
  const adsets = new Map(e.adsets.map((s) => [s.id, s]));
  const campaigns = new Map(e.campaigns.map((c) => [c.id, c]));

  /* Qué anuncios cuentan, y a qué fila suma cada uno. */
  const entra = (a: Ad) =>
    (!filtro.campaignId || a.campaignId === filtro.campaignId) &&
    (!filtro.adsetId || a.adsetId === filtro.adsetId) &&
    (!filtro.adId || a.id === filtro.adId);
  const filaDe = (a: Ad) => (nivel === "campania" ? a.campaignId : nivel === "conjunto" ? a.adsetId : a.id);

  type Acum = SumasMeta & { dias: Set<string>; anuncios: Set<string> };
  const acums = new Map<ID, Acum>();
  const acum = (k: ID): Acum => {
    let a = acums.get(k);
    if (!a) {
      a = { ...SUMAS_EN_CERO, dias: new Set(), anuncios: new Set() };
      acums.set(k, a);
    }
    return a;
  };

  /* Lo de Meta: las filas diarias que caen en el rango. */
  for (const i of e.adInsights) {
    /* Comparacion de strings ISO: ordenan igual que las fechas y no arrastran
       husos, que es de donde salen los errores de un dia. */
    if (i.dia < desde || i.dia > hasta) continue;
    const ad = ads.get(i.adId);
    if (!ad || !entra(ad)) continue;
    const a = acum(filaDe(ad));
    a.inversion += i.inversion;
    a.impresiones += i.impresiones;
    a.clicks += i.clicks;
    a.clicksEnlace += i.clicksEnlace ?? 0;
    a.leads += i.leads;
    if (i.alcance != null) {
      a.alcance = (a.alcance ?? 0) + i.alcance;
      a.impresionesConAlcance += i.impresiones;
    }
    a.dias.add(i.dia);
    a.anuncios.add(i.adId);
  }

  /* Lo nuestro: las personas que entraron por esos anuncios en el rango. Por
     el día del negocio, no el de UTC: alguien que se registró a las 22 de
     Argentina entró ese día, aunque el ISO ya diga el siguiente. */
  const negocio = negocioPorPersona(e);
  for (const c of e.contactos) {
    if (!c.origenAdId) continue;
    const ad = ads.get(c.origenAdId);
    if (!ad || !entra(ad)) continue;
    const dia = diaDeNegocio(c.creadoEn);
    if (!dia || dia < desde || dia > hasta) continue;
    const a = acum(filaDe(ad));
    a.personas += 1;
    const n = negocio.get(c.id);
    if (n) {
      a.ventas += n.ventas;
      a.facturado += n.facturado;
      a.cobrado += n.cobrado;
    }
  }

  /* Las filas, en el orden en que las guarda la base. */
  type Base = Pick<FilaMeta, "id" | "nombre" | "objetivo" | "estado" | "entrega" | "campaignId" | "adsetId">;
  const adDelFiltro = filtro.adId ? ads.get(filtro.adId) : undefined;
  const setDelFiltro = filtro.adsetId ? adsets.get(filtro.adsetId) : undefined;
  let bases: Base[];
  if (nivel === "campania") {
    bases = e.campaigns
      .filter((c) =>
        (!filtro.campaignId || c.id === filtro.campaignId) &&
        (!filtro.adsetId || setDelFiltro?.campaignId === c.id) &&
        (!filtro.adId || adDelFiltro?.campaignId === c.id))
      .map((c) => ({
        id: c.id, nombre: c.nombre, objetivo: c.objetivo, estado: c.estado,
        entrega: entregaDe(c.estado), campaignId: c.id,
      }));
  } else if (nivel === "conjunto") {
    bases = e.adsets
      .filter((s) =>
        (!filtro.campaignId || s.campaignId === filtro.campaignId) &&
        (!filtro.adsetId || s.id === filtro.adsetId) &&
        (!filtro.adId || adDelFiltro?.adsetId === s.id))
      .map((s) => {
        const c = campaigns.get(s.campaignId);
        return {
          id: s.id, nombre: s.nombre, objetivo: c?.objetivo ?? "", estado: s.estado,
          entrega: entregaDe(s.estado, undefined, c?.estado),
          campaignId: s.campaignId, adsetId: s.id,
        };
      });
  } else {
    bases = e.ads.filter(entra).map((a) => {
      const c = campaigns.get(a.campaignId);
      const s = adsets.get(a.adsetId);
      return {
        id: a.id, nombre: a.nombre, objetivo: c?.objetivo ?? "", estado: a.estado,
        entrega: entregaDe(a.estado, s?.estado, c?.estado),
        campaignId: a.campaignId, adsetId: a.adsetId,
      };
    });
  }

  return bases
    /* Un acumulado existe sólo si hubo días de datos o personas. */
    .filter((b) => filtro.incluirSinActividad || acums.has(b.id))
    .map((b) => {
      const a = acums.get(b.id);
      const { dias, anuncios, ...sumas } = a ?? { ...SUMAS_EN_CERO, dias: new Set<string>(), anuncios: new Set<string>() };
      return {
        ...b,
        nivel,
        campaignNombre: campaigns.get(b.campaignId)?.nombre ?? "",
        adsetNombre: b.adsetId ? adsets.get(b.adsetId)?.nombre : undefined,
        ...derivar(sumas),
        dias: dias.size,
        anuncios: anuncios.size,
      };
    });
}

/* La fila de totales de una tabla, y los KPIs de arriba: se suma lo sumable y
   las derivadas se recalculan sobre esos totales, igual que en cada fila. */
export function totalesMeta(filas: FilaMeta[]): MetricasMeta & { anuncios: number } {
  const s: SumasMeta = { ...SUMAS_EN_CERO };
  let anuncios = 0;
  for (const f of filas) {
    s.inversion += f.inversion;
    s.impresiones += f.impresiones;
    s.clicks += f.clicks;
    s.clicksEnlace += f.clicksEnlace;
    s.leads += f.leads;
    if (f.alcance != null) s.alcance = (s.alcance ?? 0) + f.alcance;
    s.impresionesConAlcance += f.impresionesConAlcance;
    s.personas += f.personas;
    s.ventas += f.ventas;
    s.facturado += f.facturado;
    s.cobrado += f.cobrado;
    anuncios += f.anuncios;
  }
  return { ...derivar(s), anuncios };
}

export interface PersonaDelAnuncio extends NegocioPersona {
  contacto: Contacto;
  /* La oportunidad más nueva de la persona: es la ficha que abre Leads. */
  leadId?: ID;
  /* El día del negocio en que entró, y si cae en el rango elegido. */
  dia: string;
  enRango: boolean;
}

/* Todas las personas que entraron por un anuncio, las más nuevas primero. Las
   de afuera del rango también: si se llega desde la ficha de alguien que vino
   hace dos meses, el detalle no puede decir que por ahí no entró nadie. */
export function personasDelAnuncio(e: EstadoApp, adId: ID, desde: string, hasta: string): PersonaDelAnuncio[] {
  const suyas = e.contactos.filter((c) => c.origenAdId === adId);
  if (suyas.length === 0) return [];

  const ids = new Set(suyas.map((c) => c.id));
  const leadDe = new Map<ID, Lead>();
  for (const l of e.leads) {
    const c = l.contactoId ?? l.id;
    if (!ids.has(c)) continue;
    const previo = leadDe.get(c);
    if (!previo || +new Date(l.creadoEn) > +new Date(previo.creadoEn)) leadDe.set(c, l);
  }

  const negocio = negocioPorPersona(e);
  return suyas
    .map((c) => {
      const dia = diaDeNegocio(c.creadoEn);
      return {
        ventas: 0, facturado: 0, cobrado: 0, ...negocio.get(c.id),
        contacto: c, leadId: leadDe.get(c.id)?.id, dia,
        enRango: Boolean(dia) && dia >= desde && dia <= hasta,
      };
    })
    .sort((a, b) => +new Date(b.contacto.creadoEn) - +new Date(a.contacto.creadoEn));
}

/* El gasto de un anuncio día por día, para el gráfico de su detalle. Los días
   del medio sin fila van en cero: en el gráfico, un día sin gasto tiene que
   verse como un pozo, no desaparecer. */
export function gastoDiario(
  e: EstadoApp, adId: ID, desde: string, hasta: string,
): { dia: string; inversion: number }[] {
  const por = new Map<string, number>();
  for (const i of e.adInsights) {
    if (i.adId !== adId || i.dia < desde || i.dia > hasta) continue;
    por.set(i.dia, (por.get(i.dia) ?? 0) + i.inversion);
  }
  if (por.size === 0) return [];

  const dias = [...por.keys()].sort();
  const ultimo = dias[dias.length - 1];
  const out: { dia: string; inversion: number }[] = [];
  /* Fechas calendario: se avanza en UTC para que ningún huso corra el día. El
     tope es un cinturón por si algún día llega con otro formato. */
  const [y, m, d] = dias[0].split("-").map(Number);
  for (let n = 0; n < 800; n++) {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    const dia = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    if (Number.isNaN(t.getTime()) || dia > ultimo) break;
    out.push({ dia, inversion: por.get(dia) ?? 0 });
  }
  return out;
}

/* El primer dia con datos. Sirve de `minDate` del selector, para que "Máximo"
   no arranque en enero cuando la sincronizacion empieza en septiembre. */
export function primerDiaConDatos(e: EstadoApp): string | null {
  let min: string | null = null;
  for (const i of e.adInsights) if (!min || i.dia < min) min = i.dia;
  return min;
}
