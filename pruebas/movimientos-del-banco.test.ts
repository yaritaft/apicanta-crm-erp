import test from "node:test";
import assert from "node:assert/strict";
import {
  borradorDesdeElBanco, comprasDeTarjetaQueFaltan, cruzarConLaApp, movimientoDeMercury, movimientoDeStripe, resumenDeLoQueFalta, type MovimientoDelBanco,
} from "@/lib/movimientos-del-banco";
import { borradorInicial, datosDelGasto } from "@/lib/carga-gasto";
import { saldosEsperados } from "@/lib/traspasos";
import { movimientosDeMercury, movimientosDeStripe, reembolsoDeContracargoStripe } from "@/lib/pasarelas-api";
import { construirSemilla } from "@/lib/seed";
import type { Devolucion, EstadoApp, Gasto, Movimiento, Traspaso } from "@/lib/types";

/* Aldana (22/10): el saldo de Mercury «está bien» pero no encuentra dónde queda lo que consume Yari ni el cashback; Stripe «marca diferencia si
   sólo hubo un movimiento». Lo que sale del banco y no es un cobro no se guardaba en ningún lado. */

const mercury = (extra: Record<string, unknown>) => ({ id: "m1", amount: -7.5, createdAt: "2026-10-21T15:00:00.000Z", postedAt: "2026-10-22T10:00:00.000Z", status: "sent", ...extra });

test("Mercury: una compra con tarjeta (de débito o de crédito) es un gasto; el pago de la tarjeta no; el cashback es un ingreso", () => {
  const debito = movimientoDeMercury(mercury({ id: "d1", kind: "debitCardTransaction", counterpartyName: "Starbucks" }), "proc_mercury")!;
  assert.equal(debito.tipo, "compra-tarjeta");
  assert.equal(debito.monto, -7.5);
  assert.equal(debito.fecha, "2026-10-22T10:00:00.000Z", "la fecha es la de asentado");
  assert.equal(debito.ref, "mercury:d1");
  const credito = movimientoDeMercury(mercury({ id: "c1", kind: "creditCardTransaction", counterpartyName: "Teatro Colón", amount: -85 }), "proc_mercury")!;
  assert.equal(credito.tipo, "compra-credito", "con la tarjeta de crédito todavía no salió plata de la cuenta: sale cuando se paga la tarjeta");
  /* Un comercio con «payment» en el nombre no la hace un pago de tarjeta: manda el tipo de movimiento. */
  assert.equal(movimientoDeMercury(mercury({ id: "c2", kind: "creditCardTransaction", counterpartyName: "Stripe Payments Bar" }), "proc_mercury")!.tipo, "compra-credito");
  const pago = movimientoDeMercury(mercury({ id: "p1", kind: "creditCardPayment", counterpartyName: "Mercury IO Cashback Credit Card", amount: -5000 }), "proc_mercury")!;
  assert.equal(pago.tipo, "pago-tarjeta");
  /* Los casos reales del 22/10: el pago diario («Mercury Credit · IO AUTOPAY») y el cashback que entra («Mercury IO Cashback»). */
  assert.equal(movimientoDeMercury(mercury({ id: "p2", kind: "externalTransfer", counterpartyName: "Mercury Credit", bankDescription: "IO AUTOPAY", amount: -2310.5 }), "proc_mercury")!.tipo, "pago-tarjeta");
  assert.equal(movimientoDeMercury(mercury({ id: "k2", kind: "externalTransfer", counterpartyName: "Mercury IO Cashback", amount: 34.66 }), "proc_mercury")!.tipo, "cashback");
  const cashback = movimientoDeMercury(mercury({ id: "k1", kind: "other", counterpartyName: "Mercury", bankDescription: "Cashback", amount: 12.4 }), "proc_mercury")!;
  assert.equal(cashback.tipo, "cashback");
  assert.equal(cashback.monto, 12.4);
  assert.equal(movimientoDeMercury(mercury({ id: "r1", kind: "debitCardTransaction", counterpartyName: "Starbucks", amount: 7.5 }), "proc_mercury")!.tipo, "reembolso", "una compra devuelta");
});

test("Mercury: lo demás — cobros de un cliente, depósitos de una pasarela, salidas; y lo que no es plata no se trae", () => {
  assert.equal(movimientoDeMercury(mercury({ id: "w1", kind: "incomingDomesticWire", counterpartyName: "Gustavo Castillo", amount: 1500 }), "proc_mercury")!.tipo, "cobro");
  assert.equal(movimientoDeMercury(mercury({ id: "s1", kind: "externalTransfer", counterpartyName: "STRIPE PAYOUT", amount: 477.7 }), "proc_mercury")!.tipo, "pase");
  assert.equal(movimientoDeMercury(mercury({ id: "o1", kind: "externalTransfer", counterpartyName: "Un proveedor", amount: -300 }), "proc_mercury")!.tipo, "salida");
  assert.equal(movimientoDeMercury(mercury({ id: "i1", kind: "internalTransfer", counterpartyName: "Mercury Savings", amount: -100 }), "proc_mercury")!.tipo, "interno");
  assert.equal(movimientoDeMercury(mercury({ id: "f1", status: "failed" }), "proc_mercury"), null, "lo que falló no es plata");
  assert.equal(movimientoDeMercury(mercury({ id: "z1", amount: 0 }), "proc_mercury"), null);
  assert.equal(movimientoDeMercury(mercury({ id: "" }), "proc_mercury"), null);
  const pendiente = movimientoDeMercury(mercury({ id: "pe", status: "pending", kind: "debitCardTransaction", counterpartyName: "Uber", amount: -14.99 }), "proc_mercury")!;
  assert.equal(pendiente.pendiente, true, "pending: todavía no cuenta");
});

