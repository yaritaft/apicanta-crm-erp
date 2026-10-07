import test from "node:test";
import assert from "node:assert/strict";
import {
  adivinarMapeo, adIdDeUtm, contarRegistros, fechaDeHoja, filtrarRegistros, fusionarRegistro, idRegistro, instanteDe,
  leerFecha, leerHoja, nuevoRegistro, planificarImportacion, type HojaAImportar, type RegistroForm,
} from "@/lib/registros-webinar";

const WEBINARS = [{ id: "web_1", fecha: "2026-09-23T22:00:00.000Z" }, { id: "web_2", fecha: "2026-10-14T22:00:00.000Z" }];

test("el id es el mismo para la misma persona y el mismo webinar, sin importar mayúsculas ni espacios", () => {
  const a = idRegistro("Ana@Mail.com ", "2026-09-23");
  assert.equal(a, idRegistro("ana@mail.com", "2026-09-23"));
  assert.notEqual(a, idRegistro("ana@mail.com", "2026-10-14"), "otro webinar, otra fila");
  assert.notEqual(a, idRegistro("beto@mail.com", "2026-09-23"));
  assert.match(a, /^reg_[0-9a-f]{32}$/);
  assert.equal(idRegistro("a@b.co", undefined), idRegistro("a@b.co", ""), "sin fecha es «sin»");
  assert.equal(idRegistro("a@b.co", "2026-09-23T22:00:00Z"), idRegistro("a@b.co", "2026-09-23"), "sólo cuenta el día");
});

test("fechas: las formas de un Excel y el nombre de la hoja", () => {
  assert.equal(leerFecha("23/09/2026"), "2026-09-23");
  assert.equal(leerFecha("23-09-26"), "2026-09-23");
  assert.equal(leerFecha("2026-09-23 18:30"), "2026-09-23");
  assert.equal(leerFecha("20260923"), "2026-09-23");
  assert.equal(leerFecha("23 de septiembre de 2026"), "2026-09-23");
  assert.equal(leerFecha("14 oct", 2026), "2026-10-14");
  assert.equal(leerFecha("46288"), "2026-09-23", "número de serie de Excel");
  assert.equal(leerFecha("31/02/2026"), undefined, "ese día no existe");
  assert.equal(leerFecha("Hoja 1"), undefined);
  assert.equal(fechaDeHoja("Webinar 23/09", 2026), "2026-09-23");
  assert.equal(fechaDeHoja("Taller 14-10-2026"), "2026-10-14");
  assert.equal(fechaDeHoja("webinar_20261014"), "2026-10-14");
  assert.equal(instanteDe("23/09/2026 18:30", 2026), "2026-09-23T21:30:00.000Z", "la hora del Excel es argentina");
});

test("el anuncio sale de utm_content: el id de Meta o el nombre de un anuncio conocido", () => {
  const ads = [{ id: "ad_120211111111111", metaId: "120211111111111", nombre: "Video 3 · dolor" }];
  assert.equal(adIdDeUtm({ utm_content: "120211111111111" }, ads), "ad_120211111111111");
  assert.equal(adIdDeUtm({ utm_content: "120299999999999" }), "ad_120299999999999", "id de Meta que no se sincronizó todavía");
  assert.equal(adIdDeUtm({ utm_content: "video 3 · dolor" }, ads), "ad_120211111111111");
  assert.equal(adIdDeUtm({ utm_content: "vivo" }, ads), undefined, "vivo no es un anuncio");
  assert.equal(adIdDeUtm({}), undefined);
});

test("el mapeo se adivina por los encabezados del Excel de Yari y deja el resto como respuestas", () => {
  const m = adivinarMapeo(["Fecha", "Nombre", "Email", "País", "Código", "Teléfono", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "¿Cuánto invertís?", "Unido", "No unido", "Contactado"]);
  assert.equal(m.fecha, 0); assert.equal(m.nombre, 1); assert.equal(m.email, 2); assert.equal(m.pais, 3);
  assert.equal(m.codigoPais, 4); assert.equal(m.telefono, 5);
  assert.equal(m.utm_source, 6); assert.equal(m.utm_content, 9); assert.equal(m.utm_term, 10);
  assert.equal(m.unido, 12); assert.equal(m.noUnido, 13); assert.equal(m.contactado, 14);
  assert.equal(new Set(Object.values(m)).size, Object.values(m).length, "una columna no se usa dos veces");
});

