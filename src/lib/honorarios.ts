import type {
  AlcanceVentas, BaseMedicion, ConceptoPago, Devolucion, DesgloseLinea, EntradaLiquidacion, EsquemaPago, EstadoApp, ExtraLiquidacion,
  Gasto, ID, LineaLiquidada, Liquidacion, MiembroEquipo, Moneda, Pago, PersonaLiquidada,
  ResultadoLiquidacion, TipoConcepto, Venta,
} from "./types";
import type { RangoMes } from "./metricas";
import { calcularPyL, closerDeCuota, cobraEnFecha, pagosDelMes, parteMarketing, tasaDeComision, ventasDelMes } from "./finanzas";
import { esPeriodo, moverPeriodo, nombrePeriodo, periodoDe, rangoDePeriodo } from "./periodos";
import { aMonedaBase, categoriaDe, normalizar } from "./gastos";
import { fechaLarga, money, num, pct, tasaTexto } from "./format";
import {
  conCorreccion, desgloseBono, desgloseDeudaQueEntra, desgloseDeudaQueSale, desgloseFijo, desgloseMedido, desglosePieza,
  desgloseReversa, listaDeCobros, listaDeVentas,
  type CobroContado, type Fuente, type PartesProfit,
} from "./desglose";
import { devolucionesDelMes, liquidadaEn, mesDeLiquidacion, reversasDeComision, type ParteReversa, type Reversa } from "./devoluciones";

/* ==================================================================
   Honorarios: lo que cobra cada uno y la liquidación de cada mes.

   Lo que cobra una persona es una lista de conceptos: un fijo, un bono
   que se decide al liquidar, un porcentaje, un monto por cada tramo o una
   tarifa por pieza. Cada variable dice sobre qué se mide —cash collected,
   cash post pasarelas, lo facturado, el profit, ventas, llamadas o una
   cantidad que se carga a mano— y, si sale de las ventas, de cuáles.

   Lo medido sale de las mismas funciones que Finanzas (pagosDelMes,
   ventasDelMes, calcularPyL): la comisión de un closer en la liquidación
   es la del renglón de Finanzas, no una cuenta paralela que pueda dar
   distinto. Sin React, para poder probarlo contra la base real.
   ================================================================== */

/* ---------- Lo que la pantalla ofrece elegir ---------- */

export const TIPOS_CONCEPTO: { tipo: TipoConcepto; nombre: string; sub: string }[] = [
  { tipo: "fijo", nombre: "Fijo mensual", sub: "Un monto todos los meses: sueldo, abono, honorario." },
  { tipo: "bono", nombre: "Bono", sub: "Un monto que se decide al liquidar: lo ganó o no." },
  { tipo: "porcentaje", nombre: "Comisión (%)", sub: "Un porcentaje de algo que se mide: cash, profit, lo facturado." },
  { tipo: "tramo", nombre: "Por cada tramo", sub: "Un monto por cada tanto de algo: US$ 500 cada US$ 100.000, US$ 100 cada 15 llamadas." },
  { tipo: "unidad", nombre: "Por pieza", sub: "Una tarifa por unidad; cuántas, se carga al liquidar: reels, sesiones, minutos." },
];

export interface InfoBase {
  base: BaseMedicion;
  nombre: string;
  sub: string;
  /* Se mide en plata (y no en cantidad). */
  plata: boolean;
  /* Sale de las ventas: se elige de cuáles. */
  deVentas: boolean;
}

export const BASES: InfoBase[] = [
  { base: "cash-neto", nombre: "Cash collected post pasarelas", sub: "Lo que entró menos la comisión del procesador (Stripe, Hotmart, dLocal…).", plata: true, deVentas: true },
  { base: "cash", nombre: "Cash collected", sub: "Todo lo que entró, antes de la comisión del procesador.", plata: true, deVentas: true },
  { base: "facturado", nombre: "Facturado", sub: "El valor total de las ventas cerradas en el mes.", plata: true, deVentas: true },
  { base: "profit", nombre: "Profit", sub: "El resultado operativo del mes: lo cobrado menos costos, gastos y sueldos.", plata: true, deVentas: false },
  { base: "ventas", nombre: "Ventas cerradas", sub: "Cuántas ventas se cerraron en el mes.", plata: false, deVentas: true },
  { base: "llamadas", nombre: "Llamadas agendadas", sub: "Las que se reservaron en el mes en la Agenda, sin las canceladas.", plata: false, deVentas: false },
  { base: "llamadas-hechas", nombre: "Llamadas hechas", sub: "Las que se hicieron en el mes, según la Agenda.", plata: false, deVentas: false },
  { base: "manual", nombre: "Una cantidad que cargás al liquidar", sub: "Lo que la app no mide sola: se escribe cada mes.", plata: false, deVentas: false },
];

export const infoBase = (b?: BaseMedicion): InfoBase => BASES.find((x) => x.base === b) ?? BASES[BASES.length - 1];

export const ALCANCES: { alcance: AlcanceVentas; nombre: string; sub: string }[] = [
  { alcance: "closer", nombre: "Las que cerró como closer", sub: "Las ventas donde figura como vendedor." },
  { alcance: "setter", nombre: "Las que agendó como setter", sub: "Las ventas donde figura como setter." },
  { alcance: "director", nombre: "Las que dirige como director", sub: "Las ventas que llevan su nombre como director comercial." },
  { alcance: "todas", nombre: "Todas las ventas del negocio", sub: "Las de toda la empresa, las haya vendido quien las haya vendido." },
];

/* En qué renglón de Finanzas cae lo que se le paga a alguien, si no se
   eligió otra cosa. Setters es costo directo, como siempre lo cargó la
   planilla; lo demás, gasto operativo. */
export function categoriaPorDefecto(m: Pick<MiembroEquipo, "rol" | "puesto">): string {
  if (m.rol === "setter") return "Setters";
  const p = normalizar(m.puesto ?? "");
  if (/film|camar|grabac/.test(p)) return "Filmmaker";
  if (/edic|editor/.test(p)) return "Edición de contenido";
  return "Equipo / Salarios";
}

/* ---------- Períodos: un mes, "2026-09" ----------
   Viven en lib/periodos.ts; se reexportan para quien los importaba de acá. */

export { esPeriodo, moverPeriodo, nombrePeriodo, periodoDe, rangoDePeriodo };

export const idLiquidacion = (periodo: string) => `liq_${periodo}`;
export const idEsquema = (miembroId: ID) => `hon_${miembroId}`;
export const claveEntrada = (miembroId: ID, conceptoId: ID) => `${miembroId}:${conceptoId}`;

/* ---------- Formato ---------- */

const r2 = (n: number) => Math.round(n * 100) / 100;

