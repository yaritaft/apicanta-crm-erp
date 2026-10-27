import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, describirConcepto, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import type { ConceptoPago, EstadoApp, LineaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { concepto, esquema, estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   «Agustín no comisiona VSL YouTube. Venta interna lo comisiona únicamente cuando se arma una estrategia de lanzamiento interno» (Yari,
   vía Aldana, 26/10). El esquema puede dejar afuera las ventas de ciertas estrategias (`sinEmbudoIds`), igual que filtra por servicio.
   Sin elegir ninguna (lo de siempre) no cambia nada.
   El mes de prueba (estado-liquidacion.ts): v1 de Belén (Mariano, Mentoría) cobra 1.500 el 5 y el 20; v2 de Pedro (Mariano, Downsell) 500.
   ================================================================== */

const liq = () => ({ ...liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } } });
const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string): LineaLiquidada => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta el renglón ${miembroId}:${clave}`);
  return x.linea;
};
const EMBUDOS = [
  { id: "emb_web", nombre: "Webinar", activo: true, orden: 1 },
  { id: "emb_yt", nombre: "VSL YouTube", activo: true, orden: 2 },
  { id: "emb_int", nombre: "Venta interna", activo: true, orden: 3 },
];
/* v1 (Belén) entró por el webinar y v2 (Pedro) por VSL YouTube. */
const conEstrategias = (): EstadoApp => {
  const e = estadoDePrueba();
  return {
    ...e, embudos: EMBUDOS,
    ventas: e.ventas.map((v) => v.id === "v1" ? { ...v, embudoId: "emb_web" } : v.id === "v2" ? { ...v, embudoId: "emb_yt" } : v),
  } as unknown as EstadoApp;
};
const conComisionDeMariano = (e: EstadoApp, extra: Partial<ConceptoPago>): EstadoApp => ({
  ...e,
  honorarios: e.honorarios.map((h) => h.miembroId !== "mariano" ? h : esquema("mariano", [concepto({
    id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.15, base: "cash-neto", alcance: "closer", ...extra,
  })])),
} as EstadoApp);

test("sin elegir estrategias nada cambia: Mariano cobra el 15% de todo lo suyo", () => {
  for (const extra of [{}, { sinEmbudoIds: [] }]) {
    const l = renglon(calcularLiquidacion(conComisionDeMariano(conEstrategias(), extra), PERIODO, liq()), "mariano", "c_com");
    assert.equal(l.monto, 509.25);
    assert.equal(l.desglose!.lista!.excluidos, undefined);
  }
});

test("sin VSL YouTube: el cobro de esa estrategia queda afuera, dice por qué y la regla lo dice", () => {
  const e = conComisionDeMariano(conEstrategias(), { sinEmbudoIds: ["emb_yt"] });
  const l = renglon(calcularLiquidacion(e, PERIODO, liq()), "mariano", "c_com");
  /* Pedro (500, fee 15 → neto 485) sale: queda el neto de Belén, 2.910 × 15%. */
  assert.equal(l.monto, 436.5);
  assert.match(l.desglose!.regla, /sin la estrategia VSL YouTube/);
  const fuera = l.desglose!.lista!.excluidos!;
  assert.equal(fuera.length, 1);
  assert.equal(fuera[0].cliente, "Pedro Gómez");
  assert.equal(fuera[0].motivo, "Es de la estrategia VSL YouTube, que no cuenta");
  assert.equal(fuera[0].estrategia, "VSL YouTube");
});

test("con dos estrategias la regla las nombra, y una venta sin estrategia sigue contando", () => {
  const e = conComisionDeMariano(conEstrategias(), { sinEmbudoIds: ["emb_yt", "emb_int"] });
  assert.match(describirConcepto(e.honorarios.find((h) => h.miembroId === "mariano")!.conceptos[0], e), /sin las estrategias VSL YouTube y Venta interna/);
  /* v1 es del webinar y v2 de YouTube: sólo v2 sale. Una venta sin estrategia (v3 de Yari no es de Mariano) no se toca. */
  assert.equal(renglon(calcularLiquidacion(e, PERIODO, liq()), "mariano", "c_com").monto, 436.5);
});

test("el profit propio saca de su base las ventas de la estrategia", () => {
  const e = conEstrategias();
  const conProfit = (sin: string[]): EstadoApp => ({
    ...e,
    honorarios: [...e.honorarios.filter((h) => h.miembroId !== "agus"), esquema("agus", [
      concepto({ id: "c_profit", tipo: "porcentaje", nombre: "Comisión del profit", tasa: 0.05, base: "profit", profitPropio: true, productoIds: ["p_ment"], ...(sin.length ? { sinEmbudoIds: sin } : {}) }),
    ])],
  } as EstadoApp);
  const ingresos = (x: EstadoApp) => renglon(calcularLiquidacion(x, PERIODO, liq()), "agus", "c_profit").desglose!.pasos.find((p) => /^Cobrado de las ventas que le tocan/.test(p.texto))!.valor;
  const antes = ingresos(conProfit([]));
  /* Belén (Mentoría) entró por el webinar: sacar Webinar le quita sus 3.000 cobrados. */
  assert.equal(ingresos(conProfit(["emb_web"])), antes - 3000);
  /* Sacar una estrategia que no usa ninguna de sus ventas no cambia nada. */
  assert.equal(ingresos(conProfit(["emb_yt"])), antes);
});

test("con el filtro la comisión es un costo de la liquidación: Finanzas no la calcula (no se cuenta dos veces)", () => {
  const sin = renglon(calcularLiquidacion(conComisionDeMariano(conEstrategias(), {}), PERIODO, liq()), "mariano", "c_com");
  const con = renglon(calcularLiquidacion(conComisionDeMariano(conEstrategias(), { sinEmbudoIds: ["emb_yt"] }), PERIODO, liq()), "mariano", "c_com");
  assert.equal(sin.enFinanzas, true);
  assert.equal(con.enFinanzas, false);
});
