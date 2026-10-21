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
  /* Lo que el banco todavía no asentó (sólo Mercury): explica una diferencia con lo que la app esperaba. */
  pendientes?: PendientesDeBanco;
}

/* El saldo real es lo que el banco ya asentó. La app, en cambio, descuenta un gasto el día que se carga: si el banco todavía no lo
   debitó (una transferencia pending, un gasto con la tarjeta que baja el saldo recién cuando se paga), el saldo real queda por encima de
   lo esperado sin que falte cargar nada. Acá viaja lo que el banco tiene en camino para poder decirlo. Montos en positivo. */
export interface PendientesDeBanco {
  /* Salidas de plata (monto negativo) que el banco todavía no debitó, y cuántos movimientos son. */
  salidas: number;
  nSalidas: number;
  /* Entradas que todavía no acreditó. */
  entradas: number;
  nEntradas: number;
  /* Lo que se debe de la tarjeta de crédito: lo gastado con ella baja el saldo del banco recién cuando se paga. */
  tarjeta?: number;
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

/* «da-con-pendientes»: no es igual a lo esperado, pero la diferencia es justo lo que el banco todavía no asentó: no falta cargar nada. */
export type Lectura = "da" | "da-con-pendientes" | "sobra" | "falta" | "sin-punto-de-partida";

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
  /* Lo que el banco tiene en camino (sea o no lo que explica la diferencia). */
  pendientes?: PendientesDeBanco;
  /* Sólo con «da-con-pendientes»: qué parte de lo que está en camino explica la diferencia. */
  explicadoPor?: ExplicadoPorPendientes;
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
    let lectura: Lectura = dif === undefined ? "sin-punto-de-partida" : Math.abs(dif) < TOLERANCIA_DE_SALDO ? "da" : dif > 0 ? "sobra" : "falta";
    /* Si no da pero la diferencia es lo que el banco todavía no asentó, no es una alarma: es plata en camino. */
    const explicadoPor = (lectura === "sobra" || lectura === "falta") && dif !== undefined ? explicarConPendientes(dif, r.pendientes) : null;
    if (explicadoPor) lectura = "da-con-pendientes";
    return {
      cuentaId: r.cuentaId, nombre: p?.nombre ?? r.cuentaId, moneda: r.moneda, real: r.saldo, esperado, diferencia: dif,
      lectura, al: r.al, fuente: r.fuente, nota: r.nota,
      ...(r.pendientes ? { pendientes: r.pendientes } : {}),
      ...(explicadoPor ? { explicadoPor } : {}),
    };
  });
  return {
    filas,
    hayAlarma: filas.some((f) => f.lectura === "sobra" || f.lectura === "falta"),
    sinCuenta: previo ? gastosSinCuenta(e, previo.fecha, ahoraIso) : { n: 0, total: 0 },
    desde: previo?.fecha,
  };
}

/* ---------- ¿Lo que el banco tiene en camino explica la diferencia? ---------- */

export interface ExplicadoPorPendientes {
  /* Lo que el banco todavía no debitó (salidas pendientes y tarjeta) y lo que todavía no acreditó. */
  porDebitar: number;
  porAcreditar: number;
  /* Cuánto de lo por debitar son salidas pendientes y cuánto la tarjeta; y cuántas salidas son. */
  salidas: number;
  nSalidas: number;
  tarjeta: number;
  entradas: number;
  nEntradas: number;
}

/** Si `diferencia` (lo que hay menos lo que la app esperaba) es justo lo que el banco tiene en camino (±TOLERANCIA_DE_SALDO), qué parte de eso es.
    Una salida pendiente o lo gastado con la tarjeta que todavía no se pagó hacen que sobre; una entrada pendiente (que la app ya contó), que falte.
    Se prueba con lo menos posible (una sola cosa antes que dos) para no explicar de más. */
export function explicarConPendientes(diferencia: number, p: PendientesDeBanco | undefined): ExplicadoPorPendientes | null {
  if (!p) return null;
  const partes = [
    { clave: "salidas" as const, valor: p.salidas, signo: 1 },
    { clave: "tarjeta" as const, valor: p.tarjeta ?? 0, signo: 1 },
    { clave: "entradas" as const, valor: p.entradas, signo: -1 },
  ].filter((x) => x.valor >= 0.005);
  const combinaciones: (typeof partes)[] = [];
  for (let mascara = 1; mascara < 1 << partes.length; mascara++) combinaciones.push(partes.filter((_, i) => mascara & (1 << i)));
  combinaciones.sort((a, b) => a.length - b.length);
  for (const c of combinaciones) {
    if (Math.abs(diferencia - c.reduce((a, x) => a + x.signo * x.valor, 0)) >= TOLERANCIA_DE_SALDO) continue;
    const de = (clave: "salidas" | "tarjeta" | "entradas") => c.find((x) => x.clave === clave)?.valor ?? 0;
    const salidas = de("salidas"), tarjeta = de("tarjeta"), entradas = de("entradas");
    return {
      porDebitar: Math.round((salidas + tarjeta) * 100) / 100, porAcreditar: entradas, salidas, tarjeta, entradas,
      nSalidas: salidas ? p.nSalidas : 0, nEntradas: entradas ? p.nEntradas : 0,
    };
  }
  return null;
}

