import test from "node:test";
import assert from "node:assert/strict";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { componentesDe, explicacionDe } from "@/lib/kpis-formulas";
import { calcularPyL } from "@/lib/finanzas";
import { metricasDeWebinar, sumarMetricas } from "@/lib/webinar";
import { resultadoPorEmbudo } from "@/lib/embudos";
import { rangoDePeriodo } from "@/lib/periodos";
import { estadoVacio } from "@/lib/seed";
import type { EstadoApp, Webinar } from "@/lib/types";
import { devolucion, estadoDeYari, iso, OCTUBRE, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   Los números del Dashboard, de los webinars y de cada embudo no pueden
   dar distinto que Finanzas cuando hay una devolución: son las mismas
   cuentas. Con el caso de Yari (estado-devolucion.ts) y la devolución
   entera del 03/10.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

/* El estado del caso de Yari, con todo lo que el Dashboard necesita (arrays vacíos) y la venta atada a un webinar. */
function estadoCompleto(devoluciones: ReturnType<typeof devolucion>[]): EstadoApp {
  const yari = estadoDeYari({ devoluciones });
  const webinar = { id: "w1", titulo: "Webinar 24/09", fecha: iso(SEPTIEMBRE, 24), estado: "finalizado", inversion: 500, inversionDmAds: 0, costoWhatsappApi: 0, formularios: 100, grupoWpp: 50, asistentes: 30, llamadasVivo: 5, llamadasPosterior: 3, llamadasCalificadas: 4, extra: {} } as unknown as Webinar;
  return {
    ...estadoVacio(),
    ...yari,
    ventas: yari.ventas.map((v) => ({ ...v, webinarId: "w1", embudoId: "emb_web" })),
    webinars: [webinar],
    embudos: [{ id: "emb_web", nombre: "Webinar", activo: true, orden: 0, esWebinar: true }],
    actividad: [], sesiones: [],
  } as EstadoApp;
}

const corte = (mes: string): Corte => {
  const r = rangoDePeriodo(mes);
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { clave: mes, titulo: mes, desde: dia(r.desde), hasta: dia(r.hasta), foto: false };
};

const e = estadoCompleto([devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })]);
const defs = catalogo(e);
const porId = new Map(defs.map((d) => [d.id, d]));
const oct = new Contexto(e, corte(OCTUBRE));
const sept = new Contexto(e, corte(SEPTIEMBRE));
const valor = (c: Contexto, id: string) => valorEn(porId.get(id)!, c);

test("el Cash Collected del Dashboard es el de Finanzas: octubre resta la devolución, septiembre no", () => {
  const p = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  assert.equal(valor(oct, "c_cc"), -1500);
  assert.equal(valor(oct, "c_cc"), p.cashCollected);
  assert.equal(valor(oct, "c_devoluciones"), 3000);
  assert.equal(valor(sept, "c_cc"), 1500);
  assert.equal(valor(sept, "c_devoluciones"), 0);
  /* La venta sigue contando en septiembre. */
  assert.equal(valor(sept, "v_fact"), 3000);
  assert.equal(valor(oct, "v_fact"), 0);
});

test("las comisiones del Dashboard traen lo que se revierte, igual que el estado de resultados", () => {
  const p = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  assert.equal(r2(valor(oct, "r_closers")!), r2(p.comisionCloser));
  assert.equal(r2(valor(oct, "r_closers")!), -218.25);
  assert.equal(r2(valor(oct, "r_director")!), -72.75);
  assert.equal(valor(oct, "r_fees"), 45);
});

test("el profit del Dashboard es el de Finanzas, y su cuenta escrita suma lo mismo que la celda", () => {
  const p = calcularPyL(e, rangoDePeriodo(OCTUBRE));
  assert.equal(r2(valor(oct, "r_neto_cc")!), r2(p.netoCC));
  assert.equal(r2(valor(oct, "r_neto_rev")!), r2(p.netoRev));
  const suma = (id: string) => {
    const piezas = componentesDe(porId.get(id)!, oct, porId) ?? [];
    return piezas.reduce((a, x, i) => a + (i === 0 || x.signo === "+" ? x.valor ?? 0 : -(x.valor ?? 0)), 0);
  };
  for (const id of ["r_bruto", "r_operativo", "r_neto_cc", "r_neto_rev", "r_queda"]) {
    assert.ok(Math.abs(suma(id) - valor(oct, id)!) < 0.005, `${id}: las piezas dan ${suma(id)} y la celda ${valor(oct, id)}`);
  }
  /* En octubre la cuenta del profit sobre lo facturado lleva su pieza de devoluciones. */
  assert.ok((componentesDe(porId.get("r_neto_rev")!, oct, porId) ?? []).some((x) => x.concepto === "Devoluciones"));
});

