import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cuentaRegresiva, ESPERA_PARA_BLOQUEAR_MS, hayQueActualizar } from "@/lib/version-app";

/* ==================================================================
   El cartel de «hay una versión nueva, actualizá» (Juan Cruz, 23/10:
   «sí o sí»): cuándo aparece y cuánto margen da antes de bloquear.
   ================================================================== */

test("aparece cuando se publica otra versión", () => {
  assert.equal(hayQueActualizar({ version: "dpl_a", recarga: null }, { version: "dpl_a", recarga: null }), false);
  assert.equal(hayQueActualizar({ version: "dpl_a", recarga: null }, { version: "dpl_b", recarga: null }), true);
  /* Sin versión conocida (la app local) no se inventa una diferencia. */
  assert.equal(hayQueActualizar({ version: "", recarga: null }, { version: "dpl_b", recarga: null }), false);
});

test("aparece cuando un dueño pide que todos actualicen después de que se abrió la pestaña", () => {
  const abierta = { version: "dpl_a", recarga: "2026-10-23T19:00:00.000Z" };
  assert.equal(hayQueActualizar(abierta, { version: "dpl_a", recarga: "2026-10-23T19:00:00.000Z" }), false, "el pedido viejo ya lo tenía");
  assert.equal(hayQueActualizar(abierta, { version: "dpl_a", recarga: "2026-10-23T20:10:00.000Z" }), true);
  assert.equal(hayQueActualizar({ version: "dpl_a", recarga: null }, { version: "dpl_a", recarga: "2026-10-23T20:10:00.000Z" }), true);
});

test("da dos minutos para guardar y la cuenta se lee como reloj", () => {
  assert.equal(ESPERA_PARA_BLOQUEAR_MS, 120_000);
  assert.equal(cuentaRegresiva(120_000), "2:00");
  assert.equal(cuentaRegresiva(65_400), "1:06");
  assert.equal(cuentaRegresiva(-5), "0:00");
});

test("la versión se fija al compilar (la misma para el servidor y el navegador) y el cartel está en el Shell", () => {
  assert.match(readFileSync("next.config.ts", "utf8"), /env:\s*\{\s*VERSION_APP\s*\}/);
  assert.match(readFileSync("src/app/api/version/route.ts", "utf8"), /process\.env\.VERSION_APP/);
  assert.match(readFileSync("src/components/shell/Shell.tsx", "utf8"), /<AvisoVersion \/>/);
  /* Nunca recarga sola: perdería lo que alguien tiene a medio escribir. */
  const aviso = readFileSync("src/components/shell/AvisoVersion.tsx", "utf8");
  assert.equal((aviso.match(/location\.reload\(\)/g) ?? []).length, 1);
  assert.match(aviso, /const recargar = \(\) => window\.location\.reload\(\)/);
});
