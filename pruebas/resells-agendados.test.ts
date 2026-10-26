import test from "node:test";
import assert from "node:assert/strict";
import { mesEnLetras, otroMes, resellsDelMes, resumenResells, textoParaPasar } from "@/lib/resells-agendados";
import { calcularLiquidacion, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import type { Resell } from "@/lib/types";
import { concepto, esquema, estadoDePrueba } from "./estado-liquidacion";

/* Lili (26/10): «a fin de mes saber cuántos resells agendé en el mes, porque es parte del sueldo». La liquidación contaba
   las llamadas con utm_source «Resell» y los resells que entran por «Próximos pasos» no lo traen: octubre daba 0. Ahora la
   cuenta sale de su agenda, por el día de la reserva (lib/resells-agendados.ts), y la usan su panel y la liquidación. */

const resell = (id: string, r: Partial<Resell> = {}): Resell => ({
  id, sesionId: `cal_${id}`, fechaHora: "2026-10-20T15:00:00.000Z", nombre: `Alumno ${id}`, email: `${id}@x.com`, telefono: "",
  closer: "Mariano Arias", estado: "", cashCollect: null, casoDeExito: false, notas: "", cancelada: false, origen: "calendly",
  creadoEn: "2026-10-01T12:00:00.000Z", actualizadoEn: "2026-10-01T12:00:00.000Z", actualizadoPor: "", ...r,
});

const agenda: Resell[] = [
  resell("a", { agendadoEn: "2026-10-02T14:00:00.000Z" }),
  /* Reservado el 30/09 para una llamada en octubre: cuenta en septiembre, cuando se agendó. */
  resell("b", { agendadoEn: "2026-09-30T18:00:00.000Z", fechaHora: "2026-10-03T15:00:00.000Z" }),
  /* El 31/10 a las 22 de Argentina ya es 1/11 en UTC: es de octubre. */
  resell("c", { agendadoEn: "2026-11-01T01:00:00.000Z", closer: "Dante Barbieri", casoDeExito: true }),
  resell("d", { agendadoEn: "2026-10-05T14:00:00.000Z", cancelada: true }),
  /* Del Airtable, sin la reserva: cuenta por el día de la llamada. */
  resell("e", { sesionId: null, origen: "importado", fechaHora: "2026-10-10T15:00:00.000Z", closer: "Martin,Mariano" }),
  resell("f", { sesionId: null, origen: "importado", fechaHora: "2026-09-10T15:00:00.000Z" }),
];

test("los resells del mes: por el día de la reserva en Argentina, sin los cancelados, y los del Airtable por el de la llamada", () => {
  const oct = resellsDelMes(agenda, "2026-10");
  assert.deepEqual(oct.map((x) => x.resell.id), ["a", "e", "c"]);
  assert.deepEqual(oct.map((x) => x.dia), ["2026-10-02", "2026-10-10", "2026-10-31"]);
  assert.deepEqual(oct.map((x) => x.porLlamada), [false, true, false]);
  assert.deepEqual(resellsDelMes(agenda, "2026-09").map((x) => x.resell.id), ["f", "b"]);
  assert.deepEqual(resellsDelMes(agenda, "2026-11"), []);
  assert.equal(resellsDelMes(undefined, "2026-10").length, 0);
});

test("el resumen por closer y el texto para pasar", () => {
  const oct = resellsDelMes(agenda, "2026-10");
  assert.deepEqual(resumenResells(oct), { total: 3, testimonio: 1, porCloser: [{ closer: "Mariano", n: 1 }, { closer: "Dante", n: 1 }, { closer: "Martin", n: 1 }].sort((a, b) => a.closer.localeCompare(b.closer, "es")) });
  const t = textoParaPasar("2026-10", oct);
  assert.match(t, /^Resells agendados en octubre de 2026: 3\n/);
  assert.match(t, /1 de testimonio/);
  assert.match(t, /• Alumno a \(con Mariano, agendado el 02\/10, llamada el 20\/10\)/);
  assert.match(t, /• Alumno e \(con Martin, llamada el 10\/10\)/);
  assert.equal(textoParaPasar("2026-11", []), "Resells agendados en noviembre de 2026: 0");
});

test("los meses", () => {
  assert.equal(otroMes("2026-10", -1), "2026-09");
  assert.equal(otroMes("2026-12", 1), "2027-01");
  assert.equal(otroMes("2026-01", -1), "2025-12");
  assert.equal(mesEnLetras("2026-09"), "septiembre de 2026");
});

test("la liquidación cuenta los resells de la agenda: el mismo número que ve Customer Success", () => {
  const e = estadoDePrueba();
  /* El concepto de Lili, como quedó en producción (supabase/resells-agendado-en.sql): de la agenda y ya no por utm_source. */
  e.honorarios = e.honorarios.map((h) => h.miembroId === "lili"
    ? esquema("lili", [concepto({ id: "c_tramo", tipo: "tramo", nombre: "Llamadas de Resell", monto: 100, cada: 15, base: "resells" })]) : h);
  const sept = Array.from({ length: 16 }, (_, k) => resell(`s${k}`, { agendadoEn: `2026-09-${String(k + 1).padStart(2, "0")}T15:00:00.000Z` }));
  e.resells = [...sept, resell("cancelado", { agendadoEn: "2026-09-20T15:00:00.000Z", cancelada: true }), resell("oct", { agendadoEn: "2026-10-01T15:00:00.000Z" })];
  const r = calcularLiquidacion(e, "2026-09", liquidacionVacia("2026-09", "2026-10-01T12:00:00.000Z"));
  const l = renglonDe(r, "lili", "c_tramo")!.linea;
  /* 16 en septiembre (el cancelado y el de octubre no) → 1 tramo de 15. */
  assert.equal(l.monto, 100);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 16], ["tramos", 15], ["igual", 1], ["por", 100], ["igual", 100]]);
  assert.equal(l.desglose!.pasos[0].texto, "Resells agendados en el mes");
  assert.equal(resellsDelMes(e.resells, "2026-09").length, 16, "el panel de Lili da lo mismo");
});
