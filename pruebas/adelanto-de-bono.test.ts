import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, conAdelantoEnExtra, diferenciasDesdeElCierre, liquidacionVacia } from "@/lib/honorarios";
import { evaluarPasos } from "@/lib/desglose";
import type { EstadoApp, ExtraLiquidacion, LineaLiquidada, Liquidacion, ResultadoLiquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Aldana (01/11): «a Manu se le cuenta el bono que ya había quedado contabilizado en su pago». Al cerrar a mitad de mes (corte 25/10) el
   «Bono por cada US$ 100.000 de cash» daba cero, pero se le pagó igual porque iba a llegar (un monto a mano de +500). Al correr el mes
   entero el renglón da 500 y la diferencia del cierre mandaba otros 500: el mismo bono dos veces. Un monto a mano puede decir que es el
   adelanto de ese renglón, y cuando el renglón da se resta lo ya adelantado.
   En el mes de prueba el cash neto es US$ 9.215: con un tramo cada US$ 9.000, el tramo da 500 con todo el mes y 0 hasta el día 9.
   ================================================================== */

const adelanto = (extra: Partial<ExtraLiquidacion> = {}): ExtraLiquidacion =>
  ({ id: "x1", miembroId: "manu", concepto: "Bono de cash", monto: 500, moneda: "USD", ...extra });
const estadoConTramo = (): EstadoApp => {
  const e = estadoDePrueba();
  e.honorarios = e.honorarios.map((h) => (h.miembroId === "manu"
    ? { ...h, conceptos: h.conceptos.map((c) => (c.id === "c_tramo" ? { ...c, cada: 9000 } : c)) } : h));
  return e;
};
const liqCon = (extras: ExtraLiquidacion[], corte?: string): Liquidacion =>
  ({ ...liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } }, extras, ...(corte ? { corte } : {}) });
const deManu = (r: ResultadoLiquidacion) => r.personas.find((p) => p.miembroId === "manu")!;
const linea = (r: ResultadoLiquidacion, clave: string): LineaLiquidada | undefined => deManu(r).lineas.find((l) => l.clave === clave);

test("sin marcarlo, el bono se cuenta dos veces: el tramo da 500 y el adelanto de 500 sigue sumando", () => {
  const r = calcularLiquidacion(estadoConTramo(), PERIODO, liqCon([adelanto()]));
  assert.equal(linea(r, "c_tramo")!.monto, 500);
  assert.equal(deManu(r).total, 1700 + 500 + 500 + 500, "sueldo + bono + tramo + el adelanto");
});

test("marcado como adelanto del tramo, cuando el tramo da se resta lo adelantado y queda pagado una sola vez", () => {
  const r = calcularLiquidacion(estadoConTramo(), PERIODO, liqCon([adelanto({ adelantoDe: "c_tramo" })]));
  const resta = linea(r, "adelanto:x1")!;
  assert.equal(resta.monto, -500);
  assert.equal(resta.tipo, "descuento");
  assert.equal(deManu(r).total, 1700 + 500 + 500, "sueldo + bono + (tramo 500 ya adelantado)");
  assert.deepEqual(evaluarPasos(resta.desglose!.pasos).fallas, [], "la cuenta del desglose cierra");
  assert.equal(evaluarPasos(resta.desglose!.pasos).valor, resta.monto);
});

test("mientras el tramo da cero, el adelanto es lo único que se paga: no hay nada que restar", () => {
  const e = estadoConTramo();
  const r = calcularLiquidacion(e, PERIODO, { ...liqCon([adelanto({ adelantoDe: "c_tramo" })]), entradas: { "nico:c_pieza": { cantidad: 3 }, "manu:c_tramo": { cantidad: 0 } } });
  assert.equal(linea(r, "c_tramo")!.monto, 0);
  assert.equal(linea(r, "adelanto:x1"), undefined);
  assert.equal(deManu(r).total, 1700 + 500 + 500);
});

test("si el renglón da menos de lo adelantado, se resta sólo lo que da", () => {
  const r = calcularLiquidacion(estadoConTramo(), PERIODO, liqCon([adelanto({ adelantoDe: "c_tramo", monto: 800 })]));
  assert.equal(linea(r, "adelanto:x1")!.monto, -500, "el tramo da 500: no se resta más");
  assert.equal(deManu(r).total, 1700 + 500 + 500 + 800 - 500);
});

test("un adelanto de un renglón que no existe, o un descuento, no resta nada", () => {
  const r1 = calcularLiquidacion(estadoConTramo(), PERIODO, liqCon([adelanto({ adelantoDe: "c_que_no_esta" })]));
  assert.equal(linea(r1, "adelanto:x1"), undefined);
  const r2 = calcularLiquidacion(estadoConTramo(), PERIODO, liqCon([adelanto({ adelantoDe: "c_tramo", monto: -300 })]));
  assert.equal(linea(r2, "adelanto:x1"), undefined, "un descuento no es un adelanto");
});

test("el caso real: se cerró con corte, el tramo todavía daba cero y se pagó el bono antes; al correr el mes entero la diferencia ya no lo repite", () => {
  const e = estadoConTramo();
  const cerrar = (extras: ExtraLiquidacion[]): Liquidacion => {
    const liq = liqCon(extras, "2026-09-09");
    return { ...liq, estado: "cerrada", resultado: calcularLiquidacion(e, PERIODO, liq) };
  };
  const cerradaSinMarca = cerrar([adelanto()]);
  assert.equal(deManu(cerradaSinMarca.resultado!).total, 1700 + 500 + 0 + 500, "al cierre: 2.700");
  const sinMarca = diferenciasDesdeElCierre(e, cerradaSinMarca).find((d) => d.miembroId === "manu")!;
  assert.equal(sinMarca.hoy - sinMarca.cerrado, 500, "sin marcar, la diferencia manda otros 500: el bono dos veces");

  /* Marcarlo después, con la liquidación ya cerrada: lo pagado no se toca y la diferencia desaparece. */
  const marcado = conAdelantoEnExtra([cerradaSinMarca], cerradaSinMarca.id, "x1", "c_tramo", "2026-11-01T12:00:00.000Z")!;
  assert.equal(marcado.liquidacion.estado, "cerrada");
  assert.deepEqual(marcado.liquidacion.resultado, cerradaSinMarca.resultado, "la foto de lo pagado no cambia");
  assert.equal(diferenciasDesdeElCierre(e, marcado.liquidacion).some((d) => d.miembroId === "manu"), false, "ya no hay diferencia para Manu");
});

test("marcar y desmarcar un adelanto: lo desmarcado vuelve a como estaba", () => {
  const liq = liqCon([adelanto()]);
  const marcado = conAdelantoEnExtra([liq], liq.id, "x1", "c_tramo")!;
  assert.equal(marcado.liquidacion.extras[0].adelantoDe, "c_tramo");
  const desmarcado = conAdelantoEnExtra(marcado.liquidaciones, liq.id, "x1", null)!;
  assert.equal("adelantoDe" in desmarcado.liquidacion.extras[0], false);
  assert.equal(conAdelantoEnExtra([liq], liq.id, "no-existe", "c_tramo"), null);
});
