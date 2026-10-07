import test from "node:test";
import assert from "node:assert/strict";
import { reembolsoDeHotmart, reembolsoDeStripe, reembolsoDeWhop } from "@/lib/pasarelas-api";
import { importarCSV } from "@/lib/pasarelas";
import { calcularPyL } from "@/lib/finanzas";
import {
  atarPropuesta, candidatasDe, conciliarReembolsos, idDePropuesta, propuestasAtables, referenciaDeReembolso,
  type ReembolsoCrudo,
} from "@/lib/reembolsos";
import { rangoDePeriodo } from "@/lib/periodos";
import type { Devolucion, EstadoApp } from "@/lib/types";
import { OCTUBRE, devolucion, estadoDeYari, iso } from "./estado-devolucion";

/* ==================================================================
   Lo que informa una pasarela (Stripe, Hotmart, Whop) se ata a la
   devolución que cargó Finanzas en vez de descartarse. Un reembolso de la
   pasarela es un aviso: nunca resta plata solo.

   El caso de Yari: Belén paga la cuota 2 (1.500) por Stripe el 01/10, con el
   cargo ch_p2; el 03/10 Finanzas carga la devolución y Stripe informa el
   reembolso re_1 de ese cargo.
   ================================================================== */

const AHORA = "2026-10-04T12:00:00.000Z";

const reembolsoStripe = (c: Partial<ReembolsoCrudo> = {}): ReembolsoCrudo => ({
  proveedor: "stripe", referencia: "re_1", referenciasCobro: ["ch_p2", "pi_p2"], monto: 1500, moneda: "USD",
  fecha: iso(OCTUBRE, 3), clienteNombre: "Belén Godoy", clienteEmail: "belen@example.com", procesadorId: "proc_stripe", ...c,
});

/* El estado de Yari con el cobro de octubre ya cargado con su referencia de Stripe. */
function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  const base = estadoDeYari();
  return {
    ...base,
    pagos: base.pagos.map((p) => (p.id === "p2" ? { ...p, referencia: "ch_p2" } : p)),
    procesadores: base.procesadores.map((p) => (p.id === "proc_stripe" ? { ...p, proveedor: "stripe" as const } : p)),
    ...extra,
  } as EstadoApp;
}

const cargada = (d: Partial<Devolucion> = {}) =>
  devolucion({ id: "dev_a_mano", monto: 1500, fecha: iso(OCTUBRE, 3), comprobante: { ruta: "c/1.pdf", nombre: "1.pdf", tipo: "application/pdf", tamano: 10 } as never, ...d });

test("el reembolso de Stripe se ata a la devolución que ya cargó Finanzas", () => {
  const e = estado({ devoluciones: [cargada()] });
  const r = conciliarReembolsos(e, [reembolsoStripe()], AHORA);
  assert.equal(r.nuevas.length, 0, "no se propone otra: es la misma");
  assert.equal(r.atadas.length, 1);
  assert.equal(r.atadas[0].devolucionId, "dev_a_mano");
  assert.equal(r.atadas[0].cambios.referencia, "stripe:re_1");
  assert.equal(r.atadas[0].cambios.proveedor, "stripe");
  assert.equal(r.atadas[0].cambios.conciliadaEn, AHORA);
  /* Y se acuerda del cobro, para que el mismo reembolso por otra vía no entre dos veces. */
  assert.deepEqual(r.atadas[0].cambios.extra?.referenciasCobro, ["ch_p2", "pi_p2"]);
});

test("sin devolución cargada entra como propuesta: sabe de qué venta es y no resta nada", () => {
  const e = estado();
  const r = conciliarReembolsos(e, [reembolsoStripe()], AHORA);
  assert.equal(r.atadas.length, 0);
  assert.equal(r.nuevas.length, 1);
  const p = r.nuevas[0];
  assert.equal(p.estado, "propuesta");
  assert.equal(p.ventaId, "v1", "el cobro ch_p2 está cargado: es de la venta de Belén");
  assert.equal(p.id, "dev_stripe_re_1");
  assert.equal(p.referencia, "stripe:re_1");
  assert.equal(p.monto, 1500);
  assert.equal(p.noDescontarAlCloser, false);

  /* Una propuesta no cuenta: Finanzas de octubre sigue igual. */
  const sin = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  const con = calcularPyL({ ...e, devoluciones: r.nuevas }, rangoDePeriodo(OCTUBRE));
  assert.equal(con.devoluciones, 0);
  assert.equal(con.cashCollected, sin.cashCollected);
  assert.equal(con.comisionCloser, sin.comisionCloser, "ni se le descuenta al closer");
});

