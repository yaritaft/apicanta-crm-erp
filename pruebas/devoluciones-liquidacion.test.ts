import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularLiquidacion, diferenciasDesdeElCierre, gastosDeLiquidacion, liquidacionCsv, liquidacionVacia, renglonDe, textoParaEnviar,
} from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EntradaLiquidacion, EstadoApp, LineaLiquidada, Liquidacion, PersonaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { devolucion, estadoDeYari, iso, NOVIEMBRE, OCTUBRE, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   La liquidación con devoluciones: la línea roja «Devolución de …» y la
   deuda que arrastra son renglones del motor, con su cuenta («Ver cómo se
   calculó») armada con los mismos números que el monto.

   El caso de Yari: venta del 28/09, cuotas pagadas el 28/09 y el 01/10,
   devolución del 03/10 con septiembre ya cerrado. Septiembre no cambia;
   octubre muestra la devolución; si el mes da en negativo, queda debiendo y
   se descuenta de noviembre.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;
const total = () => devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) });

const cerrar = (e: EstadoApp, periodo: string, entradas: Record<string, EntradaLiquidacion> = {}): Liquidacion => {
  const base = { ...liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z"), entradas };
  const resultado = calcularLiquidacion(e, periodo, base);
  /* La foto viaja por JSON, como al guardarla en la base. */
  return { ...base, estado: "cerrada", resultado: JSON.parse(JSON.stringify(resultado)) as ResultadoLiquidacion, cerradaEn: "2026-10-01T12:00:00.000Z" };
};

const persona = (r: ResultadoLiquidacion, id: string): PersonaLiquidada => {
  const p = r.personas.find((x) => x.miembroId === id);
  assert.ok(p, `falta ${id} en la liquidación`);
  return p;
};
const linea = (p: PersonaLiquidada, clave: string): LineaLiquidada => {
  const l = p.lineas.find((x) => x.clave === clave);
  assert.ok(l, `falta el renglón ${clave} de ${p.nombre}`);
  return l;
};

/* Septiembre cerrada (como en el caso real) y la devolución de octubre. */
function conSeptiembreCerrada(devoluciones = [total()]): EstadoApp {
  const sinDev = estadoDeYari();
  const sept = cerrar(sinDev, SEPTIEMBRE);
  return estadoDeYari({ liquidaciones: [sept], devoluciones });
}

test("septiembre: lo de siempre; Mariano cobra el 15% de lo que entró, Santi el 5%", () => {
  const r = calcularLiquidacion(estadoDeYari(), SEPTIEMBRE, undefined);
  assert.equal(linea(persona(r, "mariano"), "c_com").monto, 218.25);
  assert.equal(linea(persona(r, "santi"), "c_dir").monto, 72.75);
});

test("septiembre cerrada no cambia cuando llega la devolución del 03/10: ni sus números ni «Algo del mes cambió»", () => {
  const e = conSeptiembreCerrada();
  const liqSept = e.liquidaciones[0];
  /* Recalculada hoy da lo mismo que se cerró: la devolución es de octubre. */
  assert.deepEqual(diferenciasDesdeElCierre(e, liqSept), []);
  const hoy = calcularLiquidacion(e, SEPTIEMBRE, liqSept);
  assert.deepEqual(hoy.personas.map((p) => [p.miembroId, p.total]), liqSept.resultado!.personas.map((p) => [p.miembroId, p.total]));
  /* Y la foto no tiene ninguna línea de devolución. */
  assert.ok(!liqSept.resultado!.personas.some((p) => p.lineas.some((l) => l.tipo === "devolucion")));
});

test("octubre muestra la línea «Devolución de Belén Godoy» en rojo y la comisión del mes", () => {
  const r = calcularLiquidacion(conSeptiembreCerrada(), OCTUBRE, undefined);
  const mariano = persona(r, "mariano");
  /* La cuota 2 entró en octubre: comisiona 218,25; la devolución revierte lo de las dos cuotas, 436,50. */
  assert.equal(linea(mariano, "c_com").monto, 218.25);
  const dev = linea(mariano, "devolucion:d1:closer");
  assert.equal(dev.nombre, "Devolución de Belén Godoy");
  assert.equal(dev.tipo, "devolucion");
  assert.equal(dev.monto, -436.5);
  assert.equal(dev.devolucionId, "d1");
  assert.equal(dev.enFinanzas, true, "Finanzas ya la resta de sus comisiones: al cerrar no se carga de nuevo");
  assert.equal(dev.variable, true);
  /* El director revierte lo suyo. */
  const santi = persona(r, "santi");
  assert.equal(linea(santi, "devolucion:d1:director").monto, -145.5);
});

test("la línea de la devolución tiene su «Ver cómo se calculó», y la cuenta cierra EXACTO con el monto", () => {
  const r = calcularLiquidacion(conSeptiembreCerrada(), OCTUBRE, undefined);
  const dev = linea(persona(r, "mariano"), "devolucion:d1:closer");
  const d = dev.desglose!;
  assert.ok(d, "tiene desglose");
  assert.deepEqual(evaluarPasos(d.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(d), dev.monto);
  assert.deepEqual(d.pasos.map((p) => [p.op, p.valor]), [
    ["base", 3000], ["menos", 90], ["igual", 2910],            // lo cobrado de la venta hasta el 03/10, post pasarelas
    ["por", 0.15], ["igual", 436.5],                           // lo que se le comisionó
    ["por", 3000], ["igual", 436.5],                           // la parte devuelta (todo) y lo que se revierte
    ["por", -1], ["igual", -436.5],                            // se descuenta
  ]);
  assert.equal(d.pasos[5].de, 3000);
  assert.match(d.regla, /Se le revierte lo que se le comisionó \(15% del cash collected post pasarelas de las ventas que cerró\)/);
  /* Los cobros que formaron lo comisionado, con quién y por dónde. */
  assert.equal(d.lista?.tipo, "cobros");
  assert.equal(d.lista?.total, 2);
  assert.deepEqual(d.lista?.items.map((x) => [x.cliente, x.monto, x.fee, x.neto]), [["Belén Godoy", 1500, 45, 1455], ["Belén Godoy", 1500, 45, 1455]]);
  assert.ok(d.avisos!.some((a) => a.includes("no el porcentaje de lo devuelto")));
});

test("la deuda: si el mes da en negativo no se le paga nada y lo que queda debiendo es un renglón que pasa a noviembre", () => {
  const r = calcularLiquidacion(conSeptiembreCerrada(), OCTUBRE, undefined);
  const mariano = persona(r, "mariano");
  /* 218,25 de la cuota 2 menos 436,50 de la devolución: −218,25. */
  const sale = linea(mariano, "arrastre-sale:2026-10:USD");
  assert.equal(sale.nombre, "Pasa a noviembre 2026");
  assert.equal(sale.monto, 218.25);
  assert.equal(sale.enFinanzas, true, "no es un gasto: no se carga en Finanzas");
  assert.deepEqual(evaluarPasos(sale.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(sale.desglose!), sale.monto);
  assert.deepEqual(sale.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", -218.25], ["por", -1], ["igual", 218.25]]);
  /* No se le paga nada y queda anotada la deuda. */
  assert.equal(mariano.total, 0);
  assert.deepEqual(mariano.aPagar, { USD: 0 });
  assert.deepEqual(mariano.deuda, { USD: 218.25 });
  /* Lo mismo con Santi (el 5%). */
  assert.deepEqual(persona(r, "santi").deuda, { USD: 72.75 });
  /* Dante no tuvo nada que ver. */
  assert.equal(persona(r, "dante").deuda, undefined);
});

test("la liquidación de octubre cerrada: noviembre trae la deuda en un renglón negativo, con su cuenta", () => {
  const e0 = conSeptiembreCerrada();
  const oct = cerrar(e0, OCTUBRE);
  const e = { ...e0, liquidaciones: [...e0.liquidaciones, oct] } as EstadoApp;
  /* La deuda viaja en la foto (JSON). */
  assert.deepEqual(persona(oct.resultado!, "mariano").deuda, { USD: 218.25 });

  const nov = calcularLiquidacion(e, NOVIEMBRE, undefined);
  const mariano = persona(nov, "mariano");
  const entra = linea(mariano, "arrastre-entra:2026-10:USD");
  assert.equal(entra.nombre, "Deuda de octubre 2026");
  assert.equal(entra.monto, -218.25);
  assert.equal(entra.tipo, "arrastre");
  assert.equal(entra.enFinanzas, true);
  assert.deepEqual(evaluarPasos(entra.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(entra.desglose!), entra.monto);
  /* Noviembre no cobra nada: sigue debiendo y pasa a diciembre. */
  assert.deepEqual(mariano.deuda, { USD: 218.25 });
  assert.equal(mariano.total, 0);

  /* Con una venta que cobra en noviembre, se descuenta de ahí y no queda deuda. */
  const conCobro = {
    ...e,
    ventas: [...e.ventas, { ...e.ventas[0], id: "v2", contactoNombre: "Pedro Gómez", fecha: iso(NOVIEMBRE, 5) }],
    cuotas: [...e.cuotas, { id: "c2a", ventaId: "v2", numero: 1, monto: 2000, estado: "pagada", esReserva: false }],
    pagos: [...e.pagos, { id: "p9", cuotaId: "c2a", monto: 2000, feeMonto: 60, fecha: iso(NOVIEMBRE, 5), procesadorId: "proc_stripe", moneda: "USD", feeRate: 0.03, creadoEn: iso(NOVIEMBRE, 5) }],
  } as EstadoApp;
  const m2 = persona(calcularLiquidacion(conCobro, NOVIEMBRE, undefined), "mariano");
  assert.equal(linea(m2, "c_com").monto, 291);                    // 15% de 1.940
  assert.equal(m2.total, r2(291 - 218.25));
  assert.equal(m2.deuda, undefined);
  assert.ok(!m2.lineas.some((l) => l.clave.startsWith("arrastre-sale")));
});

test("con octubre abierta, noviembre no inventa nada: sólo lo cerrado se arrastra", () => {
  const nov = calcularLiquidacion(conSeptiembreCerrada(), NOVIEMBRE, undefined);
  assert.ok(!nov.personas.some((p) => p.lineas.some((l) => l.tipo === "arrastre")));
});

test("«no descontar al closer»: la devolución no deja ninguna línea y se le paga igual", () => {
  const e = conSeptiembreCerrada([devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3), noDescontarAlCloser: true })]);
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  const mariano = persona(r, "mariano");
  assert.ok(!mariano.lineas.some((l) => l.tipo === "devolucion" || l.tipo === "arrastre"));
  assert.equal(mariano.total, 218.25);
  assert.equal(mariano.deuda, undefined);
});

test("lo que la liquidación revierte es exactamente lo que Finanzas resta de las comisiones", () => {
  const e = conSeptiembreCerrada();
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  const enLiquidacion = r2(r.personas.flatMap((p) => p.lineas).filter((l) => l.tipo === "devolucion").reduce((a, l) => a + l.monto, 0));
  const filas = comisionesDelMes(e, rangoDePeriodo(OCTUBRE)).filter((f) => f.devolucionId);
  const enFinanzas = r2(filas.reduce((a, f) => a + f.comisionCloser + f.comisionDirector, 0));
  assert.equal(enLiquidacion, -582);
  assert.equal(enLiquidacion, enFinanzas);
  /* La comisión neta del mes en Finanzas es la suma de lo que dicen la comisión y la devolución de cada persona. */
  const p = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  const sinOffset = r2(r.personas.flatMap((x) => x.lineas).filter((l) => l.enFinanzas && l.tipo !== "arrastre").reduce((a, l) => a + l.monto, 0));
  assert.equal(sinOffset, r2(p.comisionCloser + p.comisionDirector));
});

test("al cerrar octubre, nada de esto se carga como gasto: Finanzas ya lo tiene", () => {
  const e = conSeptiembreCerrada();
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  assert.deepEqual(gastosDeLiquidacion(e, { id: "liq_2026-10", periodo: OCTUBRE }, r), []);
  /* Y el profit de octubre es el de Finanzas: la deuda no lo mueve. */
  assert.equal(r.profit, r2(calcularPyL(e, rangoDePeriodo(OCTUBRE)).operativoCC));
});

test("la foto de octubre guarda la devolución: reabrir otra liquidación no la mueve de lugar", () => {
  const e0 = conSeptiembreCerrada();
  const oct = cerrar(e0, OCTUBRE);
  const e = { ...e0, liquidaciones: [...e0.liquidaciones, oct] } as EstadoApp;
  /* La línea sigue en la foto, y un recálculo de octubre cerrada da lo mismo que se cerró. */
  assert.ok(renglonDe(oct.resultado, "mariano", "devolucion:d1:closer"));
  assert.deepEqual(diferenciasDesdeElCierre(e, oct), []);
  /* Noviembre no vuelve a descontarla. */
  const nov = calcularLiquidacion(e, NOVIEMBRE, undefined);
  assert.ok(!nov.personas.some((p) => p.lineas.some((l) => l.devolucionId === "d1")));
});

test("una devolución con fecha de septiembre que llega con septiembre cerrado entra en octubre, sin reescribir septiembre", () => {
  const tarde = devolucion({ id: "d2", monto: 1500, fecha: iso(SEPTIEMBRE, 29) });
  const e = conSeptiembreCerrada([tarde]);
  const liqSept = e.liquidaciones[0];
  /* Septiembre cerrada: las comisiones de la foto no cambian (la devolución no está en su foto). */
  const hoySept = calcularLiquidacion(e, SEPTIEMBRE, liqSept);
  assert.ok(!hoySept.personas.some((p) => p.lineas.some((l) => l.tipo === "devolucion")));
  /* Octubre abierta la recibe, con lo que se comisionó hasta el 29/09 (sólo la cuota 1). */
  const mariano = persona(calcularLiquidacion(e, OCTUBRE, undefined), "mariano");
  assert.equal(linea(mariano, "devolucion:d2:closer").monto, -218.25);
  /* Finanzas la resta el día que se devolvió la plata: en septiembre. */
  assert.equal(calcularPyL(e, rangoDePeriodo(SEPTIEMBRE)).devoluciones, 1500);
});

test("devolución parcial: se revierte la parte de lo comisionado y el renglón lo dice", () => {
  const e = conSeptiembreCerrada([devolucion({ id: "d1", monto: 750, fecha: iso(OCTUBRE, 3) })]);
  const mariano = persona(calcularLiquidacion(e, OCTUBRE, undefined), "mariano");
  const dev = linea(mariano, "devolucion:d1:closer");
  assert.equal(dev.monto, -109.13);
  assert.deepEqual(evaluarPasos(dev.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(dev.desglose!), dev.monto);
  assert.ok(dev.desglose!.avisos!.some((a) => a.includes("Se devolvió una parte")));
  assert.match(dev.detalle, /el 25%/);
  /* 218,25 − 109,13 > 0: no queda deuda, simplemente cobra menos. */
  assert.equal(mariano.total, r2(218.25 - 109.13));
  assert.equal(mariano.deuda, undefined);
});

test("se puede corregir a mano la línea de la devolución, y la cuenta lo dice", () => {
  const e = conSeptiembreCerrada();
  const liq = { ...liquidacionVacia(OCTUBRE, "2026-10-05T12:00:00.000Z"), entradas: { "mariano:devolucion:d1:closer": { monto: -200, nota: "Se acordó descontar sólo 200" } } };
  const mariano = persona(calcularLiquidacion(e, OCTUBRE, liq), "mariano");
  const dev = linea(mariano, "devolucion:d1:closer");
  assert.equal(dev.monto, -200);
  assert.equal(dev.corregido, true);
  assert.equal(dev.desglose!.correccion!.cuentaDaba, -436.5);
  assert.equal(resultadoDelDesglose(dev.desglose!), -436.5);
  assert.equal(mariano.total, 18.25);
});

test("quien ya no está en el equipo y tiene una devolución no se pierde: queda debiendo", () => {
  /* Mariano se fue el 30/09 pero la cuota 1 le comisionó (28/09): la devolución del 03/10 le revierte 218,25. */
  const e0 = conSeptiembreCerrada();
  const e = { ...e0, equipo: e0.equipo.map((m) => (m.id === "mariano" ? { ...m, activo: false, hasta: "2026-09-30" } : m)) } as EstadoApp;
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  const mariano = persona(r, "mariano");
  assert.equal(mariano.inactivo, true);
  /* Octubre no le comisiona nada (se fue antes de la cuota 2): sólo la devolución de lo de septiembre. */
  assert.deepEqual(mariano.lineas.map((l) => [l.tipo, l.monto]), [["devolucion", -218.25], ["arrastre", 218.25]]);
  assert.deepEqual(mariano.deuda, { USD: 218.25 });
  assert.equal(mariano.total, 0);
});

test("cada línea de cada persona en septiembre, octubre y noviembre cierra con su cuenta", () => {
  const e0 = conSeptiembreCerrada();
  const oct = cerrar(e0, OCTUBRE);
  const e = { ...e0, liquidaciones: [...e0.liquidaciones, oct] } as EstadoApp;
  let vistas = 0, conDev = 0;
  for (const periodo of [SEPTIEMBRE, OCTUBRE, NOVIEMBRE]) {
    for (const p of calcularLiquidacion(e, periodo, undefined).personas) {
      for (const l of p.lineas) {
        assert.ok(l.desglose, `${periodo} · ${p.nombre}: «${l.nombre}»`);
        assert.deepEqual(evaluarPasos(l.desglose.pasos).fallas, [], `${periodo} · ${p.nombre}: «${l.nombre}»`);
        assert.equal(resultadoDelDesglose(l.desglose), l.monto, `${periodo} · ${p.nombre}: «${l.nombre}»`);
        vistas++;
        if (l.tipo === "devolucion" || l.tipo === "arrastre") conDev++;
      }
    }
  }
  assert.ok(vistas >= 9, `vistas ${vistas}`);
  assert.ok(conDev >= 6, `con devolución o deuda ${conDev}`);
});

test("«Copiar para mandarle» y el CSV nombran la devolución y la deuda", () => {
  const e = conSeptiembreCerrada();
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  const texto = textoParaEnviar(persona(r, "mariano"), OCTUBRE);
  assert.match(texto, /• Devolución de Belén Godoy: −US\$ 436,50/);
  assert.match(texto, /• Pasa a noviembre 2026: US\$ 218,25/);
  assert.match(texto, /Total: US\$ 0/);
  const csv = liquidacionCsv(r, OCTUBRE);
  assert.match(csv, /"Devolución de Belén Godoy"/);
});

test("sin devoluciones la liquidación es la de siempre: nada de arrastre ni de líneas nuevas", () => {
  const e = estadoDeYari();
  for (const periodo of [SEPTIEMBRE, OCTUBRE, NOVIEMBRE]) {
    const r = calcularLiquidacion(e, periodo, undefined);
    assert.ok(!r.personas.some((p) => p.deuda || p.lineas.some((l) => l.tipo === "devolucion" || l.tipo === "arrastre")), periodo);
  }
});

/* ---------- Lo que se mide sobre todo el cash del negocio ---------- */

/* Manu cobra US$ 100 por cada US$ 500 de cash post pasarelas del negocio y el 2% del cash collected del negocio. */
function conManu(devoluciones: ReturnType<typeof devolucion>[]): EstadoApp {
  const e = estadoDeYari({ devoluciones });
  return {
    ...e,
    equipo: [...e.equipo, { id: "manu", nombre: "Manuel Pérez", rol: "otro", comisionRate: 0, activo: true, sinComision: false }],
    honorarios: [...e.honorarios, {
      id: "hon_manu", miembroId: "manu", categoriaGasto: "Equipo / Salarios", actualizadoEn: "",
      conceptos: [
        { id: "t", tipo: "tramo", nombre: "Tramo de cash", moneda: "USD", monto: 100, cada: 500, base: "cash-neto", alcance: "todas" },
        { id: "p", tipo: "porcentaje", nombre: "2% del cash", moneda: "USD", tasa: 0.02, base: "cash", alcance: "todas" },
      ],
    }],
  } as EstadoApp;
}

test("lo que se mide sobre el cash del negocio resta las devoluciones, igual que el Cash Collected de Finanzas", () => {
  /* Octubre: entra la cuota 2 (1.500, fee 45) y se devuelven 500. */
  const e = conManu([devolucion({ id: "d1", monto: 500, fecha: iso(OCTUBRE, 3) })]);
  const r = calcularLiquidacion(e, OCTUBRE, undefined);
  const manu = persona(r, "manu");
  const tramo = linea(manu, "t");
  /* 1.455 post pasarelas − 500 devueltos = 955 → 1 tramo completo de 500. */
  assert.deepEqual(tramo.desglose!.pasos.map((p) => [p.op, p.valor]), [
    ["base", 1500], ["menos", 500], ["menos", 45], ["igual", 955], ["tramos", 500], ["igual", 1], ["por", 100], ["igual", 100],
  ]);
  assert.equal(tramo.monto, 100);
  assert.deepEqual(evaluarPasos(tramo.desglose!.pasos).fallas, []);
  assert.ok(tramo.desglose!.avisos!.some((a) => a.includes("resta de lo que se mide")));
  /* El 2% del cash (sin la comisión de la pasarela): 1.500 − 500 = 1.000 → 20. */
  const pct = linea(manu, "p");
  assert.equal(pct.monto, 20);
  assert.deepEqual(pct.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 1500], ["menos", 500], ["igual", 1000], ["por", 0.02], ["igual", 20]]);
  /* Es el mismo número que el cash collected post pasarelas de Finanzas del mes. */
  const p = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  assert.equal(p.cashCollected - p.feesProcesador, 955);
});

test("con más devoluciones que cobros no hay base para pagar: cero, y la cuenta lo dice", () => {
  const e = conManu([total()]);
  const manu = persona(calcularLiquidacion(e, OCTUBRE, undefined), "manu");
  const tramo = linea(manu, "t");
  assert.equal(tramo.monto, 0);
  const pasos = tramo.desglose!.pasos;
  assert.deepEqual(pasos.slice(0, 6).map((p) => [p.op, p.valor]), [["base", 1500], ["menos", 3000], ["menos", 45], ["igual", -1545], ["por", 0], ["igual", 0]]);
  assert.deepEqual(evaluarPasos(pasos).fallas, []);
  assert.equal(resultadoDelDesglose(tramo.desglose!), 0);
  assert.equal(linea(manu, "p").monto, 0);
  /* Y Manu no cobra en negativo ni queda debiendo: esto no es una comisión de ventas. */
  assert.equal(manu.deuda, undefined);
  assert.equal(manu.total, 0);
});

test("«no descontar al closer» no cambia lo que cobra quien mide el cash de todo el negocio", () => {
  const sin = conManu([devolucion({ id: "d1", monto: 500, fecha: iso(OCTUBRE, 3) })]);
  const con = conManu([devolucion({ id: "d1", monto: 500, fecha: iso(OCTUBRE, 3), noDescontarAlCloser: true })]);
  const a = persona(calcularLiquidacion(sin, OCTUBRE, undefined), "manu");
  const b = persona(calcularLiquidacion(con, OCTUBRE, undefined), "manu");
  assert.equal(a.total, b.total);
});
