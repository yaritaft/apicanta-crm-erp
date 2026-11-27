import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion } from "@/lib/honorarios";
import { comisionesDelMes } from "@/lib/finanzas";
import { reversasDeComision } from "@/lib/devoluciones";
import { metricasDeWebinar } from "@/lib/webinar";
import { comprobanteRechazado } from "@/lib/comision";
import { pagoEnOtraPasarela } from "@/lib/pasarela-equivocada";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Movimiento, Pago, Procesador } from "@/lib/types";
import { devolucion, estadoDeYari, OCTUBRE, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   Aldana (27/11):
   1. «¿Se puede poner que cuando se rechace el comprobante no les sume comisión
      a los closers? Cargan las ventas con la primera opción que aparece, que es
      Stripe, en vez de buscar Whop.»
   2. El arqueo le dio US$ 2.427 de más en Stripe: el cobro de US$ 2.500 de Juan
      Marcelo Arpi estaba cargado en Stripe y había entrado por Whop.
   ================================================================== */

const r2 = (x: number) => Math.round(x * 100) / 100;
const rechazar = (e: EstadoApp, id: string, quien: "chequeoFinanzas" | "chequeoDirector" = "chequeoFinanzas"): EstadoApp =>
  ({ ...e, pagos: e.pagos.map((p) => (p.id === id ? { ...p, [quien]: "rechazado", [`${quien}Nota`]: "Es Whop, no Stripe" } as Pago : p)) });

const deMariano = (e: EstadoApp, mes: string) =>
  r2(comisionesDelMes(e, rangoDePeriodo(mes)).filter((c) => c.closerId === "mariano").reduce((a, c) => a + c.comisionCloser, 0));
const liqDe = (e: EstadoApp, mes: string, id = "mariano") =>
  calcularLiquidacion(e, mes, undefined).personas.find((p) => p.miembroId === id)?.lineas.filter((l) => l.tipo !== "devolucion") ?? [];
const liqMariano = (e: EstadoApp, mes: string) => r2(liqDe(e, mes).reduce((a, l) => a + l.monto, 0));
const liqSanti = (e: EstadoApp, mes: string) => r2(liqDe(e, mes, "santi").reduce((a, l) => a + l.monto, 0));

test("comprobanteRechazado: lo rechace finanzas o el director; chequeado o sin mirar, no", () => {
  assert.equal(comprobanteRechazado({ chequeoFinanzas: "rechazado" }), true);
  assert.equal(comprobanteRechazado({ chequeoDirector: "rechazado" }), true);
  assert.equal(comprobanteRechazado({ chequeoFinanzas: "chequeado", chequeoDirector: null }), false);
  assert.equal(comprobanteRechazado({}), false);
});

test("un cobro con el comprobante rechazado no le comisiona al closer, en Finanzas ni en la liquidación (y dan lo mismo)", () => {
  const e = estadoDeYari();
  /* Septiembre: 15% de 1.455 = 218,25. */
  assert.equal(deMariano(e, SEPTIEMBRE), 218.25);
  assert.equal(liqMariano(e, SEPTIEMBRE), 218.25);
  const r = rechazar(e, "p1");
  assert.equal(deMariano(r, SEPTIEMBRE), 0);
  assert.equal(liqMariano(r, SEPTIEMBRE), 0);
  /* Octubre (el otro cobro, sin rechazar) no cambia. */
  assert.equal(deMariano(r, OCTUBRE), 218.25);
  assert.equal(liqMariano(r, OCTUBRE), 218.25);
});

test("Finanzas dice cuánto no se pagó por el rechazo, y el director y el Cash Collected no cambian", () => {
  const r = rechazar(estadoDeYari(), "p1", "chequeoDirector");
  const fila = comisionesDelMes(r, rangoDePeriodo(SEPTIEMBRE)).find((c) => c.closerId === "mariano")!;
  assert.deepEqual(fila.porRechazo, { cobros: 1, comision: 218.25 });
  assert.equal(fila.comisionDirector, 72.75, "el director sigue igual: Aldana pidió los closers");
  assert.equal(liqSanti(r, SEPTIEMBRE), liqSanti(estadoDeYari(), SEPTIEMBRE));
  assert.equal(fila.cobradoEnMes, 1500, "la plata sigue contando");
});

test("«Cómo se calculó» explica por qué ese cobro no entra", () => {
  const r = rechazar(estadoDeYari(), "p1");
  const l = liqDe(r, SEPTIEMBRE).find((x) => x.monto === 0 && x.desglose)!;
  const excluidos = JSON.stringify(l.desglose);
  assert.match(excluidos, /El comprobante está rechazado: comisiona cuando se corrija/);
});

test("al corregirlo (la base borra los chequeos) vuelve a comisionar", () => {
  const r = rechazar(estadoDeYari(), "p1");
  const corregido: EstadoApp = { ...r, pagos: r.pagos.map((p) => (p.id === "p1" ? { ...p, chequeoFinanzas: undefined, chequeoFinanzasNota: undefined } as Pago : p)) };
  assert.equal(deMariano(corregido, SEPTIEMBRE), 218.25);
  assert.equal(liqMariano(corregido, SEPTIEMBRE), 218.25);
});

test("si se devuelve una venta con un cobro rechazado, no se le revierte lo que nunca se le pagó", () => {
  const base = { ...estadoDeYari(), devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: "2026-10-03T15:00:00.000Z" })] } as EstadoApp;
  const antes = reversasDeComision(base)[0].partes.find((p) => p.rol === "closer")!;
  const r = rechazar(base, "p1");
  const despues = reversasDeComision(r)[0].partes.find((p) => p.rol === "closer")!;
  assert.equal(antes.comision, 436.5);
  assert.equal(despues.comision, 218.25, "sólo lo del cobro que sí comisionó");
});

