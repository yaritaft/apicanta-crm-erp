import { azar, art, cerca, congelar, devolucion, donde, mediodiaArg, miembro, pago, r2, MESES_MUNDO, type Azar } from "./plata-mundo";
import { escenarioVenta, devolucionesValidas } from "./plata-escenarios";
import test from "node:test";
import assert from "node:assert/strict";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import {
  devolvibleDeVenta, mesDeLiquidacion, problemaDeDevolucion, reversasDeComision, reversasDelMes,
} from "@/lib/devoluciones";
import { conciliarReembolsos, idDePropuesta, propuestasPendientes, type ReembolsoCrudo } from "@/lib/reembolsos";
import { rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · devoluciones.

   P3  la comisión revertida al closer y al director es exactamente lo comisionado por lo cobrado de esa venta,
       en la parte que se devolvió (nunca más), y con «no descontar al closer» no se revierte nada.
   P6  una devolución mayor a lo cobrado sin devolver se rechaza o se acota, y devolver dos veces lo mismo no duplica.
   P7  idempotencia: aplicar dos veces la misma lista de reembolsos da lo mismo.
   ================================================================== */

const HORIZONTE = MESES_MUNDO;
/* Junio también: los instantes de borde de julio en UTC (00:00Z del 1) son del 30/06 en Argentina. */
const mesesDe = ["2026-06", ...HORIZONTE].map((p) => rangoDePeriodo(p));

function sumasPorPersona(e: EstadoApp) {
  const comisionado = new Map<string, number>(), revertido = new Map<string, number>();
  const sumar = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const filasConDev: string[] = [];
  for (const m of mesesDe) {
    for (const f of comisionesDelMes(e, m)) {
      if (f.devolucionId) {
        filasConDev.push(f.devolucionId);
        sumar(revertido, `closer:${f.closerId ?? "sin"}`, -f.comisionCloser);
        sumar(revertido, "director", -f.comisionDirector);
      } else {
        sumar(comisionado, `closer:${f.closerId ?? "sin"}`, f.comisionCloser);
        sumar(comisionado, "director", f.comisionDirector);
      }
    }
  }
  return { comisionado, revertido, filasConDev };
}

test("P3 · lo que se revierte es lo comisionado por lo cobrado en la parte devuelta: nunca más, exacto en una devolución total, nada con «no descontar»", () => {
  let total = 0, parciales = 0, conNoDescontar = 0, conHeredadas = 0;
  for (let semilla = 1; semilla <= 250; semilla++) {
    const { r, equipo, venta, cuotas, pagos, ultimoPago } = escenarioVenta(semilla);
    const base = { equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones: [] as Devolucion[], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
    const devs = devolucionesValidas(r, ultimoPago, "v1", base, r.entre(1, 3));
    if (devs.length === 0) continue;
    const e = { ...base, devoluciones: devs } as EstadoApp;
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    const cobrado = r2(pagos.reduce((a, p) => a + p.monto, 0));
    const devuelto = r2(devs.reduce((a, x) => a + x.monto, 0));
    const descontadas = r2(devs.filter((x) => !x.noDescontarAlCloser).reduce((a, x) => a + x.monto, 0));
    const { comisionado, revertido, filasConDev } = sumasPorPersona(e);

    /* A · nunca más de lo comisionado, por persona. */
    for (const [k, rev] of revertido) {
      assert.ok(rev <= (comisionado.get(k) ?? 0) + 0.01, d("se revierte más de lo comisionado a", k, rev, comisionado.get(k) ?? 0));
      assert.ok(rev >= -1e-9, d("reversa negativa", k));
    }
    /* C · en la parte que se devolvió: comisionado × (lo devuelto descontando al closer / lo cobrado). */
    const fraccion = Math.min(1, descontadas / cobrado);
    for (const [k, com] of comisionado) {
      if (k === "closer:sin") continue;
      const esperado = com * fraccion;
      assert.ok(cerca(revertido.get(k) ?? 0, esperado, 0.02 * (devs.length + 1)), d("revertido a", k, revertido.get(k) ?? 0, "esperado", esperado, "fracción", fraccion));
    }
    /* B · devolución total sin «no descontar»: se revierte TODO lo comisionado, ni un centavo menos. */
    if (devs.every((x) => !x.noDescontarAlCloser) && cerca(devuelto, cobrado, 0.011)) {
      total++;
      for (const [k, com] of comisionado) {
        assert.ok(cerca(revertido.get(k) ?? 0, com, 0.02 * (devs.length + 1)), d("devolución total: revertido a", k, revertido.get(k) ?? 0, "comisionado", com));
      }
      /* El neto de cada persona en todos los meses queda en cero. */
      const netoMeses = mesesDe.map((m) => comisionesDelMes(e, m)).flat();
      assert.ok(cerca(netoMeses.reduce((a, f) => a + f.comisionCloser + f.comisionDirector, 0), 0, 0.02 * (devs.length + 1)), d("neto de comisiones distinto de cero"));
    } else if (devuelto < cobrado - 0.02) parciales++;
    /* D · «no descontar al closer»: la devolución no deja ninguna línea. */
    for (const x of devs) {
      if (x.noDescontarAlCloser) { conNoDescontar++; assert.ok(!filasConDev.includes(x.id), d("«no descontar» dejó una línea", x.id)); }
    }
    assert.ok(reversasDelMes(e, { clave: "x", etiqueta: "x", desde: new Date(2026, 0, 1), hasta: new Date(2027, 0, 1) }).every((rv) => !rv.sinDescuento), d("reversasDelMes con sinDescuento"));
    if (cuotas.some((c) => c.closerId)) conHeredadas++;
    /* E · el P&L: devolver no mueve los fees y baja el CC exactamente lo devuelto. */
    const sin = { ...e, devoluciones: [] } as EstadoApp;
    for (const m of mesesDe) {
      const p1 = calcularPyL(e, m), p0 = calcularPyL(sin, m);
      assert.ok(cerca(p1.feesProcesador, p0.feesProcesador, 1e-9), d("los fees cambiaron"));
      assert.ok(cerca(p1.cashCollected, p0.cashCollected - p1.devoluciones, 1e-6), d("CC"));
      assert.ok(cerca(p1.revenue, p0.revenue, 1e-9) && p1.ventas === p0.ventas, d("la venta dejó de contar en su mes"));
    }
  }
  assert.ok(total > 25 && parciales > 25 && conNoDescontar > 25 && conHeredadas > 25, `cobertura: ${total} totales, ${parciales} parciales, ${conNoDescontar} «no descontar», ${conHeredadas} con cuotas heredadas`);
});

test("P3b · con devoluciones de más (mayores a lo cobrado) la reversa se acota: ni un centavo más de lo comisionado", () => {
  for (let semilla = 1; semilla <= 200; semilla++) {
    const { r, equipo, venta, cuotas, pagos, ultimoPago } = escenarioVenta(semilla * 3 + 1);
    const cobrado = r2(pagos.reduce((a, p) => a + p.monto, 0));
    const devs: Devolucion[] = Array.from({ length: r.entre(1, 4) }, (_, i) => {
      const dia = new Date(ultimoPago + (1 + i * r.entre(0, 5)) * 86400000);
      return devolucion({ id: `d${i}`, ventaId: "v1", monto: r2(cobrado * r.elige([0.4, 1, 1, 1.5, 3])), fecha: art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), r.entre(0, 23)), noDescontarAlCloser: r.si(0.15) });
    });
    const e = { equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones: devs, gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
    const { comisionado, revertido } = sumasPorPersona(e);
    for (const [k, rev] of revertido) assert.ok(rev <= (comisionado.get(k) ?? 0) + 0.01, donde(semilla, "se revierte más de lo comisionado a", k, rev, comisionado.get(k) ?? 0));
    /* Entre todas las devoluciones, lo que la cuenta da por devuelto nunca pasa de lo cobrado. */
    const rvs = reversasDeComision(e);
    assert.ok(rvs.reduce((a, x) => a + x.devuelto, 0) <= cobrado + 0.02, donde(semilla, "devuelto acotado pasa de lo cobrado"));
    for (const rv of rvs) assert.ok(rv.parte >= 0 && rv.parte <= 1 + 1e-9 && rv.devuelto <= rv.quedaba + 0.005, donde(semilla, rv.devolucion.id));
  }
});

test("P3c · el orden en que están guardadas las devoluciones no cambia ninguna cuenta", () => {
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { r, equipo, venta, cuotas, pagos, ultimoPago } = escenarioVenta(semilla * 5);
    const base = { equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones: [] as Devolucion[], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
    const devs = devolucionesValidas(r, ultimoPago, "v1", base, 3);
    if (devs.length < 2) continue;
    const a = { ...base, devoluciones: devs } as EstadoApp;
    const b = { ...base, devoluciones: r.baraja(devs) } as EstadoApp;
    for (const m of mesesDe) {
      /* La suma en otro orden puede diferir en el último decimal del float: se compara redondeado. */
      const pyl = (e: EstadoApp) => Object.fromEntries(Object.entries(calcularPyL(e, m)).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));
      assert.deepEqual(pyl(a), pyl(b), donde(semilla, m.clave));
      const f = (e: EstadoApp) => comisionesDelMes(e, m).map((x) => x.id + ":" + r2(x.comisionCloser + x.comisionDirector)).sort();
      assert.deepEqual(f(a), f(b), donde(semilla, m.clave, "filas de comisión"));
    }
  }
});

