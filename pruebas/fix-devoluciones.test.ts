import test from "node:test";
import assert from "node:assert/strict";
import { devolvibleDeVenta, mediodiaDeNegocio, problemaDeDevolucion, reversasDeComision } from "@/lib/devoluciones";
import { diaDeNegocio } from "@/lib/dia-negocio";
import type { Devolucion, EstadoApp } from "@/lib/types";
import { devolucion, miembro, pago } from "./estado-devolucion";

/* ==================================================================
   Arreglos del estrés (lote «dev»): lo que se puede devolver y por qué cuenta.

   1. «Hasta ese día» es hasta el final del día de negocio (Argentina), no hasta
      el instante en que el formulario guarda la fecha (las 12:00).
   2. El tope mira la línea de tiempo completa: en cada día, lo devuelto
      acumulado no pasa de lo cobrado acumulado.
   3. Una devolución por una cuenta en pesos guarda los pesos y el cambio, y la
      cuenta cae a un cambio razonable cuando falta.

   Todos los instantes se arman con el −03:00 de Argentina para que den lo mismo
   en cualquier máquina.
   ================================================================== */

/** Un instante de Argentina: `ar("2026-09-30", "16:00:00")`. */
const ar = (dia: string, hora = "12:00:00", ms = "000") => new Date(`${dia}T${hora}.${ms}-03:00`).toISOString();

/** Una venta (v1) con un cobro por cada [fecha, monto], y las devoluciones que se le pasen. */
function conCobros(cobros: [string, number][], devoluciones: Devolucion[] = []): EstadoApp {
  const cuotas = cobros.map(([, monto], i) => ({ id: `q${i}`, ventaId: "v1", numero: i + 1, monto, estado: "pagada", esReserva: false }));
  const pagos = cobros.map(([fecha, monto], i) => pago(`p${i}`, `q${i}`, monto, 0, fecha));
  return { cuotas, pagos, devoluciones } as unknown as EstadoApp;
}

const intentar = (e: EstadoApp, monto: number, fecha: string, ignorar?: string) =>
  problemaDeDevolucion(e, { ventaId: "v1", monto, fecha, procesadorId: "proc_stripe", tieneComprobante: true }, ignorar);

/* ---------- 1 · «hasta ese día» es hasta el final del día de negocio ---------- */

test("mismo día · un cobro de las 16:00 cuenta para una devolución del mismo día, guardada a las 12:00", () => {
  const e = conCobros([[ar("2026-09-30", "16:00:00"), 1500]]);
  assert.equal(intentar(e, 1500, ar("2026-09-30")), null, "se rechazaba con «no tiene cobros hasta ese día»");
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-09-30")), { cobrado: 1500, devuelto: 0, queda: 1500 });
  /* Tampoco importa a qué hora del día se mire: es el mismo día. */
  for (const hora of ["00:00:00", "08:00:00", "23:59:59"]) {
    assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30", hora)).cobrado, 1500, hora);
  }
});

test("mismo día · el día es el de Argentina, no el de UTC: un cobro de las 22:00 (ya es el día siguiente en UTC) es de su día", () => {
  const e = conCobros([[ar("2026-09-30", "22:00:00"), 1000]]);
  assert.equal(ar("2026-09-30", "22:00:00").slice(0, 10), "2026-10-01", "en UTC ya es el 1° de octubre");
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30")).cobrado, 1000);
  assert.equal(intentar(e, 1000, ar("2026-09-30")), null);
  /* Y una devolución del 29/09 no lo ve. */
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-29", "23:59:59", "999")).cobrado, 0);
});

test("mismo día · cuenta hasta el último milisegundo del día y no el primero del siguiente", () => {
  const e = conCobros([[ar("2026-09-30", "23:59:59", "999"), 700], [ar("2026-10-01", "00:00:00", "000"), 300]]);
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-09-30")).cobrado, 700);
  assert.equal(devolvibleDeVenta(e, "v1", ar("2026-10-01")).cobrado, 1000);
  assert.match(intentar(conCobros([[ar("2026-10-01", "00:00:00"), 300]]), 300, ar("2026-09-30"))!, /no tiene cobros hasta ese día/);
});

