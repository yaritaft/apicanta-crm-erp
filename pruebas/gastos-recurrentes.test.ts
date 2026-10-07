import test from "node:test";
import assert from "node:assert/strict";
import {
  cargadoEnElMes, cuantosFaltan, fechaDelGastoFijo, gastoAprobado, mesDe, montoDelMesAnterior, plantillasDesdeGastos,
  propuestas, sumarMeses,
} from "@/lib/gastos-recurrentes";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto, GastoRecurrente } from "@/lib/types";

/* ==================================================================
   F1-11 · Gastos fijos de software, con aprobación.

   «Fathom pagamos más o menos lo mismo todos los meses: ¿este mes fue 140?»
   Lo que se prueba: que se propone con el monto del mes anterior, que NADA
   se carga sin aprobar, que aprobar (con o sin corrección) suma exactamente
   ese monto al mes, que saltear sólo saltea ese mes y que no se duplica
   con lo que alguien cargó a mano.
   ================================================================== */

const HOY = "2026-10-20T15:00:00.000Z";

const fathom = (extra: Partial<GastoRecurrente> = {}): GastoRecurrente => ({
  id: "rec_fathom", concepto: "Fathom", categoria: "Software y herramientas", grupo: "operativo", proveedor: "Fathom",
  monto: 140, moneda: "USD", diaDelMes: 15, activo: true, desde: "2026-09", salteados: [], creadoEn: "2026-09-10T12:00:00.000Z", ...extra,
});

const gasto = (id: string, concepto: string, monto: number, fecha: string, extra: Partial<Gasto> = {}): Gasto => ({
  id, categoria: "Software y herramientas", grupo: "operativo", concepto, monto, moneda: "USD", fecha,
  recurrente: true, creadoEn: fecha, extra: {}, ...extra,
});

const estado = (gastos: Gasto[], plantillas: GastoRecurrente[]): EstadoApp => ({ ...construirSemilla(), gastos, gastosRecurrentes: plantillas });
const totalDelMes = (e: EstadoApp, mes: string) => e.gastos.filter((g) => mesDe(g.fecha) === mes).reduce((a, g) => a + g.monto, 0);

test("los meses y los días se cuentan en hora argentina", () => {
  assert.equal(mesDe("2026-10-01T01:00:00.000Z"), "2026-09");
  assert.equal(mesDe("2026-10-01T03:00:00.000Z"), "2026-10");
  assert.equal(sumarMeses("2026-12", 1), "2027-01");
  assert.equal(sumarMeses("2026-01", -2), "2025-11");
  assert.equal(fechaDelGastoFijo("2026-02", 31), "2026-02-28T15:00:00.000Z");
  assert.equal(mesDe(fechaDelGastoFijo("2026-10", 1)), "2026-10");
});

test("se propone con el monto del mes anterior y no carga nada solo", () => {
  const e = estado([gasto("g1", "Fathom", 140, "2026-09-15T15:00:00.000Z")], [fathom({ desde: "2026-10" })]);
  const antes = e.gastos.length;
  const p = propuestas(e, HOY);
  assert.equal(p.length, 1);
  assert.equal(p[0].mes, "2026-10");
  assert.equal(p[0].monto, 140);
  assert.equal(p[0].deMes, "2026-09");
  assert.equal(p[0].leToca, true);
  assert.equal(cuantosFaltan(e, HOY), 1);
  assert.equal(e.gastos.length, antes, "proponer no carga ningún gasto");
});

test("si el mes anterior fue otro monto, se propone ese (no el habitual)", () => {
  const e = estado([gasto("g1", "Fathom", 150, "2026-09-15T15:00:00.000Z")], [fathom({ desde: "2026-10", monto: 140 })]);
  assert.equal(montoDelMesAnterior(e, e.gastosRecurrentes![0], "2026-10").monto, 150);
  assert.equal(propuestas(e, HOY)[0].monto, 150);
  /* Sin ningún gasto de antes, lo habitual de la plantilla. */
  const vacio = estado([], [fathom({ desde: "2026-10", monto: 140 })]);
  assert.equal(propuestas(vacio, HOY)[0].monto, 140);
});

test("aprobar carga exactamente ese monto y la propuesta desaparece (una sola vez)", () => {
  const e0 = estado([gasto("g1", "Fathom", 140, "2026-09-15T15:00:00.000Z")], [fathom({ desde: "2026-10" })]);
  const p = propuestas(e0, HOY)[0];
  const g = gastoAprobado(p.plantilla, p.mes, p.monto, HOY, "Angelo");
  assert.equal(g.monto, 140);
  assert.equal(g.fecha, "2026-10-15T15:00:00.000Z");
  assert.equal(g.extra.recurrenteId, "rec_fathom");
  assert.equal(g.extra.recurrenteMes, "2026-10");
  const e1: EstadoApp = { ...e0, gastos: [g, ...e0.gastos] };
  assert.equal(totalDelMes(e1, "2026-10") - totalDelMes(e0, "2026-10"), 140);
  assert.equal(propuestas(e1, HOY).length, 0);
  assert.equal(cuantosFaltan(e1, HOY), 0);
  /* Aprobar dos veces da el mismo id: el almacén lo pisa, no lo duplica. */
  assert.equal(gastoAprobado(p.plantilla, p.mes, 140, HOY).id, g.id);
});

