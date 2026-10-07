import "./plata-tz";
import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { calcularPyL, cashCollected } from "@/lib/finanzas";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { ingresosPorCuentaYServicio } from "@/lib/ingresos-semanales";
import { periodoAnterior, rangoDeFechas } from "@/lib/metricas";
import { metricasDeWebinar } from "@/lib/webinar";
import { rendimientoPorVia } from "@/lib/vias-webinar";
import { informeDelWebinar } from "@/lib/informe-webinar";
import type { EstadoApp } from "@/lib/types";

/* Intento de refutar «Ingresos semanales / vías del webinar / informe del webinar llaman Cash Collected o cobrado al bruto».
   Reproducción independiente: objetos planos construidos acá, sin los ayudantes de plata-mundo, y la hora de Argentina.
   (Ya arreglado: lo que antes afirmaba el defecto, «BUG», ahora afirma el comportamiento correcto: lo cobrado menos lo devuelto en las tres pantallas.) */

/* El día `d` de octubre de 2026 a las `h` de Argentina, como lo guarda la app (ISO en UTC). */
const oct = (d: number, h = 12) => new Date(Date.UTC(2026, 9, d, h + 3)).toISOString();
const sep = (d: number, h = 12) => new Date(Date.UTC(2026, 8, d, h + 3)).toISOString();

function mundoSimple() {
  const base = construirSemilla() as EstadoApp;
  const venta = (id: string, fecha: string, extra: object = {}) => ({
    id, contactoNombre: id, precioAcordado: 1000, fecha, moneda: "USD", productoId: "p1", closerId: "c1", webinarId: "w1",
    excluidoMarketing: false, estado: "activa", creadoEn: fecha, extra: {}, ...extra,
  });
  const cuota = (id: string, ventaId: string) => ({ id, ventaId, numero: 1, monto: 1000, estado: "pagada", esReserva: false });
  const pago = (id: string, cuotaId: string, fecha: string) =>
    ({ id, cuotaId, monto: 1000, feeMonto: 0, fecha, procesadorId: "proc_stripe", moneda: "USD", feeRate: 0, creadoEn: fecha });
  const dev = (id: string, ventaId: string, fecha: string, monto = 300) =>
    ({ id, ventaId, monto, moneda: "USD", fecha, procesadorId: "proc_stripe", noDescontarAlCloser: false, estado: "confirmada", creadoEn: fecha, extra: {} });
  const w = { ...base.webinars[0], id: "w1", titulo: "W", fecha: sep(20, 19), estado: "finalizado", inversion: 0, formularios: 0, inversionDmAds: 0, costoWhatsappApi: 0 };
  const e = {
    ...base,
    equipo: [{ id: "c1", nombre: "Closer", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }],
    webinars: [w], contactos: [], leads: [], sesiones: [], gastos: [], honorarios: [], liquidaciones: [], traspasos: [],
    adInsights: [], ads: [], campaigns: [], adsets: [], embudos: [],
    productos: [{ id: "p1", nombre: "Mentoría" }], procesadores: [{ id: "proc_stripe", nombre: "Stripe", moneda: "USD" }],
    ventas: [venta("v0", sep(25)), venta("v1", oct(5))],
    cuotas: [cuota("q0", "v0"), cuota("q1", "v1")],
    /* Semana anterior (28/09–04/10): se cobró 1000 el 29/09 y se devolvieron 300 el 01/10.
       Esta semana (05/10–11/10): se cobró 1000 el 06/10 y se devolvieron 300 el 08/10. Dos semanas IGUALES. */
    pagos: [pago("p0", "q0", sep(29, 10)), pago("p1", "q1", oct(6, 10))],
    devoluciones: [dev("d0", "v0", oct(1)), dev("d1", "v1", oct(8))],
  } as unknown as EstadoApp;
  return { e, w };
}

test("1 · el Dashboard y el estado de resultados dicen 700; la tabla de ingresos semanales (rotulada «Cash Collected») también", () => {
  const { e } = mundoSimple();
  const semana = rangoDeFechas("2026-10-05", "2026-10-11", "5 al 11 oct");
  const r = ingresosPorCuentaYServicio(e, semana);

  /* Finanzas */
  assert.equal(cashCollected(e, semana), 700);
  assert.equal(calcularPyL(e, semana).cashCollected, 700);
  /* Dashboard (fila «Cash Collected (CC)») */
  const defs = catalogo(e);
  const corte = { clave: "s", titulo: "s", desde: "2026-10-05", hasta: "2026-10-11", foto: true } as Corte;
  const cc = valorEn(defs.find((d) => d.id === "c_cc")!, new Contexto(e, corte)) as number;
  assert.equal(cc, 700, "el Dashboard");
  /* La tabla: el hero «Cash Collected (CC)» y el «Total general = Cash Collected (CC) del rango» */
  assert.equal(r.total.monto, 700, "la tabla resta lo devuelto: es el Cash Collected");
  assert.equal(r.cuentas.reduce((a, c) => a + c.total.centavos, 0), 70000, "y las filas (con la de devoluciones) suman lo mismo");
  assert.equal(r.cobrado.monto, 1000, "lo cobrado, antes de devolver, sigue a la vista");
  console.log("  [1] Finanzas / Dashboard:", cc, "· Ingresos semanales:", r.total.monto);
});