test("P3d · con datos congelados, las cuentas de devoluciones no escriben nada", () => {
  const { r, equipo, venta, cuotas, pagos, ultimoPago } = escenarioVenta(77);
  const base = { equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones: [] as Devolucion[], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
  const e = congelar({ ...base, devoluciones: devolucionesValidas(r, ultimoPago, "v1", base, 3) } as EstadoApp);
  reversasDeComision(e);
  for (const m of mesesDe) { reversasDelMes(e, m); comisionesDelMes(e, m); calcularPyL(e, m); }
  assert.ok(true);
});

/* ---------- P6 · lo que se puede devolver ---------- */

const procesador = "proc_stripe";
const intentar = (e: EstadoApp, ventaId: string, monto: number, fecha: string, ignorar?: string) =>
  problemaDeDevolucion(e, { ventaId, monto, fecha, procesadorId: procesador, tieneComprobante: true }, ignorar);

function ventaConCobros(semilla: number) {
  const r = azar(semilla);
  const n = r.entre(1, 4);
  const cuotas = Array.from({ length: n }, (_, j) => ({ id: `c${j}`, ventaId: "v1", numero: j + 1, monto: 100, estado: "pagada", esReserva: false }));
  const pagos = cuotas.map((c, j) => pago(`p${j}`, c.id, r.plata(100, 1500), 0, art(2026, 8 + Math.floor(j / 2), r.entre(1, 28), r.entre(0, 23), r.entre(0, 59))));
  return { r, e: { cuotas, pagos, devoluciones: [] as Devolucion[] } as unknown as EstadoApp, cobrado: r2(pagos.reduce((a, p) => a + p.monto, 0)) };
}

test("P6 · cargando devoluciones en orden: la validación nunca deja devolver más de lo cobrado, y la misma dos veces no entra", () => {
  let rechazadas = 0, aceptadas = 0, repetidasRechazadas = 0;
  for (let semilla = 1; semilla <= 300; semilla++) {
    const { r, e: base, cobrado } = ventaConCobros(semilla);
    let e = base;
    const ultimo = Math.max(...e.pagos.map((p) => Date.parse(p.fecha)));
    let t = ultimo;
    for (let i = 0; i < 8; i++) {
      t += r.entre(0, 3) * 86400000;
      const dia = new Date(t);
      const fecha = art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 12);
      const { queda } = devolvibleDeVenta(e, "v1", fecha);
      const monto = r2(r.elige([queda, queda / 2, queda + 0.02, queda + 50, 0.01, queda * 1.0001, r.plata(1, cobrado * 1.5)]));
      const mal = intentar(e, "v1", monto, fecha);
      if (mal === null) {
        aceptadas++;
        e = { ...e, devoluciones: [...e.devoluciones, devolucion({ id: `d${i}`, monto, fecha })] } as EstadoApp;
        /* El mismo pedido otra vez, el mismo día: si ya se devolvió todo, no entra; si no, sólo entra si lo que queda lo cubre. */
        const otra = intentar(e, "v1", monto, fecha);
        if (monto > devolvibleDeVenta(e, "v1", fecha).queda + 0.01) { assert.notEqual(otra, null, donde(semilla, "devolver dos veces lo mismo entró")); repetidasRechazadas++; }
      } else rechazadas++;
      /* Invariante: en ningún momento lo devuelto pasa de lo cobrado. */
      const devuelto = e.devoluciones.reduce((a, x) => a + x.monto, 0);
      assert.ok(devuelto <= cobrado + 0.011 * (e.devoluciones.length + 1), donde(semilla, "devuelto", devuelto, "cobrado", cobrado));
    }
  }
  assert.ok(rechazadas > 200 && aceptadas > 300 && repetidasRechazadas > 100, `cobertura: ${aceptadas} aceptadas, ${rechazadas} rechazadas, ${repetidasRechazadas} repetidas rechazadas`);
});

