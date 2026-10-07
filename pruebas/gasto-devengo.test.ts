import test from "node:test";
import assert from "node:assert/strict";
import { cajaEsperada } from "@/lib/caja";
import {
  alElegirMes, borradorInicial, conOtraFechaDePago, datosDelGasto, mesesParaElegir, pasarAlMes, problemasDelGasto,
  resumenDeFechas, sinOtraFechaDePago, type BorradorGasto,
} from "@/lib/carga-gasto";
import { calcularPyL, gastosDelMes, gastosPagadosEn } from "@/lib/finanzas";
import { fechaDePago, pagadoEnOtroMes, tieneOtraFechaDePago } from "@/lib/gastos";
import { mesCerradoDe, mesesCerrados, primerDiaDe } from "@/lib/mes-cerrado";
import { rangoDePeriodo } from "@/lib/periodos";
import { saldosEsperados } from "@/lib/traspasos";
import type { EstadoApp, Gasto } from "@/lib/types";
import { OCTUBRE, SEPTIEMBRE, estadoDeYari, iso, liquidacionCerrada } from "./estado-devolucion";

/* ==================================================================
   F1-16 · Mes cerrado y gasto por devengo (reunión del 02/10)

   «Un gasto de septiembre que se paga el 2 de octubre tiene que restar en
   septiembre, pero la plata sale de la caja en octubre.»

   Un gasto tiene dos fechas:
     fecha      el mes al que corresponde: el estado de resultados.
     fechaPago  el día que se pagó: la caja y el arqueo.
   Sin fechaPago es la misma, y nada de lo que ya estaba cargado cambia.
   ================================================================== */

const gasto = (g: Partial<Gasto> & Pick<Gasto, "id" | "monto">): Gasto => ({
  categoria: "Contador", grupo: "operativo", concepto: "Contador", moneda: "USD",
  fecha: iso(SEPTIEMBRE, 30, 15), recurrente: false, creadoEn: iso(SEPTIEMBRE, 30, 15), extra: {}, ...g,
});

/* El contador de septiembre: US$ 1.000, se paga el 2 de octubre. */
const CONTADOR = gasto({ id: "g_contador", monto: 1000, fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 2) });

const mes = (p: string) => rangoDePeriodo(p);

test("las dos fechas: sin fecha de pago es el mismo día; con ella, la caja lo cuenta ahí", () => {
  const viejo = gasto({ id: "g_viejo", monto: 50 });
  assert.equal(fechaDePago(viejo), viejo.fecha, "los gastos de siempre no cambian");
  assert.equal(tieneOtraFechaDePago(viejo), false);
  assert.equal(pagadoEnOtroMes(viejo), false);

  assert.equal(fechaDePago(CONTADOR), iso(OCTUBRE, 2));
  assert.equal(tieneOtraFechaDePago(CONTADOR), true);
  assert.equal(pagadoEnOtroMes(CONTADOR), true);

  /* Pagado otro día pero en el mismo mes: son dos fechas, no dos meses. */
  const mismoMes = gasto({ id: "g_m", monto: 50, fecha: iso(SEPTIEMBRE, 10), fechaPago: iso(SEPTIEMBRE, 25) });
  assert.equal(tieneOtraFechaDePago(mismoMes), true);
  assert.equal(pagadoEnOtroMes(mismoMes), false);

  /* Una fecha de pago igual a la del gasto no dice nada. */
  assert.equal(tieneOtraFechaDePago(gasto({ id: "g_i", monto: 1, fechaPago: iso(SEPTIEMBRE, 30) })), false);
});

