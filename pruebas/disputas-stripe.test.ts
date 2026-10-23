import test from "node:test";
import assert from "node:assert/strict";
import { borradorDeDisputaPerdida, disputaDe, estadoDeDisputaStripe, retenidoDe } from "@/lib/disputas";
import { conciliarReembolsos, propuestasEnDisputa, propuestasPendientes, type ReembolsoCrudo } from "@/lib/reembolsos";
import { reembolsoDeContracargoStripe } from "@/lib/pasarelas-api";
import type { Devolucion, EstadoApp } from "@/lib/types";

/* ==================================================================
   Las disputas de Stripe (Juan Cruz, 23/10): en disputa = propuesta con su etiqueta y sin botones; ganada = no pasa nada (la venta sigue como
   ingreso y la propuesta se va sola); perdida = aparece el botón para cargarla como gasto.
   ================================================================== */

const AHORA = "2026-10-23T20:00:00.000Z";
const base = (devoluciones: Devolucion[] = []) => ({
  ventas: [], cuotas: [], pagos: [], movimientos: [], procesadores: [], contactos: [], leads: [], devoluciones,
}) as unknown as Pick<EstadoApp, "ventas" | "cuotas" | "pagos" | "movimientos" | "devoluciones" | "procesadores" | "contactos" | "leads">;

const disputa = (estado: "en-disputa" | "ganada" | "perdida", extra: Partial<NonNullable<ReembolsoCrudo["disputa"]>> = {}): ReembolsoCrudo => ({
  proveedor: "stripe", referencia: "disputa:du_1", monto: 225.53, moneda: "USD", fecha: "2026-10-21T06:22:22.000Z",
  referenciasCobro: ["ch_1"], motivo: "Contracargo (product unacceptable)", clienteNombre: "Erick", procesadorId: "proc_stripe",
  disputa: { estado, estadoStripe: estado === "ganada" ? "won" : estado === "perdida" ? "lost" : "under_review", retenido: 240.53, balanceTx: "txn_9", ...extra },
});

test("el estado de Stripe se traduce a los tres de la app", () => {
  assert.deepEqual(["needs_response", "under_review", "won", "lost", "charge_refunded"].map(estadoDeDisputaStripe), ["en-disputa", "en-disputa", "ganada", "perdida", "ganada"]);
});

test("una disputa nueva queda como propuesta EN DISPUTA, con lo que Stripe retiró; guardarla dos veces no la duplica", () => {
  const r = conciliarReembolsos(base(), [disputa("en-disputa")], AHORA);
  assert.equal(r.nuevas.length, 1);
  const p = r.nuevas[0];
  assert.equal(p.estado, "propuesta");
  assert.deepEqual([p.extra?.estadoDisputa, p.extra?.disputaStripe, p.extra?.retenido, p.extra?.balanceTx], ["en-disputa", "under_review", 240.53, "txn_9"]);
  assert.equal(disputaDe(p), "en-disputa");
  assert.equal(retenidoDe(p), 240.53);
  const otra = conciliarReembolsos(base(r.nuevas), [disputa("en-disputa")], AHORA);
  assert.deepEqual([otra.nuevas.length, otra.actualizadas.length], [0, 0]);
});

test("una disputa en curso no es una decisión pendiente: se ve aparte y no cuenta como «para confirmar»", () => {
  const nueva = conciliarReembolsos(base(), [disputa("en-disputa")], AHORA).nuevas;
  const perdida = conciliarReembolsos(base(), [{ ...disputa("perdida"), referencia: "disputa:du_2" }], AHORA).nuevas;
  const e = base([...nueva, ...perdida]);
  assert.deepEqual(propuestasEnDisputa(e).map((d) => d.referencia), ["stripe:disputa:du_1"]);
  assert.deepEqual(propuestasPendientes(e).map((d) => d.referencia), ["stripe:disputa:du_2"], "sólo la perdida espera una decisión (el botón)");
});