test("P6b · una devolución sin monto, sin venta, sin fecha, sin cuenta o sin comprobante no se guarda; con la pasarela de testigo no hace falta comprobante", () => {
  const { e } = ventaConCobros(5);
  const f = art(2027, 1, 5, 12);
  assert.equal(intentar(e, "v1", 10, f), null, "con cobros, cuenta y comprobante, una devolución chica se puede guardar");
  assert.notEqual(problemaDeDevolucion(e, { monto: 10, fecha: f, procesadorId: procesador, tieneComprobante: true }), null, "sin venta");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: 0, fecha: f, procesadorId: procesador, tieneComprobante: true }), null, "monto 0");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: -5, fecha: f, procesadorId: procesador, tieneComprobante: true }), null, "monto negativo");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: Number.NaN, fecha: f, procesadorId: procesador, tieneComprobante: true }), null, "monto NaN");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: 10, fecha: "mañana", procesadorId: procesador, tieneComprobante: true }), null, "fecha inválida");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: 10, fecha: f, tieneComprobante: true }), null, "sin cuenta");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: 10, fecha: f, procesadorId: procesador, tieneComprobante: false }), null, "sin comprobante");
  assert.equal(problemaDeDevolucion(e, { ventaId: "v1", monto: 10, fecha: f, procesadorId: procesador, tieneComprobante: false, tienePasarela: true }), null, "con la pasarela alcanza");
  /* Antes del primer cobro no hay nada que devolver. */
  assert.notEqual(intentar(e, "v1", 10, art(2026, 1, 1, 12)), null);
});