/** «US$ 3.339,00 todavía por debitar (US$ 1.267,00 de una salida que el banco no asentó y US$ 2.072,00 de la tarjeta…)», para decir por qué da. */
export function textoDeLoPendiente(x: ExplicadoPorPendientes, moneda: Moneda = "USD"): string {
  const M = (n: number) => money(n, moneda, 2);
  const debitar: { monto: number; que: string }[] = [];
  if (x.salidas) debitar.push({ monto: x.salidas, que: `${x.nSalidas === 1 ? "una salida" : x.nSalidas > 1 ? `${x.nSalidas} salidas` : "salidas"} que el banco todavía no asentó` });
  if (x.tarjeta) debitar.push({ monto: x.tarjeta, que: "lo gastado con la tarjeta de crédito, que baja el saldo recién cuando se paga" });
  const trozos: string[] = [];
  if (debitar.length) {
    /* Con una sola cosa no se repite el monto; con dos, cada una dice el suyo. */
    const detalle = debitar.length === 1 ? debitar[0].que : debitar.map((d) => `${M(d.monto)} de ${d.que}`).join(" y ");
    trozos.push(`${M(x.porDebitar)} todavía por debitar (${detalle})`);
  }
  if (x.porAcreditar) trozos.push(`${M(x.porAcreditar)} todavía por acreditarse (${x.nEntradas === 1 ? "un cobro" : x.nEntradas > 1 ? `${x.nEntradas} cobros` : "cobros"} que el banco no asentó)`);
  return trozos.join(" y ");
}

/* ---------- Lo que se guarda en el arqueo ---------- */

export interface SaldoParaArqueo {
  /* Lo que va al casillero y se guarda. */
  monto: number;
  /* Lo que el banco marcaba. */
  delBanco: number;
  /* Lo que hay hoy menos lo que la app esperaba (si había con qué comparar). */
  diferencia?: number;
  /* Sólo si se corrigió: qué parte de lo que está en camino explicaba la diferencia, y la constancia para el arqueo. */
  ajuste?: ExplicadoPorPendientes;
  nota?: string;
}

/** El saldo que conviene guardar en el arqueo de una cuenta que se leyó sola.
    La app descuenta un gasto el día que se carga; el banco, cuando lo asienta. Si el arqueo guardara lo que el banco marca hoy, el
    «esperado» del arqueo siguiente arrancaría de ahí, y cuando el banco asiente lo que estaba en camino el control diría «faltan X» sin que falte
    nada. Por eso, si la diferencia es justo lo que está en camino (lo que la app ya había descontado o sumado), se guarda el saldo que va a
    quedar cuando el banco lo asiente: lo que marca menos lo por debitar, más lo por acreditar. Si la diferencia no se explica (o no hay con
    qué comparar), no se toca nada: restar lo que la app nunca descontó sería inventar plata. */
export function saldoParaElArqueo(real: SaldoReal, esperado: number | undefined): SaldoParaArqueo {
  const delBanco = real.saldo;
  if (esperado === undefined) return { monto: delBanco, delBanco };
  const diferencia = Math.round((delBanco - esperado) * 100) / 100;
  const explicado = Math.abs(diferencia) < TOLERANCIA_DE_SALDO ? null : explicarConPendientes(diferencia, real.pendientes);
  if (!explicado) return { monto: delBanco, delBanco, diferencia };
  const monto = Math.round((delBanco - explicado.porDebitar + explicado.porAcreditar) * 100) / 100;
  return {
    monto, delBanco, diferencia, ajuste: explicado,
    nota: `El banco marcaba ${money(delBanco, real.moneda, 2)}; se guardó ${money(monto, real.moneda, 2)} porque tiene ${textoDeLoPendiente(explicado, real.moneda)}.`,
  };
}

/** Lo que significa una diferencia, en una frase para quien carga las cosas. */
export function quePasa(f: Pick<FilaDeControl, "lectura" | "diferencia" | "moneda" | "nombre" | "explicadoPor">): string {
  if (f.lectura === "da") return "Da con lo que la app esperaba.";
  if (f.lectura === "da-con-pendientes") return f.explicadoPor ? `Da, con ${textoDeLoPendiente(f.explicadoPor, f.moneda)}.` : "Da con lo que la app esperaba.";
  if (f.lectura === "sin-punto-de-partida") return "Todavía no hay un arqueo de esta cuenta: con uno, la app compara.";
  const cuanto = money(Math.abs(f.diferencia ?? 0), f.moneda);
  return f.lectura === "falta"
    ? `Hay ${cuanto} menos de lo que la app esperaba: falta cargar un gasto, un retiro o un movimiento entre cuentas que salió de ${f.nombre}.`
    : `Hay ${cuanto} más de lo que la app esperaba: falta cargar un cobro o un movimiento entre cuentas que llegó a ${f.nombre}.`;
}