test("traerlo dos veces no duplica nada, ni cambiado de fuente", () => {
  let e = estado();
  const r1 = conciliarReembolsos(e, [reembolsoStripe()], AHORA);
  e = { ...e, devoluciones: r1.nuevas };
  const r2 = conciliarReembolsos(e, [reembolsoStripe()], AHORA);
  assert.equal(r2.nuevas.length + r2.atadas.length, 0);
  assert.equal(r2.yaEstaban, 1);

  /* El CSV trae el cargo (reembolso:ch_p2) y no el re_…: el mismo cobro y el mismo monto es el mismo. */
  const csv = reembolsoStripe({ referencia: "reembolso:ch_p2", referenciasCobro: ["ch_p2"], fechaDelCobro: true });
  const r3 = conciliarReembolsos(e, [csv], AHORA);
  assert.equal(r3.nuevas.length + r3.atadas.length, 0);
  assert.equal(r3.yaEstaban, 1);

  /* Una que alguien marcó «no es una devolución» tampoco vuelve. */
  const ignorada = { ...r1.nuevas[0], estado: "ignorada" as const };
  assert.equal(conciliarReembolsos({ ...e, devoluciones: [ignorada] }, [reembolsoStripe()], AHORA).yaEstaban, 1);
  /* Y dos veces en la misma tanda, sólo una. */
  const doble = conciliarReembolsos(estado(), [reembolsoStripe(), reembolsoStripe()], AHORA);
  assert.equal(doble.nuevas.length, 1);
});

test("no se ata a lo que no es lo mismo: otro monto, otros días, otra pasarela o ya atada", () => {
  const casos: [string, Partial<Devolucion>, Partial<ReembolsoCrudo>][] = [
    ["otro monto", { monto: 700 }, {}],
    ["20 días después", {}, { fecha: iso(OCTUBRE, 23) }],
    ["de otra venta", { ventaId: "otra" }, {}],
    ["ya tiene su referencia", { referencia: "stripe:re_0", proveedor: "stripe" }, {}],
    ["una propuesta no es una cargada", { estado: "propuesta" }, {}],
  ];
  for (const [nombre, d, r] of casos) {
    const out = conciliarReembolsos(estado({ devoluciones: [cargada(d)] }), [reembolsoStripe(r)], AHORA);
    assert.equal(out.atadas.length, 0, nombre);
    assert.equal(out.nuevas.length, 1, `${nombre}: queda como propuesta`);
  }
  /* Salió por una cuenta de Hotmart: no es el reembolso de Stripe. */
  const procs = estado().procesadores.map((p) => (p.id === "proc_fin" ? { ...p, proveedor: "hotmart" as const } : p));
  const otraCuenta = conciliarReembolsos(estado({ procesadores: procs, devoluciones: [cargada({ procesadorId: "proc_fin" })] }), [reembolsoStripe()], AHORA);
  assert.equal(otraCuenta.atadas.length, 0);
});

test("si el cobro no está cargado no se adivina la venta, pero se ata por la misma persona", () => {
  /* Sin cobro con esa referencia. */
  const r = reembolsoStripe({ referenciasCobro: ["ch_desconocido"] });
  const sinCobro = conciliarReembolsos(estado(), [r], AHORA);
  assert.equal(sinCobro.nuevas[0].ventaId, undefined);
  /* La devolución cargada de Belén calza por su correo, y otra de otra persona no. */
  const e = estado({ devoluciones: [cargada()] });
  assert.equal(conciliarReembolsos(e, [r], AHORA).atadas.length, 1);
  const ajeno = reembolsoStripe({ referenciasCobro: ["ch_desconocido"], clienteEmail: "otra@example.com", clienteNombre: "Otra Persona" });
  assert.equal(conciliarReembolsos(e, [ajeno], AHORA).atadas.length, 0);
});

