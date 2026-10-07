import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularPyL, cashCollected, comisionesDelMes, comisionesPorCloser, totalComisiones,
} from "@/lib/finanzas";
import {
  devolvibleDeVenta, mesDeLiquidacion, problemaDeDevolucion, reversasDeComision, reversasDelMes,
} from "@/lib/devoluciones";
import { cajaEsperada } from "@/lib/caja";
import { saldosEsperados } from "@/lib/traspasos";
import { abribles, armarEstadoResultados, ayudaDeRenglon, esBloque, type ItemPyL, type NodoPyL } from "@/lib/estadoResultados";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp } from "@/lib/types";
import {
  devolucion, estadoDeYari, iso, liquidacionCerrada, NOVIEMBRE, OCTUBRE, pago, SEPTIEMBRE,
} from "./estado-devolucion";

/* ==================================================================
   Devoluciones: Finanzas resta en el mes en que se devuelve la plata, la
   venta sigue contando en su mes, la comisión de la pasarela no se toca y
   al closer y al director se les revierte exactamente lo que se les
   comisionó (el caso de Yari está en estado-devolucion.ts).
   ================================================================== */

const sept = rangoDePeriodo(SEPTIEMBRE);
const oct = rangoDePeriodo(OCTUBRE);
const nov = rangoDePeriodo(NOVIEMBRE);
const r2 = (n: number) => Math.round(n * 100) / 100;

/* La devolución de Belén del 03/10: toda la plata. */
const total = () => devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) });
const conTotal = () => estadoDeYari({ devoluciones: [total()] });

test("sin devoluciones, los números son los de siempre", () => {
  const e = estadoDeYari();
  const s = calcularPyL(e, sept);
  assert.equal(s.revenue, 3000);
  assert.equal(s.cobrado, 1500);
  assert.equal(s.devoluciones, 0);
  assert.equal(s.cashCollected, 1500);
  assert.equal(s.feesProcesador, 45);
  assert.equal(r2(s.comisionCloser), 218.25);
  assert.equal(r2(s.comisionDirector), 72.75);
  assert.equal(r2(s.brutoCC), 1164);
  assert.equal(r2(s.brutoRev), 2664);
});

test("septiembre no cambia: la devolución del 03/10 no reescribe el pasado", () => {
  const antes = calcularPyL(estadoDeYari(), sept);
  const despues = calcularPyL(conTotal(), sept);
  assert.deepEqual(despues, antes);
  assert.equal(cashCollected(conTotal(), sept), 1500);
});

test("octubre muestra la devolución: resta del Cash Collected y de lo facturado, y no toca los fees", () => {
  const sin = calcularPyL(estadoDeYari(), oct);
  const con = calcularPyL(conTotal(), oct);
  /* Lo que entró en octubre sigue siendo lo que entró: la cuota 2. */
  assert.equal(con.cobrado, 1500);
  assert.equal(con.devoluciones, 3000);
  assert.equal(con.cashCollected, -1500);
  assert.equal(cashCollected(conTotal(), oct), -1500);
  /* La venta sigue contando en septiembre: octubre no factura nada. */
  assert.equal(con.revenue, 0);
  assert.equal(con.ventas, 0);
  /* Stripe se queda con su comisión aunque se devuelva. */
  assert.equal(con.feesProcesador, sin.feesProcesador);
  assert.equal(con.feesProcesador, 45);
  /* La utilidad bruta baja exactamente lo devuelto, más lo que se revierte de comisiones. */
  assert.equal(r2(con.brutoCC), r2(sin.brutoCC - 3000 + 436.5 + 145.5));
  assert.equal(r2(con.brutoRev), r2(sin.brutoRev - 3000 + 436.5 + 145.5));
});

