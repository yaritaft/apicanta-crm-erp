import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { hojasDelInforme, informeDelWebinar, registroDe } from "@/lib/informe-webinar";
import { hojaDeTabla, serialDeInstante, valorParaExcel } from "@/lib/xlsxTabla";
import { escribirXlsx } from "@/lib/xlsxEscribir";
import { insightsDelWebinar, metaDelWebinar } from "@/lib/webinar";
import type { EstadoApp } from "@/lib/types";

/* Un webinar del 07/10 a las 19 (Argentina) con dos anuncios de la campaña «[WEBINAR 07/10]»:
   - Ana: se registró por el anuncio «angulo-uno», califica, agendó en el vivo, compró (3000, cobró 1500).
   - Beto: se registró por «angulo-dos», NO califica (inglés básico), agendó después y puso una objeción.
   - Cris: se registró sin anuncio y no agendó. */
const calif = [
  { pregunta: "inversion", respuesta: "Puedo invertir en mí de 1000 a 2000 USD" },
  { pregunta: "ingles", respuesta: "Conversacional aunque cometo errores" },
  { pregunta: "formacion", respuesta: "Universitaria completa" },
];
const noCalif = [calif[0], { pregunta: "ingles", respuesta: "Básico" }, calif[2]];
const utmAd = (contenido: string) => ({ utm_source: "meta", utm_medium: "paid", utm_campaign: "webinar_20261007", utm_content: contenido });
const link = (contenido: string) => ({ utm_source: "whatsapp", utm_medium: "organic", utm_campaign: "webinar_20261007", utm_content: contenido });

function estado(): EstadoApp {
  const base = construirSemilla();
  const contacto = (id: string, nombre: string, extra: object = {}, utm?: object) => ({
    id, nombre, email: `${nombre.toLowerCase()}@mail.com`, telefono: "+5491155550000", pais: "Argentina",
    origenCanal: "webinar", origenWebinarId: "w1", utm, creadoEn: "2026-10-02T15:00:00.000Z", extra,
  });
  const reg = (respuestas: object[], utm?: object) => ({
    registrosWebinar: [{ id: "reg_x", webinarId: "w1", creado: "2026-10-02T15:00:00.000Z", utm, respuestas }],
  });
  const sesion = (id: string, contactoId: string, nombre: string, utm: object, respuestas: object[], extra: object = {}) => ({
    id, titulo: "Llamada", invitado: nombre, email: `${nombre.toLowerCase()}@mail.com`, contactoId, leadId: contactoId,
    inicia: "2026-10-09T15:00:00.000Z", duracionMin: 30, estado: "agendada", tipo: "Llamada de Asesoramiento - Webinar - Team", origen: "calendly",
    creadoEn: "2026-10-07T23:00:00.000Z", extra: {}, utm, respuestas, anfitrion: "Dante", calendlyInvitadoUri: `uri_${id}`, ...extra,
  });
  return {
    ...base,
    webinars: [{ ...base.webinars[0], id: "w1", titulo: "Webinar de prueba", fecha: "2026-10-07T22:00:00.000Z", estado: "finalizado", inversion: 0, formularios: 0, inversionDmAds: 0, costoWhatsappApi: 0 }],
    contactos: [
      contacto("c1", "Ana", reg(calif, utmAd("angulo-uno")), utmAd("angulo-uno")),
      contacto("c2", "Beto", reg(noCalif, utmAd("angulo-dos")), utmAd("angulo-dos")),
      contacto("c3", "Cris", reg(calif)),
    ],
    leads: [], sesiones: [
      sesion("s1", "c1", "Ana", link("vivo"), calif),
      sesion("s2", "c2", "Beto", link("replay"), noCalif, { objecion: "Plata" }),
    ],
    campaigns: [{ id: "camp1", nombre: "[WEBINAR 07/10] Captación", objetivo: "leads", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    adsets: [{ id: "set1", campaignId: "camp1", nombre: "Conjunto", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    ads: [
      { id: "ad_a", adsetId: "set1", campaignId: "camp1", nombre: "ANGULO UNO.mp4", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} },
      { id: "ad_b", adsetId: "set1", campaignId: "camp1", nombre: "angulo dos", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} },
    ],
    adInsights: [
      { id: "ad_a_1", adId: "ad_a", dia: "2026-10-02", inversion: 60, impresiones: 1000, clicks: 50, leads: 6, acciones: {}, creadoEn: "" },
      { id: "ad_a_2", adId: "ad_a", dia: "2026-10-03", inversion: 40, impresiones: 800, clicks: 30, leads: 4, acciones: {}, creadoEn: "" },
      { id: "ad_b_1", adId: "ad_b", dia: "2026-10-02", inversion: 50, impresiones: 900, clicks: 20, leads: 2, acciones: {}, creadoEn: "" },
    ],
    ventas: [{ id: "v1", contactoId: "c1", contactoNombre: "Ana", webinarId: "w1", precioAcordado: 3000, estado: "activa", fecha: "2026-10-10T15:00:00.000Z", productoId: base.productos[0].id, moneda: "USD" }],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false, vence: "2026-10-10T15:00:00.000Z" }],
    pagos: [{ id: "p1", cuotaId: "q1", monto: 1500, feeMonto: 0, fecha: "2026-10-10T15:00:00.000Z", creadoEn: "2026-10-10T15:00:00.000Z" }],
    gastos: [],
  } as unknown as EstadoApp;
}

