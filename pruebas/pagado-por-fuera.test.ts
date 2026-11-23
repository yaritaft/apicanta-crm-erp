import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, CLAVE_PAGADO, conPagadoPorFuera, faltantes, gastosDeLiquidacion, liquidacionVacia } from "@/lib/honorarios";
import { evaluarPasos } from "@/lib/desglose";
import {
  cierrePorFuera, leerMontoPegado, pagosYaCargados, leerPagosPegados, quienEs, sePagoConLaPlanilla, tienePagadoPorFuera,
} from "@/lib/pagado-por-fuera";
import { pagosSinRegistrar } from "@/lib/pagos-liquidacion";
import { pasosDelMes } from "@/lib/cierre-mes";
import { acciones, fijarAcceso } from "@/lib/store";
import { estadoVacio } from "@/lib/seed";
import type { EstadoApp, Gasto, Liquidacion, PagadoPorFuera, ResultadoLiquidacion } from "@/lib/types";
import { estadoDePrueba, miembro, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Aldana (23/11): las liquidaciones de los meses que se pagaron con la planilla de Angelo (julio a septiembre) no daban lo que se le
   pagó a cada uno: la app los recalculaba con las reglas y los datos de hoy. Lo pagado por fuera de la app manda sobre la cuenta.
   Todos los montos de estas pruebas son inventados.
   En el mes de prueba (septiembre): Mariano 15% de lo suyo, Santi 5% de lo que dirige, Nico por piezas (sin cargar).
   ================================================================== */

const liqCon = (personas: Record<string, PagadoPorFuera> | null, extra: Partial<Liquidacion> = {}): Liquidacion => ({
  ...liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z"),
  ...(personas ? { porFuera: { fuente: "Planilla de Angelo", personas } } : {}),
  ...extra,
});
const de = (r: ResultadoLiquidacion, id: string) => r.personas.find((p) => p.miembroId === id);

test("sin lo pagado cargado, la liquidación es la cuenta de siempre (nada cambia)", () => {
  const e = estadoDePrueba();
  const antes = calcularLiquidacion(e, PERIODO, liqCon(null));
  const conVacio = calcularLiquidacion(e, PERIODO, liqCon({}));
  assert.deepEqual({ ...conVacio, calculadoEn: "" }, { ...antes, calculadoEn: "" });
  assert.ok(antes.personas.every((p) => !p.pagadoPorFuera && !p.lineas.some((l) => l.tipo === "pagado")));
});

test("con lo pagado, la persona cobra eso: la cuenta queda a la vista y un renglón completa la diferencia (la cuenta daba mucho menos)", () => {
  const e = estadoDePrueba();
  const cuenta = de(calcularLiquidacion(e, PERIODO, liqCon(null)), "mariano")!.total;
  const r = calcularLiquidacion(e, PERIODO, liqCon({ mariano: { monto: 3000, fecha: "2026-10-04", nota: "Transacciones, por Mercury" } }));
  const m = de(r, "mariano")!;
  assert.equal(m.total, 3000, "cobra lo que se le pagó");
  assert.equal(m.pagadoPorFuera?.cuentaDaba, cuenta, "y se guarda lo que daba la cuenta, para comparar");
  const dif = m.lineas.find((l) => l.clave === CLAVE_PAGADO)!;
  assert.equal(dif.tipo, "pagado");
  assert.equal(dif.nombre, "Diferencia con lo que se pagó");
  assert.equal(dif.monto, Math.round((3000 - cuenta) * 100) / 100);
  assert.equal(dif.enFinanzas, false, "no es «en Finanzas»: al cerrar entra en los costos");
  assert.match(dif.detalle, /04\/10\/2026/);
  assert.deepEqual(evaluarPasos(dif.desglose!.pasos).fallas, [], "la cuenta del desglose cierra");
  assert.equal(evaluarPasos(dif.desglose!.pasos).valor, dif.monto);
  /* Los renglones de la cuenta siguen ahí, sin tocar. */
  assert.ok(m.lineas.some((l) => l.conceptoId === "c_com"));
});

test("si se pagó menos de lo que da la cuenta, la diferencia resta (se pagó menos)", () => {
  const e = estadoDePrueba();
  const cuenta = de(calcularLiquidacion(e, PERIODO, liqCon(null)), "santi")!.total;
  const r = calcularLiquidacion(e, PERIODO, liqCon({ santi: { monto: cuenta - 50 } }));
  assert.equal(de(r, "santi")!.total, Math.round((cuenta - 50) * 100) / 100);
  assert.equal(de(r, "santi")!.lineas.find((l) => l.tipo === "pagado")!.monto, -50);
});

test("si lo pagado coincide con la cuenta, no hay renglón de diferencia pero queda como pagado por fuera", () => {
  const e = estadoDePrueba();
  const cuenta = de(calcularLiquidacion(e, PERIODO, liqCon(null)), "manu")!.total;
  const m = de(calcularLiquidacion(e, PERIODO, liqCon({ manu: { monto: cuenta } })), "manu")!;
  assert.equal(m.total, cuenta);
  assert.ok(!m.lineas.some((l) => l.tipo === "pagado"));
  assert.equal(m.pagadoPorFuera?.monto, cuenta);
});

test("quien ya no se liquida (inactiva y sin nada cargado) sale igual con lo que se le pagó", () => {
  const e = estadoDePrueba();
  e.equipo = [...e.equipo, miembro("belen", "Persona Inactiva", "otro", 0, { activo: false })];
  assert.equal(de(calcularLiquidacion(e, PERIODO, liqCon(null)), "belen"), undefined);
  const b = de(calcularLiquidacion(e, PERIODO, liqCon({ belen: { monto: 800, fecha: "2026-10-02" } })), "belen")!;
  assert.equal(b.total, 800);
  assert.equal(b.fijo, 800, "sin nada variable cargado, lo pagado es fijo");
});

test("pagado en cero a quien la cuenta le daba algo (un closer que ya no estaba): queda en cero y no desaparece", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO, liqCon({ dante: { monto: 0 } }));
  const d = de(r, "dante")!;
  assert.equal(d.total, 0);
  assert.ok(d.pagadoPorFuera);
});

