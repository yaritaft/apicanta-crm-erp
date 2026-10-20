import type { EstadoApp, ID, Moneda } from "./types";
import { ultimoArqueo } from "./caja";
import { gastosSinCuenta, saldosEsperados } from "./traspasos";
import { money } from "./format";

/* ==================================================================
   El saldo REAL de las cuentas que se pueden leer solas, y si da con lo
   que la app esperaba.

   Aldana (20/10): el saldo de USDT Trust se puede saber exacto (es público
   en la red), así que contarlo a mano en la planilla es de más (y ya venía
   9 dólares abajo). Con el saldo real de cada cuenta que se puede leer
   (USDT Trust por la red, Mercury y Stripe por sus API), la app lo compara
   con lo que esperaba (lo del último arqueo más lo cobrado, los pases y lo
   pagado desde esa cuenta): si no da, falta cargar algo, y lo dice.

   Sin React ni red: las mismas reglas las usan el servidor, la pantalla y
   las pruebas. Leer cada cuenta está en lib/pasarelas-api.ts.
   ================================================================== */

export interface SaldoReal {
  cuentaId: ID;
  saldo: number;
  moneda: Moneda;
  /* El momento al que corresponde (ISO). */
  al: string;
  /* De dónde sale: «la red de USDT», «Mercury», «Stripe». */
  fuente: string;
  /* Algo que aclarar: lo que está pendiente o en camino. */
  nota?: string;
}

export interface ErrorDeSaldo { cuentaId: ID; mensaje: string }

export interface RespuestaDeSaldos {
  saldos: SaldoReal[];
  errores: ErrorDeSaldo[];
  /* Cuentas que se podrían leer pero hoy no están conectadas (falta la clave). */
  sinConexion: ID[];
  /* Cuentas que no se pueden leer para ese momento (sólo se sabe el saldo de ahora). */
  soloHoy: ID[];
}

/** Las cuentas cuyo saldo se lee solo, y cómo se llama la fuente. Las demás (la Financiera, Galicia, el efectivo) se cuentan a mano. */
export const FUENTES_DE_SALDO: Readonly<Record<ID, string>> = {
  proc_trust: "la red de USDT",
  proc_mercury: "el banco (Mercury)",
  proc_stripe: "Stripe",
};

/* ---------- El saldo de una billetera en un momento ---------- */

export interface Transferencia {
  /* Billeteras de origen y de destino. */
  de: string;
  a: string;
  /* En millonésimas (USDT tiene 6 decimales): enteros, sin errores de coma. */
  micro: number;
  /* Cuándo se confirmó (milisegundos). */
  ts: number;
}

/** El saldo de la billetera en `alMs` (null: ahora), a partir de lo que tiene hoy y de lo que se movió después de ese momento. */
export function saldoDeBilleteraEn(actualMicro: number, despues: readonly Transferencia[], billetera: string, alMs: number | null): number {
  let micro = actualMicro;
  if (alMs !== null) {
    for (const t of despues) {
      if (t.ts <= alMs) continue;
      if (t.a === billetera) micro -= t.micro;
      if (t.de === billetera) micro += t.micro;
    }
  }
  return Math.round(micro / 1e4) / 100;
}

/* ---------- ¿Da con lo que la app esperaba? ---------- */

/* Menos que esto de diferencia es lo mismo (centavos, redondeos). */
export const TOLERANCIA_DE_SALDO = 1;

export type Lectura = "da" | "sobra" | "falta" | "sin-punto-de-partida";

export interface FilaDeControl {
  cuentaId: ID;
  nombre: string;
  moneda: Moneda;
  real: number;
  esperado?: number;
  /* Lo que hay menos lo que la app esperaba. */
  diferencia?: number;
  lectura: Lectura;
  al: string;
  fuente: string;
  nota?: string;
}

export interface ControlDeSaldos {
  filas: FilaDeControl[];
  /* Alguna cuenta no da: falta cargar algo. */
  hayAlarma: boolean;
  /* Gastos pagados desde el último arqueo que no dicen de qué cuenta salieron (el control no los puede descontar de ninguna). */
  sinCuenta: { n: number; total: number };
  /* El arqueo del que se parte. */
  desde?: string;
}

export function controlarSaldos(e: EstadoApp, reales: readonly SaldoReal[], ahoraIso: string): ControlDeSaldos {
  const previo = ultimoArqueo(e, ahoraIso);
  const esperados = saldosEsperados(e, previo, ahoraIso);
  const filas: FilaDeControl[] = reales.map((r) => {
    const p = e.procesadores.find((x) => x.id === r.cuentaId);
    const esperado = esperados.get(r.cuentaId)?.esperado;
    const dif = esperado === undefined ? undefined : Math.round((r.saldo - esperado) * 100) / 100;
    const lectura: Lectura = dif === undefined ? "sin-punto-de-partida" : Math.abs(dif) < TOLERANCIA_DE_SALDO ? "da" : dif > 0 ? "sobra" : "falta";
    return {
      cuentaId: r.cuentaId, nombre: p?.nombre ?? r.cuentaId, moneda: r.moneda, real: r.saldo, esperado, diferencia: dif,
      lectura, al: r.al, fuente: r.fuente, nota: r.nota,
    };
  });
  return {
    filas,
    hayAlarma: filas.some((f) => f.lectura === "sobra" || f.lectura === "falta"),
    sinCuenta: previo ? gastosSinCuenta(e, previo.fecha, ahoraIso) : { n: 0, total: 0 },
    desde: previo?.fecha,
  };
}

/** Lo que significa una diferencia, en una frase para quien carga las cosas. */
export function quePasa(f: Pick<FilaDeControl, "lectura" | "diferencia" | "moneda" | "nombre">): string {
  if (f.lectura === "da") return "Da con lo que la app esperaba.";
  if (f.lectura === "sin-punto-de-partida") return "Todavía no hay un arqueo de esta cuenta: con uno, la app compara.";
  const cuanto = money(Math.abs(f.diferencia ?? 0), f.moneda);
  return f.lectura === "falta"
    ? `Hay ${cuanto} menos de lo que la app esperaba: falta cargar un gasto, un retiro o un movimiento entre cuentas que salió de ${f.nombre}.`
    : `Hay ${cuanto} más de lo que la app esperaba: falta cargar un cobro o un movimiento entre cuentas que llegó a ${f.nombre}.`;
}
