import test from "node:test";
import assert from "node:assert/strict";
import { cajaEsperada, cobrosSinVentaPorCuenta } from "@/lib/caja";
import { controlarSaldos, type SaldoReal } from "@/lib/saldos-reales";
import { flujoDelPeriodo, saldosPorCuenta, type SaldoDeCuenta } from "@/lib/saldos-vista";
import { saldosEsperados } from "@/lib/traspasos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto, Movimiento, Pago, Procesador, Traspaso } from "@/lib/types";
import { estadoDeYari } from "./estado-devolucion";

/* ==================================================================
   Saldos (01/11): Juan Cruz le prometió a Aldana «una que sea saldo, cosa de que podamos ver fácil cuánta plata hay en cada plataforma».
   Nada se inventa: lo que lee el banco sale igual que en el Control de saldos, y lo demás igual que la columna «Tendría que haber» del arqueo.
   ================================================================== */

const proc = (id: string, nombre: string, extra: Partial<Procesador> = {}): Procesador => ({ id, nombre, feeRate: 0, activo: true, automatico: true, ...extra });
const PROCESADORES: Procesador[] = [
  proc("proc_stripe", "Stripe"), proc("proc_mercury", "ACH-WIRE Mercury"), proc("proc_trust", "USDT Trust"),
  proc("proc_whop", "Whop"), proc("proc_hotmart", "Hotmart"), proc("proc_bofa", "Bank of America"),
  proc("proc_fin_ars", "Financiera ARS Juan", { moneda: "ARS" }),
  proc("proc_efectivo", "Efectivo USD"), proc("proc_galicia", "Galicia (USD)"), proc("proc_paypal", "PayPal", { activo: false }),
];

const ARQUEO = "2026-10-01T15:00:00.000Z";
const AHORA = "2026-10-20T18:00:00.000Z";
const dia = (d: number, h = 15) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const pago = (id: string, procesadorId: string, monto: number, feeMonto: number, fecha: string, extra: Partial<Pago> = {}): Pago => ({
  id, cuotaId: `cuota_${id}`, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto, fecha, creadoEn: fecha, ...extra,
});
const gasto = (id: string, monto: number, fecha: string, extra: Record<string, unknown> = {}): Gasto => ({
  id, categoria: "Software", grupo: "operativo", concepto: id, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha, extra,
});
const pase = (id: string, origenId: string, destinoId: string, monto: number, fecha: string): Traspaso => ({
  id, fecha, origenId, destinoId, montoSale: monto, monedaSale: "USD", montoLlega: monto, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: fecha,
});
const real = (cuentaId: string, saldo: number, extra: Partial<SaldoReal> = {}): SaldoReal => ({ cuentaId, saldo, moneda: "USD", al: AHORA, fuente: "el banco", ...extra });

/* El arqueo del 1/10: no cuenta Bank of America ni Galicia. Desde entonces: Whop cobró 50 (5 de comisión), la Financiera en pesos cobró
   300.000, se pagaron 100 desde Mercury y Mercury mandó 400 a Bank of America. */
function estado(cambios: Partial<EstadoApp> = {}, tipoCambio = 1500): EstadoApp {
  const s = construirSemilla() as EstadoApp;
  const saldos = [
    { procesadorId: "proc_stripe", monto: 100, moneda: "USD" as const, montoBase: 100 },
    { procesadorId: "proc_mercury", monto: 1000, moneda: "USD" as const, montoBase: 1000 },
    { procesadorId: "proc_trust", monto: 500, moneda: "USD" as const, montoBase: 500 },
    { procesadorId: "proc_whop", monto: 200, moneda: "USD" as const, montoBase: 200 },
    { procesadorId: "proc_hotmart", monto: 0, moneda: "USD" as const, montoBase: 0 },
    { procesadorId: "proc_fin_ars", monto: 1_500_000, moneda: "ARS" as const, montoBase: 1000 },
    { procesadorId: "proc_efectivo", monto: 300, moneda: "USD" as const, montoBase: 300 },
  ];
  return {
    ...s, procesadores: PROCESADORES, ventas: [], cuotas: [], movimientos: [], devoluciones: [],
    ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio },
    arqueos: [{ id: "a1", fecha: ARQUEO, saldos, total: 3000, tipoCambio: 1500, creadoEn: ARQUEO }],
    pagos: [
      pago("w1", "proc_whop", 50, 5, dia(10)),
      pago("f1", "proc_fin_ars", 200, 0, dia(10), { tipoCambio: 1500, montoArs: 300_000 }),
    ],
    gastos: [gasto("hosting", 100, dia(12), { cuenta: "Mercury" })],
    traspasos: [pase("p1", "proc_mercury", "proc_bofa", 400, dia(15))],
    ...cambios,
  } as EstadoApp;
}
const cuenta = (v: { cuentas: SaldoDeCuenta[] }, id: string) => v.cuentas.find((c) => c.cuentaId === id)!;

