import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { componentesDe, explicacionDe } from "@/lib/kpis-formulas";

/* Todo el semillero, de punta a punta: el Total de lo que se mira. */
const e = construirSemilla();
const corte: Corte = { clave: "total", titulo: "Total", desde: "2026-01-01", hasta: "2026-12-31", foto: true, total: true };
const ctx = new Contexto(e, corte);
const defs = catalogo(e);
const porId = new Map(defs.map((d) => [d.id, d]));

const piezasDe = (id: string) => {
  const def = porId.get(id)!;
  return { def, piezas: componentesDe(def, ctx, porId) ?? [], total: valorEn(def, ctx) };
};

test("toda métrica del Dashboard dice cómo se calcula", () => {
  /* Angelo (06/10): cada métrica con su ícono. Una fila nueva sin explicación rompe esto. */
  const sin = defs.filter((d) => !explicacionDe(d)?.formula).map((d) => d.id);
  assert.deepEqual(sin, [], `sin «cómo se calcula»: ${sin.join(", ")}`);
});

test("las piezas de una cuenta son filas que existen en la tabla", () => {
  for (const d of defs) {
    const ex = explicacionDe(d);
    if (!ex?.piezas) continue;
    /* Con una fila que no existe, componentesDe la saltea en silencio. */
    const pedidas = ex.piezas(ctx, (id) => { assert.ok(porId.has(id), `${d.id} pide «${id}», que no existe`); return null; }) ?? [];
    for (const p of pedidas) if ("id" in p) assert.ok(porId.has(p.id), `${d.id} pide «${p.id}», que no existe`);
  }
});

test("lo que dice el modal es lo de la celda: cobrado ÷ facturado, ROAS, ticket", () => {
  const cuenta = (id: string, f: (n: number[]) => number) => {
    const { piezas, total } = piezasDe(id);
    const n = piezas.map((p) => p.valor);
    assert.ok(n.every((x) => x !== null), `${id}: una pieza sin dato`);
    assert.ok(total !== null, `${id}: sin valor`);
    assert.ok(Math.abs(f(n as number[]) - total!) < 1e-6, `${id}: ${f(n as number[])} ≠ ${total}`);
  };
  cuenta("c_tasa", ([cc, fact]) => (cc / fact) * 100);
  cuenta("roas_cc", ([cc, inv]) => cc / inv);
  cuenta("roas_rev", ([fact, inv]) => fact / inv);
  cuenta("cac", ([inv, ventas]) => inv / ventas);
  cuenta("v_ticket", ([fact, ventas]) => fact / ventas);
  cuenta("r_margen", ([neto, cc]) => (neto / cc) * 100);
});

test("el profit se arma sumando y restando las filas de la tabla", () => {
  const sumar = (id: string) => {
    const { piezas, total } = piezasDe(id);
    const suma = piezas.reduce((a, p, i) => a + (i === 0 || p.signo === "+" ? p.valor ?? 0 : -(p.valor ?? 0)), 0);
    assert.ok(total !== null, `${id}: sin valor`);
    assert.ok(Math.abs(suma - total!) < 0.005, `${id}: las piezas dan ${suma} y la celda ${total}`);
  };
  sumar("r_bruto");
  sumar("r_operativo");
  sumar("r_neto_cc");
  sumar("r_neto_rev");
  sumar("r_queda");
});
