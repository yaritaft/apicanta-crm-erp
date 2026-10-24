import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edadDeNacimiento, problemaDeNacimiento } from "@/lib/clientes-cs";
import { datosLimpios, nacimientoValido } from "@/lib/contratos";

/* Juan Cruz (24/10): en vez de la edad (que cambia cada año y nadie la actualiza), la fecha de nacimiento. La carga el closer en
   los datos del contrato, pasa sola a la ficha (supabase/contrato-completa-ficha.sql) y la edad se calcula. */

test("la edad sale de la fecha de nacimiento y cambia el día del cumpleaños", () => {
  assert.equal(edadDeNacimiento("1993-05-10", "2026-10-24"), 33);
  assert.equal(edadDeNacimiento("1993-10-24", "2026-10-24"), 33, "el día del cumpleaños ya los cumplió");
  assert.equal(edadDeNacimiento("1993-10-25", "2026-10-24"), 32, "un día antes, todavía no");
  assert.equal(edadDeNacimiento("2000-02-29", "2027-02-28"), 26, "nacido un 29 de febrero, en un año sin 29");
  assert.equal(edadDeNacimiento(null, "2026-10-24"), null);
  assert.equal(edadDeNacimiento("2025-01-01", "2026-10-24"), null, "una edad no creíble (1 año) no se muestra");
});

test("la fecha de nacimiento tiene que ser un día real, no futuro y de una edad creíble", () => {
  assert.equal(problemaDeNacimiento("1993-05-10", "2026-10-24"), null);
  assert.match(problemaDeNacimiento("1993-02-30", "2026-10-24") ?? "", /día válido/);
  assert.match(problemaDeNacimiento("2027-01-01", "2026-10-24") ?? "", /futuro/);
  assert.match(problemaDeNacimiento("1900-01-01", "2026-10-24") ?? "", /revisala/);
});

test("el contrato guarda sólo una fecha de nacimiento válida (no va al documento)", () => {
  assert.ok(nacimientoValido("1993-05-10"));
  assert.ok(!nacimientoValido("1993-02-30") && !nacimientoValido("10/05/1993") && !nacimientoValido("") && !nacimientoValido("2999-01-01"));
  assert.equal(datosLimpios({ nombre: "Ana", nacimiento: " 1993-05-10 " }).nacimiento, "1993-05-10");
  assert.equal("nacimiento" in datosLimpios({ nombre: "Ana", nacimiento: "1993-02-30" }), false);
  assert.doesNotMatch(readFileSync("src/lib/contratos.ts", "utf8").match(/export function variablesDelContrato[\s\S]*?\n}\n/)?.[0] ?? "", /nacimiento/,
    "no es una variable de la plantilla");
});

test("con fecha de nacimiento, la edad no se corrige a mano en la tabla", () => {
  const s = readFileSync("src/lib/clientes-cs.ts", "utf8");
  assert.match(s, /if \(f\.nacimiento\) return \{ tipo: "no", motivo: "La edad se calcula de la fecha de nacimiento: corregí esa\." \}/);
  assert.match(s, /edad: edadNac \?\? seg\.edad \?\? edadSug/);
});
