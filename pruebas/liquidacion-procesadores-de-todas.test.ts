import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion } from "@/lib/honorarios";
import type { EstadoApp } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Comisión del director: cash post pasarelas restando los procesadores de TODAS las ventas del mes
   (Aldana, 28/10/2026, confirmado por Manuel): no sólo los de los cobros que le tocan.
   En el mes de prueba los procesadores de todo el negocio suman 285; los de las ventas de Santiago, menos.
   ================================================================== */

function santi(e: EstadoApp) {
  const r = calcularLiquidacion(e, PERIODO);
  const l = r.personas.find((p) => p.miembroId === "santi")!.lineas.find((x) => x.conceptoId === "c_dir")!;
  return { l, pasos: l.desglose!.pasos };
}
const conFlag = (e: EstadoApp, valor: boolean): EstadoApp => ({
  ...e,
  honorarios: e.honorarios.map((h) => (h.miembroId === "santi"
    ? { ...h, conceptos: h.conceptos.map((c) => ({ ...c, ...(valor ? { procesadoresDeTodas: true } : {}) })) }
    : h)),
});

test("sin la opción, al director se le restan los procesadores de sus cobros, como siempre", () => {
  const { l, pasos } = santi(estadoDePrueba());
  const menos = pasos.find((p) => p.op === "menos" && /procesadores/.test(p.texto))!;
  assert.ok(menos.valor < 285, "sólo los de sus cobros");
  assert.doesNotMatch(menos.texto, /TODAS/);
  assert.doesNotMatch(l.desglose?.regla ?? "", /todas las ventas del mes/);
});

test("con la opción, se restan los procesadores de todas las ventas del mes y el desglose lo dice", () => {
  const e = estadoDePrueba();
  const sin = santi(e);
  const con = santi(conFlag(e, true));
  const bruto = (x: ReturnType<typeof santi>) => x.pasos.find((p) => p.op === "base")!.valor;
  assert.equal(bruto(con), bruto(sin), "lo cobrado que le toca no cambia");
  const menos = con.pasos.find((p) => p.op === "menos" && /procesadores/.test(p.texto))!;
  assert.equal(menos.valor, 285, "los procesadores de todo el negocio");
  assert.match(menos.texto, /TODAS las ventas del mes/);
  assert.equal(Math.round((con.l.medido ?? 0) * 100) / 100, Math.round((bruto(con) - 285) * 100) / 100);
  assert.ok((con.l.medido ?? 0) < (sin.l.medido ?? 0), "al restar más, da menos");
  assert.match(con.l.desglose?.regla ?? "", /restando los procesadores de pago de todas las ventas del mes/);
  /* La comisión es el 5% de esa base. */
  assert.equal(Math.round(con.l.monto * 100) / 100, Math.round((bruto(con) - 285) * 0.05 * 100) / 100);
});

test("la opción sólo vale en el cash post pasarelas: en el cash a secas no resta nada", () => {
  const e = estadoDePrueba();
  const cash: EstadoApp = {
    ...e,
    honorarios: e.honorarios.map((h) => (h.miembroId === "santi"
      ? { ...h, conceptos: h.conceptos.map((c) => ({ ...c, base: "cash" as const, procesadoresDeTodas: true })) }
      : h)),
  };
  const { pasos } = santi(cash);
  assert.equal(pasos.some((p) => p.op === "menos" && /procesadores/.test(p.texto)), false);
});