test("P6c · corregir una devolución no cuenta contra sí misma, y se puede corregir hasta lo que queda", () => {
  for (let semilla = 1; semilla <= 100; semilla++) {
    const { r, e: base, cobrado } = ventaConCobros(semilla + 1000);
    const ultimo = Math.max(...base.pagos.map((p) => Date.parse(p.fecha)));
    const dia = new Date(ultimo + 86400000);
    const fecha = art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 12);
    const m1 = r2(cobrado * r.elige([0.3, 0.5, 1]));
    const e = { ...base, devoluciones: [devolucion({ id: "d1", monto: m1, fecha })] } as EstadoApp;
    assert.equal(intentar(e, "v1", cobrado, fecha, "d1"), null, donde(semilla, "corregir a todo lo cobrado"));
    assert.notEqual(intentar(e, "v1", r2(cobrado + 0.05), fecha, "d1"), null, donde(semilla, "corregir de más"));
    assert.equal(devolvibleDeVenta(e, "v1", fecha, "d1").queda, cobrado);
    assert.equal(devolvibleDeVenta(e, "v1", fecha).queda, r2(cobrado - m1));
  }
});

test("P6d · propuestas e ignoradas no gastan lo que queda por devolver", () => {
  const { e: base, cobrado } = ventaConCobros(9);
  const fecha = art(2027, 1, 5, 12);
  const e = { ...base, devoluciones: [
    devolucion({ id: "p", monto: cobrado, fecha, estado: "propuesta" }), devolucion({ id: "i", monto: cobrado, fecha, estado: "ignorada" }),
  ] } as EstadoApp;
  assert.equal(devolvibleDeVenta(e, "v1", fecha).queda, cobrado);
  assert.equal(intentar(e, "v1", cobrado, fecha), null);
});