test("si la ganamos: no pasa nada. La propuesta se va sola (queda descartada con su motivo) y la venta sigue como ingreso", () => {
  const ya = conciliarReembolsos(base(), [disputa("en-disputa")], AHORA).nuevas;
  const r = conciliarReembolsos(base(ya), [disputa("ganada", { retenido: undefined })], AHORA);
  assert.equal(r.nuevas.length, 0);
  assert.equal(r.actualizadas.length, 1);
  const cambios = r.actualizadas[0].cambios;
  assert.equal(cambios.estado, "ignorada");
  assert.equal(cambios.extra?.estadoDisputa, "ganada");
  assert.match(String(cambios.extra?.motivoDescarte), /Disputa ganada/);
  /* Una que nunca tuvimos y ya se ganó no es nada para cargar. */
  const nada = conciliarReembolsos(base(), [disputa("ganada")], AHORA);
  assert.deepEqual([nada.nuevas.length, nada.actualizadas.length], [0, 0]);
  /* Si alguien ya la había confirmado como devolución, no se toca su estado: sólo queda marcada para que la deshagan. */
  const confirmada = { ...ya[0], estado: "confirmada" } as Devolucion;
  const marcada = conciliarReembolsos(base([confirmada]), [disputa("ganada")], AHORA).actualizadas[0].cambios;
  assert.equal(marcada.estado, undefined);
  assert.equal(marcada.extra?.estadoDisputa, "ganada");
});

test("si la perdemos: sigue como propuesta pero ahora con el botón; si no cambió nada, no se toca", () => {
  const ya = conciliarReembolsos(base(), [disputa("en-disputa")], AHORA).nuevas;
  const r = conciliarReembolsos(base(ya), [disputa("perdida")], AHORA);
  assert.equal(r.actualizadas.length, 1);
  assert.equal(r.actualizadas[0].cambios.estado, undefined, "no se descarta ni se confirma sola");
  assert.equal(r.actualizadas[0].cambios.extra?.estadoDisputa, "perdida");
  const quieta = conciliarReembolsos(base(ya), [disputa("en-disputa")], AHORA);
  assert.equal(quieta.actualizadas.length, 0);
});

test("una propuesta guardada antes de saber el estado se trata como en disputa (no hacer nada es lo seguro); una que no es de una disputa, no", () => {
  assert.equal(disputaDe({ referencia: "stripe:disputa:du_7", extra: {} }), "en-disputa");
  assert.equal(disputaDe({ referencia: "stripe:re_3Q", extra: {} }), null);
  assert.equal(disputaDe({ referencia: undefined, extra: {} }), null);
});

test("la disputa perdida se carga como gasto: lo que Stripe retiró, el día y la cuenta puestos, atado al movimiento del saldo", () => {
  const d = { monto: 225.53, fecha: "2026-10-21T06:22:22.000Z", referencia: "stripe:disputa:du_1", extra: { retenido: 240.53, balanceTx: "txn_9" } };
  const b = borradorDeDisputaPerdida(d, "Erick", "Stripe");
  assert.deepEqual([b.concepto, b.monto, b.cuenta, b.ingreso, b.bancoRef, b.proveedor], ["Contracargo perdido · Erick", "240,53", "Stripe", false, "stripe:txn_9", "Stripe"]);
  assert.equal(borradorDeDisputaPerdida({ ...d, extra: {} }, "Erick", "Stripe").monto, "225,53", "sin saber la comisión, el monto de la disputa");
});

test("de Stripe: el monto retenido y el movimiento salen de los movimientos del saldo de la disputa", () => {
  const r = reembolsoDeContracargoStripe({
    id: "du_1", status: "needs_response", amount: 22553, currency: "usd", created: 1792537257, reason: "product_unacceptable", charge: { id: "ch_1", payment_intent: "pi_1" },
    balance_transactions: [{ id: "txn_9", net: -24053, amount: -22553, fee: 1500 }],
  })!;
  assert.deepEqual([r.disputa?.estado, r.disputa?.retenido, r.disputa?.balanceTx], ["en-disputa", 240.53, "txn_9"]);
});