/* Con centavos sólo si los tiene: "US$ 1.700", "US$ 3.456,78". */
export function plata(n: number, moneda: Moneda): string {
  return money(n, moneda, Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
}

const cant = (n: number, uno: string, varios: string) => `${num(n, Number.isInteger(n) ? 0 : 2)} ${n === 1 ? uno : varios}`;

/* Los que "no comisionan" (Yari): sus ventas no le dejan comisión a nadie. */
export function quienesNoComisionan(e: Pick<EstadoApp, "equipo">): string {
  const nombres = e.equipo.filter((x) => x.sinComision).map((x) => x.nombre.split(" ")[0]);
  return nombres.length ? nombres.join(" y ") : "quien no comisiona";
}

/* ---------- La frase de cada concepto ---------- */

const PORCENTAJE_DE: Partial<Record<BaseMedicion, string>> = {
  "cash": "del cash collected",
  "cash-neto": "del cash collected post pasarelas",
  "facturado": "de lo facturado",
  "profit": "del profit",
};

const DE_LAS_VENTAS: Record<AlcanceVentas, string> = {
  closer: "de las ventas que cerró",
  setter: "de las ventas que agendó",
  director: "de las ventas que dirige",
  todas: "del negocio",
};

/* "venta que cerró" / "ventas que cerró": el verbo no cambia con el número. */
const VENTAS_DE: Record<AlcanceVentas, [string, string]> = {
  closer: ["venta que cerró", "ventas que cerró"],
  setter: ["venta que agendó", "ventas que agendó"],
  director: ["venta que dirige", "ventas que dirige"],
  todas: ["venta del negocio", "ventas del negocio"],
};

type Catalogos = Pick<EstadoApp, "equipo" | "productos" | "ajustes">;

/* "por cada 15 llamadas", pero "por cada llamada": con uno, sin el número. */
const porCada = (n: number, [uno, varios]: [string, string]) =>
  n === 1 ? uno : `${num(n, Number.isInteger(n) ? 0 : 2)} ${varios}`;

function filtros(c: ConceptoPago, e: Catalogos, hermanos?: ConceptoPago[]): string[] {
  const out: string[] = [];
  const nombresDe = (ids: ID[]) => ids.map((id) => e.productos.find((p) => p.id === id)?.nombre).filter(Boolean);
  if (c.productoIds?.length) {
    const nombres = nombresDe(c.productoIds);
    if (nombres.length) out.push(`sólo ${nombres.join(", ")}`);
  } else if (hermanos) {
    /* Los servicios que tienen su propio %: en ésos no vale esta comisión. */
    const propios = nombresDe([...serviciosConComisionPropia(hermanos, c)]);
    if (propios.length) out.push(`menos ${propios.join(", ")}, que ${propios.length === 1 ? "tiene su propio %" : "tienen su propio %"}`);
  }
  if (c.sinVentasSinComision && (c.alcance ?? "todas") === "todas") out.push(`sin las que cerró ${quienesNoComisionan(e)}`);
  if (c.sinExcluidasMarketing) out.push("sin las excluidas de marketing");
  return out;
}

/* Lo que se mide, con su alcance: "del cash collected post pasarelas de las
   ventas que cerró", "llamadas agendadas con utm_source Resell". */
function queSeMide(c: ConceptoPago, e: Catalogos, cada?: number, hermanos?: ConceptoPago[]): string {
  const b = c.base ?? "manual";
  const alcance = c.alcance ?? "todas";
  const extra = filtros(c, e, hermanos);
  const conFiltros = (s: string) => (extra.length ? `${s} (${extra.join(", ")})` : s);
  const n = cada ?? 0;
  switch (b) {
    case "cash": case "cash-neto": case "facturado": case "profit": {
      if (cada !== undefined) {
        const nombre = { "cash": "cash collected", "cash-neto": "cash collected post pasarelas", "facturado": "facturación", "profit": "profit" }[b];
        return conFiltros(`${plata(n, e.ajustes.monedaBase)} de ${nombre}${b === "profit" ? " del mes" : ` ${DE_LAS_VENTAS[alcance]}`}`);
      }
      return conFiltros(`${PORCENTAJE_DE[b]}${b === "profit" ? " del mes" : ` ${DE_LAS_VENTAS[alcance]}`}`);
    }
    case "ventas":
      return conFiltros(cada !== undefined ? porCada(n, VENTAS_DE[alcance]) : `de las ${VENTAS_DE[alcance][1]}`);
    case "llamadas": case "llamadas-hechas": {
      const que: [string, string] = b === "llamadas" ? ["llamada agendada", "llamadas agendadas"] : ["llamada hecha", "llamadas hechas"];
      const utm = c.utmSource?.trim() ? ` con utm_source ${c.utmSource.trim()}` : "";
      return cada !== undefined ? `${porCada(n, que)}${utm}` : `de las ${que[1]}${utm}`;
    }
    default: {
      const unidad = c.unidad?.trim() || "unidades";
      return cada !== undefined ? porCada(n, [unidad, unidad]) : `de lo que se cargue a mano (${unidad})`;
    }
  }
}

function vigenciaTexto(c: Pick<ConceptoPago, "desde" | "hasta">): string {
  const d = (s: string) => fechaLarga(`${s.slice(0, 10)}T12:00:00`);
  if (c.desde && c.hasta) return `del ${d(c.desde)} al ${d(c.hasta)}`;
  if (c.desde) return `desde el ${d(c.desde)}`;
  if (c.hasta) return `hasta el ${d(c.hasta)}`;
  return "";
}

/** La regla dicha en castellano: "15% del cash collected post pasarelas de
 *  las ventas que cerró", "US$ 500 por cada US$ 100.000 de cash collected
 *  post pasarelas del negocio". Con `hermanos` (todo lo que cobra la
 *  persona), la comisión general dice qué servicios quedan afuera porque
 *  tienen su propio %. */
export function describirConcepto(c: ConceptoPago, e: Catalogos, hermanos?: ConceptoPago[]): string {
  const M = (n?: number) => plata(n ?? 0, c.moneda);
  let frase: string;
  switch (c.tipo) {
    case "fijo": frase = `${M(c.monto)} por mes`; break;
    case "bono": frase = `${M(c.monto)} si lo gana${c.condicion?.trim() ? ` (${c.condicion.trim()})` : ""}`; break;
    case "porcentaje": frase = `${pct((c.tasa ?? 0) * 100, decimalesTasa(c.tasa))} ${queSeMide(c, e, undefined, hermanos)}`; break;
    case "tramo": frase = `${M(c.monto)} por cada ${queSeMide(c, e, c.cada ?? 0)}`; break;
    case "unidad": frase = `${M(c.monto)} por ${c.unidad?.trim() || "pieza"}`; break;
  }
  const v = vigenciaTexto(c);
  return v ? `${frase} · ${v}` : frase;
}

/* 15%, 12,5% o 7,25%: los decimales que tenga, hasta dos. */
export function decimalesTasa(t?: number): number {
  const x = Math.round((t ?? 0) * 1e6) / 1e4;
  return Number.isInteger(x) ? 0 : Number.isInteger(Math.round(x * 1e3) / 1e2) ? 1 : 2;
}

const PORCENTAJE_CORTO: Partial<Record<BaseMedicion, string>> = {
  "cash": "del cash", "cash-neto": "del cash post pasarelas", "facturado": "de lo facturado", "profit": "del profit",
};
const TRAMOS_DE: Record<BaseMedicion, string> = {
  "cash": "cash", "cash-neto": "cash", "facturado": "facturación", "profit": "profit",
  "ventas": "ventas", "llamadas": "llamadas", "llamadas-hechas": "llamadas", "manual": "cantidad",
};

/** Lo que cobra alguien, en una línea: "US$ 1.700 fijo + bono + tramos de
 *  cash", "15% del cash post pasarelas", "5 tarifas por pieza". */
export function resumenEsquema(esq: EsquemaPago | undefined): string {
  if (!esq || esq.conceptos.length === 0) return esq?.pendiente?.trim() ? "A definir" : "Sin cargar";
  const porMoneda = new Map<Moneda, number>();
  for (const c of esq.conceptos) {
    if (c.tipo === "fijo") porMoneda.set(c.moneda, (porMoneda.get(c.moneda) ?? 0) + (c.monto ?? 0));
  }
  const partes = [...porMoneda.entries()].map(([m, n]) => `${plata(n, m)} fijo`);
  const bonos = esq.conceptos.filter((c) => c.tipo === "bono").length;
  if (bonos) partes.push(bonos === 1 ? "bono" : `${bonos} bonos`);
  for (const c of esq.conceptos) {
    if (c.tipo === "porcentaje") partes.push(`${pct((c.tasa ?? 0) * 100, decimalesTasa(c.tasa))} ${PORCENTAJE_CORTO[c.base ?? "cash"] ?? ""}`.trim());
  }
  const tramos = [...new Set(esq.conceptos.filter((c) => c.tipo === "tramo").map((c) => TRAMOS_DE[c.base ?? "manual"]))];
  if (tramos.length) partes.push(`tramos de ${tramos.join(" y ")}`);
  const piezas = esq.conceptos.filter((c) => c.tipo === "unidad").length;
  if (piezas) partes.push(piezas === 1 ? "1 tarifa por pieza" : `${piezas} tarifas por pieza`);
  return partes.join(" + ");
}

/* ---------- Vigencia ---------- */

const DIA = 86400000;
const diaLocal = (s: string, fin = false) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return fin ? new Date(a, m - 1, d, 23, 59, 59) : new Date(a, m - 1, d);
};
const diasEntre = (a: Date, b: Date) =>
  Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
    - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / DIA) + 1;

/** La parte del mes en la que el concepto vale, o null si no vale ningún día. */
export function vigenciaEnMes(c: Pick<ConceptoPago, "desde" | "hasta">, r: RangoMes) {
  const desde = c.desde ? diaLocal(c.desde) : r.desde;
  const hasta = c.hasta ? diaLocal(c.hasta, true) : r.hasta;
  const d = desde > r.desde ? desde : r.desde;
  const h = hasta < r.hasta ? hasta : r.hasta;
  if (d.getTime() > h.getTime()) return null;
  return { rango: { ...r, desde: d, hasta: h }, dias: diasEntre(d, h), diasMes: diasEntre(r.desde, r.hasta) };
}

/* ---------- Un % general y otro por servicio ----------
   "Es diferente el % por closer y por servicio vendido" (Angelo, 02/10).
   La comisión de las ventas que alguien cerró, agendó o dirige puede tener
   un % general y otro para algunos servicios. La que nombra servicios vale
   para ésos EN VEZ de la general: las dos son «hermanas» (porcentaje, misma
   base y mismo alcance) y un cobro entra en una sola. Si dos nombran el
   mismo servicio, vale la primera. */

type Vigencia = Pick<ConceptoPago, "desde" | "hasta">;
const valeEl = (c: Vigencia, dia: string) => (!c.desde || c.desde.slice(0, 10) <= dia) && (!c.hasta || c.hasta.slice(0, 10) >= dia);
/* El día de un cobro, en la hora de acá: el mismo borde que las fechas de salida. */
const diaDe = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);

/** Una comisión sobre las ventas de alguien (las que cerró, agendó o dirige). */
export const esComisionDeVentas = (c: ConceptoPago): boolean =>
  c.tipo === "porcentaje" && (c.base === "cash" || c.base === "cash-neto")
  && (c.alcance === "closer" || c.alcance === "setter" || c.alcance === "director");

