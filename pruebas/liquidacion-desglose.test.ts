import test from "node:test";
import assert from "node:assert/strict";
import {
  calcularLiquidacion, conExtraEnMes, extrasPorVenir, liquidacionCsv, liquidacionVacia, mesesDelRenglon,
  mesesParaExtra, moverPeriodo, periodoDe, renglonDe, sinExtraEnLiquidacion, textoParaEnviar,
} from "@/lib/honorarios";
import { construirSemilla } from "@/lib/seed";
import { evaluarPasos, LIMITE_LISTA, resultadoDelDesglose } from "@/lib/desglose";
import type {
  EntradaLiquidacion, EstadoApp, ExtraLiquidacion, LineaLiquidada, Liquidacion, ResultadoLiquidacion,
} from "@/lib/types";
import { concepto, dia, esquema, estadoDePrueba, PERIODO, venta, pago } from "./estado-liquidacion";

/* ==================================================================
   El desglose de cada renglón de la liquidación: la cuenta con la que se
   llegó al monto. Lo que se prueba: que cierra EXACTO con el número que se
   ve (en cada tipo de renglón), que la foto del mes lo guarda, y que un
   descuento anotado para el mes que viene aparece cuando se abre ese mes
   sin molestar a nadie más. El mes de prueba está en estado-liquidacion.ts.
   ================================================================== */

/* Con lo que se carga a mano al liquidar: las 3 sesiones de Nico. */
const entradas = (extra: Record<string, EntradaLiquidacion> = {}): Record<string, EntradaLiquidacion> => ({
  "nico:c_pieza": { cantidad: 3 }, ...extra,
});
const liqCon = (e: Record<string, EntradaLiquidacion>, extras: ExtraLiquidacion[] = [], periodo = PERIODO): Liquidacion =>
  ({ ...liquidacionVacia(periodo, "2026-10-01T12:00:00.000Z"), entradas: e, extras });

const renglon = (r: ResultadoLiquidacion, miembroId: string, clave: string): LineaLiquidada => {
  const x = renglonDe(r, miembroId, clave);
  assert.ok(x, `falta el renglón ${miembroId}:${clave}`);
  return x.linea;
};

const pasoDe = (l: LineaLiquidada, texto: string) => {
  const p = l.desglose?.pasos.find((x) => x.texto.startsWith(texto));
  assert.ok(p, `falta el paso «${texto}» en ${l.nombre}`);
  return p;
};

/* ---------- La cuenta cierra EXACTO con el monto, en todos los renglones ---------- */

test("en cada renglón de septiembre, la cuenta del desglose da exactamente el monto que se ve", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas()));
  let revisados = 0;
  for (const p of r.personas) {
    for (const l of p.lineas) {
      assert.ok(l.desglose, `${p.nombre}: «${l.nombre}» no tiene desglose`);
      const { fallas } = evaluarPasos(l.desglose.pasos);
      assert.deepEqual(fallas, [], `${p.nombre}: «${l.nombre}» no cierra`);
      /* El último «igual» ES el monto, sin una diferencia de centavos. */
      assert.equal(resultadoDelDesglose(l.desglose), l.monto, `${p.nombre}: «${l.nombre}»`);
      assert.equal(l.desglose.moneda, l.moneda);
      assert.ok(l.desglose.regla.length > 0, "la regla dicha en castellano");
      revisados++;
    }
  }
  /* Mariano 1, Dante 1, Santiago 1, Dani 2, Agustín 2, Manuel 3, Liliana 1, Nico 1. */
  assert.equal(revisados, 12);
});

test("con los datos de la demo, mes por mes, todos los renglones de todos cierran con su monto", () => {
  const base = construirSemilla();
  const conceptosDe = (rol: string, tasa: number) => {
    if (rol === "closer") return [concepto({ id: "c1", tipo: "porcentaje", nombre: "Comisión", tasa: tasa || 0.1, base: "cash-neto", alcance: "closer" })];
    if (rol === "director") return [concepto({ id: "c1", tipo: "porcentaje", nombre: "Comisión", tasa: 0.05, base: "cash-neto", alcance: "director" })];
    if (rol === "setter") return [concepto({ id: "c0", tipo: "fijo", nombre: "Sueldo", monto: 250 }), concepto({ id: "c1", tipo: "porcentaje", nombre: "Comisión", tasa: 0.05, base: "cash", alcance: "setter" })];
    return [
      concepto({ id: "c0", tipo: "fijo", nombre: "Sueldo", monto: 1000, desde: "2026-01-15" }),
      concepto({ id: "c1", tipo: "tramo", nombre: "Tramo", monto: 100, cada: 5000, base: "cash-neto", alcance: "todas" }),
      concepto({ id: "c2", tipo: "porcentaje", nombre: "Profit", tasa: 0.1, base: "profit", sinExcluidasMarketing: true }),
      concepto({ id: "c3", tipo: "porcentaje", nombre: "Facturado", tasa: 0.02, base: "facturado", alcance: "todas" }),
      concepto({ id: "c4", tipo: "tramo", nombre: "Ventas", monto: 50, cada: 3, base: "ventas", alcance: "todas" }),
      concepto({ id: "c5", tipo: "porcentaje", nombre: "Agenda", tasa: 0.5, base: "llamadas-hechas" }),
    ];
  };
  const e = { ...base, honorarios: base.equipo.map((m) => esquema(m.id, conceptosDe(m.rol, m.comisionRate))) } as EstadoApp;
  let renglones = 0;
  for (let i = -8; i <= 1; i++) {
    const periodo = moverPeriodo(periodoDe(new Date()), i);
    for (const p of calcularLiquidacion(e, periodo, undefined).personas) {
      for (const l of p.lineas) {
        assert.ok(l.desglose, `${periodo} · ${p.nombre}: «${l.nombre}»`);
        assert.deepEqual(evaluarPasos(l.desglose.pasos).fallas, [], `${periodo} · ${p.nombre}: «${l.nombre}»`);
        assert.equal(resultadoDelDesglose(l.desglose), l.monto, `${periodo} · ${p.nombre}: «${l.nombre}»`);
        renglones++;
      }
    }
  }
  assert.ok(renglones > 50, `se revisaron ${renglones} renglones`);
});

