import test from "node:test";
import assert from "node:assert/strict";
import { esErrorDeCarga, puedeRecargarSola } from "@/lib/error-de-carga";

test("reconoce los errores de una versión vieja abierta (un archivo que ya no está) y no confunde con otros", () => {
  assert.ok(esErrorDeCarga({ name: "ChunkLoadError", message: "Loading chunk 4521 failed." }));
  assert.ok(esErrorDeCarga({ message: "Loading chunk app/(app)/finanzas/page failed. (error: https://x/_next/static/chunks/abc.js)" }));
  assert.ok(esErrorDeCarga({ message: "Failed to fetch dynamically imported module: https://x/_next/static/chunks/abc.js" }));
  assert.ok(esErrorDeCarga({ message: "error loading dynamically imported module" }));
  assert.ok(esErrorDeCarga({ message: "Importing a module script failed." }));
  assert.ok(!esErrorDeCarga({ message: "Cannot read properties of undefined (reading 'map')" }));
  assert.ok(!esErrorDeCarga({ name: "TypeError", message: "x is not a function" }));
  assert.ok(!esErrorDeCarga(null));
  assert.ok(!esErrorDeCarga(undefined));
});

test("se recarga sola una vez y no entra en un bucle", () => {
  const ahora = 1_000_000_000;
  assert.equal(puedeRecargarSola(null, ahora), true, "nunca se recargó");
  assert.equal(puedeRecargarSola("", ahora), true);
  assert.equal(puedeRecargarSola("basura", ahora), true);
  assert.equal(puedeRecargarSola(String(ahora - 5_000), ahora), false, "recién se recargó: si falla de nuevo, que muestre el error");
  assert.equal(puedeRecargarSola(String(ahora - 59_999), ahora), false);
  assert.equal(puedeRecargarSola(String(ahora - 61_000), ahora), true, "pasó más de un minuto");
});
