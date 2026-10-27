import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import { diaDeConfirmacion, reglasAcordadas, reglasSinConfirmar, selloDeRegla, sinConfirmarSiCambio, textoDeReglas } from "@/lib/reglas";
import type { ConceptoPago, EstadoApp } from "@/lib/types";
import { concepto, esquema, estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Las reglas de comisión acordadas (26/10): cada una dice lo que se acordó (sus notas), quién la confirmó y cuándo; la liquidación avisa
   de las que siguen sin confirmar; y una regla confirmada que cambia deja de estarlo. Antes los criterios vivían en Notion, WhatsApp y la
   cabeza de cada uno: cada duda terminaba en una pregunta («¿a Santi se le descuenta lo de los closers?»).
   El mes de prueba (estado-liquidacion.ts): comisiones de Mariano, Dante, Santi, Daniel (setter) y Agus (profit); sueldos y bonos de los demás.
   ================================================================== */

const confirmar = (e: EstadoApp, miembroId: string, conceptoId: string, extra: Partial<ConceptoPago> = {}): EstadoApp => ({
  ...e,
  honorarios: e.honorarios.map((h) => h.miembroId !== miembroId ? h : {
    ...h, conceptos: h.conceptos.map((c) => c.id === conceptoId ? { ...c, confirmadaPor: "Yari", confirmadaEl: "2026-10-26", ...extra } : c),
  }),
});

test("cuentan las comisiones y los tramos (lo que se paga por lo que se mide): un sueldo o un bono no se confirma", () => {
  const r = reglasAcordadas(estadoDePrueba());
  const claves = r.map((x) => `${x.miembro.id}:${x.concepto.id}`).sort();
  assert.deepEqual(claves, ["agus:c_profit", "dani:c_com", "dante:c_com", "lili:c_tramo", "manu:c_tramo", "mariano:c_com", "santi:c_dir"]);
  assert.ok(r.every((x) => x.confirmada === null), "al principio nadie está confirmado");
});

test("confirmar una regla la saca de las que faltan, con quién y cuándo", () => {
  const e = estadoDePrueba();
  assert.equal(reglasSinConfirmar(e).length, 7);
  const e2 = confirmar(e, "santi", "c_dir", { notas: "Si un closer hizo la llamada de venta, Santiago cobra." });
  const sin = reglasSinConfirmar(e2).map((x) => x.miembro.id);
  assert.equal(sin.length, 6);
  assert.equal(sin.includes("santi"), false);
  const santi = reglasAcordadas(e2).find((x) => x.miembro.id === "santi")!;
  assert.deepEqual(santi.confirmada, { por: "Yari", el: "2026-10-26" });
  assert.equal(santi.criterio, "Si un closer hizo la llamada de venta, Santiago cobra.");
  assert.equal(selloDeRegla(santi.confirmada), "Confirmada por Yari el 26/10");
  assert.equal(selloDeRegla(null), "Sin confirmar");
  assert.equal(diaDeConfirmacion("2026-10-26"), "26/10");
});

test("con un mes sólo cuentan las que valen ese mes: una que arranca después no se pide todavía", () => {
  const e = estadoDePrueba();
  const e2 = {
    ...e,
    honorarios: e.honorarios.map((h) => h.miembroId !== "dante" ? h : esquema("dante", [
      concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.10, base: "cash-neto", alcance: "closer", desde: "2026-11-01" }),
    ])),
  } as EstadoApp;
  assert.equal(reglasAcordadas(e2, PERIODO).some((x) => x.miembro.id === "dante"), false);
  assert.equal(reglasAcordadas(e2, "2026-11").some((x) => x.miembro.id === "dante"), true);
});

test("la liquidación trae en el desglose lo acordado y el sello de cada comisión, y no en un sueldo", () => {
  const e = confirmar(estadoDePrueba(), "santi", "c_dir", { notas: "Si no hubo closer ni intervención de Santiago, no cobra." });
  const liq = { ...liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } } };
  const r = calcularLiquidacion(e, PERIODO, liq);
  const santi = renglonDe(r, "santi", "c_dir")!.linea.desglose!;
  assert.equal(santi.criterio, "Si no hubo closer ni intervención de Santiago, no cobra.");
  assert.deepEqual(santi.confirmada, { por: "Yari", el: "2026-10-26" });
  const mariano = renglonDe(r, "mariano", "c_com")!.linea.desglose!;
  assert.equal(mariano.confirmada, null, "sin confirmar: lo dice");
  assert.equal(mariano.criterio, undefined);
  const sueldo = renglonDe(r, "dani", "c_fijo")!.linea.desglose!;
  assert.equal(sueldo.confirmada, undefined, "un sueldo no se confirma");
});

test("una regla confirmada que cambia deja de estarlo; cambiar el nombre o lo acordado no la borra", () => {
  const antes = [concepto({ id: "c", tipo: "porcentaje", nombre: "Comisión", tasa: 0.05, base: "cash-neto", alcance: "director", confirmadaPor: "Yari", confirmadaEl: "2026-10-26" })];
  const conTasa = sinConfirmarSiCambio(antes, [{ ...antes[0], tasa: 0.06 }]);
  assert.equal(conTasa[0].confirmadaPor, undefined);
  assert.equal(conTasa[0].confirmadaEl, undefined);
  const conFiltro = sinConfirmarSiCambio(antes, [{ ...antes[0], sinEmbudoIds: ["emb"] }]);
  assert.equal(conFiltro[0].confirmadaPor, undefined, "un filtro nuevo también cambia la regla");
  const soloNombre = sinConfirmarSiCambio(antes, [{ ...antes[0], nombre: "Comisión de director", notas: "Lo que se acordó" }]);
  assert.equal(soloNombre[0].confirmadaPor, "Yari");
  /* Si en el mismo guardado se tocó la confirmación a propósito, se respeta. */
  const reconfirmada = sinConfirmarSiCambio(antes, [{ ...antes[0], tasa: 0.06, confirmadaPor: "Juan Cruz", confirmadaEl: "2026-10-27" }]);
  assert.equal(reconfirmada[0].confirmadaPor, "Juan Cruz");
  /* Un concepto nuevo, o uno que no estaba confirmado, no se toca. */
  assert.equal(sinConfirmarSiCambio(antes, [{ ...antes[0], id: "otro", tasa: 0.07 }])[0].confirmadaPor, "Yari");
  assert.equal(sinConfirmarSiCambio(undefined, [{ ...antes[0] }])[0].confirmadaPor, "Yari");
});

test("el texto para Yari lista cada regla con lo acordado y si está confirmada", () => {
  const e = confirmar(estadoDePrueba(), "santi", "c_dir", { notas: "Si un closer hizo la llamada de venta, Santiago cobra." });
  const t = textoDeReglas(e);
  assert.match(t, /6 de 7 sin confirmar/);
  assert.match(t, /Santiago Burghiani \(Director comercial\)/);
  assert.match(t, /Lo acordado: Si un closer hizo la llamada de venta, Santiago cobra\./);
  assert.match(t, /✔ Confirmada por Yari el 26\/10/);
  assert.match(t, /✘ Sin confirmar/);
  const todas = (["santi:c_dir", "mariano:c_com", "dante:c_com", "dani:c_com", "agus:c_profit", "lili:c_tramo", "manu:c_tramo"] as const)
    .reduce((acc, k) => confirmar(acc, k.split(":")[0], k.split(":")[1]), estadoDePrueba());
  assert.equal(textoDeReglas(todas).includes("Todas están confirmadas."), true);
});