test("el desglose no cambia ningún número ni texto del renglón (sólo se le suma)", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO, liqCon(entradas()));
  const totales = Object.fromEntries(r.personas.map((p) => [p.nombre, p.total]));
  assert.deepEqual(totales, {
    "Agustín Sica": 905.59,        // 750 de fijo + 155,59 del profit
    "Dante Barbieri": 194,
    "Daniel Rodriguez": 395.5,     // 250 + 5% de 2.910
    "Liliana Riveros": 100,
    "Manuel Pérez": 3200,
    "Mariano Arias": 509.25,
    "Nico": 450,
    "Santiago Burghiani": 145.5,
  });
  assert.equal(r.profit, 1970.75);
});

/* ---------- Comisión sobre cash: cuánto, procesadores, cuáles ---------- */

test("comisión de director (el caso de Santiago): 5% de US$ 2.910 de cash post pasarelas, 2 cobros", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas()));
  const l = renglon(r, "santi", "c_dir");
  assert.equal(l.detalle, "5% de US$ 2.910 de cash post pasarelas (2 cobros)");
  assert.equal(l.monto, 145.5);
  assert.equal(l.enFinanzas, true);
  const d = l.desglose!;
  assert.equal(d.regla, "5% del cash collected post pasarelas de las ventas que dirige");
  assert.deepEqual(d.pasos.map((p) => [p.op, p.valor]), [
    ["base", 3000], ["menos", 90], ["igual", 2910], ["por", 0.05], ["igual", 145.5],
  ]);
  assert.equal(pasoDe(l, "Cobrado en el mes").nota, "2 cobros");
  /* Los cobros que entraron, con quién, qué servicio y por dónde. */
  assert.equal(d.lista?.tipo, "cobros");
  assert.equal(d.lista?.total, 2);
  assert.equal(d.lista?.resto, undefined);
  assert.deepEqual(d.lista?.items.map((x) => [x.cliente, x.servicio, x.procesador, x.monto, x.fee, x.neto]), [
    ["Belén Godoy", "Mentoría", "Stripe", 1500, 45, 1455],
    ["Belén Godoy", "Mentoría", "Stripe", 1500, 45, 1455],
  ]);
});

test("comisión de closer: sólo sus ventas, con los procesadores de cada cobro", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas()));
  const l = renglon(r, "mariano", "c_com");
  assert.equal(l.monto, 509.25);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [
    ["base", 3500], ["menos", 105], ["igual", 3395], ["por", 0.15], ["igual", 509.25],
  ]);
  assert.deepEqual(l.desglose!.lista!.items.map((x) => [x.cliente, x.servicio, x.procesador, x.neto]), [
    ["Belén Godoy", "Mentoría", "Stripe", 1455],
    ["Pedro Gómez", "Downsell", "Hotmart", 485],
    ["Belén Godoy", "Mentoría", "Stripe", 1455],
  ]);
  /* Lo de Yari no entra: «si la venta la cerró Yari, no comisiona nadie». */
  assert.ok(!l.desglose!.lista!.items.some((x) => x.cliente === "Cliente de Yari"));
});

test("la lista es corta: los más grandes, y una línea con cuántos faltan y cuánto suman", () => {
  const e = estadoDePrueba();
  /* Mariano con 14 cobros chicos más: 3 + 14 = 17 cobros. */
  const extraV = venta({ id: "vx", contactoNombre: "Muchos cobros", precioAcordado: 1400, fecha: dia(2), closerId: "mariano" });
  const cuotasX = Array.from({ length: 14 }, (_, i) => ({ id: `cx${i}`, ventaId: "vx", numero: i + 1, monto: 100, estado: "pagada", esReserva: false }));
  const pagosX = cuotasX.map((c, i) => pago(`px${i}`, c.id, 100, 3, dia(2 + (i % 20)), "proc_stripe"));
  const e2 = { ...e, ventas: [...e.ventas, extraV], cuotas: [...e.cuotas, ...cuotasX], pagos: [...e.pagos, ...pagosX] } as EstadoApp;
  const l = renglon(calcularLiquidacion(e2, PERIODO, liqCon(entradas())), "mariano", "c_com");
  const lista = l.desglose!.lista!;
  assert.equal(lista.total, 17);
  assert.equal(lista.items.length, LIMITE_LISTA);
  assert.equal(lista.resto?.cantidad, 7);
  /* Los 10 más grandes más lo que quedó afuera suman lo cobrado, sin perder un centavo. */
  const brutoLista = lista.items.reduce((a, x) => a + x.monto, 0) + lista.resto!.monto;
  assert.equal(Math.round(brutoLista * 100) / 100, 3500 + 1400);
  assert.equal(pasoDe(l, "Cobrado en el mes").valor, 4900);
  assert.equal(pasoDe(l, "Cobrado en el mes").nota, "17 cobros");
  /* Y la cuenta sigue cerrando. */
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(l.desglose!), l.monto);
});

