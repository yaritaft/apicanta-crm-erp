import test from "node:test";
import assert from "node:assert/strict";
import { adivinarColumnas, armarFilas, parsearPegado } from "@/lib/gastos-masivos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto } from "@/lib/types";

/* ==================================================================
   Aldana (01/11), al cargar el extracto de Mercury pegado como tabla (sin los títulos del export, así que se lee como una planilla común):
   - «hay cosas que me aparecen como ingresos, pero en verdad fueron todos egresos»: Angelo (−500) y Filmmaker (−615) entraron como plata que volvió
     y duplicaron los pagos de equipo ya cargados. En un extracto del banco el menos es lo que SALIÓ.
   - ocho compras de la tarjeta quedaron cargadas dos veces: la segunda vez traían otro día (el de la compra y el de la acreditación).
   ================================================================== */

const HOY = new Date("2026-11-01T15:00:00.000Z");
const base = (gastos: Gasto[] = []): EstadoApp => {
  const s = construirSemilla() as EstadoApp;
  return {
    ...s, gastos, ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio: 1450 },
    equipo: [{ id: "eq_angelo", nombre: "Angelo Nisi", rol: "growth", comisionRate: 0, activo: true, sinComision: false }, { id: "eq_fer", nombre: "Nicolás Fernando Ibañez", rol: "otro", comisionRate: 0, activo: true, sinComision: false }] as EstadoApp["equipo"],
  };
};
const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Honorarios del CEO", grupo: "dueno", concepto: "Uber", monto: 23.98, moneda: "USD", fecha: "2026-10-29T15:00:00.000Z", recurrente: false, creadoEn: "2026-11-01T22:59:00.000Z", extra: {}, ...g,
});
const leer = (lineas: string[], e: EstadoApp) => {
  const tabla = parsearPegado(["Fecha\tConcepto\tMonto", ...lineas].join("\n"));
  return armarFilas(tabla, adivinarColumnas(tabla, true), true, { e, hoy: HOY });
};

test("un pago a alguien del equipo con el monto en negativo (extracto del banco) no entra como ingreso: queda afuera como cualquier pago de equipo", () => {
  const filas = leer([
    "26/10/2026\tAngelo Nisi (Emperador Financiero LLC)\t-500",
    "26/10/2026\tFernando Filmmaker (Nicolás Fernando Ibañez)\t-615",
    "26/10/2026\tStarbucks\t11,13",
  ], base());
  const [angelo, fer, cafe] = filas;
  assert.equal(angelo.incluir, false, "antes entraba como un ingreso de 500");
  assert.match(angelo.afuera ?? "", /pago de equipo/i);
  assert.equal(fer.incluir, false);
  assert.match(fer.afuera ?? "", /pago de equipo/i);
  assert.equal(cafe.incluir, true, "lo demás sigue entrando");
  assert.equal(cafe.ingreso, false);
});

test("el pago de la tarjeta queda afuera aunque venga en negativo", () => {
  const [pago] = leer(["01/11/2026\tPago de la tarjeta de crédito Mercury\t-1658,48"], base());
  assert.equal(pago.incluir, false);
  assert.match(pago.afuera ?? "", /pago de la tarjeta/i);
});

test("lo que de verdad volvió (cashback, un reembolso) sigue entrando como ingreso", () => {
  const [cash] = leer(["31/10/2026\tMercury IO Cashback\t-7,37"], base());
  assert.equal(cash.ingreso, true);
  assert.equal(cash.incluir, true);
});

test("el mismo gasto cargado antes con otro día (hasta tres de diferencia) se reconoce como ya cargado, y cada uno sirve para una sola fila", () => {
  const e = base([gasto({ id: "g1" }), gasto({ id: "g2", concepto: "Steakhouse 71", monto: 77.75 })]);
  const filas = leer([
    "31/10/2026\tUber\t23,98",              // el mismo Uber, dos días después
    "31/10/2026\tUber\t23,98",              // un segundo Uber igual: no hay otro cargado, es nuevo
    "31/10/2026\tSteakhouse 71\t77,75",
    "31/10/2026\tUber\t24,00",              // otro monto: otro gasto
    "10/10/2026\tUber\t23,98",              // muy lejos (más de tres días)
  ], e);
  assert.deepEqual(filas.map((f) => f.yaCargada), [true, false, true, false, false]);
  assert.deepEqual(filas.map((f) => f.incluir), [false, true, false, true, true]);
});
