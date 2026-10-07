import type { Ajustes, EstadoApp, ID, Sesion, Venta } from "./types";
import { entraEnTabla, miembroDeCloser, tablasDe } from "./crm";
import { diaDeNegocio } from "./dia-negocio";
import { esReagendar } from "./estados";

/* ==================================================================
   El cierre del día: strikes y el interruptor del descuento.

   Yari (02/10): «venta que no se cargó el mismo día, venta que no se
   comisiona», y que la opción esté en Configuración, **apagada**: «probamos
   la política buena y la activamos». Acá está la regla, sin React, para que
   Finanzas, la liquidación y el resultado del webinar la lean de un solo
   lugar y no puedan decir cosas distintas.

   - Una llamada de venta pide cierre si ya pasó su día y no se canceló; sin
     estado cargado, tampoco si fue «no vino» (lo avisa Calendly) ni si pidió
     otra fecha (pideCierre).
   - El día se cierra a tiempo si el Estado de Llamada de cada una de las
     llamadas del closer se cargó ese mismo día (la hora de Argentina).
     Cuenta la PRIMERA vez que se cargó, venga de donde venga (el cierre del
     día, la tabla del CRM, la Agenda, la ficha o una venta): `estadoLlamadaEn`.
     Una llamada sin estado pero con su venta cargada (la cargó alguien que no
     edita las llamadas) cuenta desde cuándo se cargó la venta.
   - Un **strike** es un día en que alguna llamada se cargó otro día o
     todavía no se cargó. Se cuentan desde la fecha de arranque que se elige
     en Ajustes → CRM, y se le muestran al closer en «Tu día» aunque el
     interruptor esté apagado.
   - **El interruptor**, prendido: no se comisiona lo de un día con strike.
     La comisión del closer de las ventas que salieron de las llamadas de ese
     día no se paga (el director, el setter y el referidor no pierden nada:
     el cierre del día es del closer). Apagado, nada cambia en ningún lado.

   La venta se ata a su llamada por `venta.sesionId` (se guarda al cargarla).
   Las ventas de antes, sin ese dato, no entran en el descuento: no se
   puede probar de qué llamada salieron.
   ================================================================== */

export interface ReglaCierre {
  /* Desde qué día de llamada se cuentan los strikes. Sin fecha, todavía no. */
  cuentaDesde?: string;
  /* El interruptor. */
  descuenta: boolean;
  /* Desde qué día de llamada rige el descuento (el día en que se prendió). */
  descuentaDesde?: string;
}

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (x?: string) => (x && ES_DIA.test(x) ? x : undefined);

/** Lo que dice Ajustes → CRM sobre el cierre del día. */
export function reglaDeCierre(a: Pick<Ajustes, "crm"> | undefined): ReglaCierre {
  const c = a?.crm?.cierreDelDia;
  return { cuentaDesde: dia(c?.cuentaDesde), descuenta: c?.descuenta === true, descuentaDesde: dia(c?.descuentaDesde) };
}

/** Desde qué día de llamada se descuenta, o undefined si hoy no se descuenta
 *  nada (el interruptor está apagado o todavía no hay fecha de arranque). */
export function descuentoDesde(r: ReglaCierre): string | undefined {
  if (!r.descuenta || !r.cuentaDesde) return undefined;
  return r.descuentaDesde && r.descuentaDesde > r.cuentaDesde ? r.descuentaDesde : r.cuentaDesde;
}

/** El día de hoy en Argentina. */
export const hoyDeNegocio = (ahora: number = Date.now()) => diaDeNegocio(new Date(ahora).toISOString());

/* ---------- Qué llamadas piden cierre ---------- */

type DeLlamada = Pick<Sesion, "estado" | "estadoLlamada" | "estadoPreCall" | "resultado" | "inicia">;

/** Si una llamada de venta tiene que quedar cargada ese día: ya empezó y no
 *  se canceló. Sin estado cargado, tampoco pide cierre si fue «no vino» (lo
 *  avisa Calendly y se pone solo) ni si pidió otra fecha («Reagendar»), ni las
 *  del cierre de antes de que los estados fueran uno solo (`resultado`). Si el
 *  closer la cargó (aunque sea «Dejó de Contestar», que también la deja como
 *  que no vino), cuenta: lo que importa es cuándo la cargó. */
export function pideCierre(s: DeLlamada, hoy: string): boolean {
  if (s.estado === "cancelada") return false;
  if (!s.estadoLlamada && (s.estado === "no-show" || esReagendar(s.estadoPreCall) || s.resultado)) return false;
  return diaDeNegocio(s.inicia) <= hoy;
}