test("un cobro con cuota heredada o sin venta no rompe la lista", () => {
  const e = estadoDePrueba();
  const huerfano = pago("pz", "cuota_que_no_existe", 100, 3, dia(15), "proc_stripe");
  const e2 = { ...e, pagos: [...e.pagos, huerfano] } as EstadoApp;
  /* La del negocio entero (Manuel) cuenta todos los cobros, también el que no tiene venta. */
  const l = renglon(calcularLiquidacion(e2, PERIODO, liqCon(entradas())), "manu", "c_tramo");
  assert.equal(pasoDe(l, "Cobrado en el mes").valor, 9600);
  assert.ok(l.desglose!.lista!.items.some((x) => x.cliente === "Cobro sin venta"));
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
});

/* ---------- % del profit ---------- */

test("% del profit: el profit del mes armado paso a paso, con lo que se deja afuera para esa persona", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas()));
  const l = renglon(r, "agus", "c_profit");
  assert.equal(l.monto, 155.59);
  assert.equal(l.enFinanzas, true);
  const d = l.desglose!;
  assert.equal(d.regla, "10% del profit del mes (sin las excluidas de marketing)");
  assert.deepEqual(d.pasos.map((p) => [p.op, p.texto, p.valor]), [
    ["base", "Cobrado en el mes (cash collected)", 9500],
    ["menos", "Lo que se quedaron los procesadores de pago", 285],
    ["menos", "Comisiones de closers y del director", 848.75],        // 703,25 + 145,50
    ["menos", "Otros costos directos", 300],
    ["menos", "Gastos operativos", 1200],
    ["menos", "Sueldos y honorarios de esta liquidación", 4895.5],
    ["igual", "Profit del mes", 1970.75],
    ["menos", "Lo que corresponde a ventas excluidas de marketing", 414.89],
    ["igual", "Profit que le cuenta", 1555.86],
    ["por", "Porcentaje", 0.1],
    ["igual", "Monto del mes", 155.59],
  ]);
  /* Es el mismo profit que usa la liquidación para todos. */
  assert.equal(pasoDe(l, "Profit del mes").valor, r.profit);
  assert.equal(pasoDe(l, "Lo que corresponde").nota, "Son el 21,1% de lo facturado del mes");
  assert.equal(d.lista, undefined);
});

test("% del profit con pérdida: no hay profit para repartir, y la cuenta lo dice", () => {
  const e = estadoDePrueba();
  const e2 = { ...e, gastos: [...e.gastos, { ...e.gastos[1], id: "g3", monto: 20000 }] } as EstadoApp;
  const r = calcularLiquidacion(e2, PERIODO, liqCon(entradas()));
  const l = renglon(r, "agus", "c_profit");
  assert.ok(r.profit < 0);
  assert.equal(l.monto, 0);
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(l.desglose!), 0);
  assert.ok(l.desglose!.avisos!.includes("El mes dio pérdida: no hay profit para repartir."));
  assert.equal(pasoDe(l, "Profit del mes").valor, r.profit);
});

test("% del profit sin excluir nada: el profit entero, sin paso de lo que se deja afuera", () => {
  const e = estadoDePrueba();
  /* Sólo cambia este concepto: los sueldos de la liquidación (y el profit) siguen siendo los mismos. */
  const conc = concepto({ id: "c_profit", tipo: "porcentaje", nombre: "Socio", tasa: 0.12, base: "profit" });
  const e2 = {
    ...e,
    honorarios: e.honorarios.map((h) => (h.miembroId === "agus" ? { ...h, conceptos: [h.conceptos[0], conc] } : h)),
  } as EstadoApp;
  const r = calcularLiquidacion(e2, PERIODO, liqCon(entradas()));
  const l = renglon(r, "agus", "c_profit");
  assert.equal(r.profit, 1970.75);
  assert.equal(l.monto, 236.49);   // 12% de 1.970,75
  assert.ok(!l.desglose!.pasos.some((p) => p.texto.startsWith("Lo que corresponde")));
  assert.equal(l.desglose!.pasos[l.desglose!.pasos.length - 3].valor, 1970.75);
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(l.desglose!), 236.49);
});

/* ---------- Fijo, bono, tramos y piezas ---------- */

test("fijo prorrateado: el monto por mes por los días que le tocan", () => {
  const l = renglon(calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas())), "agus", "c_fijo");
  assert.equal(l.monto, 750);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor, p.de]), [
    ["base", 1500, undefined], ["por", 15, 30], ["igual", 750, undefined],
  ]);
  assert.match(l.desglose!.avisos![0], /del 16 al 30 de septiembre 2026/);
});

