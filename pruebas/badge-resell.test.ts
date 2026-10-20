import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esLlamadaDeResell } from "@/lib/resells";

/* Juan Cruz (20/10): «que tenga como un badge de resell». */
test("la marca «Resell» sale con la misma regla que separa las llamadas (una sola definición de resell)", () => {
  const src = readFileSync("src/components/ui/BadgeResell.tsx", "utf8");
  assert.match(src, /esLlamadaDeResell\(s\)/, "usa la regla de lib/resells.ts");
  assert.match(src, />Resell</);
  for (const s of [{ tipo: "Llamada de Asesoramiento - Próximos pasos" }, { tipo: "Llamada de Auditoría" }, { tipo: "Asesoramiento", utm: { utm_source: "Resell" } }]) assert.equal(esLlamadaDeResell(s), true);
  for (const s of [{ tipo: "Llamada de Asesoramiento - Webinar - Team" }, { tipo: "Llamada de Asesoramiento - Setter", utm: { utm_source: "setter-ia" } }, {}]) assert.equal(esLlamadaDeResell(s), false);
});

test("la marca está donde se mezclan las llamadas: la Agenda y la ficha de la persona", () => {
  assert.match(readFileSync("src/app/(app)/agenda/page.tsx", "utf8"), /<BadgeResell s=\{s\} \/>/);
  assert.match(readFileSync("src/components/ficha/VistaLlamadas.tsx", "utf8"), /<BadgeResell s=\{f\.sesion\} \/>/);
});