test("corregir el monto: aprueba con el monto nuevo y el mes que viene se propone ése", () => {
  const e0 = estado([gasto("g1", "Fathom", 140, "2026-09-15T15:00:00.000Z")], [fathom({ desde: "2026-10" })]);
  const g = gastoAprobado(e0.gastosRecurrentes![0], "2026-10", 162.5, HOY);
  assert.equal(g.monto, 162.5);
  const e1: EstadoApp = { ...e0, gastos: [g, ...e0.gastos] };
  const noviembre = propuestas(e1, "2026-11-20T15:00:00.000Z");
  assert.equal(noviembre.length, 1);
  assert.equal(noviembre[0].mes, "2026-11");
  assert.equal(noviembre[0].monto, 162.5);
});

test("saltear un mes sólo saltea ese mes", () => {
  const e = estado([gasto("g1", "Fathom", 140, "2026-08-15T15:00:00.000Z")], [fathom({ desde: "2026-09", salteados: ["2026-09"] })]);
  const meses = propuestas(e, HOY).map((p) => p.mes);
  assert.deepEqual(meses, ["2026-10"]);
  assert.equal(propuestas(e, "2026-11-20T15:00:00.000Z").some((p) => p.mes === "2026-09"), false);
});

test("lo que alguien cargó a mano ese mes no se vuelve a proponer", () => {
  const manual = gasto("g2", "fathom", 143, "2026-10-04T15:00:00.000Z", { recurrente: false });
  const e = estado([manual], [fathom({ desde: "2026-10" })]);
  assert.ok(cargadoEnElMes(e, e.gastosRecurrentes![0], "2026-10"));
  assert.equal(propuestas(e, HOY).length, 0);
});

test("todavía no le toca: se ve pero no entra en el aviso", () => {
  const e = estado([], [fathom({ desde: "2026-10", diaDelMes: 25 })]);
  const p = propuestas(e, HOY);
  assert.equal(p.length, 1);
  assert.equal(p[0].leToca, false);
  assert.equal(cuantosFaltan(e, HOY), 0);
});

test("lo que quedó sin aprobar de los últimos meses sigue ahí, pero no para siempre", () => {
  const e = estado([], [fathom({ desde: "2026-01" })]);
  const meses = propuestas(e, HOY).map((p) => p.mes);
  assert.deepEqual(meses, ["2026-08", "2026-09", "2026-10"]);
  assert.equal(propuestas(e, HOY)[0].atrasada, true);
  assert.equal(propuestas(e, HOY)[2].atrasada, false);
});

test("una plantilla pausada no propone, y no propone antes de su primer mes", () => {
  assert.equal(propuestas(estado([], [fathom({ desde: "2026-10", activo: false })]), HOY).length, 0);
  assert.equal(propuestas(estado([], [fathom({ desde: "2026-11" })]), HOY).length, 0);
});

test("armar las plantillas con los gastos «Fijo» ya cargados", () => {
  const gastos = [
    gasto("a1", "Fathom", 140, "2026-08-15T15:00:00.000Z"),
    gasto("a2", "Fathom", 150, "2026-09-16T15:00:00.000Z"),
    gasto("b1", "EverWebinar", 99, "2026-09-03T15:00:00.000Z"),
    gasto("c1", "Pauta Meta", 5000, "2026-09-10T15:00:00.000Z", { recurrente: false }),
    gasto("d1", "Sueldo Juan", 3000, "2026-09-28T15:00:00.000Z", { grupo: "dueno" }),
    gasto("e1", "Zapier", 30, "2026-09-05T15:00:00.000Z"),
  ];
  const e = estado(gastos, [fathom({ id: "rec_zapier", concepto: "Zapier" })]);
  let n = 0;
  const hechas = plantillasDesdeGastos(e, HOY, () => `rec_${++n}`);
  assert.deepEqual(hechas.map((t) => t.concepto), ["EverWebinar", "Fathom"]);
  const f = hechas.find((t) => t.concepto === "Fathom")!;
  assert.equal(f.monto, 150, "el monto del último");
  assert.equal(f.diaDelMes, 16);
  assert.equal(f.desde, "2026-10", "propone desde el mes que sigue al último cargado");
});
