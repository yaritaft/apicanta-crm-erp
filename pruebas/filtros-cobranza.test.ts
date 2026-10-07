import test from "node:test";
import assert from "node:assert/strict";
import { clientes, totalesDeClientes, vistaDeCliente, type Cliente } from "@/lib/clientes";
import { cuotaPasa, opcionesSobre, SIN_CLOSER } from "@/lib/buscar-cliente";
import { cuotasVencidas } from "@/lib/finanzas";
import { filtrarVencidas, opcionesDeMora, totalDeMora } from "@/lib/mora-filtros";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp } from "@/lib/types";

/* Cuatro personas:
   - Ana: Mentoría de Dante en dos cuotas de 500; pagó la primera y la segunda venció hace tiempo.
   - Beto: Mentoría de Dante (1.000, vence en 2090: al día) y Downsell de Eva (300, vencida).
   - Cris: Downsell sin closer, 200, pagado entero.
   - Dani: Mentoría de Dante que se canceló. */
const HACE = "2026-01-01T12:00:00.000Z";
const FUTURO = "2090-01-01T12:00:00.000Z";

function estado(): EstadoApp {
  const lead = (id: string, nombre: string) => ({ id, nombre, email: `${nombre.toLowerCase()}@mail.com` });
  const venta = (id: string, contactoId: string, contactoNombre: string, productoId: string, closerId: string | undefined, extra: object = {}) =>
    ({ id, contactoId, contactoNombre, productoId, closerId, estado: "activa", fecha: "2026-01-01T12:00:00.000Z", precioAcordado: 1000, ...extra });
  const cuota = (id: string, ventaId: string, numero: number, monto: number, vence: string, extra: object = {}) =>
    ({ id, ventaId, numero, monto, vence, estado: "pendiente", esReserva: false, ...extra });
  const pago = (id: string, cuotaId: string, monto: number) =>
    ({ id, cuotaId, monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: HACE, creadoEn: HACE });
  return {
    leads: [lead("l1", "Ana"), lead("l2", "Beto"), lead("l3", "Cris"), lead("l4", "Dani")],
    contactos: [],
    productos: [{ id: "pm", nombre: "Mentoría" }, { id: "pd", nombre: "Downsell" }],
    equipo: [{ id: "dante", nombre: "Dante" }, { id: "eva", nombre: "Eva" }],
    ventas: [
      venta("v1", "l1", "Ana", "pm", "dante"), venta("v2", "l2", "Beto", "pm", "dante"), venta("v3", "l2", "Beto", "pd", "eva", { precioAcordado: 300 }),
      venta("v4", "l3", "Cris", "pd", undefined, { precioAcordado: 200 }), venta("v5", "l4", "Dani", "pm", "dante", { estado: "cancelada" }),
    ],
    cuotas: [
      cuota("c1", "v1", 1, 500, HACE, { estado: "pagada" }), cuota("c2", "v1", 2, 500, HACE),
      cuota("c3", "v2", 1, 1000, FUTURO), cuota("c4", "v3", 1, 300, HACE),
      cuota("c5", "v4", 1, 200, HACE, { estado: "pagada" }), cuota("c6", "v5", 1, 1000, HACE, { estado: "cancelada" }),
    ],
    pagos: [pago("p1", "c1", 500), pago("p2", "c5", 200)],
  } as unknown as EstadoApp;
}

const porNombre = (cs: Cliente[]) => Object.fromEntries(cs.map((c) => [c.nombre, c]));

test("sin filtro, el cliente es el de siempre", () => {
  const todos = clientes(estado());
  const x = porNombre(todos);
  assert.equal(x.Ana.saldo, 500);
  assert.equal(x.Ana.estado, "atrasado");
  assert.equal(x.Beto.saldo, 1300, "Mentoría 1.000 + Downsell 300");
  assert.equal(x.Beto.estado, "atrasado", "el Downsell está vencido");
  assert.equal(x.Cris.estado, "pago-todo");
  assert.equal(x.Dani.estado, "baja");
  for (const c of todos) assert.equal(vistaDeCliente(c), c, c.nombre);
  for (const c of todos) assert.equal(vistaDeCliente(c, {}), c, c.nombre);
});

test("el total de deuda sigue al producto: la deuda de Mentoría no incluye el Downsell de Beto", () => {
  const todos = clientes(estado());
  const mentoria = todos.map((c) => vistaDeCliente(c, { productoId: "pm" })).filter((c): c is Cliente => c !== null);
  assert.deepEqual(mentoria.map((c) => c.nombre).sort(), ["Ana", "Beto", "Dani"]);
  const beto = porNombre(mentoria).Beto;
  assert.equal(beto.saldo, 1000, "sólo lo de Mentoría");
  assert.equal(beto.estado, "al-dia", "visto sólo por Mentoría no está atrasado: lo vencido es el Downsell");
  assert.deepEqual(beto.productos, ["Mentoría"]);
  assert.equal(totalesDeClientes(mentoria.filter((c) => c.estado !== "baja")).saldo, 1500, "500 de Ana + 1.000 de Beto");

  const downsell = todos.map((c) => vistaDeCliente(c, { productoId: "pd" })).filter((c): c is Cliente => c !== null);
  assert.deepEqual(downsell.map((c) => c.nombre).sort(), ["Beto", "Cris"]);
  assert.equal(porNombre(downsell).Beto.saldo, 300);
  assert.equal(porNombre(downsell).Beto.estado, "atrasado");
  assert.equal(porNombre(downsell).Cris.estado, "pago-todo");
});

