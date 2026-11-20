import test from "node:test";
import assert from "node:assert/strict";
import { calcularPyL } from "@/lib/finanzas";
import { cajaEsperada } from "@/lib/caja";
import { armarEstadoResultados, rutaDeGasto } from "@/lib/estadoResultados";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Gasto } from "@/lib/types";
import { estadoDeYari, OCTUBRE } from "./estado-devolucion";

/* ==================================================================
   Lo pagado al director en los meses de la planilla de Angelo (20/11) se cargó como gasto «Comisiones Director de Ventas»
   (directo): Finanzas no lo podía calcular (ventas sin director asignado o una regla de director que sólo calcula la
   liquidación). Tiene que verse en la línea «Comisión del director», no en «Otros costos directos», sin cambiar el total, y la
   caja no lo cuenta como algo a deber (ya se pagó).
   ================================================================== */

const gasto = (categoria: string, monto: number): Gasto => ({
  id: `g_${categoria}`, categoria, grupo: "directo", concepto: `Pago · ${categoria}`, monto, moneda: "USD",
  fecha: "2026-10-01T12:00:00.000Z", fechaPago: "2026-11-04T15:00:00.000Z", recurrente: false, proveedor: "Directora",
  creadoEn: "2026-11-20T12:00:00.000Z", extra: { origen: "planilla-angelo" },
});
const con = (g: Gasto): EstadoApp => ({ ...estadoDeYari(), gastos: [g] });
const OCT = rangoDePeriodo(OCTUBRE);

test("lo pagado al director cargado como gasto suma en su línea del P&L y no en «Otros costos directos»; el total no cambia", () => {
  const comoDirector = calcularPyL(con(gasto("Comisiones Director de Ventas", 1000)), OCT);
  const comoOtro = calcularPyL(con(gasto("Setters", 1000)), OCT);
  assert.equal(comoDirector.comisionDirectorCargada, 1000);
  assert.equal(Math.round((comoDirector.comisionDirector - comoOtro.comisionDirector) * 100) / 100, 1000);
  assert.equal(comoDirector.otrosDirectos, 0);
  assert.equal(comoOtro.otrosDirectos, 1000);
  assert.equal(comoDirector.totalDirectos, comoOtro.totalDirectos);
  assert.equal(comoDirector.netoCC, comoOtro.netoCC);
});

test("un pago de equipo marcado (que no es costo) no entra en la línea del director", () => {
  const g = { ...gasto("Comisiones Director de Ventas", 1000), extra: { pagoDeEquipo: true } };
  assert.equal(calcularPyL(con(g), OCT).comisionDirectorCargada, 0);
});

test("la caja no cuenta lo cargado como algo que se le debe al director", () => {
  const desde = { fecha: "2026-09-30T23:59:59.999Z", total: 0 };
  const dir = cajaEsperada(con(gasto("Comisiones Director de Ventas", 1000)), desde, "2026-11-30T23:59:59.999Z");
  const otro = cajaEsperada(con(gasto("Setters", 1000)), desde, "2026-11-30T23:59:59.999Z");
  assert.equal(dir.comisiones, otro.comisiones);
  assert.equal(dir.esperado, otro.esperado);
});

test("en el estado de resultados el pago aparece dentro de «Comisión del director» y el atajo abre ese renglón", () => {
  const e = con(gasto("Comisiones Director de Ventas", 1000));
  const p = calcularPyL(e, OCT);
  const items = armarEstadoResultados(e, OCT, p, (n) => String(n), (id) => `/g/${id}`);
  const buscar = (xs: { id: string; hijos?: unknown[] }[], id: string): { id: string; cc: number | null; hijos?: unknown[] } | undefined => {
    for (const x of xs) {
      if (x.id === id) return x as never;
      const h = x.hijos ? buscar(x.hijos as never, id) : undefined;
      if (h) return h;
    }
    return undefined;
  };
  const director = buscar(items as never, "director");
  assert.ok(director?.hijos?.some((h) => (h as { id: string }).id === "director/g:g_Comisiones Director de Ventas"));
  assert.equal(buscar(items as never, "directos/c:Comisiones Director de Ventas"), undefined);
  assert.deepEqual(rutaDeGasto(gasto("Comisiones Director de Ventas", 1)), ["director", "director/g:g_Comisiones Director de Ventas"]);
  assert.deepEqual(rutaDeGasto(gasto("Setters", 1))[0], "directos");
});
