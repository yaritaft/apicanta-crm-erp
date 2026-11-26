import test from "node:test";
import assert from "node:assert/strict";
import { arqueoVivo } from "@/lib/arqueo";
import { cuentaEnLaCajaDeHoy } from "@/lib/caja";
import { efectoEnCaja, hayQueAvisarDeCaja } from "@/lib/efecto-en-caja";
import { saldosEsperados } from "@/lib/traspasos";
import type { Arqueo, EstadoApp, Gasto } from "@/lib/types";
import { estadoDeYari } from "./estado-devolucion";

/* ==================================================================
   Aldana (25/11): «tengo que cargar estos movimientos viejos que van a
   modificar el saldo de la Financiera, ¿eso cómo impactaría en el cierre
   de caja?». Eran retiros de junio a septiembre; el primer cierre de caja
   es del 7/10.

   La app cuenta cada cierre desde lo que se contó en el anterior: un pago
   anterior al primer cierre no mueve nada de la caja; uno entre dos cierres
   mueve sólo ESE cierre; uno posterior al último, el saldo de hoy.
   ================================================================== */

const CUENTAS = [
  { id: "proc_fin_usd", nombre: "Financiera USD", feeRate: 0, activo: true, automatico: false },
  { id: "proc_fin_ars", nombre: "Financiera ARS", feeRate: 0, activo: true, automatico: false, moneda: "ARS" },
];
const arqueo = (id: string, fecha: string, usd: number, ars: number, extra: Partial<Arqueo> = {}): Arqueo => ({
  id, fecha, creadoEn: fecha, tipoCambio: 1500, total: usd + ars / 1500,
  saldos: [
    { procesadorId: "proc_fin_usd", monto: usd, moneda: "USD", montoBase: usd },
    { procesadorId: "proc_fin_ars", monto: ars, moneda: "ARS", montoBase: ars / 1500 },
  ],
  ...extra,
} as Arqueo);

/* Tres cierres: 7/10 (el punto de partida), 8/11 y 22/11 (los fines de día de Argentina). Entre el 1.º y el 2.º salieron US$ 500 que nadie cargó. */
const PRIMERO = arqueo("a1", "2026-10-08T02:59:59.999Z", 10000, 3000000);
const SEGUNDO = arqueo("a2", "2026-11-09T02:59:59.999Z", 9500, 3000000, { esperado: 12000, diferencia: -500 });
const TERCERO = arqueo("a3", "2026-11-23T02:59:59.999Z", 9500, 3000000, { esperado: 11500, diferencia: 0 });

const gasto = (id: string, fecha: string, monto: number, extra: Partial<Gasto> = {}): Gasto => ({
  id, fecha, monto, concepto: `Retiro ${id}`, categoria: "Honorarios del CEO", grupo: "dueno", moneda: "USD", creadoEn: fecha,
  extra: { cuenta: "Financiera USD" }, ...extra,
} as Gasto);
const enPesos = (id: string, fecha: string, pesos: number): Gasto =>
  gasto(id, fecha, pesos / 1500, { extra: { cuenta: "Financiera ARS", monedaOriginal: "ARS", montoOriginal: pesos, tipoCambio: 1500 } });

const estado = (gastos: Gasto[] = [], arqueos: Arqueo[] = [PRIMERO, SEGUNDO, TERCERO]): EstadoApp =>
  estadoDeYari({ arqueos, gastos, pagos: [], ventas: [], cuotas: [], procesadores: CUENTAS } as unknown as Partial<EstadoApp>);

const dif = (e: EstadoApp, a: Arqueo) => arqueoVivo(e, a).diferencia;

test("el punto de partida: el cierre del 8/11 marca −500 (salió plata que nadie cargó) y el del 22/11, 0", () => {
  const e = estado();
  assert.equal(dif(e, SEGUNDO), -500);
  assert.equal(dif(e, TERCERO), 0);
});

test("el caso de Aldana: 8 retiros de junio a septiembre de la Financiera en pesos no cambian ningún cierre ni el saldo de hoy", () => {
  const e = estado();
  const retiros = [
    enPesos("r1", "2026-08-27T15:00:00.000Z", 3000000), enPesos("r2", "2026-09-09T15:00:00.000Z", 2000000), enPesos("r3", "2026-09-09T15:00:00.000Z", 1500000),
    enPesos("r4", "2026-09-08T15:00:00.000Z", 800000), enPesos("r5", "2026-09-07T15:00:00.000Z", 70000), enPesos("r6", "2026-07-14T15:00:00.000Z", 100000),
    enPesos("r7", "2026-07-01T15:00:00.000Z", 100000), enPesos("r8", "2026-06-02T15:00:00.000Z", 200000),
  ];
  const x = efectoEnCaja(e, retiros);
  assert.equal(x.antesDelPrimero, 8);
  assert.equal(x.entreCierres, 0);
  assert.equal(x.hoy, 0);
  assert.deepEqual(x.cierres, []);
  assert.equal(hayQueAvisarDeCaja(x), true, "se dice, para que no haya que preguntarlo");
  /* Y es verdad: con los retiros cargados, cada cierre y el saldo esperado de hoy dan lo mismo. */
  const con = estado(retiros);
  assert.equal(dif(con, SEGUNDO), -500);
  assert.equal(dif(con, TERCERO), 0);
  const hoy = "2026-11-26T15:00:00.000Z";
  assert.equal(saldosEsperados(con, TERCERO, hoy).get("proc_fin_ars")!.esperado, saldosEsperados(e, TERCERO, hoy).get("proc_fin_ars")!.esperado);
  for (const r of retiros) assert.equal(cuentaEnLaCajaDeHoy(con, r.fecha).cuenta, false);
});

