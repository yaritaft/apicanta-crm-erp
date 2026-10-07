import { azar, art, cerca, devolucion, donde, miembro, mundo, pago, MESES_MUNDO } from "./plata-mundo";
import test from "node:test";
import assert from "node:assert/strict";
import { calcularPyL, cashCollected, revenue } from "@/lib/finanzas";
import { totalDevuelto } from "@/lib/devoluciones";
import { resultadoPorEmbudo } from "@/lib/embudos";
import { metricasDeWebinar } from "@/lib/webinar";
import { ingresosPorCuentaYServicio } from "@/lib/ingresos-semanales";
import { rendimientoPorVia } from "@/lib/vias-webinar";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { cajaEsperada } from "@/lib/caja";
import { saldosEsperados } from "@/lib/traspasos";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Webinar } from "@/lib/types";

/* ==================================================================
   Frente «la plata» · las pantallas dicen lo mismo.

   El README promete que una devolución «se refleja» en Finanzas, el Dashboard, los webinars, los embudos y la caja.
   Acá se comprueba con datos al azar que las cuentas de cada pantalla son las de Finanzas: la suma de los embudos
   es el total, y cada webinar da lo que daría Finanzas mirando sólo sus ventas.
   ================================================================== */

const MESES = MESES_MUNDO;

/* El mismo mundo con embudos y webinars repartidos entre las ventas. */
function conEmbudosYWebinars(semilla: number) {
  const { e, tc } = mundo(semilla, { devoluciones: 8, gastos: 5, ventas: 16, cierreDelDia: false, esquemas: false });
  const r = azar(semilla * 17);
  const embudos = [{ id: "emb1", nombre: "Webinar", esWebinar: true }, { id: "emb2", nombre: "VSL" }];
  const webinars: Webinar[] = ["w1", "w2"].map((id, i) => ({
    id, titulo: id, fecha: art(2026, 8 + i, 15, 19), duracionMin: 90, estado: "finalizado", registrados: 0, asistentes: 0, inversion: 0, formularios: 0, grupoWpp: 0,
    llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0, llamadasNoCalificadas: 0, llamadasCalificadas: 0,
    inversionDmAds: 0, costoWhatsappApi: 0, creadoEn: art(2026, 7, 1), extra: {},
  }));
  const ventas = e.ventas.map((v) => {
    const emb = r.elige([undefined, "emb1", "emb1", "emb2"]);
    const wid = emb === "emb1" ? r.elige(["w1", "w2", undefined]) : undefined;
    return { ...v, ...(emb ? { embudoId: emb } : {}), ...(wid ? { webinarId: wid } : {}) };
  });
  return {
    tc,
    e: { ...e, ventas, embudos, webinars, adInsights: [], ads: [], campaigns: [] } as unknown as EstadoApp,
  };
}

/* Toda la vida del mundo en una ventana. */
const TODO = { clave: "todo", etiqueta: "todo", desde: new Date(2026, 5, 1), hasta: new Date(2027, 0, 31, 23, 59, 59) };

test("los embudos suman lo que Finanzas: cobrado, devuelto, facturado, procesador y comisiones, mes por mes", () => {
  let filas = 0, conDevolucion = 0;
  for (let semilla = 1; semilla <= 100; semilla++) {
    const { e } = conEmbudosYWebinars(semilla);
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const p = calcularPyL(e, m);
      const rs = resultadoPorEmbudo(e, m);
      const suma = (f: (x: (typeof rs)[number]) => number) => rs.reduce((a, x) => a + f(x), 0);
      const d = (...x: (string | number)[]) => donde(semilla, periodo, ...x);
      assert.ok(cerca(suma((x) => x.cobrado), p.cashCollected, 0.02 * (rs.length + 1)), d("cobrado de los embudos", suma((x) => x.cobrado), "CC", p.cashCollected));
      assert.ok(cerca(suma((x) => x.devuelto), p.devoluciones, 0.02 * (rs.length + 1)), d("devuelto de los embudos"));
      assert.ok(cerca(suma((x) => x.facturado), p.revenue, 0.02 * (rs.length + 1)), d("facturado de los embudos"));
      assert.ok(cerca(suma((x) => x.procesador), p.feesProcesador, 0.02 * (rs.length + 1)), d("procesadores de los embudos"));
      assert.ok(cerca(suma((x) => x.comisiones), p.comisionCloser + p.comisionDirector, 0.02 * (rs.length + 1)), d("comisiones de los embudos", suma((x) => x.comisiones), p.comisionCloser + p.comisionDirector));
      assert.equal(suma((x) => x.ventas), p.ventas, d("ventas de los embudos"));
      filas += rs.length;
      if (p.devoluciones > 0) conDevolucion++;
    }
  }
  assert.ok(filas > 600 && conDevolucion > 80, `cobertura: ${filas} filas de embudo, ${conDevolucion} meses con devolución`);
});