const sonHermanas = (a: ConceptoPago, b: ConceptoPago) =>
  esComisionDeVentas(a) && esComisionDeVentas(b) && a.base === b.base && a.alcance === b.alcance;

/** La comisión hermana de `c` que nombra ese servicio y vale ese día (la
 *  primera, si hay más de una). */
function comisionDelServicio(conceptos: ConceptoPago[], c: ConceptoPago, productoId: ID | undefined, dia?: string): ConceptoPago | undefined {
  if (!productoId) return undefined;
  return conceptos.find((x) => x.productoIds?.includes(productoId) && sonHermanas(x, c) && (!dia || valeEl(x, dia)));
}

/** Los servicios que tienen su propio % al lado de la comisión general `c`. */
export function serviciosConComisionPropia(conceptos: ConceptoPago[], c: ConceptoPago, dia?: string): Set<ID> {
  const out = new Set<ID>();
  if (!esComisionDeVentas(c) || c.productoIds?.length) return out;
  for (const x of conceptos) {
    if (x.id === c.id || !x.productoIds?.length || !sonHermanas(x, c) || (dia && !valeEl(x, dia))) continue;
    for (const id of x.productoIds) out.add(id);
  }
  return out;
}

/* ---------- Qué entra en Finanzas por su cuenta ----------
   Finanzas calcula sola, de las ventas, la comisión de cada closer y del
   director (cash post pasarelas × su % en ese servicio) y el reparto del
   profit del growth partner y del socio. Esos renglones no se cargan como
   gasto al cerrar: se contarían dos veces. Para que Finanzas diga lo mismo
   que la liquidación, `comisionRate` y `comisionServicios` se escriben
   desde el esquema (tasaParaFinanzas, tasasPorServicio) cada vez que se
   guarda. */

export function calculaFinanzas(m: Pick<MiembroEquipo, "rol">, c: ConceptoPago): boolean {
  if (c.tipo !== "porcentaje") return false;
  if (c.base === "profit") return m.rol === "growth" || m.rol === "socio";
  if (c.base !== "cash-neto") return false;
  if (c.alcance === "closer") return m.rol === "closer" || m.rol === "ceo";
  if (c.alcance === "director") return m.rol === "director";
  return false;
}

/* La comisión de la persona según su rol: la que Finanzas (closer, director,
   growth, socio) o la planilla (setter) le calculan. */
function esLaDeSuRol(m: Pick<MiembroEquipo, "rol">): ((c: ConceptoPago) => boolean) | null {
  switch (m.rol) {
    case "closer": case "ceo": case "director": case "growth": case "socio":
      return (c) => calculaFinanzas(m, c);
    /* El setter no es un renglón de Finanzas (lo que cobra entra como gasto),
       pero su porcentaje es el que usa la planilla de Angelo al exportar. */
    case "setter":
      return (c) => c.tipo === "porcentaje" && c.alcance === "setter" && (c.base === "cash" || c.base === "cash-neto");
    default:
      return null;
  }
}

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** La tasa con la que Finanzas tiene que calcular a esta persona. undefined:
 *  el esquema no dice nada (vacío, o su rol no comisiona en Finanzas) y
 *  queda la que estaba. Una persona tiene UNA tasa en Finanzas: si alguien
 *  cierra ventas y además las dirige, Finanzas usa la de su rol. */
export function tasaParaFinanzas(m: Pick<MiembroEquipo, "rol">, esq: EsquemaPago | undefined): number | undefined {
  if (!esq || esq.conceptos.length === 0) return undefined;
  const suya = esLaDeSuRol(m);
  if (!suya) return undefined;
  /* La general: la que no nombra servicios. Con sólo comisiones por
     servicio, lo demás no comisiona: 0. */
  const es = (c: ConceptoPago) => suya(c) && !c.productoIds?.length;
  const hoy = hoyIso();
  const c = esq.conceptos.find((x) => es(x) && valeEl(x, hoy)) ?? esq.conceptos.find(es);
  return c ? (c.tasa ?? 0) : 0;
}

/** El % de cada servicio que comisiona distinto del general, para Finanzas
 *  (`equipo.comisionServicios`). undefined: el esquema no dice nada y queda
 *  lo que estaba, como en tasaParaFinanzas. Sin servicios aparte, {}. */
export function tasasPorServicio(m: Pick<MiembroEquipo, "rol">, esq: EsquemaPago | undefined): Record<ID, number> | undefined {
  if (!esq || esq.conceptos.length === 0) return undefined;
  const suya = esLaDeSuRol(m);
  if (!suya) return undefined;
  const hoy = hoyIso();
  const out: Record<ID, number> = {};
  for (const c of esq.conceptos) {
    if (!suya(c) || !esComisionDeVentas(c) || !c.productoIds?.length || !valeEl(c, hoy)) continue;
    /* Si dos nombran el mismo servicio, vale la primera. */
    for (const id of c.productoIds) if (!(id in out)) out[id] = c.tasa ?? 0;
  }
  return out;
}

/** Si dos mapas de % por servicio dicen lo mismo. */
export function mismasTasas(a: Record<ID, number> | undefined, b: Record<ID, number> | undefined): boolean {
  const x = a ?? {}, y = b ?? {};
  const claves = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of claves) if (!(k in x) || !(k in y) || Math.abs(x[k] - y[k]) > 1e-9) return false;
  return true;
}

/* ---------- Medir ---------- */

interface Contexto {
  e: EstadoApp;
  rango: RangoMes;
  base: Moneda;
  tc: number;
  ventaDeCuota: Map<ID, Venta>;
  /* El closer de cada cuota: el que la heredó o el de la venta. */
  closerDeCuota: Map<ID, ID | undefined>;
  equipo: Map<ID, MiembroEquipo>;
  ventas: Map<ID, Venta>;
}

function armarContexto(e: EstadoApp, rango: RangoMes, tc: number): Contexto {
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const ventaDeCuota = new Map<ID, Venta>();
  const closerDe = new Map<ID, ID | undefined>();
  for (const c of e.cuotas) {
    const v = ventas.get(c.ventaId);
    if (!v) continue;
    ventaDeCuota.set(c.id, v);
    closerDe.set(c.id, closerDeCuota(v, c));
  }
  return { e, rango, base: e.ajustes.monedaBase, tc, ventaDeCuota, closerDeCuota: closerDe, equipo: new Map(e.equipo.map((m) => [m.id, m] as const)), ventas };
}

/* Todo lo cobrado de la empresa, sin filtro: tiene que dar lo mismo que el
   Cash collected de Finanzas, así que cuenta todos los pagos. */
const esTotal = (c: ConceptoPago) =>
  (c.alcance ?? "todas") === "todas" && !c.productoIds?.length && !c.sinVentasSinComision && !c.sinExcluidasMarketing;

/* Si una venta cuenta para este concepto. Con cualquier filtro, las ventas
   canceladas no cuentan (como en las comisiones de Finanzas), y en las del
   closer, el setter o el director tampoco las que cerró quien no comisiona:
   "si la venta la cerró Yari, no comisiona nadie".
   Con un cobro (`p`), el del closer va para el closer de la cuota (el que
   la heredó, si el suyo se fue), y quien ya no está no suma lo que entró
   después de su fecha de salida: lo mismo que Finanzas. */
function cuenta(cx: Contexto, c: ConceptoPago, m: MiembroEquipo, v: Venta | undefined, p?: Pago, hermanos?: ConceptoPago[]): boolean {
  if (esTotal(c)) return true;
  if (!v || v.estado === "cancelada") return false;
  /* Un % general y otro por servicio: el cobro entra en uno solo. */
  if (hermanos && esComisionDeVentas(c)) {
    const propia = comisionDelServicio(hermanos, c, v.productoId, p ? diaDe(p.fecha) : undefined);
    if (propia && propia.id !== c.id) return false;
  }
  const alcance = c.alcance ?? "todas";
  if (alcance === "closer" && (p ? cx.closerDeCuota.get(p.cuotaId) : v.closerId) !== m.id) return false;
  if (p && (alcance === "closer" || alcance === "director") && !cobraEnFecha(m, p.fecha)) return false;
  if (alcance === "setter" && v.setterId !== m.id) return false;
  if (alcance === "director" && v.directorId !== m.id) return false;
  if (c.productoIds?.length && !(v.productoId && c.productoIds.includes(v.productoId))) return false;
  if ((alcance !== "todas" || c.sinVentasSinComision) && v.closerId && cx.equipo.get(v.closerId)?.sinComision) return false;
  if (c.sinExcluidasMarketing && v.excluidoMarketing) return false;
  return true;
}

const enRango = (iso: string | undefined, r: RangoMes) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= r.desde.getTime() && t <= r.hasta.getTime();
};

/* `n`, `bruto`, `cobros` y `ventas` son para el desglose: cuántos entraron en
   la cuenta, cuáles, y lo cobrado antes de restar el procesador. */
interface Medido {
  valor: number; cuantos: string; n?: number; bruto?: number; cobros?: CobroContado[]; ventas?: Venta[];
  /* Lo devuelto en esos días que resta de lo medido, cuántas devoluciones son y
     lo que daba la cuenta antes de no bajar de cero. */
  devoluciones?: number; nDev?: number; crudo?: number;
}

