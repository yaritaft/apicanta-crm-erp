import type {
  AlcanceVentas, BaseMedicion, ConceptoPago, EntradaLiquidacion, EsquemaPago, EstadoApp, ExtraLiquidacion,
  Gasto, ID, LineaLiquidada, Liquidacion, MiembroEquipo, Moneda, PersonaLiquidada,
  ResultadoLiquidacion, TipoConcepto, Venta,
} from "./types";
import type { RangoMes } from "./metricas";
import { calcularPyL, pagosDelMes, parteMarketing, ventasDelMes } from "./finanzas";
import { aMonedaBase, categoriaDe, normalizar } from "./gastos";
import { fechaLarga, money, num, pct } from "./format";

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

/* ---------- Períodos: un mes, "2026-09" ---------- */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const esPeriodo = (p: string | null | undefined): p is string => Boolean(p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p));

export function periodoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function moverPeriodo(p: string, n: number): string {
  const [a, m] = p.split("-").map(Number);
  return periodoDe(new Date(a, m - 1 + n, 1));
}

export function nombrePeriodo(p: string): string {
  const [a, m] = p.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/* Del primero a las 00:00 al último a las 23:59:59, en la hora de acá:
   el mismo borde que usa Finanzas para "Este mes". */
export function rangoDePeriodo(p: string): RangoMes {
  const [a, m] = p.split("-").map(Number);
  return { clave: p, etiqueta: nombrePeriodo(p), desde: new Date(a, m - 1, 1), hasta: new Date(a, m, 0, 23, 59, 59) };
}

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

function filtros(c: ConceptoPago, e: Catalogos): string[] {
  const out: string[] = [];
  if (c.productoIds?.length) {
    const nombres = c.productoIds.map((id) => e.productos.find((p) => p.id === id)?.nombre).filter(Boolean);
    if (nombres.length) out.push(`sólo ${nombres.join(", ")}`);
  }
  if (c.sinVentasSinComision && (c.alcance ?? "todas") === "todas") out.push(`sin las que cerró ${quienesNoComisionan(e)}`);
  if (c.sinExcluidasMarketing) out.push("sin las excluidas de marketing");
  return out;
}

/* Lo que se mide, con su alcance: "del cash collected post pasarelas de las
   ventas que cerró", "llamadas agendadas con utm_source Resell". */
function queSeMide(c: ConceptoPago, e: Catalogos, cada?: number): string {
  const b = c.base ?? "manual";
  const alcance = c.alcance ?? "todas";
  const extra = filtros(c, e);
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
 *  post pasarelas del negocio". */
export function describirConcepto(c: ConceptoPago, e: Catalogos): string {
  const M = (n?: number) => plata(n ?? 0, c.moneda);
  let frase: string;
  switch (c.tipo) {
    case "fijo": frase = `${M(c.monto)} por mes`; break;
    case "bono": frase = `${M(c.monto)} si lo gana${c.condicion?.trim() ? ` (${c.condicion.trim()})` : ""}`; break;
    case "porcentaje": frase = `${pct((c.tasa ?? 0) * 100, decimalesTasa(c.tasa))} ${queSeMide(c, e)}`; break;
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

/** Lo que cobra alguien, en una línea: "US$ 1.700 fijo + 2 variables". */
export function resumenEsquema(esq: EsquemaPago | undefined): string {
  if (!esq || esq.conceptos.length === 0) return esq?.pendiente?.trim() ? "A definir" : "Sin cargar";
  const fijos = esq.conceptos.filter((c) => c.tipo === "fijo");
  const variables = esq.conceptos.length - fijos.length;
  const porMoneda = new Map<Moneda, number>();
  for (const c of fijos) porMoneda.set(c.moneda, (porMoneda.get(c.moneda) ?? 0) + (c.monto ?? 0));
  const partes = [...porMoneda.entries()].map(([m, n]) => `${plata(n, m)} fijo`);
  if (variables) partes.push(variables === 1 ? "1 variable" : `${variables} variables`);
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

/* ---------- Qué entra en Finanzas por su cuenta ----------
   Finanzas calcula sola, de las ventas, la comisión de cada closer y del
   director (cash post pasarelas × equipo.comisionRate) y el reparto del
   profit del growth partner y del socio. Esos renglones no se cargan como
   gasto al cerrar: se contarían dos veces. Para que Finanzas diga lo mismo
   que la liquidación, `comisionRate` se escribe desde el esquema
   (tasaParaFinanzas) cada vez que se guarda. */

export function calculaFinanzas(m: Pick<MiembroEquipo, "rol">, c: ConceptoPago): boolean {
  if (c.tipo !== "porcentaje") return false;
  if (c.base === "profit") return m.rol === "growth" || m.rol === "socio";
  if (c.base !== "cash-neto" || c.productoIds?.length) return false;
  if (c.alcance === "closer") return m.rol === "closer" || m.rol === "ceo";
  if (c.alcance === "director") return m.rol === "director";
  return false;
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
  let es: (c: ConceptoPago) => boolean;
  switch (m.rol) {
    case "closer": case "ceo": case "director": case "growth": case "socio":
      es = (c) => calculaFinanzas(m, c);
      break;
    /* El setter no es un renglón de Finanzas (lo que cobra entra como gasto),
       pero su porcentaje es el que usa la planilla de Angelo al exportar. */
    case "setter":
      es = (c) => c.tipo === "porcentaje" && c.alcance === "setter" && (c.base === "cash" || c.base === "cash-neto");
      break;
    default:
      return undefined;
  }
  const hoy = hoyIso();
  const vigente = (c: ConceptoPago) => (!c.desde || c.desde <= hoy) && (!c.hasta || c.hasta >= hoy);
  const c = esq.conceptos.find((x) => es(x) && vigente(x)) ?? esq.conceptos.find(es);
  return c ? (c.tasa ?? 0) : 0;
}

/* ---------- Medir ---------- */

interface Contexto {
  e: EstadoApp;
  rango: RangoMes;
  base: Moneda;
  tc: number;
  ventaDeCuota: Map<ID, Venta>;
  equipo: Map<ID, MiembroEquipo>;
}

function armarContexto(e: EstadoApp, rango: RangoMes, tc: number): Contexto {
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const ventaDeCuota = new Map<ID, Venta>();
  for (const c of e.cuotas) {
    const v = ventas.get(c.ventaId);
    if (v) ventaDeCuota.set(c.id, v);
  }
  return { e, rango, base: e.ajustes.monedaBase, tc, ventaDeCuota, equipo: new Map(e.equipo.map((m) => [m.id, m] as const)) };
}

/* Todo lo cobrado de la empresa, sin filtro: tiene que dar lo mismo que el
   Cash collected de Finanzas, así que cuenta todos los pagos. */
const esTotal = (c: ConceptoPago) =>
  (c.alcance ?? "todas") === "todas" && !c.productoIds?.length && !c.sinVentasSinComision && !c.sinExcluidasMarketing;

/* Si una venta cuenta para este concepto. Con cualquier filtro, las ventas
   canceladas no cuentan (como en las comisiones de Finanzas), y en las del
   closer, el setter o el director tampoco las que cerró quien no comisiona:
   "si la venta la cerró Yari, no comisiona nadie". */
function cuenta(cx: Contexto, c: ConceptoPago, m: MiembroEquipo, v: Venta | undefined): boolean {
  if (esTotal(c)) return true;
  if (!v || v.estado === "cancelada") return false;
  const alcance = c.alcance ?? "todas";
  if (alcance === "closer" && v.closerId !== m.id) return false;
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

interface Medido { valor: number; cuantos: string }

/* Lo que se mide en los días del concepto. null: no se mide solo (el profit
   se calcula aparte y lo manual se carga). */
function medir(cx: Contexto, c: ConceptoPago, m: MiembroEquipo, r: RangoMes): Medido | null {
  const b = c.base ?? "manual";
  switch (b) {
    case "cash": case "cash-neto": {
      let valor = 0, n = 0;
      for (const p of pagosDelMes(cx.e, r)) {
        if (!cuenta(cx, c, m, cx.ventaDeCuota.get(p.cuotaId))) continue;
        valor += b === "cash" ? p.monto : p.monto - p.feeMonto;
        n++;
      }
      return { valor: r2(valor), cuantos: cant(n, "cobro", "cobros") };
    }
    case "facturado": case "ventas": {
      let valor = 0, n = 0;
      for (const v of ventasDelMes(cx.e, r)) {
        if (!cuenta(cx, c, m, v)) continue;
        valor += b === "facturado" ? v.precioAcordado : 1;
        n++;
      }
      return { valor: r2(valor), cuantos: cant(n, "venta", "ventas") };
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
      return { valor: n, cuantos: "según la Agenda" };
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

interface Profit { profit: number; parte: number }

function linea(
  cx: Contexto, m: MiembroEquipo, c: ConceptoPago, entrada: EntradaLiquidacion | undefined, prof?: Profit,
): LineaLiquidada | null {
  const vig = vigenciaEnMes(c, cx.rango);
  if (!vig) return null;
  const M = (n: number, mon: Moneda = c.moneda) => plata(n, mon);
  const parcial = vig.dias < vig.diasMes;
  let monto = 0;
  let detalle = "";
  let medido: number | undefined;
  let falta: string | undefined;

  switch (c.tipo) {
    case "fijo": {
      const lleno = c.monto ?? 0;
      monto = parcial ? (lleno * vig.dias) / vig.diasMes : lleno;
      detalle = parcial ? `${M(lleno)} por mes, prorrateado: ${vig.dias} de ${vig.diasMes} días` : `${M(lleno)} por mes`;
      break;
    }
    case "bono": {
      const gano = entrada?.cumplido !== false;
      monto = gano ? (c.monto ?? 0) : 0;
      detalle = gano
        ? `Lo ganó${c.condicion?.trim() ? ` · ${c.condicion.trim()}` : ""}`
        : `No lo ganó este mes (era ${M(c.monto ?? 0)})`;
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
      break;
    }
    case "porcentaje": case "tramo": {
      const b = c.base ?? "manual";
      const plataBase = infoBase(b).plata;
      let valor = 0;
      let origen = "";
      if (entrada?.cantidad !== undefined) {
        valor = entrada.cantidad;
        origen = "cargado a mano";
      } else if (b === "profit") {
        const p = prof ?? { profit: 0, parte: 1 };
        const parte = c.sinExcluidasMarketing ? p.parte : 1;
        valor = r2(Math.max(p.profit, 0) * parte);
        origen = p.profit <= 0
          ? "el mes dio pérdida: no hay profit para repartir"
          : parte < 1
            ? `el ${pct(parte * 100, 0)} de ${plata(p.profit, cx.base)}: lo demás es de ventas excluidas de marketing`
            : "el resultado operativo del mes";
      } else {
        const x = medir(cx, c, m, vig.rango);
        if (x) { valor = x.valor; origen = x.cuantos; } else { falta = "Cargá la cantidad"; origen = "falta cargarla"; }
      }
      if (parcial && b !== "manual" && b !== "profit" && entrada?.cantidad === undefined) {
        origen = `${origen}, del ${vig.rango.desde.getDate()} al ${vig.rango.hasta.getDate()}`;
      }
      medido = valor;
      const lo = medidoTexto(b, valor, cx.base, c.unidad);
      if (c.tipo === "porcentaje") {
        monto = valor * (c.tasa ?? 0);
        detalle = `${pct((c.tasa ?? 0) * 100, decimalesTasa(c.tasa))} de ${lo} (${origen})`;
      } else {
        const cada = c.cada ?? 0;
        const veces = cada > 0 ? Math.floor(valor / cada + 1e-9) : 0;
        monto = veces * (c.monto ?? 0);
        const tramo = plataBase ? plata(cada, cx.base) : num(cada, Number.isInteger(cada) ? 0 : 2);
        detalle = `${veces} ${veces === 1 ? "tramo" : "tramos"} de ${tramo}: ${lo} (${origen})`;
      }
      break;
    }
  }

  let corregido = false;
  if (entrada?.monto !== undefined && Number.isFinite(entrada.monto)) {
    detalle = `Corregido a mano: la cuenta daba ${M(r2(monto))}${entrada.nota?.trim() ? ` · ${entrada.nota.trim()}` : ""}`;
    monto = entrada.monto;
    corregido = true;
    falta = undefined;
  }
  monto = r2(monto);
  return {
    clave: c.id, conceptoId: c.id, tipo: c.tipo, nombre: c.nombre, detalle, moneda: c.moneda,
    monto, montoBase: r2(aMonedaBase(monto, c.moneda, cx.base, cx.tc)),
    variable: c.tipo !== "fijo", medido, enFinanzas: calculaFinanzas(m, c), falta, corregido,
  };
}

function lineaExtra(cx: Contexto, x: ExtraLiquidacion): LineaLiquidada {
  const monto = r2(x.monto);
  return {
    clave: `extra:${x.id}`, extraId: x.id, tipo: "extra", nombre: x.concepto.trim() || "Monto a mano",
    detalle: monto < 0 ? "Descuento cargado a mano" : "Cargado a mano",
    moneda: x.moneda, monto, montoBase: r2(aMonedaBase(monto, x.moneda, cx.base, cx.tc)),
    variable: true, enFinanzas: false,
  };
}

/* ---------- La liquidación ---------- */

/** Quiénes entran en la liquidación: los activos con algo cargado, y los
 *  activos sin nada cargado (salvo el CEO), para que nadie quede afuera
 *  sin que se note. */
export function miembrosALiquidar(e: EstadoApp): MiembroEquipo[] {
  const conEsquema = new Set(e.honorarios.map((h) => h.miembroId));
  return e.equipo
    .filter((m) => m.activo && (conEsquema.has(m.id) || m.rol !== "ceo"))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
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

  for (const m of miembrosALiquidar(e)) {
    const esq = esquemaDe.get(m.id);
    const sinCargar = !esq || esq.conceptos.length === 0;
    const pendiente = esq?.pendiente?.trim() || undefined;
    const fila: Fila = {
      m, lineas: [],
      persona: {
        miembroId: m.id, nombre: m.nombre, puesto: m.puesto?.trim() || undefined,
        categoriaGasto: esq?.categoriaGasto?.trim() || categoriaPorDefecto(m),
        lineas: [], aPagar: {}, total: 0, fijo: 0, variable: 0, pendiente, ...(sinCargar ? { sinCargar } : {}),
      },
    };
    for (const c of esq?.conceptos ?? []) {
      if (c.base === "profit" && (c.tipo === "porcentaje" || c.tipo === "tramo") && entradas[claveEntrada(m.id, c.id)]?.cantidad === undefined) {
        delProfit.push({ fila, i: fila.lineas.length, c });
        fila.lineas.push(null);
        continue;
      }
      fila.lineas.push(linea(cx, m, c, entradas[claveEntrada(m.id, c.id)]));
    }
    for (const x of extras) if (x.miembroId === m.id) fila.lineas.push(lineaExtra(cx, x));
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
  const prof: Profit = { profit, parte: parteMarketing(e, rango) };
  for (const x of delProfit) {
    x.fila.lineas[x.i] = linea(cx, x.fila.m, x.c, entradas[claveEntrada(x.fila.m.id, x.c.id)], prof);
  }

  const personas = filas.map(({ persona, lineas }) => {
    const ls = lineas.filter((l): l is LineaLiquidada => l !== null);
    const aPagar: Partial<Record<Moneda, number>> = {};
    for (const l of ls) aPagar[l.moneda] = r2((aPagar[l.moneda] ?? 0) + l.monto);
    const fijo = r2(ls.filter((l) => !l.variable).reduce((a, l) => a + l.montoBase, 0));
    const variable = r2(ls.filter((l) => l.variable).reduce((a, l) => a + l.montoBase, 0));
    return { ...persona, lineas: ls, aPagar, fijo, variable, total: r2(fijo + variable) };
  });

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
  const pendientes = r.personas.filter((p) => p.pendiente || p.sinCargar);
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
      filas.push([q(p.nombre), q(p.puesto ?? ""), q(l.nombre), q(l.detalle), l.moneda, n(l.monto), n(l.montoBase), l.enFinanzas ? "Sí" : "No"].join(","));
    }
    filas.push([q(p.nombre), q(p.puesto ?? ""), q("Total"), q(""), "USD", n(p.total), n(p.total), ""].join(","));
  }
  filas.push([q("Todo el equipo"), q(""), q("Total"), q(""), "USD", n(r.total), n(r.total), ""].join(","));
  return filas.join("\n");
}

/** Lo que se le manda a cada uno: su liquidación en texto, lista para pegar. */
export function textoParaEnviar(p: PersonaLiquidada, periodo: string): string {
  const lineas = p.lineas.map((l) => `• ${l.nombre}: ${plata(l.monto, l.moneda)}${l.detalle ? ` — ${l.detalle}` : ""}`);
  const total = (Object.entries(p.aPagar) as [Moneda, number][])
    .filter(([, x]) => Math.abs(x) >= 0.005).map(([m, x]) => plata(x, m)).join(" + ");
  return [`Hola ${p.nombre.split(" ")[0]}, tu liquidación de ${nombrePeriodo(periodo)}:`, ...lineas, `Total: ${total || plata(0, "USD")}`].join("\n");
}
