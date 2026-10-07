import { r2, azar, mundo, art, instante, bordesDeMes, MESES_MUNDO, cerca, donde, congelar, gasto, devolucion, pago } from "./plata-mundo";
import test from "node:test";
import assert from "node:assert/strict";
import { calcularPyL, cashCollected, cobrado, gastosDelMes, gastosPagadosEn, pagosDelMes } from "@/lib/finanzas";
import { devolucionesDelMes, esDevolucionConfirmada, totalDevuelto } from "@/lib/devoluciones";
import { cajaEsperada, rangoEntre } from "@/lib/caja";
import { conciliarPuntas, costoDe, enCamino, pasesPorCuenta, saldosEsperados, type Punta } from "@/lib/traspasos";
import { fechaDePago } from "@/lib/gastos";
import { periodoDeFecha, rangoDePeriodo } from "@/lib/periodos";
import { rangoDeFechas } from "@/lib/metricas";
import { armarEstadoResultados, ayudaDeRenglon, esBloque, type ItemPyL, type NodoPyL } from "@/lib/estadoResultados";
import type { EstadoApp, Gasto, Traspaso } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · Finanzas, caja y estado de resultados con datos al azar.

   Propiedades (todas con semilla; el mensaje de error dice cuál):
   P1  el Cash Collected del mes menos las comisiones de las pasarelas es lo que suman las cuentas
       de la caja (entró − salió), mes por mes, con cuentas en dólares y en pesos.
   P2  lo devuelto (y lo cobrado) sumado mes por mes es el total, sin doble conteo ni pérdidas en los bordes
       de mes y de zona horaria de Argentina.
   P1b la caja es aditiva: partir una ventana en dos no cambia lo que entró, salió o se devolvió.
   P8  gasto con dos fechas: el estado de resultados cuenta por devengo, la caja por día de pago,
       y sin fechaPago nada cambia.
   ER  cada renglón del estado de resultados suma lo que lo abre.
   ================================================================== */

const MESES = MESES_MUNDO;
const rangoHorizonte = { desde: rangoDePeriodo(MESES[0]).desde, hasta: rangoDePeriodo(MESES[MESES.length - 1]).hasta };
const enHorizonte = (iso: string) => { const t = Date.parse(iso); return t >= rangoHorizonte.desde.getTime() && t <= rangoHorizonte.hasta.getTime(); };
const sinFechaPago = (e: EstadoApp): EstadoApp => ({ ...e, gastos: e.gastos.map(({ fechaPago: _f, ...g }) => g as Gasto) }) as EstadoApp;

/* Un arqueo contado justo antes de que empiece el período. */
const previoDe = (desde: Date) => ({ fecha: new Date(desde.getTime() - 1).toISOString(), saldos: [] as never[] });