test("mismo día · lo ya devuelto el mismo día también cuenta, a la hora que se haya cargado", () => {
  const e = conCobros([[ar("2026-10-02", "09:00:00"), 1000]], [devolucion({ id: "a", monto: 400, fecha: ar("2026-10-02", "18:30:00") })]);
  assert.deepEqual(devolvibleDeVenta(e, "v1", ar("2026-10-02")), { cobrado: 1000, devuelto: 400, queda: 600 });
  assert.equal(intentar(e, 600, ar("2026-10-02")), null);
  assert.match(intentar(e, 601, ar("2026-10-02"))!, /No se puede devolver más de lo cobrado: quedan US\$ 600 para devolver/);
});

const equipo = [miembro("c1", "Closer", "closer", 0.1)];
const ventaV1 = {
  id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: ar("2026-09-28"), moneda: "USD", closerId: "c1",
  excluidoMarketing: false, estado: "activa", creadoEn: ar("2026-09-28"), extra: {},
};
const conVenta = (e: EstadoApp) => ({ ...e, equipo, ventas: [ventaV1], honorarios: [], gastos: [], sesiones: [], liquidaciones: [] }) as unknown as EstadoApp;

test("mismo día · la reversa de comisión incluye los cobros del día de la devolución, a la hora que sean", () => {
  /* 1.500 el 28/09 a las 10:00 y 1.500 el 03/10 a las 16:00; se devuelven los 3.000 el 03/10 (a las 12:00 del formulario). */
  const cobros: [string, number][] = [[ar("2026-09-28", "10:00:00"), 1500], [ar("2026-10-03", "16:00:00"), 1500]];
  const [rv] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 3000, fecha: ar("2026-10-03") })])));
  assert.equal(rv.cobradoVenta, 3000);
  assert.equal(rv.parte, 1);
  const closer = rv.partes.find((p) => p.miembroId === "c1")!;
  assert.equal(closer.comision, 300, "se le comisionó 150 + 150");
  assert.equal(closer.reversa, 300, "revertía 150 de 300: el cobro de la tarde no entraba");
  /* La misma devolución al día siguiente revierte lo mismo: la hora del cobro no cambia nada. */
  const [dia1] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 3000, fecha: ar("2026-10-04") })])));
  assert.equal(dia1.partes.find((p) => p.miembroId === "c1")!.reversa, 300);
});

test("mismo día · una devolución del 03/10 no ve un cobro del 04/10 por temprano que sea", () => {
  const cobros: [string, number][] = [[ar("2026-09-28", "10:00:00"), 1500], [ar("2026-10-04", "00:00:00", "001"), 1500]];
  const [rv] = reversasDeComision(conVenta(conCobros(cobros, [devolucion({ id: "d1", monto: 1500, fecha: ar("2026-10-03", "23:59:59", "999") })])));
  assert.equal(rv.cobradoVenta, 1500);
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.reversa, 150);
});

test("mismo día · la ficha de la venta (ahora) y el formulario (las 12:00 del día) dicen lo mismo", () => {
  /* Hoy es el 07/10 a las 20:00 y el cobro entró a las 18:00: la ficha lo contaba y el formulario no. */
  const ahora = ar("2026-10-07", "20:00:00");
  const e = conCobros([[ar("2026-10-07", "18:00:00"), 1500]]);
  const ficha = devolvibleDeVenta(e, "v1", ahora);
  const formulario = devolvibleDeVenta(e, "v1", mediodiaDeNegocio("2026-10-07"));
  assert.deepEqual(formulario, ficha);
  assert.equal(formulario.queda, 1500);
});

test("mismo día · el formulario guarda las 12:00 de Argentina del día elegido, y ese día se lee igual desde cualquier zona", () => {
  assert.equal(mediodiaDeNegocio("2026-09-30"), "2026-09-30T15:00:00.000Z");
  assert.equal(mediodiaDeNegocio("2026-03-01"), "2026-03-01T15:00:00.000Z", "sin horario de verano");
  for (let d = new Date("2026-01-01T12:00:00Z"); d.getUTCFullYear() === 2026; d = new Date(d.getTime() + 86400000)) {
    const dia = d.toISOString().slice(0, 10);
    assert.equal(diaDeNegocio(mediodiaDeNegocio(dia)), dia, dia);
  }
});
