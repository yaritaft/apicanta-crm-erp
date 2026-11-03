import test from "node:test";
import assert from "node:assert/strict";
import { esExportDeBofa, leerExportDeBofa, limpiarDescripcionBofa, queEsBofa, refDeBofa } from "@/lib/gastos-bofa";
import { armarFilas, parsearPegado } from "@/lib/gastos-masivos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto } from "@/lib/types";

/* ==================================================================
   Manu (03/11): «cuenta Mercury no vamos a manejar más, ahora vamos a manejar la cuenta del Bank of America [...] que chupe todos los gastos a nivel
   individual». Bank of America no tiene API para la app: baja los movimientos en CSV (cuenta y tarjeta). Se prueba con archivos de ejemplo con el formato
   que escribe el banco (resumen arriba, fechas mes/día/año, montos entre comillas con coma de miles).
   ================================================================== */

const CUENTA = [
  "Description,,Summary Amt.",
  'Beginning balance as of 10/01/2026,,"12,345.67"',
  'Total credits,,"5,000.00"',
  'Total debits,,"-3,200.50"',
  'Ending balance as of 10/31/2026,,"14,145.17"',
  "",
  "Date,Description,Amount,Running Bal.",
  '10/01/2026,Beginning balance as of 10/01/2026,,"12,345.67"',
  '10/02/2026,"CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA 24692165275100012345678","-23.98","12,321.69"',
  '10/02/2026,"CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA 24692165275100012345679","-23.98","12,297.71"',
  '10/03/2026,"Zelle payment from JOHN DOE Conf# abc123","1,500.00","13,797.71"',
  '10/05/2026,"BANK OF AMERICA CREDIT CARD Bill Payment","-1,658.48","12,139.23"',
  '10/06/2026,"Zelle payment to Angelo Nisi Conf# xyz789","-500.00","11,639.23"',
  '10/07/2026,"Online Banking transfer to CHK 4321 Confirmation# 998877","-18,302.00","-6,662.77"',
  '10/08/2026,"MONTHLY MAINTENANCE FEE","-15.00","-6,677.77"',
  '10/09/2026,"WISE US INC Transfer from Mercury","250.00","-6,427.77"',
  '10/10/2026,"CHECKCARD 1009 NOTION LABS INC NOTION.SO CA","-20.00","-6,447.77"',
].join("\n");

const TARJETA = [
  "Posted Date,Reference Number,Payee,Address,Amount",
  '10/02/2026,24692165275100012345678,"STARBUCKS STORE 12345","SEATTLE WA",-5.30',
  '10/03/2026,24692165275100012345679,"AMAZON MKTPL*AB12","AMZN.COM/BILL WA",-89.99',
  '10/04/2026,24692165275100012345680,"PAYMENT - THANK YOU","",1000.00',
].join("\n");

const base = (gastos: Gasto[] = []): EstadoApp => {
  const s = construirSemilla() as EstadoApp;
  return {
    ...s, gastos, ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio: 1450 },
    equipo: [{ id: "eq_angelo", nombre: "Angelo Nisi", rol: "growth", comisionRate: 0, activo: true, sinComision: false }] as EstadoApp["equipo"],
  };
};

test("reconoce el export de cuenta (con el resumen arriba) y el de tarjeta; no confunde otras planillas", () => {
  assert.equal(esExportDeBofa(parsearPegado(CUENTA)), true);
  assert.equal(esExportDeBofa(parsearPegado(TARJETA)), true);
  assert.equal(esExportDeBofa(parsearPegado("Fecha\tConcepto\tMonto\n07/10/2026\tUber\t12,5")), false, "una planilla común sigue su camino");
  assert.equal(esExportDeBofa(parsearPegado("Date,Description,Amount\n10/02/2026,Uber,-12.50")), false, "sin «Running Bal.» no es del banco");
});

test("lee fechas de Estados Unidos y montos con coma de miles; descarta el saldo inicial", () => {
  const filas = leerExportDeBofa(parsearPegado(CUENTA))!;
  assert.equal(filas.length, 9, "el «Beginning balance» no es un movimiento");
  assert.deepEqual(filas[0], { fecha: "2026-10-02", descripcion: "CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA 24692165275100012345678", monto: -23.98, saldo: 12321.69, origen: "cuenta", repetida: 1 });
  const zelle = filas.find((f) => /JOHN DOE/.test(f.descripcion))!;
  assert.equal(zelle.monto, 1500);
  assert.equal(filas.find((f) => /transfer to CHK/.test(f.descripcion))!.monto, -18302);
  const tarjeta = leerExportDeBofa(parsearPegado(TARJETA))!;
  assert.deepEqual(tarjeta.map((f) => [f.fecha, f.monto, f.origen]), [["2026-10-02", -5.3, "tarjeta"], ["2026-10-03", -89.99, "tarjeta"], ["2026-10-04", 1000, "tarjeta"]]);
});