test("con dos devoluciones que calzan no se ata ninguna: queda la propuesta con las candidatas", () => {
  const e = estado({ devoluciones: [cargada({ id: "dev_1" }), cargada({ id: "dev_2", fecha: iso(OCTUBRE, 4) })] });
  const r = conciliarReembolsos(e, [reembolsoStripe()], AHORA);
  assert.equal(r.atadas.length, 0);
  assert.equal(r.dudosas, 1);
  assert.deepEqual(r.nuevas[0].extra.candidatas, ["dev_1", "dev_2"]);

  /* Guardada la propuesta, no hay «atar todas»: hay que elegir. Si una se borra, queda una sola y sí. */
  const guardada = { ...e, devoluciones: [...r.nuevas, ...(e.devoluciones ?? [])] };
  assert.equal(propuestasAtables(guardada).length, 0);
  const una = { ...guardada, devoluciones: guardada.devoluciones!.filter((d) => d.id !== "dev_2") };
  assert.deepEqual(propuestasAtables(una), [{ propuestaId: "dev_stripe_re_1", devolucionId: "dev_1" }]);
});

test("atar a mano una propuesta: la cargada toma la referencia y la propuesta se va", () => {
  const e = estado({ devoluciones: [cargada({ id: "dev_1" })] });
  const propuesta = conciliarReembolsos(estado(), [reembolsoStripe()], AHORA).nuevas[0];
  const con = { devoluciones: [propuesta, ...e.devoluciones!] };
  const r = atarPropuesta(con, propuesta.id, "dev_1", AHORA);
  assert.equal(r?.quitarPropuesta, propuesta.id);
  assert.equal(r?.cambios.referencia, "stripe:re_1");
  /* No se puede atar a una que ya tiene su referencia, ni a algo que no existe. */
  const atada = { devoluciones: [propuesta, { ...e.devoluciones![0], referencia: "stripe:re_9" }] };
  assert.equal(atarPropuesta(atada, propuesta.id, "dev_1", AHORA), null);
  assert.equal(atarPropuesta(con, propuesta.id, "no_existe", AHORA), null);
  assert.equal(candidatasDe(estado({ devoluciones: [cargada()] }), reembolsoStripe()).length, 1);
});

test("la referencia y el id salen de lo que informa la pasarela", () => {
  assert.equal(referenciaDeReembolso({ proveedor: "stripe", referencia: "re_3Q" }), "stripe:re_3Q");
  assert.equal(idDePropuesta({ proveedor: "hotmart", referencia: "reembolso:HP123" }), "dev_hotmart_reembolso:HP123");
  assert.ok(idDePropuesta({ proveedor: "stripe", referencia: "x".repeat(300) }).length <= 120);
});

/* ---------- Lo que cada pasarela informa ---------- */

test("Stripe: el reembolso pasa de centavos a dólares y trae el cargo y quién pagó", () => {
  const r = reembolsoDeStripe({
    id: "re_1", amount: 150000, currency: "usd", status: "succeeded", created: 1759500000, reason: "requested_by_customer",
    charge: { id: "ch_p2", payment_intent: "pi_p2", billing_details: { name: "Belén Godoy", email: "BELEN@example.com" } },
  });
  assert.equal(r?.monto, 1500);
  assert.equal(r?.referencia, "re_1");
  assert.deepEqual(r?.referenciasCobro, ["ch_p2", "pi_p2"]);
  assert.equal(r?.clienteEmail, "belen@example.com");
  assert.equal(r?.motivo, "Lo pidió el cliente");
  assert.equal(r?.procesadorId, "proc_stripe");
  /* Sin cargo expandido igual sabe cuál es. */
  assert.deepEqual(reembolsoDeStripe({ id: "re_2", amount: 100, currency: "usd", status: "pending", created: 1759500000, charge: "ch_x", payment_intent: "pi_x" })?.referenciasCobro, ["ch_x", "pi_x"]);
  /* Uno que falló o se canceló no devolvió nada. */
  assert.equal(reembolsoDeStripe({ id: "re_3", amount: 100, currency: "usd", status: "failed", created: 1, charge: "ch_x" }), null);
  assert.equal(reembolsoDeStripe({ id: "re_4", amount: 0, currency: "usd", status: "succeeded", created: 1, charge: "ch_x" }), null);
});