test("el profit del mes resta lo que se pagó de más (al cerrar entra en los costos) y los gastos al cerrar lo traen", () => {
  const e = estadoDePrueba();
  const antes = calcularLiquidacion(e, PERIODO, liqCon(null));
  const liq = liqCon({ mariano: { monto: de(antes, "mariano")!.total + 1000 } });
  const r = calcularLiquidacion(e, PERIODO, liq);
  assert.equal(Math.round((antes.profit - r.profit) * 100) / 100, 1000);
  const enSalarios = (x: ResultadoLiquidacion, l: Liquidacion) => gastosDeLiquidacion(e, l, x).find((g) => g.categoria === "Equipo / Salarios")?.monto ?? 0;
  assert.equal(Math.round((enSalarios(r, liq) - enSalarios(antes, liqCon(null))) * 100) / 100, 1000, "la diferencia entra a Finanzas al cerrar");
});

test("a quien se le pagó por fuera no le falta nada: no frena el cierre con piezas sin cargar ni con «a definir»", () => {
  const e = estadoDePrueba();
  const sin = faltantes(calcularLiquidacion(e, PERIODO, liqCon(null)));
  assert.ok(sin.lineas.some((x) => x.persona.miembroId === "nico"), "Nico tiene la sesión sin cargar");
  const con = faltantes(calcularLiquidacion(e, PERIODO, liqCon({ nico: { monto: 410 } })));
  assert.ok(!con.lineas.some((x) => x.persona.miembroId === "nico"));
});

test("conPagadoPorFuera: carga, corrige y saca; en una cerrada no cambia nada", () => {
  const liq = liqCon(null);
  const una = conPagadoPorFuera(liq, "mariano", { monto: 100.456 }, "Planilla")!;
  assert.equal(una.porFuera?.personas.mariano.monto, 100.46);
  assert.equal(una.porFuera?.fuente, "Planilla");
  assert.equal(tienePagadoPorFuera(una), true);
  const sin = conPagadoPorFuera(una, "mariano", null)!;
  assert.equal(sin.porFuera, null, "sin nadie, vuelve a null");
  assert.equal(conPagadoPorFuera({ ...una, estado: "cerrada" }, "dante", { monto: 1 }), null);
});

/* ---------- Al cerrar ---------- */