test("P1 · mes por mes: Cash Collected − comisiones de pasarela = lo que entró menos lo que salió en las cuentas de la caja", () => {
  let meses = 0, conDevolucion = 0, conPesos = 0;
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e, tc } = mundo(semilla, { devoluciones: 8, deMas: true });
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const d = (...x: (string | number)[]) => donde(semilla, periodo, ...x);
      const p = calcularPyL(e, m);
      const previo = previoDe(m.desde);
      const mapa = saldosEsperados(e, previo, m.hasta.toISOString());

      /* Dólares: cada cuenta en USD cuenta lo que cobró neto de su comisión y descuenta lo que devolvió. */
      let usd = 0, pesos = 0;
      for (const proc of e.procesadores) {
        const s = mapa.get(proc.id)!;
        if (s.moneda === "ARS") pesos += s.entro - s.salio; else usd += s.entro - s.salio;
      }
      /* Lo que cada cuenta tendría que haber recibido, calculado a mano de las listas. */
      const enRangoM = (iso: string) => { const t = Date.parse(iso); return t >= m.desde.getTime() && t <= m.hasta.getTime(); };
      const esArs = (id?: string) => e.procesadores.find((x) => x.id === id)?.moneda === "ARS";
      const pagosM = e.pagos.filter((x) => enRangoM(x.fecha));
      const devsM = e.devoluciones.filter((x) => esDevolucionConfirmada(x) && enRangoM(x.fecha));
      /* Los gastos que dicen de qué cuenta salieron restan de ella el día que se pagaron (fechaPago). */
      const gastosM = e.gastos.filter((g) => typeof g.extra?.cuentaId === "string" && enRangoM(fechaDePago(g)));
      const usdEsperado = pagosM.filter((x) => !esArs(x.procesadorId)).reduce((a, x) => a + x.monto - x.feeMonto, 0)
        - devsM.filter((x) => !esArs(x.procesadorId)).reduce((a, x) => a + x.monto, 0)
        - gastosM.reduce((a, g) => a + g.monto, 0);
      assert.ok(cerca(usd, usdEsperado, 0.01 + 0.0001 * (pagosM.length + devsM.length)), d("cuentas en USD", usd, usdEsperado));

      /* Los pesos, en pesos: lo cobrado menos la comisión (que está en dólares: × tipo de cambio) menos lo devuelto. */
      const pesosEsperado = pagosM.filter((x) => esArs(x.procesadorId)).reduce((a, x) => a + (x.montoArs ?? 0) - x.feeMonto * tc, 0)
        - devsM.filter((x) => esArs(x.procesadorId)).reduce((a, x) => a + (x.montoArs ?? 0), 0);
      assert.ok(cerca(pesos, pesosEsperado, 0.02 + 0.005 * (pagosM.length + devsM.length)), d("cuentas en ARS", pesos, pesosEsperado));

      /* Todo junto, en dólares: es el Cash Collected sin las comisiones de la pasarela. */
      const total = usd + pesos / tc;
      const finanzas = cashCollected(e, m) - p.feesProcesador - gastosM.reduce((a, g) => a + g.monto, 0);
      assert.ok(cerca(total, finanzas, 0.05 + 0.002 * (pagosM.length + devsM.length)), d("suma de cuentas", total, "vs Finanzas", finanzas));
      assert.ok(cerca(p.cashCollected, p.cobrado - p.devoluciones, 1e-6), d("CC = cobrado − devuelto"));
      assert.equal(p.cashCollected, cashCollected(e, m));
      meses++;
      if (p.devoluciones > 0) conDevolucion++;
      if (pesos !== 0) conPesos++;
    }
  }
  assert.ok(meses === 720 && conDevolucion > 100 && conPesos > 100, `cobertura: ${meses} meses, ${conDevolucion} con devolución, ${conPesos} con pesos`);
});

test("P2 · lo cobrado, lo devuelto y los gastos sumados mes por mes son el total: sin doble conteo ni pérdidas en los bordes", () => {
  let eventos = 0, enBorde = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, bordes: 0.5, gastos: 12 });
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    /* Cada instante pertenece a exactamente un mes (o a ninguno si cae fuera del horizonte). */
    const instantes = [...e.pagos.map((x) => x.fecha), ...e.devoluciones.map((x) => x.fecha), ...e.gastos.map((x) => x.fecha), ...e.gastos.map(fechaDePago), ...e.ventas.map((v) => v.fecha)];
    for (const iso of instantes) {
      const cuantos = MESES.filter((p) => { const m = rangoDePeriodo(p); const t = Date.parse(iso); return t >= m.desde.getTime() && t <= m.hasta.getTime(); });
      assert.equal(cuantos.length, enHorizonte(iso) ? 1 : 0, d("instante", iso, "cae en", cuantos.join(",")));
      if (cuantos.length === 1) assert.equal(periodoDeFecha(iso), cuantos[0], d("periodoDeFecha", iso));
      eventos++;
      if (bordesDeMes("2026-09").includes(iso) || /T0[0-3]:00:00\.000Z$|23:59:5\d/.test(iso)) enBorde++;
    }
    const sum = (f: (p: string) => number) => MESES.reduce((a, p) => a + f(p), 0);
    const mes = (p: string) => rangoDePeriodo(p);

    const devConfirmadas = e.devoluciones.filter((x) => esDevolucionConfirmada(x) && enHorizonte(x.fecha));
    assert.ok(cerca(sum((p) => totalDevuelto(e, mes(p))), devConfirmadas.reduce((a, x) => a + x.monto, 0), 1e-6), d("devuelto por mes vs total"));
    assert.equal(sum((p) => devolucionesDelMes(e, mes(p)).length), devConfirmadas.length, d("cantidad de devoluciones"));

    const cobrosH = e.pagos.filter((x) => enHorizonte(x.fecha));
    assert.ok(cerca(sum((p) => cobrado(e, mes(p))), cobrosH.reduce((a, x) => a + x.monto, 0), 1e-6), d("cobrado por mes vs total"));
    assert.equal(sum((p) => pagosDelMes(e, mes(p)).length), cobrosH.length, d("cantidad de cobros"));

    const gastosH = e.gastos.filter((g) => enHorizonte(g.fecha));
    assert.equal(sum((p) => gastosDelMes(e, mes(p)).length), gastosH.length, d("gastos por mes (devengo)"));
    const pagadosH = e.gastos.filter((g) => enHorizonte(fechaDePago(g)));
    assert.equal(sum((p) => gastosPagadosEn(e, mes(p)).length), pagadosH.length, d("gastos por mes (pago)"));
  }
  assert.ok(eventos > 3000 && enBorde > 100, `cobertura: ${eventos} eventos, ${enBorde} en bordes`);
});

