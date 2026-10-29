import test from "node:test";
import assert from "node:assert/strict";
import { faltanLosPesos, textoDePesosQueFaltan } from "@/lib/pesos-reales";

/* ==================================================================
   Un cobro nuevo en pesos lleva los pesos que ENTRARON (Aldana, 29/10): «si a mí no me ponen cuánto fue lo que recibimos nosotros,
   no puedo pasar la venta». Antes alcanzaba con el tipo de cambio que propone la app, y los pesos salían de los dólares por ese cambio:
   en la Financiera figuraban dos millones donde habían entrado uno y medio.
   ================================================================== */

const e = (ids: string[] = []) => ({ pagos: ids.map((id) => ({ id })) }) as never;

test("un cobro nuevo en pesos sin los pesos escritos no se puede guardar, aunque tenga el tipo de cambio propuesto", () => {
  assert.equal(faltanLosPesos(e(), { id: "nuevo" }, true), true);
  assert.equal(faltanLosPesos(e(), { id: "nuevo", montoArs: 0 }, true), true);
  assert.match(textoDePesosQueFaltan("la cuota 2"), /Escribí cuántos pesos recibimos de la cuota 2/);
  assert.match(textoDePesosQueFaltan("la cuota 2"), /sin lo que su banco o su tarjeta le cobró de más/);
});

test("con los pesos que entraron escritos, se puede guardar", () => {
  assert.equal(faltanLosPesos(e(), { id: "nuevo", montoArs: 2_499_367 }, true), false);
});

test("un cobro ya cargado que se corrige no pide los pesos: puede ser de antes", () => {
  assert.equal(faltanLosPesos(e(["nuevo"]), { id: "nuevo" }, true), false);
});

test("una cuenta en dólares, o un cobro conciliado con la pasarela, no piden pesos", () => {
  assert.equal(faltanLosPesos(e(), { id: "nuevo" }, false), false);
  assert.equal(faltanLosPesos(e(), { id: "nuevo", movimientoId: "mov_1" }, true), false);
});
