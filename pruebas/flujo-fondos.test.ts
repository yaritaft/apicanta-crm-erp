import test from "node:test";
import assert from "node:assert/strict";
import { CUENTAS_DISPONIBLES, flujoDeFondos, sumarDias, tasaDeCobro } from "@/lib/flujo-fondos";
import type { SaldoDeCuenta } from "@/lib/saldos-vista";
import { construirSemilla } from "@/lib/seed";
import type { AdInsight, Cuota, EstadoApp, Gasto, Lead, Pago, Procesador, Venta } from "@/lib/types";

/* ==================================================================
   Flujo de fondos (05/11): cuánta plata hay para operar y cómo sigue día por día, con las reglas que dio Aldana el 04/11.
   ================================================================== */

const HOY = "2026-11-05T15:00:00.000Z";
const oct = (d: number) => `2026-10-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const nov = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

const cuenta = (cuentaId: string, saldoBase: number): SaldoDeCuenta => ({ cuentaId, nombre: cuentaId, moneda: "USD", origen: "esperado", saldo: saldoBase, saldoBase });
const CUENTAS = [cuenta("proc_bofa", 50_000), cuenta("proc_mercury", 2_000), cuenta("proc_whop", 1_000), cuenta("proc_trust", 27_000), cuenta("proc_financiera_usd", 49_000), cuenta("proc_galicia_usd", 0)];

const venta = (id: string, estado: Venta["estado"] = "activa"): Venta => ({ id, contactoId: `lead_${id}`, estado, moneda: "USD" } as unknown as Venta);
const cuota = (id: string, ventaId: string, monto: number, vence: string, extra: Partial<Cuota> = {}): Cuota => ({ id, ventaId, numero: 2, monto, vence, estado: "pendiente", esReserva: false, ...extra });
const pago = (id: string, cuotaId: string, procesadorId: string, monto: number, feeMonto: number, fecha: string): Pago =>
  ({ id, cuotaId, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto, fecha, creadoEn: fecha } as Pago);
const gasto = (id: string, categoria: string, monto: number, fecha: string, grupo: Gasto["grupo"] = "operativo"): Gasto =>
  ({ id, categoria, grupo, concepto: id, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha } as Gasto);
const ad = (dia: string, inversion: number): AdInsight => ({ id: `ad_${dia}`, adId: "ad", dia, inversion, impresiones: 0, clicks: 0, leads: 0 } as AdInsight);

function estado(cambios: Partial<EstadoApp> = {}): EstadoApp {
  const s = construirSemilla() as EstadoApp;
  const procesadores: Procesador[] = [
    { id: "proc_hotmart", nombre: "Hotmart", feeRate: 0.1, activo: true, automatico: true, diasDeRetencion: 15, retencionDesde: "2026-10-26" },
    { id: "proc_whop", nombre: "Whop", feeRate: 0.05, activo: true, automatico: true },
  ];
  return {
    ...s, procesadores, devoluciones: [], movimientos: [], adInsights: [],
    ventas: [venta("v1"), venta("v2"), venta("v3", "cancelada")],
    leads: [{ id: "lead_v1", nombre: "Ana" }, { id: "lead_v2", nombre: "Beto" }] as Lead[],
    cuotas: [
      cuota("c1", "v1", 1_000, nov(10)),
      cuota("c2", "v2", 500, nov(20)),
      cuota("c-vencida", "v1", 700, nov(1)),
      cuota("c-baja", "v2", 900, nov(12), { seguimientoCobro: { estado: "baja", por: "Mariano", en: "2026-11-01T15:00:00.000Z" } }),
      cuota("c-cancelada", "v3", 800, nov(12)),
      cuota("c-lejos", "v1", 400, "2026-12-30"),
    ],
    /* Octubre: se cobraron 1.000 por Whop con 50 de comisión (5%). */
    pagos: [pago("p-oct", "c-oct", "proc_whop", 1_000, 50, oct(10))],
    gastos: [
      gasto("sueldos", "Equipo / Salarios", 7_850, oct(3)),
      gasto("software", "Software", 100, oct(31)),
      gasto("ceo", "Honorarios del CEO", 200, oct(15), "dueno"),
      gasto("retiro", "Retiro", 5_000, oct(20), "retiro"),
      gasto("meta-oct", "Meta Ads", 600, oct(20)),
    ],
    ...cambios,
  };
}

test("lo disponible son los bancos y las pasarelas; la Financiera, USDT y lo demás van aparte", () => {
  const f = flujoDeFondos(estado(), CUENTAS, HOY, { dias: 30, ponderar: false });
  assert.equal(f.disponible, 53_000);
  assert.equal(f.aparte, 76_000);
  assert.deepEqual(f.cuentasAparte.map((c) => c.cuentaId), ["proc_trust", "proc_financiera_usd"], "una cuenta en cero no se nombra");
  assert.ok(CUENTAS_DISPONIBLES.has("proc_bofa") && !CUENTAS_DISPONIBLES.has("proc_dlocal"));
});

test("las cuotas entran el día que vencen, sin la comisión de las pasarelas del mes pasado", () => {
  const f = flujoDeFondos(estado(), CUENTAS, HOY, { dias: 30, ponderar: false });
  const cuotas = f.movimientos.filter((m) => m.tipo === "cuota");
  assert.deepEqual(cuotas.map((m) => [m.dia, m.concepto, m.monto]), [[nov(10), "Ana", 950], [nov(20), "Beto", 475]]);
  assert.equal(f.supuestos.comision, 0.05);
  /* La vencida no se proyecta: se cuenta aparte. La dada de baja, la de una venta cancelada y la que vence después del horizonte, no. */
  assert.deepEqual(f.supuestos.vencidas, { cuotas: 1, monto: 700 });
});

test("una cuota cobrada en parte entra por lo que falta", () => {
  const e = estado();
  e.pagos.push(pago("p-c1", "c1", "proc_whop", 400, 0, "2026-11-02T15:00:00.000Z"));
  const f = flujoDeFondos(e, CUENTAS, HOY, { dias: 30, ponderar: false });
  assert.equal(f.movimientos.find((m) => m.dia === nov(10) && m.tipo === "cuota")!.monto, 570);
});

test("lo que salió el mes pasado sale el mismo día; el 31 cae el último día del mes; el retiro del dueño no se repite", () => {
  const f = flujoDeFondos(estado(), CUENTAS, HOY, { dias: 40, ponderar: false });
  const gastos = f.movimientos.filter((m) => m.tipo === "gasto").map((m) => [m.dia, m.concepto, m.monto]);
  assert.deepEqual(gastos, [
    [nov(15), "Honorarios del CEO", -200],
    [nov(30), "Software", -100],
    ["2026-12-03", "Equipo / Salarios", -7_850],
    ["2026-12-15", "Honorarios del CEO", -200],
  ], "el 3/11 ya pasó: los sueldos vuelven el 3/12");
  assert.deepEqual(f.supuestos.salidasDelMesBase.map((s) => s.categoria), ["Equipo / Salarios", "Honorarios del CEO", "Software"]);
});

test("la publicidad sale todos los días al ritmo de los últimos 7 de Meta, no como el mes pasado", () => {
  const ads = [1, 2, 3, 4].map((d) => ad(nov(d), 1_750));
  const f = flujoDeFondos(estado({ adInsights: ads }), CUENTAS, HOY, { dias: 10, ponderar: false });
  assert.equal(f.supuestos.publicidadDiaria, 1_000);
  const pub = f.movimientos.filter((m) => m.tipo === "publicidad");
  assert.equal(pub.length, 10);
  assert.equal(pub[0].dia, nov(6));
  assert.ok(!f.movimientos.some((m) => m.concepto === "Meta Ads"), "el gasto de Meta de octubre no se repite");
});

test("sin datos de Meta, la publicidad sale de lo cargado como gasto en los últimos 7 días", () => {
  const e = estado();
  e.gastos.push(gasto("meta-1", "Meta Ads", 1_400, "2026-11-03T15:00:00.000Z"));
  assert.equal(flujoDeFondos(e, CUENTAS, HOY, { dias: 5, ponderar: false }).supuestos.publicidadDiaria, 200);
});

test("lo que Hotmart retiene entra el día que lo acredita, sin su comisión", () => {
  const e = estado();
  e.pagos.push(pago("h1", "c-h", "proc_hotmart", 300, 30, "2026-11-01T15:00:00.000Z"));
  e.pagos.push(pago("h-viejo", "c-h2", "proc_hotmart", 300, 30, "2026-10-20T15:00:00.000Z"));
  const f = flujoDeFondos(e, CUENTAS, HOY, { dias: 30, ponderar: false });
  const acr = f.movimientos.filter((m) => m.tipo === "acreditacion");
  assert.deepEqual(acr.map((m) => [m.dia, m.monto]), [[nov(16), 270]], "el cobro anterior a la retención ya contaba");
});

test("el saldo sigue día por día, marca el día más justo y cierra en lo que queda", () => {
  const f = flujoDeFondos(estado(), CUENTAS, HOY, { dias: 30, ponderar: false });
  assert.equal(f.dias.length, 31);
  assert.equal(f.dias[0].dia, nov(5));
  assert.equal(f.dias.find((d) => d.dia === nov(10))!.saldo, 53_950);
  /* 30 días desde el 5/11 llegan al 5/12: entran los sueldos del 3/12. */
  assert.equal(f.final, 53_000 + 950 + 475 - 200 - 100 - 7_850);
  assert.equal(f.entra, 1_425);
  assert.equal(f.sale, 8_150);
  assert.equal(f.semanas.length, 5);
  assert.equal(f.semanas[f.semanas.length - 1].saldo, f.final);

  const justo = flujoDeFondos(estado(), [cuenta("proc_mercury", 100)], HOY, { dias: 30, ponderar: false });
  assert.deepEqual(justo.minimo, { dia: "2026-12-03", saldo: 100 + 950 + 475 - 200 - 100 - 7_850 }, "el mínimo es el día que menos queda");
  const corto = flujoDeFondos(estado({ cuotas: [] }), [cuenta("proc_mercury", 1_000)], HOY, { dias: 20, ponderar: false });
  assert.deepEqual(corto.minimo, { dia: nov(15), saldo: 800 }, "el más justo es el primer día que llega a lo más bajo");
});

test("ponderado: las cuotas cuentan por la parte que se suele cobrar, medida con las que vencieron hace entre 15 y 105 días", () => {
  const viejas = Array.from({ length: 10 }, (_, i) => cuota(`h${i}`, "v1", 100, sumarDias("2026-10-01", i), { estado: i < 8 ? "pagada" : "pendiente" }));
  const e = estado();
  e.cuotas.push(...viejas);
  assert.equal(tasaDeCobro(e, "2026-11-05"), 0.8);
  const f = flujoDeFondos(e, CUENTAS, HOY, { dias: 30, ponderar: true });
  assert.equal(f.supuestos.ponderado, true);
  assert.equal(f.movimientos.find((m) => m.dia === nov(10) && m.tipo === "cuota")!.monto, 760);
  assert.equal(tasaDeCobro(estado(), "2026-11-05"), null, "con menos de 10 cuotas no se mide");
  assert.equal(flujoDeFondos(estado(), CUENTAS, HOY, { dias: 30, ponderar: true }).supuestos.ponderado, false);
});