test("P1b · la caja es aditiva: partir una ventana en dos no cambia lo cobrado, devuelto, pagado ni lo que se quedan las pasarelas", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, bordes: 0.4 });
    const r = azar(semilla * 7919);
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    const t0 = rangoDePeriodo(MESES[0]).desde.getTime() - 1;
    const t2 = rangoDePeriodo(MESES[MESES.length - 1]).hasta.getTime();
    /* Los cortes: instantes al azar y, a propósito, el de un evento (un corte justo en un pago o una devolución). */
    const eventos = [...e.pagos.map((x) => x.fecha), ...e.devoluciones.map((x) => x.fecha), ...e.gastos.map(fechaDePago)].filter(enHorizonte);
    const cortes = [r.entre(t0 + 1, t2), eventos.length ? Date.parse(r.elige(eventos)) : t0 + 1, Date.parse(instante(r, { meses: MESES, bordes: 1 }))]
      .filter((t) => t > t0 && t < t2).sort((a, b) => a - b);
    const puntos = [t0, ...cortes, t2];
    const iso = (t: number) => new Date(t).toISOString();
    const entero = cajaEsperada(e, { fecha: iso(t0), total: 0 }, iso(t2));
    const trozos = puntos.slice(1).map((t, i) => cajaEsperada(e, { fecha: iso(puntos[i]), total: 0 }, iso(t)));
    for (const campo of ["cobrado", "devoluciones", "procesador", "comisiones", "gastos", "retiros"] as const) {
      const suma = trozos.reduce((a, x) => a + x[campo], 0);
      assert.ok(cerca(suma, entero[campo], 0.01 * (trozos.length + 1)), d("campo", campo, suma, "vs", entero[campo], "cortes", cortes.map(iso).join(" | ")));
    }
    /* La caja esperada es la suma de sus partes (cada una redondeada a centavos). */
    for (const mov of [entero, ...trozos]) {
      const suma = mov.inicial + mov.enCaminoAntes + mov.cobrado - mov.devoluciones - mov.procesador - mov.comisiones - mov.gastos - mov.reparto - mov.retiros;
      assert.ok(cerca(mov.esperado, suma, 0.0101 * 8), d("esperado", mov.esperado, "suma de partes", r2(suma)));
      assert.ok(cerca(mov.enCuentas, mov.esperado - mov.enCamino, 0.0101), d("enCuentas"));
    }
    /* Y rangoEntre es (desde, hasta]: el instante del corte cuenta en un solo trozo. */
    for (const t of cortes) {
      const a = rangoEntre(iso(t0), iso(t)), b = rangoEntre(iso(t), iso(t2));
      assert.ok(!(t >= a.desde.getTime() && t <= a.hasta.getTime() && t >= b.desde.getTime() && t <= b.hasta.getTime()), d("el corte cuenta dos veces", iso(t)));
      assert.ok(t >= a.desde.getTime() && t <= a.hasta.getTime(), d("el corte no cuenta en el primer trozo", iso(t)));
    }
  }
});