test("al closer y al director se les revierte exactamente lo que se les comisionó, como una línea negativa de octubre", () => {
  const e = conTotal();
  const filas = comisionesDelMes(e, oct);
  const rev = filas.filter((f) => f.devolucionId === "d1");
  assert.equal(rev.length, 1);
  /* 15% de 2.910 post pasarelas (las dos cuotas): lo que se le pagó por Belén, entero. */
  assert.equal(r2(rev[0].comisionCloser), -436.5);
  assert.equal(r2(rev[0].comisionDirector), -145.5);
  assert.equal(rev[0].closerId, "mariano");
  assert.equal(rev[0].directorId, "santi");
  const t = totalComisiones(filas);
  /* La cuota 2 de octubre comisionó 218,25 y 72,75: neto de la devolución, octubre queda en negativo. */
  assert.equal(r2(t.closers), r2(218.25 - 436.5));
  assert.equal(r2(t.director), r2(72.75 - 145.5));
  /* Y por persona: Mariano debe 218,25 en octubre. */
  const mariano = comisionesPorCloser(e, oct).find((g) => g.closerId === "mariano");
  assert.equal(r2(mariano!.total), -218.25);
});

test("no es el % sobre lo devuelto: el % de 3.000 daría 450 y lo comisionado fue 436,50", () => {
  const rev = reversasDeComision(conTotal())[0];
  const mariano = rev.partes.find((p) => p.miembroId === "mariano")!;
  assert.equal(mariano.neto, 2910);
  assert.equal(mariano.comision, 436.5);
  assert.equal(mariano.reversa, 436.5);
  assert.notEqual(mariano.reversa, r2(3000 * 0.15));
});

test("una devolución parcial revierte esa parte de lo comisionado", () => {
  /* 750 de los 3.000 cobrados: la cuarta parte. */
  const e = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 750, fecha: iso(OCTUBRE, 3) })] });
  const [r] = reversasDeComision(e);
  assert.equal(r.parte, 0.25);
  const filas = comisionesDelMes(e, oct).filter((f) => f.devolucionId);
  assert.equal(r2(filas[0].comisionCloser), -109.13);   // 436,50 / 4 = 109,125
  assert.equal(r2(filas[0].comisionDirector), -36.38);  // 145,50 / 4 = 36,375
  assert.equal(calcularPyL(e, oct).devoluciones, 750);
});

test("«no descontar al closer»: la plata sale pero la comisión se queda", () => {
  const e = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3), noDescontarAlCloser: true })] });
  assert.equal(comisionesDelMes(e, oct).filter((f) => f.devolucionId).length, 0);
  const p = calcularPyL(e, oct);
  assert.equal(p.cashCollected, -1500);
  assert.equal(r2(p.comisionCloser), 218.25);
  assert.equal(r2(p.comisionDirector), 72.75);
  /* La cuenta sigue existiendo (para mostrarla), pero no se aplica. */
  assert.equal(reversasDeComision(e)[0].sinDescuento, true);
  assert.equal(reversasDelMes(e, oct).length, 0);
});

test("dos devoluciones de la misma venta: entre las dos no pasan de lo comisionado", () => {
  /* Primero se devuelve la cuota 1 (antes de que entre la 2) y después la cuota 2. */
  const e = estadoDeYari({
    devoluciones: [
      devolucion({ id: "d1", monto: 1500, fecha: iso(SEPTIEMBRE, 30) }),
      devolucion({ id: "d2", monto: 1500, fecha: iso(OCTUBRE, 5) }),
    ],
  });
  const [a, b] = reversasDeComision(e).sort((x, y) => x.devolucion.id.localeCompare(y.devolucion.id));
  const m = (r: typeof a) => r.partes.find((p) => p.miembroId === "mariano")!;
  /* d1: sólo había entrado la cuota 1 → se revierte la comisión de esa cuota entera. */
  assert.equal(m(a).reversa, 218.25);
  assert.equal(a.parte, 1);
  /* d2: la cuota 2 entró el 01/10; quedaba por revertir lo de la cuota 2, y nada más. */
  assert.equal(b.yaDevuelto, 1500);
  assert.equal(b.quedaba, 1500);
  assert.equal(m(b).yaRevertido, 218.25);
  assert.equal(m(b).quedaba, 218.25);
  assert.equal(m(b).reversa, 218.25);
  assert.equal(r2(m(a).reversa + m(b).reversa), 436.5);
});