/* ---------- Los dos agujeros que encontró el estrés ---------- */

test("BUG: cargar una devolución con fecha ANTERIOR a otra ya cargada deja devolver dos veces lo mismo", () => {
  /* Una venta de US$ 3.000 cobrada el 01/10. Se carga la devolución total del 10/10; después alguien carga otra total del 05/10. */
  const cuotas = [{ id: "c1", ventaId: "v1", numero: 1, monto: 3000, estado: "pagada", esReserva: false }];
  const pagos = [pago("p1", "c1", 3000, 0, art(2026, 10, 1, 10))];
  const e = { cuotas, pagos, devoluciones: [devolucion({ id: "a", monto: 3000, fecha: art(2026, 10, 10, 12) })] } as unknown as EstadoApp;
  const segunda = intentar(e, "v1", 3000, art(2026, 10, 5, 12));
  assert.notEqual(segunda, null, "la app aceptó devolver US$ 3.000 más de una venta cobrada en US$ 3.000 y ya devuelta por completo");
});

test("BUG: azar · cargando devoluciones fuera de orden, lo devuelto de una venta pasa de lo cobrado", () => {
  let primera: string | null = null;
  for (let semilla = 1; semilla <= 300 && !primera; semilla++) {
    const { r, e: base, cobrado } = ventaConCobros(semilla);
    let e = base;
    const ultimo = Math.max(...e.pagos.map((p) => Date.parse(p.fecha)));
    for (let i = 0; i < 6; i++) {
      const dia = new Date(ultimo + r.entre(1, 40) * 86400000);
      const fecha = art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 12);
      const monto = r2(r.elige([cobrado, cobrado / 2, cobrado / 3]));
      if (intentar(e, "v1", monto, fecha) !== null) continue;
      e = { ...e, devoluciones: [...e.devoluciones, devolucion({ id: `d${i}`, monto, fecha })] } as EstadoApp;
    }
    const devuelto = e.devoluciones.reduce((a, x) => a + x.monto, 0);
    if (devuelto > cobrado + 0.02) primera = `semilla ${semilla}: devuelto ${r2(devuelto)} de ${cobrado}`;
  }
  assert.equal(primera, null, "se pudo devolver más de lo cobrado: " + primera);
});

test("BUG: un cobro del mismo día, después de las 12, no cuenta como «cobrado hasta ese día» y bloquea la devolución de ese día", () => {
  /* El cliente paga a las 16:00 del 30/09 y pide la plata de vuelta esa misma tarde. */
  const cuotas = [{ id: "c1", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false }];
  const pagos = [pago("p1", "c1", 1500, 45, art(2026, 9, 30, 16, 0))];
  const e = { cuotas, pagos, devoluciones: [] } as unknown as EstadoApp;
  const hoy = mediodiaArg("2026-09", 30);
  assert.equal(intentar(e, "v1", 1500, hoy), null, "«Esta venta no tiene cobros hasta ese día» el mismo día del cobro");
});