test("la cuenta del Cash Collected muestra lo que entró, lo que se devolvió y suma lo de la celda", () => {
  const piezas = componentesDe(porId.get("c_cc")!, oct, porId) ?? [];
  assert.deepEqual(piezas.map((x) => x.concepto), ["Cuotas cobradas", "Reservas cobradas", "Devoluciones"]);
  const total = piezas.reduce((a, x) => a + (x.signo === "−" ? -(x.valor ?? 0) : x.valor ?? 0), 0);
  assert.equal(total, valor(oct, "c_cc"));
  /* Sin devoluciones (septiembre) no aparece la pieza. */
  assert.deepEqual((componentesDe(porId.get("c_cc")!, sept, porId) ?? []).map((x) => x.concepto), ["Cuotas cobradas", "Reservas cobradas"]);
});

test("las listas que se abren desde el Dashboard suman lo mismo que el número", () => {
  const det = porId.get("c_cc")!.detalle!(oct)!;
  const entro = det.secciones[0], devuelto = det.secciones[1];
  assert.equal(entro.titulo, "Lo que entró");
  assert.equal(devuelto.titulo, "Lo que se devolvió");
  assert.equal(devuelto.filas.length, 1);
  assert.equal(devuelto.filas[0].titulo, "Belén Godoy");
  /* El resumen dice las tres cosas. */
  assert.deepEqual(det.resumen.map((r) => r.etiqueta), ["Cobrado", "Devuelto", "Cash Collected (CC)"]);
  const lista = porId.get("c_devoluciones")!.detalle!(oct)!;
  assert.equal(lista.secciones[0].filas.length, 1);
  /* Las comisiones abiertas traen la línea en negativo y suman el número. */
  const com = porId.get("r_closers")!.detalle!(oct)!;
  assert.equal(com.secciones[0].filas.length, 2);
  assert.ok(com.secciones[0].filas.some((f) => f.marca?.texto === "Devolución"));
});

test("el estado del Dashboard sin devoluciones se ve igual que antes (la fila nueva se oculta en cero)", () => {
  const sin = estadoCompleto([]);
  const c = new Contexto(sin, corte(OCTUBRE));
  const def = catalogo(sin).find((d) => d.id === "c_devoluciones")!;
  assert.equal(def.ocultarEnCero, true);
  assert.equal(valorEn(def, c), 0);
  assert.equal(valorEn(catalogo(sin).find((d) => d.id === "c_cc")!, c), 1500);
});

test("toda fila nueva dice cómo se calcula", () => {
  const def = porId.get("c_devoluciones")!;
  assert.ok(explicacionDe(def)?.formula);
});

test("el resultado del webinar resta lo devuelto de lo cobrado, revierte las comisiones y no toca la comisión de la pasarela", () => {
  const w = e.webinars[0];
  const sin = metricasDeWebinar(estadoCompleto([]), w);
  const con = metricasDeWebinar(e, w);
  /* Lo que cobró: 3.000 menos las devoluciones; todo devuelto, cero. */
  assert.equal(sin.cobrado, 3000);
  assert.equal(con.cobrado, 0);
  assert.equal(con.devoluciones, 3000);
  assert.equal(con.facturado, 3000);        // la venta sigue contando
  assert.equal(con.procesador, sin.procesador);
  /* Las comisiones (436,50 + 145,50) se revierten enteras: la devolución fue total. */
  assert.equal(r2(sin.comisiones), 582);
  assert.equal(r2(con.comisiones), 0);
  /* Los profits: lo cobrado y lo facturado pierden lo devuelto. */
  assert.equal(r2(con.beneficioCC), r2(sin.beneficioCC - 3000 + 582));
  assert.equal(r2(con.beneficioRev), r2(sin.beneficioRev - 3000 + 582));
  /* Sumar webinars suma también lo devuelto. */
  assert.equal(sumarMetricas([con, con]).devoluciones, 6000);
});

test("el resultado de cada embudo también", () => {
  const filas = resultadoPorEmbudo(e, rangoDePeriodo(OCTUBRE));
  const f = filas.find((x) => x.embudoId === "emb_web")!;
  assert.equal(f.devuelto, 3000);
  assert.equal(f.cobrado, 1500 - 3000);
  assert.equal(f.facturado, 0);
  assert.equal(r2(f.comisiones), r2(218.25 + 72.75 - 436.5 - 145.5));
  /* Septiembre no cambia. */
  const s = resultadoPorEmbudo(e, rangoDePeriodo(SEPTIEMBRE)).find((x) => x.embudoId === "emb_web")!;
  assert.equal(s.devuelto, 0);
  assert.equal(s.cobrado, 1500);
});
