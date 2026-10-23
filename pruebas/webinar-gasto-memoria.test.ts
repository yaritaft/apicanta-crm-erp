import test from "node:test";
import assert from "node:assert/strict";
import { estadoVacio } from "@/lib/seed";
import { gastoDelWebinarEnDias, gastoDeWebinarsEnDias, repartirInsights } from "@/lib/webinar";
import type { EstadoApp } from "@/lib/types";

/* El Dashboard tardaba 15 s con el mes de septiembre: el gasto de cada webinar se calcula por columna, y la memoria del reparto se
   indexaba por `e.costosWpp ?? []`. Con WhatsApp API sin conectar (sin costos) ese arreglo era uno nuevo en cada llamada, la memoria
   nunca acertaba y se repartían los 8.000 días de gasto de Meta por cada webinar y cada columna (Yari, 22/10). */

function estado(): EstadoApp {
  const e = estadoVacio();
  e.costosWpp = undefined;
  e.webinars = Array.from({ length: 30 }, (_, i) => ({
    ...estadoVacio().webinars[0], id: `w${i}`, titulo: `Taller ${i}`, estado: "finalizado" as const,
    fecha: new Date(Date.UTC(2026, 0, 7 + i * 7, 22)).toISOString(), inversion: 0, inversionDmAds: 0, costoWhatsappApi: 0,
  }));
  e.campaigns = e.webinars.map((w, i) => ({ id: `c${i}`, nombre: `[WEBINAR ${String(7 + i * 7 > 28 ? ((i * 7) % 28) + 1 : 7 + i * 7).padStart(2, "0")}/${String(1 + Math.floor((i * 7) / 28)).padStart(2, "0")}] pauta` })) as never;
  e.ads = e.campaigns.map((c, i) => ({ id: `a${i}`, campaignId: c.id })) as never;
  e.adInsights = Array.from({ length: 6000 }, (_, i) => ({ adId: `a${i % 30}`, dia: new Date(Date.UTC(2026, 0, 1 + (i % 300))).toISOString().slice(0, 10), inversion: 10, leads: 1 })) as never;
  return e;
}

test("el reparto del gasto de Meta se hace una sola vez por estado, aunque no haya costos de WhatsApp", () => {
  const e = estado();
  assert.equal(repartirInsights(e), repartirInsights(e), "la misma lista, no una nueva en cada llamada");
});

test("pedir el gasto de cada webinar en cada día del mes no recalcula todo cada vez", () => {
  const e = estado();
  const t0 = performance.now();
  for (let dia = 1; dia <= 31; dia++) {
    const d = `2026-03-${String(dia).padStart(2, "0")}`;
    for (const w of e.webinars) gastoDelWebinarEnDias(e, w, d, d);
    gastoDeWebinarsEnDias(e, e.webinars, d, d);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `31 columnas × 30 webinars tardaron ${Math.round(ms)} ms (antes, decenas de segundos)`);
});

test("al cambiar los anuncios el reparto se rehace", () => {
  const e = estado();
  const antes = repartirInsights(e);
  const e2 = { ...e, adInsights: [...(e.adInsights ?? [])] };
  assert.notEqual(repartirInsights(e2), antes);
});
