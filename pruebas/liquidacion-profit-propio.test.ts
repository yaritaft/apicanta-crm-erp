import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, calculaFinanzas, describirConcepto, tasaParaFinanzas } from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import type { ConceptoPago, EstadoApp, LineaLiquidada, Pago, ResultadoLiquidacion, Venta } from "@/lib/types";
import { concepto, esquema, miembro, pago, PERIODO, venta } from "./estado-liquidacion";

/* ==================================================================
   El profit propio, la regla de cuotas y el descuento de la comisión de otro.

   Es la forma en que las hojas de comisión calculan lo que cobra quien reparte
   el profit (el director de tráfico y el socio) y el director de ventas:
   - el director de tráfico arrancó el 11/9: se le imputa el 66,67% de los
     costos del mes (20 de 30 días) y sólo cuentan tres servicios (Resell y
     Upsell quedan afuera), de ventas cerradas desde esa fecha;
   - al socio se le descuenta la comisión del director de tráfico antes de
     aplicar su porcentaje;
   - el socio y el director de ventas empezaron en agosto: las cuotas que se
     cobran en septiembre de ventas anteriores no cuentan;
   - el director de ventas cobra sobre el cash post pasarelas de las ventas
     que dirige.

   Los nombres y los montos son inventados (el caso real es confidencial y
   vive fuera del repo); lo que se prueba es la regla, y las cuentas esperadas
   se rehacen acá, aparte del motor.
   ================================================================== */