test("el estado de resultados lo ve en septiembre y la caja en octubre", () => {
  const e = estadoDeYari({ gastos: [CONTADOR] });

  /* Estado de resultados: el mes al que corresponde. */
  assert.deepEqual(gastosDelMes(e, mes(SEPTIEMBRE)).map((g) => g.id), ["g_contador"]);
  assert.deepEqual(gastosDelMes(e, mes(OCTUBRE)).map((g) => g.id), []);
  assert.equal(calcularPyL(e, mes(SEPTIEMBRE)).gastosOperativos, 1000, "septiembre lleva el gasto");
  assert.equal(calcularPyL(e, mes(OCTUBRE)).gastosOperativos, 0, "octubre no");

  /* Caja: el día que se pagó. */
  assert.deepEqual(gastosPagadosEn(e, mes(SEPTIEMBRE)).map((g) => g.id), []);
  assert.deepEqual(gastosPagadosEn(e, mes(OCTUBRE)).map((g) => g.id), ["g_contador"]);

  /* Un arqueo el 29/09 con US$ 5.000 contados. Hasta el 30/09 el gasto todavía
     no salió; hasta el 31/10, sí, junto con el cobro del 01/10 (1.500, fee 45
     y comisiones de 291: 15% + 5% de 1.455). */
  const arqueo = { fecha: iso(SEPTIEMBRE, 29, 20), total: 5000 };
  const hastaSeptiembre = cajaEsperada(e, arqueo, iso(SEPTIEMBRE, 30, 23));
  assert.equal(hastaSeptiembre.gastos, 0, "el 30/09 el contador todavía no se pagó");
  assert.equal(hastaSeptiembre.esperado, 5000);

  const hastaOctubre = cajaEsperada(e, arqueo, iso(OCTUBRE, 31, 23));
  assert.equal(hastaOctubre.gastos, 1000, "en octubre sale de la caja");
  assert.equal(hastaOctubre.cobrado, 1500);
  assert.equal(hastaOctubre.procesador, 45);
  assert.equal(hastaOctubre.comisiones, 291);
  /* 5.000 + 1.500 − 45 − 291 − 1.000 */
  assert.equal(hastaOctubre.esperado, 5164);
});

test("la plata no se cuenta dos veces ni se pierde: el gasto pasa una vez por el estado de resultados y una por la caja", () => {
  const e = estadoDeYari({ gastos: [CONTADOR] });
  const resultadosTotal = [SEPTIEMBRE, OCTUBRE].reduce((a, p) => a + calcularPyL(e, mes(p)).gastosOperativos, 0);
  assert.equal(resultadosTotal, 1000);

  /* Dos ventanas de caja seguidas: se cuenta en la que cae el día que se pagó. */
  const cortes = ["2026-08-31T23:00:00.000Z", "2026-09-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"];
  let cajaTotal = 0;
  for (let i = 1; i < cortes.length; i++) {
    cajaTotal += cajaEsperada(e, { fecha: cortes[i - 1], total: 0 }, cortes[i]).gastos;
  }
  assert.equal(cajaTotal, 1000);
});

test("sin fecha de pago la caja da lo mismo que antes: lo que sumaba el estado de resultados", () => {
  /* Gastos de todos los bloques, ninguno con fecha de pago: la caja los cuenta
     donde los contaba el estado de resultados, ventana por ventana. */
  const gastos: Gasto[] = [
    gasto({ id: "a", monto: 120.5, grupo: "directo", fecha: iso(SEPTIEMBRE, 3) }),
    gasto({ id: "b", monto: 310, grupo: "operativo", fecha: iso(SEPTIEMBRE, 15) }),
    gasto({ id: "c", monto: 2000, grupo: "dueno", fecha: iso(SEPTIEMBRE, 28) }),
    gasto({ id: "d", monto: 500, grupo: "retiro", fecha: iso(SEPTIEMBRE, 29) }),
    gasto({ id: "e", monto: 80, grupo: "operativo", fecha: iso(OCTUBRE, 1) }),
    gasto({ id: "f", monto: 40, grupo: "directo", fecha: iso(OCTUBRE, 6) }),
    gasto({ id: "g", monto: 999, grupo: "retiro", fecha: iso(OCTUBRE, 7) }),
  ];
  const e = estadoDeYari({ gastos });
  for (const [desde, hasta] of [
    ["2026-08-31T00:00:00.000Z", "2026-09-30T23:00:00.000Z"],
    ["2026-09-14T00:00:00.000Z", "2026-10-06T12:00:00.000Z"],
    ["2026-09-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"],
  ]) {
    const mov = cajaEsperada(e, { fecha: desde, total: 0 }, hasta);
    const rango = { clave: "x", etiqueta: "x", desde: new Date(Date.parse(desde) + 1), hasta: new Date(hasta) };
    const p = calcularPyL(e, rango);
    assert.equal(mov.gastos, Math.round((p.otrosDirectos + p.gastosOperativos + p.honorariosCeo) * 100) / 100, `${desde} → ${hasta}`);
    assert.equal(mov.retiros, gastosDelMes(e, rango, "retiro").reduce((a, g) => a + g.monto, 0));
  }
});

