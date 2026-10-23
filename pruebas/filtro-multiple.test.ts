import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aURL, elegidosValidos, listaDeURL, pasaFiltro, textoDelFiltro } from "@/lib/filtro-multiple";

/* Estado de llamada con varias opciones a la vez en la Agenda (Santi, 23/10): Inasistió y Reagendó juntos. */

test("la URL guarda varias opciones separadas por «|» y un link de antes (una sola) sigue andando", () => {
  assert.deepEqual(listaDeURL("Inasistió|Reagendó"), ["Inasistió", "Reagendó"]);
  assert.deepEqual(listaDeURL("Inasistió"), ["Inasistió"]);
  assert.deepEqual(listaDeURL(""), []);
  assert.deepEqual(listaDeURL(null), []);
  assert.equal(aURL(["Inasistió", "Reagendó"]), "Inasistió|Reagendó");
  assert.equal(aURL([]), null);
});

test("lo que ya no existe se ignora, lo demás se queda", () => {
  const existentes = [{ valor: "Inasistió" }, { valor: "Reagendó" }];
  assert.deepEqual(elegidosValidos("Inasistió|Fantasma|Reagendó", existentes), ["Inasistió", "Reagendó"]);
  assert.deepEqual(elegidosValidos("Fantasma", existentes), []);
});

test("pasa la llamada que tiene cualquiera de las elegidas; sin elegir, todas", () => {
  assert.equal(pasaFiltro([], "Compra Full"), true);
  assert.equal(pasaFiltro(["Inasistió", "Reagendó"], "Reagendó"), true);
  assert.equal(pasaFiltro(["Inasistió", "Reagendó"], "Inasistió"), true);
  assert.equal(pasaFiltro(["Inasistió", "Reagendó"], "Compra Full"), false);
});

test("el botón dice nada, la opción sola, o la primera y cuántas más", () => {
  const t = (v: string) => v;
  assert.equal(textoDelFiltro([], t, "Estado"), "Estado");
  assert.equal(textoDelFiltro(["Inasistió"], t, "Estado"), "Inasistió");
  assert.equal(textoDelFiltro(["Inasistió", "Reagendó", "Canceló"], t, "Estado"), "Inasistió +2");
});

test("la Agenda usa el filtro de varias opciones para estado, webinar, tipo, anfitrión y canal", () => {
  const agenda = readFileSync(new URL("../src/app/(app)/agenda/page.tsx", import.meta.url), "utf8");
  for (const k of ["estado", "webinar", "tipo", "anfitrion", "canal"]) assert.match(agenda, new RegExp(`<FiltroMulti[^>]*valores=\\{f\\.${k}\\}`), k);
  assert.match(agenda, /pasaFiltro\(f\[k\]/);
});
