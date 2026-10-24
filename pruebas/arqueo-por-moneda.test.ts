import test from "node:test";
import assert from "node:assert/strict";
import { detalleDeSaldo, monedasDelSaldo, totalDelDetalle } from "@/lib/caja";
import type { Procesador } from "@/lib/types";

/* ==================================================================
   Aldana (23/10): dLocal guarda un saldo en cada moneda (pesos argentinos, mexicanos, soles, pesos colombianos) y el arqueo pedía un solo número en
   dólares: «como todos tienen distinto tipo de cambio, no sé a qué valor se toma cada uno». La cuenta se cuenta moneda por moneda.
   ================================================================== */

const cuenta = (proveedor?: Procesador["proveedor"]) => ({ proveedor }) as Pick<Procesador, "proveedor">;

test("sólo dLocal se cuenta por moneda; las demás cuentas, con un solo número", () => {
  assert.deepEqual(monedasDelSaldo(cuenta("dlocal")).map((m) => m.codigo), ["ARS", "MXN", "PEN", "COP"]);
  assert.deepEqual(monedasDelSaldo(cuenta("stripe")), []);
  assert.deepEqual(monedasDelSaldo(cuenta(undefined)), []);
});

test("cada moneda se pasa a dólares con su propio tipo de cambio y el saldo de la cuenta es la suma", () => {
  const d = detalleDeSaldo([
    { moneda: "ARS", monto: 1500000, tipoCambio: 1500 },
    { moneda: "MXN", monto: 18000, tipoCambio: 18 },
    { moneda: "PEN", monto: 3700, tipoCambio: 3.7 },
    { moneda: "COP", monto: 4000000, tipoCambio: 4000 },
  ]);
  assert.deepEqual(d.map((l) => [l.moneda, l.montoBase]), [["ARS", 1000], ["MXN", 1000], ["PEN", 1000], ["COP", 1000]]);
  assert.equal(totalDelDetalle(d), 4000);
  /* Con otros cambios el total cambia: no hay un tipo de cambio único para todo. */
  assert.equal(totalDelDetalle(detalleDeSaldo([{ moneda: "ARS", monto: 1500000, tipoCambio: 1600 }, { moneda: "PEN", monto: 3700, tipoCambio: 3.7 }])), 1937.5);
});

test("una moneda sin monto o sin tipo de cambio no suma (no inventa dólares)", () => {
  const d = detalleDeSaldo([
    { moneda: "ARS", monto: NaN, tipoCambio: 1500 },
    { moneda: "MXN", monto: 0, tipoCambio: 18 },
    { moneda: "PEN", monto: 3700, tipoCambio: 0 },
    { moneda: "COP", monto: 4000, tipoCambio: 4000 },
  ]);
  assert.deepEqual(d.map((l) => [l.moneda, l.montoBase]), [["COP", 1]]);
  assert.equal(totalDelDetalle([]), 0);
});

test("un saldo negativo (la cuenta debe plata) también se pasa a dólares", () => {
  assert.equal(totalDelDetalle(detalleDeSaldo([{ moneda: "MXN", monto: -1800, tipoCambio: 18 }])), -100);
});
