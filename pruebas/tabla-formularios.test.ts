import test from "node:test";
import assert from "node:assert/strict";
import { columnasDeFormularios, columnasPorClave, calcular, calculosAURL, calculosDeURL, calculoValido, opcionesDeCalculo, ORDEN_FORM_POR_DEFECTO } from "@/lib/formularios-tabla";
import { filtroAURL, filtrosDeURL, opcionesDeColumna, ordenarFilas, ordenesAURL, ordenesDeURL, pasaFiltros } from "@/lib/tabla-filtros";
import { nuevoRegistro, type RegistroForm } from "@/lib/registros-webinar";

/* Cinco registros del webinar del 21/10: Ana (unida, con teléfono, de Argentina, con anuncio), Beto (no unido, sin teléfono),
   Carla (sin revisar, contactada, México), Dani (sin país), Eli (de la hoja del Excel, con agenda). */
const reg = (email: string, extra: Partial<RegistroForm> = {}) => nuevoRegistro({ email, origen: "landing", registradoEn: "2026-10-20T15:00:00.000Z", ...extra } as never);
const filas: RegistroForm[] = [
  reg("ana@mail.com", { nombre: "Ana Pérez", telefono: "+54 9 11 5555 1111", pais: "Argentina", grupo: "unido", registradoEn: "2026-10-20T15:00:00.000Z", adId: "ad1" }),
  reg("beto@mail.com", { nombre: "Beto Gómez", pais: "Argentina", grupo: "no-unido", registradoEn: "2026-10-21T02:00:00.000Z" }),
  reg("carla@mail.com", { nombre: "Carla Ruiz", telefono: "+52 55 1234 5678", pais: "México", contactado: true, registradoEn: "2026-10-19T12:00:00.000Z", utm: { utm_source: "meta", utm_content: "Anuncio | Copia 2" } }),
  reg("dani@mail.com", { registradoEn: "2026-10-18T12:00:00.000Z" }),
  reg("eli@mail.com", { nombre: "Eli Sosa", pais: "Perú", origen: "excel", origenDetalle: "Leads 211026", contactoId: "c9", respuestas: [{ pregunta: "¿Experiencia?", respuesta: "Junior" }], registradoEn: "2026-10-17T12:00:00.000Z" }),
];
const cols = columnasDeFormularios({ anuncioDe: (r) => (r.adId === "ad1" ? "Anuncio Uno" : "") });
const porClave = columnasPorClave(cols);
const emails = (rs: RegistroForm[]) => rs.map((r) => r.email.split("@")[0]);

test("filtros como en Excel: sólo, sin, contiene, desde/hasta; una fila con varios valores se ve con cualquiera", () => {
  const f = (clave: string, fc: object) => filas.filter((r) => pasaFiltros(porClave, r, { [clave]: { modo: "solo", valores: [], ...fc } }));
  assert.deepEqual(emails(f("pais", { valores: ["Argentina"] })), ["ana", "beto"]);
  assert.deepEqual(emails(f("pais", { modo: "sin", valores: ["Argentina"] })), ["carla", "dani", "eli"]);
  assert.deepEqual(emails(f("nombre", { contiene: "perez" })), ["ana"], "contiene ignora tildes y mayúsculas");
  assert.deepEqual(emails(f("nombre", { noContiene: "perez" })), ["beto", "carla", "dani", "eli"]);
  assert.deepEqual(emails(f("registro", { desde: "2026-10-19", hasta: "2026-10-20" })), ["ana", "beto", "carla"], "Beto se anotó a las 23 del 20 en Argentina (ya es 21 en UTC): cuenta por el día del negocio");
  assert.deepEqual(emails(f("utm", { valores: ["source: meta"] })), ["carla"]);
  assert.deepEqual(emails(f("pais", { valores: ["(Vacías)"] })), ["dani"]);
});

test("las opciones de una columna cuentan según los DEMÁS filtros, y lo elegido sigue aunque no quede nada", () => {
  const sin = opcionesDeColumna(porClave, filas, {}, "pais");
  assert.deepEqual(sin, [{ valor: "Argentina", cuenta: 2 }, { valor: "México", cuenta: 1 }, { valor: "Perú", cuenta: 1 }, { valor: "(Vacías)", cuenta: 1 }]);
  const conOtro = opcionesDeColumna(porClave, filas, { grupo: { modo: "solo", valores: ["Unido"] }, pais: { modo: "solo", valores: ["México"] } }, "pais");
  assert.deepEqual(conOtro, [{ valor: "Argentina", cuenta: 1 }, { valor: "México", cuenta: 0 }], "el filtro del propio país no recorta su lista");
});

test("los filtros viajan en el link, también con «|» adentro del valor, y sólo de columnas que existen", () => {
  const escrito = Object.entries(filtroAURL("utm", { modo: "solo", valores: ["content: Anuncio | Copia 2", "source: meta"] })).filter(([, v]) => v !== null) as [string, string][];
  const u = new URLSearchParams([...escrito, ["solo-inventada", "x"], ["desde-pais", "2026-10-01"]]);
  const leidos = filtrosDeURL(porClave, u);
  assert.deepEqual(leidos.utm, { modo: "solo", valores: ["content: Anuncio | Copia 2", "source: meta"] });
  assert.equal("inventada" in leidos, false);
  assert.equal("pais" in leidos, false, "un desde/hasta en una columna que no es de fechas no vale");
  assert.deepEqual(emails(filas.filter((r) => pasaFiltros(porClave, r, leidos))), ["carla"]);
});

