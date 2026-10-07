import test from "node:test";
import assert from "node:assert/strict";
import {
  atrasoDe, conStrike, descuentaPorCierre, descuentoDesde, diaSinCierreDe, pideCierre, queFalloEnElDia, reglaDeCierre, strikesDe,
  ventasSinCierre,
} from "@/lib/cierre-del-dia";
import { calcularPyL, comisionesDelMes, comisionesPorCloser } from "@/lib/finanzas";
import { calcularLiquidacion, liquidacionVacia, rangoDePeriodo, renglonDe } from "@/lib/honorarios";
import { metricasDeWebinar } from "@/lib/webinar";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import { construirSemilla } from "@/lib/seed";
import type {
  ConfigCierreDelDia, EstadoApp, MiembroEquipo, Pago, ResultadoLiquidacion, Sesion, Venta, Webinar,
} from "@/lib/types";
import { concepto, dia, esquema, estadoDePrueba, miembro, pago, PERIODO, venta } from "./estado-liquidacion";

/* ==================================================================
   El cierre del día: strikes y el interruptor del descuento (F2-02).

   Lo que se prueba:
   - cómo se cuenta un strike (un día con alguna llamada cargada otro día o sin
     cargar), y qué llamadas no piden cierre;
   - que con el interruptor apagado NO cambia ningún número en ningún lado:
     Finanzas, la liquidación y el resultado del webinar dan exactamente lo
     mismo con y sin la configuración;
   - que prendido, los tres lugares que repiten la comisión por cobro dicen lo
     mismo (con las cuentas hechas a mano y en 200 escenarios al azar) y que la
     liquidación lo muestra como un renglón aparte, con su cuenta que cierra.
   ================================================================== */

const TIPO = "Llamada de Asesoramiento - Webinar - Team";
const HOY = "2026-09-30";

const llamada = (id: string, anfitrion: string, diaMes: number, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: TIPO, tipo: TIPO, invitado: `Invitado ${id}`, inicia: dia(diaMes, 15), duracionMin: 45, estado: "hecha",
  origen: "calendly", creadoEn: dia(Math.max(1, diaMes - 1), 12), extra: {}, anfitrion, ...extra,
}) as Sesion;

const webinar = (id: string): Webinar => ({
  id, titulo: id, fecha: dia(1, 22), duracionMin: 75, estado: "finalizado", registrados: 0, asistentes: 0, inversion: 0, formularios: 0,
  grupoWpp: 0, llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0, llamadasNoCalificadas: 0,
  llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0, creadoEn: dia(1), extra: {},
}) as Webinar;

/* Septiembre de estado-liquidacion.ts, con las llamadas de las que salieron las ventas:
     v1 de Mariano (cal_v1: se cargó al otro día → el 3 es un día con strike)
     v2 de Mariano (cal_v2: el 8 se cerró a tiempo)
     v4 de Dante   (cal_v4: el 12 se cerró a tiempo; el 15 se cargó tarde, pero ninguna venta salió de ese día)
   v1 y v2 son del webinar w1; v4, de w2. */
function escenario(cierre?: ConfigCierreDelDia, cambios: (e: EstadoApp) => EstadoApp = (e) => e): EstadoApp {
  const base = estadoDePrueba();
  const sesiones = [
    ...base.sesiones,
    llamada("cal_v1", "Mariano Arias", 3, { estadoLlamada: "Compra Cuotas", estadoLlamadaEn: dia(4, 18) }),
    llamada("cal_m2", "Mariano Arias", 3, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: dia(3, 23) }),
    llamada("cal_v2", "Mariano Arias", 8, { estadoLlamada: "Compra Downsell", estadoLlamadaEn: dia(8, 22) }),
    llamada("cal_noshow", "Mariano Arias", 9, { estado: "no-show" }),
    llamada("cal_cancel", "Mariano Arias", 10, { estado: "cancelada" }),
    llamada("cal_v4", "Dante Barbieri", 12, { estadoLlamada: "Compra Full", estadoLlamadaEn: dia(12, 21) }),
    llamada("cal_d2", "Dante Barbieri", 15, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: dia(16, 15) }),
  ];
  const enlace: Record<string, Partial<Venta>> = {
    v1: { sesionId: "cal_v1", webinarId: "w1" }, v2: { sesionId: "cal_v2", webinarId: "w1" }, v4: { sesionId: "cal_v4", webinarId: "w2" },
  };
  return cambios({
    ...base, sesiones, webinars: [webinar("w1"), webinar("w2")],
    ventas: base.ventas.map((v) => ({ ...v, ...(enlace[v.id] ?? {}) })),
    ajustes: { ...base.ajustes, ...(cierre ? { crm: { cierreDelDia: cierre } } : {}) },
  } as EstadoApp);
}