/** Cómo quedó una llamada que pide cierre: se cargó otro día que el suyo
 *  («tarde»), todavía no se cargó y su día ya pasó («sin-cargar»), o está
 *  bien. Manda la marca de la primera vez que se cargó: aunque después se
 *  cambie el estado, se vacíe o se borre la opción, la llamada ya se cargó
 *  ese día (o tarde). Un estado cargado sin marca (los de antes de esto) no
 *  se puede juzgar: cuenta como a tiempo.
 *  Sin estado pero con la venta cargada (la cargó alguien que no edita las
 *  llamadas, como Administración), la llamada figura como «Con cierre» en el
 *  CRM: cuenta cuando se cargó la venta (`ventaEn`). */
export function atrasoDe(
  s: Pick<Sesion, "estadoLlamada" | "estadoLlamadaEn">, diaDeLlamada: string, hoy: string, ventaEn?: string,
): "tarde" | "sin-cargar" | null {
  if (s.estadoLlamadaEn) {
    const cargada = diaDeNegocio(s.estadoLlamadaEn);
    return cargada && cargada > diaDeLlamada ? "tarde" : null;
  }
  if (!s.estadoLlamada) {
    if (ventaEn) return diaDeNegocio(ventaEn) > diaDeLlamada ? "tarde" : null;
    return diaDeLlamada < hoy ? "sin-cargar" : null;
  }
  return null;
}

/* ---------- Los días de cada closer ---------- */

export interface DiaDeCierre {
  dia: string;
  /* Las llamadas de ese día que piden cierre. */
  llamadas: number;
  /* Las que se cargaron otro día. */
  tarde: number;
  /* Las que todavía no se cargaron, con su día ya pasado. */
  sinCargar: number;
}

/** Un día con strike: alguna llamada se cargó tarde o no se cargó. */
export const conStrike = (d: Pick<DiaDeCierre, "tarde" | "sinCargar">) => d.tarde + d.sinCargar > 0;

const llamadas = (n: number) => `${n} ${n === 1 ? "llamada" : "llamadas"}`;

/** Qué falló ese día, dicho: «1 llamada cargada después y 2 llamadas sin cargar». */
export function queFalloEnElDia(d: Pick<DiaDeCierre, "tarde" | "sinCargar">): string {
  const partes: string[] = [];
  if (d.tarde) partes.push(`${llamadas(d.tarde)} ${d.tarde === 1 ? "cargada" : "cargadas"} después`);
  if (d.sinCargar) partes.push(`${llamadas(d.sinCargar)} sin cargar`);
  return partes.join(" y ");
}

type Base = Pick<EstadoApp, "sesiones" | "equipo" | "ajustes"> & Partial<Pick<EstadoApp, "ventas">>;

interface Indice {
  /* Closer (su nombre en Equipo o, si no está, el del anfitrión) → día → cómo quedó. */
  porCloser: Map<string, Map<string, DiaDeCierre>>;
  /* La clave del closer de una llamada. */
  closerDe: (s: Pick<Sesion, "anfitrion">) => string;
}

const INDICES = new WeakMap<Sesion[], { equipo: unknown; crm: unknown; ventas: unknown; hoy: string; desde: string; indice: Indice }>();

/** El closer de una llamada, como lo nombra el cierre del día: el miembro de
 *  Equipo que es el anfitrión de Calendly o, si no está, el anfitrión. */
function claveDeCloser(equipo: EstadoApp["equipo"]): Indice["closerDe"] {
  const memo = new Map<string, string>();
  return (s) => {
    const a = (s.anfitrion ?? "").trim();
    if (!a) return "";
    let k = memo.get(a);
    if (k === undefined) { k = miembroDeCloser(a, equipo)?.nombre ?? a; memo.set(a, k); }
    return k;
  };
}

function indiceDe(e: Base, hoy: string, desde: string): Indice {
  const guardado = INDICES.get(e.sesiones);
  if (guardado && guardado.equipo === e.equipo && guardado.crm === e.ajustes.crm && guardado.ventas === e.ventas && guardado.hoy === hoy && guardado.desde === desde) return guardado.indice;
  const closerDe = claveDeCloser(e.equipo);
  const tablas = tablasDe(e.ajustes);
  /* Cuándo se cargó la venta de cada llamada (la primera, si hay más de una). */
  const ventaEn = new Map<string, string>();
  for (const v of e.ventas ?? []) {
    if (!v.sesionId || v.estado === "cancelada") continue;
    const ya = ventaEn.get(v.sesionId);
    if (!ya || v.creadoEn < ya) ventaEn.set(v.sesionId, v.creadoEn);
  }
  const porCloser = new Map<string, Map<string, DiaDeCierre>>();
  for (const s of e.sesiones) {
    const d = diaDeNegocio(s.inicia);
    if (!d || d < desde || d > hoy) continue;
    if (!pideCierre(s, hoy) || !tablas.some((t) => entraEnTabla(s, t))) continue;
    const closer = closerDe(s);
    if (!closer) continue;
    let dias = porCloser.get(closer);
    if (!dias) { dias = new Map(); porCloser.set(closer, dias); }
    let x = dias.get(d);
    if (!x) { x = { dia: d, llamadas: 0, tarde: 0, sinCargar: 0 }; dias.set(d, x); }
    x.llamadas++;
    const a = atrasoDe(s, d, hoy, ventaEn.get(s.id));
    if (a === "tarde") x.tarde++;
    else if (a === "sin-cargar") x.sinCargar++;
  }
  const indice = { porCloser, closerDe };
  INDICES.set(e.sesiones, { equipo: e.equipo, crm: e.ajustes.crm, ventas: e.ventas, hoy, desde, indice });
  return indice;
}