test("una devolución de más no se pasa de lo cobrado", () => {
  const e = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 9000, fecha: iso(OCTUBRE, 3) })] });
  const [r] = reversasDeComision(e);
  assert.equal(r.devuelto, 3000);
  assert.equal(r.parte, 1);
  assert.equal(r.partes.find((p) => p.miembroId === "mariano")!.reversa, 436.5);
});

test("una venta cancelada no comisionó nada: la plata se resta pero no hay comisión que revertir", () => {
  const e0 = estadoDeYari({ devoluciones: [total()] });
  const e = { ...e0, ventas: e0.ventas.map((v) => ({ ...v, estado: "cancelada" as const })) } as EstadoApp;
  assert.equal(reversasDeComision(e).length, 0);
  assert.equal(calcularPyL(e, oct).cashCollected, -1500 + 0);
});

test("lo que cobra el que se fue: sólo se revierte lo que se le había comisionado", () => {
  /* Mariano se fue el 30/09: la cuota 2 (01/10) no le comisionó nada. */
  const e0 = conTotal();
  const e = { ...e0, equipo: e0.equipo.map((m) => (m.id === "mariano" ? { ...m, hasta: "2026-09-30" } : m)) } as EstadoApp;
  const mariano = reversasDeComision(e)[0].partes.find((p) => p.miembroId === "mariano")!;
  assert.equal(mariano.neto, 1455);
  assert.equal(mariano.reversa, 218.25);
});

test("cuotas heredadas: cada closer revierte lo suyo", () => {
  /* La cuota 2 la heredó Dante (10%). */
  const e0 = conTotal();
  const e = { ...e0, cuotas: e0.cuotas.map((c) => (c.id === "c1b" ? { ...c, closerId: "dante" } : c)) } as EstadoApp;
  const partes = reversasDeComision(e)[0].partes;
  assert.equal(partes.find((p) => p.miembroId === "mariano")!.reversa, 218.25);
  assert.equal(partes.find((p) => p.miembroId === "dante")!.reversa, 145.5);
  assert.equal(partes.find((p) => p.miembroId === "dante")!.heredadaDe, "Mariano Arias");
  const filas = comisionesDelMes(e, oct).filter((f) => f.devolucionId);
  assert.equal(filas.length, 2);
  assert.equal(r2(filas.reduce((a, f) => a + f.comisionCloser, 0)), -363.75);
  /* El director revierte lo de todo lo cobrado, una sola vez. */
  assert.equal(r2(filas.reduce((a, f) => a + f.comisionDirector, 0)), -145.5);
});

test("si la cerró quien no comisiona (Yari), no hay nada que revertir", () => {
  const e0 = conTotal();
  const e = { ...e0, ventas: e0.ventas.map((v) => ({ ...v, closerId: "yari", directorId: undefined })) } as EstadoApp;
  assert.equal(comisionesDelMes(e, oct).filter((f) => f.devolucionId).length, 0);
  assert.equal(calcularPyL(e, oct).cashCollected, -1500);
});

test("una propuesta de la pasarela o una ignorada no cuentan hasta que alguien la confirma", () => {
  const e = estadoDeYari({
    devoluciones: [
      devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3), estado: "propuesta" }),
      devolucion({ id: "d2", monto: 500, fecha: iso(OCTUBRE, 4), estado: "ignorada" }),
    ],
  });
  assert.equal(calcularPyL(e, oct).devoluciones, 0);
  assert.equal(calcularPyL(e, oct).cashCollected, 1500);
  assert.equal(reversasDeComision(e).length, 0);
});

