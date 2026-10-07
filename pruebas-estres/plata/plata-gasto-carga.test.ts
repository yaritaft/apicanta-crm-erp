import { azar, art, cerca, donde, gasto, mundo, r2 } from "./plata-mundo";
import test from "node:test";
import assert from "node:assert/strict";
import { alElegirMes, borradorInicial, datosDelGasto, pasarAlMes, sinOtraFechaDePago, conOtraFechaDePago } from "@/lib/carga-gasto";
import { calcularPyL, gastosDelMes, gastosPagadosEn } from "@/lib/finanzas";
import { cajaEsperada, runway } from "@/lib/caja";
import { fechaDePago, leerMonto, escribirMonto, pagadoEnOtroMes, tieneOtraFechaDePago } from "@/lib/gastos";
import { mesCerradoDe, primerDiaDe } from "@/lib/mes-cerrado";
import { diaDe, fechaDelGastoFijo, gastoAprobado, mesDe, propuestas, sumarMeses } from "@/lib/gastos-recurrentes";
import { periodoDeFecha, rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Gasto } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · el asistente de gastos con dos fechas y la caja.

   P8 (capa de la pantalla): editar un gasto sin tocar nada no cambia ninguna cuenta; pasarlo al mes abierto mueve el
   estado de resultados y no mueve la plata; volver a una sola fecha deja la caja donde estaba.
   ================================================================== */

const AJUSTES = { monedaBase: "USD" as const, tipoCambio: 1500 };
const HOY = new Date(2026, 9, 7);
const MESES = ["2026-08", "2026-09", "2026-10", "2026-11"] as const;

const guardar = (g: Gasto, b = borradorInicial(AJUSTES, g, HOY)) =>
  ({ id: g.id, ...datosDelGasto(b, { base: "USD", previo: g, opciones: [], ahora: "2026-10-07T15:00:00.000Z" }) }) as Gasto;

/* Un gasto como los del mundo: al mediodía (como lo guarda el asistente) y a veces con otro día de pago o en pesos. */
function gastoAlAzar(semilla: number): Gasto {
  const r = azar(semilla);
  const mesA = r.elige(MESES), mesB = r.elige(MESES);
  const [aA, mA] = mesA.split("-").map(Number), [aB, mB] = mesB.split("-").map(Number);
  const enPesos = r.si(0.3);
  const tc = r.elige([1100, 1250.5, 1500, 1623.75]);
  const pesos = r.plata(1000, 900000);
  return gasto({
    id: `g${semilla}`, grupo: r.elige(["directo", "operativo", "dueno", "retiro"] as const), categoria: "Software", concepto: "Pago", proveedor: "Estudio",
    monto: enPesos ? r2(pesos / tc) : r.plata(5, 8000), fecha: art(aA, mA, r.entre(1, 28), 12),
    ...(r.si(0.5) ? { fechaPago: art(aB, mB, r.entre(1, 28), 12) } : {}),
    extra: { ...(enPesos ? { montoOriginal: pesos, monedaOriginal: "ARS", tipoCambio: tc } : {}), ...(r.si(0.3) ? { cuentaId: "proc_stripe" } : {}) },
  });
}

const estadoCon = (gastos: Gasto[]): EstadoApp => ({ ...mundo(1, { ventas: 4 }).e, gastos, pagos: [], devoluciones: [] }) as EstadoApp;

function cuentas(e: EstadoApp) {
  return {
    pyl: MESES.map((p) => { const x = calcularPyL(e, rangoDePeriodo(p)); return [x.otrosDirectos, x.gastosOperativos, x.honorariosCeo]; }),
    caja: MESES.map((p) => gastosPagadosEn(e, rangoDePeriodo(p)).map((g) => [g.id, g.grupo, g.monto])),
    cajaTotal: cajaEsperada(e, { fecha: art(2026, 7, 31, 12), total: 1000 }, art(2026, 11, 30, 23)),
  };
}

