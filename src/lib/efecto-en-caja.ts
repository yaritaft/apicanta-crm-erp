import type { Arqueo, EstadoApp, Gasto, ID } from "./types";
import { arqueoVivo } from "./arqueo";
import { fechaDePago } from "./gastos";

/* ==================================================================
   Qué le hace a la caja cargar (o corregir) un gasto con una fecha vieja.

   Aldana (25/11): «tengo que cargar estos movimientos viejos que van a
   modificar el saldo de la Financiera, ¿eso cómo impactaría en el cierre de
   caja?». La respuesta dependía de saber cómo cuenta la app, y nadie tendría
   que saberlo de memoria: ahora lo dice el formulario antes de guardar.

   Cómo cuenta: cada cierre de caja (arqueo) parte de lo que se CONTÓ en el
   anterior y le suma lo que pasó entre los dos. Entonces un pago:

     · posterior al último cierre  → baja lo que la app espera hoy en esa
       cuenta y entra en el próximo cierre (lo de todos los días);
     · entre dos cierres ya hechos → no toca el saldo de hoy; cambia la
       diferencia de ESE cierre (el que cubre ese día), y sólo de ése;
     · anterior al primer cierre   → no cambia ningún cierre ni el saldo de
       hoy: lo que se contó ese primer día ya venía sin esa plata. Sólo se
       mueve el estado de resultados de su mes.

   La diferencia de un cierre no se adivina: se calcula con la misma cuenta
   del arqueo (arqueoVivo), con y sin lo que se está por cargar.

   Sin React ni red.
   ================================================================== */

export interface CierreQueCambia {
  arqueo: Arqueo;
  /* La diferencia de ese cierre hoy y cómo queda. */
  antes: number;
  despues: number;
}

export interface EfectoEnCaja {
  /* Todavía no hay ningún cierre de caja: todo cuenta desde el principio. */
  sinCierres: boolean;
  primero?: Arqueo;
  ultimo?: Arqueo;
  /* De lo que se carga, cuántos pagos caen en cada lugar. */
  hoy: number;
  entreCierres: number;
  antesDelPrimero: number;
  /* Los que no son un pago (el cierre de una liquidación): no mueven la caja. */
  sinPago: number;
  /* Los cierres ya hechos cuya diferencia cambia. */
  cierres: CierreQueCambia[];
}

const esPago = (g: Pick<Gasto, "extra">) => !g.extra?.liquidacionId && !g.extra?.traspasoId;

/**
 * Lo que cambia en la caja si se cargan `nuevos` y dejan de estar `sacar` (al corregir un gasto, su versión de antes).
 * Sólo recalcula los cierres que cubren alguno de esos días.
 */
export function efectoEnCaja(e: EstadoApp, nuevos: readonly Gasto[], sacar: readonly ID[] = []): EfectoEnCaja {
  const arqueos = [...(e.arqueos ?? [])].sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha));
  const out: EfectoEnCaja = { sinCierres: arqueos.length === 0, primero: arqueos[0], ultimo: arqueos[arqueos.length - 1], hoy: 0, entreCierres: 0, antesDelPrimero: 0, sinPago: 0, cierres: [] };
  if (arqueos.length === 0) { out.hoy = nuevos.filter(esPago).length; out.sinPago = nuevos.length - out.hoy; return out; }

  /* El cierre que cubre un instante: el primero contado ese día o después (la ventana es «después del anterior, hasta éste inclusive»). */
  const cierreDe = (iso: string): { tipo: "hoy" | "antes" | "entre"; k: number } => {
    const t = Date.parse(iso);
    if (t > Date.parse(arqueos[arqueos.length - 1].fecha)) return { tipo: "hoy", k: -1 };
    if (t <= Date.parse(arqueos[0].fecha)) return { tipo: "antes", k: -1 };
    return { tipo: "entre", k: arqueos.findIndex((a) => Date.parse(a.fecha) >= t) };
  };

  const tocados = new Set<number>();
  for (const g of nuevos) {
    if (!esPago(g)) { out.sinPago++; continue; }
    const c = cierreDe(fechaDePago(g));
    if (c.tipo === "hoy") out.hoy++;
    else if (c.tipo === "antes") out.antesDelPrimero++;
    else { out.entreCierres++; tocados.add(c.k); }
  }
  /* Lo que se saca (la versión de antes de un gasto que se corrige) también mueve el cierre donde estaba. */
  const fuera = new Set(sacar);
  for (const g of e.gastos) {
    if (!fuera.has(g.id) || !esPago(g)) continue;
    const c = cierreDe(fechaDePago(g));
    if (c.tipo === "entre") tocados.add(c.k);
  }
  if (tocados.size === 0) return out;

  const ids = new Set(nuevos.map((g) => g.id));
  const despues: EstadoApp = { ...e, gastos: [...e.gastos.filter((g) => !fuera.has(g.id) && !ids.has(g.id)), ...nuevos] };
  for (const k of [...tocados].sort((a, b) => a - b)) {
    const a = arqueos[k];
    const x = arqueoVivo(e, a).diferencia, y = arqueoVivo(despues, a).diferencia;
    if (x === null || y === null || Math.abs(x - y) < 0.005) continue;
    out.cierres.push({ arqueo: a, antes: x, despues: y });
  }
  return out;
}

/** Si hay algo para avisar: lo de todos los días (un pago posterior al último cierre) no necesita aviso. */
export const hayQueAvisarDeCaja = (x: EfectoEnCaja): boolean => !x.sinCierres && (x.entreCierres > 0 || x.antesDelPrimero > 0 || x.cierres.length > 0);

/* ---------- «Que salga de la caja hoy» ---------- */

/** Si el día en que un gasto sale de la caja es anterior (o igual) al último cierre: la caja de hoy no lo ve. Sin cierres, ninguno. */
export function esAnteriorAlUltimoCierre(e: Pick<EstadoApp, "arqueos">, g: Pick<Gasto, "fecha" | "extra"> & Partial<Pick<Gasto, "fechaPago">>): boolean {
  let ultimo = -Infinity;
  for (const a of e.arqueos ?? []) ultimo = Math.max(ultimo, Date.parse(a.fecha));
  return Number.isFinite(ultimo) && esPago(g) && Date.parse(fechaDePago(g as Gasto)) <= ultimo;
}

/**
 * Los gastos con lo viejo regularizado: los que salían de la caja antes del último cierre conservan su fecha (el mes en que restan del
 * estado de resultados) y pasan a salir de la caja `hoy`. Lo demás queda igual. Es lo que hace falta cuando la plata salió hace meses,
 * nunca se cargó y el saldo que se venía contando no la tenía descontada (Aldana, 26/11).
 */
export function conLoViejoHoy<G extends Pick<Gasto, "fecha" | "extra"> & Partial<Pick<Gasto, "fechaPago">>>(e: Pick<EstadoApp, "arqueos">, gastos: readonly G[], hoy: string): G[] {
  return gastos.map((g) => (esAnteriorAlUltimoCierre(e, g) ? { ...g, fechaPago: hoy } : g));
}