test("P8 · gasto con dos fechas: el estado de resultados lo cuenta por devengo, la caja por día de pago, y sin fechaPago nada cambia", () => {
  let conOtroMes = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const { e } = mundo(semilla, { gastos: 14, bordes: 0.4 });
    const sin = sinFechaPago(e);
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      /* El estado de resultados no se entera de la fecha de pago. */
      assert.deepEqual(calcularPyL(e, m), calcularPyL(sin, m), d(periodo, "P&L cambia con fechaPago"));
      assert.deepEqual(gastosDelMes(e, m).map((g) => g.id), gastosDelMes(sin, m).map((g) => g.id), d(periodo, "gastosDelMes"));
      /* Sin fecha de pago, la caja y el estado de resultados ven los mismos gastos. */
      assert.deepEqual(gastosPagadosEn(sin, m).map((g) => g.id), gastosDelMes(sin, m).map((g) => g.id), d(periodo, "sin fechaPago difieren"));
      /* Con ella, la caja ve los que se pagaron en el mes, vengan del mes que vengan. */
      const esperados = e.gastos.filter((g) => { const t = Date.parse(fechaDePago(g)); return t >= m.desde.getTime() && t <= m.hasta.getTime(); }).map((g) => g.id).sort();
      assert.deepEqual(gastosPagadosEn(e, m).map((g) => g.id).sort(), esperados, d(periodo, "gastosPagadosEn"));
      /* Los retiros no tocan el estado de resultados. */
      const sinRetiros = { ...e, gastos: e.gastos.filter((g) => g.grupo !== "retiro") } as EstadoApp;
      assert.deepEqual(calcularPyL(e, m), calcularPyL(sinRetiros, m), d(periodo, "un retiro movió el P&L"));
    }
    /* La plata que sale de la caja en todo el horizonte es la de los gastos pagados en él, y el estado de resultados suma los devengados. */
    const t0 = rangoHorizonte.desde.getTime() - 1, t1 = rangoHorizonte.hasta.getTime();
    const caja = cajaEsperada(e, { fecha: new Date(t0).toISOString(), total: 0 }, new Date(t1).toISOString());
    const pagados = e.gastos.filter((g) => enHorizonte(fechaDePago(g)));
    assert.ok(cerca(caja.gastos, pagados.filter((g) => g.grupo !== "retiro").reduce((a, g) => a + g.monto, 0), 0.02), d("caja.gastos"));
    assert.ok(cerca(caja.retiros, pagados.filter((g) => g.grupo === "retiro").reduce((a, g) => a + g.monto, 0), 0.02), d("caja.retiros"));
    const devengados = MESES.reduce((a, p) => { const x = calcularPyL(e, rangoDePeriodo(p)); return a + x.otrosDirectos + x.gastosOperativos + x.honorariosCeo; }, 0);
    assert.ok(cerca(devengados, e.gastos.filter((g) => g.grupo !== "retiro" && enHorizonte(g.fecha)).reduce((a, g) => a + g.monto, 0), 1e-6), d("devengo"));
    conOtroMes += e.gastos.filter((g) => g.fechaPago && periodoDeFecha(g.fechaPago) !== periodoDeFecha(g.fecha)).length;
  }
  assert.ok(conOtroMes > 150, `cobertura: ${conOtroMes} gastos pagados en otro mes`);
});