test("Stripe: el neto es lo que sube o baja el saldo; cobros, comisiones, reembolsos, retiros y ajustes", () => {
  const t = (extra: Record<string, unknown>) => ({ id: "txn_1", amount: 100000, fee: 4430, net: 95570, type: "charge", source: "ch_1", created: 1792537257, description: "", ...extra });
  const cobro = movimientoDeStripe(t({}), "proc_stripe")!;
  assert.deepEqual([cobro.tipo, cobro.monto, cobro.refApp], ["cobro", 955.7, ["txn_1", "ch_1"]]);
  assert.equal(cobro.ref, "stripe:txn_1");
  assert.equal(movimientoDeStripe(t({ type: "stripe_fee", amount: -2480, fee: 0, net: -2480, source: "" }), "proc_stripe")!.tipo, "comision");
  assert.equal(movimientoDeStripe(t({ type: "refund", amount: -50000, net: -50000, fee: 0 }), "proc_stripe")!.tipo, "reembolso");
  const retiro = movimientoDeStripe(t({ type: "payout", amount: -47750, net: -47750, fee: 0, source: "po_9" }), "proc_stripe")!;
  assert.deepEqual([retiro.tipo, retiro.monto, retiro.refApp], ["pase", -477.5, ["txn_1", "po_9"]]);
  /* Los contracargos del 21/10 (lo que hacía que Stripe marcara 713 de diferencia): no son un retiro, son plata que un cliente disputó. */
  const cc = movimientoDeStripe(t({ type: "adjustment", amount: -47200, net: -47200, fee: 0, description: "Chargeback withdrawal for ch_3UEVD8Cda71F5AQH1E3MEZNS", source: "du_1" }), "proc_stripe")!;
  assert.deepEqual([cc.tipo, cc.monto], ["contracargo", -472]);
  /* «Stripe quitó plata para cubrir los saldos negativos»: es un retiro, aunque entre. */
  assert.equal(movimientoDeStripe(t({ type: "payout", amount: 24460, net: 24460, fee: 0, source: "po_10", description: "Withdrawal to cover a negative balance" }), "proc_stripe")!.tipo, "pase");
  assert.equal(movimientoDeStripe(t({ type: "adjustment", amount: -1200, net: -1200, fee: 0 }), "proc_stripe")!.tipo, "ajuste");
  assert.equal(movimientoDeStripe(t({ amount: 0, net: 0 }), "proc_stripe"), null);
});

const banco = (extra: Partial<MovimientoDelBanco>): MovimientoDelBanco => ({
  ref: "mercury:m1", refApp: ["m1"], cuentaId: "proc_mercury", fecha: "2026-10-22T10:00:00.000Z", monto: -7.5, contraparte: "Starbucks", tipo: "compra-tarjeta", ...extra,
});
const estadoBase = () => {
  const base = construirSemilla() as EstadoApp;
  return { ...base, movimientos: [] as Movimiento[], traspasos: [] as Traspaso[], gastos: [] as Gasto[], devoluciones: [] as Devolucion[], pagos: [] };
};
const gasto = (extra: Partial<Gasto> & Record<string, unknown>): Gasto => ({
  id: "g1", categoria: "Pendiente de revisión", grupo: "operativo", concepto: "Café", monto: 7.5, moneda: "USD", fecha: "2026-10-21T12:00:00.000Z", creadoEn: "2026-10-21T12:00:00.000Z",
  extra: { cuenta: "ACH-WIRE Mercury" }, ...extra,
} as Gasto);

