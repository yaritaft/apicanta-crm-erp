import test from "node:test";
import assert from "node:assert/strict";
import { azar, cerca, congelar, donde, instante, MESES_MUNDO, mundo, r2 } from "../plata/plata-mundo";
import { pasosDelMes } from "@/lib/cierre-mes";
import { pasosDeFinanzas } from "@/lib/finanzas-pasos";
import { propuestasPendientes } from "@/lib/reembolsos";
import { situacionDe } from "@/lib/traspasos";
import { transaccionesDe } from "@/lib/transacciones";
import { borradorInicial, datosDelGasto, esIngreso, problemasDelGasto } from "@/lib/carga-gasto";
import { calcularPyL } from "@/lib/finanzas";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { esDevolucionConfirmada } from "@/lib/devoluciones";
import { rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp, Gasto, Movimiento, Traspaso } from "@/lib/types";

/* ==================================================================
   Frente «Revisión con Aldana (17/10)» · lo del mes, los ingresos y Transacciones con datos al azar.

   Propiedades (cada mensaje dice la semilla para repetirlo):
   A1  cada cosa pendiente aparece en UN solo mes: sumando los meses, los cobros sin atar, los reembolsos sin atar y
       los retiros sin decidir dan exactamente el total (nada se pierde y nada se cuenta dos veces).
   A2  Transacciones lista cada cobro, gasto, devolución y pase una sola vez, no repite lo conciliado (es el pago) ni
       muestra lo ignorado, y sus totales coinciden con una cuenta hecha aparte.
   A3  partir el tiempo en meses no cambia nada: los totales de los meses suman los del total y ninguna fila cae en dos.
   A4  un ingreso (plata que volvió) viaja bien: cargar → guardar → abrir → guardar deja lo mismo, y en el estado de
       resultados resta exactamente lo que volvió, sólo en su mes.
   A5  lo que se pide al día del día de Aldana (cobros sin atar de este mes) es un recorte de lo del mes, y el aviso de
       lo de meses anteriores cuenta justo lo que queda afuera.
   ================================================================== */

const SEMILLAS = 120;
const AHORA = Date.parse("2026-10-16T15:00:00.000Z");
const TIPOS_MOV = ["stripe", "whop", "hotmart", "mercury", "dlocal"] as const;

function mundoDeAldana(semilla: number): EstadoApp {
  const { e } = mundo(semilla, { devoluciones: 6, gastos: 25, pesos: true, huerfanos: semilla % 7 === 0 });
  const r = azar(semilla * 17 + 3);
  const estados = ["pendiente", "pendiente", "conciliado", "ignorado"] as const;
  const movimientos: Movimiento[] = Array.from({ length: r.entre(0, 40) }, (_, i) => ({
    id: `mov_${semilla}_${i}`, proveedor: r.elige(TIPOS_MOV), referencia: `ref${i}`, monto: r.plata(50, 3000), moneda: "USD", fee: 0, neto: 0,
    fecha: instante(r, { meses: MESES_MUNDO, bordes: 0.3 }), estado: r.elige(estados), clienteNombre: `Cliente ${i}`,
  } as Movimiento));
  const traspasos: Traspaso[] = Array.from({ length: r.entre(0, 12) }, (_, i) => {
    const fecha = instante(r, { meses: MESES_MUNDO, bordes: 0.3 });
    const monto = r.plata(100, 4000);
    return {
      id: `tr_${semilla}_${i}`, fecha, origenId: r.elige(["proc_hotmart", "proc_stripe"]), destinoId: "proc_mercury", montoSale: monto, monedaSale: "USD", montoLlega: monto, monedaLlega: "USD",
      estado: r.elige(["confirmado", "confirmado", "propuesto", "ignorado"] as const), llegadaRef: `mercury:${i}`, origen: "api", creadoEn: fecha,
    } as Traspaso;
  });
  const propuestas: Devolucion[] = Array.from({ length: r.entre(0, 8) }, (_, i) => ({
    id: `dev_p_${semilla}_${i}`, monto: r.plata(30, 800), moneda: "USD", fecha: instante(r, { meses: MESES_MUNDO, bordes: 0.3 }), noDescontarAlCloser: false, estado: "propuesta",
    creadoEn: "2026-10-01T00:00:00.000Z", extra: {},
  } as Devolucion));
  /* Ingresos: gastos en negativo, de cualquier categoría. */
  const ingresos: Gasto[] = Array.from({ length: r.entre(0, 5) }, (_, i) => ({
    id: `ing_${semilla}_${i}`, categoria: "Honorarios del CEO", grupo: "dueno", concepto: `Reembolso ${i}`, monto: -r.plata(10, 500), moneda: "USD",
    fecha: instante(r, { meses: MESES_MUNDO, bordes: 0.3 }), recurrente: false, creadoEn: "2026-10-01T00:00:00.000Z", proveedor: "Hotel", extra: { ingreso: true },
  } as Gasto));
  return { ...e, movimientos: [...e.movimientos, ...movimientos], traspasos: [...(e.traspasos ?? []), ...traspasos], devoluciones: [...(e.devoluciones ?? []), ...propuestas], gastos: [...e.gastos, ...ingresos] };
}

