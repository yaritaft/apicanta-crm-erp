import test from "node:test";
import assert from "node:assert/strict";
import { azar, textoRaro } from "../store/_aleatorio";
import { acciones } from "@/lib/store";
import { adivinarColumnas, armarFilas, gastosDeFilas, leerFecha, leerMontoPegado, parsearPegado, problemasDeFila, resumenDeFilas, tieneTitulos } from "@/lib/gastos-masivos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Frente «Cargar varios gastos pegando de una planilla» (Aldana, 20/10).

   Propiedades (cada mensaje dice la semilla para repetirlo):
   G1  lo que se pega, sea lo que sea, no rompe: nunca tira, y las cuentas de la grilla cierran (para cargar + con problemas + afuera = todas).
   G2  una planilla bien hecha, con las fechas y los montos escritos de varias maneras, se lee igual que lo que se escribió.
   G3  cargar la planilla, volver a pegarla y deshacer: la segunda vez todo es «ya cargada» (no se carga nada) y deshacer deja la base como estaba.
   ================================================================== */

const SEMILLAS = 150;
const HOY = new Date("2026-10-20T15:00:00.000Z");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dos = (n: number) => String(n).padStart(2, "0");
const base = (): EstadoApp => ({ ...(construirSemilla() as EstadoApp), gastos: [], actividad: [], ajustes: { ...(construirSemilla() as EstadoApp).ajustes, monedaBase: "USD", tipoCambio: 1450 } });
const CONCEPTOS = ["Uber", "Notion", "Figma", "Almuerzo equipo", "Hotel Madrid", "Café con cliente", "Zoom", "Meta Ads", "Taxi", "Contador", "Dominio", "Cena"];

test("G1 · lo que se pega, sea lo que sea, no rompe y las cuentas de la grilla cierran", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const a = azar(semilla);
    const cual = `semilla ${semilla}`;
    const celdas = ["", "07/10/2026", "12,5", "US$ 1.234,56", "(45)", "-3", "abc", "31/02/2026", "2026-10-07", "1e9", "99999999999", "—", "\"con comillas\"", "a\tb", "x".repeat(300)];
    const filas = Array.from({ length: a.entero(0, 12) }, () => Array.from({ length: a.entero(1, 7) }, () => (a.prob(0.5) ? a.pick(celdas) : textoRaro(a)).replace(/\t|\n|\r/g, " ")).join(a.pick(["\t", ";", ","])));
    const texto = filas.join(a.pick(["\n", "\r\n"]));
    const e = base();
    const tabla = parsearPegado(texto);
    assert.ok(tabla.every((f) => f.length > 0 && f.some((c) => c !== "")), `${cual}: filas vacías`);
    const titulos = tieneTitulos(tabla);
    const mapa = adivinarColumnas(tabla, titulos);
    const grilla = armarFilas(tabla, mapa, titulos, { e, hoy: HOY });
    for (const f of grilla) {
      assert.ok(f.fecha === "" || /^\d{4}-\d{2}-\d{2}$/.test(f.fecha), `${cual}: fecha rara «${f.fecha}»`);
      /* Un monto que no se pudo leer queda como texto para corregirlo, y la fila no se carga con él. */
      if (leerMontoPegado(f.monto) === null) assert.ok(problemasDeFila(f, e).monto, `${cual}: la fila con monto «${f.monto}» se podría cargar`);
      problemasDeFila(f, e);
    }
    const r = resumenDeFilas(grilla, e);
    const afuera = grilla.filter((f) => !f.incluir).length;
    assert.equal(r.aCargar + r.conProblemas + afuera, grilla.length, `${cual}: las cuentas no cierran`);
    assert.equal(gastosDeFilas(grilla, e, "lote").length, r.aCargar, `${cual}: se cargaría otra cantidad que la que dice el resumen`);
    for (const c of celdas.concat(filas)) { leerFecha(c, HOY); const m = leerMontoPegado(c); assert.ok(m === null || Number.isFinite(m.monto), `${cual}: monto roto en «${c}»`); }
  }
});