test("cada webinar da lo que daría Finanzas mirando sólo sus ventas: cobrado sin lo devuelto, procesador y comisiones con la reversa", () => {
  let webinars = 0, conDevolucion = 0, conReversa = 0;
  for (let semilla = 1; semilla <= 120; semilla++) {
    const { e } = conEmbudosYWebinars(semilla);
    for (const w of e.webinars) {
      const suyas = e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada");
      const ids = new Set(suyas.map((v) => v.id));
      const cuotas = e.cuotas.filter((c) => ids.has(c.ventaId));
      const cuotaIds = new Set(cuotas.map((c) => c.id));
      const solo = {
        ...e, ventas: suyas, cuotas, pagos: e.pagos.filter((p) => cuotaIds.has(p.cuotaId)),
        devoluciones: e.devoluciones.filter((x) => x.ventaId && ids.has(x.ventaId)),
      } as EstadoApp;
      const p = calcularPyL(solo, TODO);
      const m = metricasDeWebinar(e, w);
      const d = (...x: (string | number)[]) => donde(semilla, w.id, ...x);
      assert.ok(cerca(m.cobrado, p.cashCollected, 0.01), d("cobrado", m.cobrado, "Finanzas", p.cashCollected));
      assert.ok(cerca(m.devoluciones, p.devoluciones, 0.01), d("devuelto"));
      assert.ok(cerca(m.procesador, p.feesProcesador, 0.01), d("procesador"));
      assert.ok(cerca(m.facturado, p.revenue, 0.01), d("facturado"));
      assert.ok(cerca(m.comisiones, p.comisionCloser + p.comisionDirector, 0.01), d("comisiones", m.comisiones, "Finanzas", p.comisionCloser + p.comisionDirector));
      assert.equal(m.ventas, suyas.length, d("ventas"));
      webinars++;
      if (p.devoluciones > 0) conDevolucion++;
      if (solo.devoluciones.some((x) => x.estado === "confirmada" && !x.noDescontarAlCloser)) conReversa++;
    }
  }
  assert.ok(webinars === 240 && conDevolucion > 40 && conReversa > 30, `cobertura: ${webinars} webinars, ${conDevolucion} con devolución, ${conReversa} con reversa`);
});