/* Lo que se mide en los días del concepto. null: no se mide solo (el profit
   se calcula aparte y lo manual se carga). */
function medir(cx: Contexto, c: ConceptoPago, m: MiembroEquipo, r: RangoMes, hermanos?: ConceptoPago[]): Medido | null {
  const b = c.base ?? "manual";
  switch (b) {
    case "cash": case "cash-neto": {
      let valor = 0, bruto = 0, n = 0;
      const cobros: CobroContado[] = [];
      for (const p of pagosDelMes(cx.e, r)) {
        const venta = cx.ventaDeCuota.get(p.cuotaId);
        if (!cuenta(cx, c, m, venta, p, hermanos)) continue;
        valor += b === "cash" ? p.monto : p.monto - p.feeMonto;
        bruto += p.monto;
        cobros.push({ pago: p, venta });
        n++;
      }
      /* Lo que se devolvió en esos días resta, igual que en el Cash Collected
         de Finanzas (la comisión de la pasarela no se devuelve: los fees
         siguen siendo los de los cobros). Las comisiones de ventas
         (closer, setter, director) no netean su base: se revierte lo que se
         les comisionó con su propia línea (lineasDeReversa). */
      let dev = 0, nDev = 0;
      if (!esComisionDeVentas(c)) {
        for (const d of devolucionesDelMes(cx.e, r)) {
          const venta = d.ventaId ? cx.ventas.get(d.ventaId) : undefined;
          /* «No descontar al closer»: quien cobra por sus ventas sigue cobrando igual. */
          if (d.noDescontarAlCloser && (c.alcance ?? "todas") !== "todas") continue;
          if (!cuenta(cx, c, m, venta, undefined, hermanos)) continue;
          dev += d.monto; nDev++;
        }
      }
      if (dev <= 0) return { valor: r2(valor), cuantos: cant(n, "cobro", "cobros"), n, bruto: r2(bruto), cobros };
      const crudo = r2(valor - dev);
      return {
        valor: Math.max(0, crudo), cuantos: `${cant(n, "cobro", "cobros")} y ${cant(nDev, "devolución", "devoluciones")}`,
        n, bruto: r2(bruto), cobros, devoluciones: r2(dev), nDev, crudo,
      };
    }
    case "facturado": case "ventas": {
      let valor = 0, n = 0;
      const ventas: Venta[] = [];
      for (const v of ventasDelMes(cx.e, r)) {
        if (!cuenta(cx, c, m, v)) continue;
        valor += b === "facturado" ? v.precioAcordado : 1;
        ventas.push(v);
        n++;
      }
      return { valor: r2(valor), cuantos: cant(n, "venta", "ventas"), n, ventas };
    }
    case "llamadas": case "llamadas-hechas": {
      /* Agendadas: las que se reservaron en el mes (cuando entró la reserva),
         sin las canceladas. Hechas: las que se hicieron en el mes. */
      const utm = c.utmSource?.trim().toLowerCase();
      let n = 0;
      for (const s of cx.e.sesiones) {
        if (b === "llamadas" ? s.estado === "cancelada" : s.estado !== "hecha") continue;
        if (!enRango(b === "llamadas" ? s.creadoEn : s.inicia, r)) continue;
        if (utm && (s.utm?.utm_source ?? "").trim().toLowerCase() !== utm) continue;
        n++;
      }
      return { valor: n, cuantos: "según la Agenda", n };
    }
    default:
      return null;
  }
}

/* Lo medido, dicho: "US$ 23.045,20 de cash post pasarelas", "32 llamadas agendadas". */
function medidoTexto(b: BaseMedicion, valor: number, base: Moneda, unidad?: string): string {
  switch (b) {
    case "cash": return `${plata(valor, base)} de cash collected`;
    case "cash-neto": return `${plata(valor, base)} de cash post pasarelas`;
    case "facturado": return `${plata(valor, base)} facturados`;
    case "profit": return `${plata(valor, base)} de profit`;
    case "ventas": return cant(valor, "venta", "ventas");
    case "llamadas": return cant(valor, "llamada agendada", "llamadas agendadas");
    case "llamadas-hechas": return cant(valor, "llamada hecha", "llamadas hechas");
    default: return `${num(valor, Number.isInteger(valor) ? 0 : 2)} ${unidad?.trim() || "unidades"}`;
  }
}

/* ---------- Un renglón ---------- */

/* El profit del mes y las partes con las que se armó (para el desglose). */
interface Profit { profit: number; parte: number; partes?: PartesProfit }

/* Los nombres que lleva la lista de cobros y de ventas del desglose. */
const nombresDeLista = (cx: Contexto) => ({
  servicio: (id?: ID) => (id ? cx.e.productos.find((p) => p.id === id)?.nombre : undefined),
  procesador: (id?: ID) => (id ? cx.e.procesadores.find((p) => p.id === id)?.nombre : undefined),
});

function linea(
  cx: Contexto, m: MiembroEquipo, c: ConceptoPago, entrada: EntradaLiquidacion | undefined, prof?: Profit,
  /* Todo lo que cobra la persona: para que un cobro no entre en dos comisiones. */
  hermanos?: ConceptoPago[],
): LineaLiquidada | null {
  /* Quien se fue cobra hasta su fecha de salida: el fijo, prorrateado. */
  const hasta = m.hasta && (!c.hasta || m.hasta < c.hasta) ? m.hasta : c.hasta;
  const vig = vigenciaEnMes({ desde: c.desde, hasta }, cx.rango);
  if (!vig) return null;
  const M = (n: number, mon: Moneda = c.moneda) => plata(n, mon);
  const parcial = vig.dias < vig.diasMes;
  let monto = 0;
  let detalle = "";
  let medido: number | undefined;
  let falta: string | undefined;
  /* Cómo se llegó al monto: se arma con los mismos números de la cuenta. */
  let desglose: DesgloseLinea | undefined;
  const regla = describirConcepto(c, cx.e, hermanos);

  switch (c.tipo) {
    case "fijo": {
      const lleno = c.monto ?? 0;
      monto = parcial ? (lleno * vig.dias) / vig.diasMes : lleno;
      detalle = parcial ? `${M(lleno)} por mes, prorrateado: ${vig.dias} de ${vig.diasMes} días` : `${M(lleno)} por mes`;
      desglose = desgloseFijo({
        regla, moneda: c.moneda, mensual: lleno, monto: r2(monto),
        ...(parcial ? { prorrateo: { dias: vig.dias, diasMes: vig.diasMes, desde: vig.rango.desde.getDate(), hasta: vig.rango.hasta.getDate(), mes: nombrePeriodo(cx.rango.clave) } } : {}),
      });
      break;
    }
    case "bono": {
      const gano = entrada?.cumplido !== false;
      monto = gano ? (c.monto ?? 0) : 0;
      detalle = gano
        ? `Lo ganó${c.condicion?.trim() ? ` · ${c.condicion.trim()}` : ""}`
        : `No lo ganó este mes (era ${M(c.monto ?? 0)})`;
      desglose = desgloseBono({ regla, moneda: c.moneda, previsto: c.monto ?? 0, gano, condicion: c.condicion, monto: r2(monto) });
      break;
    }
    case "unidad": {
      const n = entrada?.cantidad;
      const tarifa = c.monto ?? 0;
      const unidad = c.unidad?.trim() || c.nombre;
      if (n === undefined) {
        falta = `Cargá cuántas: ${unidad}`;
        detalle = `${M(tarifa)} por ${unidad} · falta cargar cuántas`;
      } else {
        medido = n;
        monto = n * tarifa;
        detalle = `${num(n, Number.isInteger(n) ? 0 : 2)} × ${M(tarifa)} (${unidad})`;
      }
      desglose = desglosePieza({ regla, moneda: c.moneda, tarifa, unidad, cantidad: n, monto: r2(monto) });
      break;
    }
    case "porcentaje": case "tramo": {
      const b = c.base ?? "manual";
      const plataBase = infoBase(b).plata;
      let valor = 0;
      let origen = "";
      /* De dónde salió lo medido, para el desglose. */
      let fuente: Fuente = { tipo: "falta" };
      if (entrada?.cantidad !== undefined) {
        valor = entrada.cantidad;
        origen = "cargado a mano";
        fuente = { tipo: "mano" };
      } else if (b === "profit") {
        const p = prof ?? { profit: 0, parte: 1 };
        const parte = c.sinExcluidasMarketing ? p.parte : 1;
        valor = r2(Math.max(p.profit, 0) * parte);
        origen = p.profit <= 0
          ? "el mes dio pérdida: no hay profit para repartir"
          : parte < 1
            ? `el ${pct(parte * 100, 0)} de ${plata(p.profit, cx.base)}: lo demás es de ventas excluidas de marketing`
            : "el resultado operativo del mes";
        fuente = { tipo: "profit", profit: p.profit, parte, partes: p.partes };
      } else {
        const x = medir(cx, c, m, vig.rango, hermanos);
        if (x) {
          valor = x.valor; origen = x.cuantos;
          fuente = {
            tipo: "medido", bruto: x.bruto, cuantos: x.n ?? 0,
            lista: x.cobros ? listaDeCobros(x.cobros, nombresDeLista(cx), cx.base) : x.ventas ? listaDeVentas(x.ventas, nombresDeLista(cx), cx.base) : undefined,
            ...(x.devoluciones ? { devoluciones: x.devoluciones, nDev: x.nDev ?? 0, crudo: x.crudo } : {}),
          };
        } else { falta = "Cargá la cantidad"; origen = "falta cargarla"; }
      }
      if (parcial && b !== "manual" && b !== "profit" && entrada?.cantidad === undefined) {
        origen = `${origen}, del ${vig.rango.desde.getDate()} al ${vig.rango.hasta.getDate()}`;
      }
      medido = valor;
      const lo = medidoTexto(b, valor, cx.base, c.unidad);
      let veces = 0;
      if (c.tipo === "porcentaje") {
        monto = valor * (c.tasa ?? 0);
        detalle = `${pct((c.tasa ?? 0) * 100, decimalesTasa(c.tasa))} de ${lo} (${origen})`;
      } else {
        const cada = c.cada ?? 0;
        veces = cada > 0 ? Math.floor(valor / cada + 1e-9) : 0;
        monto = veces * (c.monto ?? 0);
        const tramo = plataBase ? plata(cada, cx.base) : num(cada, Number.isInteger(cada) ? 0 : 2);
        detalle = `${veces} ${veces === 1 ? "tramo" : "tramos"} de ${tramo}: ${lo} (${origen})`;
      }
      desglose = desgloseMedido({
        regla, tipo: c.tipo, base: b, plataBase, monedaBase: cx.base, moneda: c.moneda, fuente, valor,
        tasa: c.tasa, cada: c.cada, veces, montoPorTramo: c.monto, monto: r2(monto),
        unidad: c.unidad?.trim() || undefined, utm: c.utmSource,
        ...(parcial && b !== "manual" && b !== "profit" && entrada?.cantidad === undefined
          ? { vigencia: { desde: vig.rango.desde.getDate(), hasta: vig.rango.hasta.getDate(), mes: nombrePeriodo(cx.rango.clave) } }
          : {}),
      });
      break;
    }
  }

  let corregido = false;
  if (entrada?.monto !== undefined && Number.isFinite(entrada.monto)) {
    detalle = `Corregido a mano: la cuenta daba ${M(r2(monto))}${entrada.nota?.trim() ? ` · ${entrada.nota.trim()}` : ""}`;
    if (desglose) desglose = conCorreccion(desglose, r2(monto), entrada.nota);
    monto = entrada.monto;
    corregido = true;
    falta = undefined;
  }
  monto = r2(monto);
  return {
    clave: c.id, conceptoId: c.id, tipo: c.tipo, nombre: c.nombre, detalle, moneda: c.moneda,
    monto, montoBase: r2(aMonedaBase(monto, c.moneda, cx.base, cx.tc)),
    variable: c.tipo !== "fijo", medido, enFinanzas: calculaFinanzas(m, c), falta, corregido,
    ...(c.tipo === "porcentaje" || c.tipo === "tramo" ? { base: c.base ?? "manual" } : {}),
    ...(c.tipo === "unidad" || c.base === "manual" ? { unidad: c.unidad?.trim() || undefined } : {}),
    ...(desglose ? { desglose } : {}),
  };
}

