import test from "node:test";
import assert from "node:assert/strict";
import { conciliarPuntas, destinoDelRetiro, destinoSupuesto, esperaLlegada, type Punta } from "@/lib/traspasos";

/* ==================================================================
   Desde fines de octubre los retiros de Stripe, Whop y Hotmart llegan a una cuenta del Bank of America que ninguna API deja leer (Yari,
   28/10: queda definitivo). Un retiro de Stripe que sale y nadie dijo a dónde fue se anota con ese destino.
   ================================================================== */

const retiro = (fecha: string, ref: string, cuentaId = "proc_stripe"): Punta => ({
  lado: "salida", cuentaId, monto: 4038.26, moneda: "USD", fecha, ref, seguro: true,
});

test("un retiro de Stripe, Whop o Hotmart desde el 28/10 va al Bank of America; antes y de otras cuentas, no", () => {
  assert.equal(destinoDelRetiro("proc_stripe", "2026-10-28T15:00:00.000Z"), "proc_bofa");
  assert.equal(destinoDelRetiro("proc_whop", "2026-11-03T15:00:00.000Z"), "proc_bofa");
  assert.equal(destinoDelRetiro("proc_hotmart", "2026-11-03T15:00:00.000Z"), "proc_bofa");
  assert.equal(destinoDelRetiro("proc_stripe", "2026-10-27T23:00:00.000Z"), undefined);
  assert.equal(destinoDelRetiro("proc_mercadopago", "2026-11-03T15:00:00.000Z"), undefined);
});

test("el pase nuevo de un retiro de Stripe queda con el Bank of America como destino y no espera una llegada que nadie va a avisar", () => {
  const r = conciliarPuntas([], [retiro("2026-10-28T15:00:00.000Z", "stripe:po_1")], "2026-10-29T10:00:00.000Z", [{ id: "proc_bofa" }, { id: "proc_stripe" }]);
  assert.equal(r.nuevos.length, 1);
  assert.equal(r.nuevos[0].destinoId, "proc_bofa");
  assert.equal(r.nuevos[0].origenId, "proc_stripe");
  assert.equal(esperaLlegada(r.nuevos[0]), false);
});

test("un retiro anterior al cambio, o sin la cuenta del banco dada de alta, sigue sin destino (espera que lo vea Mercury)", () => {
  const antes = conciliarPuntas([], [retiro("2026-10-20T15:00:00.000Z", "stripe:po_0")], "2026-10-29T10:00:00.000Z", [{ id: "proc_bofa" }]);
  assert.equal(antes.nuevos[0].destinoId, undefined);
  assert.equal(esperaLlegada(antes.nuevos[0]), true);
  const sinCuenta = conciliarPuntas([], [retiro("2026-10-29T15:00:00.000Z", "stripe:po_2")], "2026-10-30T10:00:00.000Z", [{ id: "proc_stripe" }]);
  assert.equal(sinCuenta.nuevos[0].destinoId, undefined);
});

test("si Mercury ve llegar esa plata, la llegada manda: el destino que se dio por supuesto pasa a ser Mercury y es un solo pase", () => {
  const r1 = conciliarPuntas([], [retiro("2026-10-28T15:00:00.000Z", "stripe:po_1")], "2026-10-29T10:00:00.000Z", [{ id: "proc_bofa" }]);
  assert.equal(r1.nuevos[0].destinoId, "proc_bofa");
  const llegada: Punta = { lado: "llegada", cuentaId: "proc_mercury", otraCuentaId: "proc_stripe", monto: 4038.26, moneda: "USD", fecha: "2026-10-29T09:00:00.000Z", ref: "mercury:1", seguro: true };
  const r2 = conciliarPuntas(r1.nuevos, [llegada], "2026-10-30T10:00:00.000Z", [{ id: "proc_bofa" }]);
  assert.equal(r2.nuevos.length, 0, "no nace un pase aparte");
  assert.equal(r2.conciliados, 1);
  assert.equal(r2.cambios[0].cambios.destinoId, "proc_mercury");
  assert.equal(r2.cambios[0].cambios.llegadaRef, "mercury:1");
});

test("un pase al Bank of America cargado a mano no se pisa con una llegada de Mercury", () => {
  const manual = { ...conciliarPuntas([], [retiro("2026-10-28T15:00:00.000Z", "stripe:po_1")], "2026-10-29T10:00:00.000Z", [{ id: "proc_bofa" }]).nuevos[0], origen: "manual" as const };
  assert.equal(destinoSupuesto(manual), false);
  const llegada: Punta = { lado: "llegada", cuentaId: "proc_mercury", otraCuentaId: "proc_stripe", monto: 4038.26, moneda: "USD", fecha: "2026-10-29T09:00:00.000Z", ref: "mercury:1", seguro: true };
  const r = conciliarPuntas([manual], [llegada], "2026-10-30T10:00:00.000Z", [{ id: "proc_bofa" }]);
  assert.equal(r.nuevos.length, 1, "esa llegada es de otro pase");
});