test("cruzar con la app: lo que ya está como cobro, pase o gasto se marca; lo parecido se ofrece; lo demás falta", () => {
  const e = estadoBase();
  e.movimientos = [{ id: "mov1", proveedor: "mercury", referencia: "cobro1", estado: "pendiente" } as Movimiento];
  e.traspasos = [{ id: "t1", llegadaRef: "mercury:pase1", salidaRef: "stripe:po_1" } as Traspaso];
  e.gastos = [gasto({ id: "g_ref", concepto: "Ya cargado", extra: { cuenta: "Mercury", bancoRef: "mercury:ya" }, monto: 40 }), gasto({ id: "g_parecido", concepto: "Café", monto: 7.5 })];
  const movs: MovimientoDelBanco[] = [
    banco({ ref: "mercury:cobro1", refApp: ["cobro1"], tipo: "cobro", monto: 100 }),
    banco({ ref: "mercury:pase1", refApp: ["pase1"], tipo: "pase", monto: 50 }),
    banco({ ref: "mercury:ya", refApp: ["ya"], monto: -40 }),
    banco({ ref: "mercury:m1", refApp: ["m1"], monto: -7.5 }),               // el café: parece el gasto g_parecido
    banco({ ref: "mercury:m2", refApp: ["m2"], monto: -7.5, contraparte: "Otro café" }), // el mismo monto otra vez: ese gasto ya se usó
    banco({ ref: "mercury:m3", refApp: ["m3"], monto: -85, contraparte: "Teatro" }),
    banco({ ref: "mercury:pt", refApp: ["pt"], tipo: "pago-tarjeta", monto: -5000 }),
    banco({ ref: "mercury:ck", refApp: ["ck"], tipo: "cashback", monto: 12.4, contraparte: "Mercury" }),
  ];
  const r = cruzarConLaApp(e, movs);
  assert.deepEqual(r.map((x) => x.estadoApp), ["cargado", "cargado", "cargado", "parecido", "falta", "falta", "no-se-carga", "falta"]);
  assert.match(r[0].donde ?? "", /cobro/);
  assert.match(r[1].donde ?? "", /entre cuentas/);
  assert.match(r[2].donde ?? "", /Ya cargado/);
  assert.equal(r[3].gastoId, "g_parecido");
  /* Lo que falta: sólo lo asentado, y sin el pago de la tarjeta. */
  const faltan = resumenDeLoQueFalta([...r, { ...r[5], ref: "mercury:pend", pendiente: true, monto: -999 }]);
  assert.deepEqual(faltan, { n: 3, sale: 92.5, entra: 12.4 });
});

test("la tarjeta de crédito, como en «Cargar varios»: las compras se cargan una por una y el pago no (sería contarlas dos veces)", () => {
  const e = estadoBase();
  const pago = banco({ ref: "mercury:pt", refApp: ["pt"], tipo: "pago-tarjeta", monto: -2310.5, contraparte: "Mercury Credit" });
  const compraDelBanco = banco({ ref: "mercury:c", refApp: ["c"], tipo: "compra-credito", monto: -85, contraparte: "Uber" });
  const [elPago, laCompra] = cruzarConLaApp(e, [pago, compraDelBanco]);
  assert.equal(elPago.estadoApp, "no-se-carga");
  assert.match(elPago.donde ?? "", /las duplica/);
  assert.equal(laCompra.estadoApp, "falta");
  /* La compra que entró con el export (sin referencia del banco) se reconoce por monto, cuenta y días. */
  e.gastos = [gasto({ id: "g_export", concepto: "Uber", monto: 85, extra: { cuenta: "Mercury", origen: "mercury-export-27-10", tarjeta: "3120" } })];
  const delExport = cruzarConLaApp(e, [compraDelBanco])[0];
  assert.deepEqual([delExport.estadoApp, delExport.gastoId], ["parecido", "g_export"]);
  /* Un pago que ya se cargó, o que se repartió en compras, sigue como cargado: no pide nada. */
  e.gastos = [gasto({ id: "g_pago", concepto: "Pago de la tarjeta de crédito Mercury", monto: 2310.5, extra: { cuenta: "ACH-WIRE Mercury", bancoRef: "mercury:pt" } })];
  assert.deepEqual([cruzarConLaApp(e, [pago])[0].estadoApp, cruzarConLaApp(e, [pago])[0].gastoId], ["cargado", "g_pago"]);
  const inicial = borradorDesdeElBanco(pago, "ACH-WIRE Mercury", false);
  assert.deepEqual([inicial.concepto, inicial.monto, inicial.proveedor], ["Pago de la tarjeta de crédito Mercury", "2.310,50", "Mercury"]);
  assert.match(inicial.notas, /compras de esos días/);
});

