import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { gastoDelWebinarEnDias, gastoDeWebinarsEnDias, numerosDelWebinar } from "@/lib/webinar";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { componentesDe } from "@/lib/kpis-formulas";
import type { EstadoApp, Webinar } from "@/lib/types";

/* El gasto de los webinars (pauta, DM Ads, WhatsApp API) cae día por día, no el día del vivo (21/10, pedido de Juan Cruz después de que Agustín
   viera la «inversión en Ads» sólo el 7 y el 21 de octubre). Cada día de gasto va en SU día y en el webinar al que pertenece; se puede ver de
   un webinar o de todos, y la suma de todos los días de un webinar es lo mismo que su total de la planilla. */

const base = construirSemilla();
const W = (id: string, dia: string, extra: Partial<Webinar> = {}): Webinar => ({
  ...base.webinars[0], id, titulo: `Taller ${id}`, fecha: `${dia}T22:00:00.000Z`, estado: "finalizado",
  inversion: 0, inversionDmAds: 0, costoWhatsappApi: 0, formularios: 100, ...extra,
} as Webinar);

const campania = (id: string, nombre: string) => ({ id, nombre, objetivo: "", estado: "ACTIVE", creadoEn: "2026-09-01T00:00:00.000Z", extra: {} });
const anuncio = (id: string, campaignId: string) => ({ id, adsetId: `as_${id}`, campaignId, nombre: id, estado: "ACTIVE", creadoEn: "2026-09-01T00:00:00.000Z", extra: {} });
const insight = (adId: string, dia: string, inversion: number) => ({ id: `${adId}_${dia}`, adId, dia, inversion, impresiones: 1000, clicks: 10, leads: 2 });

/* a: vivo 07/10 con 7 días de pauta (100 por día, del 01 al 07). b: vivo 21/10 con 7 días de pauta (50 por día, del 15 al 21).
   DM Ads: 30 por día del 08 al 14 (van al próximo vivo, b). */
function estado(webinars: Webinar[]): EstadoApp {
  const dias = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => `2026-10-${String(desde + i).padStart(2, "0")}`);
  return {
    ...base, webinars,
    campaigns: [campania("ca", "[WEBINAR 07/10] captación"), campania("cb", "[WEBINAR 21/10] captación"), campania("cd", "DM WP API")],
    ads: [anuncio("aa", "ca"), anuncio("ab", "cb"), anuncio("ad", "cd")],
    adInsights: [
      ...dias(1, 7).map((d) => insight("aa", d, 100)),
      ...dias(15, 21).map((d) => insight("ab", d, 50)),
      ...dias(8, 14).map((d) => insight("ad", d, 30)),
    ],
    costosWpp: [{ dia: "2026-10-10", costo: 12.5 }, { dia: "2026-10-18", costo: 7.5 }],
    ventas: [], cuotas: [], pagos: [], gastos: [], devoluciones: [],
  } as unknown as EstadoApp;
}

const corte = (desde: string, hasta: string, filtro?: Corte["filtro"]): Corte => ({ clave: `${desde}:${hasta}`, titulo: desde, desde, hasta, foto: false, filtro });

test("cada día de gasto cae en su día, no el día del vivo", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")]);
  const [a, b] = e.webinars;
  assert.deepEqual(gastoDelWebinarEnDias(e, a, "2026-10-03", "2026-10-03"), { pauta: 100, dmAds: 0, whatsappApi: 0 });
  assert.deepEqual(gastoDelWebinarEnDias(e, a, "2026-10-07", "2026-10-07"), { pauta: 100, dmAds: 0, whatsappApi: 0 }, "el día del vivo sólo tiene su día");
  assert.deepEqual(gastoDelWebinarEnDias(e, a, "2026-10-08", "2026-10-13"), { pauta: 0, dmAds: 0, whatsappApi: 0 }, "a ya no gasta después de su vivo");
  assert.deepEqual(gastoDelWebinarEnDias(e, b, "2026-10-10", "2026-10-10"), { pauta: 0, dmAds: 30, whatsappApi: 12.5 }, "DM Ads y WhatsApp de ese día van al próximo vivo");
  assert.deepEqual(gastoDelWebinarEnDias(e, b, "2026-10-18", "2026-10-18"), { pauta: 50, dmAds: 0, whatsappApi: 7.5 }, "el 18 b gasta pauta y WhatsApp, y ya no DM");
});

