import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIA_COSTO, conComisionDelRetiro, costoDe, diferenciaEnEnvio, faltaComisionDelRetiro, gastoDelCosto, pasesPorCuenta,
  resumenDePases, situacionDe,
} from "@/lib/traspasos";
import { construirSemilla } from "@/lib/seed";
import type { Traspaso } from "@/lib/types";

/* ==================================================================
   F1-06 · La comisión del retiro de Hotmart se carga a mano.

   Lo que entra de Hotmart a Mercury queda «pendiente de poner la comisión»
   hasta que alguien carga cuánto salió: nada la atribuye sola al faltante
   del arqueo. Lo que se prueba: el estado, que cargarla lo cierra, que los
   números cierran (lo que salió = lo que llegó + la comisión, y el gasto es
   esa diferencia) y que Stripe y Whop avisan si salió ≠ llegó.
   ================================================================== */

const hotmartEnMercury = (llega: number, extra: Partial<Traspaso> = {}): Traspaso => ({
  id: "tra_h1", fecha: "2026-10-02T15:00:00.000Z",
  origenId: "proc_hotmart", destinoId: "proc_mercury",
  montoSale: llega, monedaSale: "USD", montoLlega: llega, monedaLlega: "USD",
  estado: "confirmado", llegadaRef: "mercury:abc", contraparte: "Hotmart BV", origen: "api",
  creadoEn: "2026-10-02T16:00:00.000Z", ...extra,
});

const stripeEnMercury = (sale: number, llega: number, extra: Partial<Traspaso> = {}): Traspaso => ({
  id: "tra_s1", fecha: "2026-10-02T15:00:00.000Z",
  origenId: "proc_stripe", destinoId: "proc_mercury",
  montoSale: sale, monedaSale: "USD", montoLlega: llega, monedaLlega: "USD",
  estado: "confirmado", salidaRef: "stripe:po_1", llegadaRef: "mercury:def", origen: "api",
  creadoEn: "2026-10-02T16:00:00.000Z", ...extra,
});

const AHORA = Date.parse("2026-10-07T12:00:00.000Z");

test("lo que llega de Hotmart a Mercury queda con «falta la comisión»", () => {
  const t = hotmartEnMercury(1000);
  assert.equal(faltaComisionDelRetiro(t), true);
  assert.equal(situacionDe(t, AHORA), "falta-comision");
});

test("cargar cuánto salió cierra el estado y la diferencia es la comisión", () => {
  const t = conComisionDelRetiro(hotmartEnMercury(1000), 1025);
  assert.equal(t.montoSale, 1025);
  assert.equal(t.montoLlega, 1000);
  assert.equal(costoDe(t), 25);
  assert.equal(situacionDe(t, AHORA), "conciliado");
  /* Lo que salió = lo que llegó + la comisión. */
  assert.equal(t.montoSale, t.montoLlega + costoDe(t));
});

test("la comisión se carga como gasto «Comisión de retiro Hotmart», por la diferencia exacta", () => {
  const e = construirSemilla();
  const t = conComisionDelRetiro(hotmartEnMercury(1000), 1025.5);
  const g = gastoDelCosto(e, t, 0);
  assert.ok(g);
  assert.equal(g.concepto, "Comisión de retiro Hotmart");
  assert.equal(g.categoria, CATEGORIA_COSTO);
  assert.equal(g.proveedor, "Hotmart");
  assert.equal(g.monto, 25.5);
  assert.equal(g.monto, costoDe(t));
  assert.equal(g.extra.traspasoId, t.id);
});

test("«no cobró comisión» también cierra el estado, sin gasto", () => {
  const e = construirSemilla();
  const t = conComisionDelRetiro(hotmartEnMercury(1000), 1000);
  assert.equal(situacionDe(t, AHORA), "conciliado");
  assert.equal(gastoDelCosto(e, t, 0), null);
});

test("con el gasto ya cargado (o una diferencia cargada a mano) no vuelve a pedirse", () => {
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { gastoId: "gas_tra_h1" })), false);
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { montoSale: 1030 })), false);
});

test("lo que cargó una persona a mano, un pase propuesto y otras cuentas no piden comisión", () => {
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { origen: "manual" })), false);
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { estado: "propuesto" })), false);
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { origenId: "proc_stripe" })), false);
  assert.equal(faltaComisionDelRetiro(hotmartEnMercury(1000, { estado: "ignorado" })), false);
  assert.equal(situacionDe(hotmartEnMercury(1000, { estado: "propuesto" }), AHORA), "por-confirmar");
});

test("el arqueo: Hotmart baja lo que salió (con la comisión) y Mercury sube lo que llegó", () => {
  const sinCargar = pasesPorCuenta({ traspasos: [hotmartEnMercury(1000)] }, null, "2026-10-07T12:00:00.000Z");
  assert.equal(sinCargar.get("proc_hotmart"), -1000);
  const cargado = pasesPorCuenta({ traspasos: [conComisionDelRetiro(hotmartEnMercury(1000), 1025)] }, null, "2026-10-07T12:00:00.000Z");
  assert.equal(cargado.get("proc_hotmart"), -1025);
  assert.equal(cargado.get("proc_mercury"), 1000);
  /* El total de las cuentas baja exactamente la comisión: ni más ni menos. */
  const total = [...cargado.values()].reduce((a, n) => a + n, 0);
  assert.equal(total, -25);
});

test("Stripe y Whop: si salió ≠ llegó, avisan; si dan igual, no", () => {
  assert.equal(situacionDe(stripeEnMercury(1000, 1000), AHORA), "conciliado");
  assert.equal(situacionDe(stripeEnMercury(1000, 990), AHORA), "diferencia");
  assert.equal(diferenciaEnEnvio(stripeEnMercury(1000, 990, { origenId: "proc_whop" })), true);
  /* Una vez cargada la diferencia como gasto, el aviso se va. */
  assert.equal(diferenciaEnEnvio(stripeEnMercury(1000, 990, { gastoId: "gas_tra_s1" })), false);
  /* Hotmart sí cobra: no es una diferencia sospechosa, es la comisión pendiente. */
  assert.equal(diferenciaEnEnvio(stripeEnMercury(1000, 990, { origenId: "proc_hotmart" })), false);
});

test("el resumen cuenta los retiros sin comisión y las diferencias", () => {
  const r = resumenDePases([
    hotmartEnMercury(1000), { ...hotmartEnMercury(500), id: "tra_h2" },
    conComisionDelRetiro({ ...hotmartEnMercury(700), id: "tra_h3" }, 720),
    stripeEnMercury(1000, 990), stripeEnMercury(2000, 2000, { id: "tra_s2" }),
  ], AHORA);
  assert.equal(r.faltaComision, 2);
  assert.equal(r.diferencias, 1);
});
