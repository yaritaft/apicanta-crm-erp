import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import type { Cuota, EstadoApp, Movimiento, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Aldana (25/10): «tengo diferencia en las ventas por Whop del 21 al 25: el CRM dice 15.999 y Whop 15.978,48». Eran dos pagos cargados a mano y atados
   después a su cobro de Whop: el de Brian Asael Noh Cocom con la comisión estimada (US$ 6,00 contra los US$ 7,77 de Whop) y el de Simon Perez, cobrado
   el 24/10, con fecha del 27/10. Al atar un pago a una pasarela toma la comisión real y el día en que la pasarela cobró.
   ================================================================== */

const base = () => construirSemilla() as EstadoApp;
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;

const venta = { id: "v_s", contactoNombre: "Simon Perez", productoId: "prod_hackear_ai", precioAcordado: 1500, moneda: "USD", closerId: "eq_dante", excluidoMarketing: false, estado: "activa", fecha: "2026-10-24T16:00:00.000Z", creadoEn: "2026-10-24T16:00:00.000Z", extra: {} } as unknown as Venta;
const cuota = { id: "c_s", ventaId: "v_s", numero: 1, monto: 1500, vence: "2026-10-27T15:00:00.000Z", estado: "pendiente", esReserva: false } as Cuota;
const mov = (id: string, proveedor: string, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, proveedor, procesadorId: `proc_${proveedor}`, referencia: id.replace("mov_", ""), monto: 200, moneda: "USD", fee: 7.77, neto: 192.23, fecha: "2026-10-24T16:17:19.000Z",
  clienteNombre: "SIMON PEREZ", estado: "pendiente", origen: "api", creadoEn: "2026-10-24T16:30:00.000Z", ...extra,
}) as Movimiento;
const pago = (id: string, extra: Partial<Pago> = {}): Pago => ({
  id, cuotaId: "c_s", procesadorId: "proc_whop", monto: 200, moneda: "USD", feeRate: 0.03, feeMonto: 6, fecha: "2026-10-27T15:00:00.000Z", creadoEn: "2026-10-24T16:18:00.000Z", ...extra,
}) as Pago;

function armar(movimientos: Movimiento[], pagos: Pago[]) {
  const b = base();
  const e = { ...b, ventas: [venta, ...b.ventas], cuotas: [cuota, ...b.cuotas], movimientos: [...movimientos, ...b.movimientos], pagos: [...pagos, ...b.pagos] } as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}
const pagoDe = (id: string) => estado().pagos.find((p) => p.id === id)!;

test("atar un pago cargado a mano a su cobro de Whop: toma la comisión real y el día en que Whop cobró (no el vencimiento)", () => {
  armar([mov("mov_whop_pay_1", "whop")], [pago("pag_1")]);
  assert.equal(acciones.vincularConPagos([{ movimientoId: "mov_whop_pay_1", pagoId: "pag_1" }]), 1);
  const p = pagoDe("pag_1");
  assert.equal(p.feeMonto, 7.77, "la comisión real de Whop, no el 3% estimado");
  assert.ok(Math.abs(p.feeRate - 0.03885) < 0.0001, "la tasa sale de la comisión real");
  assert.equal(p.fecha, "2026-10-24T16:17:19.000Z", "el día en que Whop cobró, no el 27/10");
  assert.equal(p.movimientoId, "mov_whop_pay_1");
});

test("un cobro repartido en dos pagos reparte la comisión en proporción, y los dos toman el mismo día", () => {
  armar([mov("mov_whop_pay_2", "whop", { monto: 1000, fee: 40, neto: 960 })], [pago("pag_2a", { monto: 250 }), pago("pag_2b", { monto: 750, id: "pag_2b" })]);
  assert.equal(acciones.vincularConPagos([{ movimientoId: "mov_whop_pay_2", pagoId: "pag_2a" }]), 1);
  assert.equal(pagoDe("pag_2a").feeMonto, 10);
  assert.equal(pagoDe("pag_2a").fecha, "2026-10-24T16:17:19.000Z");
});

test("un depósito de Mercury no cambia el día del pago: lo decide quien lo ata", () => {
  armar([mov("mov_mercury_dep", "mercury", { fee: 0, neto: 200, fecha: "2026-10-25T10:00:00.000Z" })], [pago("pag_m", { procesadorId: "proc_mercury", feeRate: 0, feeMonto: 0, fecha: "2026-10-30T12:00:00.000Z" })]);
  assert.equal(acciones.vincularConPagos([{ movimientoId: "mov_mercury_dep", pagoId: "pag_m" }]), 1);
  assert.equal(pagoDe("pag_m").fecha, "2026-10-30T12:00:00.000Z");
});

test("si la pasarela todavía no mandó la comisión, el pago conserva la que tenía, pero igual toma el día del cobro", () => {
  armar([mov("mov_whop_pay_3", "whop", { fee: 0, neto: 200 })], [pago("pag_3")]);
  assert.equal(acciones.vincularConPagos([{ movimientoId: "mov_whop_pay_3", pagoId: "pag_3" }]), 1);
  assert.equal(pagoDe("pag_3").feeMonto, 6, "sin comisión real no se pisa con 0");
  assert.equal(pagoDe("pag_3").fecha, "2026-10-24T16:17:19.000Z");
});