test("P8b · un gasto de septiembre pagado en octubre: septiembre lo resta, la caja de octubre lo paga, ni antes ni dos veces", () => {
  /* Los bordes a propósito: 30/09 23:59:59 devengado, pagado 01/10 00:00:00 (hora de Argentina). */
  const g = gasto({ id: "g1", monto: 1000.55, fecha: art(2026, 9, 30, 23, 59, 59), fechaPago: art(2026, 10, 1, 0, 0, 0) });
  const e = { ...mundo(1, { ventas: 3 }).e, gastos: [g], pagos: [], devoluciones: [] } as EstadoApp;
  const sept = rangoDePeriodo("2026-09"), oct = rangoDePeriodo("2026-10");
  assert.equal(calcularPyL(e, sept).gastosOperativos, 1000.55);
  assert.equal(calcularPyL(e, oct).gastosOperativos, 0);
  assert.equal(gastosPagadosEn(e, sept).length, 0);
  assert.equal(gastosPagadosEn(e, oct).length, 1);
  const arqueo = { fecha: art(2026, 9, 30, 23, 59, 59, 0), total: 5000 };
  assert.equal(cajaEsperada(e, arqueo, art(2026, 9, 30, 23, 59, 59, 0)).gastos, 0);
  assert.equal(cajaEsperada(e, arqueo, art(2026, 10, 1, 0, 0, 0)).gastos, 1000.55, "el gasto entra justo en el primer instante de octubre");
  assert.equal(cajaEsperada(e, { fecha: art(2026, 10, 1, 0, 0, 0), total: 0 }, art(2026, 10, 31)).gastos, 0, "y no se cuenta de nuevo en el arqueo siguiente");
});

/* ---------- Pases entre cuentas: la plata ni se crea ni se pierde ---------- */

const CUENTAS_USD = ["proc_stripe", "proc_hotmart", "proc_mercury"];

function traspasosAlAzar(r: ReturnType<typeof azar>, n: number): Traspaso[] {
  return Array.from({ length: n }, (_, i) => {
    const origen = r.elige(CUENTAS_USD);
    const destino = r.elige(CUENTAS_USD.filter((x) => x !== origen));
    const sale = r.plata(100, 5000);
    const costo = r.si(0.4) ? r.plata(0, 40) : 0;
    const fecha = instante(r, { meses: ["2026-08", "2026-09", "2026-10"], bordes: 0.2 });
    const salida = r.si(0.3);                    // la sincronización sólo vio salir
    const llegaOtroDia = r.si(0.5);
    return {
      id: `t${i}`, fecha, origenId: origen, destinoId: salida && r.si(0.5) ? undefined : destino,
      montoSale: sale, monedaSale: "USD", montoLlega: salida ? sale : r2(Math.max(1, sale - costo)), monedaLlega: "USD",
      ...(llegaOtroDia && !salida ? { fechaLlega: new Date(Date.parse(fecha) + r.entre(1, 6) * 86400000).toISOString() } : {}),
      estado: r.si(0.1) ? "propuesto" : r.si(0.05) ? "ignorado" : "confirmado",
      ...(salida ? { salidaRef: `stripe:po_${i}` } : r.si(0.5) ? { salidaRef: `stripe:po_${i}`, llegadaRef: `mercury:m_${i}` } : {}),
      origen: salida ? "api" : r.elige(["manual", "api"]), creadoEn: fecha,
    } as Traspaso;
  });
}

test("P1c · un pase entre cuentas no crea ni pierde plata: lo que cambia en las cuentas más lo que viaja es lo que costó el pase", () => {
  let pases = 0, viajando = 0, cruzanVentana = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = azar(semilla * 13);
    const traspasos = traspasosAlAzar(r, r.entre(1, 8));
    const e = { traspasos, ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
    /* La ventana termina cerca de la salida de algún pase, para que a veces la plata esté viajando. */
    const hasta = Date.parse(r.elige(traspasos).fecha) + r.entre(0, 3) * 86400000;
    const desde = hasta - r.entre(1, 40) * 86400000;
    const iso = (t: number) => new Date(t).toISOString();
    const S = [...pasesPorCuenta(e, iso(desde), iso(hasta)).values()].reduce((a, x) => a + x, 0);
    const T = enCamino(e, iso(hasta), 1500) - enCamino(e, iso(desde), 1500);
    /* Lo que costó cada pase que salió en la ventana (los que ya habían salido antes se pagaron en su ventana). */
    const costo = traspasos.filter((t) => t.estado === "confirmado" && Date.parse(t.fecha) > desde && Date.parse(t.fecha) <= hasta)
      .reduce((a, t) => a + costoDe(t), 0);
    assert.ok(cerca(S + T, -costo, 0.0101 * (traspasos.length + 1)), donde(semilla, "cuentas", r2(S), "viajando", r2(T), "costo", r2(costo)));
    pases += traspasos.filter((t) => t.estado === "confirmado").length;
    viajando += traspasos.filter((t) => t.estado === "confirmado" && t.salidaRef && !t.llegadaRef).length;
    cruzanVentana += traspasos.filter((t) => t.fechaLlega && Date.parse(t.fecha) <= hasta && Date.parse(t.fechaLlega) > hasta).length;
  }
  assert.ok(pases > 400 && viajando > 50 && cruzanVentana > 30, `cobertura: ${pases} pases, ${viajando} sólo con la salida, ${cruzanVentana} que llegan después de la ventana`);
});

