import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import type { EstadoApp, LineaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   «Ahora estoy en Santi, 116 cobros, copio la lista, pero no me dice de qué closer proviene ni la estrategia. Yari me pidió que me
   fije que no haya nada incluido que sea venta de él o algún lanzamiento interno» (Aldana, 26/10). Cada cobro de la lista (los más
   grandes, todos y los que no cuentan) trae ahora quién cerró la venta y por qué estrategia entró.
   El mes de prueba (estado-liquidacion.ts): v1 de Belén (Mariano, dirige Santiago) cobra el 5 y el 20; v2 de Pedro (Mariano, sin
   director); v3 de Yari (sin director); v4 de Dante (sin director).
   ================================================================== */

const liq = () => ({ ...liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } } });
const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string): LineaLiquidada => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta el renglón ${miembroId}:${clave}`);
  return x.linea;
};
const nombreDe = (e: EstadoApp, id: string) => e.equipo.find((m) => m.id === id)!.nombre;

/* v1 entró por el webinar; las demás no tienen estrategia. */
const conEstrategia = (): EstadoApp => {
  const e = estadoDePrueba();
  return {
    ...e,
    embudos: [{ id: "emb_web", nombre: "Webinar" }],
    ventas: e.ventas.map((v) => v.id === "v1" ? { ...v, embudoId: "emb_web" } : v),
  } as unknown as EstadoApp;
};

test("cada cobro de la lista dice quién cerró la venta y por qué estrategia entró", () => {
  const e = conEstrategia();
  const lista = renglon(calcularLiquidacion(e, PERIODO, liq()), "santi", "c_dir").desglose!.lista!;
  assert.equal(lista.items.length, 2);
  for (const x of lista.items) {
    assert.equal(x.closer, nombreDe(e, "mariano"));
    assert.equal(x.estrategia, "Webinar");
  }
});

test("los cobros que no cuentan también: la venta de Yari y la sin estrategia se ven de un vistazo", () => {
  const e = conEstrategia();
  const lista = renglon(calcularLiquidacion(e, PERIODO, liq()), "santi", "c_dir").desglose!.lista!;
  const deYari = lista.excluidos!.find((x) => x.cliente === "Cliente de Yari")!;
  assert.equal(deYari.closer, nombreDe(e, "yari"));
  assert.equal(deYari.estrategia, "Sin estrategia");
  const deDante = lista.excluidos!.find((x) => x.cliente === "Evento VIP")!;
  assert.equal(deDante.closer, nombreDe(e, "dante"));
});

test("la lista completa (más de 10 cobros) los trae igual, y una estrategia borrada lo dice", () => {
  const e = conEstrategia();
  const extra = Array.from({ length: 10 }, (_, i) => ({
    ...e.pagos[0], id: `px${i}`, cuotaId: "c1a", monto: 100 + i, feeMonto: 0, fecha: `2026-09-${String(6 + i).padStart(2, "0")}T15:00:00.000Z`,
  }));
  const e2 = { ...e, pagos: [...e.pagos, ...extra], ventas: e.ventas.map((v) => v.id === "v1" ? { ...v, embudoId: "emb_borrado" } : v) } as unknown as EstadoApp;
  const lista = renglon(calcularLiquidacion(e2, PERIODO, liq()), "santi", "c_dir").desglose!.lista!;
  assert.ok(lista.todos && lista.todos.length > 10, "con más de 10 cobros hay lista completa");
  assert.ok(lista.todos!.every((x) => x.closer === nombreDe(e, "mariano") && x.estrategia === "Estrategia borrada"));
});

test("sin embudos cargados ni cierre, nada se rompe: «Sin estrategia» y el closer de la cuota", () => {
  const e = estadoDePrueba();
  const lista = renglon(calcularLiquidacion(e, PERIODO, liq()), "mariano", "c_com").desglose!.lista!;
  assert.ok(lista.items.length > 0);
  assert.ok(lista.items.every((x) => x.estrategia === "Sin estrategia" && x.closer === nombreDe(e, "mariano")));
});