test("ordenar: por una o varias columnas, lo vacío al final, y el link guarda sólo lo que no es el orden de siempre", () => {
  assert.deepEqual(emails(ordenarFilas(porClave, filas, ORDEN_FORM_POR_DEFECTO)), ["beto", "ana", "carla", "dani", "eli"], "lo más nuevo primero");
  assert.deepEqual(emails(ordenarFilas(porClave, filas, [{ clave: "pais", desc: false }, { clave: "nombre", desc: true }])), ["beto", "ana", "carla", "eli", "dani"], "Argentina (por nombre de Z a A), México, Perú y el vacío al final");
  assert.equal(ordenesAURL(ORDEN_FORM_POR_DEFECTO, ORDEN_FORM_POR_DEFECTO), null);
  assert.equal(ordenesAURL([{ clave: "pais", desc: false }, { clave: "registro", desc: true }], ORDEN_FORM_POR_DEFECTO), "pais,-registro");
  assert.deepEqual(ordenesDeURL(porClave, "pais,-registro,inventada,pais", ORDEN_FORM_POR_DEFECTO), [{ clave: "pais", desc: false }, { clave: "registro", desc: true }]);
  assert.deepEqual(ordenesDeURL(porClave, "", ORDEN_FORM_POR_DEFECTO), ORDEN_FORM_POR_DEFECTO);
});

test("los cálculos del pie: filas, con dato, sin dato, porcentajes, distintos, rango y un valor en particular", () => {
  const c = (clave: string, calculo: string) => calcular(porClave[clave], filas, calculo);
  assert.deepEqual(c("nombre", "contar"), { etiqueta: "Filas", valor: "5" });
  assert.deepEqual(c("telefono", "llenos"), { etiqueta: "Con teléfono", valor: "2", sub: "40%" });
  assert.deepEqual(c("telefono", "vacios"), { etiqueta: "Sin dato", valor: "3", sub: "60%" });
  assert.deepEqual(c("telefono", "pct-llenos"), { etiqueta: "% con dato", valor: "40%" });
  assert.deepEqual(c("pais", "unicos"), { etiqueta: "Distintos", valor: "3" }, "sin contar el vacío");
  assert.deepEqual(c("registro", "rango"), { etiqueta: "Rango", valor: "17/10 al 20/10" }, "Beto se anotó a las 23 del 20 en Argentina: es del 20");
  assert.deepEqual(c("grupo", "valor:Unido"), { etiqueta: "Unido", valor: "1", sub: "20%" });
  assert.deepEqual(c("grupo", "valor:Sin revisar"), { etiqueta: "Sin revisar", valor: "3", sub: "60%" });
  assert.deepEqual(c("contactado", "valor:Contactado"), { etiqueta: "Contactado", valor: "1", sub: "20%" });
  assert.deepEqual(c("agenda", "valor:Con agenda"), { etiqueta: "Con agenda", valor: "1", sub: "20%" });
  assert.deepEqual(c("anuncio", "llenos"), { etiqueta: "Con anuncio", valor: "1", sub: "20%" });
  assert.equal(c("pais", "ninguno"), null);
});

test("el pie sigue lo que se ve: sin filas no rompe, y con otras filas cambia", () => {
  assert.deepEqual(calcular(porClave.telefono, [], "llenos"), { etiqueta: "Con teléfono", valor: "0", sub: "—" });
  assert.deepEqual(calcular(porClave.registro, [], "rango"), { etiqueta: "Rango", valor: "—" });
  assert.deepEqual(calcular(porClave.grupo, filas.slice(0, 1), "valor:Unido"), { etiqueta: "Unido", valor: "1", sub: "100%" });
});

test("cada columna arranca con su cálculo; uno que no existe para ella vuelve al de entrada; y la elección viaja en el link", () => {
  assert.equal(porClave.grupo.calculo, "valor:Unido");
  assert.equal(calculoValido(porClave.grupo, "rango"), "valor:Unido", "«rango» es sólo de columnas de fechas");
  assert.equal(calculoValido(porClave.registro, "rango"), "rango");
  assert.ok(opcionesDeCalculo(porClave.grupo).some((o) => o.id === "valor:No unido"));
  assert.ok(!opcionesDeCalculo(porClave.pais).some((o) => o.id.startsWith("valor:")));
  assert.equal(calculosAURL(cols, {}), null);
  assert.equal(calculosAURL(cols, { grupo: "valor:Unido", telefono: "vacios", pais: "unicos" }), "telefono=vacios", "lo que no cambió no se escribe");
  assert.deepEqual(calculosDeURL(cols, "telefono=vacios,grupo=valor:No unido,inventada=contar,pais=valor:Argentina"), { telefono: "vacios", grupo: "valor:No unido", pais: "unicos" });
});