test("el total de todos los meses del mundo es lo mismo mirado de una vez: CC y devoluciones no dependen de cómo se parta el período", () => {
  for (let semilla = 1; semilla <= 80; semilla++) {
    const { e } = mundo(semilla, { devoluciones: 8, gastos: 6 });
    const juntos = calcularPyL(e, TODO);
    /* Junio también: 00:00 UTC del 1/07 es el 30/06 a las 21:00 en Argentina. */
    const partes = ["2026-06", ...MESES].map((p) => calcularPyL(e, rangoDePeriodo(p)));
    const suma = (f: (x: ReturnType<typeof calcularPyL>) => number) => partes.reduce((a, x) => a + f(x), 0);
    const d = (...x: (string | number)[]) => donde(semilla, ...x);
    assert.ok(cerca(suma((x) => x.cashCollected), juntos.cashCollected, 1e-6), d("CC"));
    assert.ok(cerca(suma((x) => x.devoluciones), juntos.devoluciones, 1e-6), d("devoluciones"));
    assert.ok(cerca(suma((x) => x.comisionCloser + x.comisionDirector), juntos.comisionCloser + juntos.comisionDirector, 1e-6), d("comisiones"));
    assert.ok(cerca(suma((x) => x.feesProcesador), juntos.feesProcesador, 1e-6), d("fees"));
    assert.ok(cerca(suma((x) => x.otrosDirectos + x.gastosOperativos + x.honorariosCeo), juntos.otrosDirectos + juntos.gastosOperativos + juntos.honorariosCeo, 1e-6), d("gastos"));
    assert.ok(cerca(suma((x) => x.revenue), revenue(e, TODO), 1e-6) && cerca(juntos.cashCollected, cashCollected(e, TODO), 1e-9) && cerca(totalDevuelto(e, TODO), juntos.devoluciones, 1e-9), d("revenue"));
  }
});

/* ---------- BUG: devolver por una cuenta en pesos ---------- */

test("BUG: una devolución cargada desde el formulario por una cuenta en pesos no resta de lo que tendría que haber en esa cuenta", () => {
  /* El cliente pagó por la Financiera (ARS): el formulario propone esa misma cuenta (procesadorDeLaVenta). */
  const equipo = [miembro("c1", "Closer", "closer", 0.1)];
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(2026, 9, 10), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 10), extra: {} };
  const cuotas = [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }];
  const cobro = { ...pago("p1", "q1", 1000, 50, art(2026, 9, 12, 10), "proc_fin"), tipoCambio: 1500, montoArs: 1500000 };
  /* Tal como la guarda registrarDevolucion con lo que manda el formulario: sin montoArs ni tipoCambio. */
  const dev = devolucion({ id: "d1", ventaId: "v1", monto: 400, fecha: art(2026, 9, 20, 12), procesadorId: "proc_fin" });
  const e = {
    equipo, honorarios: [], ventas: [venta], cuotas, pagos: [cobro], devoluciones: [dev], gastos: [], sesiones: [], liquidaciones: [], traspasos: [],
    ajustes: { monedaBase: "USD", tipoCambio: 1500 }, procesadores: [{ id: "proc_fin", nombre: "Financiera ARS", moneda: "ARS" }],
  } as unknown as EstadoApp;
  const previo = { fecha: art(2026, 9, 1), saldos: [{ procesadorId: "proc_fin", monto: 0, moneda: "ARS", montoBase: 0 }] } as unknown as Parameters<typeof saldosEsperados>[1];
  const cuenta = saldosEsperados(e, previo, art(2026, 9, 30)).get("proc_fin")!;
  assert.equal(cuenta.entro, 1500000 - 50 * 1500, "lo que entró a la Financiera, neto de la comisión");
  assert.ok(cuenta.salio > 0, `se devolvieron US$ 400 por la Financiera y la cuenta dice que salió ${cuenta.salio} pesos`);
  /* La caja total sí la resta: sólo falla el control cuenta por cuenta. */
  assert.equal(cajaEsperada(e, { fecha: art(2026, 9, 1), total: 0 }, art(2026, 9, 30)).devoluciones, 400);
});

test("una devolución en pesos con montoArs (o con tipoCambio) sí resta de su cuenta, en pesos", () => {
  const e = {
    equipo: [], honorarios: [], ventas: [], cuotas: [], pagos: [], gastos: [], sesiones: [], liquidaciones: [], traspasos: [], ajustes: { monedaBase: "USD" },
    devoluciones: [
      devolucion({ id: "a", monto: 100, fecha: art(2026, 9, 20), procesadorId: "proc_fin", montoArs: 150000, tipoCambio: 1500 }),
      devolucion({ id: "b", monto: 10, fecha: art(2026, 9, 21), procesadorId: "proc_fin", tipoCambio: 1400 }),
      devolucion({ id: "c", monto: 7, fecha: art(2026, 9, 22), procesadorId: "proc_fin", estado: "propuesta", tipoCambio: 1400 }),
    ],
    procesadores: [{ id: "proc_fin", nombre: "Financiera ARS", moneda: "ARS" }],
  } as unknown as EstadoApp;
  const s = saldosEsperados(e, { fecha: art(2026, 9, 1), saldos: [{ procesadorId: "proc_fin", monto: 1000000, moneda: "ARS", montoBase: 666 }] } as never, art(2026, 9, 30)).get("proc_fin")!;
  assert.equal(s.salio, 150000 + 14000);
  assert.equal(s.esperado, 1000000 - 164000);
});


