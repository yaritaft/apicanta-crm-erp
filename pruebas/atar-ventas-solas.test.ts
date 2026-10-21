import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { embudosDeWebinar, ventasParaAtar } from "@/lib/atar-webinars";
import { acciones } from "@/lib/store";
import { metricasDeWebinar, sumarMetricas, sumarMetricasConPauta } from "@/lib/webinar";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { componentesDe } from "@/lib/kpis-formulas";
import type { EstadoApp, EstadoApp as E, Venta, Webinar } from "@/lib/types";

/* Las ventas del embudo de webinar se atan solas a su webinar (21/10). Antes era un botón en Webinars que nadie apretaba y el embudo
   de cada webinar decía «Ventas 0» aunque la planilla ya estaba cargada: sin eso tampoco hay facturado, ROAS, profit ni ROI. */

const base = construirSemilla();
const embudoWebinar = { ...base.embudos[0], id: "emb_web", nombre: "Webinar", esWebinar: true };
const embudoOtro = { ...base.embudos[0], id: "emb_int", nombre: "Venta interna", esWebinar: false };
const W = (id: string, dia: string): Webinar => ({ ...base.webinars[0], id, titulo: `Taller ${id}`, fecha: `${dia}T22:00:00.000Z`, estado: "finalizado", inversion: 1000, formularios: 100, grupoWpp: 0, inversionDmAds: 0, costoWhatsappApi: 0 } as Webinar);
const V = (id: string, dia: string, extra: Partial<Venta> = {}): Venta =>
  ({ ...base.ventas[0], id, fecha: `${dia}T15:00:00.000Z`, estado: "activa", precioAcordado: 1000, webinarId: undefined, proyecto: undefined, embudoId: "emb_web", contactoId: `sin_${id}`, ...extra } as Venta);

function estado(ventas: Venta[], webinars: Webinar[] = [W("w1", "2026-10-07"), W("w2", "2026-10-21")]): EstadoApp {
  return { ...base, embudos: [embudoWebinar, embudoOtro], webinars, ventas, sesiones: [], contactos: [], leads: [], cuotas: [], pagos: [], gastos: [], devoluciones: [], adInsights: [] } as unknown as EstadoApp;
}

test("una venta del embudo de webinar sin webinar es del último vivo anterior (por el día de Argentina)", () => {
  const e = estado([V("a", "2026-10-09"), V("b", "2026-10-07"), V("c", "2026-10-22")]);
  const r = ventasParaAtar(e);
  assert.deepEqual(r.map((x) => `${x.venta.id}→${x.webinarId}:${x.motivo}`).sort(), ["a→w1:fecha", "b→w1:fecha", "c→w2:fecha"]);
});

test("más de 14 días después del último vivo no se adivina (puede ser de uno que no está cargado)", () => {
  assert.deepEqual(ventasParaAtar(estado([V("a", "2026-10-22")], [W("w1", "2026-10-07")])), []);
  assert.equal(ventasParaAtar(estado([V("a", "2026-10-21")], [W("w1", "2026-10-07")])).length, 1, "justo a los 14 días todavía vale");
});

test("lo que no es del embudo de webinar, lo que ya tiene webinar y lo cancelado-por-otro-lado no se toca", () => {
  const e = estado([
    V("interna", "2026-10-09", { embudoId: "emb_int" }),
    V("yaTiene", "2026-10-09", { webinarId: "w2" }),
    V("sinEmbudo", "2026-10-09", { embudoId: undefined }),
  ]);
  assert.deepEqual(ventasParaAtar(e), []);
});

test("el webinar de una venta atada alimenta el embudo: ventas, facturado y ROAS dejan de ser cero", () => {
  const e = estado([V("a", "2026-10-09", { precioAcordado: 2000 }), V("b", "2026-10-10", { precioAcordado: 3000 })]);
  assert.equal(metricasDeWebinar(e, e.webinars[0]).ventas, 0, "antes de atar");
  const porId = new Map(ventasParaAtar(e).map((x) => [x.venta.id, x.webinarId]));
  const e2 = { ...e, ventas: e.ventas.map((v) => (porId.has(v.id) ? { ...v, webinarId: porId.get(v.id) } : v)) } as EstadoApp;
  const m = metricasDeWebinar(e2, e2.webinars[0]);
  assert.equal(m.ventas, 2);
  assert.equal(m.facturado, 5000);
  assert.equal(m.roasRev, 5);
});