test("P8c · abrir un gasto y guardarlo sin tocar nada no cambia ni un dato: ni el monto, ni las fechas, ni el estado de resultados, ni la caja", () => {
  let enPesos = 0, conOtraFecha = 0;
  for (let semilla = 1; semilla <= 300; semilla++) {
    const g = gastoAlAzar(semilla);
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    const guardado = guardar(g);
    assert.equal(guardado.fecha, g.fecha, d("la fecha cambió"));
    assert.equal(guardado.grupo, g.grupo);
    assert.ok(cerca(guardado.monto, g.monto, 0.0051), d("monto", guardado.monto, "antes", g.monto));
    if (tieneOtraFechaDePago(g)) { assert.equal(guardado.fechaPago, g.fechaPago, d("la fecha de pago cambió")); conOtraFecha++; }
    else assert.ok(!guardado.fechaPago, d("apareció una fecha de pago"));
    assert.equal(fechaDePago(guardado), fechaDePago(g), d("el día que sale la plata cambió"));
    assert.equal(guardado.extra.cuentaId, g.extra.cuentaId, d("se perdió la cuenta"));
    if (g.extra.montoOriginal) { assert.equal(guardado.extra.montoOriginal, g.extra.montoOriginal, d("monto original")); enPesos++; }
    /* Y las cuentas de toda la app dan lo mismo. */
    const antes = cuentas(estadoCon([g])), despues = cuentas(estadoCon([guardado]));
    assert.deepEqual(despues.caja.map((m) => m.map(([id, grupo]) => [id, grupo])), antes.caja.map((m) => m.map(([id, grupo]) => [id, grupo])), d("la caja"));
    antes.pyl.forEach((fila, i) => fila.forEach((v, j) => assert.ok(cerca(despues.pyl[i][j], v, 0.0051), d("estado de resultados", MESES[i]))));
  }
  assert.ok(enPesos > 60 && conOtraFecha > 60, `cobertura: ${enPesos} en pesos, ${conOtraFecha} con otro día de pago`);
});

test("P8d · pasarlo al mes abierto mueve el estado de resultados y no la plata; volver a una sola fecha deja la caja en el día que se pagó", () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    const g = gastoAlAzar(semilla);
    if (g.grupo === "retiro") continue;
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    const abierto = MESES[Math.min(MESES.length - 1, MESES.indexOf(periodoDeFecha(g.fecha) as never) + 1)];
    const movido = { ...g, ...pasarAlMes({ fecha: g.fecha, fechaPago: g.fechaPago ?? "" }, primerDiaDe(abierto)) } as Gasto;
    assert.equal(fechaDePago(movido), fechaDePago(g), d("pasarAlMes movió la plata"));
    assert.equal(periodoDeFecha(movido.fecha), abierto, d("no cayó en el mes pedido"));
    /* Estado de resultados: sale del mes de antes (si era otro) y entra en el nuevo, una sola vez. */
    const viejo = periodoDeFecha(g.fecha);
    const cuenta = (e: EstadoApp, p: string) => gastosDelMes(e, rangoDePeriodo(p)).filter((x) => x.id === g.id).length;
    const e0 = estadoCon([g]), e1 = estadoCon([movido]);
    for (const p of MESES) {
      assert.equal(cuenta(e0, p), p === viejo ? 1 : 0, d("antes", p));
      assert.equal(cuenta(e1, p), p === abierto ? 1 : 0, d("después", p));
    }
    /* Caja: igual. */
    for (const p of MESES) assert.equal(gastosPagadosEn(e1, rangoDePeriodo(p)).length, gastosPagadosEn(e0, rangoDePeriodo(p)).length, d("caja", p));

    /* Elegir un mes en el asistente tampoco toca el día de pago. */
    const b = { ...borradorInicial(AJUSTES, g, HOY), ...conOtraFechaDePago({ fecha: g.fecha }) };
    const conMes = { ...b, ...alElegirMes(b, abierto) };
    assert.equal(periodoDeFecha(conMes.fecha), abierto, d("alElegirMes"));
    assert.equal(conMes.fechaPago, b.fechaPago, d("alElegirMes tocó el día de pago"));
    /* Volver a una sola fecha: vale el día que se pagó. */
    const una = { ...conMes, ...sinOtraFechaDePago(conMes) };
    assert.equal(una.fecha, conMes.fechaPago);
    assert.equal(una.fechaPago, "");
    const guardada = guardar(g, una);
    assert.equal(fechaDePago(guardada), fechaDePago({ fecha: conMes.fechaPago }), d("la plata no quedó donde se pagó"));
    assert.ok(!tieneOtraFechaDePago(guardada) || guardada.fechaPago === undefined || guardada.fechaPago === null, d("quedó una segunda fecha"));
  }
});

