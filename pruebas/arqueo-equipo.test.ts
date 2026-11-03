import test from "node:test";
import assert from "node:assert/strict";
import { cajaEsperada } from "@/lib/caja";
import { calcularPyL } from "@/lib/finanzas";
import { gastosSinCuenta, saldosEsperados } from "@/lib/traspasos";
import { saldosPorCuenta } from "@/lib/saldos-vista";
import { adivinarColumnas, armarFilas, parsearPegado } from "@/lib/gastos-masivos";
import type { Arqueo, EstadoApp, Gasto } from "@/lib/types";
import { estadoDeYari } from "./estado-devolucion";

/* ==================================================================
   Lo del equipo sale de la caja una sola vez: cuando se paga (Aldana, 03/11).

   «Hice el cierre al 31 y me da una diferencia de 30 mil, pero no me lo marcaba cuando fui completando los saldos: ¿puede ser porque está
   contemplando como que ya se pagó todo lo del equipo?». Sí: la Caja restaba las comisiones de closers y director el día del cobro y los
   gastos del cierre de la liquidación de octubre (US$ 23.398, con fecha del 31/10, cerrada el 03/11), aunque nadie los había pagado; y los
   pagos del 26–27/10, cargados desde Mercury, restaban otra vez. Cuenta por cuenta (lo que ella completa) sólo restan los pagos, así que
   el total no daba con la suma de las cuentas.
   ================================================================== */

const ARQUEO: Arqueo = {
  id: "a1", fecha: "2026-09-30T23:00:00.000Z", total: 10000, creadoEn: "2026-09-30T23:00:00.000Z",
  saldos: [{ procesadorId: "proc_stripe", monto: 10000, moneda: "USD", montoBase: 10000 }],
};
/* El fin del 31/10 en Argentina: el día del arqueo de Aldana. */
const AL_31 = "2026-11-01T02:59:59.999Z";

const gasto = (id: string, monto: number, fecha: string, extra: Record<string, unknown>, cambios: Partial<Gasto> = {}): Gasto => ({
  id, categoria: "Equipo / Salarios", grupo: "operativo", concepto: id, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha, extra, ...cambios,
});
/* Lo que se le pagó a Mariano desde Stripe el 10/10, marcado como pago de equipo. */
const PAGO = gasto("pago_mariano", 500, "2026-10-10T15:00:00.000Z", { cuentaId: "proc_stripe", pagoDeEquipo: true });
/* Lo que deja el cierre de la liquidación de octubre: el último día del mes, sin cuenta. */
const CIERRE = gasto("gas_liq_2026-10_equipo-salarios_usd", 2000, "2026-10-31T15:00:00.000Z", { liquidacionId: "liq_2026-10" });

const conEquipo = () => estadoDeYari({ arqueos: [ARQUEO], gastos: [PAGO, CIERRE] });

test("lo que se le debe al equipo no resta de la caja: ni las comisiones de cada cobro ni el cierre de la liquidación", () => {
  const mov = cajaEsperada(conEquipo(), ARQUEO, AL_31);
  assert.equal(mov.comisiones, 291, "Mariano (15%) y Santi (5%) de los 1.455 netos: se deben");
  assert.equal(mov.liquidacion, 2000, "el cierre de octubre: se debe");
  assert.equal(mov.equipo, 500, "lo que sí se le pagó a Mariano");
  assert.equal(mov.gastos, 0, "el pago de equipo no está también en los gastos");
  /* 10.000 + 1.500 cobrados − 45 de Stripe − 500 pagados. */
  assert.equal(mov.esperado, 10955);
});