test("sin leer ningún banco: cada cuenta muestra lo que la app espera, igual que «Tendría que haber» del arqueo", () => {
  const e = estado();
  const v = saldosPorCuenta(e, [], AHORA);
  const esperados = saldosEsperados(e, e.arqueos![0], AHORA);
  /* Lo del arqueo: lo de antes, más lo cobrado neto, más o menos los pases, menos lo que salió de esa cuenta. */
  assert.equal(cuenta(v, "proc_stripe").saldo, 100);
  assert.equal(cuenta(v, "proc_mercury").saldo, 500, "1.000 − 100 de hosting − 400 que mandó a Bank of America");
  assert.equal(cuenta(v, "proc_whop").saldo, 245, "200 + 50 − 5 de comisión");
  assert.equal(cuenta(v, "proc_trust").saldo, 500);
  assert.equal(cuenta(v, "proc_hotmart").saldo, 0, "una cuenta sin plata se muestra: Hotmart en cero es un dato");
  for (const c of v.cuentas.filter((x) => x.origen === "esperado")) {
    assert.equal(c.saldo, esperados.get(c.cuentaId)!.esperado, `${c.nombre}: el mismo número que el arqueo`);
  }
  assert.ok(v.cuentas.every((c) => c.origen !== "real"));
  assert.equal(v.porOrigen.real, 0);
  assert.equal(v.desde, ARQUEO);
});

test("las que se leen solas muestran el saldo real y la fila del Control de saldos, sin reinterpretarla", () => {
  const e = estado();
  const reales = [real("proc_mercury", 500), real("proc_trust", 508.5), real("proc_stripe", 100)];
  const v = saldosPorCuenta(e, reales, AHORA);
  const control = controlarSaldos(e, reales, AHORA);
  for (const f of control.filas) {
    const c = cuenta(v, f.cuentaId);
    assert.equal(c.origen, "real");
    assert.equal(c.saldo, f.real, `${f.nombre}: lo que hay de verdad`);
    assert.deepEqual(c.control, f, `${f.nombre}: la misma fila que el Control de saldos`);
  }
  assert.equal(cuenta(v, "proc_mercury").control!.lectura, "da");
  assert.equal(cuenta(v, "proc_trust").control!.lectura, "sobra", "8,50 más de lo esperado: falta cargar un cobro");
  assert.equal(cuenta(v, "proc_trust").control!.diferencia, 8.5);
  /* Lo leído reemplaza lo esperado, no se suma. */
  assert.equal(v.cuentas.filter((c) => c.cuentaId === "proc_mercury").length, 1);
  assert.equal(v.porOrigen.real, 1108.5);
});

test("una cuenta en pesos se pasa a dólares con el tipo de cambio de Ajustes, y muestra los pesos", () => {
  const v = saldosPorCuenta(estado(), [], AHORA);
  const f = cuenta(v, "proc_fin_ars");
  assert.equal(f.moneda, "ARS");
  assert.equal(f.saldo, 1_800_000, "1.500.000 del arqueo + 300.000 cobrados en pesos");
  assert.equal(f.saldoBase, 1200, "a $ 1.500 por dólar");
  assert.equal(v.sinCambio.length, 0);
  /* Con otro cambio en Ajustes, otro valor: no usa el del arqueo. */
  assert.equal(cuenta(saldosPorCuenta(estado({}, 1800), [], AHORA), "proc_fin_ars").saldoBase, 1000);
});

test("pesos sin tipo de cambio en Ajustes: la cuenta no entra al total y se avisa, no se cuenta como cero", () => {
  const v = saldosPorCuenta(estado({}, 0), [], AHORA);
  const f = cuenta(v, "proc_fin_ars");
  assert.equal(f.sinCambio, true);
  assert.equal(f.saldoBase, undefined);
  assert.equal(f.saldo, 1_800_000, "se muestra en pesos");
  assert.deepEqual(v.sinCambio.map((c) => c.cuentaId), ["proc_fin_ars"]);
  const sin = saldosPorCuenta(estado(), [], AHORA);
  assert.equal(v.total, Math.round((sin.total - 1200) * 100) / 100, "el total es el de siempre sin los pesos");
});