test("pagadoEnOtroMes y tieneOtraFechaDePago concuerdan con los meses de las dos fechas", () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    const g = gastoAlAzar(semilla);
    const otroMes = periodoDeFecha(fechaDePago(g)) !== periodoDeFecha(g.fecha);
    assert.equal(pagadoEnOtroMes(g), otroMes && tieneOtraFechaDePago(g), donde(semilla));
    if (otroMes) assert.ok(tieneOtraFechaDePago(g));
    /* El mes cerrado se mira con la fecha del devengo (la que cuenta el estado de resultados). */
    const e = { liquidaciones: [{ periodo: periodoDeFecha(g.fecha), estado: "cerrada" }] } as unknown as EstadoApp;
    assert.equal(mesCerradoDe(e, g.fecha)?.periodo, periodoDeFecha(g.fecha), donde(semilla));
  }
});

test("runway · los tres meses cerrados son los tres anteriores a hoy, también con el cambio de año", () => {
  const NOMBRES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  for (let mes = 0; mes < 24; mes++) {
    for (const dia of [1, 15, 28, 31]) {
      const hoy = new Date(2026, mes, Math.min(dia, new Date(2026, mes + 1, 0).getDate()), 12);
      const esperado = [3, 2, 1].map((i) => NOMBRES[new Date(hoy.getFullYear(), hoy.getMonth() - i, 1).getMonth()]);
      const e = estadoCon([
        gasto({ id: "a", monto: 3000, fecha: new Date(hoy.getFullYear(), hoy.getMonth() - 1, 10, 12).toISOString() }),
        gasto({ id: "b", monto: 600, grupo: "dueno", fecha: new Date(hoy.getFullYear(), hoy.getMonth() - 3, 10, 12).toISOString() }),
        gasto({ id: "c", monto: 9999, grupo: "retiro", fecha: new Date(hoy.getFullYear(), hoy.getMonth() - 2, 10, 12).toISOString() }),
      ]);
      const x = runway(e, 12000, hoy);
      assert.equal(x.meses, `${esperado[0]}, ${esperado[1]} y ${esperado[2]}`, `hoy ${hoy.toISOString()}`);
      /* Gastos operativos y honorarios del dueño; los retiros no son un costo. */
      assert.equal(x.gastoMensual, r2((3000 + 600) / 3), `hoy ${hoy.toISOString()}`);
      assert.equal(x.colchon, r2(x.gastoMensual * 6));
      assert.equal(x.excedente, r2(12000 - x.colchon));
      assert.ok(cerca(x.mesesDeVida as number, 12000 / x.gastoMensual, 1e-9));
    }
  }
});