test("fijo entero: el monto por mes, sin prorrateo", () => {
  const l = renglon(calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas())), "manu", "c_fijo");
  assert.equal(l.monto, 1700);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 1700], ["igual", 1700]]);
  assert.equal(l.desglose!.avisos, undefined);
});

test("fijo que termina a mitad de mes (Angelo hasta el 30/09 y alguien hasta el 10): prorrateado hacia el otro lado", () => {
  const e = estadoDePrueba();
  const conc = concepto({ id: "c_fijo", tipo: "fijo", nombre: "CFO", monto: 1000, hasta: "2026-09-10" });
  const e2 = { ...e, honorarios: [...e.honorarios, esquema("yari", [conc])] } as EstadoApp;
  const l = renglon(calcularLiquidacion(e2, PERIODO, liqCon(entradas())), "yari", "c_fijo");
  assert.equal(l.monto, 333.33);   // 1.000 × 10 / 30
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(l.desglose!), 333.33);
});

test("tramo de cash del negocio: tramos completos, y lo que sobra no paga", () => {
  const l = renglon(calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas())), "manu", "c_tramo");
  assert.equal(l.monto, 1000);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [
    ["base", 9500], ["menos", 285], ["igual", 9215],
    ["tramos", 4000], ["igual", 2], ["por", 500], ["igual", 1000],
  ]);
  assert.equal(pasoDe(l, "Tramos completos").nota, "Sobran US$ 1.215: un tramo incompleto no paga");
  assert.equal(l.desglose!.lista!.total, 5);
});

test("tramo de llamadas: cuántas hubo, los tramos completos y lo que sobra", () => {
  const l = renglon(calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas())), "lili", "c_tramo");
  /* 17 de Resell (la cancelada y las orgánicas no cuentan) → 1 tramo de 15, sobran 2. */
  assert.equal(l.monto, 100);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [
    ["base", 17], ["tramos", 15], ["igual", 1], ["por", 100], ["igual", 100],
  ]);
  assert.equal(pasoDe(l, "Llamadas agendadas").texto, "Llamadas agendadas en el mes con utm_source Resell");
  assert.equal(pasoDe(l, "Tramos completos").nota, "Sobran 2: un tramo incompleto no paga");
  assert.equal(l.desglose!.lista, undefined);
});

test("tramo con la cantidad cargada a mano: lo dice, y la cuenta sale de ese número", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas({ "lili:c_tramo": { cantidad: 32 } })));
  const l = renglon(r, "lili", "c_tramo");
  assert.equal(l.monto, 200);
  assert.deepEqual(l.desglose!.pasos.map((p) => [p.op, p.valor]), [
    ["base", 32], ["tramos", 15], ["igual", 2], ["por", 100], ["igual", 200],
  ]);
  assert.ok(l.desglose!.avisos!.some((a) => a.includes("se cargó a mano")));
});

test("pieza: cuántas por la tarifa; sin cargar cuántas, en cero y avisando", () => {
  const e = estadoDePrueba();
  const con = renglon(calcularLiquidacion(e, PERIODO, liqCon(entradas())), "nico", "c_pieza");
  assert.equal(con.monto, 450);
  assert.deepEqual(con.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 3], ["por", 150], ["igual", 450]]);

  const sin = renglon(calcularLiquidacion(e, PERIODO, liqCon({})), "nico", "c_pieza");
  assert.equal(sin.monto, 0);
  assert.ok(sin.falta);
  assert.ok(sin.desglose!.avisos!.includes("Falta cargar cuántas: hasta entonces el renglón va en cero."));
  assert.equal(resultadoDelDesglose(sin.desglose!), 0);
  assert.deepEqual(evaluarPasos(sin.desglose!.pasos).fallas, []);
});

test("bono: lo ganó y no lo ganó", () => {
  const e = estadoDePrueba();
  const gano = renglon(calcularLiquidacion(e, PERIODO, liqCon(entradas())), "manu", "c_bono");
  assert.equal(gano.monto, 500);
  assert.deepEqual(gano.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 500], ["igual", 500]]);
  assert.ok(gano.desglose!.avisos!.includes("Para ganarlo: Cumplir los objetivos del mes."));

  const no = renglon(calcularLiquidacion(e, PERIODO, liqCon(entradas({ "manu:c_bono": { cumplido: false } }))), "manu", "c_bono");
  assert.equal(no.monto, 0);
  assert.deepEqual(no.desglose!.pasos.map((p) => [p.op, p.valor]), [["base", 500], ["por", 0], ["igual", 0]]);
});

test("un renglón corregido a mano guarda lo que daba la cuenta y el porqué", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas({ "mariano:c_com": { monto: 500, nota: "Se acordó redondear" } })));
  const l = renglon(r, "mariano", "c_com");
  assert.equal(l.corregido, true);
  assert.equal(l.monto, 500);
  assert.deepEqual(l.desglose!.correccion, { cuentaDaba: 509.25, nota: "Se acordó redondear" });
  /* La cuenta sigue siendo la de la regla: cierra con lo que daba, no con la corrección. */
  assert.equal(resultadoDelDesglose(l.desglose!), 509.25);
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
});

