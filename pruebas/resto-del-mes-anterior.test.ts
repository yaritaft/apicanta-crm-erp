import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcularLiquidacion, diferenciasDesdeElCierre, pasaAlMesQueSigue, PREFIJO_DE_RESTO } from "@/lib/honorarios";
import type { EstadoApp, Liquidacion } from "@/lib/types";
import { concepto, esquema, estadoDePrueba, miembro, PERIODO } from "./estado-liquidacion";

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

test("sin corte, o con el mes cerrado entero, si nada cambió no queda resto", () => {
  assert.equal(restos(cerradaConCorte(null).e).length, 0);
  /* Cerrado con corte pero después de todo lo que entró: nada cambia. */
  assert.equal(restos(cerradaConCorte("2026-09-30").e).length, 0);
});

/* 05/11: octubre se cerró y después se corrigieron 5 ventas que eran del VSL de YouTube, no del webinar. La comisión de Agustín no cuenta
   YouTube (le tocaban US$ 495 menos) y la de Nahuel resta la de Agustín (le tocaban US$ 49,50 más). El descuento de Agustín se hizo a
   mano y lo de Nahuel se pasaba por alto (Aldana: «eso también influye en la comisión de Nahuel»). Ahora lo que cambió después de
   cerrar pasa solo, con o sin corte, a cada uno lo suyo, con las comisiones que dependen de otras. */
for (const corte of [null, "2026-09-30"]) {
  test(`cerrado ${corte ? "con corte el último día" : "sin corte"}: una venta corregida después pasa sola, también a quien cobra sobre la comisión de otro`, () => {
    const e0 = estadoDePrueba();
    const conCadena = {
      ...e0,
      equipo: [...e0.equipo, miembro("nahuel", "Nahuel Abadía", "otro")],
      honorarios: [
        ...e0.honorarios.filter((h) => h.miembroId !== "agus"),
        esquema("agus", [concepto({ id: "c_pp", tipo: "porcentaje", nombre: "Comisión de Agustín", tasa: 0.05, base: "profit", profitPropio: true, sinEmbudoIds: ["emb_yt"] })]),
        esquema("nahuel", [concepto({ id: "c_pp", tipo: "porcentaje", nombre: "Comisión de Nahuel", tasa: 0.10, base: "profit", profitPropio: true, descuentaComisionDe: ["agus"] })]),
      ],
      ventas: e0.ventas.map((v) => ({ ...v, embudoId: "emb_web" })),
      embudos: [{ id: "emb_web", nombre: "Webinar", esWebinar: true }, { id: "emb_yt", nombre: "VSL YOUTUBE" }],
    } as EstadoApp;
    const base = { id: `liq_${PERIODO}`, periodo: PERIODO, estado: "abierta", corte, entradas: {}, extras: [] } as unknown as Liquidacion;
    const cerrada = { ...base, estado: "cerrada", resultado: calcularLiquidacion(conCadena, PERIODO, base) } as unknown as Liquidacion;
    /* Después de cerrar: la venta de Belén Godoy (US$ 3.000 cobrados) era de YouTube. */
    const e = { ...conCadena, liquidaciones: [cerrada], ventas: conCadena.ventas.map((v) => (v.id === "v1" ? { ...v, embudoId: "emb_yt" } : v)) } as EstadoApp;
    const r = restos(e);
    const de = (id: string) => r.find((x) => x.p.miembroId === id)?.l;
    assert.equal(de("agus")?.montoBase, -150, "a Agustín se le descuenta el 5% de los 3.000 que ya no cuentan");
    assert.equal(de("nahuel")?.montoBase, 15, "a Nahuel le suma el 10% de lo que dejó de restarle la comisión de Agustín");
    assert.match(de("agus")!.nombre, /^Ajuste de septiembre 2026: cambió después de cerrar$/i);
    assert.match(de("agus")!.desglose!.avisos!.join(" "), /Comisión de Agustín/);
  });
}

test("la pantalla de un mes cerrado no pide cargar a mano lo que pasa solo", () => {
  const liq = readFileSync("src/components/equipo/Liquidacion.tsx", "utf8");
  assert.doesNotMatch(liq, /se suma a mano en el mes que viene/);
  assert.match(liq, /pasaAlMesQueSigue\(/);
  const cerradaSept = { periodo: "2026-09", estado: "cerrada" } as Liquidacion;
  assert.equal(pasaAlMesQueSigue([cerradaSept], "2026-09"), true, "octubre abierta: pasa sola");
  assert.equal(pasaAlMesQueSigue([cerradaSept, { periodo: "2026-10", estado: "cerrada" } as Liquidacion], "2026-09"), false, "octubre cerrada: no");
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

/* Aldana (01/11): «quería ver cuáles son las ventas que está contemplando» en el resto de cada uno. */
test("el resto dice qué renglones cambiaron y qué cobros entraron después del corte, para poder revisarlo venta por venta", () => {
  const { e, cerrada } = cerradaConCorte("2026-09-16");
  const dif = diferenciasDesdeElCierre(e, cerrada).find((d) => d.miembroId === "mariano")!;
  assert.ok(dif.renglones.length > 0, "dice qué renglón cambió");
  const comision = dif.renglones.find((r) => r.nombre === "Comisión de closer")!;
  assert.ok(comision && comision.hoy > comision.cerrado, "la comisión de Mariano subió desde el cierre");
  assert.equal(Math.round((dif.hoy - dif.cerrado) * 100), Math.round(dif.renglones.reduce((a, r) => a + (r.hoy - r.cerrado), 0) * 100), "los renglones explican toda la diferencia");
  assert.deepEqual(dif.despues.map((c) => c.cliente), ["Belén Godoy"], "el único cobro de sus ventas después del 16/9 es el del 20/9");
  assert.ok(dif.despues.every((c) => c.fecha.slice(0, 10) > "2026-09-16"));

  const resto = restos(e).find((x) => x.p.miembroId === "mariano")!.l;
  assert.ok(resto.desglose?.lista, "el renglón del resto trae la lista de cobros");
  assert.equal(resto.desglose!.lista!.items[0].cliente, "Belén Godoy");
  assert.match(resto.desglose!.lista!.titulo, /cobros después del 16\/09/);
  assert.match(resto.desglose!.avisos!.join(" "), /Qué cambió, renglón por renglón: Comisión de closer/);
});