test("una devolución sin la lista en el estado (una base de antes) no rompe nada", () => {
  const e = estadoDeYari();
  delete (e as unknown as { devoluciones?: unknown }).devoluciones;
  assert.equal(calcularPyL(e, oct).cashCollected, 1500);
  assert.deepEqual(reversasDeComision(e), []);
});

/* ---------- La caja ---------- */

test("la caja resta la devolución (y la de la cuenta de la que salió), pero no la comisión de la pasarela", () => {
  const arqueo = { fecha: iso(SEPTIEMBRE, 30, 23), total: 10000 };
  const hasta = iso(OCTUBRE, 20);
  const sin = cajaEsperada(estadoDeYari(), arqueo, hasta);
  const con = cajaEsperada(conTotal(), arqueo, hasta);
  assert.equal(sin.devoluciones, 0);
  assert.equal(con.devoluciones, 3000);
  assert.equal(con.cobrado, sin.cobrado);          // lo que entró sigue siendo lo que entró
  assert.equal(con.procesador, sin.procesador);    // y Stripe se queda con lo suyo
  /* Se va la plata devuelta; se recupera lo que se había comisionado. */
  assert.equal(r2(con.esperado), r2(sin.esperado - 3000 + 436.5 + 145.5));

  /* Por cuenta: Stripe baja lo que se devolvió, entero. */
  const porCuenta = saldosEsperados(conTotal(), { fecha: arqueo.fecha, saldos: [{ procesadorId: "proc_stripe", monto: 5000, moneda: "USD", montoBase: 5000 }] }, hasta);
  const stripe = porCuenta.get("proc_stripe")!;
  assert.equal(stripe.entro, 1455);                // la cuota 2, neta de su comisión
  assert.equal(stripe.salio, 3000);
  assert.equal(stripe.esperado, r2(5000 + 1455 - 3000));
});

test("lo que salió de una cuenta en pesos se descuenta en pesos", () => {
  const e = estadoDeYari({
    devoluciones: [devolucion({ id: "d1", monto: 100, fecha: iso(OCTUBRE, 3), procesadorId: "proc_fin", montoArs: 150000, tipoCambio: 1500 })],
  });
  const m = saldosEsperados(e, { fecha: iso(SEPTIEMBRE, 30, 23), saldos: [{ procesadorId: "proc_fin", monto: 1000000, moneda: "ARS", montoBase: 666.67 }] }, iso(OCTUBRE, 20));
  assert.equal(m.get("proc_fin")!.salio, 150000);
  assert.equal(m.get("proc_fin")!.esperado, 850000);
});

/* ---------- El estado de resultados ---------- */

const nodos = (items: ItemPyL[]): NodoPyL[] => items.filter((x): x is NodoPyL => !esBloque(x));
const M = (n: number) => String(n);
const hrefGasto = () => "/x";

test("el estado de resultados de octubre tiene su renglón de Devoluciones y cada detalle suma lo que su renglón", () => {
  const e = conTotal();
  const p = calcularPyL(e, oct);
  const items = nodos(armarEstadoResultados(e, oct, p, M, hrefGasto));
  const dev = items.find((x) => x.id === "devoluciones")!;
  assert.ok(dev, "falta el renglón de devoluciones");
  assert.equal(dev.cc, -3000);
  assert.equal(dev.rev, -3000);
  assert.equal(r2(dev.hijos!.reduce((a, h) => a + (h.cc ?? 0), 0)), -3000);
  assert.equal(dev.hijos![0].titulo, "Belén Godoy");

  /* Ingresos sigue siendo lo que entró y lo facturado. */
  const ing = items.find((x) => x.id === "ingresos")!;
  assert.equal(ing.cc, 1500);
  assert.equal(ing.rev, 0);

  /* Las comisiones traen la línea negativa. */
  const closers = items.find((x) => x.id === "closers")!;
  assert.equal(r2(closers.cc ?? 0), r2(-(218.25 - 436.5)));
  assert.equal(r2(closers.hijos!.reduce((a, h) => a + (h.cc ?? 0), 0)), r2(closers.cc ?? 0));
  assert.ok(closers.hijos![0].hijos!.some((h) => h.titulo.startsWith("Devolución de")));

  /* La cuenta cierra: ingresos − devoluciones − costos directos = utilidad bruta, en las dos columnas. */
  const directos = items.find((x) => x.id === "closers")!.cc! + items.find((x) => x.id === "director")!.cc!
    + items.find((x) => x.id === "procesadores")!.cc! + items.find((x) => x.id === "directos")!.cc!;
  const bruta = items.find((x) => x.id === "bruta")!;
  assert.equal(r2(ing.cc! + dev.cc! + directos), r2(bruta.cc!));
  assert.equal(r2(ing.rev! + dev.rev! + directos), r2(bruta.rev!));
  assert.equal(r2(bruta.cc!), r2(p.brutoCC));
  assert.equal(r2(bruta.rev!), r2(p.brutoRev));
  assert.ok(bruta.hijos!.some((h) => h.id === "bruta/devoluciones"));
  assert.ok(abribles(armarEstadoResultados(e, oct, p, M, hrefGasto)).includes("devoluciones"));
});