test("el resultado del webinar tampoco cuenta la comisión de un cobro rechazado", () => {
  const e = { ...estadoDeYari(), webinars: [{ id: "w1", titulo: "W", fecha: "2026-09-20T15:00:00.000Z", inversion: 0, inversionDmAds: 0, costoWhatsappApi: 0, llamadasVivo: 0, llamadasPosterior: 0 }] } as unknown as EstadoApp;
  const conWeb: EstadoApp = { ...e, ventas: e.ventas.map((v) => ({ ...v, webinarId: "w1" })) };
  const m1 = metricasDeWebinar(conWeb, conWeb.webinars[0]) as unknown as { comisiones: number };
  const m2 = metricasDeWebinar(rechazar(conWeb, "p1"), conWeb.webinars[0]) as unknown as { comisiones: number };
  assert.equal(r2(m1.comisiones - m2.comisiones), 218.25);
});

/* ---------- La pasarela equivocada ---------- */

const PROCS = [
  { id: "proc_stripe", nombre: "Stripe", proveedor: "stripe", activo: true, feeRate: 0.029 },
  { id: "proc_whop", nombre: "Whop", proveedor: "whop", activo: true, feeRate: 0.03 },
  { id: "proc_fin", nombre: "Financiera ARS Juan", activo: true, feeRate: 0.06 },
] as unknown as Procesador[];
const mov = (id: string, proveedor: string, monto: number, nombre: string, fecha = "2026-11-26T14:22:10.000Z", extra: Partial<Movimiento> = {}): Movimiento =>
  ({ id, proveedor, procesadorId: `proc_${proveedor}`, referencia: id, monto, moneda: "USD", fee: 0, neto: monto, fecha, clienteNombre: nombre, estado: "pendiente", origen: "api", creadoEn: fecha, ...extra } as unknown as Movimiento);
const ARPI = { nombre: "Juan Marcelo arpi Quizhpe", email: "" };
const cobro = (procesadorId: string, extra: Record<string, unknown> = {}) => ({ procesadorId, monto: 2500, fecha: "2026-11-26T15:00:00.000Z", ...extra });
const todo = (m: Movimiento) => m.monto;

test("el caso de Juan Arpi: cargado en Stripe, en Stripe no hay nada suyo y en Whop sí → se ofrece el de Whop", () => {
  const movs = [mov("whop_1", "whop", 2500, "MARCELO ARPI"), mov("stripe_1", "stripe", 200, "Klever Ontaneda")];
  const x = pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, movs, ARPI, todo);
  assert.equal(x?.mov.id, "whop_1");
  assert.equal(x?.procesador.id, "proc_whop");
});

test("no dice nada si en la pasarela elegida hay un pago suyo, si ya está atado, si la cuenta no es de una pasarela o si no aparece en ninguna", () => {
  const movs = [mov("whop_1", "whop", 2500, "MARCELO ARPI"), mov("stripe_2", "stripe", 2500, "Juan Arpi Quizhpe")];
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, movs, ARPI, todo), undefined);
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe", { movimientoId: "x" }), PROCS, [movs[0]], ARPI, todo), undefined);
  assert.equal(pagoEnOtraPasarela(cobro("proc_fin"), PROCS, [movs[0]], ARPI, todo), undefined);
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, [mov("w", "whop", 2500, "Otra Persona Distinta")], ARPI, todo), undefined);
});

test("no ofrece un pago de otro día lejano, uno ya conciliado ni uno que ya usaron otros cobros", () => {
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, [mov("w", "whop", 2500, "MARCELO ARPI", "2026-11-10T15:00:00.000Z")], ARPI, todo), undefined);
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, [mov("w", "whop", 2500, "MARCELO ARPI", undefined, { estado: "conciliado" })], ARPI, todo), undefined);
  assert.equal(pagoEnOtraPasarela(cobro("proc_stripe"), PROCS, [mov("w", "whop", 2500, "MARCELO ARPI")], ARPI, () => 0), undefined);
});

test("al revés también: cargado en Whop y el pago está en Stripe; con dos, el de monto más parecido", () => {
  const movs = [mov("s1", "stripe", 100, "Juan Marcelo Arpi"), mov("s2", "stripe", 2490, "Juan Marcelo Arpi")];
  assert.equal(pagoEnOtraPasarela(cobro("proc_whop"), PROCS, movs, ARPI, todo)?.mov.id, "s2");
});