test("Hotmart: la compra reembolsada, con la fecha de la compra marcada, y el contracargo", () => {
  const compra = { purchase: { transaction: "HP1", price: { value: 500, currency_code: "USD" }, approved_date: 1759300000000 }, buyer: { name: "Pablo", email: "P@x.com" } } as never;
  const r = reembolsoDeHotmart(compra);
  assert.equal(r?.referencia, "reembolso:HP1");
  assert.deepEqual(r?.referenciasCobro, ["HP1"]);
  assert.equal(r?.fechaDelCobro, true, "Hotmart no dice cuándo se devolvió");
  assert.equal(r?.clienteEmail, "p@x.com");
  assert.equal(reembolsoDeHotmart(compra, true)?.motivo, "Contracargo");
  assert.equal(reembolsoDeHotmart({ purchase: {} } as never), null);
});

test("Whop: el pago reembolsado, con el monto devuelto si lo trae", () => {
  const r = reembolsoDeWhop({ id: "pay_1", refunded_amount: 40, final_amount: 100, currency: "usd", refunded_at: 1759500000, user: { name: "Ana", email: "a@x.com" } });
  assert.equal(r?.monto, 40);
  assert.equal(r?.fechaDelCobro, false);
  assert.deepEqual(r?.referenciasCobro, ["pay_1"]);
  const entero = reembolsoDeWhop({ id: "pay_2", final_amount: 100, currency: "usd", paid_at: 1759500000 });
  assert.equal(entero?.monto, 100);
  assert.equal(entero?.fechaDelCobro, true);
});

/* ---------- El CSV ---------- */

test("el CSV de Stripe ya no pierde los reembolsos: los separa de los cobros", () => {
  const csv = [
    "id,Created date (UTC),Amount,Amount Refunded,Currency,Fee,Status,Customer Email",
    "ch_ok,2026-10-01 15:00,1500,0,usd,45,Paid,belen@example.com",
    "ch_dev,2026-09-28 15:00,1500,1500,usd,45,Refunded,belen@example.com",
    "ch_parcial,2026-09-29 15:00,1000,300,usd,30,Paid,pablo@example.com",
    "ch_fail,2026-09-30 15:00,500,0,usd,0,Failed,x@example.com",
  ].join("\n");
  const r = importarCSV(csv, "stripe", "proc_stripe");
  /* Entran como cobros el pagado y el pagado en parte; el devuelto entero no. */
  assert.deepEqual(r.movimientos.map((m) => m.referencia), ["ch_ok", "ch_parcial"]);
  /* Y se informan dos devoluciones: la entera y la parcial, del cargo. */
  assert.deepEqual(r.reembolsos.map((x) => [x.referencia, x.monto]), [["reembolso:ch_dev", 1500], ["reembolso:ch_parcial", 300]]);
  assert.deepEqual(r.reembolsos[0].referenciasCobro, ["ch_dev"]);
  assert.equal(r.reembolsos[0].fechaDelCobro, true);
  assert.equal(r.reembolsos[0].clienteEmail, "belen@example.com");
  assert.ok(r.descartadas.some((d) => d.fila === 3 && /devolución/.test(d.motivo)));
  assert.ok(r.descartadas.some((d) => d.fila === 5 && /Failed/.test(d.motivo)), "lo fallido sigue descartado");
});

test("el CSV con un renglón en negativo (PayPal): es un reembolso, no una fila perdida", () => {
  const csv = ["Transaction ID,Date,Gross,Currency,Status,Reference Txn ID", "T1,2026-10-01,100,USD,Completed,", "T2,2026-10-03,-40,USD,Completed,T1"].join("\n");
  const r = importarCSV(csv, "manual", undefined);
  assert.equal(r.movimientos.length, 1);
  assert.equal(r.reembolsos.length, 1);
  assert.equal(r.reembolsos[0].monto, 40);
  assert.deepEqual(r.reembolsos[0].referenciasCobro, ["T2", "T1"].filter((x) => x === "T2" || x === "T1"));
});