const gastoDe = (id: string, categoria: string, monto: number, extra: Gasto["extra"] = {}): Gasto =>
  ({ id, categoria, grupo: categoria === "Setters" || categoria.startsWith("Comisiones") ? "directo" : "operativo", concepto: categoria, monto, moneda: "USD", fecha: "2026-09-01T12:00:00.000Z", recurrente: false, creadoEn: "2026-09-27T12:00:00.000Z", extra });

test("al cerrar, quien tiene lo pagado queda pagado (por fuera, con el día) y los resúmenes de la planilla vieja se marcan; edición y filmmaker no", () => {
  const e = estadoDePrueba();
  e.gastos = [
    ...e.gastos,
    gastoDe("g_sal", "Equipo / Salarios", 7000, { origen: "planilla-angelo" }),
    gastoDe("g_set", "Setters", 300, { origen: "planilla-angelo" }),
    gastoDe("g_dir", "Comisiones Director de Ventas", 2100.5, { origen: "planilla-angelo" }),
    gastoDe("g_edi", "Edición de contenido", 450, { origen: "planilla-angelo" }),
    gastoDe("g_fil", "Filmmaker", 900, { origen: "planilla-angelo" }),
    gastoDe("g_ia", "Setters", 600, { origen: "finance-cfo-transacciones" }),
    gastoDe("g_ceo", "Honorarios del CEO", 500, { origen: "planilla-angelo" }),
  ];
  const liq = liqCon({ mariano: { monto: 3000, fecha: "2026-10-04" }, dante: { monto: 0 } });
  const r = calcularLiquidacion(e, PERIODO, liq);
  const { pagos, marcar } = cierrePorFuera(e, liq, r, "2026-11-23T04:00:00.000Z");
  assert.deepEqual(pagos.mariano, { pagadoEn: "2026-10-04T15:00:00.000Z", por: "Por fuera de la app", fuera: true });
  assert.equal(pagos.dante, undefined, "a quien se le pagó cero no se lo marca");
  assert.equal(pagos.manu, undefined, "a quien no tiene lo pagado no se lo marca");
  assert.deepEqual(marcar.sort(), ["g_dir", "g_sal", "g_set"]);
  /* Sin lo pagado cargado no se marca nada: es un mes de la app. */
  assert.deepEqual(pagosYaCargados(e, liqCon(null), r), []);
});

test("un gasto fijo de sueldos sin nombre («Equipo / Salarios (No comercial)») también es esos pagos; uno con el nombre de alguien, no es un resumen", () => {
  const e = estadoDePrueba();
  e.gastos = [
    ...e.gastos,
    gastoDe("g_fijo", "Equipo / Salarios", 8800, { recurrenteId: "rec_1", recurrenteMes: PERIODO }),
    { ...gastoDe("g_lili", "Equipo / Salarios", 1200, { recurrenteId: "rec_2", recurrenteMes: PERIODO }), concepto: "Liliana Riveros" },
  ];
  const liq = liqCon({ mariano: { monto: 3000 } });
  const ya = pagosYaCargados(e, liq, calcularLiquidacion(e, PERIODO, liq));
  assert.deepEqual(ya.filter((y) => y.motivo === "resumen").map((y) => y.gasto.id), ["g_fijo"]);
});

test("la transferencia de cada uno, cargada como gasto cerca del día que se le pagó (los editores de agosto, en septiembre), se enlaza; lejos o ya marcada, se cuida", () => {
  const e = estadoDePrueba();
  const transferencia = (id: string, concepto: string, monto: number, fecha: string, extra: Gasto["extra"] = {}): Gasto =>
    ({ ...gastoDe(id, "Edición de contenido", monto, extra), concepto, proveedor: concepto, fecha, fechaPago: fecha });
  e.gastos = [
    ...e.gastos,
    transferencia("g_mar", "Mariano Arias (Closer)", 3000, "2026-10-04T15:00:00.000Z"),
    transferencia("g_nico", "Filmmaker (Juan Ejemplo)", 410, "2026-10-02T15:00:00.000Z"),
    transferencia("g_lejos", "Mariano Arias", 500, "2026-11-20T15:00:00.000Z"),
    transferencia("g_manu", "Manuel Pérez", 2300, "2026-10-06T15:00:00.000Z", { pagoDeEquipo: true }),
  ];
  const liq = liqCon({ mariano: { monto: 3000, fecha: "2026-10-04" }, nico: { monto: 410, fecha: "2026-10-02" }, manu: { monto: 2300, fecha: "2026-10-06" } });
  const r = calcularLiquidacion(e, PERIODO, liq);
  const ya = pagosYaCargados(e, liq, r);
  const pagos = ya.filter((y) => y.motivo === "pago");
  assert.deepEqual(pagos.map((y) => [y.gasto.id, y.miembroId]).sort(), [["g_manu", "manu"], ["g_mar", "mariano"], ["g_nico", "nico"]], "por nombre o por el monto justo; el de noviembre no");
  const { pagos: marcas, marcar } = cierrePorFuera(e, liq, r, "2026-11-23T04:00:00.000Z");
  assert.deepEqual(marcas.mariano.gastoIds, ["g_mar"]);
  assert.deepEqual(marcas.manu.gastoIds, ["g_manu"]);
  assert.deepEqual(marcas.manu.marcados, [], "ya estaba marcado: se enlaza sin tocarlo");
  assert.ok(!marcar.includes("g_manu"), "y reabrir no lo desmarca");
  assert.deepEqual(marcar.sort(), ["g_mar", "g_nico"]);
});

