import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leerApertura } from "@/lib/abrir-desde-url";

/* Mariano (21/10, video): buscaba a un lead con ⌘K, tocaba el resultado de la Agenda y «no pasa nada». La primera vez abría; desde la segunda,
   estando en la misma pantalla, no: el «ya lo abrí» nunca se liberaba. */

const url = (s: string) => new URLSearchParams(s);

test("un ?ver= abre la ficha una vez", () => {
  const a = leerApertura(url("ver=ses_1"), false);
  assert.deepEqual(a.abrir, { nuevo: false, ver: "ses_1" });
  assert.equal(leerApertura(url("ver=ses_1"), a.consumido).abrir, null, "mientras el link siga puesto no se reabre");
});

test("al sacar el ?ver= de la URL, la próxima búsqueda vuelve a abrir (el bug del video)", () => {
  let c = leerApertura(url("ver=ses_1"), false).consumido;
  c = leerApertura(url(""), c).consumido;
  assert.equal(c, false);
  assert.deepEqual(leerApertura(url("ver=ses_2"), c).abrir, { nuevo: false, ver: "ses_2" });
});

test("?nuevo=1 se comporta igual y los filtros solos no abren nada", () => {
  assert.deepEqual(leerApertura(url("nuevo=1"), false).abrir, { nuevo: true, ver: null });
  assert.equal(leerApertura(url("estado=hecha&q=ari"), false).abrir, null);
});

test("el hook usa la función y no vuelve a guardar el «ya lo abrí» para siempre", () => {
  const src = readFileSync("src/lib/useQuery.ts", "utf8");
  assert.match(src, /leerApertura\(params, consumido\.current\)/);
  assert.doesNotMatch(src, /if \(consumido\.current\) return;/);
});

test("una llamada se abre en la ficha de la persona, no en un panel al costado (Juan Cruz, 21/10)", () => {
  const agenda = readFileSync("src/app/(app)/agenda/page.tsx", "utf8");
  assert.match(agenda, /abrirFicha\(s\.id, "llamadas"\)/);
  assert.match(agenda, /onClick=\{\(\) => abrirLlamada\(s\) \?\? setVer\(s\.id\)\}/, "el click en la fila abre la ficha");
  const paleta = readFileSync("src/components/shell/Paleta.tsx", "utf8");
  assert.match(paleta, /\/agenda\?ficha=\$\{s\.id\}&vista=llamadas/, "el buscador lleva a la ficha");
});