test("el total da con la suma de las cuentas que completa Aldana: el pago resta en su cuenta y en el total, una vez", () => {
  const e = conEquipo();
  const stripe = saldosEsperados(e, ARQUEO, AL_31).get("proc_stripe")!;
  assert.equal(stripe.salio, 500);
  assert.equal(stripe.esperado, 10955);
  assert.equal(cajaEsperada(e, ARQUEO, AL_31).enCuentas, stripe.esperado, "el total y la cuenta dicen lo mismo");
  /* Lo mismo en la vista de Saldos: no queda nada que explicar. */
  const c = saldosPorCuenta(e, [], AL_31).contraLaCaja!;
  assert.equal(c.diferencia, 0);
  assert.equal(c.sinCuenta, 0, "el cierre de la liquidación no es un gasto sin cuenta: no es un pago");
});

test("el cierre de la liquidación tampoco cuenta como gasto pagado sin cuenta", () => {
  assert.deepEqual(gastosSinCuenta(conEquipo(), ARQUEO.fecha, AL_31), { n: 0, total: 0 });
  const otro = gasto("sin_cuenta", 80, "2026-10-12T15:00:00.000Z", {}, { categoria: "Software" });
  assert.deepEqual(gastosSinCuenta(estadoDeYari({ gastos: [CIERRE, otro] }), ARQUEO.fecha, AL_31), { n: 1, total: 80 });
});

test("el estado de resultados no cambia: cuenta el cierre de la liquidación y no el pago marcado (lo del equipo, una vez por cada lado)", () => {
  const oct = { clave: "2026-10", etiqueta: "oct", desde: new Date("2026-10-01T03:00:00.000Z"), hasta: new Date(AL_31) };
  const p = calcularPyL(conEquipo(), oct);
  assert.equal(p.gastosOperativos, 2000);
  assert.equal(p.comisionCloser + p.comisionDirector, 291);
});

test("un pago de equipo sin marcar igual sale de la caja una vez (como cualquier gasto)", () => {
  const sinMarca = { ...PAGO, extra: { cuentaId: "proc_stripe" } };
  const mov = cajaEsperada(estadoDeYari({ arqueos: [ARQUEO], gastos: [sinMarca, CIERRE] }), ARQUEO, AL_31);
  assert.equal(mov.equipo, 0);
  assert.equal(mov.gastos, 500);
  assert.equal(mov.esperado, 10955);
});

/* ---------- Que el pago entre: lo que trae el banco ---------- */

test("un pago al equipo pegado de un extracto se carga como salida marcada, y no dos veces si ya estaba", () => {
  const e = { ...estadoDeYari(), equipo: [{ id: "eq_angelo", nombre: "Angelo Nisi", rol: "growth", comisionRate: 0, activo: true, sinComision: false }] } as EstadoApp;
  const tabla = parsearPegado("Fecha\tConcepto\tMonto\tCuenta\n27/10/2026\tAngelo Nisi\t-500\tMercury\n27/10/2026\tNotion\t-20\tMercury");
  const filas = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e, hoy: new Date("2026-11-03T15:00:00Z") });
  const angelo = filas.find((f) => f.concepto === "Angelo Nisi")!;
  /* El menos del banco es lo que salió: nunca «plata que volvió» (Aldana, 01/11: entró como ingreso de −500). */
  assert.deepEqual([angelo.incluir, angelo.ingreso, angelo.afuera, angelo.extraGasto?.pagoDeEquipo], [true, false, undefined, true]);
  assert.equal(filas.find((f) => f.concepto === "Notion")!.extraGasto?.pagoDeEquipo, undefined, "lo demás no se marca");
  /* Si alguien ya lo había cargado a mano, se reconoce y no se carga otra vez. */
  const yaEstaba = gasto("a_mano", 500, "2026-10-27T15:00:00.000Z", { cuentaId: "proc_mercury", pagoDeEquipo: true }, { concepto: "Angelo Nisi" });
  const otra = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e: { ...e, gastos: [yaEstaba] }, hoy: new Date("2026-11-03T15:00:00Z") });
  assert.deepEqual([otra[0].yaCargada, otra[0].incluir], [true, false]);
});