test("las compras de la tarjeta que faltan: hasta qué día están cargadas y cuánto se pagó después (el «todo está cargado» no puede mentir)", () => {
  const e = estadoBase();
  const pagoDel = (dia: string, monto: number, extra: Partial<MovimientoDelBanco> = {}) => banco({ ref: `mercury:${dia}`, refApp: [dia], tipo: "pago-tarjeta", fecha: `${dia}T15:00:00.000Z`, monto, contraparte: "Mercury Credit", ...extra });
  const movs = [pagoDel("2026-10-26", -100), pagoDel("2026-10-28", -300), pagoDel("2026-10-29", -40.5), pagoDel("2026-10-30", -999, { pendiente: true })];
  /* Sin ninguna compra cargada con el export: todo lo pagado (menos lo no asentado). */
  assert.deepEqual(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, movs)), { cargadasHasta: null, pagado: 440.5 });
  /* Cargadas hasta el 27: cuenta lo pagado del 28 en adelante. Los gastos sin tarjeta (la planilla) no mueven la fecha. */
  e.gastos = [
    gasto({ id: "c1", monto: 20, fecha: "2026-10-27T12:00:00.000Z", extra: { cuenta: "Mercury", tarjeta: "3120" } }),
    gasto({ id: "c2", monto: 30, fecha: "2026-10-05T12:00:00.000Z", extra: { cuenta: "Mercury", tarjeta: "3120" } }),
    gasto({ id: "pl", monto: 50, fecha: "2026-10-30T12:00:00.000Z", extra: { cuenta: "Mercury" } }),
  ];
  assert.deepEqual(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, movs)), { cargadasHasta: "2026-10-27", pagado: 340.5 });
  /* Una tabla pegada sin los títulos del banco no dice «tarjeta» y puede no tener cuenta: igual corre la fecha (lo de Aldana del 27 al 31/10). Lo que entra
     de vuelta en esa tanda o una carga de otra cuenta, no. */
  e.gastos = [
    gasto({ id: "c1", monto: 20, fecha: "2026-10-27T12:00:00.000Z", extra: { cuenta: "Mercury", tarjeta: "3120" } }),
    gasto({ id: "pegada", monto: 300, fecha: "2026-10-28T12:00:00.000Z", extra: { cargaMasiva: "lote_y" } }),
    gasto({ id: "cash", monto: -7, fecha: "2026-10-29T12:00:00.000Z", extra: { cargaMasiva: "lote_y", ingreso: true } }),
    gasto({ id: "otra", monto: 9, fecha: "2026-10-29T12:00:00.000Z", extra: { cargaMasiva: "lote_z", cuenta: "Stripe" } }),
  ];
  assert.deepEqual(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, movs)), { cargadasHasta: "2026-10-28", pagado: 40.5 });
  /* Al día, o sin pagos en esos días: no hay nada que avisar. */
  e.gastos = [gasto({ id: "c3", monto: 20, fecha: "2026-10-29T12:00:00.000Z", extra: { cuenta: "Mercury", tarjeta: "3120" } })];
  assert.equal(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, movs)), null);
  assert.equal(comprasDeTarjetaQueFaltan(e, []), null);
  /* Un pago ya cargado como gasto no vuelve a contar. */
  e.gastos = [gasto({ id: "gp", monto: 300, extra: { cuenta: "ACH-WIRE Mercury", bancoRef: "mercury:2026-10-28" } })];
  assert.deepEqual(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, movs)), { cargadasHasta: null, pagado: 140.5 });
  /* Si el banco trae las compras, cada una ya está en la lista. */
  e.gastos = [];
  assert.equal(comprasDeTarjetaQueFaltan(e, cruzarConLaApp(e, [...movs, banco({ ref: "mercury:c", refApp: ["c"], tipo: "compra-credito", monto: -85 })])), null);
});

test("un contracargo de Stripe: falta hasta que está como devolución (se propone con «Sincronizar»); cargado, avisa de la comisión de más", () => {
  const e = estadoBase();
  const cc = banco({ ref: "stripe:txn_9", refApp: ["txn_9", "du_1"], cuentaId: "proc_stripe", tipo: "contracargo", monto: -472, contraparte: "Chargeback withdrawal for ch_3UEVD8" });
  const sin = cruzarConLaApp(e, [cc])[0];
  assert.equal(sin.estadoApp, "falta");
  assert.match(sin.donde ?? "", /Sincronizar/);
  /* Una disputa propuesta por «Sincronizar», sin saber cómo terminó: está EN DISPUTA. Stripe retuvo la plata mientras se resuelve y no hay nada que
     hacer (ni botón): si se gana, vuelve; si se pierde, aparece el botón para cargarla como gasto (Juan Cruz, 23/10). */
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "propuesta" } as Devolucion];
  const enDisputa = cruzarConLaApp(e, [cc])[0];
  assert.equal(enDisputa.estadoApp, "en-disputa");
  assert.match(enDisputa.donde ?? "", /retuvo la plata/);
  assert.equal(enDisputa.cargableComoGasto, undefined);
  assert.equal(resumenDeLoQueFalta([enDisputa]).n, 0, "una disputa en curso no es algo que falte cargar");
  /* Perdida: aparece el botón para cargarla como gasto. */
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "propuesta", extra: { estadoDisputa: "perdida" } } as unknown as Devolucion];
  const perdida = cruzarConLaApp(e, [cc])[0];
  assert.deepEqual([perdida.estadoApp, perdida.cargableComoGasto], ["falta", true]);
  assert.equal(resumenDeLoQueFalta([perdida]).n, 1);
  /* Ganada (la propuesta se fue sola) o perdida y ya cargada: no falta nada. */
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "ignorada", extra: { estadoDisputa: "ganada" } } as unknown as Devolucion];
  assert.equal(cruzarConLaApp(e, [cc])[0].estadoApp, "no-se-carga");
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "ignorada", extra: { estadoDisputa: "perdida" } } as unknown as Devolucion];
  assert.equal(cruzarConLaApp(e, [cc])[0].estadoApp, "cargado");
  /* Y lo que alguien descartó a mano sigue como siempre. */
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "ignorada" } as Devolucion];
  assert.equal(cruzarConLaApp(e, [cc])[0].estadoApp, "no-se-carga");
  /* Si se cargó el gasto desde este mismo movimiento, está cargado diga lo que diga la propuesta. */
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "propuesta", extra: { estadoDisputa: "perdida" } } as unknown as Devolucion];
  e.gastos = [gasto({ id: "gd", concepto: "Contracargo perdido", extra: { cuenta: "Stripe", bancoRef: "stripe:txn_9" } })];
  assert.equal(cruzarConLaApp(e, [cc])[0].estadoApp, "cargado");
  e.gastos = [];
  /* La plata que Stripe repone al ganar una disputa (un movimiento positivo) no es nada que cargar. */
  assert.equal(cruzarConLaApp(e, [{ ...cc, ref: "stripe:txn_10", refApp: ["txn_10"], monto: 472 }])[0].estadoApp, "no-se-carga");
  e.devoluciones = [{ id: "dev1", referencia: "stripe:disputa:du_1", monto: 457, estado: "confirmada" } as Devolucion];
  const con = cruzarConLaApp(e, [cc])[0];
  assert.equal(con.estadoApp, "cargado");
  assert.match(con.donde ?? "", /contracargo.*457.*retiró US\$ 15 más/);
});