const mesesDe = (fechas: string[]) => [...new Set(fechas.map((f) => diaDeNegocio(f).slice(0, 7)))].sort();

test("A1 · cada pendiente está en un solo mes: sumando los meses da el total", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const e = congelar(mundoDeAldana(semilla));
    const cual = donde(semilla);
    const pendientes = e.movimientos.filter((m) => m.estado === "pendiente");
    const meses = mesesDe([...pendientes.map((m) => m.fecha), ...propuestasPendientes(e).map((d) => d.fecha), ...(e.traspasos ?? []).map((t) => t.fecha)]);
    const hacen = (id: string) => meses.reduce((a, mes) => a + (pasosDelMes(e, mes, { ahora: AHORA, esDueno: true }).find((p) => p.id === id)?.faltan ?? 0), 0);
    assert.equal(hacen("movs-sin-atar"), pendientes.length, `${cual}: cobros sin atar`);
    assert.equal(hacen("reembolsos"), propuestasPendientes(e).length, `${cual}: reembolsos`);
    const retiros = (e.traspasos ?? []).filter((t) => ["por-confirmar", "no-llego", "falta-comision", "diferencia"].includes(situacionDe(t, AHORA))).length;
    assert.equal(hacen("pases"), retiros, `${cual}: movimientos entre cuentas`);
  }
});

test("A2 · Transacciones lista cada cosa una vez y los totales coinciden con una cuenta aparte", () => {
  let conIngresos = 0, conPendientes = 0;
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const e = congelar(mundoDeAldana(semilla));
    const cual = donde(semilla);
    const { filas, resumen } = transaccionesDe(e);
    assert.equal(new Set(filas.map((f) => f.id)).size, filas.length, `${cual}: filas repetidas`);
    const esperadas = e.pagos.length + e.movimientos.filter((m) => m.estado === "pendiente").length + e.gastos.length
      + (e.devoluciones ?? []).filter(esDevolucionConfirmada).length + (e.traspasos ?? []).length;
    assert.equal(filas.length, esperadas, `${cual}: cantidad de filas`);
    assert.ok(filas.every((f) => f.monto >= 0 && Number.isFinite(f.monto)), `${cual}: monto negativo o roto`);
    assert.ok(filas.every((f) => !/undefined|NaN/.test(`${f.titulo} ${f.detalle} ${f.cuenta} ${f.estado}`)), `${cual}: texto roto`);
    assert.deepEqual(filas.map((f) => f.dia), [...filas.map((f) => f.dia)].sort().reverse(), `${cual}: orden`);

    const ingresos = e.pagos.reduce((a, p) => a + p.monto, 0) + e.gastos.filter((g) => g.monto < 0).reduce((a, g) => a - g.monto, 0);
    const egresos = e.gastos.filter((g) => g.monto >= 0).reduce((a, g) => a + g.monto, 0) + (e.devoluciones ?? []).filter(esDevolucionConfirmada).reduce((a, d) => a + d.monto, 0);
    const holgura = filas.length * 0.006;
    assert.ok(cerca(resumen.ingresos, ingresos, holgura), `${cual}: ingresos ${resumen.ingresos} ≠ ${r2(ingresos)}`);
    assert.ok(cerca(resumen.egresos, egresos, holgura), `${cual}: egresos ${resumen.egresos} ≠ ${r2(egresos)}`);
    assert.ok(cerca(resumen.neto, resumen.ingresos - resumen.egresos, 0.011), `${cual}: neto`);
    if (e.gastos.some((g) => g.monto < 0)) conIngresos++;
    if (resumen.sinConciliarN > 0) conPendientes++;
  }
  assert.ok(conIngresos > SEMILLAS / 2 && conPendientes > SEMILLAS / 2, "la prueba casi no ve ingresos ni cobros sin conciliar: no estresa nada");
});

test("A3 · partir en meses no cambia nada: ninguna fila cae en dos y los totales suman", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const e = congelar(mundoDeAldana(semilla));
    const cual = donde(semilla);
    const todo = transaccionesDe(e);
    const meses = mesesDe(todo.filas.map((f) => f.fecha));
    const vistas = new Set<string>();
    let ingresos = 0, egresos = 0, sinConciliar = 0, n = 0;
    for (const mes of meses) {
      const r = rangoDePeriodo(mes);
      const { filas, resumen } = transaccionesDe(e, { desde: `${mes}-01`, hasta: `${mes}-31` });
      void r;
      for (const f of filas) { assert.ok(!vistas.has(f.id), `${cual}: ${f.id} cae en dos meses`); vistas.add(f.id); assert.ok(f.dia.startsWith(mes), `${cual}: ${f.id} en el mes equivocado`); }
      ingresos += resumen.ingresos; egresos += resumen.egresos; sinConciliar += resumen.sinConciliar; n += resumen.n;
    }
    assert.equal(n, todo.resumen.n, `${cual}: cantidad`);
    const tol = todo.filas.length * 0.006;
    assert.ok(cerca(ingresos, todo.resumen.ingresos, tol), `${cual}: ingresos de los meses`);
    assert.ok(cerca(egresos, todo.resumen.egresos, tol), `${cual}: egresos de los meses`);
    assert.ok(cerca(sinConciliar, todo.resumen.sinConciliar, tol), `${cual}: sin conciliar de los meses`);
  }
});

