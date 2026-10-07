import test from "node:test";
import assert from "node:assert/strict";
import { opcionesDeFiltro, SIN_CLOSER, todosLosQueDeben, coincidencias } from "@/lib/buscar-cliente";
import type { EstadoApp } from "@/lib/types";

/* Tres personas que deben cuotas: Ana (Mentoría, la cerró Dante), Beto (Mentoría y Downsell, de Dante y de
   Eva) y Cris (Downsell, sin closer). */
function estado(): EstadoApp {
  const lead = (id: string, nombre: string) => ({ id, nombre, email: `${nombre.toLowerCase()}@mail.com` });
  const venta = (id: string, contactoId: string, productoId: string, closerId?: string) =>
    ({ id, contactoId, productoId, closerId, estado: "activa" });
  const cuota = (id: string, ventaId: string, n: number, extra: object = {}) =>
    ({ id, ventaId, numero: n, monto: 500, estado: "pendiente", esReserva: false, vence: "2026-09-01T00:00:00.000Z", ...extra });
  return {
    leads: [lead("l1", "Ana"), lead("l2", "Beto"), lead("l3", "Cris")],
    productos: [{ id: "pm", nombre: "Mentoría" }, { id: "pd", nombre: "Downsell" }],
    equipo: [{ id: "dante", nombre: "Dante" }, { id: "eva", nombre: "Eva" }],
    ventas: [
      venta("v1", "l1", "pm", "dante"), venta("v2", "l2", "pm", "dante"), venta("v3", "l2", "pd", "eva"), venta("v4", "l3", "pd"),
    ],
    cuotas: [cuota("c1", "v1", 1), cuota("c2", "v2", 1), cuota("c3", "v3", 1), cuota("c4", "v4", 1)],
    pagos: [],
  } as unknown as EstadoApp;
}

test("sin filtro están los tres, y con closer sólo los de ese closer", () => {
  const e = estado();
  assert.deepEqual(todosLosQueDeben(e).map((p) => p.nombre).sort(), ["Ana", "Beto", "Cris"]);
  assert.deepEqual(todosLosQueDeben(e, { closerId: "dante" }).map((p) => p.nombre).sort(), ["Ana", "Beto"]);
  assert.deepEqual(todosLosQueDeben(e, { closerId: "eva" }).map((p) => p.nombre), ["Beto"]);
  assert.deepEqual(todosLosQueDeben(e, { closerId: SIN_CLOSER }).map((p) => p.nombre), ["Cris"]);
});

test("closer y servicio se piden sobre la misma cuota: «Downsell de Dante» no es «algo de Dante y algo de Downsell»", () => {
  const e = estado();
  /* Beto tiene Mentoría de Dante y Downsell de Eva: no tiene un Downsell de Dante. */
  assert.deepEqual(todosLosQueDeben(e, { closerId: "dante", productoId: "pd" }), []);
  assert.deepEqual(todosLosQueDeben(e, { closerId: "eva", productoId: "pd" }).map((p) => p.nombre), ["Beto"]);
});

test("los chips cuentan a la gente que queda con el otro filtro puesto", () => {
  const e = estado();
  const todo = opcionesDeFiltro(e);
  assert.deepEqual(todo.closers.map((o) => [o.nombre, o.personas]), [["Dante", 2], ["Eva", 1], ["Sin closer", 1]]);
  assert.deepEqual(todo.servicios.map((o) => [o.nombre, o.personas]), [["Downsell", 2], ["Mentoría", 2]]);
  const sinDante = opcionesDeFiltro(e, { closerId: "dante" });
  assert.deepEqual(sinDante.servicios.map((o) => [o.nombre, o.personas]), [["Mentoría", 2]], "Dante sólo cerró Mentorías");
});

test("la búsqueda también respeta el filtro", () => {
  const e = estado();
  assert.deepEqual(coincidencias(e, "beto", true, { closerId: "dante" }).map((p) => p.nombre), ["Beto"]);
  assert.deepEqual(coincidencias(e, "cris", true, { closerId: "dante" }), []);
});