test("un gasto parecido de otra cuenta, de otro monto o de otra semana no cuenta como el del banco", () => {
  const e = estadoBase();
  e.gastos = [
    gasto({ id: "otra_cuenta", extra: { cuenta: "Stripe" } }), gasto({ id: "otro_monto", monto: 8 }), gasto({ id: "lejos", fecha: "2026-10-01T12:00:00.000Z" }),
    gasto({ id: "ingreso", monto: -7.5 }),
  ];
  assert.equal(cruzarConLaApp(e, [banco({})])[0].estadoApp, "falta");
  /* Un cashback (entra) se parece a un ingreso cargado (monto negativo). */
  e.gastos = [gasto({ id: "cb", monto: -12.4, concepto: "Cashback" })];
  assert.equal(cruzarConLaApp(e, [banco({ ref: "mercury:k", refApp: ["k"], tipo: "cashback", monto: 12.4, contraparte: "Mercury", fecha: "2026-10-22T10:00:00.000Z" })])[0].estadoApp, "parecido");
});

const paseManual = (extra: Partial<Traspaso>): Traspaso => ({
  id: "tra_1", fecha: "2026-10-26T15:00:00.000Z", origenId: "proc_mercury", destinoId: "proc_relay", montoSale: 30000, monedaSale: "USD", montoLlega: 30000, monedaLlega: "USD",
  estado: "confirmado", origen: "manual", creadoEn: "2026-10-26T15:00:00.000Z", ...extra,
});

test("una salida que ya está como pase a mano no se ofrece como gasto: los tres de Mercury de octubre (US$ 88.302)", () => {
  const e = estadoBase();
  e.traspasos = [
    paseManual({ id: "tra_relay" }),
    paseManual({ id: "tra_financiera", destinoId: "proc_financiera_usd", montoSale: 40000, montoLlega: 40000 }),
    paseManual({ id: "tra_bofa", destinoId: "proc_bofa", fecha: "2026-10-27T15:00:00.000Z", montoSale: 18302, montoLlega: 18302 }),
  ];
  const r = cruzarConLaApp(e, [
    banco({ ref: "mercury:r", refApp: ["r"], tipo: "pase", monto: -30000, contraparte: "Apicanta LLC - Relay", fecha: "2026-10-26T18:00:00.000Z" }),
    banco({ ref: "mercury:f", refApp: ["f"], tipo: "salida", monto: -40000, contraparte: "Juan Financiera", fecha: "2026-10-27T12:00:00.000Z" }),
    banco({ ref: "mercury:b", refApp: ["b"], tipo: "salida", monto: -18302, contraparte: "Apicanta LLC", fecha: "2026-10-28T12:00:00.000Z" }),
  ]);
  assert.deepEqual(r.map((x) => [x.estadoApp, x.traspasoId]), [["cargado", "tra_relay"], ["cargado", "tra_financiera"], ["cargado", "tra_bofa"]]);
  assert.match(r[1].donde ?? "", /entre cuentas, cargado a mano: a Financiera USD Juan \(26\/10\)/);
  assert.match(r[2].donde ?? "", /a Bank of America \(27\/10\)/);
  assert.deepEqual(resumenDeLoQueFalta(r), { n: 0, sale: 0, entra: 0 }, "el encabezado no pide cargarlos");
  /* Es la plata que el pase ya bajó del saldo esperado: cargarla como gasto la bajaría dos veces. */
  const previo = { fecha: "2026-10-20T00:00:00.000Z", saldos: [{ procesadorId: "proc_mercury", monto: 100000, moneda: "USD" as const, montoBase: 100000 }] };
  assert.equal(saldosEsperados(e, previo, "2026-10-29T00:00:00.000Z").get("proc_mercury")!.esperado, 11698);
});

