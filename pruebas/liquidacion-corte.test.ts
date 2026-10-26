import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, corteDe, diferenciasDesdeElCierre, liquidacionVacia, renglonDe, textoParaEnviar } from "@/lib/honorarios";
import type { Liquidacion, LineaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   «Cuenta hasta el día» (Aldana, 26/10): la liquidación puede contar sólo hasta una fecha del mes, para pagar a mitad
   de mes o sin un día que todavía no cerró. Recorta lo que se MIDE (cobros, ventas, llamadas, profit, devoluciones);
   lo fijo (sueldos, bonos, piezas) sigue siendo del mes entero. El mes de prueba está en estado-liquidacion.ts:
   cobros los días 5 y 20 (Belén), 8 (Pedro), 10 (Yari), 14 (Evento VIP).
   ================================================================== */

const liq = (corte?: string | null): Liquidacion => ({
  ...liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } }, ...(corte !== undefined ? { corte } : {}),
});
const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string): LineaLiquidada => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta el renglón ${miembroId}:${clave}`);
  return x.linea;
};
const calcular = (corte?: string | null) => calcularLiquidacion(estadoDePrueba(), PERIODO, liq(corte));

test("corteDe: sólo vale una fecha del mes que deje algo afuera", () => {
  assert.equal(corteDe(PERIODO, undefined), null);
  assert.equal(corteDe(PERIODO, null), null);
  assert.equal(corteDe(PERIODO, ""), null);
  assert.equal(corteDe(PERIODO, "15/09"), null, "una fecha mal escrita no corta nada");
  /* El último día del mes, o uno de después, es el mes entero. */
  assert.equal(corteDe(PERIODO, "2026-09-30"), null);
  assert.equal(corteDe(PERIODO, "2026-10-02"), null);
  /* Un día del mes: hasta el último milisegundo de ese día. */
  const c = corteDe(PERIODO, "2026-09-15")!;
  assert.deepEqual([c.getFullYear(), c.getMonth(), c.getDate(), c.getHours(), c.getMinutes(), c.getSeconds(), c.getMilliseconds()], [2026, 8, 15, 23, 59, 59, 999]);
  /* Antes de que empiece el mes: no entra nada (un milisegundo antes del primero). */
  assert.equal(corteDe(PERIODO, "2026-08-20")!.getTime(), new Date(2026, 8, 1).getTime() - 1);
});

test("sin corte, o con el último día del mes, la liquidación es la de siempre", () => {
  const sin = calcular(), fin = calcular("2026-09-30"), nulo = calcular(null);
  const igual = (a: ResultadoLiquidacion, b: ResultadoLiquidacion) => assert.deepEqual({ ...a, calculadoEn: "" }, { ...b, calculadoEn: "" });
  igual(sin, fin);
  igual(sin, nulo);
  assert.equal(sin.corte, undefined);
});

test("con corte, los cobros de los días que siguen no entran: Mariano cobra sólo lo del 5 y el 8", () => {
  const r = calcular("2026-09-15");
  assert.equal(r.corte, "2026-09-15");
  /* Sin el cobro del día 20: (1.500 − 45) + (500 − 15) = 1.940 · 15% = 291. Entero daba 509,25. */
  const l = renglon(r, "mariano", "c_com");
  assert.equal(l.monto, 291);
  assert.match(l.detalle, /del 1 al 15/);
  assert.equal(renglon(calcular(), "mariano", "c_com").monto, 509.25);
  /* Dante cobró el 14: entra igual. Santiago dirige a Belén: sólo el cobro del 5 (1.455 · 5%). */
  assert.equal(renglon(r, "dante", "c_com").monto, 194);
  assert.equal(renglon(r, "santi", "c_dir").monto, 72.75);
  /* El desglose lo dice: son 2 cobros, no 3. */
  assert.equal(l.desglose!.lista!.total, 2);
});

test("con corte, lo fijo no se recorta: sueldos, bonos, piezas y el prorrateo de quien empezó a mitad de mes", () => {
  const entero = calcular(), cortado = calcular("2026-09-10");
  for (const [id, clave] of [["manu", "c_fijo"], ["manu", "c_bono"], ["dani", "c_fijo"], ["nico", "c_pieza"], ["agus", "c_fijo"]] as const) {
    const a = renglon(entero, id, clave), b = renglon(cortado, id, clave);
    assert.equal(b.monto, a.monto, `${id}:${clave}`);
  }
  /* Agustín empezó el 16: su fijo es medio mes con o sin corte. */
  assert.equal(renglon(cortado, "agus", "c_fijo").monto, 750);
});

test("con corte, el tramo de cash y las llamadas miden sólo hasta ese día", () => {
  /* Cash neto hasta el 15: 1.455 + 485 + 3.880 + 1.940 = 7.760 → 1 tramo de 4.000 (entero: 9.215 → 2). */
  assert.equal(renglon(calcular("2026-09-15"), "manu", "c_tramo").monto, 500);
  assert.equal(renglon(calcular(), "manu", "c_tramo").monto, 1000);
  /* Las 17 llamadas agendadas son del 12: con corte el 11 no hay ninguna (0 tramos), el 12 en adelante, 1. */
  assert.equal(renglon(calcular("2026-09-11"), "lili", "c_tramo").monto, 0);
  assert.equal(renglon(calcular("2026-09-12"), "lili", "c_tramo").monto, 100);
  assert.equal(renglon(calcular(), "lili", "c_tramo").monto, 100);
});

test("con corte, el profit también llega sólo hasta ese día", () => {
  const entero = calcular(), cortado = calcular("2026-09-09");
  /* Hasta el 9 sólo está el cobro del 5 y el 8 y el gasto de Facturas Stripe del 9: el profit es otro. */
  assert.notEqual(cortado.profit, entero.profit);
  const sin = (r: ResultadoLiquidacion) => r.profit;
  assert.ok(sin(cortado) < sin(entero), "menos cobrado y menos gastos de lo que llega después");
});

test("cerrada con corte, el aviso de diferencias dice lo que entró después: la liquidación con el mes entero", () => {
  const cerrada = calcular("2026-09-15");
  const l: Liquidacion = { ...liq("2026-09-15"), estado: "cerrada", resultado: cerrada, cerradaEn: "2026-09-26T12:00:00.000Z" };
  const dif = diferenciasDesdeElCierre(estadoDePrueba(), l);
  const mariano = dif.find((x) => x.miembroId === "mariano");
  assert.ok(mariano, "Mariano cobró el 20, después del corte");
  assert.equal(mariano!.cerrado, 291);
  assert.equal(mariano!.hoy, 509.25);
  /* Los fijos no cambian: no aparece Manu por su sueldo, ni nadie que no haya cobrado después. */
  assert.ok(!dif.some((x) => x.miembroId === "nico"));
  /* Sin corte, cerrada y sin cambios: nada que avisar. */
  const entera = calcular();
  assert.deepEqual(diferenciasDesdeElCierre(estadoDePrueba(), { ...liq(), estado: "cerrada", resultado: entera }), []);
});

test("el texto para mandarle dice hasta qué día cuenta", () => {
  const r = calcular("2026-09-15");
  const p = r.personas.find((x) => x.miembroId === "mariano")!;
  assert.match(textoParaEnviar(p, PERIODO, r.corte), /tu liquidación de septiembre 2026 \(hasta el 15\/09\):/);
  assert.doesNotMatch(textoParaEnviar(p, PERIODO), /hasta el/);
});
