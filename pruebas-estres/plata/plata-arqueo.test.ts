import { art, cerca, clonar, donde, gasto, r2 } from "./plata-mundo";
import { arqueoDePartida, contarJusto, CUENTAS_USD, instantes, mundoCompleto } from "./plata-arqueo-helpers";
import test from "node:test";
import assert from "node:assert/strict";
import { cajaEsperada, rangoEntre } from "@/lib/caja";
import { arqueoVivo, esperadoDelArqueo } from "@/lib/arqueo";
import { costosDelMes } from "@/lib/finanzas";
import { calcularLiquidacion, gastosDeLiquidacion } from "@/lib/honorarios";
import { saldosEsperados } from "@/lib/traspasos";
import { aMonedaBase } from "@/lib/gastos";
import type { Arqueo, EstadoApp, Gasto, SaldoCuenta, Traspaso } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · el arqueo, de punta a punta (03/11).

   El arqueo del 31/10 de Aldana dio US$ 30.084 de más «y no me lo marcaba cuando fui completando los saldos»: el total y las cuentas se
   calculaban por caminos distintos (el total restaba lo que se le debía al equipo; las cuentas, sólo los pagos). Estas pruebas buscan
   CUALQUIER camino por el que el total y las cuentas puedan separarse, en mundos al azar: cobros en dólares y pesos, comisiones de las
   pasarelas, devoluciones, gastos con y sin cuenta, retiros, pases entre cuentas (en la misma moneda, entre pesos y dólares, con costo y en
   camino), liquidaciones cerradas, pagos al equipo marcados y sin marcar, y cuentas que se cuentan por primera vez.

   A1  contando en cada cuenta lo que la app dice que tendría que haber, el total no marca nada que no tenga nombre (sinExplicar = 0);
       sin pesos, sin gastos sin cuenta y sin plata viajando, la diferencia es exactamente 0.
   A2  lo que se le debe al equipo no mueve la caja: cerrar la liquidación de cada mes, marcar o desmarcar pagos de equipo, o cambiar el %
       de los closers no cambia la caja esperada ni lo que tendría que haber en ninguna cuenta.
   A3  un pago al equipo cargado desde una cuenta baja esa cuenta y el total exactamente lo pagado, una sola vez.
   A4  el arqueo guardado se mueve solo: cargar después un gasto de esas fechas cambia su diferencia en exactamente ese gasto.
   A5  el orden de las listas no cambia nada.
   A6  una cadena de arqueos contados «justo» da cero en cada eslabón.
   ================================================================== */

test("A1 · contando en cada cuenta lo que tendría que haber, el total no marca nada sin nombre", () => {
  let exactos = 0, conPesos = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const pesos = semilla % 2 === 0;
    const { e, r, meses, tc } = mundoCompleto(semilla, pesos);
    const [t0, t1] = instantes(r, meses);
    if (t0 === t1) continue;
    const a0 = arqueoDePartida(e, r, t0, tc);
    const { x } = contarJusto(e, r, a0, t1, tc, "a1");
    const c = x.conciliacion!;
    const d = (...m: (string | number)[]) => donde(semilla, pesos ? "con pesos" : "en dólares", t0, t1, ...m);
    assert.ok(Math.abs(c.sinExplicar) <= 0.05 + 0.01 * e.procesadores.length, d("sin explicar", c.sinExplicar, JSON.stringify(c)));
    /* La diferencia es sólo lo que tiene nombre. */
    const conNombre = c.cambioDePesos + c.sinCuenta;
    assert.ok(Math.abs(x.diferencia! - conNombre) <= 0.05 + 0.01 * e.procesadores.length, d("diferencia", x.diferencia!, "con nombre", conNombre));
    if (!pesos && c.sinCuenta === 0) {
      assert.ok(Math.abs(x.diferencia!) <= 0.05, d("contado justo y en dólares tiene que dar cero", x.diferencia!));
      exactos++;
    }
    if (pesos) conPesos++;
  }
  assert.ok(exactos >= 5, `hubo ${exactos} mundos exactos: la prueba tiene que ejercitar el caso sin nombres`);
  assert.ok(conPesos >= 50);
});