test("una comisión con su propio % por servicio: la general no cuenta ese servicio y la regla lo dice", () => {
  const e = estadoDePrueba();
  const general = concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión", tasa: 0.15, base: "cash-neto", alcance: "closer" });
  const downsell = concepto({ id: "c_down", tipo: "porcentaje", nombre: "Comisión · Downsell", tasa: 0.05, base: "cash-neto", alcance: "closer", productoIds: ["p_down"] });
  const e2 = { ...e, honorarios: e.honorarios.map((h) => (h.miembroId === "mariano" ? { ...h, conceptos: [general, downsell] } : h)) } as EstadoApp;
  const r = calcularLiquidacion(e2, PERIODO, liqCon(entradas()));
  const g = renglon(r, "mariano", "c_com");
  const d = renglon(r, "mariano", "c_down");
  assert.equal(g.monto, 436.5);      // 15% de 2.910: el downsell no entra acá
  assert.equal(d.monto, 24.25);      // 5% de 485
  assert.match(g.desglose!.regla, /menos Downsell, que tiene su propio %/);
  assert.match(d.desglose!.regla, /sólo Downsell/);
  assert.deepEqual(d.desglose!.lista!.items.map((x) => x.servicio), ["Downsell"]);
  for (const l of [g, d]) assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
});

/* ---------- Lo que queda en la foto del mes ---------- */

test("al cerrar, el desglose viaja en la foto (JSON) sin perder nada y sin números rotos", () => {
  const r = calcularLiquidacion(estadoDePrueba(), PERIODO, liqCon(entradas()));
  const foto = JSON.parse(JSON.stringify(r)) as ResultadoLiquidacion;

  const sinRotos = (x: unknown, ruta: string) => {
    if (typeof x === "number") assert.ok(Number.isFinite(x), `número roto en ${ruta}`);
    else if (Array.isArray(x)) x.forEach((y, i) => sinRotos(y, `${ruta}[${i}]`));
    else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) sinRotos(v, `${ruta}.${k}`);
  };
  sinRotos(foto, "resultado");

  for (const p of foto.personas) {
    for (const l of p.lineas) {
      assert.ok(l.desglose, `${p.nombre}: «${l.nombre}»`);
      assert.equal(resultadoDelDesglose(l.desglose), l.monto);
    }
  }
  /* El peso de la foto sigue siendo razonable. */
  assert.ok(JSON.stringify(foto).length < 60_000, `la foto pesa ${JSON.stringify(foto).length} bytes`);
});

test("una liquidación cerrada antes del desglose se sigue leyendo igual y se puede recalcular con los datos de hoy", () => {
  const e = estadoDePrueba();
  const nueva = calcularLiquidacion(e, PERIODO, liqCon(entradas()));
  /* La foto de antes: sin desglose en ningún renglón. */
  const vieja = JSON.parse(JSON.stringify(nueva)) as ResultadoLiquidacion;
  for (const p of vieja.personas) for (const l of p.lineas) delete l.desglose;
  const cerrada: Liquidacion = { ...liqCon(entradas()), estado: "cerrada", resultado: vieja, cerradaEn: "2026-10-02T12:00:00.000Z" };

  assert.equal(renglon(vieja, "santi", "c_dir").desglose, undefined);
  /* Lo que ya se veía se sigue viendo igual. */
  const sant = vieja.personas.find((p) => p.miembroId === "santi")!;
  assert.match(textoParaEnviar(sant, PERIODO), /Comisión de director: US\$ 145,50 — 5% de US\$ 2\.910 de cash post pasarelas \(2 cobros\)/);
  assert.match(liquidacionCsv(vieja, PERIODO), /Comisión de director/);
  /* Recalculado con los datos de hoy: sí tiene desglose, y el monto coincide mientras nada cambió. */
  const hoy = renglon(calcularLiquidacion({ ...e, liquidaciones: [cerrada] } as EstadoApp, PERIODO, cerrada), "santi", "c_dir");
  assert.ok(hoy.desglose);
  assert.equal(hoy.monto, renglon(vieja, "santi", "c_dir").monto);
});

test("los meses cerrados de un renglón, del más viejo al más nuevo", () => {
  const e = estadoDePrueba();
  const r = calcularLiquidacion(e, PERIODO, liqCon(entradas()));
  const cerrada = (periodo: string): Liquidacion => ({ ...liqCon(entradas(), [], periodo), estado: "cerrada", resultado: r });
  const abierta: Liquidacion = liqCon(entradas(), [], "2026-11");
  const liqs = [cerrada("2026-10"), abierta, cerrada("2026-08")];
  assert.deepEqual(mesesDelRenglon(liqs, "santi", "c_dir"), ["2026-08", "2026-10"]);
  assert.deepEqual(mesesDelRenglon(liqs, "santi", "no_existe"), []);
  assert.deepEqual(mesesDelRenglon(liqs, "nadie", "c_dir"), []);
});

/* ---------- Un descuento con nota para el mes que viene ---------- */

