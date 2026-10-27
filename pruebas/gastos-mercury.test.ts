import test from "node:test";
import assert from "node:assert/strict";
import {
  esComisionDeProcesador, esExportDeMercury, esGastoDeComisionDeProcesador, fechasDeMercury, gastoParecido, indiceDeGastos, leerExportDeMercury, montoDeMercury,
  pagosDeTarjetaDelRango, personaDelEquipo, queEsMercury, categoriaDeRubroMercury, type FilaMercury,
} from "@/lib/gastos-mercury";
import { armarFilas, gastosDeFilas, parsearPegado, resumenDeFilas, razonParaDejarAfuera, adivinarColumnas, tieneTitulos } from "@/lib/gastos-masivos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto, MiembroEquipo } from "@/lib/types";

/* ==================================================================
   El export de Mercury (Aldana, 27/10): las compras de la tarjeta entraban como un solo pago diario («Pago de la tarjeta de crédito Mercury», operativo)
   y las «Comisiones» de procesadores exportadas de la planilla Finance estaban cargadas además de lo que el sistema ya calcula de cada cobro. Los pagos de
   equipo de fin de mes se registran dos veces si se cargan, porque ya los registra el cierre de la liquidación.
   ================================================================== */

const equipo = (nombre: string, id = nombre.toLowerCase().replace(/\W/g, "")): MiembroEquipo =>
  ({ id, nombre, rol: "otro", comisionRate: 0, activo: true, sinComision: false } as MiembroEquipo);
const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Software", grupo: "operativo", concepto: "Notion", monto: 20, moneda: "USD", fecha: "2026-10-08T12:00:00.000Z", recurrente: false, creadoEn: "2026-10-08T12:00:00.000Z", extra: {}, ...g,
});
const estado = (gastos: Gasto[] = []): EstadoApp => {
  const s = construirSemilla() as EstadoApp;
  return { ...s, gastos, equipo: [equipo("Agustín Sica"), equipo("Mariano Arias"), equipo("Angelo Nisi")], ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio: 1450 } };
};

const TITULOS = ["Date (UTC)", "Description", "Amount", "Status", "Source Account", "Bank Description", "Reference", "Note", "Last Four Digits", "Name On Card", "Merchant Type", "Category", "Source of Category", "GL Code", "Source of GL Code", "Timestamp"];
const fila = (o: Record<string, string>) => TITULOS.map((t) => o[t] ?? "");
const TARJETA = "Mercury Credit";
const CORRIENTE = "Mercury Checking xx5408";

test("esExportDeMercury: sus títulos sí, una planilla común no", () => {
  assert.equal(esExportDeMercury(TITULOS), true);
  assert.equal(esExportDeMercury(["Fecha", "Concepto", "Monto"]), false);
  assert.equal(esExportDeMercury(["Date", "Description", "Amount"]), false);
});

test("montoDeMercury: con el signo del banco, y lo que queda al pegar desde Excel en castellano", () => {
  assert.equal(montoDeMercury("-2347.3"), -2347.3);
  assert.equal(montoDeMercury("-2.347,30"), -2347.3);
  assert.equal(montoDeMercury("603.77"), 603.77);
  assert.equal(montoDeMercury("−5,00"), -5);
  assert.equal(montoDeMercury("hola"), null);
});

test("fechasDeMercury: mes-día-año del banco, día/mes de Excel, y ISO; si es ambiguo decide la hora de creación", () => {
  assert.deepEqual(fechasDeMercury(["10-27-2026", "10-05-2026"]), ["2026-10-27", "2026-10-05"], "un 27 en segundo lugar: mes-día-año");
  assert.deepEqual(fechasDeMercury(["27/10/2026", "05/10/2026"]), ["2026-10-27", "2026-10-05"], "un 27 en primer lugar: día/mes/año");
  assert.deepEqual(fechasDeMercury(["2026-10-27 00:00:00", "2026-10-05"]), ["2026-10-27", "2026-10-05"]);
  /* Todas ambiguas: gana el orden que coincide con la hora de creación. */
  assert.deepEqual(fechasDeMercury(["05/10/2026", "06/10/2026"], ["2026-10-05T14:00:00", "2026-10-06T09:00:00"]), ["2026-10-05", "2026-10-06"]);
  assert.deepEqual(fechasDeMercury(["10/05/2026", "10/06/2026"], ["2026-10-05T14:00:00", "2026-10-06T09:00:00"]), ["2026-10-05", "2026-10-06"]);
  assert.equal(fechasDeMercury(["nada"])[0], null);
});