const PRENDIDO: ConfigCierreDelDia = { cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-09-01" };
const rango = rangoDePeriodo(PERIODO);
const r2 = (n: number) => Math.round(n * 100) / 100;

/* Todo lo que repite la comisión, de una vez: Finanzas, la liquidación y el webinar. */
function fotos(e: EstadoApp) {
  const liq = calcularLiquidacion(e, PERIODO, liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z"));
  const { calculadoEn: _quitar, ...liquidacion } = liq;
  void _quitar;
  return {
    comisiones: comisionesDelMes(e, rango), pyl: calcularPyL(e, rango), porCloser: comisionesPorCloser(e, rango),
    liquidacion, webinars: e.webinars.map((w) => metricasDeWebinar(e, w)),
  };
}

const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string) => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta ${miembroId}:${clave}`);
  return x.linea;
};
const calcular = (e: EstadoApp) => calcularLiquidacion(e, PERIODO, liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z"));

/* ---------- La regla de Ajustes ---------- */

test("sin configurar, el descuento está apagado y los strikes no cuentan", () => {
  const r = reglaDeCierre({ crm: undefined });
  assert.deepEqual(r, { cuentaDesde: undefined, descuenta: false, descuentaDesde: undefined });
  assert.equal(descuentoDesde(r), undefined);
  assert.deepEqual(reglaDeCierre(undefined), r);
});

test("el descuento rige desde el más tarde de los dos días, y sólo si está prendido y hay fecha de arranque", () => {
  assert.equal(descuentoDesde({ descuenta: true }), undefined, "sin fecha de arranque no hay qué contar");
  assert.equal(descuentoDesde({ cuentaDesde: "2026-09-01", descuenta: false, descuentaDesde: "2026-09-10" }), undefined);
  assert.equal(descuentoDesde({ cuentaDesde: "2026-09-01", descuenta: true }), "2026-09-01");
  assert.equal(descuentoDesde({ cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-09-10" }), "2026-09-10");
  assert.equal(descuentoDesde({ cuentaDesde: "2026-09-20", descuenta: true, descuentaDesde: "2026-09-10" }), "2026-09-20");
  /* Una fecha mal escrita no cuenta. */
  assert.equal(reglaDeCierre({ crm: { cierreDelDia: { cuentaDesde: "ayer", descuenta: true } } }).cuentaDesde, undefined);
});

/* ---------- Qué llamadas piden cierre y cuándo se atrasan ---------- */

test("una llamada de venta pide cierre salvo que se haya cancelado, no haya venido o haya pedido otra fecha", () => {
  const s = (c: Partial<Sesion>) => ({ estado: "hecha", inicia: dia(3, 15), ...c }) as Sesion;
  assert.equal(pideCierre(s({}), HOY), true);
  assert.equal(pideCierre(s({ estado: "cancelada" }), HOY), false);
  assert.equal(pideCierre(s({ estado: "no-show" }), HOY), false, "lo avisó Calendly: se pone solo");
  /* Si el closer la cargó (aunque sea «Dejó de Contestar», que también la deja como que no vino), cuenta: no se escapa de un strike marcándola tarde. */
  assert.equal(pideCierre(s({ estado: "no-show", estadoLlamada: "Dejó de Contestar" }), HOY), true);
  assert.equal(pideCierre(s({ estado: "cancelada", estadoLlamada: "Compra Full" }), HOY), false, "una cancelada no pide nada");
  assert.equal(pideCierre(s({ estadoPreCall: "Reagendar" }), HOY), false, "pidió otra fecha: la agenda nueva entra sola");
  assert.equal(pideCierre(s({ estadoPreCall: "Reagendar", estadoLlamada: "Seguimiento Nutrición" }), HOY), true, "si igual la cargó, cuenta");
  assert.equal(pideCierre(s({ resultado: "compro" }), HOY), false, "las del cierre de antes de que los estados fueran uno");
  assert.equal(pideCierre(s({ inicia: dia(30, 20) }), "2026-09-29"), false, "todavía no llegó su día");
});

test("atrasoDe: cargada otro día es tarde; sin cargar con el día pasado, sin cargar; el resto, bien", () => {
  const d = "2026-09-03";
  assert.equal(atrasoDe({ estadoLlamada: "Compra Full", estadoLlamadaEn: dia(3, 23) }, d, HOY), null, "20 hs de Argentina: el mismo día");
  assert.equal(atrasoDe({ estadoLlamada: "Compra Full", estadoLlamadaEn: dia(4, 2) }, d, HOY), null, "23 hs del 3 en Argentina: sigue siendo el mismo día");
  assert.equal(atrasoDe({ estadoLlamada: "Compra Full", estadoLlamadaEn: dia(4, 3) }, d, HOY), "tarde", "00 hs del 4 en Argentina");
  assert.equal(atrasoDe({ estadoLlamada: "Compra Full" }, d, HOY), null, "cargada sin marca (de antes): no se puede juzgar");
  assert.equal(atrasoDe({}, d, HOY), "sin-cargar");
  assert.equal(atrasoDe({}, "2026-09-30", HOY), null, "hoy todavía no terminó");
  /* Sin estado pero con la venta cargada (la cargó Administración, que no edita las llamadas): cuenta cuándo se cargó la venta. */
  assert.equal(atrasoDe({}, d, HOY, dia(3, 23)), null, "la venta del mismo día");
  assert.equal(atrasoDe({}, d, HOY, dia(5, 15)), "tarde", "la venta de dos días después");
});

/* ---------- Los strikes ---------- */

test("los strikes de un closer: los días en que alguna llamada se cargó otro día o no se cargó", () => {
  const e = escenario({ cuentaDesde: "2026-09-01" });
  const m = strikesDe(e, "Mariano Arias", HOY);
  assert.equal(m.total, 1);
  assert.deepEqual(m.dias, [{ dia: "2026-09-03", llamadas: 2, tarde: 1, sinCargar: 0 }]);
  /* Contó el 3 y el 8: la que no vino y la cancelada no piden cierre. */
  assert.equal(m.diasContados, 2);
  assert.equal(queFalloEnElDia(m.dias[0]), "1 llamada cargada después");

  const d = strikesDe(e, "Dante Barbieri", HOY);
  assert.deepEqual(d.dias.map((x) => x.dia), ["2026-09-15"]);
  assert.equal(d.total, 1);
});

test("una llamada que pasó y no se cargó es un strike; las anteriores a la fecha de arranque no cuentan", () => {
  const e = escenario({ cuentaDesde: "2026-09-05" }, (x) => ({
    ...x, sesiones: [...x.sesiones, llamada("cal_sin", "Mariano Arias", 20), llamada("cal_sin2", "Mariano Arias", 20), llamada("cal_hoy", "Mariano Arias", 30)],
  }));
  const m = strikesDe(e, "Mariano Arias", HOY);
  /* El 3 es anterior al arranque. El 8 estuvo bien. El 20 tiene dos sin cargar. El 30 es hoy. */
  assert.deepEqual(m.dias, [{ dia: "2026-09-20", llamadas: 2, tarde: 0, sinCargar: 2 }]);
  assert.equal(queFalloEnElDia(m.dias[0]), "2 llamadas sin cargar");
  assert.equal(strikesDe(e, "Mariano Arias", "2026-10-01").total, 2, "pasado el 30, el día de hoy también quedó sin cargar");
});

test("marcar tarde una llamada como «Dejó de Contestar» no borra el strike: es un estado cargado otro día", () => {
  const e = escenario({ cuentaDesde: "2026-09-01" }, (x) => ({
    ...x, sesiones: [
      ...x.sesiones,
      /* La llamada del 20: el closer la marcó «Dejó de Contestar» (la agenda pasó a «no vino») recién el 21. */
      llamada("cal_dc", "Mariano Arias", 20, { estado: "no-show", estadoLlamada: "Dejó de Contestar", estadoLlamadaEn: dia(21, 15) }),
      /* La del 22 la marcó Calendly como que no vino y nadie cargó nada: no pide cierre. */
      llamada("cal_cal", "Mariano Arias", 22, { estado: "no-show" }),
    ],
  }));
  const m = strikesDe(e, "Mariano Arias", HOY);
  assert.deepEqual(m.dias.map((d) => [d.dia, d.tarde, d.sinCargar]), [["2026-09-20", 1, 0], ["2026-09-03", 1, 0]]);
});

test("una llamada sin estado pero con su venta (la cargó alguien que no edita las llamadas) cuenta cuándo se cargó la venta, no «sin cargar»", () => {
  const conVenta = (creadoEn: string) => escenario({ cuentaDesde: "2026-09-01" }, (x) => ({
    ...x,
    sesiones: [...x.sesiones, llamada("cal_adm", "Mariano Arias", 20)],
    ventas: [...x.ventas, venta({ id: "v_adm", contactoNombre: "Cargada por Administración", precioAcordado: 900, fecha: dia(20), closerId: "mariano", sesionId: "cal_adm", creadoEn })],
  }));
  /* La venta se cargó el mismo día: el día se cerró a tiempo. */
  assert.deepEqual(strikesDe(conVenta(dia(20, 22)), "Mariano Arias", HOY).dias.map((d) => d.dia), ["2026-09-03"]);
  /* Dos días después: el 20 es un día con strike, cargado tarde. */
  const tarde = strikesDe(conVenta(dia(22, 15)), "Mariano Arias", HOY);
  assert.deepEqual(tarde.dias.map((d) => [d.dia, d.tarde, d.sinCargar]), [["2026-09-20", 1, 0], ["2026-09-03", 1, 0]]);
  /* Y sin la venta, es una llamada sin cargar. */
  const sinVenta = escenario({ cuentaDesde: "2026-09-01" }, (x) => ({ ...x, sesiones: [...x.sesiones, llamada("cal_adm", "Mariano Arias", 20)] }));
  assert.deepEqual(strikesDe(sinVenta, "Mariano Arias", HOY).dias.map((d) => [d.dia, d.tarde, d.sinCargar]), [["2026-09-20", 0, 1], ["2026-09-03", 1, 0]]);
});

test("sin fecha de arranque todavía no se cuentan strikes, y cada closer cuenta los suyos", () => {
  assert.deepEqual(strikesDe(escenario(), "Mariano Arias", HOY), { cuentaDesde: undefined, dias: [], total: 0, diasContados: 0 });
  assert.equal(strikesDe(escenario({ cuentaDesde: "2026-09-01" }), "Nadie", HOY).total, 0);
  assert.ok(conStrike({ tarde: 0, sinCargar: 1 }) && !conStrike({ tarde: 0, sinCargar: 0 }));
});

/* ---------- Qué ventas se descuentan ---------- */

test("apagado, ninguna venta se descuenta, aunque haya días con strike", () => {
  for (const c of [undefined, { cuentaDesde: "2026-09-01" }, { cuentaDesde: "2026-09-01", descuenta: false, descuentaDesde: "2026-09-01" }, { descuenta: true }]) {
    assert.equal(ventasSinCierre(escenario(c)).size, 0, JSON.stringify(c));
  }
});

test("prendido, se descuenta la venta de una llamada de un día con strike y nada más", () => {
  const e = escenario(PRENDIDO);
  assert.deepEqual([...ventasSinCierre(e)], ["v1"]);
  /* La venta del 8 (a tiempo) y la del 12 (a tiempo) siguen comisionando; la de Yari y las demás, sin llamada atada, no entran. */
  assert.equal(diaSinCierreDe(e, { sesionId: "cal_v1" }), "2026-09-03");
  assert.equal(diaSinCierreDe(e, { sesionId: "cal_v2" }), undefined);
  assert.equal(diaSinCierreDe(e, {}), undefined);

  /* Rige desde el día en que se prendió: lo de antes no se toca. */
  assert.equal(ventasSinCierre(escenario({ ...PRENDIDO, descuentaDesde: "2026-09-04" })).size, 0);
  assert.equal(ventasSinCierre(escenario({ ...PRENDIDO, descuentaDesde: "2026-09-03" })).size, 1);

  /* Una venta cancelada no se descuenta, y una sin la llamada atada tampoco. */
  const sinEnlace = escenario(PRENDIDO, (x) => ({ ...x, ventas: x.ventas.map((v) => (v.id === "v1" ? { ...v, sesionId: undefined } : v)) }));
  assert.equal(ventasSinCierre(sinEnlace).size, 0, "las ventas de antes, sin llamada atada, no se pueden probar");
  const cancelada = escenario(PRENDIDO, (x) => ({ ...x, ventas: x.ventas.map((v) => (v.id === "v1" ? { ...v, estado: "cancelada" as const } : v)) }));
  assert.equal(ventasSinCierre(cancelada).size, 0);
});

test("el descuento es de quien cerró la venta: si otro closer heredó las cuotas, lo suyo no se toca", () => {
  const sin = new Set(["v1"]);
  assert.equal(descuentaPorCierre(sin, { id: "v1", closerId: "mariano" }, "mariano"), true);
  assert.equal(descuentaPorCierre(sin, { id: "v1", closerId: "mariano" }, "dante"), false, "lo que cobra el que heredó las cuotas");
  assert.equal(descuentaPorCierre(sin, { id: "v1", closerId: "mariano" }, undefined), false);
  assert.equal(descuentaPorCierre(sin, { id: "v2", closerId: "mariano" }, "mariano"), false);
  assert.equal(descuentaPorCierre(new Set(), { id: "v1", closerId: "mariano" }, "mariano"), false);
});

/* ---------- Apagado, nada cambia en ningún lado ---------- */

test("con el interruptor apagado, Finanzas, la liquidación y el webinar dan EXACTAMENTE lo mismo que sin la configuración", () => {
  const antes = fotos(escenario());
  const apagados: (ConfigCierreDelDia | undefined)[] = [
    { cuentaDesde: "2026-09-01" },                                                    // los strikes se cuentan, el descuento no
    { cuentaDesde: "2026-09-01", descuenta: false, descuentaDesde: "2026-09-01" },    // apagado después de haber estado prendido
    { descuenta: true },                                                              // prendido sin fecha de arranque: no cuenta nada
    { cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-10-01" },     // rige desde octubre: septiembre no se toca
  ];
  for (const c of apagados) assert.deepEqual(fotos(escenario(c)), antes, JSON.stringify(c));
  /* Y esa foto es la de las cuentas hechas a mano (estado-liquidacion.ts: Mariano 509,25 y Dante 194). */
  assert.equal(r2(antes.pyl.comisionCloser), 703.25);
  assert.equal(r2(antes.pyl.comisionDirector), 145.5);
  assert.deepEqual(antes.webinars.map((w) => r2(w.comisiones)), [654.75, 194]);
  const mariano = antes.liquidacion.personas.find((p) => p.miembroId === "mariano")!;
  assert.equal(mariano.total, 509.25);
  assert.ok(mariano.lineas.every((l) => l.tipo !== "descuento"), "ni existe el renglón");
  assert.equal(antes.comisiones.some((c) => c.descuentoCierre !== undefined), false, "ni el campo");
});

test("con la demo (sus ventas son de antes y no traen la llamada atada), prender el interruptor tampoco cambia nada", () => {
  const e = construirSemilla();
  const prendido = { ...e, ajustes: { ...e.ajustes, crm: { ...(e.ajustes.crm ?? {}), cierreDelDia: { cuentaDesde: "2026-01-01", descuenta: true, descuentaDesde: "2026-01-01" } } } } as EstadoApp;
  assert.equal(ventasSinCierre(prendido).size, 0);
  for (let i = -3; i <= 0; i++) {
    const hoy = new Date();
    const mes = rangoDePeriodo(`${new Date(hoy.getFullYear(), hoy.getMonth() + i, 1).getFullYear()}-${String(new Date(hoy.getFullYear(), hoy.getMonth() + i, 1).getMonth() + 1).padStart(2, "0")}`);
    assert.deepEqual(comisionesDelMes(prendido, mes), comisionesDelMes(e, mes));
    assert.deepEqual(calcularPyL(prendido, mes), calcularPyL(e, mes));
  }
  assert.deepEqual(e.webinars.map((w) => metricasDeWebinar(prendido, w)), e.webinars.map((w) => metricasDeWebinar(e, w)));
});

/* ---------- Prendido: los tres lugares dicen lo mismo ---------- */

test("prendido, la comisión de Mariano sobre la venta del día sin cierre no se paga, y Finanzas, la liquidación y el webinar lo dicen igual", () => {
  const apagado = fotos(escenario());
  const prendido = fotos(escenario(PRENDIDO));

  /* Finanzas: v1 queda en cero (2.910 × 15% = 436,50 que no se paga); el director no pierde nada. */
  const v1 = prendido.comisiones.find((c) => c.ventaId === "v1")!;
  assert.equal(v1.comisionCloser, 0);
  assert.equal(r2(v1.descuentoCierre!), 436.5);
  assert.equal(r2(v1.comisionDirector), 145.5);
  assert.equal(r2(prendido.comisiones.find((c) => c.ventaId === "v2")!.comisionCloser), 72.75, "la venta del día a tiempo sigue comisionando");
  assert.equal(r2(prendido.pyl.comisionCloser), 266.75);
  assert.equal(r2(apagado.pyl.comisionCloser - prendido.pyl.comisionCloser), 436.5);
  assert.equal(r2(prendido.pyl.comisionDirector), 145.5);
  /* Lo que no se paga de comisión es profit: el resultado operativo sube lo mismo. */
  assert.equal(r2(prendido.pyl.operativoCC - apagado.pyl.operativoCC), 436.5);
  assert.equal(r2(prendido.porCloser.find((c) => c.closerId === "mariano")!.total), 72.75);

  /* Liquidación: la comisión sale entera y un renglón aparte resta lo que no se paga. */
  const liq = calcular(escenario(PRENDIDO));
  const com = renglon(liq, "mariano", "c_com");
  const desc = renglon(liq, "mariano", "cierre:c_com");
  assert.equal(com.monto, 509.25);
  assert.equal(desc.monto, -436.5);
  assert.equal(desc.tipo, "descuento");
  assert.equal(desc.nombre, "Descuento por cierre del día");
  assert.equal(desc.enFinanzas, true, "Finanzas ya lo descuenta: al cerrar no se carga de nuevo");
  assert.equal(desc.variable, true);
  assert.equal(liq.personas.find((p) => p.miembroId === "mariano")!.total, 72.75);
  assert.equal(liq.personas.find((p) => p.miembroId === "dante")!.lineas.length, 1, "Dante no tiene días con strike con ventas");
  assert.equal(liq.personas.find((p) => p.miembroId === "santi")!.total, 145.5, "el director no pierde nada");
  /* El renglón del closer en la liquidación suma lo mismo que Finanzas. */
  assert.equal(r2(com.monto + desc.monto), r2(prendido.porCloser.find((c) => c.closerId === "mariano")!.total));
  /* El profit de la liquidación sube igual que el de Finanzas. */
  assert.equal(r2(liq.profit - apagado.liquidacion.profit), 436.5);

  /* Webinar: w1 (v1 y v2) pierde lo que Finanzas no paga; w2 (v4) no cambia. */
  assert.deepEqual(prendido.webinars.map((w) => r2(w.comisiones)), [218.25, 194]);
  assert.equal(r2(apagado.webinars[0].comisiones - prendido.webinars[0].comisiones), 436.5);
});

test("el renglón «Descuento por cierre del día» trae su cuenta, que cierra con el monto, y los cobros de esos días", () => {
  const liq = calcular(escenario(PRENDIDO));
  const l = renglon(liq, "mariano", "cierre:c_com");
  const d = l.desglose!;
  assert.deepEqual(d.pasos.map((p) => [p.op, p.valor]), [
    ["base", 3000], ["menos", 90], ["igual", 2910], ["por", 0.15], ["igual", 436.5], ["por", -1], ["igual", -436.5],
  ]);
  assert.deepEqual(evaluarPasos(d.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(d), l.monto);
  assert.equal(d.regla, "15% del cash collected post pasarelas de las ventas que salieron de un día en que no se cargó el cierre ese mismo día");
  assert.equal(d.lista?.tipo, "cobros");
  assert.equal(d.lista?.total, 2);
  assert.deepEqual(d.lista?.items.map((x) => [x.cliente, x.monto]), [["Belén Godoy", 1500], ["Belén Godoy", 1500]]);
  assert.ok(d.avisos?.some((a) => a.includes("Días sin cierre: 3/9")), "dice qué día fue");
  assert.ok(d.avisos?.some((a) => a.includes("Rige para las llamadas desde el")));
  assert.equal(l.detalle, "15% de US$ 2.910 cobrados en días sin cierre cargado ese mismo día (2 cobros)");
  /* La foto del mes lo guarda como cualquier renglón. */
  const foto = JSON.parse(JSON.stringify(liq)) as ResultadoLiquidacion;
  assert.equal(renglon(foto, "mariano", "cierre:c_com").monto, -436.5);
});

test("si las cuotas las heredó otro closer, el descuento es sólo de las de quien cerró la venta", () => {
  const e = escenario(PRENDIDO, (x) => ({ ...x, cuotas: x.cuotas.map((c) => (c.id === "c1b" ? { ...c, closerId: "dante" } : c)) }));
  /* v1: p1 (1.455 neto) es de Mariano y se descuenta; p2 (1.455) la cobra Dante, que no cerró la venta. */
  const filas = comisionesDelMes(e, rango).filter((c) => c.ventaId === "v1");
  const deMariano = filas.find((c) => c.closerId === "mariano")!, deDante = filas.find((c) => c.closerId === "dante")!;
  assert.equal(deMariano.comisionCloser, 0);
  assert.equal(r2(deMariano.descuentoCierre!), 218.25);
  assert.equal(r2(deDante.comisionCloser), 145.5);
  assert.equal(deDante.descuentoCierre, undefined);
  const liq = calcular(e);
  assert.equal(renglon(liq, "mariano", "cierre:c_com").monto, -218.25);
  assert.equal(liq.personas.find((p) => p.miembroId === "mariano")!.total, 72.75);
  assert.equal(liq.personas.find((p) => p.miembroId === "dante")!.total, 339.5, "194 de lo suyo y 145,50 de las cuotas heredadas, sin descuento");
  assert.equal(r2(metricasDeWebinar(e, e.webinars[0]).comisiones), r2(145.5 + 145.5 + 72.75));
});

test("una comisión corregida a mano, o con lo medido cargado a mano, no lleva renglón de descuento: la cuenta no es de la app", () => {
  const e = escenario(PRENDIDO);
  for (const entrada of [{ monto: 400, nota: "Acordado" }, { cantidad: 3000 }]) {
    const liq = calcularLiquidacion(e, PERIODO, { ...liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z"), entradas: { "mariano:c_com": entrada } });
    assert.equal(renglonDe(liq, "mariano", "cierre:c_com"), undefined, JSON.stringify(entrada));
  }
});

test("un cobro de otro mes o de un día a tiempo no aparece en el renglón de descuento", () => {
  /* Con v1 a tiempo no hay renglón. */
  const aTiempo = escenario(PRENDIDO, (x) => ({
    ...x, sesiones: x.sesiones.map((s) => (s.id === "cal_v1" ? { ...s, estadoLlamadaEn: dia(3, 20) } : s)),
  }));
  assert.equal(ventasSinCierre(aTiempo).size, 0);
  assert.equal(renglonDe(calcular(aTiempo), "mariano", "cierre:c_com"), undefined);
  /* En agosto, ese cobro no está. */
  const agosto = calcularLiquidacion(escenario(PRENDIDO), "2026-08", liquidacionVacia("2026-08"));
  assert.equal(renglonDe(agosto, "mariano", "cierre:c_com"), undefined);
});

/* ==================================================================
   200 escenarios al azar (siempre los mismos): en todos, apagado nada
   cambia; prendido, los tres lugares dicen lo mismo y la cuenta del
   renglón de descuento cierra.
   ================================================================== */

function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    elige: <T,>(xs: readonly T[]): T => xs[Math.floor(siguiente() * xs.length)],
    si: (p = 0.5) => siguiente() < p,
    plata: (min: number, max: number) => Math.round((min + siguiente() * (max - min)) * 100) / 100,
  };
}

function escenarioAlAzar(semilla: number, cierre?: ConfigCierreDelDia): EstadoApp {
  const r = azar(semilla);
  const equipo: MiembroEquipo[] = [
    miembro("yari", "Yari", "ceo", 0, { sinComision: true }),
    miembro("c1", "Closer Uno", "closer", r.elige([0.1, 0.125, 0.0725])),
    miembro("c2", "Closer Dos", "closer", r.elige([0.12, 0.15, 0.2])),
    miembro("dir", "Director", "director", 0.05),
    miembro("gro", "Growth", "growth", 0.1),
  ];
  const nombreDe = (id?: string) => equipo.find((m) => m.id === id)?.nombre ?? "Closer Uno";
  const honorarios = [
    esquema("c1", [concepto({ id: "com", tipo: "porcentaje", nombre: "Comisión", tasa: equipo[1].comisionRate, base: r.elige(["cash-neto", "cash-neto", "cash"] as const), alcance: "closer" })]),
    esquema("c2", [concepto({ id: "com", tipo: "porcentaje", nombre: "Comisión", tasa: equipo[2].comisionRate, base: "cash-neto", alcance: "closer", ...(r.si(0.3) ? { productoIds: ["pa"] } : {}) })]),
    esquema("dir", [concepto({ id: "dir", tipo: "porcentaje", nombre: "Comisión", tasa: 0.05, base: "cash-neto", alcance: "director" })]),
    esquema("gro", [concepto({ id: "pro", tipo: "porcentaje", nombre: "Profit", tasa: 0.1, base: "profit", sinExcluidasMarketing: true })]),
  ];
  const fecha = (d: number, h = 15) => dia(d, h);
  const ventas: Venta[] = [];
  const cuotas: { id: string; ventaId: string; numero: number; monto: number; estado: string; esReserva: boolean; closerId?: string }[] = [];
  const pagos: Pago[] = [];
  const sesiones: Sesion[] = [];
  const n = r.entre(6, 30);
  for (let i = 0; i < n; i++) {
    const closerId = r.elige(["yari", "c1", "c1", "c2", "c2", undefined]);
    const diaVenta = r.entre(1, 28);
    /* La llamada de la que salió: cada una con un cierre distinto. */
    const conLlamada = closerId !== undefined && r.si(0.75);
    const idLlamada = `ll${i}`;
    if (conLlamada) {
      const diaLlamada = r.entre(1, 28);
      const cierre1 = r.elige(["a-tiempo", "a-tiempo", "tarde", "sin-cargar", "sin-marca"] as const);
      sesiones.push(llamada(idLlamada, nombreDe(closerId), diaLlamada, cierre1 === "sin-cargar" ? {} : {
        estadoLlamada: "Compra Full",
        ...(cierre1 === "sin-marca" ? {} : { estadoLlamadaEn: cierre1 === "a-tiempo" ? fecha(diaLlamada, r.elige([13, 18, 22])) : fecha(Math.min(diaLlamada + r.entre(1, 3), 30), 16) }),
      }));
    }
    ventas.push(venta({
      id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: r.plata(300, 6000), fecha: fecha(diaVenta),
      productoId: r.elige(["pa", "pb"]), webinarId: r.elige(["w1", "w2", undefined]),
      ...(closerId ? { closerId } : {}), ...(r.si(0.6) ? { directorId: "dir" } : {}),
      excluidoMarketing: r.si(0.2), estado: r.si(0.08) ? "cancelada" : "activa",
      ...(conLlamada ? { sesionId: idLlamada } : {}),
    }));
    for (let k = 0; k < r.entre(1, 3); k++) {
      cuotas.push({ id: `c${i}_${k}`, ventaId: `v${i}`, numero: k + 1, monto: 100, estado: "pagada", esReserva: false, ...(r.si(0.12) ? { closerId: r.elige(["c1", "c2"]) } : {}) });
      if (r.si(0.9)) {
        const monto = r.plata(50, 3000);
        const fee = monto * r.elige([0.029, 0.045, 0.06, 0.1]);
        pagos.push({ ...pago(`p${i}_${k}`, `c${i}_${k}`, monto, fee, fecha(r.entre(1, 30)), "s"), feeMonto: fee });
      }
    }
  }
  /* Llamadas que no son de ninguna venta: ruido de cada closer, canceladas y no vino incluidas. */
  for (let i = 0; i < r.entre(0, 25); i++) {
    const d = r.entre(1, 28);
    sesiones.push(llamada(`x${i}`, nombreDe(r.elige(["c1", "c2"])), d, r.elige([
      { estado: "cancelada" as const }, { estado: "no-show" as const },
      { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: fecha(d, 20) }, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: fecha(Math.min(d + 1, 30), 16) }, {},
    ])));
  }
  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500, ...(cierre ? { crm: { cierreDelDia: cierre } } : {}) },
    equipo, honorarios, ventas, cuotas, pagos, gastos: [], sesiones, liquidaciones: [], webinars: [webinar("w1"), webinar("w2")],
    productos: [{ id: "pa", nombre: "Mentoría" }, { id: "pb", nombre: "Downsell" }],
    procesadores: [{ id: "s", nombre: "Stripe" }],
  } as unknown as EstadoApp;
}

test("200 escenarios al azar: apagado nada cambia; prendido, Finanzas, la liquidación y el webinar dicen lo mismo", () => {
  let conDescuento = 0, renglones = 0, ventasDescontadas = 0, conCloserHeredado = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const donde = `semilla ${semilla}`;
    const sin = escenarioAlAzar(semilla);
    const apagado = escenarioAlAzar(semilla, { cuentaDesde: "2026-09-01", descuenta: false, descuentaDesde: "2026-09-01" });
    const prendido = escenarioAlAzar(semilla, { cuentaDesde: "2026-09-01", descuenta: true, descuentaDesde: "2026-09-01" });
    const base = fotos(sin);

    /* Apagado: exactamente lo mismo, número por número. */
    assert.deepEqual(fotos(apagado), base, `${donde}: apagado`);

    const on = fotos(prendido);
    const descontadas = ventasSinCierre(prendido);
    ventasDescontadas += descontadas.size;
    const totalDescuento = on.comisiones.reduce((a, c) => a + (c.descuentoCierre ?? 0), 0);

    /* Finanzas: la comisión baja exactamente lo que dice descuentoCierre, y la del director no se toca. */
    assert.ok(Math.abs(base.pyl.comisionCloser - on.pyl.comisionCloser - totalDescuento) < 1e-6, `${donde}: Finanzas`);
    assert.equal(on.pyl.comisionDirector, base.pyl.comisionDirector, `${donde}: director`);
    for (const c of on.comisiones) {
      if (c.descuentoCierre) { assert.equal(c.comisionCloser, 0, donde); assert.ok(descontadas.has(c.ventaId), donde); }
    }
    if (totalDescuento > 0) conDescuento++;

    /* Liquidación: lo que se le paga a cada closer (su comisión más el renglón de descuento) es lo que dice Finanzas. */
    for (const m of ["c1", "c2"]) {
      const persona = on.liquidacion.personas.find((p) => p.miembroId === m);
      const enFinanzas = (persona?.lineas ?? []).filter((l) => l.enFinanzas).reduce((a, l) => a + l.monto, 0);
      const deFinanzas = on.porCloser.find((c) => c.closerId === m)?.total ?? 0;
      if (persona?.lineas.some((l) => l.conceptoId === "com" && l.base === "cash-neto" && !l.desglose?.correccion)) {
        /* Con productoIds la comisión del closer 2 sólo cubre un servicio: no es toda la de Finanzas. */
        const filtrada = on.liquidacion.personas.find((p) => p.miembroId === m)?.lineas.find((l) => l.conceptoId === "com")?.desglose?.regla.includes("sólo");
        if (!filtrada) assert.ok(Math.abs(enFinanzas - deFinanzas) < 0.02, `${donde}: ${m} en la liquidación ${enFinanzas} y en Finanzas ${deFinanzas}`);
      }
      const desc = persona?.lineas.find((l) => l.tipo === "descuento");
      if (desc) {
        /* Es negativo, y cae donde cae la comisión de la que sale: en Finanzas, si ya la calcula ella; si no (una comisión sobre el cash
           bruto), se carga como gasto al cerrar y el descuento resta de ese gasto. */
        assert.ok(desc.monto < 0, donde);
        assert.equal(desc.enFinanzas, persona?.lineas.find((l) => l.conceptoId === "com")?.enFinanzas, donde);
        /* Lo que resta es lo que Finanzas deja de pagarle (la comisión de ese concepto de closer). */
        const deFin = on.comisiones.filter((c) => c.closerId === m).reduce((a, c) => a + (c.descuentoCierre ?? 0), 0);
        const filtrada = persona?.lineas.find((l) => l.conceptoId === "com")?.desglose?.regla.includes("sólo");
        const base1 = persona?.lineas.find((l) => l.conceptoId === "com")?.base;
        if (!filtrada && base1 === "cash-neto") assert.ok(Math.abs(-desc.monto - deFin) < 0.02, `${donde}: ${m} descuento ${desc.monto} contra ${deFin}`);
      }
      for (const l of persona?.lineas ?? []) {
        assert.ok(l.desglose, donde);
        assert.deepEqual(evaluarPasos(l.desglose.pasos).fallas, [], `${donde}: ${m} «${l.nombre}»`);
        assert.equal(resultadoDelDesglose(l.desglose), l.desglose.correccion ? l.desglose.correccion.cuentaDaba : l.monto, `${donde}: ${m} «${l.nombre}»`);
        renglones++;
      }
    }

    /* Webinar: lo que comisiona cada webinar es lo que Finanzas le saca a sus ventas, con y sin descuento. */
    for (const w of prendido.webinars) {
      const ids = new Set(prendido.ventas.filter((v) => v.webinarId === w.id).map((v) => v.id));
      const deFinanzas = on.comisiones.filter((c) => ids.has(c.ventaId)).reduce((a, c) => a + c.comisionCloser + c.comisionDirector, 0);
      const deWebinar = on.webinars[prendido.webinars.indexOf(w)].comisiones;
      assert.ok(Math.abs(deWebinar - deFinanzas) < 1e-6, `${donde}: webinar ${w.id} ${deWebinar} contra ${deFinanzas}`);
    }
    if (prendido.cuotas.some((c) => c.closerId)) conCloserHeredado++;
  }
  /* Que el azar haya tocado de todo: si esto falla, el generador dejó de estresar algo. */
  assert.ok(conDescuento > 60, `con descuento: ${conDescuento}`);
  assert.ok(ventasDescontadas > 200, `ventas descontadas: ${ventasDescontadas}`);
  assert.ok(renglones > 300, `renglones: ${renglones}`);
  assert.ok(conCloserHeredado > 100, `con cuotas heredadas: ${conCloserHeredado}`);
  console.log(`  (con descuento ${conDescuento} de 200, ventas descontadas ${ventasDescontadas}, renglones ${renglones}, con cuotas heredadas ${conCloserHeredado})`);
});
