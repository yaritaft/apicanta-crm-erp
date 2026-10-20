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

/* Dante (20/10): «tengo algunas en el CRM que no me aparecen en el cerrar el día». Eran ya cargadas, canceladas por Calendly o que
   todavía no empezaron: el cierre no las pide, pero tienen que verse. */
import { repasoDelDia } from "@/lib/eod";

test("el repaso del día trae TODAS las llamadas de venta del closer, cada una en su grupo, en orden de hora", () => {
  const AHORA = Date.parse("2026-10-20T20:00:00.000Z");
  const e = {
    equipo: [],
    sesiones: [
      { id: "tarde", tipo: "Llamada de Asesoramiento - Setter", anfitrion: "Dante Barbieri", inicia: "2026-10-20T23:00:00.000Z", estado: "agendada" },
      { id: "cargada", tipo: "Llamada de Asesoramiento - Webinar - Team", anfitrion: "Dante Barbieri", inicia: "2026-10-20T14:00:00.000Z", estado: "hecha" },
      { id: "falta", tipo: "Llamada de Asesoramiento - Webinar - Team", anfitrion: "Dante Barbieri", inicia: "2026-10-20T16:00:00.000Z", estado: "agendada" },
      { id: "cancelada", tipo: "Llamada de Asesoramiento - Setter", anfitrion: "Dante Barbieri", inicia: "2026-10-20T15:00:00.000Z", estado: "cancelada" },
      { id: "resell", tipo: "Llamada de Asesoramiento - Próximos pasos", anfitrion: "Dante Barbieri", inicia: "2026-10-20T17:00:00.000Z", estado: "agendada" },
      { id: "ajena", tipo: "Llamada de Asesoramiento - Webinar - Team", anfitrion: "Mariano Arias", inicia: "2026-10-20T15:00:00.000Z", estado: "agendada" },
      { id: "otro-dia", tipo: "Llamada de Asesoramiento - Webinar - Team", anfitrion: "Dante Barbieri", inicia: "2026-10-19T15:00:00.000Z", estado: "agendada" },
    ],
  };
  const sinCargar: Record<string, boolean> = { cargada: false, falta: true };
  const r = repasoDelDia(e as never, "Dante Barbieri", "2026-10-20", AHORA, (id) => sinCargar[id]);
  assert.deepEqual(r.map((x) => [x.s.id, x.grupo]), [["cargada", "cargada"], ["cancelada", "cancelada"], ["falta", "cargar"], ["tarde", "despues"]],
    "sin la de resell, la de otro closer ni la de otro día");
});

test("el cierre muestra ese repaso antes de empezar", () => {
  const eod = readFileSync("src/components/crm-tabla/Eod.tsx", "utf8");
  assert.match(eod, /repasoDelDia\(e, closer, dia, ahora/);
  assert.match(eod, /Tus llamadas del/);
  assert.match(eod, /Cancelada en Calendly/);
});