test("A2 · lo que se le debe al equipo no mueve la caja: liquidaciones cerradas, pagos marcados o no, % de los closers", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e, r, meses, tc } = mundoCompleto(semilla, semilla % 3 !== 0);
    const [t0, , t2] = instantes(r, meses);
    const a0 = arqueoDePartida(e, r, t0, tc);
    const foto = (x: EstadoApp) => {
      const m = cajaEsperada(x, a0, t2, tc);
      const s = saldosEsperados(x, a0, t2);
      return { esperado: m.esperado, enCuentas: m.enCuentas, cuentas: [...s.entries()].map(([k, v]) => [k, v.esperado ?? null, r2(v.salio)]) };
    };
    const antes = foto(e);
    const d = (...m: (string | number)[]) => donde(semilla, ...m);

    /* Cerrar la liquidación de cada mes (sus gastos van a Finanzas con fecha del mes). */
    const conCierres = clonar(e);
    for (const periodo of meses) {
      const res = calcularLiquidacion(conCierres, periodo, undefined);
      conCierres.gastos.push(...gastosDeLiquidacion(conCierres, { id: `liq_${periodo}`, periodo }, res));
    }
    assert.ok(conCierres.gastos.some((g) => g.extra?.liquidacionId), d("el mundo tiene que tener cierres"));
    assert.deepEqual(foto(conCierres), antes, d("cerrar las liquidaciones no mueve la caja"));

    /* Marcar y desmarcar los pagos de equipo: cambia el costo del mes, no la caja. */
    const marcados = clonar(e);
    for (const g of marcados.gastos) if (g.grupo !== "retiro" && !g.extra?.traspasoId && r.si(0.5)) g.extra = { ...(g.extra ?? {}), pagoDeEquipo: !g.extra?.pagoDeEquipo };
    assert.deepEqual(foto(marcados), antes, d("marcar pagos de equipo no mueve la caja"));
    const mes = rangoEntre(t0, t2);
    const costoAntes = costosDelMes(e, mes).reduce((s, g) => s + g.monto, 0), costoDespues = costosDelMes(marcados, mes).reduce((s, g) => s + g.monto, 0);
    const cambiaron = marcados.gastos.filter((g, i) => Boolean(g.extra?.pagoDeEquipo) !== Boolean(e.gastos[i].extra?.pagoDeEquipo));
    const esperadoCosto = cambiaron.reduce((s, g) => s + (g.extra?.pagoDeEquipo ? -1 : 1) * (Date.parse(g.fecha) > Date.parse(t0) && Date.parse(g.fecha) <= Date.parse(t2) ? g.monto : 0), 0);
    assert.ok(cerca(costoDespues - costoAntes, esperadoCosto, 0.02), d("el costo cambia en lo marcado", costoDespues - costoAntes, esperadoCosto));

    /* Otro % para los closers: cambian las comisiones, no la plata que hay. */
    const otroPct = clonar(e);
    for (const m of otroPct.equipo) if (m.rol === "closer") m.comisionRate = r.elige([0, 0.3, 0.5]);
    assert.deepEqual(foto(otroPct), antes, d("el % de los closers no mueve la caja"));
  }
});

test("A3 · un pago al equipo desde una cuenta baja esa cuenta y el total exactamente lo pagado, una vez", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e, r, meses, tc } = mundoCompleto(semilla, semilla % 2 === 0);
    const [t0, t1, t2] = instantes(r, meses);
    if (!(t0 < t1 && t1 < t2)) continue;
    const a0 = arqueoDePartida(e, r, t0, tc);
    const cuenta = r.elige(CUENTAS_USD);
    const monto = r.plata(10, 5000);
    const marcado = r.si(0.5);
    const conPago = { ...e, gastos: [...e.gastos, gasto({ id: "pago_x", categoria: "Comisiones closers", monto, fecha: t1, extra: { cuentaId: cuenta, ...(marcado ? { pagoDeEquipo: true } : {}) } })] };
    const d = (...m: (string | number)[]) => donde(semilla, cuenta, monto, marcado ? "marcado" : "sin marcar", ...m);
    assert.ok(cerca(cajaEsperada(e, a0, t2, tc).esperado - cajaEsperada(conPago, a0, t2, tc).esperado, monto, 0.011), d("el total baja lo pagado"));
    const antes = saldosEsperados(e, a0, t2).get(cuenta)!, despues = saldosEsperados(conPago, a0, t2).get(cuenta)!;
    assert.ok(cerca(despues.salio - antes.salio, monto, 0.011), d("la cuenta baja lo pagado"));
    /* Y fuera de la ventana no se ve. */
    assert.equal(cajaEsperada(conPago, a0, t1 < t2 ? new Date(Date.parse(t1) - 1).toISOString() : t1, tc).esperado, cajaEsperada(e, a0, new Date(Date.parse(t1) - 1).toISOString(), tc).esperado, d("antes de pagarlo no resta"));
  }
});