const descuento = (extra: Partial<ExtraLiquidacion> = {}): ExtraLiquidacion => ({
  id: "ext_1", miembroId: "dante", concepto: "Cobro en su cuenta personal", monto: -500, moneda: "USD",
  nota: "Cobró US$ 500 de un cliente en su cuenta personal: descontárselos del pago.",
  creadoEn: "2026-10-07T15:00:00.000Z", creadoPor: "Juan Cruz", desdePeriodo: "2026-09", ...extra,
});

test("el descuento anotado para octubre crea la liquidación de octubre sin tocar nada más", () => {
  const r = conExtraEnMes([], "2026-10", descuento(), "2026-10-07T15:00:00.000Z")!;
  assert.equal(r.liquidaciones.length, 1);
  const liq = r.liquidacion;
  assert.equal(liq.id, "liq_2026-10");
  assert.equal(liq.periodo, "2026-10");
  assert.equal(liq.estado, "abierta");
  assert.deepEqual(liq.entradas, {});
  assert.deepEqual(liq.pagos, {});
  assert.deepEqual(liq.gastoIds, []);
  assert.equal(liq.tipoCambio, undefined);
  assert.equal(liq.resultado, undefined);
  assert.deepEqual(liq.extras, [descuento()]);

  /* Es lo mismo que arma sola la pantalla mientras no existe: el motor da lo mismo para todos. */
  const e = estadoDePrueba();
  const sin = calcularLiquidacion(e, "2026-10", undefined);
  const con = calcularLiquidacion(e, "2026-10", liq);
  const aMano = (l: LineaLiquidada) => ({ clave: l.clave, monto: l.monto });
  for (const p of sin.personas) {
    const q = con.personas.find((x) => x.miembroId === p.miembroId)!;
    if (p.miembroId === "dante") continue;
    assert.deepEqual(q.lineas.map(aMano), p.lineas.map(aMano), p.nombre);
    assert.equal(q.total, p.total);
  }
});

test("al abrir esa liquidación, el descuento sale en la persona, con su nota y quién lo cargó", () => {
  const e = estadoDePrueba();
  const liq = conExtraEnMes([], "2026-10", descuento())!.liquidacion;
  const r = calcularLiquidacion(e, "2026-10", liq);
  const dante = r.personas.find((p) => p.miembroId === "dante")!;
  const l = dante.lineas.find((x) => x.tipo === "extra")!;
  assert.equal(l.nombre, "Cobro en su cuenta personal");
  assert.equal(l.monto, -500);
  assert.equal(l.detalle, "Descuento cargado a mano");
  assert.equal(l.nota, "Cobró US$ 500 de un cliente en su cuenta personal: descontárselos del pago.");
  assert.match(l.cargado!, /^Lo cargó Juan Cruz el .* desde la liquidación de septiembre 2026\.$/);
  /* Descuenta del total de Dante. */
  const sinExtra = calcularLiquidacion(e, "2026-10", undefined).personas.find((p) => p.miembroId === "dante")!;
  assert.equal(dante.total, Math.round((sinExtra.total - 500) * 100) / 100);
  /* Y la nota viaja en «Copiar para mandarle» y en el CSV. */
  const texto = textoParaEnviar(dante, "2026-10");
  assert.match(texto, /• Cobro en su cuenta personal: −US\$ 500 — Descuento cargado a mano\n {3}Nota: Cobró US\$ 500 de un cliente/);
  assert.match(liquidacionCsv(r, "2026-10"), /Descuento cargado a mano · Nota: Cobró US\$ 500 de un cliente en su cuenta personal: descontárselos del pago\./);
});

test("un monto sin nota se ve igual que antes", () => {
  const e = estadoDePrueba();
  const x: ExtraLiquidacion = { id: "ext_2", miembroId: "mariano", concepto: "Adelanto", monto: 200, moneda: "USD" };
  const r = calcularLiquidacion(e, PERIODO, liqCon(entradas(), [x]));
  const l = renglon(r, "mariano", "extra:ext_2");
  assert.equal(l.nota, undefined);
  assert.equal(l.cargado, undefined);
  assert.equal(l.detalle, "Cargado a mano");
  assert.equal(l.desglose, undefined);
  const texto = textoParaEnviar(r.personas.find((p) => p.miembroId === "mariano")!, PERIODO);
  assert.ok(!texto.includes("Nota:"));
});