/* ---------- Ingresos semanales: el total que se llama Cash Collected ---------- */


test("sin devoluciones, la tabla de ingresos por cuenta y servicio cierra exacto con el Cash Collected del mismo rango, con cobros sin cuenta, sin servicio y huérfanos", () => {
  for (let semilla = 1; semilla <= 80; semilla++) {
    const { e } = mundo(semilla, { ventas: 14, huerfanos: true });
    const sinDev = { ...e, devoluciones: [] } as unknown as EstadoApp;
    for (const periodo of MESES) {
      const m = rangoDePeriodo(periodo);
      const r = ingresosPorCuentaYServicio(sinDev, m);
      assert.ok(cerca(r.total.monto, cashCollected(sinDev, m), 0.005), donde(semilla, periodo, "tabla", r.total.monto, "CC", cashCollected(sinDev, m)));
      /* Filas y columnas suman el total, en centavos enteros. */
      assert.equal(r.cuentas.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos, donde(semilla, periodo, "filas"));
      assert.equal(r.servicios.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos, donde(semilla, periodo, "columnas"));
    }
  }
});

test("BUG: con una devolución en el rango, el «Cash Collected» de Ingresos semanales no es el del Dashboard ni el del estado de resultados", () => {
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(2026, 10, 5), moneda: "USD", productoId: "p1", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 10, 5), extra: {} };
  const e = {
    equipo: [miembro("c1", "Closer", "closer", 0.1)], honorarios: [], ventas: [venta], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 },
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }],
    pagos: [pago("p1", "q1", 1000, 0, art(2026, 10, 6, 10))],
    devoluciones: [devolucion({ id: "d1", ventaId: "v1", monto: 300, fecha: art(2026, 10, 8, 12), procesadorId: "proc_stripe" })],
    productos: [{ id: "p1", nombre: "Mentoría" }], procesadores: [{ id: "proc_stripe", nombre: "Stripe" }],
  } as unknown as EstadoApp;
  const semana = { clave: "s", etiqueta: "s", desde: new Date(2026, 9, 5), hasta: new Date(2026, 9, 11, 23, 59, 59) };
  assert.equal(cashCollected(e, semana), 700, "el Cash Collected de Finanzas ya descuenta lo devuelto");
  assert.equal(ingresosPorCuentaYServicio(e, semana).total.monto, 700, "la tabla de ingresos semanales dice 1.000");
});

/* ---------- Rendimiento por vía del webinar ---------- */


test("sin devoluciones, lo que rinde cada vía de un webinar suma lo que dice el resultado del webinar (ventas, facturado y cobrado)", () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const { e: con } = conEmbudosYWebinars(semilla);
    const e = { ...con, devoluciones: [] } as EstadoApp;
    for (const w of e.webinars) {
      const m = metricasDeWebinar(e, w);
      const v = rendimientoPorVia(e, w).total;
      assert.equal(v.ventas, m.ventas, donde(semilla, w.id, "ventas"));
      assert.ok(cerca(v.facturado, m.facturado, 0.005), donde(semilla, w.id, "facturado"));
      assert.ok(cerca(v.cobrado, m.cobrado, 0.005), donde(semilla, w.id, "cobrado", v.cobrado, m.cobrado));
    }
  }
});

