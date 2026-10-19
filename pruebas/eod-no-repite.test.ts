import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { llamadasParaCargar } from "@/lib/eod";

/* Dante (19/10): el cierre del día le mostraba de vuelta llamadas que ya había cargado. */
const dia = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const sinCargar: Record<string, boolean | undefined> = { a: false, b: true, c: false, d: undefined };

test("el cierre del día no vuelve a pedir las llamadas ya cargadas", () => {
  const r = llamadasParaCargar(dia, (id) => sinCargar[id], false);
  assert.deepEqual(r.paraCargar.map((l) => l.id), ["b", "d"], "quedan la que falta y la que no se sabe");
  assert.equal(r.cargadas, 2);
});

test("revisar las cargadas las suma, en el mismo orden", () => {
  const r = llamadasParaCargar(dia, (id) => sinCargar[id], true);
  assert.deepEqual(r.paraCargar.map((l) => l.id), ["a", "b", "c", "d"]);
  assert.equal(r.cargadas, 2);
});

test("un día todo cargado no tiene nada para pasar, pero dice cuántas hay", () => {
  const r = llamadasParaCargar([{ id: "x" }, { id: "y" }], () => false, false);
  assert.deepEqual(r.paraCargar, []);
  assert.equal(r.cargadas, 2);
});

test("el cierre usa esa lista y muestra cuáles son antes de empezar", () => {
  const eod = readFileSync("src/components/crm-tabla/Eod.tsx", "utf8");
  assert.match(eod, /llamadasParaCargar\(empezadas/);
  assert.match(eod, /Las que vas a pasar/);
});