test("G2 · una planilla bien hecha se lee igual que lo que se escribió, con las fechas y los montos escritos de varias maneras", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const a = azar(semilla * 7 + 1);
    const cual = `semilla ${semilla}`;
    const e = base();
    const n = a.entero(1, 30);
    const quiero = Array.from({ length: n }, (_, i) => {
      const mes = a.entero(8, 10); const dia = a.entero(1, mes === 10 ? 19 : 28);
      const monto = Math.round((a.entero(1, 250000) / 100) * 100) / 100;
      return { dia, mes, monto, concepto: `${a.pick(CONCEPTOS)} ${i + 1}` };
    });
    const fecha = (d: number, m: number) => a.pick([
      `${dos(d)}/${dos(m)}/2026`, `${d}/${m}/26`, `2026-${dos(m)}-${dos(d)}`, `${d} ${MESES[m - 1]} 2026`, `${dos(d)}-${dos(m)}-2026`,
    ]);
    const plata = (x: number) => {
      const ent = Math.floor(x); const cent = Math.round((x - ent) * 100);
      const miles = ent >= 1000 ? `${Math.floor(ent / 1000)}.${String(ent % 1000).padStart(3, "0")}` : String(ent);
      const coma = `${a.pick([miles, String(ent)])},${dos(cent)}`;
      return a.pick([coma, `US$ ${coma}`, `${ent}.${dos(cent)}`]);
    };
    const conTitulos = a.prob(0.6);
    const texto = [
      ...(conTitulos ? ["Fecha\tDetalle\tImporte"] : []),
      ...quiero.map((q) => `${fecha(q.dia, q.mes)}\t${q.concepto}\t${plata(q.monto)}`),
    ].join("\n");
    const tabla = parsearPegado(texto);
    assert.equal(tieneTitulos(tabla), conTitulos, `${cual}: títulos`);
    const grilla = armarFilas(tabla, adivinarColumnas(tabla, conTitulos), conTitulos, { e, hoy: HOY });
    assert.equal(grilla.length, n, `${cual}: cantidad de filas`);
    grilla.forEach((f, i) => {
      const q = quiero[i];
      assert.equal(f.fecha, `2026-${dos(q.mes)}-${dos(q.dia)}`, `${cual} fila ${i + 1}: fecha`);
      assert.equal(f.concepto, q.concepto, `${cual} fila ${i + 1}: concepto`);
      assert.ok(Math.abs(leerMontoPegado(f.monto)!.monto - q.monto) < 0.005, `${cual} fila ${i + 1}: monto ${f.monto} ≠ ${q.monto}`);
      assert.equal(f.ingreso, false);
    });
  }
});

test("G3 · cargar, volver a pegar la misma planilla y deshacer: lo cargado no se repite y la base vuelve a como estaba", () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const a = azar(semilla * 13 + 5);
    const cual = `semilla ${semilla}`;
    const e0 = base();
    assert.equal(acciones.importar(JSON.stringify(e0)), true);
    const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
    const n = a.entero(1, 40);
    const texto = ["Fecha\tConcepto\tMonto", ...Array.from({ length: n }, (_, i) => `${dos(a.entero(1, 19))}/10/2026\t${a.pick(CONCEPTOS)} ${i + 1}\t${a.entero(1, 9000)},${dos(a.entero(0, 99))}`)].join("\n");
    const leer = (e: EstadoApp) => { const t = parsearPegado(texto); return armarFilas(t, adivinarColumnas(t, true), true, { e, hoy: HOY }); };
    const filas = leer(hoy()).map((f) => ({ ...f, categoria: f.categoria || "Software", proveedor: f.proveedor || f.concepto }));
    const antes = hoy().gastos.length;
    const datos = gastosDeFilas(filas, hoy(), "lote_x");
    assert.equal(datos.length, n, `${cual}: se esperaban ${n} gastos`);
    const r = acciones.cargarGastosEnLote(datos, "lote_x");
    assert.equal(r.ids.length, n);
    assert.equal(hoy().gastos.length, antes + n, `${cual}: cantidad después de cargar`);
    const otra = leer(hoy());
    assert.ok(otra.every((f) => f.yaCargada && !f.incluir), `${cual}: al pegar de nuevo, todo tendría que estar «ya cargada»`);
    assert.equal(gastosDeFilas(otra, hoy(), "lote_y").length, 0, `${cual}: no se carga nada por segunda vez`);
    assert.equal(acciones.deshacerCargaDeGastos("lote_x"), n);
    assert.equal(hoy().gastos.length, antes, `${cual}: deshacer no devolvió la base a como estaba`);
  }
});
