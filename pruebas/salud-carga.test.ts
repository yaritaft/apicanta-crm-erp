import test from "node:test";
import assert from "node:assert/strict";
import { COBRO_ALARMA, COBRO_ATENCION, diasEntre, saludDeLaCarga, VENTA_ALARMA, VENTA_ATENCION } from "@/lib/salud-carga";
import type { EstadoApp, Movimiento, Venta } from "@/lib/types";
import { estadoDePrueba, venta } from "./estado-liquidacion";

/* ==================================================================
   La salud de la carga: avisa cuando nadie carga ventas o cuando los cobros
   de las pasarelas esperan una venta (reunión del 07/10).
   ================================================================== */

/* Mediodía de Argentina del 20/09/2026. */
const AHORA = new Date("2026-09-20T15:00:00.000Z");
const HOY = "2026-09-20";
const alDia = (d: number, h = 15) => `2026-09-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const ventaDelDia = (id: string, d: number, extra: Partial<Venta> = {}) =>
  venta({ id, contactoNombre: `Cliente ${id}`, precioAcordado: 1000, fecha: alDia(d), ...extra });

const mov = (id: string, d: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, proveedor: "whop", referencia: id, monto: 1000, moneda: "USD", fee: 0, neto: 1000, fecha: alDia(d),
  estado: "pendiente", origen: "api", creadoEn: alDia(d), ...extra,
});

const estado = (ventas: Venta[], movimientos: Movimiento[] = []): EstadoApp => ({ ...estadoDePrueba(), ventas, movimientos });

test("días entre dos días del negocio, con meses de por medio", () => {
  assert.equal(diasEntre("2026-09-17", "2026-10-09"), 22);
  assert.equal(diasEntre("2026-10-09", "2026-10-09"), 0);
  assert.equal(diasEntre("2026-02-27", "2026-03-02"), 3);
});

test("una venta de hoy o de ayer: todo bien, no avisa", () => {
  const s = saludDeLaCarga(estado([ventaDelDia("a", 19), ventaDelDia("b", 12)]), AHORA);
  assert.equal(s.hoy, HOY);
  assert.deepEqual(s.ultimaVenta, { dia: "2026-09-19", dias: 1 });
  assert.equal(s.nivel, "ok");
  assert.deepEqual(s.pendientes, []);
});

test("sin ventas nuevas desde hace tres días avisa; desde hace cinco, alarma", () => {
  const atencion = saludDeLaCarga(estado([ventaDelDia("a", 20 - VENTA_ATENCION)]), AHORA);
  assert.equal(atencion.nivel, "atencion");
  assert.deepEqual(atencion.pendientes, ["cargar-ventas"]);
  const alarma = saludDeLaCarga(estado([ventaDelDia("a", 20 - VENTA_ALARMA)]), AHORA);
  assert.equal(alarma.nivel, "alarma");
  /* Un día antes del umbral todavía no avisa. */
  assert.equal(saludDeLaCarga(estado([ventaDelDia("a", 20 - VENTA_ATENCION + 1)]), AHORA).nivel, "ok");
});

test("las ventas canceladas no cuentan como carga", () => {
  const s = saludDeLaCarga(estado([ventaDelDia("a", 5), ventaDelDia("b", 20, { estado: "cancelada" })]), AHORA);
  assert.deepEqual(s.ultimaVenta, { dia: "2026-09-05", dias: 15 });
  assert.equal(s.nivel, "alarma");
});

test("una venta cargada a las 22 en Argentina cuenta como de ese día, no del siguiente", () => {
  /* 22:00 del 19/09 en Argentina = 01:00 UTC del 20/09. */
  const s = saludDeLaCarga(estado([venta({ id: "t", contactoNombre: "Tarde", precioAcordado: 1, fecha: "2026-09-20T01:00:00.000Z" })]),
    new Date("2026-09-22T15:00:00.000Z"));
  assert.deepEqual(s.ultimaVenta, { dia: "2026-09-19", dias: 3 });
  assert.equal(s.nivel, "atencion");
});

test("los cobros de pasarela sin asignar: los de ayer no avisan, desde los tres días sí", () => {
  const ventas = [ventaDelDia("a", 20)];
  assert.equal(saludDeLaCarga(estado(ventas, [mov("m1", 19), mov("m2", 20)]), AHORA).sinAsignar, null);
  const s = saludDeLaCarga(estado(ventas, [mov("m1", 20 - COBRO_ATENCION), mov("m2", 19)]), AHORA);
  assert.equal(s.nivel, "atencion");
  assert.deepEqual(s.pendientes, ["asignar-cobros"]);
  assert.deepEqual(s.sinAsignar, { n: 1, monto: 1000, masViejoDia: "2026-09-17", masViejoDias: 3 });
});

test("un cobro que espera una semana es alarma; suma los montos y marca el más viejo", () => {
  const s = saludDeLaCarga(estado([ventaDelDia("a", 20)], [
    mov("m1", 20 - COBRO_ALARMA, { monto: 2700 }), mov("m2", 14, { monto: 500 }), mov("m3", 10, { monto: 300 }),
  ]), AHORA);
  assert.equal(s.nivel, "alarma");
  assert.equal(s.sinAsignar?.n, 3);
  assert.equal(s.sinAsignar?.monto, 3500);
  assert.equal(s.sinAsignar?.masViejoDia, "2026-09-10");
  assert.equal(s.sinAsignar?.masViejoDias, 10);
});

test("los cobros conciliados, ignorados o de monto cero no cuentan", () => {
  const s = saludDeLaCarga(estado([ventaDelDia("a", 20)], [
    mov("m1", 5, { estado: "conciliado" }), mov("m2", 5, { estado: "ignorado" }), mov("m3", 5, { monto: 0 }),
  ]), AHORA);
  assert.equal(s.sinAsignar, null);
  assert.equal(s.nivel, "ok");
});

test("los cobros en pesos se pasan a la moneda base con el tipo de cambio de Ajustes", () => {
  const e = estado([ventaDelDia("a", 20)], [mov("m1", 10, { monto: 1_500_000, moneda: "ARS" })]);
  e.ajustes = { ...e.ajustes, monedaBase: "USD", tipoCambio: 1500 };
  assert.equal(saludDeLaCarga(e, AHORA).sinAsignar?.monto, 1000);
  /* Sin tipo de cambio no inventa un monto: cuenta el cobro pero no lo suma. */
  e.ajustes = { ...e.ajustes, tipoCambio: 0 };
  const sin = saludDeLaCarga(e, AHORA).sinAsignar;
  assert.equal(sin?.n, 1);
  assert.equal(sin?.monto, 0);
});

test("las dos señales juntas, y sin ninguna venta (una app nueva) no avisa de nada", () => {
  const juntas = saludDeLaCarga(estado([ventaDelDia("a", 8)], [mov("m1", 8)]), AHORA);
  assert.equal(juntas.nivel, "alarma");
  assert.deepEqual(juntas.pendientes, ["cargar-ventas", "asignar-cobros"]);
  const vacia = saludDeLaCarga(estado([], [mov("m1", 1)]), AHORA);
  assert.equal(vacia.nivel, "ok");
  assert.equal(vacia.ultimaVenta, null);
  assert.equal(vacia.sinAsignar, null);
});
