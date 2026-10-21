import test from "node:test";
import assert from "node:assert/strict";
import { csvDe } from "@/lib/csv";
import {
  COLUMNAS_GRUPOS, COLUMNAS_INTEGRANTES, csvDeGrupos, csvDeIntegrantes, csvParaManyChat, filasDeGrupos, filasDeIntegrantes, ORDEN_GRUPOS_POR_DEFECTO,
  personasPorTelefono, SIN_WEBINAR, totalesDeGrupos, totalesDeIntegrantes,
} from "@/lib/grupos-whatsapp";
import { ordenarFilas, pasaFiltros } from "@/lib/tabla-filtros";
import type { GrupoWhatsapp, MiembroWhatsapp } from "@/lib/whatsapp";

const g = (id: string, nombre: string, webinarId: string | null, sinTelefono = 0): GrupoWhatsapp => ({ id, nombre, webinarId, miembros: 0, sinTelefono, ultimaFoto: "2026-10-21T01:48:16.820Z" });
const m = (grupoId: string, telefono: string, dentro: boolean, extra: Partial<MiembroWhatsapp> = {}): MiembroWhatsapp => ({ grupoId, telefono, dentro, entro: null, salio: null, ...extra });
const webinars = [{ id: "w1", titulo: "Taller 21/10/2026", fecha: "2026-10-21T22:00:00.000Z" }];
const grupos = [g("g1", "Taller Online 21/10/26 #1", "w1", 3), g("g2", "Taller Online 21/10/26 #2", "w1"), g("g3", "Taller online 13/05/26", null), g("g4", "Grupo vacío", null)];
const miembros: MiembroWhatsapp[] = [
  m("g1", "5491155551111", true), m("g1", "5491155552222", true, { entro: "2026-10-20T15:00:00.000Z" }), m("g1", "5491155553333", false, { salio: "2026-10-21T02:00:00.000Z" }),
  m("g1", "573001234567", true), m("g2", "5491155554444", true), m("g2", "5491155555555", false, { salio: "2026-10-20T20:00:00.000Z" }),
  m("g3", "5215512345678", false, { salio: "2026-05-14T12:00:00.000Z" }),
];

test("cada grupo: cuántos hay hoy, cuántos entraron (los de hoy más los que salieron), cuántos salieron y la retención", () => {
  const f = Object.fromEntries(filasDeGrupos(grupos, miembros, webinars).map((x) => [x.id, x]));
  assert.deepEqual([f.g1.dentro, f.g1.entraron, f.g1.salieron, Math.round(f.g1.retencion!)], [3, 4, 1, 75]);
  assert.deepEqual([f.g2.dentro, f.g2.entraron, f.g2.salieron, Math.round(f.g2.retencion!)], [1, 2, 1, 50]);
  assert.deepEqual([f.g3.dentro, f.g3.entraron, f.g3.salieron, f.g3.retencion], [0, 1, 1, 0], "si todos salieron la retención es 0");
  assert.equal(f.g4.retencion, null, "un grupo sin nadie no tiene retención");
  assert.equal(f.g1.sinTelefono, 3, "los que WhatsApp esconde van aparte");
  assert.equal(f.g1.webinar, "21/10/2026", "el título que ya dice la fecha no se repite");
  assert.equal(filasDeGrupos([g("gx", "x", "w2")], [], [{ id: "w2", titulo: "Masterclass de cierre", fecha: "2026-10-28T22:00:00.000Z" }])[0].webinar, "28/10/2026 · Masterclass de cierre");
  assert.equal(f.g3.webinar, SIN_WEBINAR);
});

test("los totales del pie: la retención es la de todos juntos, no el promedio de los porcentajes", () => {
  const t = totalesDeGrupos(filasDeGrupos(grupos, miembros, webinars));
  assert.deepEqual([t.grupos, t.webinars, t.sinWebinar, t.dentro, t.entraron, t.salieron, t.sinTelefono], [4, 1, 2, 4, 7, 3, 3]);
  assert.equal(t.total, t.dentro + t.sinTelefono, "«En WhatsApp»: los que se ven con teléfono más los de número oculto");
  assert.equal(Math.round(t.retencion!), 57, "4 de 7");
  assert.equal(totalesDeGrupos([]).retencion, null);
});

test("filtrar y ordenar los grupos como en Excel, y el CSV de lo que se ve", () => {
  const filas = filasDeGrupos(grupos, miembros, webinars);
  const sinWebinar = filas.filter((x) => pasaFiltros(COLUMNAS_GRUPOS, x, { webinar: { modo: "solo", valores: [SIN_WEBINAR] } }));
  assert.deepEqual(sinWebinar.map((x) => x.id), ["g3", "g4"]);
  assert.deepEqual(ordenarFilas(COLUMNAS_GRUPOS, filas, [{ clave: "dentro", desc: true }]).map((x) => x.id).slice(0, 2), ["g1", "g2"]);
  assert.deepEqual(ordenarFilas(COLUMNAS_GRUPOS, filas, ORDEN_GRUPOS_POR_DEFECTO).map((x) => x.id), ["g1", "g2", "g4", "g3"], "los del webinar más nuevo primero y los sin webinar al final");
  const csv = csvDeGrupos(filas.slice(0, 1)).split("\r\n");
  assert.equal(csv[0], '"Grupo","Webinar","Integrantes","En WhatsApp","Entraron","Salieron","Retención %","Sin teléfono","Última lectura"');
  assert.equal(csv[1], '"Taller Online 21/10/26 #1","21/10/2026","3","6","4","1","75","3","2026-10-20"', "la fecha es la del día del negocio (Argentina)");
});