test("P7c · aplicar dos veces las mismas puntas de las cuentas da lo mismo: ni pases nuevos ni cambios", () => {
  let nuevos = 0, atados = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const r = azar(semilla * 29);
    const hechos = traspasosAlAzar(r, r.entre(0, 4)).filter((t) => t.origen === "manual" || t.estado === "confirmado");
    const puntas: Punta[] = Array.from({ length: r.entre(1, 8) }, (_, i) => {
      const salida = r.si(0.5);
      const t = hechos.length && r.si(0.5) ? r.elige(hechos) : undefined;
      const cuenta = salida ? (t?.origenId ?? r.elige(CUENTAS_USD)) : (t?.destinoId ?? "proc_mercury");
      return {
        lado: salida ? "salida" : "llegada", cuentaId: cuenta, otraCuentaId: salida ? t?.destinoId : t?.origenId,
        monto: t ? (salida ? t.montoSale : t.montoLlega) : r.plata(100, 5000), moneda: "USD",
        fecha: t ? t.fecha : instante(r, { meses: ["2026-08", "2026-09"], bordes: 0.1 }), ref: `${salida ? "stripe" : "mercury"}:x${semilla}_${i}`, seguro: r.si(0.7),
      } as Punta;
    });
    const aplicar = (ts: Traspaso[], res: ReturnType<typeof conciliarPuntas>): Traspaso[] => [
      ...ts.map((t) => { const c = res.cambios.find((x) => x.id === t.id); return c ? { ...t, ...c.cambios } : t; }), ...res.nuevos,
    ];
    const uno = conciliarPuntas(hechos, puntas, "2026-10-07T12:00:00.000Z");
    const despues = aplicar(hechos, uno);
    const dos = conciliarPuntas(despues, puntas, "2026-10-07T12:00:00.000Z");
    assert.deepEqual(dos.nuevos, [], donde(semilla, "volvió a crear pases"));
    assert.deepEqual(dos.cambios, [], donde(semilla, "volvió a cambiar pases"));
    assert.equal(dos.conciliados, 0, donde(semilla, "volvió a conciliar"));
    /* Una punta no se usa en dos pases. */
    const refs = despues.flatMap((t) => [t.salidaRef, t.llegadaRef]).filter(Boolean) as string[];
    assert.equal(new Set(refs).size, refs.length, donde(semilla, "una punta en dos pases"));
    /* Y no muta lo que recibe. */
    nuevos += uno.nuevos.length; atados += uno.cambios.length;
  }
  assert.ok(nuevos > 100 && atados > 20, `cobertura: ${nuevos} pases nuevos, ${atados} atados`);
});

/* ---------- El estado de resultados como árbol ---------- */

const M = (n: number) => n.toFixed(2);
const nodos = (items: ItemPyL[]): NodoPyL[] => items.filter((x): x is NodoPyL => !esBloque(x));
function revisar(n: NodoPyL, donde2: string, cuenta: { nodos: number }) {
  cuenta.nodos++;
  if (!n.hijos || n.hijos.length === 0) return;
  for (const col of ["cc", "rev"] as const) {
    if (n[col] === null) continue;
    const suma = n.hijos.reduce((a, h) => a + (h[col] ?? 0), 0);
    assert.ok(Math.abs(suma - (n[col] as number)) < 1e-6, `${donde2} · ${n.id} (${col}): los hijos suman ${suma} y el renglón dice ${n[col]}`);
  }
  for (const h of n.hijos) revisar(h, donde2, cuenta);
}