test("esComisionDeProcesador: «Comisiones 12-18 Dlocal» sí; «Comisión por facturación» y un gasto común no", () => {
  for (const c of ["Comisiones stripe 12-18 Octubre", "Comisiones 12-18 Dlocal", "Comisiones Financiera ARS Mentoria 7-10 al 11-10", "Comisiones 06-07 Oct Mentoría Stripe"]) {
    assert.equal(esComisionDeProcesador(c), true, c);
  }
  for (const c of ["Comisión por facturación", "Notion", "Pago de comisiones a closers", "Stripe", "Comisiones de transacción whop a mercury"]) assert.equal(esComisionDeProcesador(c), false, c);
  assert.equal(esGastoDeComisionDeProcesador(gasto({ id: "a", categoria: "Facturas Stripe", grupo: "directo", concepto: "Comisiones stripe 12-18 Octubre" })), true);
  assert.equal(esGastoDeComisionDeProcesador(gasto({ id: "b", categoria: "Facturas Stripe", grupo: "directo", concepto: "Factura de Stripe de septiembre" })), false);
});

test("personaDelEquipo: el primer y el último nombre alcanzan, con o sin tildes y con los paréntesis del banco", () => {
  const e = estado();
  assert.equal(personaDelEquipo("Agustin Sica", e), "Agustín Sica");
  assert.equal(personaDelEquipo("Mariano Arias (Closer) (Mariano Daniel Arias Kahale)", e), "Mariano Arias");
  assert.equal(personaDelEquipo("Angelo Nisi (Emperador Financiero LLC)", e), "Angelo Nisi");
  assert.equal(personaDelEquipo("Starbucks", e), null);
  assert.equal(personaDelEquipo("Mariano's Pizza", e), null, "sólo el nombre de pila no es la persona");
});

const mov = (o: Partial<FilaMercury>): FilaMercury => ({
  fecha: "2026-10-22", descripcion: "Uber", monto: -12.5, estado: "Sent", cuentaOrigen: TARJETA, descripcionBanco: "UBER", referencia: "", nota: "", tarjeta: "4730", rubroMercury: "", comercio: "RideshareAndTaxis", timestamp: "2026-10-22T10:00:00.000Z", ...o,
});

