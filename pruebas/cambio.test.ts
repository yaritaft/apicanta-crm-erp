import test from "node:test";
import assert from "node:assert/strict";
import { fuenteDe, promedioDolar, type CotizacionBlue } from "@/lib/cambio";

test("el tipo de cambio de un cobro en pesos es el promedio entre el blue y el cripto", () => {
  /* El ejemplo de Angelo: blue 1.560 y cripto 1.600, «uso el medio, 1.580». */
  assert.equal(promedioDolar(1560, 1600), 1580);
  /* Los de hoy y del 30/09, de las fuentes reales. */
  assert.equal(promedioDolar(1550, 1607.37), 1578.69);
  assert.equal(promedioDolar(1560, 1612.31), 1586.16);
});

test("el promedio se redondea a centavos, para arriba en la mitad", () => {
  assert.equal(promedioDolar(1550, 1607.37), 1578.69, "1578,685");
  assert.equal(promedioDolar(1000, 1000.01), 1000.01, "1000,005");
  assert.equal(promedioDolar(1000.5, 1000.5), 1000.5);
});

test("sin el cripto queda el blue", () => {
  assert.equal(promedioDolar(1550), 1550);
  assert.equal(promedioDolar(1550, undefined), 1550);
  assert.equal(promedioDolar(1550, 0), 1550);
  assert.equal(promedioDolar(1550, Number.NaN), 1550);
});

test("de dónde salió, para guardarlo en el cobro", () => {
  const base: CotizacionBlue = { venta: 1550, cripto: 1607.37, promedio: 1578.69, fecha: "2026-10-07", fuente: "DolarHoy", actualizado: "07/10/26 09:58 AM" };
  assert.equal(fuenteDe(base), "Promedio blue 1.550,00 y cripto 1.607,37 · DolarHoy · 07/10/26 09:58 AM");
  assert.equal(
    fuenteDe({ ...base, cripto: undefined, promedio: 1550, fuente: "ArgentinaDatos", actualizado: "cierre del 30/09/2026" }),
    "Blue 1.550,00 (sin cripto) · ArgentinaDatos · cierre del 30/09/2026",
  );
  assert.equal(fuenteDe({ ...base, actualizado: undefined }), "Promedio blue 1.550,00 y cripto 1.607,37 · DolarHoy");
});
