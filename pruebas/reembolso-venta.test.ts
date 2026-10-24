import test from "node:test";
import assert from "node:assert/strict";
import { buscarVentas, ventasDelPedido } from "@/lib/devoluciones";
import { conciliarReembolsos, ventaDelReembolso, type ReembolsoCrudo } from "@/lib/reembolsos";
import type { Devolucion, EstadoApp, Movimiento, Venta } from "@/lib/types";

/* ==================================================================
   Aldana (23/10): «reembolsos que no encuentran venta: que exista la opción de poder vincularlos a mano; a veces la persona paga con un mail en la
   plataforma pero en el sistema aparece con otro. Este es Sebastian Vega y en el sistema está cargado solo como Sebastian».
   ================================================================== */

const venta = (id: string, nombre: string, precio: number, fecha: string, contactoId?: string): Venta =>
  ({ id, contactoNombre: nombre, precioAcordado: precio, fecha, estado: "activa", contactoId, moneda: "USD" }) as unknown as Venta;
const movimiento = (extra: Partial<Movimiento>): Movimiento =>
  ({ id: "mov1", proveedor: "whop", referencia: "pay_1", monto: 500, moneda: "USD", fecha: "2026-10-22T11:51:31.000Z", estado: "pendiente", clienteNombre: "vega luna Sebastian A", clienteEmail: "sebastian.vega.luna@gmail.com", ...extra }) as unknown as Movimiento;

const ventas = [
  venta("v_sebastian", "Sebastian", 500, "2026-10-22T15:00:00.000Z", "lead_a"),
  venta("v_peralta", "Sebastian Peralta", 250, "2026-08-01T15:00:00.000Z", "lead_b"),
  venta("v_giraldo", "Sebastian Giraldo", 2000, "2025-11-18T15:00:00.000Z", "lead_c"),
  venta("v_otra", "Mariana Lopez", 500, "2026-10-22T15:00:00.000Z", "lead_d"),
];
const leads = [
  { id: "lead_a", nombre: "Sebastian", email: "seba.v@otro.com", telefono: "+57 300 111 2233" },
  { id: "lead_b", nombre: "Sebastian Peralta", email: "peralta@x.com" },
  { id: "lead_c", nombre: "Sebastian Giraldo", email: "giraldo@x.com" },
  { id: "lead_d", nombre: "Mariana Lopez", email: "mari@x.com" },
];
const estado = (extra: Record<string, unknown> = {}) => ({
  ventas, leads, contactos: [], cuotas: [{ id: "c1", ventaId: "v_sebastian", numero: 1, monto: 500, estado: "pendiente" }], pagos: [], movimientos: [], devoluciones: [], procesadores: [], ...extra,
}) as unknown as EstadoApp;

test("la devolución de Whop no trae quién es, y por el nombre completo del cobro no aparece la venta (es lo que le pasó a Aldana)", () => {
  const e = estado();
  assert.deepEqual(ventasDelPedido(e, { nombre: "vega luna Sebastian A", email: "sebastian.vega.luna@gmail.com" }), []);
});

test("buscar a mano: «Sebastian» con el monto y el día del cobro deja primera a la que coincide, no a cualquier Sebastian", () => {
  const e = estado();
  const r = buscarVentas(e, "vega luna Sebastian A", { monto: 500, email: "sebastian.vega.luna@gmail.com", fecha: "2026-10-22T11:51:31.000Z" });
  assert.equal(r[0].id, "v_sebastian");
  assert.ok(r.some((v) => v.id === "v_peralta"), "las otras Sebastian también salen, más abajo");
  assert.ok(!r.some((v) => v.id === "v_otra"), "una que no tiene nada que ver con el nombre no sale aunque coincida el monto");
  /* Por mail del lead, aunque el nombre no se parezca. */
  assert.equal(buscarVentas(e, "seba.v@otro.com")[0].id, "v_sebastian");
  /* Por teléfono. */
  assert.equal(buscarVentas(e, "300 111 2233")[0].id, "v_sebastian");
  /* Sin escribir nada sólo salen las que coinciden en monto/día/mail (no toda la lista). */
  assert.deepEqual(buscarVentas(e, "", { monto: 9999 }), []);
  assert.deepEqual(buscarVentas(e, "", { monto: 500 }), [], "el monto solo no alcanza: hay muchas ventas del mismo monto");
  assert.equal(buscarVentas(e, "", { monto: 500, fecha: "2026-10-22T11:00:00.000Z" })[0].id, "v_sebastian");
});

test("la venta de un reembolso: la guardada o, en cuanto se concilia su cobro, la de ese cobro", () => {
  const prop = { id: "dev_whop_reembolso:pay_1", estado: "propuesta", monto: 500, moneda: "USD", fecha: "2026-10-22T15:25:44.000Z", referencia: "whop:reembolso:pay_1", proveedor: "whop", extra: { origen: "pasarela", referenciasCobro: ["pay_1"] } } as unknown as Devolucion;
  const pendiente = estado({ devoluciones: [prop], movimientos: [movimiento({})] });
  assert.equal(ventaDelReembolso(pendiente, prop), undefined, "con el cobro sin conciliar no hay de dónde sacarla");
  const conciliado = estado({ devoluciones: [prop], movimientos: [movimiento({ estado: "conciliado", ventaId: "v_sebastian", cuotaId: "c1" })] });
  assert.equal(ventaDelReembolso(conciliado, prop)?.id, "v_sebastian");
  assert.equal(ventaDelReembolso(estado({ devoluciones: [{ ...prop, ventaId: "v_peralta" }] }), { ...prop, ventaId: "v_peralta" })?.id, "v_peralta");
});

test("la sincronización le pone la venta a una propuesta que quedó sin ella cuando su cobro se concilia (raíz: no depender de que alguien la ate)", () => {
  const prop = { id: "dev_whop_reembolso:pay_1", estado: "propuesta", monto: 500, moneda: "USD", fecha: "2026-10-22T15:25:44.000Z", referencia: "whop:reembolso:pay_1", proveedor: "whop", extra: { origen: "pasarela", referenciasCobro: ["pay_1"] } } as unknown as Devolucion;
  const crudo: ReembolsoCrudo = { proveedor: "whop", referencia: "reembolso:pay_1", referenciasCobro: ["pay_1"], monto: 500, moneda: "USD", fecha: "2026-10-22T15:25:44.000Z" };
  const antes = conciliarReembolsos(estado({ devoluciones: [prop], movimientos: [movimiento({})] }), [crudo], "2026-10-23T00:00:00.000Z");
  assert.equal(antes.actualizadas.length, 0, "con el cobro sin conciliar no hay venta que ponerle");
  const despues = conciliarReembolsos(estado({ devoluciones: [prop], movimientos: [movimiento({ estado: "conciliado", ventaId: "v_sebastian", cuotaId: "c1" })] }), [crudo], "2026-10-23T00:00:00.000Z");
  assert.deepEqual(despues.actualizadas.map((a) => [a.devolucionId, a.cambios.ventaId]), [["dev_whop_reembolso:pay_1", "v_sebastian"]]);
  assert.equal(despues.nuevas.length, 0);
});
