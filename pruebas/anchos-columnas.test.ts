import test from "node:test";
import assert from "node:assert/strict";
import { ANCHO_MAX, ANCHO_MIN, anchoValido, claveDeAnchos, leerAnchos } from "@/lib/anchos-columnas";

/* El ancho de las columnas de la planilla de Webinars (21/10): cada uno lo ajusta y queda guardado en su navegador. */

test("el ancho se acota: ni una columna que desaparece ni una que se come la pantalla", () => {
  assert.equal(anchoValido(10), ANCHO_MIN);
  assert.equal(anchoValido(100.6), 101);
  assert.equal(anchoValido(5000), ANCHO_MAX);
});

test("lo guardado se lee sin creerle: lo que no es un ancho se descarta y lo demás se acota", () => {
  assert.deepEqual(leerAnchos(JSON.stringify({ formularios: 140, grupoWpp: "ancho", cpa: null, asistentes: 9999, otra: 20 })), { formularios: 140, asistentes: ANCHO_MAX, otra: ANCHO_MIN });
  for (const roto of [null, undefined, "", "no es json", "[1,2]", "7", "null"]) assert.deepEqual(leerAnchos(roto), {}, String(roto));
});

test("cada planilla guarda sus anchos con su propia clave", () => {
  assert.notEqual(claveDeAnchos("webinars"), claveDeAnchos("otra"));
  assert.match(claveDeAnchos("webinars"), /^apicanta:anchos:/);
});