test("2 · la variación del hero compara el neto de esta semana con el neto de la anterior: dos semanas iguales dan 0 %", () => {
  const { e } = mundoSimple();
  const desde = "2026-10-05", hasta = "2026-10-11";
  const semana = rangoDeFechas(desde, hasta, "5 al 11 oct");
  const r = ingresosPorCuentaYServicio(e, semana);
  /* Tal cual lo calcula components/finanzas/IngresosSemanales.tsx */
  const a = periodoAnterior(desde, hasta);
  const ccAnterior = cashCollected(e, rangoDeFechas(a.desde, a.hasta, "anterior"));
  const cambio = ccAnterior > 0 ? ((r.total.monto - ccAnterior) / ccAnterior) * 100 : null;
  assert.deepEqual(a, { desde: "2026-09-28", hasta: "2026-10-04" });
  assert.equal(ccAnterior, 700, "«antes US$ 700» (neto)");
  assert.equal(r.total.monto, 700, "«US$ 700» (neto)");
  assert.equal(cambio, 0, `la tarjeta marca ${cambio?.toFixed(1)} % entre dos semanas idénticas (CC 700 contra 700)`);
  /* Lo que diría el Dashboard comparando las mismas dos semanas: 0 %. */
  const defs = catalogo(e);
  const val = (desdeD: string, hastaD: string) => valorEn(defs.find((d) => d.id === "c_cc")!, new Contexto(e, { clave: "x", titulo: "x", desde: desdeD, hasta: hastaD, foto: true } as Corte)) as number;
  assert.equal(val("2026-10-05", "2026-10-11"), val("2026-09-28", "2026-10-04"), "el Dashboard: las dos semanas son iguales");
  console.log("  [2] variación en la tarjeta:", cambio?.toFixed(1), "%  · en el Dashboard: 0 %");
});