/* "Lo cargó Juan Cruz el 7 oct 2026 desde la liquidación de septiembre 2026". */
function cargadoTexto(x: ExtraLiquidacion, periodo: string): string | undefined {
  if (!x.creadoEn && !x.creadoPor?.trim()) return undefined;
  const quien = x.creadoPor?.trim() ? ` ${x.creadoPor.trim()}` : "";
  const cuando = x.creadoEn ? ` el ${fechaLarga(x.creadoEn)}` : "";
  const desde = x.desdePeriodo && x.desdePeriodo !== periodo && esPeriodo(x.desdePeriodo)
    ? ` desde la liquidación de ${nombrePeriodo(x.desdePeriodo)}` : "";
  return `Lo cargó${quien}${cuando}${desde}.`;
}

function lineaExtra(cx: Contexto, x: ExtraLiquidacion): LineaLiquidada {
  const monto = r2(x.monto);
  const nota = x.nota?.trim();
  const cargado = cargadoTexto(x, cx.rango.clave);
  return {
    clave: `extra:${x.id}`, extraId: x.id, tipo: "extra", nombre: x.concepto.trim() || "Monto a mano",
    detalle: monto < 0 ? "Descuento cargado a mano" : "Cargado a mano",
    moneda: x.moneda, monto, montoBase: r2(aMonedaBase(monto, x.moneda, cx.base, cx.tc)),
    variable: true, enFinanzas: false,
    ...(nota ? { nota } : {}), ...(cargado ? { cargado } : {}),
  };
}

/* ---------- Devoluciones: lo que se revierte y lo que queda debiendo ----------
   Al closer y al director se les revierte EXACTAMENTE lo que se les comisionó
   por lo cobrado de la venta que se devolvió, como una línea negativa de este
   mes (lib/devoluciones.ts: son las mismas cuentas con las que Finanzas
   resta la comisión, así que «Ya está en Finanzas» es cierto). Si el mes da
   en negativo, no se le paga nada y lo que queda debiendo es otro renglón:
   «Pasa al mes siguiente» acá y «Deuda de …» en la liquidación que sigue. Una
   liquidación cerrada no se reescribe: lo que llega después entra en la
   primera abierta. */

const conceptoDeReversa = (r: Reversa, p: ParteReversa) => `devolucion:${r.devolucion.id}:${p.rol}`;

function lineaDeReversa(cx: Contexto, r: Reversa, parte: ParteReversa, entrada: EntradaLiquidacion | undefined): LineaLiquidada {
  const cliente = r.venta.contactoNombre?.trim() || "una venta";
  const clave = conceptoDeReversa(r, parte);
  const comoQue = parte.rol === "director" ? "de las ventas que dirige" : "de las ventas que cerró";
  const regla = `Se le revierte lo que se le comisionó (${tasaTexto(parte.tasa)} del cash collected post pasarelas ${comoQue}) por lo cobrado de la venta de ${cliente}, en la parte que se devolvió el ${fechaLarga(r.devolucion.fecha)}`;
  let desglose: DesgloseLinea | undefined = desgloseReversa({
    regla, moneda: cx.base, tasa: parte.tasa, cobrado: parte.cobrado, fees: parte.fees, neto: parte.neto, cuantos: parte.cobros.length,
    comision: parte.comision, yaRevertido: parte.yaRevertido, quedaba: parte.quedaba, devuelto: r.devuelto, deCuanto: r.quedaba,
    reversa: parte.reversa, fecha: r.devolucion.fecha, heredadaDe: parte.heredadaDe,
    lista: listaDeCobros(parte.cobros.map((pago) => ({ pago, venta: cx.ventaDeCuota.get(pago.cuotaId) })), nombresDeLista(cx), cx.base),
  });
  let monto = -parte.reversa;
  let detalle = `Se le había comisionado ${plata(parte.comision, cx.base)} por esos cobros: se devolvieron ${plata(r.devuelto, cx.base)} de ${plata(r.quedaba, cx.base)}${r.parte < 1 ? ` (el ${pct(r.parte * 100, 0)})` : ""}`;
  let corregido = false;
  if (entrada?.monto !== undefined && Number.isFinite(entrada.monto)) {
    detalle = `Corregido a mano: la cuenta daba ${plata(r2(monto), cx.base)}${entrada.nota?.trim() ? ` · ${entrada.nota.trim()}` : ""}`;
    desglose = conCorreccion(desglose, r2(monto), entrada.nota);
    monto = entrada.monto;
    corregido = true;
  }
  monto = r2(monto);
  return {
    clave, conceptoId: clave, devolucionId: r.devolucion.id, tipo: "devolucion",
    nombre: `Devolución de ${cliente}`, detalle, moneda: cx.base, monto, montoBase: monto,
    variable: true, enFinanzas: true, corregido, desglose,
  };
}

/** Las líneas «Devolución de …» de esta persona: una por cada devolución
 *  de este mes que le revierte comisión (como closer o como director). */
function lineasDeReversa(cx: Contexto, m: MiembroEquipo, reversas: Reversa[], entradas: Record<string, EntradaLiquidacion>): LineaLiquidada[] {
  const out: LineaLiquidada[] = [];
  for (const r of reversas) {
    for (const parte of r.partes) {
      if (parte.miembroId !== m.id || parte.reversa < 0.005) continue;
      out.push(lineaDeReversa(cx, r, parte, entradas[claveEntrada(m.id, conceptoDeReversa(r, parte))]));
    }
  }
  return out;
}

const idDeuda = (periodo: string, mon: Moneda, sentido: "entra" | "sale") => `arrastre-${sentido}:${periodo}:${mon}`;