test("un pase a mano de otro monto, de otra cuenta, de otros días o descartado no reconoce la salida del banco", () => {
  const salida = banco({ ref: "mercury:s", refApp: ["s"], tipo: "salida", monto: -30000, contraparte: "Apicanta LLC", fecha: "2026-10-26T18:00:00.000Z" });
  const con = (t: Traspaso) => ({ ...estadoBase(), traspasos: [t] });
  const falta = (t: Traspaso, por: string) => assert.equal(cruzarConLaApp(con(t), [salida])[0].estadoApp, "falta", por);
  falta(paseManual({ montoSale: 30000.5, montoLlega: 30000.5 }), "otro monto");
  falta(paseManual({ origenId: "proc_stripe" }), "sale de otra cuenta");
  falta(paseManual({ origenId: "proc_bofa", destinoId: "proc_mercury" }), "es una llegada a esta cuenta, no una salida");
  falta(paseManual({ fecha: "2026-10-31T15:00:00.000Z" }), "más de cuatro días después");
  falta(paseManual({ estado: "ignorado" }), "descartado");
  falta(paseManual({ estado: "propuesto" }), "por confirmar: todavía no movió el saldo");
  falta(paseManual({ origen: "api" }), "lo detectó la sincronización: se ata por referencia");
  falta(paseManual({ salidaRef: "mercury:otro" }), "esa punta ya es de otro movimiento");
  /* A los cuatro días justos sí, como con los gastos. */
  assert.equal(cruzarConLaApp(con(paseManual({ fecha: "2026-10-30T18:00:00.000Z" })), [salida])[0].estadoApp, "cargado");
  /* Una compra con tarjeta o una comisión del mismo monto tienen su propio origen. */
  assert.equal(cruzarConLaApp(con(paseManual({})), [{ ...salida, tipo: "compra-tarjeta" }])[0].estadoApp, "falta");
  assert.equal(cruzarConLaApp(con(paseManual({})), [{ ...salida, tipo: "comision" }])[0].estadoApp, "falta");
  /* El pago de la tarjeta sigue como siempre. */
  assert.equal(cruzarConLaApp(con(paseManual({})), [{ ...salida, tipo: "pago-tarjeta" }])[0].estadoApp, "no-se-carga");
  /* Si el banco nombra con seguridad a otra cuenta, no es ese pase; un nombre dudoso («Bridge» figura como Hotmart por las dudas) no descarta nada. */
  assert.equal(cruzarConLaApp(con(paseManual({})), [{ ...salida, contraparte: "STRIPE" }])[0].estadoApp, "falta");
  assert.equal(cruzarConLaApp(con(paseManual({})), [{ ...salida, contraparte: "Bridge" }])[0].estadoApp, "cargado");
});

test("un pase a mano sirve para un solo movimiento y el otro sigue en falta; con dos, cada uno toma el suyo", () => {
  const e = estadoBase();
  const movs = [
    banco({ ref: "mercury:a", refApp: ["a"], tipo: "salida", monto: -30000, contraparte: "Apicanta LLC", fecha: "2026-10-26T18:00:00.000Z" }),
    banco({ ref: "mercury:b", refApp: ["b"], tipo: "salida", monto: -30000, contraparte: "Un proveedor", fecha: "2026-10-27T18:00:00.000Z" }),
  ];
  e.traspasos = [paseManual({ id: "tra_uno" })];
  const uno = cruzarConLaApp(e, movs);
  assert.deepEqual(uno.map((x) => x.estadoApp), ["cargado", "falta"]);
  assert.deepEqual(resumenDeLoQueFalta(uno), { n: 1, sale: 30000, entra: 0 });
  /* Cada movimiento se queda con el pase de la fecha más cercana. */
  e.traspasos = [paseManual({ id: "tra_lejos", fecha: "2026-10-24T15:00:00.000Z" }), paseManual({ id: "tra_cerca", fecha: "2026-10-26T15:00:00.000Z" })];
  assert.deepEqual(cruzarConLaApp(e, movs).map((x) => x.traspasoId), ["tra_cerca", "tra_lejos"]);
  /* Antes que un gasto parecido, y sin gastarlo: otra salida igual lo sigue encontrando. */
  e.traspasos = [paseManual({ id: "tra_uno" })];
  e.gastos = [gasto({ id: "g_igual", concepto: "Proveedor", monto: 30000, fecha: "2026-10-27T12:00:00.000Z" })];
  assert.deepEqual(cruzarConLaApp(e, movs).map((x) => [x.estadoApp, x.traspasoId ?? x.gastoId]), [["cargado", "tra_uno"], ["parecido", "g_igual"]]);
});

test("una llegada a la cuenta se reconoce igual, por lo que llegó y el día que llegó", () => {
  const e = estadoBase();
  /* Del Bank of America a Mercury: salieron 5.000, llegaron 4.990 al otro día. Mercury lo ve como un cobro de alguien que no conoce. */
  e.traspasos = [paseManual({ id: "tra_vuelve", origenId: "proc_bofa", destinoId: "proc_mercury", montoSale: 5000, montoLlega: 4990, fecha: "2026-10-26T15:00:00.000Z", fechaLlega: "2026-10-27T15:00:00.000Z" })];
  const llegada = banco({ ref: "mercury:ll", refApp: ["ll"], tipo: "cobro", monto: 4990, contraparte: "Apicanta LLC", fecha: "2026-10-27T18:00:00.000Z" });
  const r = cruzarConLaApp(e, [llegada])[0];
  assert.deepEqual([r.estadoApp, r.traspasoId], ["cargado", "tra_vuelve"]);
  assert.match(r.donde ?? "", /desde Bank of America \(27\/10\)/);
  assert.equal(resumenDeLoQueFalta([r]).n, 0);
  /* Lo que salió del otro lado (5.000) no es lo que llegó acá. */
  assert.equal(cruzarConLaApp(e, [{ ...llegada, monto: 5000 }])[0].estadoApp, "falta");
  /* Una llegada dada por hecha a mano («a-mano») no es una referencia del banco: la que aparece después es ésa. */
  e.traspasos = [{ ...e.traspasos[0], llegadaRef: "a-mano" }];
  assert.equal(cruzarConLaApp(e, [llegada])[0].estadoApp, "cargado");
  /* El cobro ya entrado a Conciliación manda, como siempre. */
  e.movimientos = [{ id: "mov1", proveedor: "mercury", referencia: "ll", estado: "pendiente" } as Movimiento];
  assert.match(cruzarConLaApp(e, [llegada])[0].donde ?? "", /como cobro/);
});

