import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { calcularLiquidacion } from "@/lib/honorarios";
import { calcularPyL, costosDelMes, esPagoDeEquipo, gastosDelMes, gastosPagadosEn } from "@/lib/finanzas";
import { coincideConNombre, pagosSospechosos } from "@/lib/pagos-equipo";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Gasto } from "@/lib/types";
import { dia, estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Pagos al equipo cargados como gasto (Aldana, 27/10/2026: «hay cerca de 10k de diferencia con mi cuenta; quizás hay algo duplicado»).

   Un sueldo o una comisión llega a los costos por dos caminos: la liquidación (o las comisiones que Finanzas calcula de las ventas) y el
   pago que alguien carga a mano como gasto. Si los dos suman, el costo está duplicado. Marcar el gasto como «pago al equipo» lo saca de los
   costos (P&L y profit de Agus y Nahue) sin sacarlo de la caja.
   ================================================================== */

const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Equipo / Salarios", grupo: "operativo", concepto: "Pago", monto: 100, moneda: "USD", fecha: dia(26), recurrente: false, creadoEn: dia(26), extra: {}, ...g,
});

test("el nombre de la persona se reconoce aunque el gasto traiga otro orden, segundos nombres o un rótulo", () => {
  assert.equal(coincideConNombre("Manuel Federico Perez", "Manuel Pérez"), true);
  assert.equal(coincideConNombre("Liliana Noemí Riveros López", "Liliana Riveros"), true);
  assert.equal(coincideConNombre("Aldana Micaela Ytzcovich", "Aldana Ytzcovich"), true);
  assert.equal(coincideConNombre("Mariano Daniel Arias Kahale", "Mariano Arias"), true);
  assert.equal(coincideConNombre("Facundo Valentín Abadía", "Valentin Abadia"), true);
  assert.equal(coincideConNombre("Pago sueldo Patricia Sincovich", "Patricia Sincovich"), true);
  assert.equal(coincideConNombre("Ignacio Yungblut - Nacho (editor)", "Nacho"), true, "un solo nombre tiene que estar entero");
  /* Lo que no es la persona. */
  assert.equal(coincideConNombre("Nicolás Fernando Ibañez", "Nico"), false, "«Nico» no es «Nicolás»");
  assert.equal(coincideConNombre("Mariano Daniel Arias Kahale", "Daniel Rodriguez"), false, "un nombre de pila suelto no alcanza");
  assert.equal(coincideConNombre("Pago a editores de Youtube", "Dante Barbieri"), false);
  assert.equal(coincideConNombre("Equipo / Salarios (No comercial)", "Nico"), false);
});

function conGastos() {
  const e0 = estadoDePrueba();
  const r0 = calcularLiquidacion(e0, PERIODO);
  const lili = r0.personas.find((p) => p.miembroId === "lili")!;
  const manu = r0.personas.find((p) => p.miembroId === "manu")!;
  const gastos: Gasto[] = [
    ...e0.gastos,
    gasto({ id: "g_manu", proveedor: "Manuel Federico Perez", concepto: "Manuel Federico Perez", monto: manu.total }),
    gasto({ id: "g_sociedad", proveedor: "Emperador Financiero LLC", concepto: "Emperador Financiero LLC", monto: lili.total }),
    gasto({ id: "g_editores", proveedor: "Pago a editores de Youtube", concepto: "Pago a editores de Youtube", categoria: "Edición de contenido", monto: 1267 }),
    gasto({ id: "g_meta", proveedor: "Facebook", categoria: "Meta Ads", monto: manu.total }),
    gasto({ id: "g_soft", proveedor: "Notion", categoria: "Software", monto: lili.total }),
    gasto({ id: "g_ceo", proveedor: "Manuel Federico Perez", categoria: "Honorarios del CEO", grupo: "dueno", monto: 9000 }),
    gasto({ id: "g_liq", proveedor: "Manuel Federico Perez", extra: { liquidacionId: "liq_2026-09" }, monto: 50 }),
    gasto({ id: "g_chico", proveedor: "Emperador Financiero LLC", monto: 20, concepto: "Emperador Financiero LLC" }),
  ];
  return { e: { ...e0, gastos } as EstadoApp, manu, lili };
}

test("reconoce los gastos que parecen el pago de alguien de la liquidación, y sólo esos", () => {
  const { e, manu, lili } = conGastos();
  const r = calcularLiquidacion(e, PERIODO);
  const s = pagosSospechosos(e, r, rangoDePeriodo(PERIODO));
  const por = new Map(s.map((x) => [x.gasto.id, x] as const));
  assert.equal(por.get("g_manu")?.nombre, "Manuel Pérez");
  assert.equal(por.get("g_manu")?.motivo, "nombre");
  assert.equal(por.get("g_sociedad")?.nombre, "Liliana Riveros", "un pago a una sociedad con el monto exacto de lo que se le paga");
  assert.equal(por.get("g_sociedad")?.motivo, "monto");
  for (const id of ["g_editores", "g_meta", "g_soft", "g_ceo", "g_liq", "g_chico"]) assert.equal(por.has(id), false, `${id} no es un pago al equipo`);
  assert.ok(manu.total > 0 && lili.total > 0);
});