test("la acción automática sólo ata: no crea webinars de la planilla y lo deja asentado como automático", () => {
  /* Años atrás, lejos de los webinars y las ventas de la semilla (que se mueven con «hoy»): así el resultado no depende de la fecha en que corre la prueba. */
  const nuevoWeb = W("w_auto", "2015-03-04");
  acciones.crear<Webinar>("webinars", nuevoWeb, nuevoWeb.titulo);
  /* El embudo de webinar de la semilla del store (no el de arriba). */
  const embudoDelStore = [...embudosDeWebinar(JSON.parse(acciones.exportar()) as E)][0];
  assert.ok(embudoDelStore, "la semilla tiene un embudo de webinar");
  /* Un proyecto WEB- de un webinar que no está cargado: el botón lo crearía; lo automático no. */
  acciones.crear<Venta>("ventas", V("v_proy", "2015-03-20", { proyecto: "WEB-18/11/26", embudoId: embudoDelStore }), "venta con proyecto de un webinar no cargado");
  acciones.crear<Venta>("ventas", V("v_auto", "2015-03-05", { embudoId: embudoDelStore }), "venta del webinar");
  const antes = (JSON.parse(acciones.exportar()) as E).webinars.length;
  const r = acciones.atarVentasAWebinars({ crearWebinars: false, automatico: true });
  const e = JSON.parse(acciones.exportar()) as E;
  assert.equal(r.webinars, 0);
  assert.equal(e.webinars.length, antes, "no se creó ningún webinar");
  assert.ok(r.ventas >= 1);
  assert.equal(e.ventas.find((v) => v.id === "v_auto")?.webinarId, "w_auto");
  assert.equal(e.ventas.find((v) => v.id === "v_proy")?.webinarId, undefined, "el proyecto de un webinar que no está cargado se deja para quien apriete el botón");
  assert.match(e.actividad[0]?.detalle ?? "", /^Solas, se ataron/);
  /* Otra vez: ya no hay nada. */
  assert.deepEqual(acciones.atarVentasAWebinars({ crearWebinars: false, automatico: true }), { webinars: 0, ventas: 0 });
});

test("ROI: el KPI del webinar es su Profit on CC sobre su inversión total, y dice cómo se calcula", () => {
  const e = estado([V("a", "2026-10-09", { precioAcordado: 5000 })]);
  const porId = new Map(ventasParaAtar(e).map((x) => [x.venta.id, x.webinarId]));
  const e2 = { ...e, ventas: e.ventas.map((v) => (porId.has(v.id) ? { ...v, webinarId: porId.get(v.id) } : v)) } as EstadoApp;
  const corte: Corte = { clave: "total", titulo: "Total", desde: "2026-10-01", hasta: "2026-10-31", foto: true, total: true };
  const ctx = new Contexto(e2, corte);
  const defs = catalogo(e2);
  const porIdDef = new Map(defs.map((d) => [d.id, d]));
  const roi = porIdDef.get("w_roi")!;
  assert.ok(roi && porIdDef.get("roi_cc"), "los dos ROI están en el catálogo");
  assert.equal(roi.formato, "pct");
  const m = sumarMetricas(e2.webinars.filter((w) => w.fecha.startsWith("2026-10")).map((w) => metricasDeWebinar(e2, w)));
  assert.ok(m.inversionTotal > 0);
  assert.ok(Math.abs((valorEn(roi, ctx) ?? NaN) - (m.beneficioCC / m.inversionTotal) * 100) < 1e-9);
  for (const id of ["w_roi", "roi_cc"]) {
    const def = porIdDef.get(id)!;
    assert.ok((componentesDe(def, ctx, porIdDef) ?? []).length > 0, `${id} muestra de qué se compone`);
  }
});

test("ROAS, profit y ROI del total sólo cuentan los webinars con pauta: la plata de uno sin pauta no infla el retorno de los demás", () => {
  const conPauta = W("w1", "2026-10-07");
  const sinPauta = { ...W("w2", "2026-09-23"), inversion: 0 } as Webinar;
  const e0 = estado([V("a", "2026-10-09", { precioAcordado: 5000 }), V("b", "2026-09-24", { precioAcordado: 10000 })], [conPauta, sinPauta]);
  const porId = new Map(ventasParaAtar(e0).map((x) => [x.venta.id, x.webinarId]));
  const e = { ...e0, ventas: e0.ventas.map((v) => (porId.has(v.id) ? { ...v, webinarId: porId.get(v.id) } : v)) } as EstadoApp;
  const ms = e.webinars.map((w) => metricasDeWebinar(e, w));
  assert.equal(sumarMetricas(ms).roasRev, 15, "sumando todo, los 10.000 del webinar sin pauta inflan el ROAS (15x)");
  const solo = sumarMetricasConPauta(ms)!;
  assert.equal(solo.roasRev, 5, "sólo con pauta: 5.000 sobre 1.000");
  assert.equal(solo.ventas, 1);
  assert.equal(sumarMetricasConPauta([metricasDeWebinar(e, e.webinars[1])]), null, "si ninguno tiene pauta no hay retorno que decir");
  /* Y el Dashboard lo dice igual. */
  const corte: Corte = { clave: "total", titulo: "Total", desde: "2026-09-01", hasta: "2026-10-31", foto: true, total: true };
  const ctx = new Contexto(e, corte);
  const porIdDef = new Map(catalogo(e).map((d) => [d.id, d]));
  assert.equal(valorEn(porIdDef.get("w_roas_rev")!, ctx), 5);
});
