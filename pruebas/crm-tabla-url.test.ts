import test from "node:test";
import assert from "node:assert/strict";
import {
  anguloDe, COLUMNA, esColumna, filasTabla, filtroAURL, filtrosDeURL, ordenarFilas, ordenesDeURL, partirValores, porDimension, resumenDe, unirValores,
} from "@/lib/crm-tabla";
import { filasCrm } from "@/lib/crm";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Sesion } from "@/lib/types";

/* ==================================================================
   Los arreglos que salieron de las pruebas de estrés de la tabla del CRM
   (07/10): lo que llega por la URL no rompe la tabla ni ensucia nada.
   ================================================================== */

const porURL = (clave: Parameters<typeof filtroAURL>[0], valores: string[]) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filtroAURL(clave, { modo: "solo", valores }))) if (v) q.set(k, v);
  return filtrosDeURL(new URLSearchParams(q.toString()));
};

test("un valor con «|» o «\\» (los anuncios de Meta: «Prospecting | LAL 1% | USA») vuelve entero de la URL", () => {
  const ad = "Prospecting | LAL 1% | USA";
  assert.deepEqual(porURL("ad", [ad]).ad?.valores, [ad]);
  assert.deepEqual(porURL("ad", [ad, "VSL | Mercado saturado", "Sin barra"]).ad?.valores, [ad, "VSL | Mercado saturado", "Sin barra"]);
  assert.deepEqual(porURL("ad", ["a\\b", "c\\|d", "\\"]).ad?.valores, ["a\\b", "c\\|d", "\\"]);
  assert.deepEqual(partirValores(unirValores(["x|y", "z"])), ["x|y", "z"]);
});

test("los links de antes (sin escapes) se leen igual", () => {
  assert.deepEqual(partirValores("Mentoría|Upsell|Downsell"), ["Mentoría", "Upsell", "Downsell"]);
  assert.deepEqual(partirValores("||a||b|"), ["a", "b"], "los vacíos no cuentan, como siempre");
  assert.equal(unirValores(["Mentoría", "Upsell"]), "Mentoría|Upsell");
});

test("«constructor», «__proto__» y los nombres heredados no son columnas, ni para ordenar ni para filtrar", () => {
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) assert.equal(esColumna(k), false, k);
  for (const k of Object.keys(COLUMNA)) assert.equal(esColumna(k), true, k);
  assert.deepEqual(ordenesDeURL("constructor").map((o) => o.clave), ["llamada"], "cae al orden de siempre");
  assert.deepEqual(ordenesDeURL("-__proto__,toString").map((o) => o.clave), ["llamada"]);
  const filas = filasTabla(construirSemilla());
  assert.doesNotThrow(() => ordenarFilas(filas, ordenesDeURL("constructor"), {}));
});

test("un filtro con «__proto__» o «constructor» en la URL no escribe en Object.prototype ni en Object", () => {
  const q = new URLSearchParams("solo-__proto__=a|b&sin-__proto__=c&con-__proto__=zzz&nocon-__proto__=y&con-constructor=zzz&desde-__proto__=2026-10-01");
  const f = filtrosDeURL(q);
  assert.deepEqual(Object.keys(f), []);
  const vacio = {} as Record<string, unknown>;
  for (const k of ["modo", "valores", "contiene", "noContiene", "desde", "hasta"]) assert.equal(k in vacio, false, `Object.prototype.${k}`);
  assert.equal((Object as unknown as Record<string, unknown>).contiene, undefined);
});

test("anguloDe quita todas las copias, no sólo cuatro", () => {
  assert.equal(anguloDe("MERCADO SATURADO.mp4 - Copia - Copia - Copia - Copia - Copia"), "MERCADO SATURADO");
  assert.equal(anguloDe("MERCADO SATURADO.mp4 - Copia 2"), "MERCADO SATURADO");
  assert.equal(anguloDe("Sin copias"), "Sin copias");
});

test("porDimension arma los grupos sin copiar la lista por cada fila", () => {
  const filas = filasTabla(construirSemilla());
  const base = filas.length;
  const triple = Array.from({ length: 3 }, () => filas).flat();
  const uno = porDimension(filas, "closer"), tres = porDimension(triple, "closer");
  assert.equal(uno.reduce((a, g) => a + g.llamadas, 0), base);
  assert.equal(tres.reduce((a, g) => a + g.llamadas, 0), base * 3);
});

test("la fila de la llamada se arma de nuevo si cambia la fecha de su venta", () => {
  const semilla = construirSemilla();
  const s = filasTabla(semilla)[0].sesion;
  const venta = { ...semilla.ventas[0], id: "v_memo", sesionId: s.id, contactoId: s.contactoId ?? s.leadId, estado: "activa" as const, fecha: "2026-10-02T15:00:00.000Z" };
  const con = (v: typeof venta): EstadoApp => ({ ...semilla, ventas: [...semilla.ventas.filter((x) => x.sesionId !== s.id), v] });
  const e1 = con(venta);
  const f1 = filasCrm(e1).find((f) => f.sesion.id === s.id)!;
  assert.equal(f1.venta?.fecha, venta.fecha);
  const f2 = filasCrm(con({ ...venta, fecha: "2026-10-04T15:00:00.000Z" })).find((f) => f.sesion.id === s.id)!;
  assert.equal(f2.venta?.fecha, "2026-10-04T15:00:00.000Z", "no recuerda la fecha vieja");
});

test("«Llamadas que pasaron» no cuenta una llamada futura con «Reagendar»", () => {
  const ahora = Date.parse("2026-10-07T15:00:00.000Z");
  const mk = (id: string, extra: Partial<Sesion>) => ({
    id, titulo: "A", invitado: id, inicia: "2026-10-09T15:00:00.000Z", duracionMin: 45, estado: "agendada", tipo: "Asesoramiento X", origen: "calendly",
    creadoEn: "2026-10-01T12:00:00.000Z", extra: {}, contactoId: id, ...extra,
  }) as Sesion;
  const e = {
    sesiones: [mk("futura", {}), mk("futura_reagendar", { estadoPreCall: "Reagendar" }), mk("pasada", { inicia: "2026-10-05T15:00:00.000Z" })],
    contactos: [], leads: [], ajustes: construirSemilla().ajustes, webinars: [], ventas: [], productos: [],
  };
  const filas = filasTabla(e as never, ahora);
  assert.equal(filas.filter((f) => f.pasada).length, 1);
  assert.equal(resumenDe(filas).pasaron, 1, "las dos futuras no cuentan como «pasaron»");
  /* Una futura que ya tiene un desenlace cargado (una compra) sí cuenta: tiene un resultado. */
  const conCompra = filasTabla({ ...e, sesiones: [mk("futura_compra", { estadoLlamada: "Compra Full" })] } as never, ahora);
  assert.equal(resumenDe(conCompra).pasaron, 1);
});