test("ER · cada renglón del estado de resultados suma lo que lo abre, en las dos columnas, con devoluciones y gastos de dos fechas", () => {
  const cuenta = { nodos: 0 };
  let conDevolucion = 0;
  for (let semilla = 1; semilla <= 100; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, gastos: 12, esquemas: false, huerfanos: semilla % 2 === 0 });
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const p = calcularPyL(e, m);
      const arbol = armarEstadoResultados(e, m, p, M, (id) => `/gasto/${id}`);
      for (const n of nodos(arbol)) revisar(n, donde(semilla, periodo), cuenta);
      /* Y los tres resultados del árbol son los del P&L. */
      const por = Object.fromEntries(nodos(arbol).map((n) => [n.id, n]));
      assert.ok(cerca(por.bruta.cc as number, p.brutoCC, 1e-6) && cerca(por.bruta.rev as number, p.brutoRev, 1e-6), donde(semilla, periodo, "bruta"));
      assert.ok(cerca(por.resultado.cc as number, p.operativoCC, 1e-6), donde(semilla, periodo, "resultado"));
      assert.ok(cerca(por.neto.cc as number, p.netoCC, 1e-6) && cerca(por.neto.rev as number, p.netoRev, 1e-6), donde(semilla, periodo, "neto"));
      /* El P&L cierra: utilidad bruta = CC − costos directos; neto = bruto − operativos − honorarios. */
      assert.ok(cerca(p.brutoCC, p.cashCollected - p.totalDirectos, 1e-6));
      assert.ok(cerca(p.netoCC, p.brutoCC - p.gastosOperativos - p.honorariosCeo, 1e-6));
      assert.ok(cerca(p.totalDirectos, p.comisionCloser + p.comisionDirector + p.feesProcesador + p.otrosDirectos, 1e-6));
      if (p.devoluciones > 0) conDevolucion++;
    }
  }
  assert.ok(cuenta.nodos > 5000 && conDevolucion > 80, `cobertura: ${cuenta.nodos} renglones, ${conDevolucion} meses con devolución`);
});

test("ER · el «cómo se calcula» de cada resultado suma lo que dice, en las dos columnas, con devoluciones", () => {
  let secciones = 0;
  for (let semilla = 1; semilla <= 100; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, gastos: 12 });
    for (const periodo of MESES) {
      const p = calcularPyL(e, rangoDePeriodo(periodo));
      for (const id of ["bruta", "resultado", "neto"]) {
        const ayuda = ayudaDeRenglon(id, p, (n) => String(n));
        assert.ok(ayuda?.secciones?.length, donde(semilla, periodo, id, "sin cuenta"));
        for (const sec of ayuda.secciones!) {
          let acc = 0, resultado: number | null = null;
          sec.filas.forEach((f, i) => {
            const v = Number(f.valor);
            if (f.signo === "=") resultado = v;
            else if (i === 0 || f.signo === "+") acc += v;
            else acc -= v;
          });
          assert.ok(resultado !== null && cerca(acc, resultado, 1e-6), donde(semilla, periodo, id, sec.titulo, "las filas suman", acc, "y dice", String(resultado)));
          secciones++;
        }
      }
    }
  }
  assert.ok(secciones === 100 * 6 * 6, `cobertura: ${secciones} secciones`);
});

/* ---------- BUG: el último instante del mes ---------- */