test("la regla de las campañas «[WEBINAR dd/mm]» está expuesta y es la misma de la planilla", () => {
  const e = estado();
  const w = e.webinars[0];
  const dias = insightsDelWebinar(e, w);
  assert.equal(dias.length, 3);
  assert.ok(dias.every((x) => x.tipo === "pauta" && x.webinarId === "w1"));
  assert.deepEqual(metaDelWebinar(e, w), { pauta: 150, formularios: 12, dmAds: 0 });
});

test("el informe tiene tres hojas: Personas, Agendas y Anuncios", () => {
  const e = estado();
  const i = informeDelWebinar(e, e.webinars[0]);
  assert.equal(i.nombreArchivo, "Resumen webinar 07-10-2026 Webinar de prueba.xlsx");
  assert.deepEqual(hojasDelInforme(i).map((h) => h.nombre), ["Personas", "Agendas", "Anuncios"]);
});

test("Personas: quién se registró, qué contestó, si califica, si agendó y si compró", () => {
  const e = estado();
  const { personas } = informeDelWebinar(e, e.webinars[0]);
  assert.deepEqual(personas.filas.map((f) => f.p.nombre).sort(), ["Ana", "Beto", "Cris"]);
  const por = (n: string) => personas.filas.find((f) => f.p.nombre === n)!;
  const col = (t: string) => personas.columnas.find((c) => c.titulo === t)!;
  assert.equal(col("Califica").valor(por("Ana")), "Sí");
  assert.equal(col("Califica").valor(por("Beto")), "No", "inglés básico");
  assert.equal(col("Califica").valor(por("Cris")), "Sí", "sin agenda se evalúa por el registro");
  assert.equal(col("Agendó").valor(por("Ana")), true);
  assert.equal(col("Agendó").valor(por("Cris")), false);
  assert.equal(col("Compró").valor(por("Ana")), true);
  assert.equal(col("Compró").valor(por("Beto")), false);
  assert.equal(col("Facturado").valor(por("Ana")), 3000);
  assert.equal(col("Cobrado").valor(por("Ana")), 1500);
  assert.equal(col("Anuncio").valor(por("Ana")), "angulo-uno");
  assert.equal(col("Anuncio").valor(por("Cris")), "");
  assert.equal(col("Cómo se registró").valor(por("Ana")), "Landing");
  assert.match(String(col("Puede invertir").valor(por("Ana"))), /1000 a 2000/);
});