test("una cuenta que no estaba en el último arqueo muestra sólo lo que se movió desde entonces y dice que falta contarla", () => {
  const v = saldosPorCuenta(estado(), [], AHORA);
  const b = cuenta(v, "proc_bofa");
  assert.equal(b.origen, "parcial");
  assert.equal(b.saldo, 400, "los 400 que le mandó Mercury");
  assert.equal(b.partida, undefined);
  assert.equal(b.pases, 400);
  /* Entra al total: esa plata salió de Mercury, y si no se sumara acá la suma de las cuentas perdería 400. */
  assert.equal(v.porOrigen.parcial, 400);
});

test("las cuentas de «Otros» sin saldo van aparte; las que tienen plata se muestran; las inactivas sin movimiento no aparecen", () => {
  const v = saldosPorCuenta(estado(), [], AHORA);
  assert.deepEqual(v.aparte.map((c) => c.cuentaId), ["proc_galicia"], "Galicia: activa, no estaba en el arqueo y no se movió");
  assert.equal(cuenta(v, "proc_efectivo").saldo, 300, "el efectivo tiene plata: se muestra");
  assert.ok(![...v.cuentas, ...v.aparte].some((c) => c.cuentaId === "proc_paypal"), "PayPal está inactiva y no se movió");
});

test("una cuenta nueva sin ningún movimiento aparece «sin dato», no en cero", () => {
  const e = estado({ procesadores: [...PROCESADORES, proc("proc_nueva", "Payoneer")] });
  const c = cuenta(saldosPorCuenta(e, [], AHORA), "proc_nueva");
  assert.equal(c.origen, "sin-dato");
  assert.equal(c.saldo, undefined);
  assert.equal(c.saldoBase, undefined);
});

test("el total es la suma de las cuentas y se ordena de la que más tiene a la que menos", () => {
  const v = saldosPorCuenta(estado(), [real("proc_mercury", 520)], AHORA);
  const suma = v.cuentas.reduce((a, c) => a + (c.saldoBase ?? 0), 0);
  assert.equal(v.total, Math.round(suma * 100) / 100);
  assert.equal(v.total, 520 + 100 + 500 + 245 + 0 + 400 + 1200 + 300, "Mercury real 520 + Stripe + Trust + Whop + Hotmart + Bank of America + Financiera + efectivo");
  const bases = v.cuentas.map((c) => c.saldoBase ?? -Infinity);
  assert.deepEqual(bases, [...bases].sort((a, b) => b - a));
});

test("los cobros que ya entraron a una cuenta y no tienen su venta están en el saldo esperado, como en el arqueo", () => {
  const movimiento: Movimiento = {
    id: "m1", proveedor: "whop", procesadorId: "proc_whop", referencia: "m1", monto: 1200, moneda: "USD", fee: 40, neto: 1160, fecha: dia(14),
    clienteNombre: "Cliente", estado: "pendiente", origen: "api", creadoEn: dia(14),
  } as Movimiento;
  const e = estado({ movimientos: [movimiento] });
  const w = cuenta(saldosPorCuenta(e, [], AHORA), "proc_whop");
  const sinVenta = cobrosSinVentaPorCuenta(e, ARQUEO, AHORA, 1500).get("proc_whop")!.monto;
  assert.equal(sinVenta, 1160);
  assert.equal(w.saldo, 245 + 1160);
  assert.equal(w.sinVenta, 1160, "la cuenta dice cuánto de su saldo es de cobros sin venta");
});

test("contra la Caja esperada: es la misma cuenta de la Caja, y las partes más el resto siempre dan la diferencia", () => {
  const e = estado();
  const v = saldosPorCuenta(e, [real("proc_mercury", 505)], AHORA);
  const c = v.contraLaCaja!;
  const caja = cajaEsperada(e, e.arqueos![0], AHORA);
  assert.equal(c.cajaEnCuentas, caja.enCuentas, "el mismo número de la Caja");
  assert.equal(c.sumaDeCuentas, v.total);
  assert.equal(c.diferencia, Math.round((v.total - caja.enCuentas) * 100) / 100);
  assert.equal(c.comisiones, caja.comisiones);
  assert.equal(c.bancosMarcan, 5, "Mercury marca 5 más de lo que la app esperaba");
  /* Las partes más el resto dan la diferencia, siempre. */
  const partes = c.comisiones + c.reparto + c.sinCuenta + c.sinVenta + c.bancosMarcan + c.resto;
  assert.ok(Math.abs(partes - c.diferencia) < 0.011, `${partes} contra ${c.diferencia}`);
});

