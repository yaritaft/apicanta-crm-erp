import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { metricasDeWebinar, sumarMetricas } from "@/lib/webinar";
import type { EstadoApp, Venta, Webinar } from "@/lib/types";

/* La tasa de cierre del webinar es ventas sobre TODAS sus agendas (el vivo y después), no sobre las «calificadas» (21/10, pedido de Juan Cruz
   en la reunión con Yari): «Calificadas» llegaba a 7 de 76 y el cierre daba 414%. */

const base = construirSemilla();
const W = (id: string, extra: Partial<Webinar> = {}): Webinar => ({
  ...base.webinars[0], id, titulo: id, fecha: "2026-10-07T22:00:00.000Z", estado: "finalizado",
  inversion: 1000, inversionDmAds: 0, costoWhatsappApi: 0, formularios: 100, grupoWpp: 80, asistentes: 50,
  llamadasVivo: 0, llamadasPosterior: 0, llamadasCalificadas: 0, ...extra,
} as Webinar);
/* El estado se fija a mano: el de la primera venta de la semilla cambia con la fecha (a veces es «cancelada»). */
const venta = (id: string, webinarId: string, estado: Venta["estado"] = "activa"): Venta => ({ ...base.ventas[0], id, webinarId, estado });
const estado = (webinars: Webinar[], ventas: Venta[]): EstadoApp => ({ ...base, webinars, ventas, cuotas: [], pagos: [], gastos: [], adInsights: [] } as unknown as EstadoApp);

test("la tasa de cierre es ventas ÷ agendas totales (vivo + después), aunque haya pocas calificadas", () => {
  const w = W("a", { llamadasVivo: 60, llamadasPosterior: 20, llamadasCalificadas: 7 });
  const e = estado([w], Array.from({ length: 29 }, (_, i) => venta(`v${i}`, "a")));
  const m = metricasDeWebinar(e, e.webinars[0]);
  assert.equal(m.llamadas, 80);
  assert.equal(m.ventas, 29);
  assert.equal(m.tasaCierre, (29 / 80) * 100, "sobre las 80 agendas, no sobre las 7 calificadas");
  assert.ok(m.tasaCierre < 100);
});

test("sin agendas la tasa de cierre es 0 y las ventas canceladas no cuentan", () => {
  const e = estado([W("a"), W("b", { llamadasVivo: 10 })], [venta("v1", "a"), venta("v2", "b"), venta("v3", "b", "cancelada")]);
  assert.equal(metricasDeWebinar(e, e.webinars[0]).tasaCierre, 0);
  assert.equal(metricasDeWebinar(e, e.webinars[1]).tasaCierre, 10, "1 venta viva sobre 10 agendas");
});

test("el total de varios webinars sale de sumar ventas y agendas, no de promediar los porcentajes", () => {
  const e = estado([W("a", { llamadasVivo: 10 }), W("b", { llamadasVivo: 30, llamadasPosterior: 70 })], [
    venta("v1", "a"), venta("v2", "a"), ...Array.from({ length: 10 }, (_, i) => venta(`w${i}`, "b")),
  ]);
  const ms = e.webinars.map((w) => metricasDeWebinar(e, w));
  assert.deepEqual(ms.map((m) => m.tasaCierre), [20, 10]);
  assert.equal(sumarMetricas(ms).tasaCierre, (12 / 110) * 100, "12 ventas sobre 110 agendas; el promedio de 20 y 10 daría 15");
});
