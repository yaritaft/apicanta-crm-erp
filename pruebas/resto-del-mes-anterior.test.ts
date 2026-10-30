import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, diferenciasDesdeElCierre, PREFIJO_DE_RESTO } from "@/lib/honorarios";
import type { EstadoApp, Liquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Lo que entra después del corte pasa solo a la liquidación que sigue (Aldana, 29/10): «el próximo cierre tiene que cubrir todo lo que pase
   del 25 al 31». Septiembre de prueba se cierra con corte el 16/9 (el cobro del 20/9 queda afuera) y octubre trae la diferencia de cada uno.
   ================================================================== */

const SIGUIENTE = "2026-10";

function cerradaConCorte(corte: string | null): { e: EstadoApp; cerrada: Liquidacion } {
  const e0 = estadoDePrueba();
  const base = { id: `liq_${PERIODO}`, periodo: PERIODO, estado: "abierta", corte, entradas: {}, extras: [] } as unknown as Liquidacion;
  const cerrada = { ...base, estado: "cerrada", resultado: calcularLiquidacion(e0, PERIODO, base) } as unknown as Liquidacion;
  return { e: { ...e0, liquidaciones: [cerrada] } as EstadoApp, cerrada };
}

const restos = (e: EstadoApp) => calcularLiquidacion(e, SIGUIENTE).personas.flatMap((p) => p.lineas.filter((l) => l.clave.startsWith(PREFIJO_DE_RESTO)).map((l) => ({ p, l })));

test("un mes cerrado con corte deja el resto para la liquidación siguiente: lo que daría entero menos lo que se pagó, a cada uno lo suyo", () => {
  const { e, cerrada } = cerradaConCorte("2026-09-16");
  const dif = diferenciasDesdeElCierre(e, cerrada);
  assert.ok(dif.length > 0, "el cobro del 20/9 cambia lo de alguien");
  const r = restos(e);
  assert.equal(r.length, dif.length, "una línea por persona con diferencia");
  for (const d of dif) {
    const x = r.find((y) => y.p.miembroId === d.miembroId)!;
    assert.equal(Math.round(x.l.montoBase * 100), Math.round((d.hoy - d.cerrado) * 100), `${d.nombre}: el resto es la diferencia`);
    assert.match(x.l.nombre, /Resto de septiembre de 2026, después del 16\/09|Resto de septiembre/i);
    assert.equal(x.l.tipo, "arrastre");
    assert.ok(x.l.desglose?.pasos.length, "con su cuenta a la vista");
  }
});

test("los closers, cuyas comisiones calcula Finanzas, dejan el resto en Finanzas; los demás lo cargan como gasto al cerrar", () => {
  const { e } = cerradaConCorte("2026-09-16");
  const r = restos(e);
  const de = (id: string) => r.find((x) => x.p.miembroId === id)?.l;
  assert.equal(de("mariano")?.enFinanzas, true);
  const sinFinanzas = r.filter((x) => !x.l.enFinanzas);
  assert.ok(sinFinanzas.every((x) => x.l.variable));
});

test("sin corte, o con el mes cerrado entero, no queda resto", () => {
  assert.equal(restos(cerradaConCorte(null).e).length, 0);
  /* Cerrado con corte pero después de todo lo que entró: nada cambia. */
  assert.equal(restos(cerradaConCorte("2026-09-30").e).length, 0);
});

test("el resto no cuenta como costo del mes que sigue (ya estaba en los del mes anterior) y no se arrastra de un mes al otro", () => {
  const { e } = cerradaConCorte("2026-09-16");
  const sin = calcularLiquidacion({ ...e, liquidaciones: [] } as EstadoApp, SIGUIENTE);
  const con = calcularLiquidacion(e, SIGUIENTE);
  assert.equal(con.profit, sin.profit, "el profit de octubre no se mueve por el resto de septiembre");
  /* Octubre, ya cerrado, no vuelve a pedir el resto de septiembre dentro de su propia comparación. */
  const octCerrada = { id: "liq_2026-10", periodo: SIGUIENTE, estado: "cerrada", corte: null, entradas: {}, extras: [], resultado: con } as unknown as Liquidacion;
  const e2 = { ...e, liquidaciones: [...e.liquidaciones, octCerrada] } as EstadoApp;
  assert.deepEqual(diferenciasDesdeElCierre(e2, octCerrada), []);
});

test("el resto se puede corregir a mano como cualquier renglón", () => {
  const { e } = cerradaConCorte("2026-09-16");
  const una = restos(e)[0];
  const abierta = { id: "liq_2026-10", periodo: SIGUIENTE, estado: "abierta", entradas: { [`${una.p.miembroId}:${una.l.clave}`]: { monto: 5, nota: "ya se lo pasé" } }, extras: [] } as unknown as Liquidacion;
  const l = calcularLiquidacion(e, SIGUIENTE, abierta).personas.find((p) => p.miembroId === una.p.miembroId)!.lineas.find((x) => x.clave === una.l.clave)!;
  assert.equal(l.monto, 5);
  assert.equal(l.corregido, true);
});