test("los integrantes: estado, a qué grupo y webinar pertenecen, y el nombre si el teléfono es de alguien que se anotó", () => {
  const personas = personasPorTelefono([
    { nombre: "Ana Pérez", email: "ana@mail.com", telefono: "+54 9 11 5555 1111", pais: "Argentina" },
    { nombre: "", email: "beto@mail.com", telefono: "011 15 5555-2222", pais: "Argentina" },
    { nombre: "Sin teléfono", email: "x@mail.com", telefono: "", pais: "" },
  ]);
  const filas = filasDeIntegrantes(miembros, grupos, webinars, personas);
  const por = Object.fromEntries(filas.map((x) => [x.telefono, x]));
  assert.equal(por["5491155551111"].persona, "Ana Pérez");
  assert.equal(por["5491155552222"].persona, "beto@mail.com", "sin nombre, el mail");
  assert.equal(por["573001234567"].persona, "");
  assert.deepEqual([por["5491155553333"].estado, por["5491155551111"].estado], ["Salió", "Dentro"]);
  assert.equal(por["5215512345678"].webinar, SIN_WEBINAR);
  assert.equal(new Set(filas.map((x) => x.id)).size, filas.length, "cada integrante es único por grupo y teléfono");
  const t = totalesDeIntegrantes(filas);
  assert.deepEqual([t.total, t.dentro, t.salieron, t.grupos, t.conNombre], [7, 4, 3, 3, 2]);
  const quienesSalieron = filas.filter((x) => pasaFiltros(COLUMNAS_INTEGRANTES, x, { estado: { modo: "solo", valores: ["Salió"] } }));
  assert.equal(quienesSalieron.length, 3);
  const csv = csvDeIntegrantes(quienesSalieron.slice(0, 1)).split("\r\n");
  assert.match(csv[1], /^"\+5491155553333","","Taller Online 21\/10\/26 #1","21\/10\/2026","Salió","","2026-10-20"$/);
});

test("el CSV para ManyChat: nombre, apellido, teléfono con «+», mail y país; los sin teléfono se cuentan", () => {
  const r = csvParaManyChat([
    { nombre: "Ana María Pérez", email: "ana@mail.com", telefono: "011 15 5555-1111", pais: "Argentina", fechaWebinar: "2026-10-21" },
    { nombre: "Beto", email: "beto@mail.com", telefono: "", pais: "México", fechaWebinar: "2026-10-21" },
  ]);
  const filas = r.texto.split("\r\n");
  assert.equal(filas[0], '"First Name","Last Name","Phone","Email","Country","Webinar"');
  assert.match(filas[1], /^"Ana","María Pérez","\+54911\d{8}","ana@mail.com","Argentina","2026-10-21"$/);
  assert.equal(filas[2], '"Beto","","","beto@mail.com","México","2026-10-21"');
  assert.equal(r.sinTelefono, 1);
});

test("el CSV protege las comillas y no deja que Excel ejecute una fórmula", () => {
  const t = csvDe(["a", "b"], [['dijo "hola"', "=SUMA(1;2)"], ["+5491155551111", "-3"], [null, "línea\ncon salto"]]).split("\r\n");
  assert.equal(t[1], '"dijo ""hola""","\'=SUMA(1;2)"');
  assert.equal(t[2], '"+5491155551111","-3"', "un teléfono con «+» o un número negativo no se tocan");
  assert.equal(t[3], '"","línea\ncon salto"');
});

test("«En WhatsApp» de cada grupo es lo que cuenta WhatsApp: los que se ven con teléfono más los de número oculto", () => {
  const f = Object.fromEntries(filasDeGrupos(grupos, miembros, webinars).map((x) => [x.id, x]));
  /* El #1 del 21/10 de producción: 766 con teléfono y 98 ocultos = 864, no 766. */
  assert.equal(f.g1.total, f.g1.dentro + f.g1.sinTelefono);
  assert.ok(f.g1.total > f.g1.dentro, "el grupo de prueba tiene integrantes ocultos");
  const g = filasDeGrupos([{ id: "a", nombre: "Taller", webinarId: null, miembros: 766, sinTelefono: 98, ultimaFoto: null }], [], [])[0];
  assert.equal(g.total, 98, "sin filas de miembros no hay teléfonos que contar: sólo se suman los ocultos");
});