test("los retiros salen de la caja el día que se pagaron, no el del mes al que corresponden", () => {
  const retiro = gasto({
    id: "r1", monto: 700, grupo: "retiro", categoria: "Retiro de beneficios", concepto: "Retiro",
    fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 3),
  });
  const e = estadoDeYari({ gastos: [retiro] });
  assert.equal(cajaEsperada(e, { fecha: iso(SEPTIEMBRE, 29, 20), total: 0 }, iso(SEPTIEMBRE, 30, 23)).retiros, 0);
  assert.equal(cajaEsperada(e, { fecha: iso(SEPTIEMBRE, 29, 20), total: 0 }, iso(OCTUBRE, 31, 23)).retiros, 700);
});

test("lo que tendría que haber en la cuenta usa el día que se pagó", () => {
  const delContador = gasto({ ...CONTADOR, extra: { cuentaId: "proc_stripe" } });
  const e = estadoDeYari({ gastos: [delContador] });
  const previo = { fecha: iso(SEPTIEMBRE, 29, 20), saldos: [{ procesadorId: "proc_stripe", monto: 4000 }] } as unknown as Parameters<typeof saldosEsperados>[1];

  const hastaSeptiembre = saldosEsperados(e, previo, iso(SEPTIEMBRE, 30, 23)).get("proc_stripe");
  assert.equal(hastaSeptiembre?.salio, 0, "el 30/09 todavía no salió");
  const hastaOctubre = saldosEsperados(e, previo, iso(OCTUBRE, 31, 23)).get("proc_stripe");
  assert.equal(hastaOctubre?.salio, 1000);
  /* 4.000 + el cobro del 01/10 neto de la comisión (1.455) − 1.000 */
  assert.equal(hastaOctubre?.esperado, 4455);
});

/* ---------- El asistente de carga ---------- */

const AJUSTES = { monedaBase: "USD" as const, tipoCambio: 1500 };
const HOY = new Date(2026, 9, 7);
const completo = (c: Partial<BorradorGasto> = {}): BorradorGasto => ({
  ...borradorInicial(AJUSTES, null, HOY),
  concepto: "Contador de septiembre", categoria: "Contador", proveedor: "Estudio Ríos", monto: "1.000", ...c,
});
const guardar = (b: BorradorGasto, previo?: Gasto) =>
  datosDelGasto(b, { base: "USD", previo, opciones: [], ahora: "2026-10-07T15:00:00.000Z" });

test("un gasto nuevo arranca con una sola fecha y no guarda fecha de pago", () => {
  const b = completo();
  assert.equal(b.fechaPago, "", "por defecto es la misma");
  const datos = guardar(b);
  assert.equal(datos.fecha, b.fecha);
  assert.equal(datos.fechaPago, undefined, "no se agrega un dato que no dice nada");
  assert.equal(fechaDePago(datos), datos.fecha);
});