test("cada movimiento: gasto, o afuera con su motivo (tarjeta, equipo, entre cuentas, lo que entra)", () => {
  const e = base();
  const que = (desc: string, monto: number, origen: "cuenta" | "tarjeta" = "cuenta") => queEsBofa({ fecha: "2026-10-02", descripcion: desc, monto, origen, repetida: 1 }, e);
  assert.equal(que("CHECKCARD 1001 UBER *TRIP HELP.UBER.COM CA", -23.98).tipo, "gasto");
  assert.match((que("BANK OF AMERICA CREDIT CARD Bill Payment", -1658.48) as { motivo: string }).motivo, /pago de la tarjeta/i);
  assert.match((que("Zelle payment to Angelo Nisi Conf# xyz789", -500) as { motivo: string }).motivo, /pago de equipo/i);
  assert.match((que("Online Banking transfer to CHK 4321", -18302) as { motivo: string }).motivo, /entre cuentas propias/i);
  assert.match((que("Zelle payment from JOHN DOE", 1500) as { motivo: string }).motivo, /entra/i);
  assert.match((que("WISE US INC Transfer from Mercury", 250) as { motivo: string }).motivo, /cuenta propia/i);
  assert.equal(que("REFUND AMAZON MKTPL", 40).tipo, "ingreso", "un reintegro es plata que volvió");
  assert.equal(que("PAYMENT - THANK YOU", 1000, "tarjeta").tipo, "afuera", "un pago a la tarjeta, visto desde la tarjeta, entra: no es un gasto");
  /* En el archivo de la tarjeta, una compra que se llama «payment» es una compra. */
  assert.equal(que("PAYMENT PROCESSING INC", -30, "tarjeta").tipo, "gasto");
});

test("Cargar varios: cada gasto sale de la cuenta Bank of America, con el nombre limpio, y lo que no es gasto queda afuera", () => {
  const filas = armarFilas(parsearPegado(CUENTA), [], false, { e: base() });
  assert.equal(filas.length, 9);
  const gastos = filas.filter((f) => f.incluir);
  assert.deepEqual(gastos.map((f) => [f.fecha, f.concepto, f.monto]), [
    ["2026-10-02", "UBER *TRIP HELP.UBER.COM CA", "23,98"],
    ["2026-10-02", "UBER *TRIP HELP.UBER.COM CA", "23,98"],
    ["2026-10-08", "MONTHLY MAINTENANCE FEE", "15"],
    ["2026-10-10", "NOTION LABS INC NOTION.SO CA", "20"],
  ], "los dos Uber iguales del mismo día son dos gastos");
  assert.ok(gastos.every((f) => f.cuenta === "Bank of America" && f.moneda === "USD" && !f.ingreso));
  assert.ok(gastos.every((f) => typeof f.extraGasto?.bancoRef === "string" && f.extraGasto.origen === "bofa-export"));
  const afuera = filas.filter((f) => f.afuera);
  assert.equal(afuera.length, 5, "tarjeta, Angelo, traspaso, lo que entró de Zelle y lo que vino de Mercury");
  assert.equal(new Set(gastos.map((f) => f.extraGasto?.bancoRef)).size, gastos.length, "cada gasto tiene su propia referencia (también los dos Uber)");
});

test("bajar el archivo otra vez no repite lo que ya se cargó: por su referencia y, si alguien lo cargó a mano con otro día, por monto y fecha cercana", () => {
  const primera = armarFilas(parsearPegado(CUENTA), [], false, { e: base() });
  const cargados: Gasto[] = primera.filter((f) => f.incluir).map((f, i) => ({
    id: `g${i}`, categoria: "Software", grupo: "operativo", concepto: f.concepto, monto: Number(f.monto.replace(",", ".")), moneda: "USD", fecha: `${f.fecha}T15:00:00.000Z`,
    recurrente: false, creadoEn: "2026-11-03T12:00:00.000Z", extra: f.extraGasto,
  } as Gasto));
  const otra = armarFilas(parsearPegado(CUENTA), [], false, { e: base(cargados) });
  assert.equal(otra.filter((f) => f.incluir).length, 0, "nada nuevo para cargar");
  assert.equal(otra.filter((f) => f.yaCargada).length, 4);
  /* Un gasto cargado a mano el 10/09 (un día antes) por el mismo Notion de US$ 20 y sin referencia del banco. */
  const aMano: Gasto = { id: "m1", categoria: "Software", grupo: "operativo", concepto: "Notion", monto: 20, moneda: "USD", fecha: "2026-10-09T15:00:00.000Z", recurrente: false, creadoEn: "2026-10-09T15:00:00.000Z", extra: {} } as Gasto;
  const conMano = armarFilas(parsearPegado(CUENTA), [], false, { e: base([aMano]) });
  assert.equal(conMano.find((f) => /NOTION/.test(f.concepto))!.yaCargada, true);
});

test("el nombre se limpia sin perder el comercio; la referencia no cambia entre descargas", () => {
  assert.equal(limpiarDescripcionBofa("CHECKCARD 1031 UBER *TRIP HELP.UBER.COM CA 24692165275100012345678"), "UBER *TRIP HELP.UBER.COM CA");
  assert.equal(limpiarDescripcionBofa("Zelle payment to MARIA LOPEZ Conf# abc123"), "Zelle payment to MARIA LOPEZ");
  assert.equal(limpiarDescripcionBofa("MONTHLY MAINTENANCE FEE"), "MONTHLY MAINTENANCE FEE");
  assert.equal(limpiarDescripcionBofa("PURCHASE 1020 FIGMA INC XXXXXXXXXXXX1234"), "FIGMA INC");
  const m = { fecha: "2026-10-02", descripcion: "UBER", monto: -23.98, origen: "cuenta" as const, repetida: 1 };
  assert.equal(refDeBofa(m), refDeBofa({ ...m }));
  assert.notEqual(refDeBofa(m), refDeBofa({ ...m, repetida: 2 }));
});
