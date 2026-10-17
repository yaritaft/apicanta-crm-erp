import test from "node:test";
import assert from "node:assert/strict";
import { CIERRE_DEL_DIA, claveEod, diasDelEod, pendientesDeAntes, preguntasDelDia, registrosEod } from "@/lib/eod-finanzas";
import type { Chequeos } from "@/lib/finanzas-pasos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp } from "@/lib/types";

/* El cierre del día de Finanzas (el EOD de Aldana): qué se pregunta cada día, qué se arrastra y qué días quedaron sin cerrar. */

const AHORA = Date.parse("2026-10-16T15:00:00.000Z");      // viernes 16 de octubre de 2026
const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [], devoluciones: [],
});
const o = { ahora: AHORA, esDueno: true };
const ids = (e: EstadoApp, dia: string, c: Chequeos = {}) => preguntasDelDia(e, dia, c, o).map((p) => p.id);
const en = (dia: string) => `${dia}T20:00:00.000Z`;
const resp = (dia: string, tarea: string, estado: string, nota?: string) => ({ [claveEod(dia, tarea)]: { por: "Aldana", en: en(dia), estado, ...(nota ? { nota } : {}) } });
const cierre = (dia: string) => ({ [claveEod(dia, CIERRE_DEL_DIA)]: { por: "Aldana", en: en(dia), estado: "cerrado" } });

const DIARIAS = ["d-banco", "d-ingresos", "d-cuotas", "d-tareas", "d-proveedores", "d-slack", "d-financiera", "d-caja", "d-pasarelas", "d-reembolsos"];
const SEMANALES = ["s-weekly", "s-kpis-reportes", "s-finanzas", "s-suscripciones", "s-mora", "s-corte-financiera", "s-informe", "s-kpis-ceo"];

test("de lunes a jueves se piden las tareas de todos los días; el viernes se suman las de la semana", () => {
  const e = vacio();
  assert.deepEqual(ids(e, "2026-10-15"), DIARIAS, "el jueves");
  assert.deepEqual(ids(e, "2026-10-16"), [...DIARIAS, ...SEMANALES], "el viernes");
  assert.deepEqual(ids(e, "2026-10-12"), DIARIAS, "el lunes, sin nada cargado, no se arrastra nada");
});

test("lo que quedó en «No llegué» vuelve a preguntarse con lo que se dijo, hasta que se hace", () => {
  const e = vacio();
  const c = { ...resp("2026-10-14", "d-slack", "no-llegue", "esperaba a Ventas"), ...resp("2026-10-14", "d-tareas", "hecho") };
  const jueves = preguntasDelDia(e, "2026-10-15", c, o);
  assert.deepEqual(jueves.map((p) => p.id), DIARIAS, "no se duplica: la misma tarea de hoy, marcada");
  const slack = jueves.find((p) => p.id === "d-slack")!;
  assert.equal(slack.desde, "2026-10-14");
  assert.equal(slack.notaAntes, "esperaba a Ventas");
  assert.equal(jueves.find((p) => p.id === "d-tareas")!.desde, undefined, "lo que se hizo no se arrastra");
  /* El jueves lo hizo: el viernes ya no queda pendiente. */
  const c2 = { ...c, ...resp("2026-10-15", "d-slack", "hecho") };
  assert.equal(preguntasDelDia(e, "2026-10-16", c2, o).find((p) => p.id === "d-slack")!.desde, undefined);
  assert.deepEqual(pendientesDeAntes(e, "2026-10-15", c, o).map((p) => p.id), ["d-slack"]);
});

test("una tarea de la semana que quedó pendiente se pregunta cualquier día, antes que las de siempre", () => {
  const e = vacio();
  const c: Chequeos = Object.assign({}, ...SEMANALES.map((t) => resp("2026-10-16", t, t === "s-informe" ? "no-llegue" : "hecho", t === "s-informe" ? "falta la caja de Mercury" : undefined)));
  const lunes = preguntasDelDia(e, "2026-10-19", c, o);
  assert.equal(lunes[0].id, "s-informe");
  assert.equal(lunes[0].desde, "2026-10-16");
  assert.equal(lunes[0].cadencia, "semana");
  assert.equal(lunes.filter((p) => p.desde).length, 1, "las otras de la semana ya se contestaron");
  assert.ok(lunes.some((p) => p.id === "d-banco"));
});

test("si el viernes no se cerró el día, las tareas de la semana se piden igual al lunes (pero sólo si ya se venía usando)", () => {
  const e = vacio();
  /* El jueves 15 se cerró; el viernes 16 no. El lunes 19 aparecen las 8 de la semana, marcadas desde el viernes. */
  const c = { ...resp("2026-10-15", "d-slack", "hecho"), ...cierre("2026-10-15") };
  const lunes = preguntasDelDia(e, "2026-10-19", c, o);
  assert.deepEqual(lunes.slice(0, 8).map((p) => p.id), SEMANALES);
  assert.ok(lunes.slice(0, 8).every((p) => p.desde === "2026-10-16"));
  /* Si el viernes contestó una, esa no vuelve. */
  const c2 = { ...c, ...resp("2026-10-16", "s-weekly", "hecho") };
  assert.ok(!preguntasDelDia(e, "2026-10-19", c2, o).some((p) => p.id === "s-weekly" && p.desde));
  /* Sin ningún cierre anterior (primer día de uso), no se reclama nada. */
  assert.deepEqual(ids(e, "2026-10-19"), DIARIAS);
});

test("un día sin cerrar se ve como tal, pero sólo desde que se empezó a usar y sin contar los fines de semana", () => {
  const c = { ...resp("2026-10-13", "d-slack", "hecho"), ...cierre("2026-10-13"), ...cierre("2026-10-15") };
  const dias = diasDelEod(c, AHORA, 7);
  const por = Object.fromEntries(dias.map((d) => [d.dia, d.estado]));
  assert.equal(dias.length, 7);
  assert.equal(por["2026-10-10"], "descanso", "sábado");
  assert.equal(por["2026-10-11"], "descanso", "domingo");
  assert.equal(por["2026-10-12"], "descanso", "el lunes es anterior al primer cierre: no se le reclama");
  assert.equal(por["2026-10-13"], "cerrado");
  assert.equal(por["2026-10-14"], "sin-cerrar", "el miércoles se saltó");
  assert.equal(por["2026-10-15"], "cerrado");
  assert.equal(por["2026-10-16"], "hoy", "hoy todavía se puede cerrar");
  assert.equal(dias.find((d) => d.dia === "2026-10-13")!.hechas, 1);
  assert.deepEqual(diasDelEod({}, AHORA, 3).map((d) => d.estado), ["descanso", "descanso", "hoy"], "sin uso, nadie debe nada");
});

test("lo que se guardó se lee como respuesta del día, y el cierre no cuenta como una tarea", () => {
  const c = { ...resp("2026-10-14", "d-slack", "no-llegue", "nota"), ...cierre("2026-10-14"), [claveEod("2026-10-14", "d-caja")]: { por: "Aldana", en: en("2026-10-14") } };
  const r = registrosEod(c);
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.tarea === "d-caja")!.estado, "hecho", "sin estado guardado es «hecho»");
  assert.ok(!r.some((x) => x.tarea === CIERRE_DEL_DIA));
});