test("sin devoluciones el estado de resultados no muestra el renglón", () => {
  const e = estadoDeYari();
  const items = nodos(armarEstadoResultados(e, oct, calcularPyL(e, oct), M, hrefGasto));
  assert.ok(!items.some((x) => x.id === "devoluciones"));
});

test("septiembre sigue sin renglón de devoluciones aunque la venta se haya devuelto después", () => {
  const e = conTotal();
  const items = nodos(armarEstadoResultados(e, sept, calcularPyL(e, sept), M, hrefGasto));
  assert.ok(!items.some((x) => x.id === "devoluciones"));
  assert.equal(items.find((x) => x.id === "ingresos")!.rev, 3000);
});

test("cada renglón nuevo tiene su «cómo se calcula»", () => {
  const e = conTotal();
  const p = calcularPyL(e, oct);
  for (const id of ["ingresos", "devoluciones", "closers", "director", "bruta"]) {
    const a = ayudaDeRenglon(id, p, M);
    assert.ok(a && a.ayuda.length > 20 && (a.formula?.length ?? 0) > 20, id);
  }
  /* La cuenta de la utilidad bruta con los números del período termina en su valor. */
  const bruta = ayudaDeRenglon("bruta", p, M)!;
  assert.equal(Number(bruta.secciones![0].filas.at(-1)!.valor), r2(p.brutoCC));
  assert.equal(Number(bruta.secciones![1].filas.at(-1)!.valor), r2(p.brutoRev));
});

/* ---------- Cuánto se puede devolver y qué falta ---------- */

test("lo que se puede devolver es lo cobrado hasta ese día menos lo ya devuelto", () => {
  const e = estadoDeYari({ devoluciones: [devolucion({ id: "d0", monto: 1000, fecha: iso(OCTUBRE, 2) })] });
  assert.deepEqual(devolvibleDeVenta(e, "v1", iso(OCTUBRE, 3)), { cobrado: 3000, devuelto: 1000, queda: 2000 });
  /* Antes de la cuota 2 sólo había entrado la 1. */
  assert.deepEqual(devolvibleDeVenta(e, "v1", iso(SEPTIEMBRE, 30)), { cobrado: 1500, devuelto: 0, queda: 1500 });
  /* Corregir la devolución no cuenta contra sí misma. */
  assert.equal(devolvibleDeVenta(e, "v1", iso(OCTUBRE, 3), "d0").queda, 3000);
});