test("contra la Caja esperada, con el caso de Yari: la única diferencia son las comisiones de Mariano y Santi que la Caja ya descontó", () => {
  /* Stripe arranca con 10.000; el 01/10 cobra 1.500 con 45 de comisión (entran 1.455). Mariano (15%) y Santi (5%) ganan 291 que se pagan
     a mes vencido: la Caja ya los descontó, Stripe no los pagó. */
  const arqueo = { id: "a1", fecha: "2026-09-30T23:00:00.000Z", saldos: [{ procesadorId: "proc_stripe", monto: 10000, moneda: "USD" as const, montoBase: 10000 }], total: 10000, creadoEn: "2026-09-30T23:00:00.000Z" };
  const e = estadoDeYari({ arqueos: [arqueo] });
  const ahora = "2026-10-20T18:00:00.000Z";
  const v = saldosPorCuenta(e, [real("proc_stripe", 11455)], ahora);
  assert.equal(cuenta(v, "proc_stripe").control!.lectura, "da", "Stripe tiene lo que la app esperaba");
  assert.equal(v.total, 11455);
  const c = v.contraLaCaja!;
  assert.equal(c.cajaEnCuentas, 11164, "10.000 + 1.500 cobrados − 45 de Stripe − 291 de comisiones");
  assert.equal(c.diferencia, 291);
  assert.equal(c.comisiones, 291);
  assert.deepEqual([c.reparto, c.sinCuenta, c.sinVenta, c.bancosMarcan, c.resto], [0, 0, 0, 0, 0], "no queda nada sin explicar");
});

test("sin ningún arqueo no hay con qué comparar: sólo se ven las cuentas que se leen solas", () => {
  const e = estado({ arqueos: [] });
  const v = saldosPorCuenta(e, [real("proc_trust", 700)], AHORA);
  assert.equal(v.contraLaCaja, undefined);
  assert.equal(v.desde, undefined);
  assert.equal(cuenta(v, "proc_trust").origen, "real");
  assert.equal(cuenta(v, "proc_trust").control!.lectura, "sin-punto-de-partida");
  assert.ok(v.cuentas.filter((c) => c.origen !== "real").every((c) => c.origen === "sin-dato"), "nada de «parcial» con toda la historia");
  assert.equal(v.total, 700);
});

/* ---------- Entró y salió ---------- */

test("entró y salió de un mes usa la cuenta de la Caja y el primer instante del mes cuenta", () => {
  const e = estado({
    gastos: [
      gasto("al-instante", 70, "2026-10-01T03:00:00.000Z"),   // 00:00 del 1/10 en Argentina: es de octubre
      gasto("hosting", 100, dia(12), { cuenta: "Mercury" }),
      gasto("de-septiembre", 999, "2026-09-30T20:00:00.000Z"), // 17:00 del 30/9: no
      gasto("de-noviembre", 888, "2026-11-01T03:00:00.000Z"),  // 00:00 del 1/11: no
    ],
  });
  const f = flujoDelPeriodo(e, new Date("2026-10-01T03:00:00.000Z"), new Date("2026-11-01T02:59:59.999Z"));
  const gastos = f.partes.find((p) => p.id === "gastos")!.monto;
  assert.equal(gastos, 170, "70 del primer instante + 100 de hosting");
  assert.equal(f.salio, Math.round(f.partes.reduce((a, p) => a + p.monto, 0) * 100) / 100);
  assert.equal(f.neto, Math.round((f.entro - f.salio) * 100) / 100);
  /* Coincide con la cuenta de la Caja para el mismo tramo. */
  const caja = cajaEsperada(e, { fecha: "2026-10-01T02:59:59.999Z", total: 0 }, "2026-11-01T02:59:59.999Z");
  assert.equal(f.entro, caja.cobrado);
  assert.equal(gastos, caja.gastos);
  assert.deepEqual(f.partes.map((p) => p.id), ["gastos", "comisiones", "procesador", "devoluciones", "reparto", "retiros"]);
});

test("entró y salió de un período sin movimientos da cero, no se rompe", () => {
  const f = flujoDelPeriodo(estado({ pagos: [], gastos: [], traspasos: [] }), new Date("2026-08-01T03:00:00.000Z"), new Date("2026-09-01T02:59:59.999Z"));
  assert.deepEqual([f.entro, f.salio, f.neto], [0, 0, 0]);
});