export interface StrikesDeCloser {
  /* Desde cuándo se cuentan; undefined si todavía no se eligió la fecha. */
  cuentaDesde?: string;
  /* Los días con strike, del más nuevo al más viejo. */
  dias: DiaDeCierre[];
  /* Cuántos días con strike. */
  total: number;
  /* Los días desde esa fecha, con y sin strike. */
  diasContados: number;
}

/** Los strikes de un closer (por el nombre con el que lo nombra el cierre del
 *  día): se cuentan aunque el interruptor del descuento esté apagado. */
export function strikesDe(e: Base, closer: string, hoy: string = hoyDeNegocio()): StrikesDeCloser {
  const { cuentaDesde } = reglaDeCierre(e.ajustes);
  if (!cuentaDesde || !closer) return { cuentaDesde, dias: [], total: 0, diasContados: 0 };
  const dias = [...(indiceDe(e, hoy, cuentaDesde).porCloser.get(closer)?.values() ?? [])].sort((a, b) => b.dia.localeCompare(a.dia));
  const conPeso = dias.filter(conStrike);
  return { cuentaDesde, dias: conPeso, total: conPeso.length, diasContados: dias.length };
}

/* ---------- El descuento ---------- */

const SIN_VENTAS: ReadonlySet<ID> = new Set<ID>();
const VENTAS = new WeakMap<Venta[], { sesiones: unknown; equipo: unknown; crm: unknown; hoy: string; ids: ReadonlySet<ID> }>();

/** Las ventas cuya comisión de closer no se paga porque salieron de una llamada
 *  de un día sin cierre cargado ese mismo día. Vacío si el interruptor está
 *  apagado: así Finanzas, la liquidación y el webinar no pueden cambiar en nada
 *  hasta que se prenda. */
export function ventasSinCierre(e: Pick<EstadoApp, "sesiones" | "ventas" | "equipo" | "ajustes">, hoy: string = hoyDeNegocio()): ReadonlySet<ID> {
  const regla = reglaDeCierre(e.ajustes);
  const desde = descuentoDesde(regla);
  if (!desde || !regla.cuentaDesde) return SIN_VENTAS;
  const guardado = VENTAS.get(e.ventas);
  if (guardado && guardado.sesiones === e.sesiones && guardado.equipo === e.equipo && guardado.crm === e.ajustes.crm && guardado.hoy === hoy) return guardado.ids;
  const indice = indiceDe(e, hoy, regla.cuentaDesde);
  const sesionPorId = new Map(e.sesiones.map((s) => [s.id, s] as const));
  const ids = new Set<ID>();
  for (const v of e.ventas) {
    if (!v.sesionId || v.estado === "cancelada") continue;
    const s = sesionPorId.get(v.sesionId);
    if (!s) continue;
    const d = diaDeNegocio(s.inicia);
    if (d < desde) continue;
    const x = indice.porCloser.get(indice.closerDe(s))?.get(d);
    if (x && conStrike(x)) ids.add(v.id);
  }
  VENTAS.set(e.ventas, { sesiones: e.sesiones, equipo: e.equipo, crm: e.ajustes.crm, hoy, ids });
  return ids;
}

/** Si la comisión del closer de este cobro no se paga por el cierre del día.
 *  Sólo la de quien cerró la venta: lo que cobra el closer que heredó sus
 *  cuotas no se toca. `closerDelCobro` es el closer de la cuota. */
export const descuentaPorCierre = (sinCierre: ReadonlySet<ID>, v: Pick<Venta, "id" | "closerId">, closerDelCobro?: ID): boolean =>
  sinCierre.size > 0 && Boolean(closerDelCobro) && closerDelCobro === v.closerId && sinCierre.has(v.id);

/** Los días con strike de una venta (el de su llamada): para decir por qué
 *  no comisiona. undefined si no es de un día con strike. */
export function diaSinCierreDe(e: Base, v: Pick<Venta, "sesionId">, hoy: string = hoyDeNegocio()): string | undefined {
  const { cuentaDesde } = reglaDeCierre(e.ajustes);
  if (!cuentaDesde || !v.sesionId) return undefined;
  const s = e.sesiones.find((x) => x.id === v.sesionId);
  if (!s) return undefined;
  const d = diaDeNegocio(s.inicia);
  const indice = indiceDe(e, hoy, cuentaDesde);
  const x = indice.porCloser.get(indice.closerDe(s))?.get(d);
  return x && conStrike(x) ? d : undefined;
}
