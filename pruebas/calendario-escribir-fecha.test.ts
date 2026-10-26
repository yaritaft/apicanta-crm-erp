import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatoEscrito, isoDeEscrito } from "@/components/ui/Campos";

/* Mariano (25/10): en el CRM, la fecha de nacimiento obligaba a ir mes a mes («si nació en 1980 hay que retroceder mes a
   mes hasta llegar a 1 año»). El calendario es uno solo para toda la app: se puede escribir la fecha de corrido y el
   título deja saltar de año y de mes. */

test("escribir sólo dígitos pone las barras solo", () => {
  assert.equal(formatoEscrito("0"), "0");
  assert.equal(formatoEscrito("070"), "07/0");
  assert.equal(formatoEscrito("07012004"), "07/01/2004");
  assert.equal(formatoEscrito("07/01/2004"), "07/01/2004");
  assert.equal(formatoEscrito("7-1-2004 x"), "71/20/04", "lo que no es dígito se descarta y se vuelve a cortar");
  assert.equal(formatoEscrito("0701200499"), "07/01/2004", "más de ocho dígitos no entran");
});

test("la fecha escrita sólo vale si el día existe", () => {
  assert.equal(isoDeEscrito("07/01/2004"), "2004-01-07");
  assert.equal(isoDeEscrito("29/02/2024"), "2024-02-29");
  assert.equal(isoDeEscrito("29/02/2023"), null, "2023 no fue bisiesto");
  assert.equal(isoDeEscrito("31/04/2000"), null);
  assert.equal(isoDeEscrito("00/01/2000"), null);
  assert.equal(isoDeEscrito("07/13/2000"), null);
  assert.equal(isoDeEscrito("07/01/200"), null, "incompleta");
  assert.equal(isoDeEscrito("07/01/0099"), null, "el año de cuatro cifras empieza en 1000");
  assert.equal(isoDeEscrito(""), null);
});

test("el calendario tiene el escribir y el salto de año y de mes (que no vuelva a quedar sólo con flechas de mes)", () => {
  const fuente = readFileSync("src/components/ui/Campos.tsx", "utf8");
  assert.match(fuente, /aria-label="Fecha \(dd\/mm\/aaaa\)"/, "el campo para escribir la fecha");
  assert.match(fuente, /Elegir el año y el mes/, "el título abre el año y el mes");
  assert.match(fuente, /aria-label="Año"/);
  assert.match(fuente, /aria-label="Mes"/);
  assert.match(fuente, /ev\.shiftKey \? 12 : 1/, "Mayús + RePág salta de a un año");
});