test("un pago entre dos cierres ya hechos cambia la diferencia de ESE cierre y de ningún otro", () => {
  const e = estado();
  /* Los US$ 500 que faltaban: se pagaron el 20/10. */
  const g = gasto("g1", "2026-10-20T15:00:00.000Z", 500);
  const x = efectoEnCaja(e, [g]);
  assert.equal(x.entreCierres, 1);
  assert.equal(x.cierres.length, 1);
  assert.equal(x.cierres[0].arqueo.id, "a2");
  assert.equal(x.cierres[0].antes, -500);
  assert.equal(x.cierres[0].despues, 0);
  /* Lo que dice es lo que pasa al cargarlo. */
  const con = estado([g]);
  assert.equal(dif(con, SEGUNDO), 0);
  assert.equal(dif(con, TERCERO), 0, "el cierre siguiente parte de lo contado en el del 8/11: no se entera");
});

test("el borde: un pago del mismo instante del cierre entra en ese cierre; un milisegundo después, en el que sigue", () => {
  const e = estado();
  assert.equal(efectoEnCaja(e, [gasto("j", SEGUNDO.fecha, 100)]).cierres[0].arqueo.id, "a2");
  assert.equal(efectoEnCaja(e, [gasto("k", "2026-11-09T03:00:00.000Z", 100)]).cierres[0].arqueo.id, "a3");
  /* El instante del primer cierre es «antes»: no hay cierre anterior del que partir. */
  assert.equal(efectoEnCaja(e, [gasto("l", PRIMERO.fecha, 100)]).antesDelPrimero, 1);
});

test("un pago posterior al último cierre es lo de todos los días: no avisa nada", () => {
  const x = efectoEnCaja(estado(), [gasto("h", "2026-11-25T15:00:00.000Z", 100)]);
  assert.equal(x.hoy, 1);
  assert.deepEqual(x.cierres, []);
  assert.equal(hayQueAvisarDeCaja(x), false);
});

test("sin ningún cierre de caja todavía, no hay nada que avisar", () => {
  const x = efectoEnCaja(estado([], []), [gasto("h", "2026-06-02T15:00:00.000Z", 100)]);
  assert.equal(x.sinCierres, true);
  assert.equal(hayQueAvisarDeCaja(x), false);
});

test("corregir la fecha de un gasto ya cargado mueve el cierre del que sale y el cierre al que entra", () => {
  const viejo = gasto("g1", "2026-10-20T15:00:00.000Z", 500);
  const e = estado([viejo]);
  assert.equal(dif(e, SEGUNDO), 0);
  const x = efectoEnCaja(e, [{ ...viejo, fecha: "2026-11-15T15:00:00.000Z" }], ["g1"]);
  assert.deepEqual(x.cierres.map((c) => [c.arqueo.id, c.antes, c.despues]), [["a2", 0, -500], ["a3", 0, 500]]);
});

test("corregir sólo el concepto de un gasto viejo no cambia nada, y no dice que cambia", () => {
  const viejo = gasto("g1", "2026-10-20T15:00:00.000Z", 500);
  const x = efectoEnCaja(estado([viejo]), [{ ...viejo, concepto: "Otro nombre" }], ["g1"]);
  assert.deepEqual(x.cierres, []);
  assert.equal(x.entreCierres, 1);
});

test("varios juntos: cada uno cae donde le toca y cada cierre se recalcula una sola vez con todos", () => {
  const e = estado();
  const x = efectoEnCaja(e, [
    gasto("a", "2026-07-01T15:00:00.000Z", 100), gasto("b", "2026-10-20T15:00:00.000Z", 300), gasto("c", "2026-10-25T15:00:00.000Z", 200),
    gasto("d", "2026-11-25T15:00:00.000Z", 50),
  ]);
  assert.deepEqual([x.antesDelPrimero, x.entreCierres, x.hoy], [1, 2, 1]);
  assert.deepEqual(x.cierres.map((c) => [c.arqueo.id, c.antes, c.despues]), [["a2", -500, 0]]);
});

test("lo que no es un pago (el cierre de una liquidación) no mueve la caja aunque tenga fecha vieja", () => {
  const x = efectoEnCaja(estado(), [gasto("liq", "2026-10-20T15:00:00.000Z", 500, { extra: { liquidacionId: "liq_2026-10" } })]);
  assert.equal(x.sinPago, 1);
  assert.equal(x.entreCierres, 0);
  assert.deepEqual(x.cierres, []);
});

test("con fecha de pago aparte, manda el día que se pagó y no el mes al que corresponde", () => {
  /* Corresponde a septiembre, pero se pagó el 20/10: sale de la caja en el cierre del 8/11. */
  const g = gasto("g", "2026-09-30T15:00:00.000Z", 500, { fechaPago: "2026-10-20T15:00:00.000Z" } as Partial<Gasto>);
  const x = efectoEnCaja(estado(), [g]);
  assert.equal(x.antesDelPrimero, 0);
  assert.equal(x.cierres[0]?.arqueo.id, "a2");
});