test("la suma de todos los días de un webinar es su total de la planilla", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")]);
  for (const w of e.webinars) {
    const n = numerosDelWebinar(e, w);
    const g = gastoDelWebinarEnDias(e, w, "2026-01-01", "2026-12-31");
    assert.equal(g.pauta, n.inversion);
    assert.equal(g.dmAds, n.inversionDmAds);
    assert.equal(g.whatsappApi, n.costoWhatsappApi);
  }
  const todos = gastoDeWebinarsEnDias(e, e.webinars, "2026-10-01", "2026-10-21");
  assert.deepEqual(todos, { pauta: 700 + 350, dmAds: 210, whatsappApi: 20 });
});

test("lo cargado a mano en la planilla manda y se cuenta el día del vivo", () => {
  const e = estado([W("a", "2026-10-07", { inversion: 900, inversionDmAds: 40 }), W("b", "2026-10-21")]);
  const a = e.webinars[0];
  assert.deepEqual(gastoDelWebinarEnDias(e, a, "2026-10-03", "2026-10-03"), { pauta: 0, dmAds: 0, whatsappApi: 0 }, "un día común: la pauta a mano no tiene días");
  assert.deepEqual(gastoDelWebinarEnDias(e, a, "2026-10-07", "2026-10-07"), { pauta: 900, dmAds: 40, whatsappApi: 0 });
  assert.equal(gastoDelWebinarEnDias(e, a, "2026-01-01", "2026-12-31").pauta, numerosDelWebinar(e, a).inversion);
});

test("en el Dashboard las filas de gasto de webinars se llenan todos los días de gasto, de todos los webinars o de uno", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")]);
  const defs = new Map(catalogo(e).map((d) => [d.id, d]));
  const v = (id: string, c: Corte) => valorEn(defs.get(id)!, new Contexto(e, c));
  // un día sin vivo: antes daba guion
  assert.equal(v("w_pauta", corte("2026-10-03", "2026-10-03")), 100);
  assert.equal(v("w_pauta", corte("2026-10-16", "2026-10-16")), 50);
  assert.equal(v("w_dm", corte("2026-10-09", "2026-10-09")), 30);
  assert.equal(v("w_wapi", corte("2026-10-10", "2026-10-10")), 12.5);
  assert.equal(v("w_inv", corte("2026-10-18", "2026-10-18")), 57.5, "pauta 50 + WhatsApp 7,5");
  assert.equal(v("w_pauta", corte("2026-10-22", "2026-10-22")), null, "sin gasto: guion");
  // el total del mes es lo de los dos webinars
  assert.equal(v("w_inv", corte("2026-10-01", "2026-10-31")), 700 + 350 + 210 + 20);
  // con un webinar elegido, sólo lo suyo
  assert.equal(v("w_pauta", corte("2026-10-01", "2026-10-31", { webinarId: "a" })), 700);
  assert.equal(v("w_pauta", corte("2026-10-16", "2026-10-16", { webinarId: "a" })), null, "el 16 a ya no gastaba");
  assert.equal(v("w_inv", corte("2026-10-01", "2026-10-31", { webinarId: "b" })), 350 + 210 + 20);
});

test("el detalle y la explicación de la fila cuentan lo gastado en esos días, webinar por webinar", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")]);
  const defs = catalogo(e);
  const porId = new Map(defs.map((d) => [d.id, d]));
  const def = porId.get("w_pauta")!;
  const c = new Contexto(e, corte("2026-10-05", "2026-10-16"));
  const piezas = componentesDe(def, c, porId);
  assert.deepEqual((piezas ?? []).map((x) => `${x.concepto}=${x.valor}`), ["Taller a · 07/10=300", "Taller b · 21/10=100"], "a gastó 3 días (05, 06, 07) y b 2 (15, 16)");
  const det = def.detalle?.(c);
  assert.ok(det, "el número se puede abrir");
  assert.deepEqual(det.secciones[0].filas.map((f) => `${f.titulo}=${f.valor}`).sort(), ["Taller a=US$ 300", "Taller b=US$ 100"].map((x) => x));
});

test("los costos y retornos del webinar siguen usando el total de cada webinar, no lo gastado en los días del corte", () => {
  const e = estado([W("a", "2026-10-07"), W("b", "2026-10-21")]);
  const defs = new Map(catalogo(e).map((d) => [d.id, d]));
  const c = new Contexto(e, corte("2026-10-07", "2026-10-07"));
  // el 07/10 se gastaron 100, pero el webinar a costó 700: el costo por formulario usa los 700
  assert.equal(valorEn(defs.get("w_inv")!, c), 100);
  assert.equal(valorEn(defs.get("w_cpf")!, c), 700 / 100);
  const piezas = componentesDe(defs.get("w_cpf")!, c, defs);
  assert.equal(piezas?.[0].valor, 700, "y la explicación muestra los 700, no los 100 del día");
});
