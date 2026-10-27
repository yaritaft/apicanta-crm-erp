import test from "node:test";
import assert from "node:assert/strict";
import {
  adivinarColumnas, armarFilas, gastosDeFilas, leerFecha, leerMontoPegado, parsearPegado, problemasDeFila, resumenDeFilas, tieneTitulos,
  type FilaMasiva,
} from "@/lib/gastos-masivos";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto } from "@/lib/types";

/* Aldana (20/10): más de 100 egresos desde el 7/10, unos 30 consumos por día. Se copian las filas de Excel y se pegan. */

const HOY = new Date("2026-10-20T15:00:00.000Z");
const base = (gastos: Gasto[] = []): EstadoApp => ({ ...(construirSemilla() as EstadoApp), gastos, ajustes: { ...(construirSemilla() as EstadoApp).ajustes, monedaBase: "USD", tipoCambio: 1450 } });
const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Software", grupo: "operativo", concepto: "Notion", monto: 20, moneda: "USD", fecha: "2026-10-08T15:00:00.000Z", recurrente: false, creadoEn: "2026-10-08T15:00:00.000Z", extra: {}, ...g,
});

test("parsearPegado: lo que copia Excel (tabulaciones), con comillas, saltos de línea, CSV con ; y filas vacías", () => {
  assert.deepEqual(parsearPegado("Fecha\tConcepto\tMonto\r\n07/10/2026\tUber\t12,5\r\n\r\n08/10/2026\tNotion\t20\r\n"), [
    ["Fecha", "Concepto", "Monto"], ["07/10/2026", "Uber", "12,5"], ["08/10/2026", "Notion", "20"],
  ]);
  assert.deepEqual(parsearPegado('a\t"dos\nlíneas"\t"con ""comillas"""'), [["a", "dos\nlíneas", 'con "comillas"']]);
  assert.deepEqual(parsearPegado("fecha;concepto;monto\n07/10/2026;Uber;12,5"), [["fecha", "concepto", "monto"], ["07/10/2026", "Uber", "12,5"]]);
  assert.deepEqual(parsearPegado("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
  assert.deepEqual(parsearPegado("una sola columna\notra fila"), [["una sola columna"], ["otra fila"]]);
  assert.deepEqual(parsearPegado("   \n\n"), []);
  assert.deepEqual(parsearPegado("a\t\tc\n\t\t"), [["a", "", "c"]], "las celdas vacías del medio se conservan; la fila toda vacía no");
});

test("leerFecha: día/mes como se escribe acá, con o sin año, con el mes en letras, en formato de EE.UU. y como número de Excel", () => {
  const f = (t: string) => leerFecha(t, HOY);
  assert.equal(f("07/10/2026"), "2026-10-07");
  assert.equal(f("7/10/26"), "2026-10-07");
  assert.equal(f("07-10-2026"), "2026-10-07");
  assert.equal(f("07.10.2026"), "2026-10-07");
  assert.equal(f("2026-10-07"), "2026-10-07");
  assert.equal(f("2026-10-07T15:00:00Z"), "2026-10-07");
  assert.equal(f("7/10"), "2026-10-07", "sin año: el de hoy");
  assert.equal(f("31/12"), "2025-12-31", "sin año y quedaría a más de un mes: el año anterior");
  assert.equal(f("7 oct"), "2026-10-07");
  assert.equal(f("7 de octubre de 2026"), "2026-10-07");
  assert.equal(f("07-oct-26"), "2026-10-07");
  assert.equal(f("10/13/2026"), "2026-10-13", "el segundo número pasa de 12: es el mes (EE.UU.)");
  assert.equal(f("13/10/2026"), "2026-10-13");
  assert.equal(f("07/10/2026 14:32"), "2026-10-07", "con hora");
  const excel = Math.round((Date.UTC(2026, 9, 7) - Date.UTC(1899, 11, 30)) / 86400000);
  assert.equal(f(String(excel)), "2026-10-07", "número de fecha de Excel");
  for (const mal of ["", "hola", "32/13/2026", "31/02/2026", "7 xyz", "99999", "12345678"]) assert.equal(f(mal), null, `«${mal}» no es una fecha`);
});

test("leerMontoPegado: monedas, miles, decimales, negativos y paréntesis", () => {
  assert.deepEqual(leerMontoPegado("US$ 1.234,56"), { monto: 1234.56, moneda: "USD" });
  assert.deepEqual(leerMontoPegado("USD 45.50"), { monto: 45.5, moneda: "USD" });
  assert.deepEqual(leerMontoPegado("12,5 ARS"), { monto: 12.5, moneda: "ARS" });
  assert.deepEqual(leerMontoPegado("$ 1.500"), { monto: 1500 });
  assert.deepEqual(leerMontoPegado("(45,00)"), { monto: -45 });
  assert.deepEqual(leerMontoPegado("-12"), { monto: -12 });
  assert.deepEqual(leerMontoPegado("−12,30"), { monto: -12.3 }, "con el signo menos de Excel");
  assert.deepEqual(leerMontoPegado("45,00-"), { monto: -45 });
  assert.deepEqual(leerMontoPegado("20"), { monto: 20 });
  for (const mal of ["", "abc", "-", "$"]) assert.equal(leerMontoPegado(mal), null, `«${mal}» no es un monto`);
});

test("columnas: por los títulos, y sin títulos por lo que hay en cada una", () => {
  const conTitulos = parsearPegado("Fecha\tDetalle\tTarjeta\tImporte\n07/10/2026\tUber\tMercury\t12,5\n08/10/2026\tNotion\tMercury\t20");
  assert.equal(tieneTitulos(conTitulos), true);
  assert.deepEqual(adivinarColumnas(conTitulos, true), ["fecha", "concepto", "cuenta", "monto"]);

  const sinTitulos = parsearPegado("07/10/2026\tUber\t12,5\n08/10/2026\tNotion\t20\n09/10/2026\tFigma\t15");
  assert.equal(tieneTitulos(sinTitulos), false, "la primera fila ya es un gasto");
  assert.deepEqual(adivinarColumnas(sinTitulos, false), ["fecha", "concepto", "monto"]);

  /* Títulos que no se reconocen: la primera fila no tiene fechas ni montos y la de abajo sí, así que son títulos igual. */
  const raros = parsearPegado("Cuándo\tQué\tCuánto\n07/10/2026\tUber del aeropuerto\t12,5\n08/10/2026\tNotion mensual\t20");
  assert.equal(tieneTitulos(raros), true);
  assert.deepEqual(adivinarColumnas(raros, true), ["fecha", "concepto", "monto"], "lo que falta se completa mirando lo que hay en cada columna");
  /* Una sola columna de texto: no hay títulos que adivinar. */
  assert.equal(tieneTitulos(parsearPegado("Uber\nNotion")), false);
});

test("filas: categoría y proveedor propuestos, moneda, ingresos, y las que ya estaban cargadas quedan afuera", () => {
  const e = base([gasto({ id: "g1", concepto: "Notion", monto: 20, fecha: "2026-10-08T15:00:00.000Z" })]);
  const tabla = parsearPegado([
    "Fecha\tConcepto\tMonto\tMoneda\tCuenta",
    "07/10/2026\tUber del aeropuerto\t12,5\tUSD\tMercury",
    "08/10/2026\tNotion\t20\t\tMercury",
    "09/10/2026\tReembolso del hotel\t(80)\tUSD\t",
    "10/10/2026\tCafé\t4.500\tARS\t",
    "xx\tSin fecha\t3\t\t",
  ].join("\n"));
  const mapa = adivinarColumnas(tabla, true);
  const filas = armarFilas(tabla, mapa, true, { e, hoy: HOY });
  assert.equal(filas.length, 5);
  assert.deepEqual(filas.map((f) => f.id), ["f1", "f2", "f3", "f4", "f5"]);
  const [uber, notion, hotel, cafe, sinFecha] = filas;
  assert.equal(uber.fecha, "2026-10-07"); assert.equal(uber.monto, "12,5"); assert.equal(uber.cuenta, "Mercury"); assert.equal(uber.proveedor, "Uber del aeropuerto", "sin columna de proveedor es el concepto");
  assert.equal(uber.moneda, "USD"); assert.equal(uber.ingreso, false); assert.equal(uber.incluir, true);
  assert.ok(uber.categoria, "se propone una categoría para un Uber");
  assert.equal(notion.yaCargada, true, "mismo día, monto y concepto que un gasto cargado");
  assert.equal(notion.incluir, false, "no se vuelve a cargar");
  assert.equal(notion.categoria, "Software", "la categoría sale de lo ya cargado con ese concepto");
  assert.equal(hotel.ingreso, true); assert.equal(hotel.monto, "80", "plata que volvió: el monto en positivo y marcado como ingreso");
  assert.equal(cafe.moneda, "ARS"); assert.equal(cafe.monto, "4.500".replace(".", ""), "4.500 es cuatro mil quinientos");
  assert.equal(sinFecha.fecha, "");
  assert.ok("fecha" in problemasDeFila(sinFecha, e));
  assert.ok(!("fecha" in problemasDeFila(uber, e)));
});

test("categoría propuesta: la de la última vez que se le pagó a ese proveedor, aunque el concepto sea otro", () => {
  const e = base([gasto({ id: "g1", concepto: "Plan Figma mensual", proveedor: "Figma", categoria: "Software", fecha: "2026-09-10T15:00:00.000Z" })]);
  const tabla = parsearPegado("Fecha\tConcepto\tProveedor\tMonto\n07/10/2026\tCompra\tFigma\t15\n08/10/2026\tXyz\tNadie\t10");
  const filas = armarFilas(tabla, adivinarColumnas(tabla, true), true, { e, hoy: HOY });
  assert.equal(filas[0].categoria, "Software");
  assert.equal(filas[1].categoria, "", "sin antecedentes ni palabras clave: se elige a mano");
});

test("problemas: sin categoría, categoría inexistente, sin monto, en pesos sin tipo de cambio", () => {
  const e = base();
  const ok: FilaMasiva = { id: "f1", incluir: true, fecha: "2026-10-07", concepto: "Uber", proveedor: "Uber", categoria: "Software", monto: "12,5", moneda: "USD", cuenta: "", notas: "", ingreso: false, yaCargada: false };
  assert.deepEqual(problemasDeFila(ok, e), {});
  assert.ok(problemasDeFila({ ...ok, categoria: "" }, e).categoria);
  assert.match(problemasDeFila({ ...ok, categoria: "Inventada" }, e).categoria ?? "", /no existe/);
  assert.ok(problemasDeFila({ ...ok, monto: "" }, e).monto);
  assert.ok(problemasDeFila({ ...ok, monto: "abc" }, e).monto);
  assert.ok(problemasDeFila({ ...ok, concepto: "" }, e).concepto);
  assert.ok(problemasDeFila({ ...ok, proveedor: "" }, e).proveedor);
  const sinTc = { ...e, ajustes: { ...e.ajustes, tipoCambio: 0 } };
  assert.ok(problemasDeFila({ ...ok, moneda: "ARS" }, sinTc).tipoCambio);
  assert.deepEqual(problemasDeFila({ ...ok, moneda: "ARS" }, e), {}, "con el tipo de cambio de Ajustes se puede");
});

test("lo que se carga: sólo las filas marcadas y sin problemas, con el lote, el ingreso en negativo y el monto en la moneda base", () => {
  const e = base();
  const f = (id: string, extra: Partial<FilaMasiva> = {}): FilaMasiva => ({ id, incluir: true, fecha: "2026-10-07", concepto: "Uber", proveedor: "Uber", categoria: "Software", monto: "12,5", moneda: "USD", cuenta: "Mercury", notas: "", ingreso: false, yaCargada: false, ...extra });
  const filas = [f("f1"), f("f2", { incluir: false }), f("f3", { monto: "" }), f("f4", { ingreso: true, monto: "80" }), f("f5", { moneda: "ARS", monto: "145.000" })];
  const r = resumenDeFilas(filas, e);
  assert.deepEqual({ ...r, total: Math.round(r.total) }, {
    filas: 5, aCargar: 3, yaCargadas: 0, afuera: 0, conProblemas: 1, gastosTotal: 112.5, ingresosTotal: 80, total: Math.round(12.5 - 80 + 145000 / 1450), ingresos: 1,
  });
  const gastos = gastosDeFilas(filas, e, "lote_1", "2026-10-20T15:00:00.000Z");
  assert.equal(gastos.length, 3);
  assert.ok(gastos.every((g) => g.extra.cargaMasiva === "lote_1"));
  assert.equal(gastos[0].monto, 12.5); assert.equal(gastos[0].extra.cuenta, "Mercury"); assert.equal(gastos[0].fecha, "2026-10-07T15:00:00.000Z");
  assert.equal(gastos[1].monto, -80); assert.equal(gastos[1].extra.ingreso, true);
  assert.equal(gastos[2].monto, 100); assert.equal(gastos[2].extra.monedaOriginal, "ARS"); assert.equal(gastos[2].extra.montoOriginal, 145000);
  assert.ok(gastos.every((g) => g.creadoEn === "2026-10-20T15:00:00.000Z" && g.proveedor === "Uber"));
});

test("el almacén: una carga de 120 gastos es una sola anotación, no repite al cargar de nuevo la misma planilla y se deshace entera", () => {
  const previo = gasto({ id: "g_previo", concepto: "Notion", monto: 20 });
  const e0 = { ...base([previo]), actividad: [] };
  assert.equal(acciones.importar(JSON.stringify(e0)), true);
  const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
  const filas = (n: number): FilaMasiva[] => Array.from({ length: n }, (_, i) => ({
    id: `f${i + 1}`, incluir: true, fecha: `2026-10-${String(7 + (i % 10)).padStart(2, "0")}`, concepto: `Consumo ${i + 1}`, proveedor: `Comercio ${i + 1}`, categoria: "Software",
    monto: String(10 + i), moneda: "USD", cuenta: "Mercury", notas: "", ingreso: false, yaCargada: false,
  }));
  const r = acciones.cargarGastosEnLote(gastosDeFilas(filas(120), hoy(), "lote_a"), "lote_a");
  assert.equal(r.loteId, "lote_a"); assert.equal(r.ids.length, 120);
  assert.equal(new Set(r.ids).size, 120, "ids únicos");
  assert.equal(hoy().gastos.length, 121);
  assert.equal(hoy().actividad.length, 1, "una sola anotación para toda la carga");
  assert.match(hoy().actividad[0].detalle ?? "", /Se cargaron 120 gastos de una planilla/);
  assert.equal(hoy().gastos.filter((g) => g.extra.cargaMasiva === "lote_a").length, 120);

  /* Pegar la misma planilla otra vez: las 120 ya están cargadas y quedan afuera. */
  const otra = armarFilas(
    [["Fecha", "Concepto", "Monto"], ...filas(120).map((f) => [f.fecha.split("-").reverse().join("/"), f.concepto, f.monto])],
    ["fecha", "concepto", "monto"], true, { e: hoy(), hoy: HOY },
  );
  assert.equal(otra.length, 120);
  assert.equal(otra.filter((f) => f.yaCargada).length, 120, "mismo día, monto y concepto");
  assert.equal(resumenDeFilas(otra, hoy()).aCargar, 0);
  assert.equal(gastosDeFilas(otra, hoy(), "lote_b").length, 0);

  /* Deshacer: se van los 120, el gasto de antes se queda. Un gasto del lote que se editó después también se va. */
  acciones.actualizar<Gasto>("gastos", r.ids[3], { notas: "editado después" }, "Consumo 4");
  assert.equal(acciones.deshacerCargaDeGastos("lote_a"), 120);
  assert.deepEqual(hoy().gastos.map((g) => g.id), ["g_previo"]);
  assert.equal(acciones.deshacerCargaDeGastos("lote_a"), 0, "ya no queda nada de ese lote");
  assert.deepEqual(acciones.cargarGastosEnLote([]).ids, []);
});