test("qué falta para poder cargar una devolución, en el orden de la pantalla", () => {
  const e = estadoDeYari();
  const ok = { ventaId: "v1", monto: 1500, fecha: iso(OCTUBRE, 3), procesadorId: "proc_stripe", tieneComprobante: true };
  assert.equal(problemaDeDevolucion(e, ok), null);
  assert.match(problemaDeDevolucion(e, { ...ok, ventaId: undefined })!, /Elegí la venta/);
  assert.match(problemaDeDevolucion(e, { ...ok, monto: 0 })!, /cuánto/);
  assert.match(problemaDeDevolucion(e, { ...ok, fecha: "nada" })!, /día/);
  assert.match(problemaDeDevolucion(e, { ...ok, procesadorId: undefined })!, /medio/);
  assert.match(problemaDeDevolucion(e, { ...ok, monto: 3500 })!, /más de lo cobrado/);
  /* Sin comprobante no se carga, salvo que la pasarela la informe. */
  assert.equal(problemaDeDevolucion(e, { ...ok, tieneComprobante: false }), "Falta el comprobante de la devolución");
  assert.equal(problemaDeDevolucion(e, { ...ok, tieneComprobante: false, tienePasarela: true }), null);
  /* Una venta sin cobros hasta esa fecha no tiene nada que devolver. */
  assert.match(problemaDeDevolucion(e, { ...ok, fecha: iso("2026-08", 1) })!, /no tiene cobros/);
});

/* ---------- En qué liquidación entra ---------- */

test("el descuento va al mes de la devolución; si ese mes está cerrado, a la primera liquidación abierta", () => {
  const d = devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) });
  assert.equal(mesDeLiquidacion(d, []), OCTUBRE);
  const cerradaSept = liquidacionCerrada(SEPTIEMBRE, { personas: [], total: 0, fijo: 0, variable: 0, aPagar: {}, tipoCambio: 1500, profit: 0, calculadoEn: "" });
  assert.equal(mesDeLiquidacion(d, [cerradaSept]), OCTUBRE);
  /* Una devolución con fecha de septiembre que llega con septiembre ya cerrado: entra en octubre. */
  const tarde = devolucion({ id: "d2", monto: 100, fecha: iso(SEPTIEMBRE, 29) });
  assert.equal(mesDeLiquidacion(tarde, [cerradaSept]), OCTUBRE);
  /* Con octubre también cerrada, en noviembre. */
  const cerradaOct = liquidacionCerrada(OCTUBRE, { personas: [], total: 0, fijo: 0, variable: 0, aPagar: {}, tipoCambio: 1500, profit: 0, calculadoEn: "" });
  assert.equal(mesDeLiquidacion(tarde, [cerradaSept, cerradaOct]), NOVIEMBRE);
  /* Una reabierta (sin foto) vuelve a recibirla. */
  assert.equal(mesDeLiquidacion(tarde, [{ ...cerradaSept, estado: "abierta", resultado: null }]), SEPTIEMBRE);
});

test("la devolución que ya está en la foto de una liquidación cerrada sigue ahí aunque se reabra otra", () => {
  const d = devolucion({ id: "d2", monto: 100, fecha: iso(SEPTIEMBRE, 29) });
  const foto = liquidacionCerrada(NOVIEMBRE, {
    personas: [{
      miembroId: "mariano", nombre: "Mariano", categoriaGasto: "x", aPagar: {}, total: 0, fijo: 0, variable: 0,
      lineas: [{ clave: "devolucion:d2:closer", devolucionId: "d2", tipo: "devolucion", nombre: "Devolución de X", detalle: "", moneda: "USD", monto: -10, montoBase: -10, variable: true, enFinanzas: true }],
    }],
    total: 0, fijo: 0, variable: 0, aPagar: {}, tipoCambio: 1500, profit: 0, calculadoEn: "",
  });
  assert.equal(mesDeLiquidacion(d, [foto]), NOVIEMBRE);
});

test("los pagos de octubre, sin devoluciones, siguen sumando como siempre (cashCollected = cobrado)", () => {
  const e = estadoDeYari({ pagos: [pago("px", "c1b", 100, 3, iso(OCTUBRE, 5)), ...estadoDeYari().pagos] });
  assert.equal(cashCollected(e, oct), 1600);
  assert.equal(cashCollected(e, nov), 0);
});
