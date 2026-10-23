import test from "node:test";
import assert from "node:assert/strict";
import { problemasDelMovimiento } from "@/lib/traspasos";

/* ==================================================================
   El formulario de movimiento entre cuentas es paso a paso (Juan Cruz, 23/10): cada cosa que falta dice en qué pantalla se arregla, y el
   primero de la lista es el que se muestra cuando no se puede cargar.
   ================================================================== */

const ok = { origenId: "proc_stripe", destinoId: "proc_mercury", montoSale: 1000, montoLlega: 985 };

test("un movimiento completo no tiene nada que arreglar", () => {
  assert.deepEqual(problemasDelMovimiento(ok), []);
});

test("cada cosa que falta dice cuál es su pantalla, en el orden de siempre", () => {
  assert.deepEqual(problemasDelMovimiento({ ...ok, origenId: undefined }).map((p) => p.paso), ["de"]);
  assert.deepEqual(problemasDelMovimiento({ ...ok, destinoId: undefined }).map((p) => p.paso), ["a"]);
  assert.deepEqual(problemasDelMovimiento({ ...ok, destinoId: "proc_stripe" }).map((p) => [p.paso, p.texto]), [["a", "Las dos cuentas son la misma"]]);
  assert.deepEqual(problemasDelMovimiento({ ...ok, montoSale: 0 }).map((p) => p.paso), ["sale"]);
  assert.deepEqual(problemasDelMovimiento({ ...ok, montoLlega: 0 }).map((p) => p.paso), ["llega"]);
  assert.deepEqual(problemasDelMovimiento({ ...ok, faltaTc: true }).map((p) => p.paso), ["costo"]);
  /* Sin nada: el primero que se muestra es el de la cuenta de la que salió. */
  const todo = problemasDelMovimiento({ montoSale: 0, montoLlega: 0 });
  assert.deepEqual(todo.map((p) => p.paso), ["de", "a", "sale", "llega"]);
  assert.equal(todo[0].texto, "Elegí de qué cuenta salió");
});

test("un cobro que en realidad es un pase ya trae la cuenta de llegada: la de salida puede quedar sin decir", () => {
  assert.deepEqual(problemasDelMovimiento({ destinoId: "proc_mercury", desdeCobro: true, montoSale: 500, montoLlega: 500 }), []);
  /* Pero sin la de llegada sigue faltando. */
  assert.deepEqual(problemasDelMovimiento({ desdeCobro: true, montoSale: 500, montoLlega: 500 }).map((p) => p.paso), ["a"]);
});