test("pagosSinRegistrar no pide registrar en la caja lo pagado por fuera", () => {
  const e = estadoDePrueba();
  const liq = liqCon({ mariano: { monto: 3000 } });
  const r = calcularLiquidacion(e, PERIODO, liq);
  const cerrada: Liquidacion = { ...liq, estado: "cerrada", resultado: r, pagos: { mariano: { pagadoEn: "2026-10-04T15:00:00.000Z", fuera: true }, manu: { pagadoEn: "2026-10-04T15:00:00.000Z" } } };
  const faltan = pagosSinRegistrar(e, cerrada).map((p) => p.miembroId);
  assert.deepEqual(faltan, ["manu"]);
});

test("el store: cerrar marca a los pagados y los resúmenes de la planilla; reabrir los deja como estaban", () => {
  fijarAcceso(null);
  const base = JSON.parse(acciones.exportar()) as EstadoApp;
  const prueba = estadoDePrueba();
  const g = gastoDe("g_sal_store", "Equipo / Salarios", 7000, { origen: "planilla-angelo" });
  acciones.importar(JSON.stringify({ ...base, ...prueba, leads: base.leads, gastos: [...prueba.gastos, g], liquidaciones: [], actividad: [] }));
  const vacia = liquidacionVacia(PERIODO, "2026-10-01T12:00:00.000Z");
  assert.equal(acciones.cargarPagadosPorFuera(vacia, [{ miembroId: "mariano", pagado: { monto: 3000, fecha: "2026-10-04" } }], "Aldana", "Planilla"), true);
  const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
  const liq = estado().liquidaciones.find((l) => l.periodo === PERIODO)!;
  assert.equal(liq.porFuera?.personas.mariano.cargadoPor, "Aldana");
  const r = calcularLiquidacion(estado(), PERIODO, liq);
  acciones.cerrarLiquidacion(liq, r, gastosDeLiquidacion(estado(), liq, r), "Aldana");
  let e = estado();
  let l = e.liquidaciones.find((x) => x.periodo === PERIODO)!;
  assert.equal(l.estado, "cerrada");
  assert.equal(l.pagos.mariano?.fuera, true);
  assert.deepEqual(l.porFuera?.marcados, ["g_sal_store"]);
  assert.equal(e.gastos.find((x) => x.id === "g_sal_store")?.extra?.pagoDeEquipo, true, "el resumen de la planilla no cuenta dos veces");
  assert.match(e.actividad[0].detalle, /por fuera de la app/);
  /* Cerrada no se carga lo pagado. */
  assert.equal(acciones.cargarPagadosPorFuera(l, [{ miembroId: "dante", pagado: { monto: 1 } }], "Aldana"), false);
  acciones.reabrirLiquidacion(l);
  e = estado();
  l = e.liquidaciones.find((x) => x.periodo === PERIODO)!;
  assert.equal(l.estado, "abierta");
  assert.equal(e.gastos.find((x) => x.id === "g_sal_store")?.extra?.pagoDeEquipo, undefined, "reabrir lo desmarca");
  assert.deepEqual(l.porFuera?.marcados, []);
  assert.equal(l.porFuera?.personas.mariano.monto, 3000, "lo pagado cargado se queda");
});

/* ---------- Pegar de la planilla ---------- */