test("el total sigue al closer, y «sin closer» es una opción más", () => {
  const todos = clientes(estado());
  const de = (closerId: string) => todos.map((c) => vistaDeCliente(c, { closerId })).filter((c): c is Cliente => c !== null);
  assert.deepEqual(de("dante").map((c) => c.nombre).sort(), ["Ana", "Beto", "Dani"]);
  assert.equal(porNombre(de("dante")).Beto.saldo, 1000, "de Dante, no el Downsell de Eva");
  assert.deepEqual(de("eva").map((c) => [c.nombre, c.saldo]), [["Beto", 300]]);
  assert.deepEqual(de(SIN_CLOSER).map((c) => [c.nombre, c.saldo]), [["Cris", 0]]);
});

test("closer y producto se piden sobre la misma cuota: «Downsell de Dante» no existe", () => {
  const todos = clientes(estado());
  const vista = (f: { closerId?: string; productoId?: string }) => todos.map((c) => vistaDeCliente(c, f)).filter((c): c is Cliente => c !== null).map((c) => c.nombre).sort();
  assert.deepEqual(vista({ closerId: "dante", productoId: "pd" }), []);
  assert.deepEqual(vista({ closerId: "eva", productoId: "pd" }), ["Beto"]);
  assert.deepEqual(vista({ closerId: "dante", productoId: "pm" }), ["Ana", "Beto", "Dani"]);
});

test("las partes suman el todo: la deuda por producto, o por closer, da la deuda total", () => {
  const todos = clientes(estado());
  const activos = (cs: Cliente[]) => cs.filter((c) => c.estado !== "baja");
  const total = totalesDeClientes(activos(todos)).saldo;
  assert.equal(total, 1800);
  const porProducto = ["pm", "pd"].map((productoId) =>
    totalesDeClientes(activos(todos.map((c) => vistaDeCliente(c, { productoId })).filter((c): c is Cliente => c !== null))).saldo);
  assert.equal(porProducto.reduce((a, b) => a + b, 0), total, "Mentoría 1.500 + Downsell 300");
  const porCloser = ["dante", "eva", SIN_CLOSER].map((closerId) =>
    totalesDeClientes(activos(todos.map((c) => vistaDeCliente(c, { closerId })).filter((c): c is Cliente => c !== null))).saldo);
  assert.equal(porCloser.reduce((a, b) => a + b, 0), total, "Dante 1.500 + Eva 300 + sin closer 0");
});

test("con los datos de ejemplo, la deuda por producto y por closer también suma la deuda total, al centavo", () => {
  const e = construirSemilla() as EstadoApp;
  const todos = clientes(e);
  const activos = (cs: Cliente[]) => cs.filter((c) => c.estado !== "baja");
  const total = totalesDeClientes(activos(todos));
  const o = opcionesSobre(todos);
  const suma = (ids: string[], clave: "productoId" | "closerId") => ids
    .map((id) => totalesDeClientes(activos(todos.map((c) => vistaDeCliente(c, { [clave]: id })).filter((c): c is Cliente => c !== null))).saldo)
    .reduce((a, b) => Math.round((a + b) * 100) / 100, 0);
  assert.equal(suma(o.servicios.map((x) => x.id), "productoId"), total.saldo);
  assert.equal(suma(o.closers.map((x) => x.id), "closerId"), total.saldo);
  assert.ok(total.saldo > 0);
  /* Y la vista de un producto cuenta lo mismo que sus cuotas, calculado aparte. */
  const cuotas = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  const pagado = new Map<string, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  for (const o1 of o.servicios) {
    let centavos = 0;
    for (const c of cuotas.values()) {
      const v = ventaDe.get(c.ventaId);
      if (!v || v.productoId !== o1.id || v.estado !== "activa" || c.estado === "cancelada") continue;
      centavos += Math.round(Math.max(0, c.monto - (pagado.get(c.id) ?? 0)) * 100);
    }
    const vistos = todos.map((c) => vistaDeCliente(c, { productoId: o1.id })).filter((c): c is Cliente => c !== null && c.estado !== "baja");
    assert.equal(totalesDeClientes(vistos).saldo, centavos / 100, o1.nombre);
  }
});

