import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fueraDelPeriodo } from "@/lib/agenda-fuera-del-periodo";
import { rangoDePreset } from "@/components/ui/DateRangePicker";

/* Manuel (19/11): «cuando pongo el webinar del 11/11 me aparecen nada más 5 llamadas de webinar, 1 de clase 0 y 1
   de Q&A». El lanzamiento tiene 131 agendas (consulta a producción): 126 ya pasaron, 5 son de hoy en adelante, y el
   período por defecto es «Todo lo próximo». Los números eran ciertos; faltaba avisar que había más afuera. */

type S = { id: string; dia: string; vivo: boolean };
const sesion = (id: number, dia: string, vivo = false): S => ({ id: `s${id}`, dia, vivo });
const tieneDia = (s: S) => Boolean(s.dia);

/* El lanzamiento del 11/11 como estaba en producción: 126 pasadas y 5 de hoy en adelante. */
const lanzamiento = (): S[] => [
  ...Array.from({ length: 126 }, (_, i) => sesion(i, i < 88 ? "2026-11-13" : "2026-11-17")),
  ...Array.from({ length: 5 }, (_, i) => sesion(200 + i, "2026-11-19")),
];
const proximo = (xs: S[]) => xs.filter((s) => s.dia >= "2026-11-19");

test("el caso de Manuel: de 131 agendas del lanzamiento el período deja ver 5 y el aviso cuenta las otras 126", () => {
  const todas = lanzamiento();
  const dentro = proximo(todas);
  assert.equal(dentro.length, 5);
  assert.equal(fueraDelPeriodo(todas, dentro, tieneDia, () => true), 126);
});

test("el aviso cuenta sólo lo que coincide con los filtros: las de otros webinars no suman", () => {
  const otras = Array.from({ length: 40 }, (_, i) => sesion(500 + i, "2026-10-20"));
  const todas = [...lanzamiento(), ...otras];
  const esDelLanzamiento = (s: S) => Number(s.id.slice(1)) < 500;
  assert.equal(fueraDelPeriodo(todas, proximo(todas), tieneDia, esDelLanzamiento), 126);
  /* Sin filtro que recorte, lo de afuera es todo lo demás: la pantalla no llama a esto (no hay filtros). */
  assert.equal(fueraDelPeriodo(todas, proximo(todas), tieneDia, () => true), 166);
});

test("una llamada sin día no cuenta: ningún período la va a mostrar", () => {
  const todas = [sesion(1, "2026-11-10"), sesion(2, "")];
  assert.equal(fueraDelPeriodo(todas, [], tieneDia, () => true), 1);
});

test("si el período ya las muestra a todas, no queda nada afuera", () => {
  const todas = lanzamiento();
  assert.equal(fueraDelPeriodo(todas, todas, tieneDia, () => true), 0);
  assert.equal(fueraDelPeriodo([], [], tieneDia, () => true), 0);
});

test("«Ver todas» usa el período Máximo, que va de la primera a la última llamada con datos", () => {
  const r = rangoDePreset("max", "2026-04-14", true, undefined, "2026-12-02");
  assert.deepEqual(r, { preset: "max", desde: "2026-04-14", hasta: "2026-12-02" });
});

test("la Agenda muestra el aviso sólo si hay algo afuera y lo cuenta con los filtros y la búsqueda", () => {
  const page = readFileSync("src/app/(app)/agenda/page.tsx", "utf8");
  assert.match(page, /import \{ fueraDelPeriodo \} from "@\/lib\/agenda-fuera-del-periodo"/);
  /* Sólo se calcula si hay una búsqueda o un filtro que recorte... */
  assert.match(page, /const hayCorte = t !== "" \|\| FACETAS\.some\(\(k\) => f\[k\]\.length > 0\)/);
  /* ...con la misma búsqueda y los mismos filtros que la lista. */
  assert.match(page, /fueraDelPeriodo\(e\.sesiones, enPeriodo,[^\n]*normal\(`\$\{s\.invitado\} \$\{s\.email \?\? ""\}`\)\.includes\(t\)\) && pasa\(s\)\)/);
  assert.match(page, /\{fuera > 0 && \(/);
  assert.match(page, /rangoDePreset\("max", limites\.min, true, undefined, limites\.max\)/);
  assert.match(page, /onClick=\{verTodas\}>Ver todas</);
});
