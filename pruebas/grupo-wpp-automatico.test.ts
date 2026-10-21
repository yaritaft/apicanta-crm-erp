import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { informeDelWebinar } from "@/lib/informe-webinar";
import { acciones } from "@/lib/store";
import { camposDeWhatsapp, gruposWppDelWebinar, metricasDeWebinar, numerosDelWebinar, origenAutomatico, seUnieronAlGrupo, sumarMetricas } from "@/lib/webinar";
import type { EstadoApp, GrupoWppResumen, Webinar } from "@/lib/types";

/* «Se unieron al grupo» sale solo del lector de WhatsApp (21/10): antes era un número que había que cargar a mano y
   estaba en cero en todos los webinars, así que el embudo, la planilla, el Dashboard y el informe decían 0. */

const resumen = (webinarId: string, x: Partial<GrupoWppResumen> = {}): GrupoWppResumen =>
  ({ webinarId, grupos: 2, entraron: 838, dentro: 747, salieron: 91, sinTelefono: 40, ...x });

function conGrupos(grupoManual: number, gruposWpp?: GrupoWppResumen[]): { e: EstadoApp; w: Webinar } {
  const base = construirSemilla();
  const w: Webinar = { ...base.webinars[0], id: "w1", titulo: "Taller 07/10", fecha: "2026-10-07T22:00:00.000Z", estado: "finalizado", inversion: 3000, formularios: 1200, inversionDmAds: 0, costoWhatsappApi: 0, grupoWpp: grupoManual, asistentes: 900 };
  return { e: { ...base, webinars: [w], ventas: [], adInsights: [], gruposWpp }, w };
}

test("el grupo en cero sale de los que entraron a los grupos del webinar más los que no se les ve el teléfono", () => {
  const { e, w } = conGrupos(0, [resumen("w1")]);
  assert.equal(seUnieronAlGrupo(resumen("w1")), 878);
  assert.equal(numerosDelWebinar(e, w).grupoWpp, 878);
  const m = metricasDeWebinar(e, w);
  assert.equal(m.grupoWpp, 878);
  /* Lo que se deriva del grupo ya no queda en cero: formulario → grupo, asistencia, costo por persona en el grupo. */
  assert.ok(Math.abs(m.asistenciaFormulario - (878 / 1200) * 100) < 1e-9);
  assert.ok(Math.abs(m.asistenciaTaller - (900 / 878) * 100) < 1e-9);
  assert.ok(Math.abs(m.cplGrupo - 3000 / 878) < 1e-9);
});

test("lo cargado a mano manda: el lector sólo llena lo que está en cero", () => {
  const { e, w } = conGrupos(500, [resumen("w1")]);
  assert.equal(metricasDeWebinar(e, w).grupoWpp, 500);
  assert.equal(origenAutomatico(e, w, "grupoWpp"), undefined, "no dice «del lector» si lo cargó alguien");
  assert.equal(camposDeWhatsapp(e, w).size, 0);
});

test("sin grupos atados, o con los de otro webinar, o sin la vista, sigue en cero y sin etiqueta", () => {
  for (const g of [undefined, [], [resumen("otro")]]) {
    const { e, w } = conGrupos(0, g);
    assert.equal(gruposWppDelWebinar(e, w), undefined);
    assert.equal(metricasDeWebinar(e, w).grupoWpp, 0);
    assert.equal(origenAutomatico(e, w, "grupoWpp"), undefined);
  }
});

test("un webinar con grupos pero nadie adentro todavía queda en cero y sin etiqueta (no hay nada que mostrar como automático)", () => {
  const { e, w } = conGrupos(0, [resumen("w1", { entraron: 0, dentro: 0, salieron: 0, sinTelefono: 0 })]);
  assert.equal(metricasDeWebinar(e, w).grupoWpp, 0);
  assert.equal(camposDeWhatsapp(e, w).size, 0);
});

test("la etiqueta dice de dónde sale el número, y sólo para el grupo", () => {
  const { e, w } = conGrupos(0, [resumen("w1")]);
  assert.match(origenAutomatico(e, w, "grupoWpp") ?? "", /WhatsApp/);
  assert.equal(origenAutomatico(e, w, "asistentes"), undefined);
  assert.equal(origenAutomatico(e, w, "inversion"), undefined, "la pauta cargada a mano no es de nadie más");
});

test("el total de varios webinars suma el grupo automático de cada uno (no el promedio de porcentajes)", () => {
  const base = construirSemilla();
  const w = (id: string, fecha: string): Webinar => ({ ...base.webinars[0], id, fecha, estado: "finalizado", inversion: 100, formularios: 100, inversionDmAds: 0, costoWhatsappApi: 0, grupoWpp: 0, asistentes: 50 });
  const e: EstadoApp = { ...base, webinars: [w("a", "2026-09-23T22:00:00.000Z"), w("b", "2026-10-07T22:00:00.000Z")], ventas: [], adInsights: [], gruposWpp: [resumen("a", { entraron: 60, sinTelefono: 0 }), resumen("b", { entraron: 30, sinTelefono: 10 })] };
  const total = sumarMetricas(e.webinars.map((x) => metricasDeWebinar(e, x)));
  assert.equal(total.grupoWpp, 100);
  assert.equal(total.asistenciaFormulario, 50);
});

test("el informe del webinar muestra el grupo automático y explica de dónde sale", () => {
  const { e, w } = conGrupos(0, [resumen("w1")]);
  const fila = informeDelWebinar(e, w).personas.bloques?.flatMap((b) => b.filas).find((f) => f.etiqueta === "Se unieron al grupo");
  assert.equal(fila?.valor, 878);
  assert.match(fila?.nota ?? "", /lector/);
});

test("refrescarGruposWpp sin nube (la demo local) no hace nada ni rompe", async () => {
  await assert.doesNotReject(acciones.refrescarGruposWpp());
});