const TABLA = [
  ["Fecha", "Nombre", "Email", "País", "Código", "Teléfono", "utm_source", "utm_content", "¿Cuánto invertís?", "Unido", "Contactado"],
  ["23/09/2026 18:30", "Ana Pérez", "Ana@Mail.com", "Argentina", "+54", "011 15 5123-4567", "meta", "120211111111111", "Más de 1000", "x", ""],
  ["23/09/2026 19:00", "Beto", "beto@mail.com", "México", "52", "55 1234 5678", "meta", "vivo", "", "", "sí"],
  ["23/09/2026 19:10", "Sin mail", "no-es-mail", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", ""],
  ["23/09/2026 20:00", "Ana repetida", "ana@mail.com", "", "", "", "", "", "", "", ""],
];
const hoja = (): HojaAImportar => ({ nombre: "Webinar 23/09", tabla: TABLA, mapeo: adivinarMapeo(TABLA[0]), fechaWebinar: "2026-09-23", incluir: true });

test("leer una hoja: normaliza, descarta lo que no tiene mail y no repite", () => {
  const h = leerHoja(hoja(), { webinars: WEBINARS, anio: 2026, ahora: "2026-10-07T00:00:00.000Z" });
  assert.equal(h.registros.length, 2);
  assert.equal(h.webinarId, "web_1", "la fecha de la hoja ata al webinar de la app");
  assert.deepEqual(h.descartadas.map((d) => d.fila), [4]);
  assert.equal(h.repetidas, 1, "el mismo mail dos veces en la hoja entra una vez");
  const [ana, beto] = h.registros;
  assert.equal(ana.email, "ana@mail.com");
  assert.equal(ana.fechaWebinar, "2026-09-23");
  assert.equal(ana.webinarId, "web_1");
  assert.equal(ana.telefonoNorm, "541151234567", "el código y el 15 se ordenan");
  assert.equal(beto.telefonoNorm, "525512345678");
  assert.equal(ana.grupo, "unido");
  assert.equal(ana.contactado, false);
  assert.equal(beto.contactado, true);
  assert.equal(ana.adId, "ad_120211111111111");
  assert.equal(beto.adId, undefined, "«vivo» no es un anuncio");
  assert.deepEqual(ana.utm, { utm_source: "meta", utm_content: "120211111111111" });
  assert.deepEqual(ana.respuestas, [{ pregunta: "¿Cuánto invertís?", respuesta: "Más de 1000" }]);
  assert.equal(ana.origen, "excel");
  assert.equal(ana.origenDetalle, "Webinar 23/09");
  assert.equal(ana.registradoEn, "2026-09-23T21:30:00.000Z");
  assert.equal(ana.id, idRegistro("ana@mail.com", "2026-09-23"), "el mismo id que la landing");
});

test("el resumen cuenta nuevos, los que ya estaban y los que se descartan, sin escribir nada", () => {
  const h = leerHoja(hoja(), { webinars: WEBINARS, anio: 2026 });
  const ya = nuevoRegistro({ id: idRegistro("beto@mail.com", "2026-09-23"), email: "beto@mail.com", fechaWebinar: "2026-09-23", grupo: "no-unido", contactado: true, contactadoPor: "Mica", origen: "landing" });
  const plan = planificarImportacion([h], new Map([[ya.id, ya]]));
  assert.deepEqual(plan.totales, { filas: 4, nuevos: 1, yaEstaban: 1, sinMail: 1, repetidos: 1 });
  assert.equal(plan.aEscribir.length, 2);
  const beto = plan.aEscribir.find((r) => r.email === "beto@mail.com")!;
  assert.equal(beto.grupo, "no-unido", "la marca del equipo no se pisa con lo importado");
  assert.equal(beto.contactadoPor, "Mica");
  assert.equal(beto.nombre, "Beto", "los huecos se completan");
  assert.equal(beto.origen, "landing", "sigue siendo de la landing");
});

test("un webinar que la app no tiene avisa; una hoja sin fecha, también; la misma hoja dos veces no duplica", () => {
  const sin = leerHoja({ ...hoja(), fechaWebinar: "2026-11-04" }, { webinars: WEBINARS, anio: 2026 });
  const plan = planificarImportacion([sin], new Map());
  assert.match(plan.avisos[0], /04\/11\/2026/);
  const sinFecha = leerHoja({ ...hoja(), fechaWebinar: undefined }, { webinars: WEBINARS, anio: 2026 });
  assert.match(planificarImportacion([sinFecha], new Map()).avisos[0], /no tiene fecha del webinar/);
  /* Reimportar: la segunda vez todos «ya estaban». */
  const h = leerHoja(hoja(), { webinars: WEBINARS, anio: 2026 });
  const primera = planificarImportacion([h], new Map());
  const guardados = new Map(primera.aEscribir.map((r) => [r.id, r]));
  const segunda = planificarImportacion([leerHoja(hoja(), { webinars: WEBINARS, anio: 2026 })], guardados);
  assert.equal(segunda.totales.nuevos, 0);
  assert.equal(segunda.totales.yaEstaban, 2);
});

const R = (o: Partial<RegistroForm> & { email: string }) => nuevoRegistro({ fechaWebinar: "2026-09-23", ...o });

test("filtros por webinar (fecha o id), por marca y por texto; y las cuentas", () => {
  const rs = [
    R({ email: "a@x.com", nombre: "Ana Pérez", grupo: "unido", webinarId: "web_1" }),
    R({ email: "b@x.com", nombre: "Beto", grupo: "no-unido", contactado: true }),
    R({ email: "c@x.com", nombre: "Cris", respuestas: [{ pregunta: "Inglés", respuesta: "Intermedio" }] }),
    R({ email: "d@x.com", fechaWebinar: "2026-10-14", nombre: "Dani" }),
    R({ email: "e@x.com", fechaWebinar: undefined, nombre: "Eva" }),
  ];
  const f = (o: Partial<Parameters<typeof filtrarRegistros>[1]>) => filtrarRegistros(rs, { webinar: "", marca: "", q: "", ...o }).map((r) => r.nombre);
  assert.deepEqual(f({ webinar: "2026-09-23" }), ["Ana Pérez", "Beto", "Cris"]);
  assert.deepEqual(f({ webinar: "web_1" }), ["Ana Pérez"]);
  assert.deepEqual(f({ webinar: "sin" }), ["Eva"]);
  assert.deepEqual(f({ webinar: "2026-09-23", marca: "no-unido" }), ["Beto"]);
  assert.deepEqual(f({ webinar: "2026-09-23", marca: "sin-revisar" }), ["Cris"]);
  assert.deepEqual(f({ webinar: "2026-09-23", marca: "sin-contactar" }), ["Ana Pérez", "Cris"]);
  assert.deepEqual(f({ q: "perez" }), ["Ana Pérez"], "sin tildes");
  assert.deepEqual(f({ q: "intermedio" }), ["Cris"], "también en las respuestas");
  const c = contarRegistros(rs.slice(0, 3));
  assert.deepEqual([c.total, c.unidos, c.noUnidos, c.sinRevisar, c.contactados, c.noUnidosContactados], [3, 1, 1, 1, 1, 1]);
});

test("fusionar no pisa las marcas del equipo", () => {
  const ya = R({ email: "a@x.com", grupo: "unido", grupoPor: "Mica", contactado: true, contactadoPor: "Mica", notas: "ya hablamos" });
  const nuevo = R({ email: "a@x.com", grupo: "no-unido", contactado: false, notas: "otra", telefono: "123456789", nombre: "Ana" });
  const r = fusionarRegistro(ya, nuevo);
  assert.equal(r.grupo, "unido"); assert.equal(r.grupoPor, "Mica"); assert.equal(r.notas, "ya hablamos");
  assert.equal(r.contactado, true);
  assert.equal(r.telefono, "123456789"); assert.equal(r.nombre, "Ana");
});