test("escribir un monto y volver a leerlo da el mismo número (plata con centavos y tipos de cambio con cuatro decimales)", () => {
  const r = azar(11);
  for (let i = 0; i < 3000; i++) {
    const n = i % 3 === 0 ? Math.round(r.n() * 1e11) / 100 : i % 3 === 1 ? Math.round(r.n() * 3e6 * 1e4) / 1e4 : r.entre(0, 5000);
    assert.equal(leerMonto(escribirMonto(n)), n, `n = ${n}`);
  }
  /* Lo que escribe una persona de acá. */
  assert.equal(leerMonto("145.000"), 145000);
  assert.equal(leerMonto("1.234.567,50"), 1234567.5);
  assert.equal(leerMonto("1500,5"), 1500.5);
  assert.equal(leerMonto("1500.5"), 1500.5);
  assert.equal(leerMonto("US$ 99,99"), 99.99);
});

/* ---------- Los gastos fijos de cada mes ---------- */

test("los gastos fijos caen en el mes y el día que dicen (a mediodía de Argentina), con meses de 28 a 31 días y años bisiestos", () => {
  for (let a = 2026; a <= 2028; a++) {
    for (let m = 1; m <= 12; m++) {
      const mes = `${a}-${String(m).padStart(2, "0")}`;
      const dias = new Date(a, m, 0).getDate();
      for (const dia of [-5, 0, 1, 1.4, 15, 28, 29, 30, 31, 35, Number.NaN]) {
        const f = fechaDelGastoFijo(mes, dia);
        const esperado = Math.min(Math.max(1, Math.round(dia) || 1), dias);
        assert.equal(mesDe(f), mes, `${mes} día ${dia}: cae en otro mes (${f})`);
        assert.equal(diaDe(f), esperado, `${mes} día ${dia}`);
        /* Y la hora de acá (la que corta los meses de Finanzas) dice lo mismo. */
        assert.equal(periodoDeFecha(f), mes, `${mes} día ${dia}: Finanzas lo pondría en ${periodoDeFecha(f)}`);
        assert.equal(new Date(f).getHours(), 12);
      }
      assert.equal(sumarMeses(sumarMeses(mes, 7), -7), mes);
      assert.equal(sumarMeses(sumarMeses(mes, -14), 14), mes);
    }
  }
});

test("P7e · aprobar un gasto fijo dos veces (o desde dos pantallas) no lo carga dos veces, y una vez aprobado deja de proponerse", () => {
  const r = azar(21);
  for (let i = 0; i < 200; i++) {
    const t = {
      id: `rec${i}`, concepto: r.elige(["Fathom", "Zoom", "Contador"]), categoria: "Software", grupo: "operativo" as const, proveedor: "X", monto: r.plata(10, 500),
      moneda: "USD" as const, diaDelMes: r.entre(1, 31), activo: true, desde: "2026-06", salteados: [] as string[], creadoEn: art(2026, 6, 1),
    };
    const hoy = art(2026, r.entre(8, 11), r.entre(1, 28), 12);
    const antes = propuestas({ gastos: [], gastosRecurrentes: [t] } as never, hoy);
    assert.ok(antes.length >= 1 && antes.length <= 3, `propuestas ${antes.length}`);
    const meses = antes.map((p) => p.mes);
    assert.equal(new Set(meses).size, meses.length, "un mes propuesto dos veces");
    const p = r.elige(antes);
    const uno = gastoAprobado(t as never, p.mes, p.monto, hoy), dos = gastoAprobado(t as never, p.mes, p.monto, hoy);
    assert.deepEqual(uno, dos);
    assert.equal(uno.id, dos.id);
    assert.equal(mesDe(uno.fecha), p.mes);
    /* Con el gasto cargado (una o dos veces), esa propuesta desaparece y las demás quedan. */
    const e = { gastos: [uno, dos].map((g, k) => (k === 0 ? g : { ...g })), gastosRecurrentes: [t] } as never;
    const despues = propuestas(e, hoy);
    assert.deepEqual(despues.map((x) => x.mes), meses.filter((m) => m !== p.mes));
    /* Con el mismo id dos veces en el estado (como si llegara dos veces), el estado de resultados lo cuenta... dos veces: lo evita el id, no la suma. */
    assert.equal(new Set([uno, dos].map((g) => g.id)).size, 1);
  }
});