test("un gasto de septiembre pagado en octubre guarda las dos fechas", () => {
  const b = completo({ fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 2) });
  const datos = guardar(b);
  assert.equal(datos.fecha, iso(SEPTIEMBRE, 30));
  assert.equal(datos.fechaPago, iso(OCTUBRE, 2));
  assert.equal(datos.monto, 1000);
  /* La fecha de pago el mismo día que el mes al que corresponde no se guarda. */
  assert.equal(guardar(completo({ fecha: iso(OCTUBRE, 2), fechaPago: iso(OCTUBRE, 2) })).fechaPago, undefined);
});

test("al editar, el borrador trae las dos fechas y volver a una sola borra la de pago", () => {
  const previo = gasto({ id: "g1", monto: 1000, fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 2) });
  const b = borradorInicial(AJUSTES, previo, HOY);
  assert.equal(b.fecha, iso(SEPTIEMBRE, 30));
  assert.equal(b.fechaPago, iso(OCTUBRE, 2));
  assert.equal(guardar(b, previo).fechaPago, iso(OCTUBRE, 2), "guardar sin tocar no la pierde");

  /* Volver a una sola fecha: vale el día que se pagó. Y viaja como null para
     que la base se olvide de la vieja (la cola saca los undefined). */
  const una = { ...b, ...sinOtraFechaDePago(b) };
  assert.equal(una.fecha, iso(OCTUBRE, 2));
  assert.equal(una.fechaPago, "");
  assert.equal(guardar(una, previo).fechaPago, null);

  /* Un gasto de siempre se abre con una sola fecha. */
  const viejo = gasto({ id: "g2", monto: 10 });
  assert.equal(borradorInicial(AJUSTES, viejo, HOY).fechaPago, "");
  assert.equal(guardar(borradorInicial(AJUSTES, viejo, HOY), viejo).fechaPago, undefined, "no hay nada que borrar");
});

test("abrir las dos fechas deja la plata donde estaba y se corre el mes", () => {
  const hoy = completo({ fecha: iso(OCTUBRE, 7) });
  const abierto = { ...hoy, ...conOtraFechaDePago(hoy) };
  assert.equal(abierto.fechaPago, iso(OCTUBRE, 7), "se pagó hoy");

  /* El gasto es de septiembre: va al 1° de septiembre y no se mueve la plata. */
  const deSeptiembre = { ...abierto, ...alElegirMes(abierto, SEPTIEMBRE) };
  assert.equal(deSeptiembre.fecha, primerDiaDe(SEPTIEMBRE));
  assert.equal(deSeptiembre.fechaPago, iso(OCTUBRE, 7));
  const datos = guardar(deSeptiembre);
  assert.equal(datos.fecha, primerDiaDe(SEPTIEMBRE));
  assert.equal(datos.fechaPago, iso(OCTUBRE, 7));

  /* Elegir el mes en el que ya está no lo mueve de día. */
  assert.equal(alElegirMes({ fecha: iso(OCTUBRE, 7) }, OCTUBRE).fecha, iso(OCTUBRE, 7));
});

test("pasar un gasto al mes abierto mueve el mes al que corresponde y no la plata", () => {
  /* Una sola fecha (30/09): al pasarlo a octubre, se pagó igual el 30/09. */
  const una = pasarAlMes({ fecha: iso(SEPTIEMBRE, 30), fechaPago: "" }, primerDiaDe(OCTUBRE));
  assert.equal(una.fecha, primerDiaDe(OCTUBRE));
  assert.equal(una.fechaPago, iso(SEPTIEMBRE, 30));
  /* Con las dos ya abiertas, la de pago no se toca. */
  const dos = pasarAlMes({ fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 2) }, primerDiaDe(OCTUBRE));
  assert.equal(dos.fechaPago, iso(OCTUBRE, 2));

  /* Y en el estado de resultados: sale de septiembre y entra en octubre. */
  const e = estadoDeYari({ gastos: [gasto({ id: "gp", monto: 1000, ...una })] });
  assert.equal(calcularPyL(e, mes(SEPTIEMBRE)).gastosOperativos, 0);
  assert.equal(calcularPyL(e, mes(OCTUBRE)).gastosOperativos, 1000);
});

