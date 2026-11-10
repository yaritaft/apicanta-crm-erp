import test from "node:test";
import assert from "node:assert/strict";
import {
  coincideConBusqueda, destinoDeMovimiento, resueltosQueCoinciden, ultimoCobroRecibido,
} from "@/lib/conciliacion";
import type { Cuota, EstadoApp, Movimiento, Venta } from "@/lib/types";

/* El selector de pagos sólo ofrece los pendientes. Mariano (07/11) veía Whop «hasta septiembre»
   porque lo de octubre en adelante ya estaba conciliado: la búsqueda tiene que encontrarlo y decir a dónde fue. */
const mov = (id: string, cambios: Partial<Movimiento>): Movimiento => ({
  id, proveedor: "whop", referencia: `pay_${id}`, monto: 499, moneda: "USD", fee: 0, neto: 499,
  fecha: "2026-10-10T15:00:00.000Z", estado: "pendiente", origen: "api", creadoEn: "2026-10-10T15:00:00.000Z",
  ...cambios,
});

const e = {
  ventas: [{ id: "v1", contactoNombre: "Carmen Torrealba" } as Venta],
  cuotas: [
    { id: "c1", ventaId: "v1", numero: 1, esReserva: true } as Cuota,
    { id: "c2", ventaId: "v1", numero: 2, esReserva: false } as Cuota,
  ],
  movimientos: [
    mov("a", { clienteNombre: "Anderson Burgos", clienteEmail: "anderson@x.co", monto: 300, fecha: "2026-09-24T15:00:00.000Z" }),
    mov("b", { clienteNombre: "Carmen Torrealba", estado: "conciliado", cuotaId: "c2", ventaId: "v1", fecha: "2026-10-30T12:00:00.000Z" }),
    mov("c", { clienteNombre: "Carmen Torrealba", estado: "conciliado", cuotaId: "c1", fecha: "2026-10-02T12:00:00.000Z" }),
    mov("d", { clienteNombre: "Martin Bianchi", estado: "ignorado", monto: 900, fecha: "2026-10-14T12:00:00.000Z" }),
    mov("e", { proveedor: "stripe", clienteNombre: "Carmen Torrealba", estado: "conciliado", fecha: "2026-11-05T12:00:00.000Z" }),
    mov("f", { clienteNombre: "Wilson Ramos", monto: 600, fecha: "2026-11-06T18:03:04.000Z" }),
  ],
} as unknown as EstadoApp;

const whop = (m: Movimiento) => m.proveedor === "whop";

test("la búsqueda coincide por nombre, correo, referencia o monto, y vacía deja pasar todo", () => {
  const a = e.movimientos[0];
  assert.ok(coincideConBusqueda(a, ""));
  assert.ok(coincideConBusqueda(a, "  ANDERSON "));
  assert.ok(coincideConBusqueda(a, "anderson@x.co"));
  assert.ok(coincideConBusqueda(a, "pay_a"));
  assert.ok(coincideConBusqueda(a, "300"));
  assert.ok(!coincideConBusqueda(a, "carmen"));
  assert.ok(!coincideConBusqueda(a, "800"));
});

test("a dónde fue a parar cada cobro: cuota con su alumno, reserva, ignorado", () => {
  assert.equal(destinoDeMovimiento(e, e.movimientos[1]), "Cuota 2 de Carmen Torrealba");
  assert.equal(destinoDeMovimiento(e, e.movimientos[2]), "Reserva de Carmen Torrealba", "la venta sale de la cuota si el cobro no la trae");
  assert.match(destinoDeMovimiento(e, e.movimientos[3]), /^Ignorado/);
  assert.equal(destinoDeMovimiento(e, mov("x", { estado: "conciliado" })), "Conciliado", "sin cuota ni venta, no se inventa nada");
});

test("buscar un alumno devuelve sus cobros ya resueltos de la pasarela, el más nuevo primero, sin los pendientes", () => {
  const r = resueltosQueCoinciden(e, "carmen", whop);
  assert.deepEqual(r.map((x) => x.mov.id), ["b", "c"], "no entra el de Stripe ni hay pendientes");
  assert.equal(r[0].destino, "Cuota 2 de Carmen Torrealba");
  assert.deepEqual(resueltosQueCoinciden(e, "carmen", () => true).map((x) => x.mov.id), ["e", "b", "c"], "en «todas las pasarelas» entra Stripe");
  assert.deepEqual(resueltosQueCoinciden(e, "bianchi", whop).map((x) => x.mov.id), ["d"], "un ignorado también se encuentra");
});

test("sin búsqueda no devuelve nada (serían cientos) y respeta el límite", () => {
  assert.deepEqual(resueltosQueCoinciden(e, "", whop), []);
  assert.deepEqual(resueltosQueCoinciden(e, "   ", whop), []);
  assert.equal(resueltosQueCoinciden(e, "carmen", () => true, 2).length, 2);
});

test("el último cobro recibido cuenta cualquier estado: los pendientes viejos no dicen hasta cuándo llega la pasarela", () => {
  assert.equal(ultimoCobroRecibido(e.movimientos, whop)?.id, "f");
  assert.equal(ultimoCobroRecibido(e.movimientos, () => true)?.id, "f");
  assert.equal(ultimoCobroRecibido(e.movimientos, (m) => m.proveedor === "stripe")?.id, "e");
  assert.equal(ultimoCobroRecibido([], whop), undefined);
  const soloViejos = e.movimientos.filter((m) => m.estado === "pendiente" && m.id === "a");
  assert.equal(ultimoCobroRecibido(soloViejos, whop)?.id, "a");
});