test("A4 · un ingreso viaja bien: ida y vuelta por el asistente, y resta justo lo que volvió en su mes", () => {
  const aj = { monedaBase: "USD" as const, tipoCambio: 1450 };
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const r = azar(semilla * 5 + 1);
    const monto = r.plata(1, 9000);
    const ingreso = r.si(0.6);
    const enPesos = r.si(0.3);
    const b = {
      ...borradorInicial(aj, null, new Date(2026, 9, r.entre(1, 28), 12)), concepto: "Algo", categoria: r.elige(["Honorarios del CEO", "Software", "Viáticos equipo"]), grupo: "operativo" as const,
      categoriaElegida: true, proveedor: "Proveedor", monto: String(monto).replace(".", ","), moneda: enPesos ? "ARS" as const : "USD" as const, tipoCambio: "1450", ingreso, cuenta: r.elige(["", "Mercury", "Stripe"]),
    };
    const cual = donde(semilla);
    assert.deepEqual(problemasDelGasto(b, "USD"), {}, `${cual}: se puede cargar`);
    const g1 = { ...datosDelGasto(b, { base: "USD", opciones: [] }), id: "g" } as Gasto;
    assert.equal(esIngreso(g1), ingreso, `${cual}: el signo dice si es ingreso`);
    assert.ok(g1.monto !== 0 && Number.isFinite(g1.monto), cual);
    const g2 = { ...datosDelGasto(borradorInicial(aj, g1), { base: "USD", previo: g1, opciones: [] }), id: "g" } as Gasto;
    assert.equal(g2.monto, g1.monto, `${cual}: guardar sin tocar deja el monto`);
    assert.equal(g2.recurrente, false, cual);
    assert.deepEqual(g2.extra, g1.extra, `${cual}: ni los datos de más`);
    assert.equal(g2.extra?.cuenta, g1.extra?.cuenta, cual);
  }
  /* En el estado de resultados: el ingreso resta lo que volvió de su mes y de ningún otro. */
  for (let semilla = 1; semilla <= 60; semilla++) {
    const e = mundoDeAldana(semilla);
    const mes = MESES_MUNDO[semilla % MESES_MUNDO.length];
    const con = calcularPyL(e, rangoDePeriodo(mes));
    const sin = calcularPyL({ ...e, gastos: e.gastos.filter((g) => !g.id.startsWith("ing_")) }, rangoDePeriodo(mes));
    const volvio = e.gastos.filter((g) => g.id.startsWith("ing_") && diaDeNegocio(g.fecha).startsWith(mes)).reduce((a, g) => a - g.monto, 0);
    assert.ok(cerca(sin.honorariosCeo - con.honorariosCeo, volvio, 0.02), `${donde(semilla, mes)}: Honorarios del CEO baja ${r2(sin.honorariosCeo - con.honorariosCeo)} y volvió ${r2(volvio)}`);
  }
});

test("A5 · el día de Aldana ve el mes en curso y cuenta justo lo que queda afuera", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const e = congelar(mundoDeAldana(semilla));
    const cual = donde(semilla);
    const banco = pasosDeFinanzas(e, "dia", "2026-10-16", { ahora: AHORA, esDueno: true }).find((p) => p.id === "d-banco")!;
    const delMes = pasosDelMes(e, "2026-10", { ahora: AHORA, esDueno: true });
    const sinAtarOct = e.movimientos.filter((m) => m.estado === "pendiente" && diaDeNegocio(m.fecha) >= "2026-10-01" && diaDeNegocio(m.fecha) <= "2026-10-16").length;
    const pasesOct = (e.traspasos ?? []).filter((t) => diaDeNegocio(t.fecha) >= "2026-10-01" && diaDeNegocio(t.fecha) <= "2026-10-16" && ["por-confirmar", "no-llego", "falta-comision", "diferencia"].includes(situacionDe(t, AHORA))).length;
    assert.equal(banco.faltan, sinAtarOct + pasesOct, `${cual}: el banco de hoy es lo de este mes`);
    assert.equal(banco.estado === "listo", banco.faltan === 0, cual);
    void delMes;
    const todosSinAtar = e.movimientos.filter((m) => m.estado === "pendiente" && diaDeNegocio(m.fecha) <= "2026-10-16").length;
    const todosPases = (e.traspasos ?? []).filter((t) => diaDeNegocio(t.fecha) <= "2026-10-16" && ["por-confirmar", "no-llego", "falta-comision", "diferencia"].includes(situacionDe(t, AHORA))).length;
    const afuera = (todosSinAtar - sinAtarOct) + (todosPases - pasesOct);
    assert.equal(/meses anteriores/.test(banco.detalle), afuera > 0, `${cual}: el aviso de meses anteriores ${afuera > 0 ? "falta" : "sobra"}`);
    if (afuera > 0) assert.match(banco.detalle, new RegExp(`${afuera} pendientes? de meses anteriores`), cual);
  }
});