test("anotar dos veces lo mismo no lo duplica; reabrir y volver a cerrar tampoco lo pierde ni lo duplica", () => {
  const x = descuento();
  const una = conExtraEnMes([], "2026-10", x)!;
  const dos = conExtraEnMes(una.liquidaciones, "2026-10", x)!;
  assert.equal(dos.liquidaciones.length, 1);
  assert.equal(dos.liquidacion.extras.length, 1);
  /* Otro monto en el mismo mes se suma al lado. */
  const otro = conExtraEnMes(dos.liquidaciones, "2026-10", descuento({ id: "ext_2", miembroId: "mariano", monto: 100 }))!;
  assert.deepEqual(otro.liquidacion.extras.map((y) => y.id), ["ext_1", "ext_2"]);

  /* Cerrar guarda la foto; reabrir la saca; las dos conservan lo anotado. */
  const e = estadoDePrueba();
  const abierta = otro.liquidacion;
  const foto = calcularLiquidacion(e, "2026-10", abierta);
  const cerrada: Liquidacion = { ...abierta, estado: "cerrada", resultado: foto, gastoIds: ["gas_1"], cerradaEn: "2026-11-02T12:00:00.000Z", cerradaPor: "Juan Cruz" };
  assert.equal(cerrada.extras.length, 2);
  const reabierta: Liquidacion = { ...cerrada, estado: "abierta", resultado: null, pagos: {}, gastoIds: [], cerradaEn: null, cerradaPor: null };
  assert.equal(reabierta.extras.length, 2);
  const otraVez = calcularLiquidacion(e, "2026-10", reabierta);
  for (const id of ["ext_1", "ext_2"]) {
    const apariciones = otraVez.personas.flatMap((p) => p.lineas).filter((l) => l.extraId === id);
    assert.equal(apariciones.length, 1, `${id} aparece una sola vez`);
  }
  assert.deepEqual(otraVez.total, foto.total);

  /* Un mes cerrado no recibe montos nuevos ni se los sacan. */
  assert.equal(conExtraEnMes([cerrada], "2026-10", descuento({ id: "ext_9" })), null);
  assert.equal(sinExtraEnLiquidacion([cerrada], cerrada.id, "ext_1"), null);
});

test("sacar un monto anotado lo saca de esa liquidación y de ninguna otra", () => {
  const a = conExtraEnMes([], "2026-10", descuento())!;
  const b = conExtraEnMes(a.liquidaciones, "2026-11", descuento({ id: "ext_2" }))!;
  const r = sinExtraEnLiquidacion(b.liquidaciones, "liq_2026-10", "ext_1")!;
  assert.deepEqual(r.liquidaciones.find((l) => l.periodo === "2026-10")!.extras, []);
  assert.deepEqual(r.liquidaciones.find((l) => l.periodo === "2026-11")!.extras.map((x) => x.id), ["ext_2"]);
  assert.equal(sinExtraEnLiquidacion(b.liquidaciones, "liq_2026-10", "ext_que_no_esta"), null);
});

test("lo anotado para los meses que vienen, del más cerca al más lejos, sólo en liquidaciones abiertas", () => {
  const a = conExtraEnMes([], "2026-11", descuento({ id: "ext_nov" }))!;
  const b = conExtraEnMes(a.liquidaciones, "2026-10", descuento({ id: "ext_oct" }))!;
  const c = conExtraEnMes(b.liquidaciones, "2026-09", descuento({ id: "ext_sep" }))!;
  const cerrada: Liquidacion = { ...liquidacionVacia("2026-12"), estado: "cerrada", extras: [descuento({ id: "ext_dic" })] };
  const porVenir = extrasPorVenir([...c.liquidaciones, cerrada], "2026-09");
  assert.deepEqual(porVenir.map((x) => [x.periodo, x.extra.id]), [["2026-10", "ext_oct"], ["2026-11", "ext_nov"]]);
});

test("los meses en los que se puede anotar un monto: el que se mira y los que vienen, sin los cerrados", () => {
  const cerrada = (periodo: string): Liquidacion => ({ ...liquidacionVacia(periodo), estado: "cerrada" });
  /* Mirando septiembre (cerrada), hoy es octubre. */
  assert.deepEqual(
    mesesParaExtra([cerrada("2026-09")], "2026-09", "2026-10"),
    ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"],
  );
  /* Mirando octubre abierta, se puede anotar en la que se mira. */
  assert.equal(mesesParaExtra([cerrada("2026-09")], "2026-10", "2026-10")[0], "2026-10");
  /* Mirando un mes lejano, el de hoy y los dos que siguen también están a mano si están abiertos. */
  assert.deepEqual(mesesParaExtra([cerrada("2026-01")], "2026-01", "2026-10").slice(0, 3), ["2026-02", "2026-03", "2026-04"]);
  assert.ok(mesesParaExtra([cerrada("2026-01")], "2026-01", "2026-10").includes("2026-10"));
  /* Nunca uno anterior al que se mira. */
  assert.ok(mesesParaExtra([], "2026-10", "2026-09").every((p) => p >= "2026-10"));
});

test("un descuento a alguien que ya no está en el equipo no se pierde: sale ese mes con lo único que tiene", () => {
  const e = estadoDePrueba();
  /* Dante se fue el 31/08: en octubre ya no entra entre los que se liquidan. */
  const fuera = { ...e, equipo: e.equipo.map((m) => (m.id === "dante" ? { ...m, activo: false, hasta: "2026-08-31" } : m)) } as EstadoApp;
  const sin = calcularLiquidacion(fuera, "2026-10", undefined);
  assert.ok(!sin.personas.some((p) => p.miembroId === "dante"));
  const liq = conExtraEnMes([], "2026-10", descuento())!.liquidacion;
  const con = calcularLiquidacion(fuera, "2026-10", liq);
  const dante = con.personas.find((p) => p.miembroId === "dante")!;
  assert.ok(dante, "el descuento no se puede perder en silencio");
  assert.equal(dante.inactivo, true);
  assert.equal(dante.sinCargar, undefined);
  assert.deepEqual(dante.lineas.map((l) => [l.tipo, l.monto]), [["extra", -500]]);
  assert.equal(dante.total, -500);
  /* Los demás no cambian. */
  assert.deepEqual(con.personas.filter((p) => p.miembroId !== "dante").map((p) => [p.miembroId, p.total]),
    sin.personas.map((p) => [p.miembroId, p.total]));
});