<<<<<<< /var/folders/cq/hm2l0vb90w7fvjldhyk2j9q00000gn/T/tmpq_iqy1dd/refutar-cc-bruto-vs-neto.test.ts
<<<<<<< /var/folders/cq/hm2l0vb90w7fvjldhyk2j9q00000gn/T/tmpq_iqy1dd/refutar-cc-bruto-vs-neto.test.ts
<<<<<<< /var/folders/cq/hm2l0vb90w7fvjldhyk2j9q00000gn/T/tmpq_iqy1dd/refutar-cc-bruto-vs-neto.test.ts
test("3 · el rendimiento por vía suma 1.000 de cobrado; el resultado del webinar (misma ficha) dice 700", () => {
=======
test("3 · el rendimiento por vía suma lo mismo de cobrado que el resultado del webinar (misma ficha)", () => {
>>>>>>> erp-lot-ccneto/pruebas-estres/plata/refutar-cc-bruto-vs-neto.test.ts
=======
test("3 · el rendimiento por vía suma 1.000 de cobrado; el resultado del webinar (misma ficha) dice 700", () => {
>>>>>>> erp-lot-csv/pruebas-estres/plata/refutar-cc-bruto-vs-neto.test.ts
=======
test("3 · el rendimiento por vía suma 1.000 de cobrado; el resultado del webinar (misma ficha) dice 700", () => {
>>>>>>> erp-lot-rangos/pruebas-estres/plata/refutar-cc-bruto-vs-neto.test.ts
  const { e, w } = mundoSimple();
  /* Una sola venta con devolución: v1 (v0 es otra del mismo webinar, también con la suya). Se mira el webinar entero. */
  const m = metricasDeWebinar(e, w as never);
  const vias = rendimientoPorVia(e, w as never);
  assert.equal(m.facturado, 2000);
  assert.equal(m.devoluciones, 600);
  assert.equal(m.cobrado, 1400, "el resultado del webinar: 2.000 cobrados menos 600 devueltos");
  assert.equal(vias.total.facturado, 2000);
  assert.equal(vias.total.ventas, m.ventas);
  assert.equal(vias.total.cobrado, 1400, "el rendimiento por vía resta lo devuelto, como el resultado del webinar");
  assert.equal(vias.total.devuelto, 600);
  console.log("  [3] metricasDeWebinar.cobrado:", m.cobrado, "· rendimientoPorVia.total.cobrado:", vias.total.cobrado);
});

test("4 · el informe del webinar: el resumen y las hojas dicen el mismo «Cobrado» neto; el ROAS on CC de la hoja de anuncios es el del resumen", () => {
  const base = construirSemilla() as EstadoApp;
  const calif = [
    { pregunta: "inversion", respuesta: "Puedo invertir en mí de 1000 a 2000 USD" },
    { pregunta: "ingles", respuesta: "Conversacional aunque cometo errores" },
    { pregunta: "formacion", respuesta: "Universitaria completa" },
  ];
  const utmAd = { utm_source: "meta", utm_medium: "paid", utm_campaign: "webinar_20261007", utm_content: "angulo-uno" };
  const e = {
    ...base,
    webinars: [{ ...base.webinars[0], id: "w1", titulo: "Webinar de prueba", fecha: "2026-10-07T22:00:00.000Z", estado: "finalizado", inversion: 0, formularios: 0, inversionDmAds: 0, costoWhatsappApi: 0 }],
    contactos: [{
      id: "c1", nombre: "Ana", email: "ana@mail.com", telefono: "+5491155550000", pais: "Argentina", origenCanal: "webinar", origenWebinarId: "w1", utm: utmAd, creadoEn: "2026-10-02T15:00:00.000Z",
      extra: { registrosWebinar: [{ id: "reg_x", webinarId: "w1", creado: "2026-10-02T15:00:00.000Z", utm: utmAd, respuestas: calif }] },
    }],
    leads: [],
    sesiones: [{
      id: "s1", titulo: "Llamada", invitado: "Ana", email: "ana@mail.com", contactoId: "c1", leadId: "c1", inicia: "2026-10-09T15:00:00.000Z", duracionMin: 30, estado: "agendada",
      tipo: "Llamada de Asesoramiento - Webinar - Team", origen: "calendly", creadoEn: "2026-10-07T23:00:00.000Z", extra: {},
      utm: { utm_source: "whatsapp", utm_medium: "organic", utm_campaign: "webinar_20261007", utm_content: "vivo" }, respuestas: calif, anfitrion: "Dante", calendlyInvitadoUri: "uri_s1",
    }],
    campaigns: [{ id: "camp1", nombre: "[WEBINAR 07/10] Captación", objetivo: "leads", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    adsets: [{ id: "set1", campaignId: "camp1", nombre: "Conjunto", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    ads: [{ id: "ad_a", adsetId: "set1", campaignId: "camp1", nombre: "ANGULO UNO.mp4", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    adInsights: [{ id: "ad_a_1", adId: "ad_a", dia: "2026-10-02", inversion: 100, impresiones: 1000, clicks: 50, leads: 6, acciones: {}, creadoEn: "" }],
    ventas: [{ id: "v1", contactoId: "c1", contactoNombre: "Ana", webinarId: "w1", precioAcordado: 3000, estado: "activa", fecha: "2026-10-10T15:00:00.000Z", productoId: base.productos[0].id, moneda: "USD" }],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false, vence: "2026-10-10T15:00:00.000Z" }],
    pagos: [{ id: "p1", cuotaId: "q1", monto: 1500, feeMonto: 0, fecha: "2026-10-10T15:00:00.000Z", creadoEn: "2026-10-10T15:00:00.000Z" }],
    /* Se devolvieron 500 de lo cobrado. */
    devoluciones: [{ id: "d1", ventaId: "v1", monto: 500, moneda: "USD", fecha: "2026-10-12T15:00:00.000Z", noDescontarAlCloser: false, estado: "confirmada", creadoEn: "2026-10-12T15:00:00.000Z", extra: {} }],
    gastos: [],
  } as unknown as EstadoApp;

  const i = informeDelWebinar(e, e.webinars[0]);
  const resumen = i.personas.bloques!.flatMap((b) => b.filas);
  const dato = (etq: string) => resumen.find((f) => f.etiqueta.trim() === etq)!;
  assert.equal(dato("Cobrado (Cash Collected)").valor, 1000, "el resumen de la primera hoja: neto de lo devuelto");
  assert.equal(dato("ROAS on CC").valor, 10, "1.000 / 100");

  const col = <T,>(cols: { titulo: string; valor: (f: T) => unknown; total?: (fs: T[]) => unknown }[], t: string) => cols.find((c) => c.titulo === t)!;
  const cp = col(i.personas.columnas as never, "Cobrado") as { valor: (f: unknown) => unknown; total: (fs: unknown[]) => unknown };
  assert.equal(cp.total(i.personas.filas as never), 1000, "la hoja «Personas» (misma planilla) suma lo mismo de «Cobrado»");
  const ca = col(i.agendas.columnas as never, "Cobrado") as { valor: (f: unknown) => unknown; total: (fs: unknown[]) => unknown };
  assert.equal(ca.total(i.agendas.filas as never), 1000, "la hoja «Agendas»");
  const cn = col(i.anuncios.columnas as never, "ROAS on CC") as { valor: (f: unknown) => unknown };
  const uno = i.anuncios.filas.find((f) => f.anuncio.toLowerCase().includes("uno"))!;
  assert.equal(cn.valor(uno), 10, "«ROAS on CC» de la hoja de anuncios = 1.000 / 100, igual que el resumen de la misma planilla");
  console.log("  [4] resumen:", dato("Cobrado (Cash Collected)").valor, "· hoja Personas:", cp.total(i.personas.filas as never), "· ROAS resumen:", dato("ROAS on CC").valor, "· ROAS hoja anuncios:", cn.valor(uno));
});
