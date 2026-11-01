import test from "node:test";
import assert from "node:assert/strict";
import { cuentaDeContraparte, problemasDelMovimiento } from "@/lib/traspasos";
import { clasificarMercury } from "@/lib/mercury";
import { PROCESADORES } from "@/lib/seed";

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

/* Aldana (01/11): cargó dos movimientos de Whop a Bank of America con fecha del 29 y 30 de NOVIEMBRE (eran del 29 y 30 de octubre): el calendario
   del navegador abre en el mes de hoy y se marca el día sin cambiar de mes. */
test("un movimiento no puede ser de un día que todavía no llegó, y se dice en la pantalla del día", () => {
  const hoy = "2026-11-01";
  assert.deepEqual(problemasDelMovimiento({ ...ok, dia: "2026-11-01", hoy }), [], "hoy está bien");
  assert.deepEqual(problemasDelMovimiento({ ...ok, dia: "2026-10-30", hoy }), [], "y cualquier día pasado");
  const futuro = problemasDelMovimiento({ ...ok, dia: "2026-11-30", hoy });
  assert.deepEqual(futuro.map((p) => p.paso), ["dia"]);
  assert.match(futuro[0].texto, /todavía no llegó/);
  /* Sin decir cuál es hoy (o el día) no se opina: lo que ya existía sigue igual. */
  assert.deepEqual(problemasDelMovimiento({ ...ok, dia: "2026-11-30" }), []);
});

/* Aldana (01/11): «30.000 de Mercury a RELAY (hay que agregarla)»: la cuenta no existía y Mercury no sabía que era una cuenta propia. */
test("Relay es una cuenta de la Caja y lo que Mercury le manda se reconoce como un pase por confirmar", () => {
  const relay = PROCESADORES.find((p) => p.id === "proc_relay");
  assert.ok(relay && relay.activo && !relay.automatico && relay.feeRate === 0, "está en el catálogo: activa, sin comisión y se cuenta a mano");
  assert.deepEqual(cuentaDeContraparte("Apicanta LLC - Relay (Apicanta LLC)"), { cuentaId: "proc_relay", seguro: false });
  const salida = { id: "m1", amount: -30000, status: "sent", counterpartyName: "Apicanta LLC - Relay (Apicanta LLC)" };
  assert.equal(clasificarMercury(salida).tipo, "pase", "ya no es un gasto: Mercury lo ve como plata entre cuentas propias");
});