test("el motor sigue dando lo mismo cuando no hay nada a mano: el mismo resultado con y sin la liquidación vacía", () => {
  const e = estadoDePrueba();
  const a = calcularLiquidacion(e, PERIODO, undefined);
  const b = calcularLiquidacion(e, PERIODO, liquidacionVacia(PERIODO));
  const sinFecha = (r: ResultadoLiquidacion) => ({ ...r, calculadoEn: "" });
  assert.deepEqual(sinFecha(a), sinFecha(b));
});

test("un ex closer sin nada cargado: su comisión sale con la tasa de Finanzas y el desglose lo avisa", () => {
  const e = estadoDePrueba();
  /* Valentín se fue el 30/09 sin esquema; Finanzas le sigue calculando 10% de una venta suya que cobró en septiembre. */
  const ex = { ...e,
    equipo: [...e.equipo, { id: "val", nombre: "Valentín", rol: "closer", comisionRate: 0.1, activo: false, sinComision: false, hasta: "2026-09-30" }],
    ventas: e.ventas.map((v) => (v.id === "v2" ? { ...v, closerId: "val" } : v)),
  } as EstadoApp;
  const r = calcularLiquidacion(ex, PERIODO, liqCon(entradas()));
  const val = r.personas.find((p) => p.miembroId === "val")!;
  assert.ok(val, "sale con la comisión que le calcula Finanzas");
  assert.equal(val.sinCargar, true);
  const l = val.lineas[0];
  assert.equal(l.monto, 48.5);   // 10% de 485
  assert.match(l.detalle, /con la tasa que usa Finanzas/);
  assert.ok(l.desglose!.avisos!.some((a) => a.includes("tasa que usa Finanzas")));
  assert.deepEqual(evaluarPasos(l.desglose!.pasos).fallas, []);
  assert.equal(resultadoDelDesglose(l.desglose!), 48.5);
});

test("quién cargó un monto y cuándo: sin datos no dice nada, y no repite el mes si es el mismo", () => {
  const e = estadoDePrueba();
  const base: ExtraLiquidacion = { id: "x", miembroId: "mariano", concepto: "Adelanto", monto: 100, moneda: "USD" };
  const linea = (x: ExtraLiquidacion, periodo = PERIODO) =>
    renglon(calcularLiquidacion(e, periodo, liqCon(entradas(), [x], periodo)), "mariano", "extra:x");
  assert.equal(linea(base).cargado, undefined, "un monto viejo, sin datos");
  assert.match(linea({ ...base, creadoPor: "Juan Cruz" }).cargado!, /^Lo cargó Juan Cruz\.$/);
  assert.match(linea({ ...base, creadoEn: "2026-09-10T15:00:00.000Z" }).cargado!, /^Lo cargó el .*2026\.$/);
  /* Cargado mirando el mismo mes: no dice «desde la liquidación de…». */
  assert.ok(!linea({ ...base, creadoPor: "Juan Cruz", desdePeriodo: PERIODO }).cargado!.includes("desde"));
  assert.match(linea({ ...base, creadoPor: "Juan Cruz", desdePeriodo: "2026-08" }).cargado!, /desde la liquidación de agosto 2026\.$/);
  /* Una nota en blanco no es una nota. */
  assert.equal(linea({ ...base, nota: "   " }).nota, undefined);
});

test("un monto para quien no sale en la liquidación y está activo (el CEO sin nada cargado) tampoco se pierde", () => {
  const e = estadoDePrueba();
  const sin = calcularLiquidacion(e, PERIODO, liqCon(entradas()));
  assert.ok(!sin.personas.some((p) => p.miembroId === "yari"), "Yari no se liquida");
  const con = calcularLiquidacion(e, PERIODO, liqCon(entradas(), [{ id: "y", miembroId: "yari", concepto: "Reintegro", monto: 80, moneda: "USD" }]));
  const yari = con.personas.find((p) => p.miembroId === "yari")!;
  assert.ok(yari);
  assert.equal(yari.inactivo, undefined);
  assert.equal(yari.sinCargar, undefined);
  assert.deepEqual(yari.lineas.map((l) => [l.tipo, l.monto]), [["extra", 80]]);
});

test("el descuento de un mes no aparece en otro mes ni cambia el profit de los demás", () => {
  const e = estadoDePrueba();
  const liqOct = conExtraEnMes([], "2026-10", descuento())!.liquidacion;
  /* Septiembre, con la liquidación de octubre al lado: nada cambia. */
  const a = calcularLiquidacion({ ...e, liquidaciones: [liqOct] } as EstadoApp, PERIODO, liqCon(entradas()));
  const b = calcularLiquidacion(e, PERIODO, liqCon(entradas()));
  assert.deepEqual({ ...a, calculadoEn: "" }, { ...b, calculadoEn: "" });
  assert.ok(!a.personas.flatMap((p) => p.lineas).some((l) => l.tipo === "extra"));
});

