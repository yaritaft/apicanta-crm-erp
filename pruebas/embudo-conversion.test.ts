import test from "node:test";
import assert from "node:assert/strict";
import { conversionDelPaso, type PasoDeEmbudo } from "@/lib/embudo-pasos";

/* El % de cada escalón del embudo de un webinar (21/10): cada uno se mide sobre el anterior, menos las ventas, que se miden sobre las
   agendadas (en vivo, o en vivo + después según el modo): antes daba 414% porque se medían sobre las calificadas (29 sobre 7). */

const embudo = (modo: "vivo" | "todo"): PasoDeEmbudo[] => [
  { etiqueta: "Formularios", valor: 1204 },
  { etiqueta: "Grupo de WhatsApp", valor: 960 },
  { etiqueta: "Asistieron", valor: 978 },
  modo === "todo" ? { etiqueta: "Llamadas agendadas", valor: 72, valor2: 25 } : { etiqueta: "Agendadas en el vivo", valor: 72 },
  { etiqueta: "Calificadas", valor: 7 },
  { etiqueta: "Ventas", valor: 29, sobre: 3 },
];

test("el primer escalón no tiene conversión y los demás se miden sobre el anterior", () => {
  const p = embudo("vivo");
  assert.equal(conversionDelPaso(p, 0), null);
  assert.ok(Math.abs((conversionDelPaso(p, 1) ?? 0) - (960 / 1204) * 100) < 1e-9);
  assert.ok(Math.abs((conversionDelPaso(p, 4) ?? 0) - (7 / 72) * 100) < 1e-9, "las calificadas siguen siendo sobre las agendadas");
});

test("las ventas se miden sobre las agendadas en vivo, no sobre las calificadas", () => {
  const v = conversionDelPaso(embudo("vivo"), 5)!;
  assert.ok(Math.abs(v - (29 / 72) * 100) < 1e-9);
  assert.ok(v < 100, "ya no da 414%");
});

test("con post vivo, las ventas se miden sobre las agendadas del vivo y de después juntas", () => {
  const v = conversionDelPaso(embudo("todo"), 5)!;
  assert.ok(Math.abs(v - (29 / (72 + 25)) * 100) < 1e-9);
});

test("sin agendadas (referencia en cero) no hay conversión que mostrar, y sin «sobre» sigue siendo sobre el anterior", () => {
  const sin: PasoDeEmbudo[] = [{ etiqueta: "A", valor: 10 }, { etiqueta: "B", valor: 0 }, { etiqueta: "C", valor: 3, sobre: 1 }];
  assert.equal(conversionDelPaso(sin, 2), null);
  assert.equal(conversionDelPaso([{ etiqueta: "A", valor: 10 }, { etiqueta: "B", valor: 5 }], 1), 50);
});