test("la fecha de pago tiene que ser una fecha", () => {
  assert.equal(problemasDelGasto(completo(), "USD").fechaPago, undefined);
  assert.equal(problemasDelGasto(completo({ fechaPago: iso(OCTUBRE, 2) }), "USD").fechaPago, undefined);
  assert.ok(problemasDelGasto(completo({ fechaPago: "mañana" }), "USD").fechaPago);
});

test("los meses para elegir: el último año, los dos que vienen y el del propio gasto", () => {
  const lista = mesesParaElegir(iso(OCTUBRE, 7), HOY);
  assert.equal(lista[0].valor, "2026-12", "un anticipo, hasta dos meses adelante");
  assert.equal(lista[0].texto, "diciembre 2026");
  assert.equal(lista.at(-1)?.valor, "2025-10");
  assert.equal(lista.length, 15);
  /* Un gasto viejo que se edita tiene que seguir viendo su mes. */
  assert.ok(mesesParaElegir(iso("2024-03", 5), HOY).some((m) => m.valor === "2024-03"));
});

test("la línea de las dos fechas dice qué mes y qué día", () => {
  assert.equal(
    resumenDeFechas({ fecha: iso(SEPTIEMBRE, 30), fechaPago: iso(OCTUBRE, 2), grupo: "operativo" }),
    "Resta del estado de resultados de septiembre 2026 y sale de la caja el 2 oct 2026.",
  );
  assert.equal(
    resumenDeFechas({ fecha: iso(OCTUBRE, 7), fechaPago: "", grupo: "operativo" }),
    "Resta del estado de resultados de octubre 2026 y sale de la caja el 7 oct 2026.",
  );
  assert.equal(
    resumenDeFechas({ fecha: iso(OCTUBRE, 7), fechaPago: "", grupo: "retiro" }),
    "No resta del estado de resultados: sale de la caja el 7 oct 2026.",
  );
});

/* ---------- Mes cerrado ---------- */

test("un mes está cerrado si su liquidación se cerró", () => {
  const sin = estadoDeYari();
  assert.equal(mesCerradoDe(sin, iso(SEPTIEMBRE, 30)), null, "sin liquidaciones cerradas no hay aviso");

  const e = estadoDeYari({ liquidaciones: [liquidacionCerrada(SEPTIEMBRE, undefined as never)] });
  assert.deepEqual([...mesesCerrados(e)], [SEPTIEMBRE]);
  const c = mesCerradoDe(e, iso(SEPTIEMBRE, 30));
  assert.equal(c?.periodo, SEPTIEMBRE);
  assert.equal(c?.nombre, "septiembre 2026");
  assert.equal(c?.siguiente, OCTUBRE, "lo que llega tarde entra en el primer mes abierto");
  assert.equal(c?.nombreSiguiente, "octubre 2026");
  assert.equal(mesCerradoDe(e, iso(OCTUBRE, 2)), null, "octubre sigue abierto");
  assert.equal(mesCerradoDe(e, "no es una fecha"), null);
  assert.equal(mesCerradoDe(e, undefined), null);
});

test("una liquidación abierta o reabierta no cierra el mes", () => {
  const abierta = { ...liquidacionCerrada(SEPTIEMBRE, undefined as never), estado: "abierta" as const };
  assert.equal(mesCerradoDe(estadoDeYari({ liquidaciones: [abierta] }), iso(SEPTIEMBRE, 30)), null);
});

