import test from "node:test";
import assert from "node:assert/strict";
import { clasificarMercury, cobrosAnulados, reglasExtraDeEntorno } from "@/lib/mercury";
import { puntaDeMercury } from "@/lib/pasarelas-api";
import { parcheDeCobro } from "@/lib/completar-cobros";
import type { Movimiento } from "@/lib/types";

/* ==================================================================
   F1-05 · Mercury: movimientos internos, pendientes y cambio de fecha.

   Lo que se prueba, con movimientos con la forma de los de la API de
   Mercury: el pago de la tarjeta y las subcuentas no son ni ingreso ni
   gasto; un pending no cuenta hasta asentarse; uno que falla se limpia
   solo; un pending que se asienta en otro mes pasa a la fecha de asentado;
   y lo que arma Angelo se suma sin tocar el código.
   ================================================================== */

const mov = (extra: Record<string, unknown>) => ({
  id: "tx_1", amount: 1000, status: "sent", kind: "externalTransfer",
  createdAt: "2026-09-30T20:00:00.000Z", postedAt: "2026-10-02T14:00:00.000Z", counterpartyName: "Juan Pérez", ...extra,
});

test("un ingreso de un tercero ya asentado es un cobro; si sale plata, un gasto (que no se trae)", () => {
  assert.equal(clasificarMercury(mov({})).tipo, "cobro");
  assert.equal(clasificarMercury(mov({ amount: -140, counterpartyName: "Fathom Inc" })).tipo, "gasto");
});

test("el pago diario de la tarjeta de crédito y las subcuentas no son ni ingreso ni gasto", () => {
  assert.equal(clasificarMercury(mov({ kind: "internalTransfer", counterpartyName: "Mercury Checking ••1234" })).tipo, "interno");
  assert.equal(clasificarMercury(mov({ kind: "creditCardCredit", amount: 820, counterpartyName: "Mercury" })).tipo, "interno");
  assert.equal(clasificarMercury(mov({ amount: -820, bankDescription: "Mercury Credit autopay" })).tipo, "interno");
  assert.equal(clasificarMercury(mov({ amount: 5000, kind: "treasuryTransfer", counterpartyName: "Mercury Treasury" })).tipo, "interno");
  assert.equal(clasificarMercury(mov({ amount: -820, kind: "other", counterpartyName: "Pago de la tarjeta de crédito" })).tipo, "interno");
  /* Un interno nunca es un pase entre cuentas, ni siquiera positivo. */
  assert.equal(puntaDeMercury(mov({ kind: "internalTransfer", counterpartyName: "Stripe" })), null);
});

test("un pending no cuenta hasta asentarse; uno que falla es anulado", () => {
  assert.equal(clasificarMercury(mov({ status: "pending", postedAt: null })).tipo, "en-proceso");
  assert.equal(clasificarMercury(mov({ status: "pending", postedAt: null, counterpartyName: "Stripe" })).tipo, "en-proceso");
  for (const status of ["failed", "cancelled", "reversed", "blocked"]) {
    assert.equal(clasificarMercury(mov({ status })).tipo, "anulado", status);
  }
  /* Y un pending de una pasarela tampoco es todavía la punta de un pase. */
  assert.equal(puntaDeMercury(mov({ status: "pending", counterpartyName: "Hotmart BV", postedAt: null })), null);
});

test("lo que viene de una pasarela sigue siendo un pase, con la fecha de asentado", () => {
  assert.equal(clasificarMercury(mov({ counterpartyName: "STRIPE" })).tipo, "pase");
  const p = puntaDeMercury(mov({ counterpartyName: "Hotmart BV", amount: 1000 }));
  assert.ok(p);
  assert.equal(p.lado, "llegada");
  assert.equal(p.fecha, "2026-10-02T14:00:00.000Z");
  assert.equal(p.otraCuentaId, "proc_hotmart");
});

test("la lista de Angelo se suma desde el entorno, sin tocar el código", () => {
  const extras = reglasExtraDeEntorno(" Gusto Payroll , ,Brex ");
  assert.deepEqual(extras, ["Gusto Payroll", "Brex"]);
  assert.equal(clasificarMercury(mov({ counterpartyName: "BREX Inc" })).tipo, "cobro");
  assert.equal(clasificarMercury(mov({ counterpartyName: "BREX Inc" }), extras).tipo, "interno");
  assert.deepEqual(reglasExtraDeEntorno(undefined), []);
});

const guardado = (extra: Partial<Movimiento> = {}): Movimiento => ({
  id: "mov_mercury_tx_1", proveedor: "mercury", referencia: "tx_1", monto: 1000, moneda: "USD", fee: 0, neto: 1000,
  fecha: "2026-09-30T20:00:00.000Z", estado: "pendiente", origen: "api", creadoEn: "2026-09-30T21:00:00.000Z",
  clienteNombre: "Juan Pérez", ...extra,
});
const traido = { proveedor: "mercury" as const, monto: 1000, fee: 0, neto: 1000, fecha: "2026-10-02T14:00:00.000Z", clienteNombre: "Juan Pérez" };

test("un pending que se asienta en otro mes pasa a la fecha de asentado", () => {
  const p = parcheDeCobro(guardado(), traido);
  assert.ok(p);
  assert.equal(p.fecha, "2026-10-02T14:00:00.000Z");
  /* El mes cambió: septiembre → octubre. */
  assert.equal(guardado().fecha.slice(0, 7), "2026-09");
  assert.equal(p.fecha!.slice(0, 7), "2026-10");
});

test("la fecha no se toca si es la misma, si ya está conciliado o si no es de Mercury", () => {
  assert.equal(parcheDeCobro(guardado({ fecha: "2026-10-02T14:00:20.000Z" }), traido), null);
  assert.equal(parcheDeCobro(guardado({ estado: "conciliado" }), traido), null);
  assert.equal(parcheDeCobro(guardado({ proveedor: "stripe" }), { ...traido, proveedor: "stripe" }), null);
});

test("lo que el banco anuló se descarta sólo si sigue sin conciliar", () => {
  const movs = [
    guardado(),
    guardado({ id: "mov_mercury_tx_2", referencia: "tx_2", estado: "conciliado" }),
    guardado({ id: "mov_mercury_tx_3", referencia: "tx_3" }),
    guardado({ id: "mov_stripe_tx_1", proveedor: "stripe", referencia: "tx_1" }),
  ];
  assert.deepEqual(cobrosAnulados(movs, ["tx_1", "tx_2"]), ["mov_mercury_tx_1"]);
  assert.deepEqual(cobrosAnulados(movs, []), []);
});