test("los montos como vienen en una planilla", () => {
  assert.equal(leerMontoPegado("3200"), 3200);
  assert.equal(leerMontoPegado("3.200"), 3200);
  assert.equal(leerMontoPegado("7.450,25"), 7450.25);
  assert.equal(leerMontoPegado("7,450.25"), 7450.25);
  assert.equal(leerMontoPegado("7450,25"), 7450.25);
  assert.equal(leerMontoPegado("US$ 1.850,50"), 1850.5);
  assert.equal(leerMontoPegado("1,500"), 1500);
  assert.equal(leerMontoPegado("16.13"), 16.13);
  assert.equal(leerMontoPegado("Mercury"), undefined);
});

test("quién es quién: el nombre largo de la planilla encuentra al del equipo; uno que no está, no", () => {
  const equipo = [{ id: "ana", nombre: "Ana Gómez" }, { id: "tito", nombre: "Tito" }, { id: "luis", nombre: "Luis Pérez" }, { id: "lu", nombre: "Lucía Pérez" }];
  assert.equal(quienEs("Ana María Gómez Ruiz", equipo)?.id, "ana");
  assert.equal(quienEs("Luis Alberto Pérez", equipo)?.id, "luis");
  assert.equal(quienEs("María Lucía Pérez", equipo)?.id, "lu");
  assert.equal(quienEs("Tito Editor", equipo)?.id, "tito");
  assert.equal(quienEs("Pérez", equipo), undefined, "con un apellido que comparten dos, no adivina");
  assert.equal(quienEs("Juan Pérez", equipo), undefined);
});

test("pegar el Payroll: nombre, monto y día; dos renglones de la misma persona se suman; lo que no se reconoce se avisa", () => {
  const equipo = [{ id: "ana", nombre: "Ana Gómez" }, { id: "luis", nombre: "Luis Pérez" }, { id: "eva", nombre: "Eva Ríos" }];
  const texto = [
    "Ana María Gómez\t3200\t04/09/2026",
    "Luis Alberto Pérez\tCloser\t4000\t2026-09-02",
    "Luis Closer Pérez\t1.850,50\t02/09/2026",
    "Eva Ríos\tCustomer Success\t1000\t300\t1300",
    "Alguien Nuevo\t300",
    "",
  ].join("\n");
  const filas = leerPagosPegados(texto, equipo);
  const de = (id: string) => filas.find((f) => f.miembroId === id);
  assert.deepEqual([de("ana")?.monto, de("ana")?.fecha], [3200, "2026-09-04"]);
  assert.equal(de("luis")?.monto, 5850.5, "dos cuentas, en dos renglones");
  assert.equal(de("eva")?.monto, 1300, "con varias columnas de plata, la última (el total)");
  const mal = filas.find((f) => f.problema);
  assert.match(mal?.problema ?? "", /Alguien Nuevo/);
  assert.equal(filas.length, 4);
});

/* ---------- Finanzas en pasos ---------- */

test("los meses hasta septiembre se pagaron con la planilla: una liquidación cerrada sin lo pagado queda pendiente", () => {
  assert.equal(sePagoConLaPlanilla("2026-08"), true);
  assert.equal(sePagoConLaPlanilla("2026-09"), true);
  assert.equal(sePagoConLaPlanilla("2026-10"), false);
  const e = { ...estadoVacio(), ...estadoDePrueba() } as EstadoApp;
  const r = calcularLiquidacion(e, PERIODO, liqCon(null));
  const cerradaSin: EstadoApp = { ...e, liquidaciones: [{ ...liqCon(null), estado: "cerrada", resultado: r }] } as EstadoApp;
  const paso = (x: EstadoApp) => pasosDelMes(x, PERIODO, { esDueno: true, ahora: Date.parse("2026-11-23T12:00:00.000Z") }).find((p) => p.id === "liq-revisar")!;
  assert.equal(paso(cerradaSin).estado, "pendiente");
  assert.match(paso(cerradaSin).detalle, /no con lo que se pagó/);
  const liqBien = liqCon({ mariano: { monto: 3000 } });
  const cerradaBien = { ...e, liquidaciones: [{ ...liqBien, estado: "cerrada", resultado: calcularLiquidacion(e, PERIODO, liqBien) }] } as EstadoApp;
  assert.notEqual(paso(cerradaBien).estado, "pendiente");
});
