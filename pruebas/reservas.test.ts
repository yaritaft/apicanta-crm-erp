import test from "node:test";
import assert from "node:assert/strict";
import { reservaSinCompletar } from "@/lib/reservas";
import type { EstadoCuota } from "@/lib/types";

const c = (monto: number, esReserva: boolean, estado: EstadoCuota) => ({ monto, esReserva, estado });

test("reserva: sólo la reserva pagada (Cristian, USD 50) o la reserva más cuotas sin pagar (José, 100 de 500) es una reserva sin completar", () => {
  assert.deepEqual(reservaSinCompletar([c(50, true, "pagada")]), { pagado: 50, falta: 0 });
  assert.deepEqual(reservaSinCompletar([c(100, true, "pagada"), c(400, false, "pendiente")]), { pagado: 100, falta: 400 });
});

test("reserva: con una cuota del programa pagada ya es una compra común; sin reserva pagada, no es reserva", () => {
  assert.equal(reservaSinCompletar([c(100, true, "pagada"), c(400, false, "pagada")]), null);
  assert.equal(reservaSinCompletar([c(100, true, "pendiente"), c(400, false, "pendiente")]), null);
  assert.equal(reservaSinCompletar([c(2500, false, "pagada")]), null);
  assert.equal(reservaSinCompletar([]), null);
});