/** Lo que quedó debiendo de la liquidación anterior (cerrada): se descuenta de ésta. */
function lineaDeDeudaQueEntra(cx: Contexto, m: MiembroEquipo, mesAnterior: string, mon: Moneda, deuda: number, entrada: EntradaLiquidacion | undefined): LineaLiquidada {
  const clave = idDeuda(mesAnterior, mon, "entra");
  const nombreMes = nombrePeriodo(mesAnterior);
  const regla = `Lo que ${m.nombre.split(" ")[0]} quedó debiendo de la liquidación de ${nombreMes} (las devoluciones que se le descontaron fueron más que lo que cobraba) se descuenta de ${nombrePeriodo(cx.rango.clave)}`;
  let desglose: DesgloseLinea | undefined = desgloseDeudaQueEntra({ regla, moneda: mon, deuda, mesAnterior: nombreMes });
  let monto = -deuda;
  let detalle = `Lo que quedó debiendo de ${nombreMes}: se descuenta de este mes`;
  let corregido = false;
  if (entrada?.monto !== undefined && Number.isFinite(entrada.monto)) {
    detalle = `Corregido a mano: la cuenta daba ${plata(r2(monto), mon)}${entrada.nota?.trim() ? ` · ${entrada.nota.trim()}` : ""}`;
    desglose = conCorreccion(desglose, r2(monto), entrada.nota);
    monto = entrada.monto;
    corregido = true;
  }
  monto = r2(monto);
  return {
    clave, conceptoId: clave, tipo: "arrastre", nombre: `Deuda de ${nombreMes}`, detalle, moneda: mon,
    monto, montoBase: r2(aMonedaBase(monto, mon, cx.base, cx.tc)), variable: true, enFinanzas: true, corregido, desglose,
  };
}

/** El mes da en negativo: no se le paga nada y lo que queda debiendo pasa al mes siguiente. */
function lineaDeDeudaQueSale(cx: Contexto, nombre: string, mon: Moneda, suma: number): LineaLiquidada {
  const periodo = cx.rango.clave;
  const siguiente = nombrePeriodo(moverPeriodo(periodo, 1));
  const deuda = r2(-suma);
  const regla = `Este mes la suma de los renglones de ${nombre.split(" ")[0]} da en negativo (las devoluciones que se le descuentan son más que lo que cobra): no se le paga nada y lo que queda debiendo pasa a la liquidación de ${siguiente}`;
  return {
    clave: idDeuda(periodo, mon, "sale"), tipo: "arrastre", nombre: `Pasa a ${siguiente}`,
    detalle: `Queda debiendo ${plata(deuda, mon)}: se descuenta de la liquidación de ${siguiente}`, moneda: mon,
    monto: deuda, montoBase: r2(aMonedaBase(deuda, mon, cx.base, cx.tc)), variable: true, enFinanzas: true,
    desglose: desgloseDeudaQueSale({ regla, moneda: mon, suma, deuda, mesSiguiente: siguiente }),
  };
}

/* ---------- La liquidación ---------- */

/** Quiénes entran en la liquidación: los activos con algo cargado, y los
 *  activos sin nada cargado (salvo el CEO), para que nadie quede afuera
 *  sin que se note. De los que ya no están:
 *  - con esquema, sólo el período en que se fueron (tienen fecha de salida
 *    y es de este período o después): cobran los días que estuvieron. Sin
 *    fecha de salida no entran, como siempre: su fijo no sigue corriendo.
 *  - sin esquema, si Finanzas les calcula comisión (ver comisionDeFinanzas)
 *    y no se fueron antes del período.
 *  `desde` es el primer día del período. Los que no tienen nada en el mes
 *  se sacan después (calcularLiquidacion). */