test("BUG: ...y la comisión de ese cobro del mismo día no se revierte", () => {
  const equipo = [miembro("c1", "Closer", "closer", 0.1)];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: art(2026, 9, 28), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 28), extra: {} };
  const cuotas = [
    { id: "c1a", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false },
    { id: "c1b", ventaId: "v1", numero: 2, monto: 1500, estado: "pagada", esReserva: false },
  ];
  const pagos = [pago("p1", "c1a", 1500, 0, art(2026, 9, 28, 10)), pago("p2", "c1b", 1500, 0, art(2026, 10, 3, 16))];
  /* Se devuelven los 3.000 el 03/10 (la fecha del formulario: mediodía). */
  const e = { equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: mediodiaArg("2026-10", 3) })], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 } } as unknown as EstadoApp;
  const [rv] = reversasDeComision(e);
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.reversa, 300, "se le había comisionado 150 + 150: se revierte todo");
});

/* ---------- P7 · idempotencia de los reembolsos de las pasarelas ---------- */

function crudoAlAzar(r: Azar, i: number, ventas: Venta[]): ReembolsoCrudo {
  const proveedor = r.elige(["stripe", "hotmart", "whop"] as const);
  return {
    proveedor, referencia: `re_${proveedor}_${i}`, referenciasCobro: [`ch_${r.entre(1, 6)}`],
    monto: r.elige([100, 250.5, 500, 1000]), moneda: "USD", fecha: art(2026, r.entre(8, 11), r.entre(1, 28), 12),
    clienteNombre: r.elige(ventas).contactoNombre, procesadorId: "proc_stripe",
  };
}

test("P7 · aplicar dos veces la misma lista de reembolsos da lo mismo: no se ata ni se propone de nuevo, y Finanzas no se mueve", () => {
  for (let semilla = 1; semilla <= 150; semilla++) {
    const r = azar(semilla);
    const nV = r.entre(2, 5);
    const ventas: Venta[] = Array.from({ length: nV }, (_, i) => ({ id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: 1000, fecha: art(2026, 8, 1), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 8, 1), extra: {} } as Venta));
    const cuotas = ventas.map((v, i) => ({ id: `c${i}`, ventaId: v.id, numero: 1, monto: 1000, estado: "pagada", esReserva: false }));
    const pagos = cuotas.map((c, i) => ({ ...pago(`p${i}`, c.id, 1000, 29, art(2026, 8, 5)), referencia: `ch_${i + 1}` }));
    /* Devoluciones ya cargadas a mano que pueden calzar con alguna. */
    const cargadas = Array.from({ length: r.entre(0, 3) }, (_, i) => devolucion({ id: `m${i}`, ventaId: r.elige(ventas).id, monto: r.elige([100, 250.5, 500, 1000]), fecha: art(2026, r.entre(8, 11), r.entre(1, 28), 12) }));
    const e0 = { ventas, cuotas, pagos, devoluciones: cargadas, movimientos: [], procesadores: [{ id: "proc_stripe", nombre: "Stripe", proveedor: "stripe" }], contactos: [], leads: [], equipo: [], ajustes: { monedaBase: "USD" }, gastos: [] } as unknown as EstadoApp;
    const crudos = Array.from({ length: r.entre(1, 8) }, (_, i) => crudoAlAzar(r, i, ventas));
    /* Con algún repetido a propósito: la pasarela puede avisar dos veces. */
    const lista = [...crudos, ...(r.si(0.5) ? [crudos[0]] : [])];

    const aplicar = (e: EstadoApp, res: ReturnType<typeof conciliarReembolsos>): EstadoApp => ({
      ...e,
      devoluciones: [
        ...e.devoluciones.map((d) => { const a = res.atadas.find((x) => x.devolucionId === d.id); return a ? { ...d, ...a.cambios } : d; }),
        ...res.nuevas,
      ],
    }) as EstadoApp;

    const uno = conciliarReembolsos(e0, lista, "2026-10-07T12:00:00.000Z");
    const e1 = aplicar(e0, uno);
    const dos = conciliarReembolsos(e1, lista, "2026-10-07T12:00:00.000Z");
    const donde2 = donde(semilla);
    assert.deepEqual(dos.nuevas, [], donde2 + " · volvió a proponer");
    assert.deepEqual(dos.atadas, [], donde2 + " · volvió a atar");
    const validos = lista.filter((x) => x.referencia && x.monto > 0).length;
    assert.equal(dos.yaEstaban, validos, donde2 + " · los ya vistos no suman todos");
    /* Y aplicar el resultado de la primera pasada otra vez no cambia el estado. */
    assert.deepEqual(aplicar(e1, { ...uno, nuevas: uno.nuevas.filter((n) => !e1.devoluciones.some((d) => d.id === n.id)) }).devoluciones, e1.devoluciones, donde2 + " · estado");
    /* Un aviso de reembolso nunca entra como cobro ni resta plata: las propuestas no cuentan. */
    for (const n of uno.nuevas) assert.equal(n.estado, "propuesta", donde2);
    for (const m of [rangoDePeriodo("2026-08"), rangoDePeriodo("2026-09"), rangoDePeriodo("2026-10"), rangoDePeriodo("2026-11")]) {
      const antes = calcularPyL(e0, m), despues = calcularPyL(e1, m);
      assert.equal(despues.devoluciones, antes.devoluciones, donde2 + " · " + m.clave + " · una propuesta restó plata");
      assert.equal(despues.cobrado, antes.cobrado, donde2 + " · entró como cobro");
    }
    /* Cada aviso termina en una sola devolución con su referencia (atada o propuesta). */
    const refs = e1.devoluciones.map((d) => d.referencia).filter(Boolean) as string[];
    assert.equal(new Set(refs).size, refs.length, donde2 + " · una referencia dos veces");
    assert.equal(new Set(e1.devoluciones.map((d) => d.id)).size, e1.devoluciones.length, donde2 + " · un id dos veces");
    assert.equal(propuestasPendientes(e1).length, e1.devoluciones.filter((d) => d.estado === "propuesta").length);
  }
});

