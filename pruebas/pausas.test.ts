import test from "node:test";
import assert from "node:assert/strict";
import { conPausa, finConPausas, inicioReal, pausaEnCurso, problemaDePausa } from "@/lib/pausas";
import { sumarMeses } from "@/lib/clientes-cs";
import type { PausaServicio } from "@/lib/types";

/* Lili (22/10): «entra el 22/10 por 3 meses con 60 días de demora: cursa del 22/12 al 22/03; si pausa del 30/12 al 30/01,
   termina el 22/04». */

const p = (tipo: PausaServicio["tipo"], desde: string, hasta: string, id = `${tipo}-${desde}`): PausaServicio =>
  ({ id, tipo, desde, hasta, motivo: "", creadoEn: "", creadoPor: "" });
const tres = (desde: string) => sumarMeses(desde, 3);

test("el ejemplo de Lili: 60 días de demora y una pausa de un mes", () => {
  const demora = p("demora", "2026-10-22", "2026-12-22");
  assert.equal(inicioReal("2026-10-22", [demora]), "2026-12-22");
  assert.equal(finConPausas("2026-10-22", tres("2026-10-22"), [demora], tres), "2027-03-22");
  const pausa = p("pausa", "2026-12-30", "2027-01-30");
  assert.equal(finConPausas("2026-10-22", tres("2026-10-22"), [demora, pausa], tres), "2027-04-22");
});

test("con el fin escrito a mano, la demora y la pausa lo corren por días", () => {
  assert.equal(finConPausas("2026-10-01", "2027-01-01", [p("pausa", "2026-11-01", "2026-11-11")]), "2027-01-11");
  assert.equal(finConPausas("2026-10-01", "2027-01-01", [p("demora", "2026-10-01", "2026-10-31")]), "2027-01-31");
  assert.equal(finConPausas("2026-10-01", null, [p("pausa", "2026-11-01", "2026-11-11")]), null);
});

test("la pausa en curso va desde el día que pausa hasta el día antes de retomar", () => {
  const lista = [p("pausa", "2026-12-30", "2027-01-30")];
  assert.equal(pausaEnCurso(lista, "2026-12-29"), null);
  assert.ok(pausaEnCurso(lista, "2026-12-30"));
  assert.ok(pausaEnCurso(lista, "2027-01-29"));
  assert.equal(pausaEnCurso(lista, "2027-01-30"), null, "el día que retoma ya cursa");
});

test("los topes: demora hasta 60 días, pausas hasta 45 entre todas, sin superponerse", () => {
  assert.equal(problemaDePausa(p("demora", "2026-10-22", "2026-12-22"), "2026-10-22", []), null, "dos meses: lo que Lili cuenta como 60 días");
  assert.match(problemaDePausa(p("demora", "2026-10-22", "2026-12-23"), "2026-10-22", []) ?? "", /hasta 60 días \(dos meses\): con ésta serían 62/);
  assert.equal(problemaDePausa(p("demora", "2026-12-31", "2027-03-01"), "2026-12-31", []), null, "60 días aunque febrero sea corto");
  assert.match(problemaDePausa(p("pausa", "2026-11-10", "2026-11-05"), "2026-10-22", []) ?? "", /después/);
  assert.equal(problemaDePausa(p("pausa", "2026-11-01", "2026-12-01"), "2026-10-22", []), null);
  const ya = [p("pausa", "2026-11-01", "2026-12-01")];
  assert.match(problemaDePausa(p("pausa", "2026-11-20", "2026-11-25"), "2026-10-22", ya) ?? "", /superpone/);
  assert.match(problemaDePausa(p("pausa", "2027-01-01", "2027-01-20"), "2026-10-22", ya) ?? "", /suman hasta 45 días: con ésta serían 49/);
  assert.match(problemaDePausa(p("pausa", "2026-11-01", "2026-11-10"), "2026-10-22", [p("demora", "2026-10-22", "2026-12-01")]) ?? "", /antes de que arranque/);
});

test("la demora es una sola: una nueva reemplaza la anterior; borrar saca sólo esa", () => {
  const a = conPausa([], p("demora", "2026-10-22", "2026-11-22", "d1"));
  const b = conPausa(a, p("demora", "2026-10-22", "2026-12-01", "d2"));
  assert.deepEqual(b.map((x) => x.id), ["d2"]);
  const c = conPausa(b, p("pausa", "2026-12-10", "2026-12-20", "p1"));
  assert.deepEqual(c.map((x) => x.id), ["d2", "p1"]);
  assert.deepEqual(conPausa(c, c[1], true).map((x) => x.id), ["d2"]);
});