test("cargar lo que falta: el gasto guarda de qué movimiento viene, baja lo que se esperaba en la cuenta y el movimiento pasa a cargado", () => {
  const e = estadoBase();
  const mov = banco({ ref: "mercury:teatro", refApp: ["teatro"], monto: -85, contraparte: "Teatro Colón", fecha: "2026-10-22T23:00:00.000Z" });
  assert.equal(cruzarConLaApp(e, [mov])[0].estadoApp, "falta");
  const inicial = borradorDesdeElBanco(mov, "ACH-WIRE Mercury", false);
  assert.deepEqual([inicial.concepto, inicial.monto, inicial.cuenta, inicial.ingreso, inicial.bancoRef, inicial.proveedor], ["Teatro Colón", "85", "ACH-WIRE Mercury", false, "mercury:teatro", "Teatro Colón"]);
  const b = { ...borradorInicial(e.ajustes), ...inicial, categoria: "Viáticos equipo", categoriaElegida: true };
  const datos = datosDelGasto(b, { base: "USD", opciones: [] });
  assert.equal(datos.monto, 85);
  assert.equal(datos.extra?.bancoRef, "mercury:teatro");
  assert.equal(datos.extra?.cuenta, "ACH-WIRE Mercury");
  const cargado = { ...datos, id: "g_nuevo" } as Gasto;
  e.gastos = [cargado];
  assert.equal(cruzarConLaApp(e, [mov])[0].estadoApp, "cargado");
  /* La caja de la cuenta lo descuenta: ahora el saldo esperado de Mercury baja 85 y se acerca al real. */
  const previo = { fecha: "2026-10-20T00:00:00.000Z", saldos: [{ procesadorId: "proc_mercury", monto: 1000, moneda: "USD" as const, montoBase: 1000 }] };
  const antes = saldosEsperados({ ...e, gastos: [] }, previo, "2026-10-23T00:00:00.000Z").get("proc_mercury")!;
  const despues = saldosEsperados(e, previo, "2026-10-23T00:00:00.000Z").get("proc_mercury")!;
  assert.equal(antes.esperado, 1000);
  assert.equal(despues.esperado, 915);
});

test("cargar el cashback como ingreso: queda con monto negativo, en la categoría Cashback y sube lo esperado en Mercury", () => {
  const e = estadoBase();
  const mov = banco({ ref: "mercury:cb1", refApp: ["cb1"], tipo: "cashback", monto: 12.4, contraparte: "Mercury", fecha: "2026-10-22T14:00:00.000Z" });
  const inicial = borradorDesdeElBanco(mov, "ACH-WIRE Mercury", true);
  assert.deepEqual([inicial.concepto, inicial.monto, inicial.ingreso, inicial.proveedor], ["Cashback Mercury", "12,40", true, "Mercury"]);
  const b = { ...borradorInicial(e.ajustes), ...inicial, categoria: "Cashback", categoriaElegida: true };
  const datos = datosDelGasto(b, { base: "USD", opciones: [] });
  assert.equal(datos.monto, -12.4);
  assert.equal(datos.extra?.ingreso, true);
  e.gastos = [{ ...datos, id: "g_cb" } as Gasto];
  assert.equal(cruzarConLaApp(e, [mov])[0].estadoApp, "cargado");
  const previo = { fecha: "2026-10-20T00:00:00.000Z", saldos: [{ procesadorId: "proc_mercury", monto: 1000, moneda: "USD" as const, montoBase: 1000 }] };
  assert.equal(saldosEsperados(e, previo, "2026-10-23T00:00:00.000Z").get("proc_mercury")!.esperado, 1012.4);
});

const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