test("P7b · el id de una propuesta sale de su referencia: guardar dos veces el mismo aviso no duplica nada", () => {
  const r = azar(3);
  for (let i = 0; i < 200; i++) {
    const c = { proveedor: r.elige(["stripe", "hotmart", "whop"] as const), referencia: `re_3Q${r.entre(1, 1e9)}_${i}` };
    assert.equal(idDePropuesta(c), idDePropuesta({ ...c }));
    assert.ok(idDePropuesta(c).length <= 120);
  }
});

/* ---------- La liquidación a la que va a parar una devolución ---------- */

test("mesDeLiquidacion · cae en el primer mes abierto desde su fecha, o en la liquidación cuya foto ya la tiene", () => {
  const cerrada = (periodo: string, ids: string[] = []) => ({
    periodo, estado: "cerrada" as const,
    resultado: { personas: [{ lineas: ids.map((id) => ({ devolucionId: id })) }] } as never,
  });
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = azar(semilla);
    const cerrados = HORIZONTE.filter(() => r.si(0.5));
    const liqs = cerrados.map((p) => cerrada(p));
    const dia = r.entre(1, 28);
    const mes = r.elige(HORIZONTE.slice(0, 5));
    const fecha = art(Number(mes.slice(0, 4)), Number(mes.slice(5)), dia, 12);
    const destino = mesDeLiquidacion({ id: "x", fecha }, liqs);
    assert.ok(destino >= mes, donde(semilla, "nunca va a un mes anterior al suyo"));
    assert.ok(!cerrados.includes(destino), donde(semilla, "nunca va a un mes cerrado", destino));
    /* Y es el primero abierto: todos los meses entre el suyo y el destino están cerrados. */
    for (let p = mes; p < destino; p = HORIZONTE[HORIZONTE.indexOf(p as never) + 1] ?? "9999-99") assert.ok(cerrados.includes(p), donde(semilla, "salteó un mes abierto", p));
    /* Si una foto ya la incluye, es ésa, aunque haya meses abiertos antes. */
    const conFoto = [...liqs, cerrada(r.elige(HORIZONTE), ["x"])];
    assert.equal(mesDeLiquidacion({ id: "x", fecha }, conFoto), conFoto[conFoto.length - 1].periodo, donde(semilla, "la foto manda"));
  }
});