test("el siguiente mes abierto salta los que también están cerrados", () => {
  const e = estadoDeYari({
    liquidaciones: [liquidacionCerrada("2026-08", undefined as never), liquidacionCerrada(SEPTIEMBRE, undefined as never)],
  });
  assert.equal(mesCerradoDe(e, iso("2026-08", 15))?.siguiente, OCTUBRE);
  /* Pasar a diciembre → enero: el cambio de año no se rompe. */
  const fin = estadoDeYari({ liquidaciones: [liquidacionCerrada("2026-12", undefined as never)] });
  assert.equal(mesCerradoDe(fin, iso("2026-12", 20))?.siguiente, "2027-01");
});

test("quien no ve las liquidaciones igual sabe qué mes se cerró: lo dicen los sueldos que entraron a Finanzas", () => {
  /* Administración carga gastos y devoluciones pero las liquidaciones son de los
     dueños: al cerrar, los sueldos entran a Finanzas con la liquidación que los
     cargó, y eso sí lo ve. */
  const sueldos = gasto({ id: "gas_liq_2026-09_sueldos_usd", monto: 4000, extra: { liquidacionId: "liq_2026-09" } });
  const e = estadoDeYari({ liquidaciones: [], gastos: [sueldos] });
  assert.equal(mesCerradoDe(e, iso(SEPTIEMBRE, 15))?.periodo, SEPTIEMBRE);
  assert.equal(mesCerradoDe(e, iso(OCTUBRE, 15)), null);
});

test("el primer día de un mes cae en ese mes con cualquier huso", () => {
  for (const p of ["2026-01", "2026-09", "2026-10", "2026-12"]) {
    const d = new Date(primerDiaDe(p));
    assert.equal(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, p);
    assert.equal(d.getDate(), 1);
  }
});

/* Una pasada de azar: sea cual sea la mezcla de fechas, lo que suma el estado
   de resultados no depende de la fecha de pago, y lo que suma la caja no depende
   del mes al que corresponde. */
test("el azar: cambiar una fecha no toca la otra cuenta", () => {
  let semilla = 7;
  const rnd = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  const dia = () => iso(rnd() < 0.5 ? SEPTIEMBRE : OCTUBRE, 1 + Math.floor(rnd() * 27));
  const GRUPOS: Gasto["grupo"][] = ["directo", "operativo", "dueno", "retiro"];
  for (let vuelta = 0; vuelta < 40; vuelta++) {
    const gastos: Gasto[] = Array.from({ length: 6 }, (_, i) => gasto({
      id: `g${vuelta}_${i}`, monto: Math.round(rnd() * 100000) / 100, grupo: GRUPOS[Math.floor(rnd() * 4)],
      fecha: dia(), ...(rnd() < 0.5 ? { fechaPago: dia() } : {}),
    }));
    const e: EstadoApp = estadoDeYari({ gastos });
    const sinPago = estadoDeYari({ gastos: gastos.map(({ fechaPago: _x, ...g }) => g as Gasto) });
    const sinDevengo = estadoDeYari({ gastos: gastos.map((g) => ({ ...g, fecha: fechaDePago(g) })) });
    for (const p of [SEPTIEMBRE, OCTUBRE]) {
      /* El estado de resultados es el mismo con o sin fecha de pago. */
      assert.deepEqual(calcularPyL(e, mes(p)), calcularPyL(sinPago, mes(p)), `P&L ${p} vuelta ${vuelta}`);
    }
    const ventana = { fecha: "2026-09-10T00:00:00.000Z", total: 0 };
    for (const hasta of ["2026-09-30T23:00:00.000Z", "2026-10-31T23:00:00.000Z"]) {
      /* La caja es la misma sea cual sea el mes al que corresponde. */
      const a = cajaEsperada(e, ventana, hasta);
      const b = cajaEsperada(sinDevengo, ventana, hasta);
      assert.equal(a.gastos, b.gastos, `caja ${hasta} vuelta ${vuelta}`);
      assert.equal(a.retiros, b.retiros);
    }
  }
});