test("queEsMercury: qué es cada movimiento", () => {
  const e = estado();
  assert.deepEqual(queEsMercury(mov({}), e), { tipo: "gasto" });
  assert.equal(queEsMercury(mov({ estado: "Failed", monto: -5000, descripcion: "Hotmart" }), e).tipo, "afuera");
  /* La tarjeta: el pago que llega desde la cuenta corriente no es un gasto; un reintegro del comercio sí es plata que vuelve. */
  const pagoRecibido = queEsMercury(mov({ monto: 2212.62, descripcion: "Mercury Checking xx5408", descripcionBanco: "IO AUTOPAY" }), e);
  assert.equal(pagoRecibido.tipo, "afuera");
  assert.match((pagoRecibido as { motivo: string }).motivo, /pago de la tarjeta/i);
  assert.deepEqual(queEsMercury(mov({ monto: 2359.79, descripcion: "Heritage Hotel New York City", descripcionBanco: "HERITAGE HOTEL" }), e), { tipo: "ingreso" });
  /* La cuenta corriente. */
  const autopay = queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Mercury Credit", descripcionBanco: "", monto: -2212.62 }), e);
  assert.equal(autopay.tipo, "afuera");
  assert.match((autopay as { motivo: string }).motivo, /pago de la tarjeta/i);
  /* Todo lo que sale por «Send Money» trae la referencia «From APICANTA LLC via mercury.com»: eso no hace que sea un pase entre cuentas. */
  const conReferencia = queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Mariano Arias (Closer) (Mariano Daniel Arias Kahale)", monto: -3383.22, descripcionBanco: "Send Money transaction initiated on Mercury", referencia: "From APICANTA LLC via mercury.com" }), e);
  assert.match((conReferencia as { motivo: string }).motivo, /pago de equipo/i);
  assert.deepEqual(queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Atlassian", monto: -24, descripcionBanco: "Send Money transaction initiated on Mercury", referencia: "From APICANTA LLC via mercury.com" }), e), { tipo: "gasto" });
  assert.match((queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "GLOBAL BUSINESS COMMUNITY BLOCK LLC", monto: -40000, referencia: "For further credit to Apicanta LLC" }), e) as { motivo: string }).motivo, /entre cuentas propias/i);
  const equipoPago = queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Agustin Sica", monto: -2347.3, rubroMercury: "Payroll" }), e);
  assert.match((equipoPago as { motivo: string }).motivo, /pago de equipo/i);
  assert.match((queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Angelo Nisi (Emperador Financiero LLC)", monto: -500 }), e) as { motivo: string }).motivo, /pago de equipo/i);
  assert.match((queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Apicanta LLC - Relay (Apicanta LLC)", monto: -30000, rubroMercury: "Transfer" }), e) as { motivo: string }).motivo, /entre cuentas propias/i);
  assert.match((queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Mercury IO Cashback", monto: 9.07, descripcionBanco: "" }), e) as { motivo: string }).motivo, /cashback/i);
  assert.match((queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Whop", monto: 5200, rubroMercury: "Revenue" }), e) as { motivo: string }).motivo, /plata que entra/i);
  assert.deepEqual(queEsMercury(mov({ cuentaOrigen: CORRIENTE, descripcion: "Atlassian", monto: -24, rubroMercury: "Software & Subscriptions" }), e), { tipo: "gasto" });
});

test("categoriaDeRubroMercury: Facebook es Meta Ads, el software es Software, lo personal es honorarios del CEO y lo que no se sabe queda vacío", () => {
  const c = (descripcion: string, rubroMercury = "", comercio = "") => categoriaDeRubroMercury({ descripcion, rubroMercury, comercio });
  assert.equal(c("Facebook", "Marketing & Advertising", "Advertising"), "Meta Ads");
  assert.equal(c("Notion", "Software & Subscriptions", "Software"), "Software");
  assert.equal(c("Hymperium, LLC", "", "Software"), "Software");
  assert.equal(c("Starbucks", "Business Meals", "Restaurants"), "Honorarios del CEO");
  assert.equal(c("Uber", "", "RideshareAndTaxis"), "Honorarios del CEO");
  assert.equal(c("Skechers", "", "Clothing"), "Honorarios del CEO");
  assert.equal(c("Apple", "Office Supplies & Equipment", "Electronics"), "", "un equipo puede ser de la empresa: se revisa");
  assert.equal(c("Intl. Transaction Fee", "Bank Fees", "FinancialInstitutionsAndFees"), "");
});

test("gastoParecido: entre dos gastos del mismo monto gana el que se llama parecido, aunque esté un día más lejos", () => {
  const dia = (g: { fecha: string }) => g.fecha.slice(0, 10);
  const idx = indiceDeGastos([
    { id: "otro", fecha: "2026-10-24T12:00:00Z", monto: 14.99, concepto: "Hostinger" },
    { id: "ipostal", fecha: "2026-10-23T12:00:00Z", monto: 14.99, concepto: "iPostal1", proveedor: "Ipostal1" },
  ], dia);
  assert.equal(gastoParecido(idx, new Set(), "2026-10-24", 14.99, "iPostal1"), "ipostal");
  assert.equal(gastoParecido(idx, new Set(), "2026-10-24", 14.99, "Algo distinto"), "otro", "sin nombre parecido, el más cercano");
});

test("gastoParecido: mismo monto a menos de tres días, y cada gasto sirve para un solo movimiento", () => {
  const dia = (g: { fecha: string }) => g.fecha.slice(0, 10);
  const idx = indiceDeGastos([
    { id: "g1", fecha: "2026-10-20T12:00:00Z", monto: 31.2 }, { id: "g2", fecha: "2026-10-21T12:00:00Z", monto: 31.2 }, { id: "g3", fecha: "2026-10-30T12:00:00Z", monto: 99 },
  ], dia);
  const usados = new Set<string>();
  assert.equal(gastoParecido(idx, usados, "2026-10-21", 31.2), "g2", "el más cercano");
  assert.equal(gastoParecido(idx, usados, "2026-10-21", 31.2), "g1", "el segundo movimiento igual se lleva el otro gasto");
  assert.equal(gastoParecido(idx, usados, "2026-10-21", 31.2), null, "un tercero no tiene gasto: es nuevo");
  assert.equal(gastoParecido(idx, usados, "2026-10-21", 99), null, "mismo monto pero diez días después: no es el mismo");
});

/* El export completo, pegado como lo copia Excel. */
const exportDe = (filas: Record<string, string>[]) => [TITULOS.join("\t"), ...filas.map((f) => fila(f).join("\t"))].join("\n");

test("armarFilas con un export de Mercury: gastos, reintegro y lo que queda afuera, cada uno con su motivo", () => {
  const e = estado([
    gasto({ id: "ya", concepto: "Starbucks", categoria: "Honorarios del CEO", grupo: "dueno", monto: 4.5, fecha: "2026-10-21T12:00:00.000Z" }),
    gasto({ id: "lump", categoria: "Pendiente de revisión", concepto: "Pago de la tarjeta de crédito Mercury", monto: 2212.62, fecha: "2026-10-22T12:00:00.000Z", extra: { bancoRef: "mercury:abc" } }),
  ]);
  const texto = exportDe([
    { "Date (UTC)": "2026-10-22", Description: "Uber", Amount: "-12.5", Status: "Sent", "Source Account": TARJETA, "Merchant Type": "RideshareAndTaxis", Timestamp: "2026-10-22T10:00:00.000Z", "Last Four Digits": "4730" },
    { "Date (UTC)": "2026-10-22", Description: "Starbucks", Amount: "-4.5", Status: "Sent", "Source Account": TARJETA, "Merchant Type": "Restaurants", Category: "Business Meals", Timestamp: "2026-10-22T09:00:00.000Z", "Last Four Digits": "4730" },
    { "Date (UTC)": "2026-10-22", Description: "Facebook", Amount: "-600", Status: "Sent", "Source Account": TARJETA, Category: "Marketing & Advertising", "Merchant Type": "Advertising", Timestamp: "2026-10-22T08:00:00.000Z" },
    { "Date (UTC)": "2026-10-22", Description: "Heritage Hotel New York City", Amount: "2359.79", Status: "Sent", "Source Account": TARJETA, Timestamp: "2026-10-22T07:00:00.000Z" },
    { "Date (UTC)": "2026-10-22", Description: "Mercury Checking xx5408", Amount: "2212.62", Status: "Sent", "Source Account": TARJETA, "Bank Description": "IO AUTOPAY", Timestamp: "2026-10-22T06:00:00.000Z" },
    { "Date (UTC)": "2026-10-22", Description: "Agustin Sica", Amount: "-2347.3", Status: "Sent", "Source Account": CORRIENTE, Category: "Payroll", Timestamp: "2026-10-22T05:00:00.000Z" },
    { "Date (UTC)": "2026-10-22", Description: "Hotmart", Amount: "-5000", Status: "Failed", "Source Account": TARJETA, Timestamp: "2026-10-22T04:00:00.000Z" },
    { "Date (UTC)": "2026-10-22", Description: "Apple", Amount: "-214", Status: "Sent", "Source Account": TARJETA, Category: "Office Supplies & Equipment", "Merchant Type": "Electronics", Timestamp: "2026-10-22T03:00:00.000Z" },
  ]);
  const tabla = parsearPegado(texto);
  const filas = armarFilas(tabla, adivinarColumnas(tabla, tieneTitulos(tabla)), true, { e });
  const porConcepto = new Map(filas.map((f) => [f.concepto, f]));
  assert.equal(filas.length, 8);
  const uber = porConcepto.get("Uber")!;
  assert.deepEqual([uber.incluir, uber.ingreso, uber.categoria, uber.monto, uber.cuenta, uber.fecha], [true, false, "Honorarios del CEO", "12,5", "Mercury", "2026-10-22"]);
  assert.equal(uber.extraGasto?.origen, "mercury-export");
  const sbux = porConcepto.get("Starbucks")!;
  assert.deepEqual([sbux.yaCargada, sbux.incluir], [true, false], "ya estaba cargado (mismo monto, un día antes)");
  assert.equal(porConcepto.get("Facebook")!.categoria, "Meta Ads");
  const heritage = porConcepto.get("Heritage Hotel New York City")!;
  assert.deepEqual([heritage.ingreso, heritage.incluir, heritage.monto], [true, true, "2359,79"]);
  const pago = porConcepto.get("Mercury Checking xx5408")!;
  assert.deepEqual([pago.incluir, Boolean(pago.afuera)], [false, true]);
  assert.match(pago.afuera!, /pago de la tarjeta/i);
  assert.match(porConcepto.get("Agustin Sica")!.afuera!, /pago de equipo/i);
  assert.match(porConcepto.get("Hotmart")!.afuera!, /fallido/i);
  const apple = porConcepto.get("Apple")!;
  assert.equal(apple.categoria, "Pendiente de revisión", "lo que no se sabe, a revisar");
  assert.match(apple.notas, /Revisar/);
  /* Lo que se carga: Uber, Facebook, Heritage (ingreso) y Apple; el resto queda afuera con motivo. */
  const r = resumenDeFilas(filas, e);
  assert.equal(r.aCargar, 4);
  assert.equal(r.yaCargadas, 1);
  assert.equal(r.afuera, 3);
  const datos = gastosDeFilas(filas, e, "lote_x");
  assert.equal(datos.length, 4);
  assert.ok(datos.every((g) => g.extra?.origen === "mercury-export" && g.extra?.cargaMasiva === "lote_x"));
  assert.equal(datos.find((g) => g.concepto === "Uber")!.extra?.tarjeta, "4730");
  /* El pago de la tarjeta de esas fechas, cargado como un solo gasto, es lo que se reemplaza por las compras. */
  const pagos = pagosDeTarjetaDelRango(e.gastos, "2026-10-21", "2026-10-26", (g) => g.fecha.slice(0, 10));
  assert.deepEqual(pagos.map((g) => g.id), ["lump"]);
});

test("el mismo export pegado dos veces no carga nada nuevo (por la hora de creación de cada movimiento)", () => {
  const texto = exportDe([{ "Date (UTC)": "2026-10-22", Description: "Uber", Amount: "-12.5", Status: "Sent", "Source Account": TARJETA, Timestamp: "2026-10-22T10:00:00.000Z" }]);
  const e0 = estado();
  const tabla = parsearPegado(texto);
  const primera = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e: e0 });
  const datos = gastosDeFilas(primera, e0, "lote_1");
  assert.equal(datos.length, 1);
  const e1 = { ...e0, gastos: [{ ...datos[0], id: "nuevo" } as Gasto] };
  const segunda = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e: e1 });
  assert.equal(segunda[0].yaCargada, true);
  assert.equal(segunda[0].incluir, false);
});

test("en una planilla común también quedan afuera la comisión de un procesador y el pago de la tarjeta (con motivo), y se pueden marcar igual", () => {
  const e = estado();
  const tabla = parsearPegado("Fecha\tConcepto\tMonto\n11/10/2026\tComisiones stripe 7-10 al 11-10\t365,27\n11/10/2026\tNotion\t20\n12/10/2026\tPago de la tarjeta de crédito Mercury\t2212,62");
  const filas = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e, hoy: new Date("2026-10-20T15:00:00Z") });
  assert.deepEqual(filas.map((f) => [f.concepto, f.incluir, Boolean(f.afuera)]), [
    ["Comisiones stripe 7-10 al 11-10", false, true], ["Notion", true, false], ["Pago de la tarjeta de crédito Mercury", false, true],
  ]);
  assert.match(filas[0].afuera!, /ya se calcula de cada cobro/);
  assert.equal(razonParaDejarAfuera({ concepto: "Comisión por facturación", proveedor: "", ingreso: false }, e), undefined);
  assert.equal(razonParaDejarAfuera({ concepto: "Comisiones stripe", proveedor: "", ingreso: true }, e), undefined, "si la plata vuelve no es un gasto duplicado");
});