test("BUG: un cobro, una devolución o un gasto a las 23:59:59,5 del último día del mes no cae en ningún mes", () => {
  for (const [dia, mes, sig] of [[30, "2026-09", "2026-10"], [31, "2026-10", "2026-11"], [31, "2026-12", "2027-01"]] as const) {
    const [a, m] = mes.split("-").map(Number);
    const t = art(a, m, dia, 23, 59, 59, 500);
    const e = {
      ...mundo(1, { ventas: 3 }).e,
      pagos: [pago("p_x", "c0_0", 100, 3, t)], cuotas: [{ id: "c0_0", ventaId: "v0", numero: 1, monto: 100, estado: "pagada", esReserva: false }],
      devoluciones: [devolucion({ id: "d_x", ventaId: "v0", monto: 40, fecha: t })],
      gastos: [gasto({ id: "g_x", monto: 70, fecha: t })],
    } as unknown as EstadoApp;
    const enMes = calcularPyL(e, rangoDePeriodo(mes)), enSig = calcularPyL(e, rangoDePeriodo(sig));
    assert.equal(enMes.cobrado + enSig.cobrado, 100, `el cobro de ${t} no cae en ${mes} ni en ${sig}`);
    assert.equal(enMes.devoluciones + enSig.devoluciones, 40, `la devolución de ${t}`);
    assert.equal(enMes.gastosOperativos + enSig.gastosOperativos, 70, `el gasto de ${t}`);
  }
});

test("el primer y el último instante exacto del mes sí cuentan, cada uno en su mes", () => {
  const e = {
    ...mundo(1, { ventas: 3 }).e, pagos: [] as never[], cuotas: [] as never[], gastos: [] as never[],
    devoluciones: [
      devolucion({ id: "a", monto: 1, fecha: art(2026, 9, 1, 0, 0, 0, 0) }),
      devolucion({ id: "b", monto: 2, fecha: art(2026, 8, 31, 23, 59, 59, 0) }),
      devolucion({ id: "c", monto: 4, fecha: art(2026, 9, 30, 23, 59, 59, 0) }),
      devolucion({ id: "d", monto: 8, fecha: art(2026, 10, 1, 0, 0, 0, 0) }),
      /* 02:59:59,000Z del 1/10 es 23:59:59 del 30/09 en Argentina; 03:00Z ya es octubre. */
      devolucion({ id: "e", monto: 16, fecha: "2026-10-01T02:59:59.000Z" }),
      devolucion({ id: "f", monto: 32, fecha: "2026-10-01T03:00:00.000Z" }),
    ],
  } as unknown as EstadoApp;
  assert.equal(totalDevuelto(e, rangoDePeriodo("2026-08")), 2);
  assert.equal(totalDevuelto(e, rangoDePeriodo("2026-09")), 1 + 4 + 16);
  assert.equal(totalDevuelto(e, rangoDePeriodo("2026-10")), 8 + 32);
});

test("el estado que le llega a la app no se modifica: las cuentas de Finanzas y la caja corren sobre datos congelados", () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, gastos: 10 });
    const antes = JSON.stringify(e);
    congelar(e);
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      calcularPyL(e, m);
      armarEstadoResultados(e, m, calcularPyL(e, m), M, (id) => id);
    }
    cajaEsperada(e, { fecha: art(2026, 7, 1), total: 100 }, art(2026, 12, 31));
    saldosEsperados(e, undefined, art(2026, 12, 31));
    assert.equal(JSON.stringify(e), antes, donde(semilla));
  }
});


test("BUG: un cobro a las 23:59:59,5 de un día cualquiera está en el mes pero no en ninguna de las columnas por día del Dashboard", () => {
  const e = {
    ...mundo(1, { ventas: 3 }).e, cuotas: [{ id: "c0_0", ventaId: "v0", numero: 1, monto: 100, estado: "pagada", esReserva: false }],
    pagos: [pago("p_x", "c0_0", 100, 0, art(2026, 9, 10, 23, 59, 59, 500))], devoluciones: [], gastos: [],
  } as unknown as EstadoApp;
  const mes = cashCollected(e, rangoDePeriodo("2026-09"));
  const dias = Array.from({ length: 30 }, (_, i) => cashCollected(e, rangoDeFechas(`2026-09-${String(i + 1).padStart(2, "0")}`, `2026-09-${String(i + 1).padStart(2, "0")}`, "d")))
    .reduce((a, x) => a + x, 0);
  assert.equal(mes, 100);
  assert.equal(dias, mes, "la suma de los 30 días de septiembre");
});