test("Agendas: cada agenda del lanzamiento con su objeción, venta y anuncio", () => {
  const e = estado();
  const { agendas } = informeDelWebinar(e, e.webinars[0]);
  assert.equal(agendas.filas.length, 2);
  const col = (t: string) => agendas.columnas.find((c) => c.titulo === t)!;
  const ana = agendas.filas.find((f) => f.a.nombre === "Ana")!;
  const beto = agendas.filas.find((f) => f.a.nombre === "Beto")!;
  assert.equal(col("Cuándo agendó").valor(ana), "En el vivo");
  assert.equal(col("Cuándo agendó").valor(beto), "Después");
  assert.equal(col("Link").valor(beto), "replay");
  assert.equal(col("Objeción").valor(beto), "Plata");
  assert.equal(col("Califica").valor(ana), true);
  assert.equal(col("Califica").valor(beto), false);
  assert.match(String(col("Venta").valor(ana)), /3[.,]?000/);
  assert.equal(col("Facturado").valor(ana), 3000);
  assert.equal(col("Cobrado").valor(ana), 1500);
  assert.equal(col("Anuncio").valor(ana), "angulo-uno");
});

test("Anuncios: el gasto de Meta cruzado con lo nuestro por nombre de anuncio, con totales", () => {
  const e = estado();
  const { anuncios } = informeDelWebinar(e, e.webinars[0]);
  const col = (t: string) => anuncios.columnas.find((c) => c.titulo === t)!;
  const uno = anuncios.filas.find((f) => f.anuncio.toLowerCase().includes("uno"))!;
  const dos = anuncios.filas.find((f) => f.anuncio.toLowerCase().includes("dos"))!;
  const sin = anuncios.filas.find((f) => f.anuncio === "(Sin anuncio identificado)");
  /* El nombre de Meta («ANGULO UNO.mp4») y el de la UTM («angulo-uno») son el mismo anuncio. */
  assert.equal(uno.gasto, 100);
  assert.equal(uno.registros, 1);
  assert.equal(uno.agendas, 1);
  assert.equal(uno.calificadas, 1);
  assert.equal(uno.ventas, 1);
  assert.equal(uno.facturado, 3000);
  assert.equal(col("ROAS on CC").valor(uno), 15);
  assert.equal(col("Costo por venta").valor(uno), 100);
  assert.equal(dos.gasto, 50);
  assert.equal(dos.agendas, 1);
  assert.equal(dos.calificadas, 0);
  assert.equal(dos.ventas, 0);
  assert.equal(dos.objeciones, "Plata (1)");
  assert.equal(col("Costo por venta").valor(dos), undefined, "sin ventas no hay costo por venta");
  assert.equal(sin?.registros, 1, "Cris no vino de un anuncio");
  /* El total de gasto es el de las campañas del webinar. */
  assert.equal(col("Gasto").total!(anuncios.filas), 150);
  assert.equal(col("Agendas").total!(anuncios.filas), 2);
});

test("el resumen de arriba trae los números de la ficha, cada uno con su «cómo se calcula»", () => {
  const e = estado();
  const { personas } = informeDelWebinar(e, e.webinars[0]);
  const filas = personas.bloques!.flatMap((b) => b.filas);
  const dato = (etiqueta: string) => filas.find((f) => f.etiqueta.trim() === etiqueta)!;
  assert.equal(dato("Inversión total").valor, 150, "la pauta sale de las campañas de Meta");
  assert.equal(dato("Facturado (Revenue)").valor, 3000);
  assert.equal(dato("Cobrado (Cash Collected)").valor, 1500);
  assert.equal(dato("ROAS on CC").valor, 10);
  assert.equal(dato("Ventas").valor, 1);
  assert.ok(filas.every((f) => f.nota), "toda cifra dice cómo se calcula");
  assert.ok(personas.bloques!.some((b) => b.titulo === "Rendimiento por vía de agenda"));
});