export function miembrosALiquidar(e: EstadoApp, desde?: string): MiembroEquipo[] {
  const conEsquema = new Set(e.honorarios.filter((h) => h.conceptos.length > 0).map((h) => h.miembroId));
  const conAlgo = new Set(e.honorarios.map((h) => h.miembroId));
  const estuvo = (m: MiembroEquipo) => !desde || !m.hasta || m.hasta >= desde;
  return e.equipo
    .filter((m) => (m.activo && (conAlgo.has(m.id) || m.rol !== "ceo"))
      || (!m.activo && conEsquema.has(m.id) && Boolean(m.hasta) && estuvo(m))
      || (!m.activo && !conEsquema.has(m.id) && tasaImplicita(m) > 0 && estuvo(m)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/* Quien vende y no tiene nada cargado en lo que cobra igual le cuesta
   comisión a Finanzas, que la calcula con equipo.comisionRate. Para que la
   liquidación no diga menos que Finanzas, ese renglón sale igual, con esa
   tasa y avisado. */
const tasaImplicita = (m: MiembroEquipo) =>
  (m.rol === "closer" || m.rol === "director") && !m.sinComision
    ? Math.max(m.comisionRate, ...Object.values(m.comisionServicios ?? {})) : 0;

export const ID_COMISION_DE_FINANZAS = "finanzas";

function comisionDeFinanzas(m: MiembroEquipo): ConceptoPago[] {
  const comun = {
    tipo: "porcentaje" as const, moneda: "USD" as const, base: "cash-neto" as const,
    alcance: m.rol === "director" ? "director" as const : "closer" as const,
    /* Un director que ya se fue cobra sólo lo que entró hasta su salida. */
    ...(m.rol === "director" && m.hasta ? { hasta: m.hasta } : {}),
  };
  /* Los servicios con su propio %, agrupados por tasa: un renglón por cada una. */
  const porTasa = new Map<number, ID[]>();
  for (const [id, t] of Object.entries(m.comisionServicios ?? {})) porTasa.set(t, [...(porTasa.get(t) ?? []), id]);
  return [
    { ...comun, id: ID_COMISION_DE_FINANZAS, nombre: "Comisión", tasa: m.comisionRate },
    ...[...porTasa.entries()].map(([tasa, productoIds], i) => ({
      ...comun, id: `${ID_COMISION_DE_FINANZAS}:${i}`, nombre: "Comisión por servicio", tasa, productoIds,
    })),
  ];
}

/** La liquidación del mes, calculada con los datos de hoy. Una liquidación
 *  cerrada se muestra con su foto (`resultado`), no con esto. */
export function calcularLiquidacion(e: EstadoApp, periodo: string, liq?: Liquidacion | null): ResultadoLiquidacion {
  const rango = rangoDePeriodo(periodo);
  const tc = liq?.tipoCambio ?? e.ajustes.tipoCambio ?? 0;
  const cx = armarContexto(e, rango, tc);
  const entradas = liq?.entradas ?? {};
  const extras = liq?.extras ?? [];
  const esquemaDe = new Map(e.honorarios.map((h) => [h.miembroId, h] as const));

  /* Primero todo lo que no depende del profit. Los % del profit van después:
     el profit se calcula con los sueldos de esta misma liquidación adentro. */
  type Fila = { persona: PersonaLiquidada; m: MiembroEquipo; lineas: (LineaLiquidada | null)[] };
  const filas: Fila[] = [];
  const delProfit: { fila: Fila; i: number; c: ConceptoPago }[] = [];

  /* Quien tiene un monto a mano cargado para este mes sale igual, aunque ya
     no esté entre los que se liquidan: un descuento no puede perderse en
     silencio. De ésos, sólo sale lo cargado a mano. */
  const aLiquidar = miembrosALiquidar(e, periodo.slice(0, 7) + "-01");
  const yaSalen = new Set(aLiquidar.map((m) => m.id));
  const soloMontos = new Set(e.equipo.filter((m) => !yaSalen.has(m.id) && extras.some((x) => x.miembroId === m.id)).map((m) => m.id));

  /* Las devoluciones que se le descuentan a alguien este mes: las de la fecha
     de este mes y las que llegaron tarde (con su mes ya cerrado), que entran
     en la primera liquidación abierta. Y lo que alguien quedó debiendo de la
     liquidación anterior, si ya está cerrada. Quien tiene algo de eso sale
     igual aunque ya no esté entre los que se liquidan: una deuda no puede
     perderse en silencio. */
  const liquidadas = liquidadaEn(e.liquidaciones);
  const reversas = reversasDeComision(e).filter((r) => !r.sinDescuento && mesDeLiquidacion(r.devolucion, e.liquidaciones, liquidadas) === periodo);
  const conReversa = new Set(reversas.flatMap((r) => r.partes.filter((x) => x.reversa >= 0.005 && x.miembroId).map((x) => x.miembroId as ID)));
  const mesAnterior = moverPeriodo(periodo, -1);
  const fotoAnterior = e.liquidaciones.find((l) => l.periodo === mesAnterior && l.estado === "cerrada" && l.resultado);
  const deudasDeAntes = new Map<ID, [Moneda, number][]>();
  for (const p of fotoAnterior?.resultado?.personas ?? []) {
    const d = (Object.entries(p.deuda ?? {}) as [Moneda, number][]).filter(([, n]) => n >= 0.005);
    if (d.length) deudasDeAntes.set(p.miembroId, d);
  }
  const soloDevolucion = new Set(e.equipo
    .filter((m) => !yaSalen.has(m.id) && !soloMontos.has(m.id) && (conReversa.has(m.id) || deudasDeAntes.has(m.id))).map((m) => m.id));
  /* De éstos sólo salen sus montos a mano, sus devoluciones y su deuda. */
  const soloLoSuyo = new Set([...soloMontos, ...soloDevolucion]);
  const miembros = soloLoSuyo.size
    ? [...aLiquidar, ...e.equipo.filter((m) => soloLoSuyo.has(m.id))].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    : aLiquidar;

  for (const m of miembros) {
    const esq = esquemaDe.get(m.id);
    const sinCargar = !esq || esq.conceptos.length === 0;
    const pendiente = esq?.pendiente?.trim() || undefined;
    /* Sin nada cargado, lo que le calcula Finanzas: su comisión con la tasa de siempre. */
    const conceptos = soloLoSuyo.has(m.id) ? [] : sinCargar && tasaImplicita(m) > 0 ? comisionDeFinanzas(m) : esq?.conceptos ?? [];
    const fila: Fila = {
      m, lineas: [],
      persona: {
        miembroId: m.id, nombre: m.nombre, puesto: m.puesto?.trim() || undefined,
        categoriaGasto: esq?.categoriaGasto?.trim() || categoriaPorDefecto(m),
        lineas: [], aPagar: {}, total: 0, fijo: 0, variable: 0, pendiente,
        ...(sinCargar && !soloLoSuyo.has(m.id) ? { sinCargar } : {}), ...(!m.activo ? { inactivo: true } : {}),
      },
    };
    for (const c of conceptos) {
      if (c.base === "profit" && (c.tipo === "porcentaje" || c.tipo === "tramo") && entradas[claveEntrada(m.id, c.id)]?.cantidad === undefined) {
        delProfit.push({ fila, i: fila.lineas.length, c });
        fila.lineas.push(null);
        continue;
      }
      fila.lineas.push(linea(cx, m, c, entradas[claveEntrada(m.id, c.id)], undefined, conceptos));
    }
    fila.lineas.push(...lineasDeReversa(cx, m, reversas, entradas));
    for (const x of extras) if (x.miembroId === m.id) fila.lineas.push(lineaExtra(cx, x));
    for (const [mon, deuda] of deudasDeAntes.get(m.id) ?? []) {
      fila.lineas.push(lineaDeDeudaQueEntra(cx, m, mesAnterior, mon, deuda, entradas[claveEntrada(m.id, idDeuda(mesAnterior, mon, "entra"))]));
    }
    filas.push(fila);
  }

  /* El profit: el resultado operativo de Finanzas sin los gastos que ya
     cargó esta liquidación (si se reabrió), menos lo que esta liquidación
     va a cargar en costos directos y gastos operativos. Las comisiones de
     closers y del director ya están adentro: Finanzas las calcula solas. */
  const idLiq = idLiquidacion(periodo);
  const pyl = calcularPyL({ ...e, gastos: e.gastos.filter((g) => g.extra?.liquidacionId !== idLiq) }, rango);
  let aCargar = 0;
  for (const f of filas) {
    if ((categoriaDe(e, f.persona.categoriaGasto)?.grupo ?? "operativo") === "dueno") continue;
    for (const l of f.lineas) if (l && !l.enFinanzas) aCargar += l.montoBase;
  }
  const profit = r2(pyl.operativoCC - aCargar);
  const prof: Profit = {
    profit, parte: parteMarketing(e, rango),
    partes: {
      cash: r2(pyl.cobrado), ...(pyl.devoluciones > 0 ? { devoluciones: r2(pyl.devoluciones) } : {}),
      procesadores: r2(pyl.feesProcesador), comisiones: r2(pyl.comisionCloser + pyl.comisionDirector),
      otrosDirectos: r2(pyl.otrosDirectos), gastosOperativos: r2(pyl.gastosOperativos), sueldos: r2(aCargar),
    },
  };
  for (const x of delProfit) {
    x.fila.lineas[x.i] = linea(cx, x.fila.m, x.c, entradas[claveEntrada(x.fila.m.id, x.c.id)], prof);
  }

  const personas = filas.map(({ persona, lineas }) => {
    const ls = lineas.filter((l): l is LineaLiquidada => l !== null)
      .map((l) => (l.conceptoId?.split(":")[0] === ID_COMISION_DE_FINANZAS && !l.corregido
        ? {
          ...l, detalle: `${l.detalle} · con la tasa que usa Finanzas: no tiene cargado lo que cobra`,
          ...(l.desglose ? { desglose: { ...l.desglose, avisos: [...(l.desglose.avisos ?? []), "No tiene cargado lo que cobra: esta comisión sale con la tasa que usa Finanzas."] } } : {}),
        }
        : l));
    /* Si el mes da en negativo por las devoluciones (las que se le descuentan
       son más que lo que cobra), no se le paga nada: lo que queda debiendo es
       otro renglón que pasa a la liquidación que sigue. Un descuento a mano
       solo (sin devoluciones) sigue como siempre: queda en negativo. */
    const sumas: Partial<Record<Moneda, number>> = {};
    for (const l of ls) sumas[l.moneda] = r2((sumas[l.moneda] ?? 0) + l.monto);
    const deuda: Partial<Record<Moneda, number>> = {};
    if (ls.some((l) => l.tipo === "devolucion" || l.tipo === "arrastre")) {
      for (const [mon, suma] of Object.entries(sumas) as [Moneda, number][]) {
        if (suma >= -0.005) continue;
        ls.push(lineaDeDeudaQueSale(cx, persona.nombre, mon, suma));
        deuda[mon] = r2(-suma);
      }
    }
    const aPagar: Partial<Record<Moneda, number>> = {};
    for (const l of ls) aPagar[l.moneda] = r2((aPagar[l.moneda] ?? 0) + l.monto);
    const fijo = r2(ls.filter((l) => !l.variable).reduce((a, l) => a + l.montoBase, 0));
    const variable = r2(ls.filter((l) => l.variable).reduce((a, l) => a + l.montoBase, 0));
    return { ...persona, lineas: ls, aPagar, fijo, variable, total: r2(fijo + variable), ...(Object.keys(deuda).length ? { deuda } : {}) };
  }).filter((p) => !p.inactivo || Math.abs(p.total) >= 0.005 || p.lineas.some((l) => l.corregido) || Boolean(p.deuda));

  const aPagar: Partial<Record<Moneda, number>> = {};
  for (const p of personas) {
    for (const [mon, n] of Object.entries(p.aPagar) as [Moneda, number][]) aPagar[mon] = r2((aPagar[mon] ?? 0) + n);
  }
  return {
    personas,
    total: r2(personas.reduce((a, p) => a + p.total, 0)),
    fijo: r2(personas.reduce((a, p) => a + p.fijo, 0)),
    variable: r2(personas.reduce((a, p) => a + p.variable, 0)),
    aPagar, tipoCambio: tc, profit, calculadoEn: new Date().toISOString(),
  };
}

/** Lo que hay que mirar antes de cerrar: renglones sin cargar, arreglos a
 *  definir y lo que se paga en pesos sin tipo de cambio. */
export function faltantes(r: ResultadoLiquidacion) {
  const lineas = r.personas.flatMap((p) => p.lineas.filter((l) => l.falta).map((l) => ({ persona: p, linea: l })));
  const pendientes = r.personas.filter((p) => !p.inactivo && (p.pendiente || p.sinCargar));
  const sinCambio = !(r.tipoCambio > 0) && r.personas.some((p) => p.lineas.some((l) => l.moneda !== "USD" && l.monto !== 0));
  return { lineas, pendientes, sinCambio };
}

/** Lo que cambió desde que se cerró: un cobro que se concilió tarde, una
 *  venta que se corrigió. Lo cerrado no se toca; esto dice cuánto sería hoy. */
export function diferenciasDesdeElCierre(e: EstadoApp, liq: Liquidacion) {
  if (liq.estado !== "cerrada" || !liq.resultado) return [];
  const hoy = calcularLiquidacion(e, liq.periodo, liq);
  const antes = new Map(liq.resultado.personas.map((p) => [p.miembroId, p] as const));
  return hoy.personas
    .map((p) => ({ miembroId: p.miembroId, nombre: p.nombre, cerrado: antes.get(p.miembroId)?.total ?? 0, hoy: p.total }))
    .filter((x) => Math.abs(x.hoy - x.cerrado) >= 0.01);
}

/* ---------- Al cerrar: lo que va a Finanzas ----------
   Un gasto por categoría y moneda, con la suma: el detalle por persona
   vive acá, que sólo ven los dueños. En Finanzas lo ve todo el equipo,
   así que ahí no va el sueldo de nadie con nombre y apellido. */

const slug = (s: string) => normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function gastosDeLiquidacion(e: EstadoApp, liq: Pick<Liquidacion, "id" | "periodo">, r: ResultadoLiquidacion): Gasto[] {
  const base = e.ajustes.monedaBase;
  const grupos = new Map<string, { categoria: string; moneda: Moneda; monto: number; personas: Set<ID> }>();
  for (const p of r.personas) {
    for (const l of p.lineas) {
      if (l.enFinanzas || Math.abs(l.monto) < 0.005) continue;
      const k = `${p.categoriaGasto}|${l.moneda}`;
      let g = grupos.get(k);
      if (!g) { g = { categoria: p.categoriaGasto, moneda: l.moneda, monto: 0, personas: new Set() }; grupos.set(k, g); }
      g.monto += l.monto;
      g.personas.add(p.miembroId);
    }
  }
  /* El día que se cierra si es dentro del mes (así se ve en "Este mes" de
     Finanzas, que llega hasta hoy); si se cierra después, el último día del
     mes. A mediodía: cae en ese día con cualquier huso. */
  const [a, m] = liq.periodo.split("-").map(Number);
  const hoy = new Date();
  const dia = hoy.getFullYear() === a && hoy.getMonth() === m - 1 ? hoy.getDate() : new Date(a, m, 0).getDate();
  const fecha = new Date(a, m - 1, dia, 12).toISOString();
  const ahora = hoy.toISOString();
  return [...grupos.values()]
    .filter((g) => g.monto > 0.005)
    .map((g): Gasto => {
      const enBase = g.moneda === base;
      const n = g.personas.size;
      return {
        id: `gas_liq_${liq.periodo}_${slug(g.categoria)}_${g.moneda.toLowerCase()}`,
        categoria: g.categoria,
        grupo: categoriaDe(e, g.categoria)?.grupo ?? "operativo",
        concepto: `Liquidación de ${nombrePeriodo(liq.periodo)} · ${n} ${n === 1 ? "persona" : "personas"}`,
        monto: r2(enBase ? g.monto : aMonedaBase(g.monto, g.moneda, base, r.tipoCambio)),
        moneda: base,
        fecha,
        recurrente: false,
        notas: "La cargó la liquidación de sueldos (Equipo y honorarios). Si se reabre, se borra sola.",
        creadoEn: ahora,
        extra: {
          liquidacionId: liq.id,
          ...(enBase ? {} : { montoOriginal: r2(g.monto), monedaOriginal: g.moneda, tipoCambio: r.tipoCambio }),
        },
      };
    });
}

/* ---------- Exportar ---------- */

/** La liquidación en CSV: una fila por renglón, con la persona adelante. */
export function liquidacionCsv(r: ResultadoLiquidacion, periodo: string): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const n = (x: number) => x.toFixed(2);
  const filas = [
    `Liquidación,${q(nombrePeriodo(periodo))}`,
    `Tipo de cambio,${n(r.tipoCambio)}`,
    "Persona,Puesto,Concepto,Detalle,Moneda,Monto,Monto en USD,Ya está en Finanzas",
  ];
  for (const p of r.personas) {
    for (const l of p.lineas) {
      filas.push([q(p.nombre), q(p.puesto ?? ""), q(l.nombre), q(l.nota ? `${l.detalle} · Nota: ${l.nota}` : l.detalle), l.moneda, n(l.monto), n(l.montoBase), l.enFinanzas ? "Sí" : "No"].join(","));
    }
    filas.push([q(p.nombre), q(p.puesto ?? ""), q("Total"), q(""), "USD", n(p.total), n(p.total), ""].join(","));
  }
  filas.push([q("Todo el equipo"), q(""), q("Total"), q(""), "USD", n(r.total), n(r.total), ""].join(","));
  return filas.join("\n");
}

/** Lo que se le manda a cada uno: su liquidación en texto, lista para pegar. */
export function textoParaEnviar(p: PersonaLiquidada, periodo: string): string {
  /* La nota de un monto a mano va debajo de su renglón: quien ejecuta el pago la lee ahí. */
  const lineas = p.lineas.flatMap((l) => [
    `• ${l.nombre}: ${plata(l.monto, l.moneda)}${l.detalle ? ` — ${l.detalle}` : ""}`,
    ...(l.nota ? [`   Nota: ${l.nota}`] : []),
  ]);
  const total = (Object.entries(p.aPagar) as [Moneda, number][])
    .filter(([, x]) => Math.abs(x) >= 0.005).map(([m, x]) => plata(x, m)).join(" + ");
  return [`Hola ${p.nombre.split(" ")[0]}, tu liquidación de ${nombrePeriodo(periodo)}:`, ...lineas, `Total: ${total || plata(0, "USD")}`].join("\n");
}

/* ---------- Ver un renglón, mes a mes ---------- */

/** El renglón de una persona en una liquidación (con su desglose, si lo tiene). */
export function renglonDe(r: ResultadoLiquidacion | null | undefined, miembroId: ID, clave: string):
  { persona: PersonaLiquidada; linea: LineaLiquidada } | undefined {
  const persona = r?.personas.find((p) => p.miembroId === miembroId);
  const linea = persona?.lineas.find((l) => l.clave === clave);
  return persona && linea ? { persona, linea } : undefined;
}

/** Los meses cerrados en los que esta persona tuvo este renglón, del más
 *  viejo al más nuevo: para mirar cómo se calculó mes a mes. */
export function mesesDelRenglon(liquidaciones: Liquidacion[], miembroId: ID, clave: string): string[] {
  return liquidaciones
    .filter((l) => l.estado === "cerrada" && renglonDe(l.resultado, miembroId, clave))
    .map((l) => l.periodo)
    .sort();
}

/* ---------- Montos a mano, también para los meses que vienen ----------
   «Un closer cobró algo en su cuenta personal y el mes que viene hay que
   descontárselo» (Angelo, 06/10): el monto se anota con su nota para quien
   paga en la liquidación del mes al que corresponde, aunque todavía no haya
   llegado. Si ese mes todavía no tiene liquidación, se crea con lo único que
   tiene: el monto. Es la misma que arma sola la pantalla mientras no existe
   (liquidacionVacia), así que al motor no le cambia nada. */

/** Una liquidación sin nada cargado. */
export function liquidacionVacia(periodo: string, ahora = new Date().toISOString()): Liquidacion {
  return {
    id: idLiquidacion(periodo), periodo, estado: "abierta", entradas: {}, extras: [],
    pagos: {}, gastoIds: [], creadoEn: ahora,
  };
}

/** La lista de liquidaciones con el monto sumado en la del mes `periodo` (se
 *  crea si no existe), o null si ese mes ya está cerrado: lo cerrado no
 *  cambia. Con el mismo id dos veces, el monto queda una sola vez. */
export function conExtraEnMes(
  liquidaciones: Liquidacion[], periodo: string, extra: ExtraLiquidacion, ahora = new Date().toISOString(),
): { liquidaciones: Liquidacion[]; liquidacion: Liquidacion } | null {
  const actual = liquidaciones.find((l) => l.periodo === periodo);
  if (actual?.estado === "cerrada") return null;
  const base = actual ?? liquidacionVacia(periodo, ahora);
  const extras = base.extras.some((x) => x.id === extra.id)
    ? base.extras.map((x) => (x.id === extra.id ? extra : x))
    : [...base.extras, extra];
  const liquidacion: Liquidacion = { ...base, extras, actualizadoEn: ahora };
  return {
    liquidacion,
    liquidaciones: actual ? liquidaciones.map((l) => (l.id === actual.id ? liquidacion : l)) : [...liquidaciones, liquidacion],
  };
}

/** La lista sin ese monto, o null si no está o la liquidación ya se cerró. */
export function sinExtraEnLiquidacion(
  liquidaciones: Liquidacion[], liquidacionId: ID, extraId: ID, ahora = new Date().toISOString(),
): { liquidaciones: Liquidacion[]; liquidacion: Liquidacion } | null {
  const actual = liquidaciones.find((l) => l.id === liquidacionId);
  if (!actual || actual.estado === "cerrada" || !actual.extras.some((x) => x.id === extraId)) return null;
  const liquidacion: Liquidacion = { ...actual, extras: actual.extras.filter((x) => x.id !== extraId), actualizadoEn: ahora };
  return { liquidacion, liquidaciones: liquidaciones.map((l) => (l.id === actual.id ? liquidacion : l)) };
}

/** Lo anotado para los meses que vienen (liquidaciones abiertas, después de
 *  `despuesDe`), del más cercano al más lejano. */
export function extrasPorVenir(liquidaciones: Liquidacion[], despuesDe: string):
  { liquidacionId: ID; periodo: string; extra: ExtraLiquidacion }[] {
  return liquidaciones
    .filter((l) => l.estado !== "cerrada" && l.periodo > despuesDe && l.extras.length > 0)
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .flatMap((l) => l.extras.map((extra) => ({ liquidacionId: l.id, periodo: l.periodo, extra })));
}

/** Los meses en los que se puede anotar un monto mirando `mirando`: ése y los
 *  que vienen (hasta medio año), más el mes de hoy y los dos siguientes, sin
 *  los cerrados. */
export function mesesParaExtra(liquidaciones: Liquidacion[], mirando: string, hoy: string): string[] {
  const cerrados = new Set(liquidaciones.filter((l) => l.estado === "cerrada").map((l) => l.periodo));
  const candidatos = new Set<string>();
  for (let i = 0; i <= 6; i++) candidatos.add(moverPeriodo(mirando, i));
  for (let i = 0; i <= 2; i++) candidatos.add(moverPeriodo(hoy, i));
  return [...candidatos].filter((p) => p >= mirando && !cerrados.has(p)).sort();
}