test("el servidor trae los movimientos de Mercury de todas sus cuentas (también la tarjeta de crédito) y avisa de la que no se pudo leer", async () => {
  const guardado = process.env.MERCURY_API_TOKEN;
  const original = globalThis.fetch;
  process.env.MERCURY_API_TOKEN = "token";
  const pedidos: string[] = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (u.endsWith("/accounts")) return respuesta({ accounts: [{ id: "a1", kind: "checking", name: "Checking" }, { id: "c1", kind: "creditCard", name: "Tarjeta" }, { id: "x1", kind: "savings", name: "Savings" }] });
      if (u.includes("/account/a1/")) return respuesta({ transactions: [
        { id: "t1", amount: -7.5, createdAt: "2026-10-21T10:00:00Z", postedAt: "2026-10-22T10:00:00Z", status: "sent", kind: "debitCardTransaction", counterpartyName: "Starbucks" },
        { id: "t2", amount: 1500, createdAt: "2026-10-22T11:00:00Z", status: "sent", kind: "incomingDomesticWire", counterpartyName: "Gustavo" },
        { id: "viejo", amount: -3, createdAt: "2026-09-01T11:00:00Z", status: "sent", kind: "debitCardTransaction", counterpartyName: "Viejo" },
      ] });
      if (u.includes("/account/c1/")) return respuesta({ transactions: [{ id: "t3", amount: -85, createdAt: "2026-10-22T20:00:00Z", status: "sent", kind: "creditCardTransaction", counterpartyName: "Teatro Colón" }] });
      return respuesta({ message: "no" }, 500);
    }) as typeof fetch;
    const r = await movimientosDeMercury(new Date("2026-10-20T00:00:00Z"));
    assert.equal(r.conectada, true);
    assert.deepEqual(r.movimientos.map((m) => [m.ref, m.tipo, m.monto]), [["mercury:t3", "compra-credito", -85], ["mercury:t2", "cobro", 1500], ["mercury:t1", "compra-tarjeta", -7.5]], "del más nuevo al más viejo, sin lo anterior al día pedido");
    assert.equal(r.avisos.length, 1, "la cuenta de ahorro falló: se avisa y lo demás sigue");
    assert.match(r.avisos[0], /Savings/);
    /* Una tarjeta que no devuelve compras se avisa. */
    const sinCompras = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/accounts")) return respuesta({ accounts: [{ id: "c1", kind: "creditCard", name: "Tarjeta" }] });
      return respuesta({ transactions: [] });
    }) as typeof fetch;
    const sin = await movimientosDeMercury(new Date("2026-10-20T00:00:00Z"));
    assert.match(sin.avisos[0] ?? "", /no mostró compras de la tarjeta «Tarjeta»/);
    globalThis.fetch = sinCompras;
    assert.ok(pedidos.some((u) => u.includes("/account/c1/")), "también pidió la tarjeta de crédito");
    delete process.env.MERCURY_API_TOKEN;
    assert.deepEqual(await movimientosDeMercury(new Date()), { movimientos: [], avisos: [], conectada: false }, "sin clave: no está conectada");
  } finally {
    globalThis.fetch = original;
    if (guardado === undefined) delete process.env.MERCURY_API_TOKEN; else process.env.MERCURY_API_TOKEN = guardado;
  }
});

test("el servidor trae los movimientos de Stripe de a páginas de 100 hasta que no hay más", async () => {
  const guardado = process.env.STRIPE_SECRET_KEY;
  const original = globalThis.fetch;
  process.env.STRIPE_SECRET_KEY = "sk_test";
  const pedidos: string[] = [];
  const t = (id: string, extra: Record<string, unknown> = {}) => ({ id, amount: -2480, net: -2480, fee: 0, type: "stripe_fee", source: "", created: 1792537257, description: "Stripe fee", ...extra });
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      pedidos.push(u);
      if (!u.includes("starting_after")) return respuesta({ has_more: true, data: [t("txn_1"), t("txn_2", { type: "charge", amount: 100000, net: 95570, fee: 4430, source: "ch_9" })] });
      return respuesta({ has_more: false, data: [t("txn_3", { type: "payout", source: "po_1", amount: -47750, net: -47750 })] });
    }) as typeof fetch;
    const r = await movimientosDeStripe(new Date("2026-10-19T00:00:00Z"));
    assert.deepEqual(r.movimientos.map((m) => [m.ref, m.tipo]).sort(), [["stripe:txn_1", "comision"], ["stripe:txn_2", "cobro"], ["stripe:txn_3", "pase"]]);
    assert.equal(pedidos.length, 2);
    assert.match(pedidos[0], /created%5Bgte%5D=/);
    assert.match(pedidos[1], /starting_after=txn_2/);
    delete process.env.STRIPE_SECRET_KEY;
    assert.equal((await movimientosDeStripe(new Date())).conectada, false);
  } finally {
    globalThis.fetch = original;
    if (guardado === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = guardado;
  }
});

test("un contracargo de Stripe se propone como devolución con el motivo; el que se ganó o es sólo un aviso de fraude, no", () => {
  const d = (extra: Record<string, unknown>) => ({ id: "du_1", status: "needs_response", amount: 45700, currency: "usd", created: 1792537257, reason: "fraudulent", charge: { id: "ch_3UEVD8", payment_intent: "pi_8", billing_details: { name: "Erick Jiménez", email: "e@x.com" } }, ...extra });
  const r = reembolsoDeContracargoStripe(d({}))!;
  assert.deepEqual([r.proveedor, r.referencia, r.monto, r.referenciasCobro, r.motivo], ["stripe", "disputa:du_1", 457, ["ch_3UEVD8", "pi_8"], "Contracargo (fraudulent)"]);
  assert.equal(reembolsoDeContracargoStripe(d({ status: "lost" }))!.monto, 457);
  /* Las ganadas también se informan (si ya había una propuesta se va sola), con su estado; un aviso temprano de fraude no retiró nada. */
  assert.equal(reembolsoDeContracargoStripe(d({ status: "won" }))!.disputa?.estado, "ganada");
  assert.equal(reembolsoDeContracargoStripe(d({ status: "lost" }))!.disputa?.estado, "perdida");
  assert.equal(reembolsoDeContracargoStripe(d({ status: "under_review" }))!.disputa?.estado, "en-disputa");
  assert.equal(reembolsoDeContracargoStripe(d({ status: "warning_needs_response" })), null, "un aviso temprano no retiró nada");
  assert.equal(reembolsoDeContracargoStripe(d({ amount: 0 })), null);
});
