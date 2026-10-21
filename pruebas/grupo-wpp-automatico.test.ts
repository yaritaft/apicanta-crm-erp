import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { informeDelWebinar } from "@/lib/informe-webinar";
import { acciones } from "@/lib/store";
import { camposDeWhatsapp, formulariosDelWebinar, gruposWppDelWebinar, metricasDeWebinar, numerosDelWebinar, origenAutomatico, registrosDelWebinar, seUnieronAlGrupo, sumarMetricas } from "@/lib/webinar";
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

/* ---------- «Formularios» de un webinar sin pauta de Meta: los registros de la landing ---------- */

const conRegistros = (formularios: number, registros?: number, w2 = "w1"): { e: EstadoApp; w: Webinar } => {
  const { e, w } = conGrupos(0, undefined);
  const w1 = { ...w, formularios };
  return { e: { ...e, webinars: [w1], registrosPorWebinar: registros === undefined ? undefined : [{ webinarId: w2, registros }] }, w: w1 };
};

test("un webinar sin formularios cargados ni Meta toma los registros de la landing", () => {
  const { e, w } = conRegistros(0, 1278);
  assert.equal(registrosDelWebinar(e, w), 1278);
  assert.equal(numerosDelWebinar(e, w).formularios, 1278);
  assert.equal(metricasDeWebinar(e, w).formularios, 1278);
  assert.match(origenAutomatico(e, w, "formularios") ?? "", /landing/);
});

test("lo cargado a mano manda sobre los registros, y sin registros no cambia nada", () => {
  const manual = conRegistros(138, 1306);
  assert.equal(numerosDelWebinar(manual.e, manual.w).formularios, 138);
  assert.equal(origenAutomatico(manual.e, manual.w, "formularios"), undefined);
  const sin = conRegistros(0, undefined);
  assert.equal(numerosDelWebinar(sin.e, sin.w).formularios, 0);
  const deOtro = conRegistros(0, 500, "otro");
  assert.equal(numerosDelWebinar(deOtro.e, deOtro.w).formularios, 0, "los registros de otro webinar no cuentan");
});

test("con grupo y registros, la conversión formulario → grupo sale completa en un webinar viejo", () => {
  const { e, w } = conRegistros(0, 1000);
  const e2 = { ...e, gruposWpp: [resumen("w1", { entraron: 700, sinTelefono: 100 })] };
  const m = metricasDeWebinar(e2, w);
  assert.equal(m.grupoWpp, 800);
  assert.equal(m.asistenciaFormulario, 80);
});

test("el contador automático (extra.formulariosAuto) nunca queda por debajo de los registros de la landing: en un webinar en curso decía 147 con 1.309 registrados", () => {
  const { e, w } = conRegistros(147, 1309);
  const auto = { ...w, extra: { formulariosAuto: 147 } };
  const e2 = { ...e, webinars: [auto] };
  assert.deepEqual(formulariosDelWebinar(e2, auto), { valor: 1309, origen: "landing" });
  assert.equal(numerosDelWebinar(e2, auto).formularios, 1309);
  assert.equal(metricasDeWebinar(e2, auto).formularios, 1309);
  assert.match(origenAutomatico(e2, auto, "formularios") ?? "", /landing/);
});

test("si el contador automático ya es el mayor, queda; y lo cargado a mano (distinto del contador) manda siempre", () => {
  const { e, w } = conRegistros(1500, 1309);
  const auto = { ...w, extra: { formulariosAuto: 1500 } };
  assert.deepEqual(formulariosDelWebinar({ ...e, webinars: [auto] }, auto), { valor: 1500, origen: "contado" });
  /* A mano: 147 sin contador, o distinto del contador (alguien lo corrigió). */
  for (const extra of [{}, { formulariosAuto: 90 }]) {
    const mano = { ...w, formularios: 147, extra };
    const e3 = { ...e, webinars: [mano], registrosPorWebinar: [{ webinarId: "w1", registros: 1309 }] };
    assert.deepEqual(formulariosDelWebinar(e3, mano), { valor: 147, origen: "mano" });
    assert.equal(origenAutomatico(e3, mano, "formularios"), undefined);
  }
});