test("A4 · el arqueo guardado se mueve solo: lo cargado después de esas fechas cambia su diferencia en exactamente eso", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e, r, meses, tc } = mundoCompleto(semilla, semilla % 2 === 0);
    const [t0, t1] = instantes(r, meses);
    if (t0 === t1) continue;
    const a0 = arqueoDePartida(e, r, t0, tc);
    const { a } = contarJusto(e, r, a0, t1, tc, "a1");
    const conArqueos = { ...e, arqueos: [a0, a] };
    const d = (...m: (string | number)[]) => donde(semilla, ...m);
    const vivo = arqueoVivo(conArqueos, a);
    assert.equal(vivo.cambio, false, d("recién guardado, lo vivo es lo guardado"));
    assert.ok(cerca(vivo.diferencia!, a.diferencia!, 0.011), d("vivo", vivo.diferencia, "guardado", a.diferencia));
    /* Se carga un gasto de esas fechas que faltaba: con cuenta o sin cuenta, la diferencia (sobra) crece en ese monto. */
    const monto = r.plata(5, 3000);
    const medio = new Date((Date.parse(t0) + Date.parse(t1)) / 2).toISOString();
    /* Una cuenta que se cuenta por primera vez lo absorbe en lo que ya tenía: se carga sin cuenta o en una que estaba en el arqueo anterior. */
    const contadas = CUENTAS_USD.filter((id) => a0.saldos.some((x) => x.procesadorId === id));
    const g = gasto({ id: "falto", monto, fecha: medio, extra: contadas.length && r.si(0.5) ? { cuentaId: r.elige(contadas) } : {} });
    const despues = arqueoVivo({ ...conArqueos, gastos: [...e.gastos, g] }, a);
    assert.ok(cerca(despues.diferencia! - vivo.diferencia!, monto, 0.011), d("se movió", despues.diferencia! - vivo.diferencia!, "en", monto));
    assert.equal(despues.cambio, monto >= 1, d("marca que cambió"));
    /* Un cierre de liquidación o una comisión de esas fechas no la mueve. */
    const cierre = gasto({ id: "gas_liq_x", categoria: "Equipo / Salarios", monto: r.plata(100, 9000), fecha: medio, extra: { liquidacionId: "liq_x" } });
    assert.ok(cerca(arqueoVivo({ ...conArqueos, gastos: [...e.gastos, cierre] }, a).diferencia!, vivo.diferencia!, 0.001), d("el cierre de la liquidación no es un pago"));
  }
});

test("A5 · el orden de las listas no cambia ni el esperado ni la conciliación", () => {
  for (let semilla = 1; semilla <= 80; semilla++) {
    const { e, r, meses, tc } = mundoCompleto(semilla, true);
    const [t0, t1] = instantes(r, meses);
    if (t0 === t1) continue;
    const a0 = arqueoDePartida(e, r, t0, tc);
    const { a } = contarJusto(e, r, a0, t1, tc, "a1");
    const uno = esperadoDelArqueo(e, a, { previo: a0 });
    const mezclado = { ...e, pagos: r.baraja(e.pagos), gastos: r.baraja(e.gastos), traspasos: r.baraja(e.traspasos), devoluciones: r.baraja(e.devoluciones), procesadores: r.baraja(e.procesadores) };
    const otro = esperadoDelArqueo(mezclado, a, { previo: a0 });
    assert.ok(cerca(uno.esperado!, otro.esperado!, 0.011), donde(semilla, "esperado", uno.esperado!, otro.esperado!));
    assert.ok(cerca(uno.conciliacion!.sinExplicar, otro.conciliacion!.sinExplicar, 0.011), donde(semilla, "conciliación"));
  }
});

test("A6 · una cadena de arqueos contados justo da cero en cada eslabón (en dólares, todo con cuenta, sin plata viajando)", () => {
  let cadenas = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const { e: e1, r, meses, tc } = mundoCompleto(semilla, false);
    /* Todo gasto con su cuenta y los pases llegan el mismo día: no queda nada con nombre. */
    const e: EstadoApp = {
      ...e1,
      gastos: e1.gastos.map((g) => (g.extra?.traspasoId || g.extra?.liquidacionId || g.extra?.cuentaId ? g : { ...g, extra: { ...(g.extra ?? {}), cuentaId: r.elige(CUENTAS_USD) } })),
      traspasos: e1.traspasos.map((t) => { const { fechaLlega: _f, ...resto } = t; return resto as Traspaso; }),
    };
    const ts = [0, 1, 2, 3].map(() => { const [a, m] = r.elige(meses).split("-").map(Number); return art(a, m, r.entre(1, 28), r.entre(0, 23)); }).sort();
    if (new Set(ts).size < 4) continue;
    let previo = arqueoDePartida(e, r, ts[0], tc);
    const arqueos: Arqueo[] = [previo];
    for (let i = 1; i < ts.length; i++) {
      const { a, x } = contarJusto({ ...e, arqueos }, r, previo, ts[i], tc, `a${i}`);
      assert.ok(Math.abs(x.diferencia!) <= 0.05, donde(semilla, "eslabón", i, "dio", x.diferencia!, JSON.stringify(x.conciliacion)));
      arqueos.push(a);
      previo = a;
    }
    /* Y con todos guardados, cada uno sigue dando cero en vivo. */
    for (const a of arqueos.slice(1)) assert.ok(Math.abs(arqueoVivo({ ...e, arqueos }, a).diferencia!) <= 0.05, donde(semilla, "vivo", a.id));
    cadenas++;
  }
  assert.ok(cadenas >= 50, `cadenas probadas: ${cadenas}`);
});
