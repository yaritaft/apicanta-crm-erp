import test from "node:test";
import assert from "node:assert/strict";
import { cobrosSinVenta, cobrosSinVentaPorCuenta, efectoDelCambio } from "@/lib/caja";
import type { Movimiento } from "@/lib/types";

/* ==================================================================
   Aldana (24/10): «había diferencia en Whop y en dLocal… no coincide». Eran dos cobros de Whop que entraron a la cuenta y todavía no tenían su venta
   (US$ 2.028,76 netos: están en la cuenta, no en «Cobró») y, en dLocal, el cambio: lo que se contó el 21/10 como un solo número en dólares se vuelve a
   contar moneda por moneda a otro tipo de cambio.
   ================================================================== */

const mov = (id: string, procesadorId: string, monto: number, fee: number, fecha: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, proveedor: procesadorId.replace("proc_", ""), procesadorId, referencia: id, monto, moneda: "USD", fee, neto: monto - fee, fecha,
  clienteNombre: id, estado: "pendiente", origen: "api", creadoEn: fecha, ...extra,
}) as Movimiento;

const datos = {
  ajustes: { monedaBase: "USD" } as never,
  movimientos: [
    mov("Adrian Bolaños", "proc_whop", 1200, 44.77, "2026-10-24T23:11:00.000Z"),
    mov("Agustín izquierdo", "proc_whop", 900, 26.47, "2026-10-25T00:15:00.000Z"),
    mov("adrian andres bolaños herrera", "proc_stripe", 1300, 57.5, "2026-10-24T23:04:00.000Z"),
    /* No cuentan: ya conciliado, ignorado con motivo, o anterior al arqueo. */
    mov("ya conciliado", "proc_whop", 500, 10, "2026-10-24T20:00:00.000Z", { estado: "conciliado" }),
    mov("sin venta con motivo", "proc_whop", 700, 10, "2026-10-24T20:00:00.000Z", { estado: "ignorado" }),
    mov("de antes del arqueo", "proc_whop", 300, 5, "2026-10-20T20:00:00.000Z"),
  ],
};
const DESDE = "2026-10-21T04:05:20.000Z", HASTA = "2026-10-25T01:00:00.000Z";

test("los cobros sin venta se reparten por cuenta: Whop tiene sus dos cobros, Stripe el suyo", () => {
  const porCuenta = cobrosSinVentaPorCuenta(datos, DESDE, HASTA);
  assert.deepEqual(porCuenta.get("proc_whop"), { n: 2, monto: 2028.76, quienes: ["Adrian Bolaños", "Agustín izquierdo"] });
  assert.deepEqual(porCuenta.get("proc_stripe"), { n: 1, monto: 1242.5, quienes: ["adrian andres bolaños herrera"] });
  assert.equal(porCuenta.size, 2, "lo conciliado, lo ignorado y lo anterior al arqueo no cuentan");
});

test("el total de siempre sigue siendo la suma de las cuentas (los US$ 3.271 que avisa la Caja)", () => {
  assert.deepEqual(cobrosSinVenta(datos, DESDE, HASTA), { n: 3, monto: 3271.26 });
});

test("sin arqueo anterior cuenta desde siempre; sin cobros pendientes no hay nada", () => {
  assert.equal(cobrosSinVentaPorCuenta(datos, null, HASTA).get("proc_whop")?.n, 3);
  assert.equal(cobrosSinVentaPorCuenta({ ...datos, movimientos: [] }, DESDE, HASTA).size, 0);
});

test("el cambio: lo que había en cada moneda vale distinto cuando se mueve el tipo de cambio", () => {
  const anterior = [
    { moneda: "ARS", monto: 4_000_000, tipoCambio: 1600 }, // US$ 2.500,00
    { moneda: "MXN", monto: 100_000, tipoCambio: 18 },     // US$ 5.555,56
  ];
  const r = efectoDelCambio(anterior, [{ moneda: "ARS", tipoCambio: 1545 }, { moneda: "MXN", tipoCambio: 18.5 }]);
  assert.deepEqual(r.lineas.map((l) => [l.moneda, l.antes, l.ahora, l.efecto]), [["ARS", 2500, 2589, 89], ["MXN", 5555.56, 5405.41, -150.15]]);
  assert.equal(r.total, -61.15);
});

test("el cambio: sin arqueo anterior por moneda, o con una moneda sin tipo de cambio, no inventa nada", () => {
  assert.deepEqual(efectoDelCambio(undefined, [{ moneda: "ARS", tipoCambio: 1545 }]), { total: 0, lineas: [] });
  const anterior = [{ moneda: "ARS", monto: 4_000_000, tipoCambio: 1600 }, { moneda: "COP", monto: 10_000_000, tipoCambio: 4000 }];
  const r = efectoDelCambio(anterior, [{ moneda: "ARS", tipoCambio: 1600 }, { moneda: "COP", tipoCambio: 0 }]);
  assert.deepEqual(r, { total: 0, lineas: [] }, "mismo cambio, o sin cambio nuevo: no hay efecto");
});