test("BUG: con devoluciones, el «cobrado» por vía del webinar (y el del informe) no descuenta lo devuelto y no suma lo que dice el resultado del webinar", () => {
  /* Un webinar con una venta de US$ 1.000, cobrada entera, de la que se devolvieron 300. */
  const w = { id: "w1", titulo: "W", fecha: art(2026, 9, 15, 19), duracionMin: 90, estado: "finalizado", registrados: 0, asistentes: 0, inversion: 0, formularios: 0, grupoWpp: 0, llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0, llamadasNoCalificadas: 0, llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0, creadoEn: art(2026, 9, 1), extra: {} };
  const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(2026, 9, 16), moneda: "USD", productoId: "p1", closerId: "c1", webinarId: "w1", excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 9, 16), extra: {} };
  const e = {
    equipo: [miembro("c1", "Closer", "closer", 0.1)], honorarios: [], ventas: [venta], gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 },
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pagada", esReserva: false }], pagos: [pago("p1", "q1", 1000, 0, art(2026, 9, 17, 10))],
    devoluciones: [devolucion({ id: "d1", ventaId: "v1", monto: 300, fecha: art(2026, 9, 25, 12) })],
    productos: [], procesadores: [], webinars: [w], adInsights: [], ads: [], campaigns: [], contactos: [], leads: [], embudos: [],
  } as unknown as EstadoApp;
  assert.equal(metricasDeWebinar(e, w as never).cobrado, 700, "el resultado del webinar descuenta lo devuelto");
  assert.equal(rendimientoPorVia(e, w as never).total.cobrado, 700, "el rendimiento por vía dice 1.000");
});

/* ---------- El Dashboard ---------- */


test("el Dashboard dice lo mismo que Finanzas en las filas de plata, mes por mes, con devoluciones y gastos de dos fechas", () => {
  let filas = 0, conDevolucion = 0;
  for (let semilla = 1; semilla <= 60; semilla++) {
    const { e: base } = mundo(semilla, { devoluciones: 8, gastos: 10, huerfanos: semilla % 3 === 0 });
    const e = { ...base, webinars: [], adInsights: [], etapas: [], reportes: [], ads: [], campaigns: [], embudos: [] } as unknown as EstadoApp;
    const defs = catalogo(e);
    const porId = new Map(defs.map((d) => [d.id, d]));
    for (const periodo of MESES) {
      const [a, m] = periodo.split("-").map(Number);
      const corte = { clave: periodo, titulo: periodo, desde: `${periodo}-01`, hasta: `${periodo}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`, foto: true } as Corte;
      const ctx = new Contexto(e, corte);
      const p = calcularPyL(e, rangoDePeriodo(periodo));
      const val = (id: string) => valorEn(porId.get(id)!, ctx) as number;
      const d = (...x: (string | number)[]) => donde(semilla, periodo, ...x);
      const esperado: [string, number][] = [
        ["c_cc", p.cashCollected], ["c_devoluciones", p.devoluciones], ["r_fees", p.feesProcesador], ["r_closers", p.comisionCloser], ["r_director", p.comisionDirector],
        ["r_directos", p.otrosDirectos], ["r_bruto", p.brutoCC], ["r_opex", p.gastosOperativos], ["r_operativo", p.operativoCC], ["r_growth", p.growth],
        ["r_socio", p.socio], ["r_ceo", p.honorariosCeo], ["r_neto_cc", p.netoCC], ["r_neto_rev", p.netoRev],
      ];
      for (const [id, v] of esperado) { assert.ok(cerca(val(id), v, 1e-6), d(id, val(id), "Finanzas", v)); filas++; }
      /* Lo que queda después del reparto. */
      assert.ok(cerca(val("r_queda"), p.netoCC - p.growth - p.socio, 1e-6), d("r_queda"));
      if (p.devoluciones > 0) conDevolucion++;
    }
  }
  assert.ok(filas === 60 * 6 * 14 && conDevolucion > 100, `cobertura: ${filas} filas, ${conDevolucion} meses con devolución`);
});
