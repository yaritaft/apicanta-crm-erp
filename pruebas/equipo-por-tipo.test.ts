import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion } from "@/lib/honorarios";
import { equipoPorTipo, grupoDeLinea } from "@/lib/equipo-por-tipo";
import type { EstadoApp, Liquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   El equipo por tipo de pago (Aldana, 28/10): fijos y bonos, comisiones de closers, de directores, del socio, y externos.
   ================================================================== */

/* Dos sesiones del filmmaker cargadas a mano: sin cantidad, no hay nada para pagarle. */
const conSesiones = { id: "liq_2026-09", periodo: PERIODO, estado: "abierta", entradas: { "nico:c_pieza": { cantidad: 2 } }, extras: [] } as unknown as Liquidacion;

function conNicoExterno(e: EstadoApp): EstadoApp {
  return { ...e, honorarios: e.honorarios.map((h) => (h.miembroId === "nico" ? { ...h, categoriaGasto: "Filmmaker" } : h)) };
}

test("cada línea va al grupo de su rol y de su forma de cobro", () => {
  assert.equal(grupoDeLinea("otro", "Equipo / Salarios", { tipo: "fijo" }), "fijos");
  assert.equal(grupoDeLinea("otro", "Equipo / Salarios", { tipo: "bono" }), "fijos");
  assert.equal(grupoDeLinea("otro", "Equipo / Salarios", { tipo: "tramo" }), "fijos", "el bono de cash de Manuel va con su fijo");
  assert.equal(grupoDeLinea("closer", "Equipo / Salarios", { tipo: "porcentaje" }), "closers");
  assert.equal(grupoDeLinea("closer", "Equipo / Salarios", { tipo: "devolucion" }), "closers", "la devolución resta de su comisión");
  assert.equal(grupoDeLinea("setter", "Setters", { tipo: "fijo" }), "fijos", "la base de Daniel es fija");
  assert.equal(grupoDeLinea("setter", "Setters", { tipo: "porcentaje" }), "closers");
  assert.equal(grupoDeLinea("director", "Equipo / Salarios", { tipo: "porcentaje" }), "directores");
  assert.equal(grupoDeLinea("growth", "Equipo / Salarios", { tipo: "fijo" }), "fijos");
  assert.equal(grupoDeLinea("growth", "Equipo / Salarios", { tipo: "porcentaje" }), "directores");
  assert.equal(grupoDeLinea("socio", "Equipo / Salarios", { tipo: "porcentaje" }), "socio");
  assert.equal(grupoDeLinea("otro", "Filmmaker", { tipo: "unidad" }), "externos");
  assert.equal(grupoDeLinea("otro", "Edición de contenido", { tipo: "unidad" }), "externos");
});

test("la liquidación se reparte en grupos sin perder ni repetir un centavo", () => {
  const e = conNicoExterno(estadoDePrueba());
  const r = calcularLiquidacion(e, PERIODO, conSesiones);
  const t = equipoPorTipo(r.personas, e.equipo);
  assert.equal(Math.round(t.total * 100), Math.round(r.total * 100), "los grupos suman lo mismo que la liquidación");

  const grupo = (id: string) => t.grupos.find((g) => g.id === id);
  const quienes = (id: string) => grupo(id)?.filas.map((f) => f.miembroId) ?? [];
  assert.ok(quienes("fijos").includes("manu") && quienes("fijos").includes("lili"));
  assert.ok(quienes("closers").includes("mariano") && quienes("closers").includes("dante"));
  assert.deepEqual(quienes("directores").filter((x) => x === "santi"), ["santi"]);
  assert.ok(quienes("externos").includes("nico"), "el filmmaker cobra por pieza");

  /* Una persona en dos grupos: la base de Daniel va a fijos y su comisión de setter a closers. */
  assert.ok(quienes("fijos").includes("dani") && quienes("closers").includes("dani"));
  const dani = r.personas.find((p) => p.miembroId === "dani")!;
  const sumaDani = [...t.grupos.flatMap((g) => g.filas)].filter((f) => f.miembroId === "dani").reduce((a, f) => a + f.total, 0);
  assert.equal(Math.round(sumaDani * 100), Math.round(dani.total * 100));

  /* Lo que cada fila dice que lo compone suma su total. */
  for (const g of t.grupos) for (const f of g.filas) {
    assert.equal(Math.round(f.partes.reduce((a, p) => a + p.monto, 0) * 100), Math.round(f.total * 100), `${f.nombre} en ${g.titulo}`);
  }
});

test("lo que entra en los costos de quienes cobran sobre el profit es todo menos esas mismas comisiones", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO);
  const t = equipoPorTipo(r.personas, e.equipo);
  const delProfit = r.personas.flatMap((p) => p.lineas).filter((l) => l.base === "profit").reduce((a, l) => a + l.montoBase, 0);
  assert.ok(delProfit > 0, "en el mes de prueba hay una comisión sobre el profit");
  assert.equal(Math.round(t.enLosCostos * 100), Math.round((r.total - delProfit) * 100));
});

test("quien no tiene nada para pagar no figura en ningún grupo y se cuenta aparte", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO);
  const vacia = { ...r.personas[0], miembroId: "nadie", nombre: "Nadie", lineas: [], total: 0 };
  const t = equipoPorTipo([...r.personas, vacia], e.equipo);
  assert.equal(t.sinNada, 1 + equipoPorTipo(r.personas, e.equipo).sinNada);
  assert.equal(t.grupos.flatMap((g) => g.filas).some((f) => f.miembroId === "nadie"), false);
});

test("el resto del mes anterior se paga pero no cuenta como costo del mes (ya estaba en los del mes anterior)", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO);
  const p = r.personas.find((x) => x.miembroId === "manu")!;
  const conResto = { ...r.personas.find((x) => x.miembroId === "manu")!, lineas: [...p.lineas, { ...p.lineas[0], clave: "resto:2026-08", nombre: "Resto de agosto", monto: 500, montoBase: 500, base: undefined, enFinanzas: false }] };
  const personas = r.personas.map((x) => (x.miembroId === "manu" ? conResto : x));
  const sin = equipoPorTipo(r.personas, e.equipo);
  const con = equipoPorTipo(personas, e.equipo);
  assert.equal(Math.round((con.total - sin.total) * 100), 50000, "se paga");
  assert.equal(con.enLosCostos, sin.enLosCostos, "pero no suma a los costos");
});