test("sin agendas ni anuncios las hojas salen igual, con un aviso en vez de una tabla vacía", async () => {
  const e = estado();
  const vacio = { ...e, sesiones: [], adInsights: [], contactos: [], ventas: [], cuotas: [], pagos: [] } as EstadoApp;
  const i = informeDelWebinar(vacio, vacio.webinars[0]);
  const hojas = hojasDelInforme(i);
  assert.equal(i.agendas.filas.length, 0);
  assert.ok(hojas[1].celdas.some((c) => typeof c.valor === "string" && /Todavía no hay agendas/.test(c.valor)));
  assert.ok(hojas[2].celdas.some((c) => typeof c.valor === "string" && /No hay anuncios/.test(c.valor)));
  const datos = await escribirXlsx({ hojas });
  assert.ok(datos.length > 500);
});

test("el archivo es un .xlsx válido (un zip) con las tres hojas", async () => {
  const e = estado();
  const hojas = hojasDelInforme(informeDelWebinar(e, e.webinars[0]));
  const datos = await escribirXlsx({ hojas });
  assert.equal(datos[0], 0x50); assert.equal(datos[1], 0x4b); // «PK»
});

test("el registro del webinar se lee de la landing y, si no, del formulario de Meta", () => {
  const c = (extra: object) => ({ id: "c", nombre: "x", extra }) as never;
  assert.equal(registroDe(c({ registrosWebinar: [{ webinarId: "w1", creado: "2026-10-02", respuestas: [] }] }), "w1")?.origen, "Landing");
  const meta = registroDe(c({ formulariosMeta: [{ webinarId: "w1", creado: "2026-10-02", anuncio: "ad uno", respuestas: [{ pregunta: "p", respuesta: "r" }] }] }), "w1");
  assert.equal(meta?.origen, "Formulario de Meta");
  assert.equal(meta?.anuncio, "ad uno");
  assert.equal(registroDe(c({ registrosWebinar: [{ webinarId: "otro", creado: "x", respuestas: [] }] }), "w1"), undefined);
  assert.equal(registroDe(undefined, "w1"), undefined);
});

/* ---------- La hoja de Excel ---------- */

test("fechas como número de Excel en hora de Argentina; un porcentaje, como fracción", () => {
  /* 2026-10-07 19:30 en Argentina = 22:30 UTC. */
  const n = serialDeInstante("2026-10-07T22:30:00.000Z")!;
  assert.equal(Math.floor(n), valorParaExcel("2026-10-07", "fecha"));
  assert.ok(Math.abs((n % 1) - (19 * 60 + 30) / 1440) < 1e-9);
  assert.equal(valorParaExcel(true, "si-no"), "Sí");
  assert.equal(valorParaExcel(undefined, "moneda"), undefined);
  assert.equal(valorParaExcel(NaN, "entero"), undefined);
});

test("una hoja nueva se arma declarando columnas: título, filtro sobre los datos y fila de totales", () => {
  const hoja = hojaDeTabla({
    nombre: "Prueba", titulo: "T", subtitulo: "S",
    columnas: [
      { titulo: "Nombre", valor: (f: { n: string; x: number }) => f.n },
      { titulo: "Monto", formato: "moneda", valor: (f) => f.x, total: (fs) => fs.reduce((a, f) => a + f.x, 0) },
    ],
    filas: [{ n: "a", x: 1 }, { n: "b", x: 2 }], etiquetaTotal: "Total",
  });
  assert.equal(hoja.nombre, "Prueba");
  /* título, subtítulo, línea en blanco, encabezado en la fila 4, datos 5 y 6, total 7. */
  assert.equal(hoja.filtro, "A4:B6");
  const total = hoja.celdas.find((c) => c.fila === 7 && c.columna === 2);
  assert.equal(total?.valor, 3);
});
