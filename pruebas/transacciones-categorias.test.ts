import test from "node:test";
import assert from "node:assert/strict";
import { categoriasDe, csvDeTransacciones, proveedoresDe, transaccionesDe } from "@/lib/transacciones";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto } from "@/lib/types";

/* ==================================================================
   Manu (03/11): «poder encontrar los gastos y filtrarlos», y el desmenuzamiento de cada gastito para rastrearlo. Transacciones filtra por categoría y
   por proveedor, suma por categoría y exporta lo que se ve.
   ================================================================== */

const g = (id: string, categoria: string, proveedor: string, monto: number, dia = "2026-10-10"): Gasto => ({
  id, categoria, grupo: "operativo", concepto: `${proveedor} ${id}`, proveedor, monto, moneda: "USD", fecha: `${dia}T15:00:00.000Z`, recurrente: false, creadoEn: `${dia}T15:00:00.000Z`, extra: {},
} as Gasto);

const estado = (gastos: Gasto[]): EstadoApp => ({ ...(construirSemilla() as EstadoApp), gastos, pagos: [], movimientos: [], devoluciones: [], traspasos: [] });

test("cada gasto trae su categoría y su proveedor, y se suma por categoría (lo que volvió resta)", () => {
  const e = estado([
    g("a", "Software", "Notion", 20), g("b", "Software", "Figma", 15), g("c", "Honorarios del CEO", "Uber", 23.98), g("d", "Honorarios del CEO", "Uber", 10),
    g("e", "Software", "Notion", -5 /* un reintegro */), g("f", "Meta Ads", "", 500),
  ]);
  const filas = transaccionesDe(e).filas;
  const notion = filas.find((f) => f.gastoId === "a")!;
  assert.equal(notion.categoria, "Software");
  assert.equal(notion.proveedor, "Notion");
  assert.equal(filas.find((f) => f.gastoId === "f")!.proveedor, undefined, "sin proveedor no hay proveedor");
  assert.deepEqual(categoriasDe(filas), [
    { categoria: "Meta Ads", n: 1, total: 500 },
    { categoria: "Honorarios del CEO", n: 2, total: 33.98 },
    { categoria: "Software", n: 3, total: 30 },
  ]);
  assert.deepEqual(proveedoresDe(filas), [{ proveedor: "Notion", n: 2 }, { proveedor: "Uber", n: 2 }, { proveedor: "Figma", n: 1 }]);
});

test("lo que no es un gasto (un cobro, un pase) no cuenta como categoría ni proveedor", () => {
  const e = estado([g("a", "Software", "Notion", 20)]);
  const filas = transaccionesDe(e).filas;
  assert.equal(categoriasDe(filas.filter((f) => f.origen !== "gasto")).length, 0);
  assert.equal(proveedoresDe(filas.filter((f) => f.origen !== "gasto")).length, 0);
});

test("exportar: una fila por transacción con el monto con signo, tildes bien para Excel y comillas escapadas", () => {
  const e = estado([g("a", "Software", 'Notion "Labs"', 20, "2026-10-10"), g("b", "Software", "Figma", -5, "2026-10-11")]);
  const csv = csvDeTransacciones(transaccionesDe(e).filas);
  const [cab, ...lineas] = csv.replace(/^﻿/, "").split("\n");
  assert.ok(csv.startsWith("﻿"), "con BOM para que Excel lea las tildes");
  assert.equal(cab, "Fecha,Tipo,Qué,Categoría,Proveedor,Cuenta,Estado,Monto,Moneda,Comisión");
  assert.equal(lineas.length, 2);
  const egreso = lineas.find((l) => l.includes("Egreso"))!;
  assert.match(egreso, /^2026-10-10,Egreso,"Notion ""Labs"" a","Software","Notion ""Labs""",.*,-20\.00,USD,$/);
  assert.match(lineas.find((l) => l.includes("Ingreso"))!, /,5\.00,USD,$/, "lo que volvió suma");
});