test("las opciones de Clientes cuentan gente con el otro filtro puesto", () => {
  const todos = clientes(estado());
  const o = opcionesSobre(todos);
  assert.deepEqual(o.servicios.map((x) => [x.nombre, x.personas]), [["Mentoría", 3], ["Downsell", 2]]);
  assert.deepEqual(o.closers.map((x) => [x.nombre, x.personas]), [["Dante", 3], ["Eva", 1], ["Sin closer", 1]]);
  const deDante = opcionesSobre(todos, { closerId: "dante" });
  assert.deepEqual(deDante.servicios.map((x) => [x.nombre, x.personas]), [["Mentoría", 3]], "Dante sólo cerró Mentorías");
});

/* ---------- Finanzas → Cobros: las cuotas vencidas ---------- */

test("las cuotas vencidas saben su servicio y su closer", () => {
  const e = estado();
  const venc = cuotasVencidas(e);
  assert.deepEqual(venc.map((v) => [v.contacto, v.productoId, v.closerId]).sort(), [["Ana", "pm", "dante"], ["Beto", "pd", "eva"]]);
  /* Una cuota que heredó otro closer es del que la heredó. */
  const heredada = { ...e, cuotas: e.cuotas.map((c) => (c.id === "c2" ? { ...c, closerId: "eva" } : c)) } as EstadoApp;
  assert.equal(cuotasVencidas(heredada).find((v) => v.contacto === "Ana")?.closerId, "eva");
});

test("el total de la mora sigue la vista: servicio, closer y atraso", () => {
  const e = estado();
  const venc = cuotasVencidas(e);
  const todas = totalDeMora(venc);
  assert.deepEqual([todas.cuotas, todas.clientes, todas.saldo], [2, 2, 800]);

  const mentoria = filtrarVencidas(venc, { productoId: "pm" });
  assert.deepEqual(mentoria.map((v) => v.contacto), ["Ana"]);
  assert.equal(totalDeMora(mentoria).saldo, 500);
  assert.equal(totalDeMora(filtrarVencidas(venc, { closerId: "eva" })).saldo, 300);
  assert.equal(totalDeMora(filtrarVencidas(venc, { closerId: "dante", productoId: "pd" })).cuotas, 0, "las dos cosas sobre la misma cuota");
  /* El atraso se suma al servicio y al closer. */
  assert.equal(filtrarVencidas(venc, { atraso: 10_000 }).length, 0);
  assert.equal(filtrarVencidas(venc, { atraso: 7, productoId: "pm" }).length, 1);

  /* Las partes suman el todo. */
  const porProducto = ["pm", "pd"].map((id) => totalDeMora(filtrarVencidas(venc, { productoId: id })).saldo);
  assert.equal(porProducto.reduce((a, b) => a + b, 0), todas.saldo);
});

test("con los datos de ejemplo, la mora por servicio y por closer suma la mora total, al centavo", () => {
  const e = construirSemilla() as EstadoApp;
  const venc = cuotasVencidas(e);
  assert.ok(venc.length > 0, "hay cuotas vencidas de ejemplo");
  const total = totalDeMora(venc);
  const nombre = (id?: string) => id;
  const o = opcionesDeMora(venc, { servicio: nombre, closer: nombre });
  const suma = (ids: string[], clave: "productoId" | "closerId") =>
    ids.map((id) => totalDeMora(filtrarVencidas(venc, { [clave]: id })).saldo).reduce((a, b) => Math.round((a + b) * 100) / 100, 0);
  assert.equal(suma(o.servicios.map((x) => x.id), "productoId"), total.saldo);
  assert.equal(suma(o.closers.map((x) => x.id), "closerId"), total.saldo);
  /* Cada opción cuenta las cuotas que deja. */
  for (const s of o.servicios) assert.equal(s.personas, filtrarVencidas(venc, { productoId: s.id }).length);
  for (const c of o.closers) assert.equal(c.personas, filtrarVencidas(venc, { closerId: c.id }).length);
  /* Con otro filtro puesto, el número de cada opción es lo que se ve. */
  const primero = o.closers[0].id;
  const conCloser = opcionesDeMora(venc, { servicio: nombre, closer: nombre }, { closerId: primero });
  for (const s of conCloser.servicios) assert.equal(s.personas, filtrarVencidas(venc, { productoId: s.id, closerId: primero }).length);
  /* Lo que suma la tabla es el total. */
  assert.equal(Math.round(venc.reduce((a, v) => a + v.saldo * 100, 0)) / 100, total.saldo);
});

test("cuotaPasa es la misma regla que usa «Cargar el pago de una cuota»", () => {
  assert.equal(cuotaPasa({ closerId: "dante", productoId: "pm" }, { closerId: "dante", productoId: "pm" }), true);
  assert.equal(cuotaPasa({ closerId: "dante", productoId: "pm" }, { closerId: "eva" }), false);
  assert.equal(cuotaPasa({ productoId: "pm" }, { closerId: SIN_CLOSER }), true);
  assert.equal(cuotaPasa({ closerId: "dante" }, { closerId: SIN_CLOSER }), false);
  assert.equal(cuotaPasa({ closerId: "dante" }), true);
});