test("marcar un gasto como pago al equipo lo saca de los costos (P&L y profit) y no de la caja; sin marcar, nada cambia", () => {
  const { e } = conGastos();
  const r0 = calcularLiquidacion(e, PERIODO);
  const rango = rangoDePeriodo(PERIODO);
  const pyl0 = calcularPyL(e, rango);
  const marcado = e.gastos.find((g) => g.id === "g_manu")!;

  const e2: EstadoApp = { ...e, gastos: e.gastos.map((g) => (g.id === "g_manu" ? { ...g, extra: { ...g.extra, pagoDeEquipo: true } } : g)) };
  assert.equal(esPagoDeEquipo(e2.gastos.find((g) => g.id === "g_manu")!), true);
  const pyl1 = calcularPyL(e2, rango);
  assert.equal(Math.round((pyl0.gastosOperativos - pyl1.gastosOperativos) * 100) / 100, marcado.monto, "los gastos operativos bajan lo marcado");
  assert.equal(Math.round((pyl1.operativoCC - pyl0.operativoCC) * 100) / 100, marcado.monto, "y el resultado operativo sube lo mismo");

  /* El profit de la liquidación (de quien cobra sobre él) sube lo marcado: es lo que Aldana pidió. */
  const r1 = calcularLiquidacion(e2, PERIODO);
  assert.equal(Math.round((r1.profit - r0.profit) * 100) / 100, marcado.monto);
  /* El desglose lo dice: cuánto está marcado y que no suma. */
  const avisos = r1.personas.flatMap((p) => p.lineas).flatMap((l) => l.desglose?.avisos ?? []);
  assert.ok(avisos.some((a) => /gastos marcados como pago al equipo: no suman/.test(a)), "el renglón del profit dice que hay gastos marcados que no suman");

  /* Sigue en las listas de gastos y en la caja: la plata salió. */
  assert.equal(gastosDelMes(e2, rango).some((g) => g.id === "g_manu"), true);
  assert.equal(costosDelMes(e2, rango).some((g) => g.id === "g_manu"), false);
  assert.equal(gastosPagadosEn(e2, rango).some((g) => g.id === "g_manu"), true);

  /* Sin marcar nada, la cuenta es la de siempre (y el desglose no inventa la línea). */
  assert.equal(calcularPyL(e, rango).gastosOperativos, pyl0.gastosOperativos);
  const sinAviso = r0.personas.flatMap((p) => p.lineas).flatMap((l) => l.desglose?.avisos ?? []);
  assert.equal(sinAviso.some((a) => /marcados como pago al equipo/.test(a)), false);
});

test("el almacén: marcar y desmarcar cambia sólo ese gasto, deja una anotación y no toca los honorarios del CEO", () => {
  const { e } = conGastos();
  assert.equal(acciones.importar(JSON.stringify({ ...(construirSemilla() as EstadoApp), gastos: e.gastos, actividad: [] })), true);
  const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;

  assert.equal(acciones.marcarPagosDeEquipo(["g_manu", "g_sociedad", "g_ceo", "no_existe"], true), 2, "el del CEO y el que no existe no cuentan");
  assert.equal(esPagoDeEquipo(hoy().gastos.find((g) => g.id === "g_manu")!), true);
  assert.equal(esPagoDeEquipo(hoy().gastos.find((g) => g.id === "g_ceo")!), false);
  assert.equal(hoy().gastos.find((g) => g.id === "g_manu")!.proveedor, "Manuel Federico Perez", "el resto del gasto queda igual");
  assert.equal(hoy().actividad.length, 1);
  assert.match(hoy().actividad[0].detalle ?? "", /Se marcaron 2 gastos como pago al equipo/);

  assert.equal(acciones.marcarPagosDeEquipo(["g_manu"], true), 0, "ya estaba marcado: no cambia nada ni anota");
  assert.equal(hoy().actividad.length, 1);

  assert.equal(acciones.marcarPagosDeEquipo(["g_manu"], false), 1);
  const vuelve = hoy().gastos.find((g) => g.id === "g_manu")!;
  assert.equal(esPagoDeEquipo(vuelve), false);
  assert.equal("pagoDeEquipo" in vuelve.extra, false, "desmarcar saca la marca, no la deja en false");
  assert.match(hoy().actividad[0].detalle ?? "", /vuelven a sumar como costo|Se desmarcó/);
});
