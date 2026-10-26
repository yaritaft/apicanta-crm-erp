import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, liquidacionVacia, renglonDe } from "@/lib/honorarios";
import type { EstadoApp, LineaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { concepto, esquema, estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   «Si sumo las ventas de los closers me da 120 y Santiago tiene a cobrar 116: ¿cuáles son esas 4?» (Aldana, 26/10). Cada renglón de
   la liquidación ahora dice también qué cobros de esta persona una regla dejó afuera, y por qué: así la diferencia no hay que adivinarla.
   El mes de prueba (estado-liquidacion.ts): v1 de Belén (día 3, cierra Mariano, dirige Santiago) cobra el 5 y el 20; v2 de Pedro (día 8,
   Mariano, sin director); v3 de Yari (día 10); v4 de Dante (día 12, excluida de marketing).
   ================================================================== */

const liq = () => ({ ...liquidacionVacia(PERIODO, "2026-09-30T12:00:00.000Z"), entradas: { "nico:c_pieza": { cantidad: 3 } } });
const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string): LineaLiquidada => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta el renglón ${miembroId}:${clave}`);
  return x.linea;
};
/* El esquema del director con la regla de «sólo ventas cerradas desde» el día 4: la venta de Belén (día 3) queda afuera. */
const conRegla = (desde: string): EstadoApp => {
  const e = estadoDePrueba();
  return {
    ...e,
    honorarios: e.honorarios.map((h) => h.miembroId !== "santi" ? h : esquema("santi", [concepto({
      id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director", desde, soloVentasDesdeInicio: true,
    })])),
  } as EstadoApp;
};

test("el director deja afuera las cuotas de ventas anteriores a su inicio y cada una dice por qué", () => {
  const sin = renglon(calcularLiquidacion(estadoDePrueba(), PERIODO, liq()), "santi", "c_dir");
  /* Sin la regla: Belén cobró el 5 y el 20: 2 cobros y nada afuera. */
  assert.equal(sin.desglose!.lista!.total, 2);
  assert.equal(sin.desglose!.lista!.excluidos, undefined);

  const l = renglon(calcularLiquidacion(conRegla("2026-09-04"), PERIODO, liq()), "santi", "c_dir");
  const lista = l.desglose!.lista;
  /* Con la regla, la venta del día 3 no cuenta: no queda ningún cobro que cuente, pero la lista sale igual con los dos en «no cuentan». */
  assert.equal(l.monto, 0);
  assert.ok(lista, "sin cobros que cuenten, la lista sale igual si hay cobros que no cuentan");
  assert.equal(lista.total, 0);
  assert.equal(lista.totalExcluidos, 2);
});

test("la lista del director trae los cobros que no cuentan al lado de los que sí", () => {
  /* Una venta más del director, cerrada el día 6 (después del inicio): ésa cuenta; la de Belén (día 3), no. */
  const e = conRegla("2026-09-04");
  const e2 = {
    ...e,
    ventas: [...e.ventas, { ...e.ventas[0], id: "v9", contactoNombre: "Venta nueva", fecha: "2026-09-06T15:00:00.000Z" }],
    cuotas: [...e.cuotas, { id: "c9", ventaId: "v9", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [...e.pagos, { ...e.pagos[0], id: "p9", cuotaId: "c9", monto: 1000, feeMonto: 30, fecha: "2026-09-12T15:00:00.000Z" }],
  } as EstadoApp;
  const l = renglon(calcularLiquidacion(e2, PERIODO, liq()), "santi", "c_dir");
  const lista = l.desglose!.lista!;
  assert.deepEqual(lista.items.map((x) => x.cliente), ["Venta nueva"]);
  /* Los 2 cobros de Belén (venta del 03/09, anterior al 04/09) quedan afuera, con el motivo. */
  assert.equal(lista.totalExcluidos, 2);
  assert.deepEqual(lista.excluidos!.map((x) => [x.cliente, x.monto]), [["Belén Godoy", 1500], ["Belén Godoy", 1500]]);
  assert.ok(lista.excluidos!.every((x) => /Venta del 03\/09, anterior al inicio de su regla \(04\/09\)/.test(x.motivo ?? "")), "dice la fecha de la venta y la del inicio");
  assert.ok(lista.excluidos!.every((x) => x.cuota && x.ventaFecha), "con su cuota y la fecha de la venta, para compararlos");
  /* Lo que cuenta y lo que no, juntos, son todos los cobros de las ventas que dirige. */
  assert.equal(lista.total + lista.totalExcluidos!, 3);
  /* Lo que cuenta: (1.000 − 30) · 5% = 48,50. */
  assert.equal(l.monto, 48.5);
});

test("sólo se explica lo que era de esa persona: lo de otro closer no aparece entre los que no cuentan de Mariano", () => {
  const e = estadoDePrueba();
  const l = renglon(calcularLiquidacion(e, PERIODO, liq()), "mariano", "c_com");
  /* Mariano cierra v1 y v2: nada de lo suyo queda afuera, y lo de Dante y de Yari no se le explica. */
  assert.equal(l.desglose!.lista!.excluidos, undefined);
});

test("el profit propio dice qué cobros del mes no entran en su base: los servicios que no comisiona", () => {
  const e = estadoDePrueba();
  const e2 = {
    ...e,
    honorarios: [...e.honorarios.filter((h) => h.miembroId !== "agus"), esquema("agus", [
      concepto({ id: "c_profit", tipo: "porcentaje", nombre: "Comisión del profit", tasa: 0.05, base: "profit", profitPropio: true, productoIds: ["p_ment"] }),
    ])],
  } as EstadoApp;
  const l = renglon(calcularLiquidacion(e2, PERIODO, liq()), "agus", "c_profit");
  const lista = l.desglose!.lista!;
  /* El Downsell de Pedro (p_down) no está entre sus servicios: queda afuera y lo dice. */
  const down = lista.excluidos!.filter((x) => x.cliente === "Pedro Gómez");
  assert.equal(down.length, 1);
  assert.match(down[0].motivo!, /Es de Downsell, que no está entre los servicios que cuentan/);
});

test("sin ninguna regla que deje cobros afuera, nada cambia en la liquidación", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liq());
  const montos = r.personas.map((p) => [p.miembroId, p.total]);
  assert.ok(montos.length > 0);
  /* Los totales siguen siendo los de siempre (cuentas hechas a mano en estado-liquidacion.ts). */
  assert.equal(renglon(r, "mariano", "c_com").monto, 509.25);
  assert.equal(renglon(r, "santi", "c_dir").monto, 145.5);
});
