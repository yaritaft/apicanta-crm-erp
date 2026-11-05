import test from "node:test";
import assert from "node:assert/strict";
import { movimientoDeHotmart, reembolsoDeHotmart } from "@/lib/pasarelas-api";
import { feeConBrutoEnOtraMoneda, feeDesconocido } from "@/lib/completar-cobros";

/* Aldana (05/11): un cobro de Hotmart de «US$ 3.320.400» con comisión de US$ 3.319.461,53 (100%). Eran 3.320.400 pesos colombianos:
   Hotmart da el precio en la moneda del comprador y lo que le queda al productor, en dólares. 17 de los 20 cobros de Hotmart estaban así. */

const venta = (valor: number, moneda: string, transaccion = "HP3548719929") => ({
  purchase: { transaction: transaccion, price: { value: valor, currency_code: moneda }, approved_date: Date.parse("2026-10-27T19:22:05.000Z"), payment: { type: "CREDIT_CARD", installments_number: 12 } },
  buyer: { name: "Juan Camilo Salgado Meza", email: "JC@EJEMPLO.COM" },
  product: { name: "IT Mentorship - Apicanta" },
}) as unknown as Record<string, never>;

test("en pesos colombianos: entra lo que llega en dólares, sin comisión inventada y con el monto original anotado", () => {
  const m = movimientoDeHotmart(venta(3320400, "COP"), new Map([["HP3548719929", 938.47]]));
  assert.equal(m.monto, 938.47);
  assert.equal(m.neto, 938.47);
  assert.equal(m.fee, 0, "la comisión en dólares no se sabe");
  assert.equal(m.moneda, "USD");
  assert.equal(m.brutoOriginal, "3.320.400 COP", "lo que pagó queda anotado");
  assert.equal(m.descripcion, "IT Mentorship - Apicanta");
  assert.equal(feeDesconocido(m as never), true, "no tiene comisión inventada (no 100%)");
  assert.equal(feeConBrutoEnOtraMoneda({ monto: 1000 }, m), 61.53, "al atarlo al pago de US$ 1.000 del closer, la comisión es 1.000 − 938,47");
});

test("sin la comisión del productor no hay ningún número en dólares: no entra", () => {
  assert.equal(movimientoDeHotmart(venta(3320400, "COP"), new Map()).monto, 0);
});

test("en dólares sigue igual: el precio es el bruto y la comisión es lo que se quedó Hotmart", () => {
  const m = movimientoDeHotmart(venta(2300, "USD", "HPX"), new Map([["HPX", 2161]]));
  assert.deepEqual([m.monto, m.fee, m.neto, m.moneda], [2300, 139, 2161, "USD"]);
  assert.equal(m.descripcion, "IT Mentorship - Apicanta");
  assert.equal(m.brutoOriginal, undefined);
});

test("un reembolso en otra moneda no se propone solo con millones de «dólares»; en dólares, sí", () => {
  assert.equal(reembolsoDeHotmart(venta(708092, "COP", "HP0225109051")), null);
  assert.equal(reembolsoDeHotmart(venta(200, "USD", "HP1376505978"))?.monto, 200);
});