const f = (mes: number, d: number) => `2026-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const r2 = (n: number) => Math.round(n * 100) / 100;

const P = { a: "p_a", b: "p_b", c: "p_c", resell: "p_resell", upsell: "p_upsell" };
const SERVICIOS_DE_LA_BASE = [P.a, P.b, P.c];

interface Cobro {
  id: string; producto: string; monto: number; venta: string; cobro: string; closer?: string; director?: string; fee?: number;
}
const COBROS: Cobro[] = [
  /* Cerrada en agosto, cobrada antes del 11/9: cuenta para el socio y el director de ventas, no para el de tráfico. */
  { id: "n1", producto: P.a, monto: 30_000.05, venta: f(8, 20), cobro: f(9, 5), closer: "c1", director: "carla" },
  /* Cerradas desde el 11/9 con closer: cuentan para los tres. El procesamiento (7.000) cae acá. */
  { id: "ab1", producto: P.a, monto: 60_000, venta: f(9, 15), cobro: f(9, 16), closer: "c2", director: "carla", fee: 7_000 },
  { id: "ab2", producto: P.b, monto: 30_000, venta: f(9, 18), cobro: f(9, 19), closer: "c3", director: "carla" },
  { id: "ab3", producto: P.c, monto: 10_000, venta: f(9, 22), cobro: f(9, 23), closer: "c1", director: "carla" },
  /* Cerrada desde el 11/9 sin director (la cerró quien no comisiona): cuenta para tráfico y socio, no para el director de ventas. */
  { id: "ay1", producto: P.a, monto: 20_000, venta: f(9, 25), cobro: f(9, 26), closer: "jefe" },
  /* Cuotas de septiembre de una venta de junio: no cuentan para nadie con regla de cuotas. */
  { id: "old1", producto: P.a, monto: 15_000, venta: f(6, 10), cobro: f(9, 20), closer: "c2", director: "carla" },
  /* Resell y Upsell: quedan fuera de las bases de tráfico y del socio. */
  { id: "re1", producto: P.resell, monto: 4_000, venta: f(9, 14), cobro: f(9, 14), closer: "jefe" },
  { id: "up1", producto: P.upsell, monto: 3_000, venta: f(9, 17), cobro: f(9, 17), closer: "jefe" },
];

const COSTOS = 70_000;
const FEES = 7_000;
const DIRECTOR = 6_150;           // 5% de (30.000,05 + 100.000 − 7.000), a centavos
const BASE_TRAFICO = 60_000 + 30_000 + 10_000 + 20_000;
const BASE_SOCIO = 30_000.05 + BASE_TRAFICO;
const INGRESOS = COBROS.reduce((a, c) => a + c.monto, 0);

function septiembre(extra: { carla?: Partial<ConceptoPago>; ana?: Partial<ConceptoPago>; beto?: Partial<ConceptoPago>; sinDescuento?: boolean } = {}): EstadoApp {
  const equipo = [
    miembro("jefe", "Jefe", "ceo", 0, { sinComision: true }),
    miembro("c1", "Closer Uno", "closer", 0), miembro("c2", "Closer Dos", "closer", 0), miembro("c3", "Closer Tres", "closer", 0),
    /* Finanzas no puede calcular su comisión (regla de cuotas): su tasa para Finanzas es 0. */
    miembro("carla", "Carla Dirección", "director", 0, { puesto: "Director de ventas" }),
    miembro("ana", "Ana Tráfico", "growth", 0),
    miembro("beto", "Beto Socio", "socio", 0),
  ];
  const honorarios = [
    esquema("carla", [concepto({
      id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director",
      desde: "2026-08-01", soloVentasDesdeInicio: true, ...extra.carla,
    })]),
    esquema("ana", [concepto({
      id: "c_ana", tipo: "porcentaje", nombre: "Comisión de tráfico", tasa: 0.05, base: "profit", profitPropio: true,
      productoIds: SERVICIOS_DE_LA_BASE, desde: "2026-09-11", soloVentasDesdeInicio: true, ...extra.ana,
    })]),
    esquema("beto", [concepto({
      id: "c_beto", tipo: "porcentaje", nombre: "Comisión del socio", tasa: 0.10, base: "profit", profitPropio: true,
      productoIds: SERVICIOS_DE_LA_BASE, desde: "2026-08-01", soloVentasDesdeInicio: true,
      ...(extra.sinDescuento ? {} : { descuentaComisionDe: ["ana"] }), ...extra.beto,
    })]),
  ];
  const ventas: Venta[] = COBROS.map((c) => venta({ id: `v_${c.id}`, contactoNombre: `Cliente ${c.id}`, precioAcordado: c.monto, fecha: c.venta, productoId: c.producto, closerId: c.closer, directorId: c.director }));
  const cuotas = COBROS.map((c) => ({ id: `c_${c.id}`, ventaId: `v_${c.id}`, numero: 1, monto: c.monto, estado: "pagada", esReserva: false }));
  const pagos: Pago[] = COBROS.map((c) => pago(`p_${c.id}`, `c_${c.id}`, c.monto, c.fee ?? 0, c.cobro, "proc_stripe"));
  /* Los costos del mes son 70.000: lo que ya está en Finanzas son los procesadores y un gasto operativo;
     lo que falta lo pone la comisión del director de ventas, que entra a la liquidación. */
  const gastos = [{
    id: "g1", categoria: "Costos del mes", grupo: "operativo", concepto: "Costos y gastos del mes",
    monto: r2(COSTOS - FEES - DIRECTOR), moneda: "USD", fecha: f(9, 15), recurrente: false, creadoEn: f(9, 15), extra: {},
  }];
  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500 },
    equipo, honorarios, ventas, cuotas, pagos, gastos, sesiones: [], liquidaciones: [], devoluciones: [],
    productos: [
      { id: P.a, nombre: "Servicio A" }, { id: P.b, nombre: "Servicio B" }, { id: P.c, nombre: "Servicio C" },
      { id: P.resell, nombre: "Resell" }, { id: P.upsell, nombre: "Upsell" },
    ],
    procesadores: [{ id: "proc_stripe", nombre: "Stripe" }],
  } as unknown as EstadoApp;
}

const linea = (r: ResultadoLiquidacion, miembroId: string, conceptoId: string): LineaLiquidada => {
  const l = r.personas.find((p) => p.miembroId === miembroId)?.lineas.find((x) => x.conceptoId === conceptoId);
  assert.ok(l, `falta el renglón ${conceptoId} de ${miembroId}`);
  return l;
};

/* Las cuentas, rehechas a mano. */
const TRAFICO = r2(r2(BASE_TRAFICO - r2(COSTOS * 0.6667)) * 0.05);            // 66,67% de los costos
const SOCIO = r2(r2(BASE_SOCIO - COSTOS - TRAFICO) * 0.10);                    // le descuenta la de tráfico

test("el caso completo: tráfico, socio y director de ventas, con el profit operativo que da Finanzas", () => {
  const r = calcularLiquidacion(septiembre(), PERIODO);
  assert.equal(r.profit, r2(INGRESOS - COSTOS));
  assert.equal(linea(r, "ana", "c_ana").monto, TRAFICO);
  assert.equal(linea(r, "beto", "c_beto").monto, SOCIO);
  assert.equal(linea(r, "carla", "c_dir").monto, DIRECTOR);
  /* Y los números a ojo, para que un error de las cuentas de arriba no pase desapercibido. */
  assert.equal(TRAFICO, 3_666.55);
  assert.equal(SOCIO, 7_633.35);
});

test("las bases de cada uno: sólo sus servicios, sólo ventas desde su inicio", () => {
  const r = calcularLiquidacion(septiembre(), PERIODO);
  const base = (m: string, c: string) => linea(r, m, c).desglose!.pasos[0].valor;
  assert.equal(base("ana", "c_ana"), BASE_TRAFICO);
  assert.equal(base("beto", "c_beto"), r2(BASE_SOCIO));
  /* El director de ventas: el cash de las ventas que dirige, antes de restar el procesamiento. */
  assert.equal(base("carla", "c_dir"), 130_000.05);
  assert.equal(linea(r, "carla", "c_dir").medido, 123_000.05);
});

test("al de tráfico se le imputa el 66,67% de los costos (20 de 30 días) y al socio todos", () => {
  const r = calcularLiquidacion(septiembre(), PERIODO);
  const trafico = linea(r, "ana", "c_ana").desglose!;
  const costos = trafico.pasos.find((p) => p.op === "menos")!;
  assert.equal(costos.valor, 46_669);
  assert.match(costos.nota ?? "", /66,67%/);
  const socio = linea(r, "beto", "c_beto").desglose!;
  const menos = socio.pasos.filter((p) => p.op === "menos");
  assert.equal(menos[0].valor, COSTOS);
  /* Y le descuenta la comisión de tráfico antes de sacar su porcentaje. */
  assert.equal(menos[1].valor, TRAFICO);
  assert.match(menos[1].texto, /Ana Tráfico/);
});

test("cada desglose cierra con el monto del renglón", () => {
  const r = calcularLiquidacion(septiembre(), PERIODO);
  for (const [m, c] of [["ana", "c_ana"], ["beto", "c_beto"], ["carla", "c_dir"]] as const) {
    const l = linea(r, m, c);
    const ev = evaluarPasos(l.desglose!.pasos);
    assert.deepEqual(ev.fallas, [], `${m}: ${ev.fallas.join(" ")}`);
    assert.equal(resultadoDelDesglose(l.desglose!), l.monto, m);
  }
});

test("las cuotas de ventas anteriores a su inicio no cuentan, aunque se cobren dentro de los días de la regla", () => {
  /* Sin la regla de cuotas, el socio suma también las 15.000 de la venta de junio. */
  const sin = calcularLiquidacion(septiembre({ beto: { soloVentasDesdeInicio: false } }), PERIODO);
  assert.equal(linea(sin, "beto", "c_beto").desglose!.pasos[0].valor, r2(BASE_SOCIO + 15_000));
  const con = calcularLiquidacion(septiembre(), PERIODO);
  assert.equal(linea(con, "beto", "c_beto").desglose!.pasos[0].valor, r2(BASE_SOCIO));
});

test("los servicios que no se eligen (Resell y Upsell) están en el ingreso pero no en la base", () => {
  const r = calcularLiquidacion(septiembre(), PERIODO);
  assert.equal(linea(r, "beto", "c_beto").desglose!.pasos[0].valor, r2(INGRESOS - 15_000 - 4_000 - 3_000));
});

test("sin descontar la comisión de tráfico, el socio cobra más: es lo que cambia el descuento", () => {
  const r = calcularLiquidacion(septiembre({ sinDescuento: true }), PERIODO);
  assert.equal(linea(r, "beto", "c_beto").monto, r2(r2(BASE_SOCIO - COSTOS) * 0.10));
  assert.equal(linea(r, "ana", "c_ana").monto, TRAFICO);
});

test("con una base que no cubre los costos no hay profit para repartir: cero, no negativo", () => {
  const e = septiembre();
  e.gastos = [...e.gastos, { ...e.gastos[0], id: "g2", monto: 500_000 }];
  const r = calcularLiquidacion(e, PERIODO);
  assert.equal(linea(r, "ana", "c_ana").monto, 0);
  const d = linea(r, "ana", "c_ana").desglose!;
  assert.equal(evaluarPasos(d.pasos).fallas.length, 0);
  assert.ok(d.avisos?.some((a) => /no cubre los costos/.test(a)));
});

test("lo que Finanzas no puede calcular entra como costo de la liquidación y no se cuenta dos veces", () => {
  const e = septiembre();
  const esq = e.honorarios.find((h) => h.miembroId === "carla")!;
  assert.equal(calculaFinanzas({ rol: "director" }, esq.conceptos[0]), false);
  assert.equal(tasaParaFinanzas({ rol: "director" }, esq), 0);
  assert.equal(linea(calcularLiquidacion(e, PERIODO), "carla", "c_dir").enFinanzas, false);
  /* Sin la regla de cuotas, el director vuelve a ser un renglón de Finanzas, como siempre. */
  assert.equal(calculaFinanzas({ rol: "director" }, { ...esq.conceptos[0], soloVentasDesdeInicio: false }), true);
  /* Y el profit propio de un socio tampoco lo calcula Finanzas. */
  const socio: ConceptoPago = { id: "x", tipo: "porcentaje", nombre: "x", moneda: "USD", base: "profit", tasa: 0.1 };
  assert.equal(calculaFinanzas({ rol: "socio" }, socio), true);
  assert.equal(calculaFinanzas({ rol: "socio" }, { ...socio, profitPropio: true }), false);
});

test("apagado por defecto: un % del profit sin las opciones nuevas da lo de siempre (el profit de toda la empresa)", () => {
  const e = septiembre();
  e.honorarios = [esquema("ana", [concepto({ id: "c_viejo", tipo: "porcentaje", nombre: "Parte del profit", tasa: 0.05, base: "profit" })])];
  const r = calcularLiquidacion(e, PERIODO);
  assert.equal(linea(r, "ana", "c_viejo").monto, r2(r.profit * 0.05));
  assert.equal(linea(r, "ana", "c_viejo").desglose!.pasos.some((p) => /Cobrado de las ventas que le tocan/.test(p.texto)), false);
});

test("la regla dicha en castellano nombra el profit propio, los servicios, la regla de cuotas y a quién se descuenta", () => {
  const e = septiembre();
  const c = e.honorarios.find((h) => h.miembroId === "beto")!.conceptos[0];
  const frase = describirConcepto(c, e as never);
  assert.match(frase, /10% del profit propio/);
  assert.match(frase, /Servicio A, Servicio B, Servicio C/);
  assert.match(frase, /sólo ventas cerradas desde el inicio/);
  assert.match(frase, /sin la comisión de Ana Tráfico/);
});
