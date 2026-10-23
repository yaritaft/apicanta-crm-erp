import test from "node:test";
import assert from "node:assert/strict";
import { clasesDe, csvDeDescarga, tablaDeDescarga, type FilaDescarga } from "@/lib/agendas-descarga";
import { NO_SE_PRESENTO, REPROGRAMO } from "@/lib/estados";
import type { Sesion } from "@/lib/types";

/* Bajar las agendas de un webinar para un broadcast (Santi, 23/10): los que no vinieron, los que pidieron otra
   fecha y los que cancelaron, una vez por persona y con el teléfono listo para pegar en WhatsApp. */

const sesion = (p: Partial<Sesion> & { id: string }): Sesion => ({
  titulo: "Llamada", invitado: "Ana Pérez", inicia: "2026-10-22T15:00:00.000Z", duracionMin: 30, estado: "agendada", tipo: "Llamada",
  origen: "calendly", creadoEn: "2026-10-21T12:00:00.000Z", extra: {}, ...p,
});

test("no vino: por el estado de la agenda o por el Estado de Llamada; una cancelada no", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estado: "no-show" })), ["no-vino"]);
  assert.deepEqual(clasesDe(sesion({ id: "b" }), NO_SE_PRESENTO), ["no-vino"]);
  assert.deepEqual(clasesDe(sesion({ id: "c", estado: "cancelada" }), NO_SE_PRESENTO), ["cancelo"]);
});

test("reagendó: pidió otra fecha (Pre-Call), tiene la agenda de después o la cancelaron por reprogramar", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estadoPreCall: "Reagendar" })), ["reagendo"]);
  assert.deepEqual(clasesDe(sesion({ id: "b" }), REPROGRAMO), ["reagendo"]);
  assert.deepEqual(clasesDe(sesion({ id: "c", reprogramadaDe: "x" })), ["reagendo"]);
  /* La vieja, cancelada «Reprogramada», es una reagenda y no una cancelación. */
  assert.deepEqual(clasesDe(sesion({ id: "d", estado: "cancelada", motivoCancelacion: "Reprogramada" })), ["reagendo"]);
});

test("pidió reagendar y no vino: entra en las dos listas", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estado: "no-show", estadoPreCall: "Reagendar" })), ["no-vino", "reagendo"]);
});

test("una agenda normal no es de ninguna lista", () => {
  assert.deepEqual(clasesDe(sesion({ id: "a", estadoPreCall: "Confirmado" })), []);
});

test("la descarga trae una fila por persona (la agenda más nueva), con el teléfono con «+» y la hora argentina", () => {
  const ana = { nombre: "Ana Pérez", email: "ana@mail.com", telefono: "54 9 11 3438-0201", pais: "Argentina" };
  const filas: FilaDescarga[] = [
    { s: sesion({ id: "vieja", contactoId: "c1", estado: "cancelada", motivoCancelacion: "Reprogramada", creadoEn: "2026-10-20T10:00:00.000Z" }), estado: "Cancelada", clases: ["reagendo"], persona: ana },
    { s: sesion({ id: "nueva", contactoId: "c1", reprogramadaDe: "vieja", anfitrion: "Dante", inicia: "2026-10-23T22:00:00.000Z" }), estado: "Por venir", clases: ["reagendo"], persona: ana, extra: ["Después"] },
    { s: sesion({ id: "otra", contactoId: "c2", invitado: "Beto", email: "beto@mail.com", estado: "no-show" }), estado: "Inasistió", clases: ["no-vino"], extra: ["En el vivo"] },
  ];
  const { tabla, personas } = tablaDeDescarga(filas, ["Momento"]);
  assert.equal(personas, 2);
  assert.deepEqual(tabla[0], ["Nombre", "Teléfono", "Email", "País", "Estado de llamada", "Qué pasó", "Closer", "Agendó el", "Llamada el", "Momento"]);
  /* La más próxima primero; Ana quedó con su agenda nueva, no con la cancelada. */
  assert.equal(tabla[1][0], "Ana Pérez");
  assert.equal(tabla[1][1], "+5491134380201");
  assert.equal(tabla[1][2], "ana@mail.com");
  assert.equal(tabla[1][4], "Por venir");
  assert.equal(tabla[1][5], "Reagendaron");
  assert.equal(tabla[1][6], "Dante");
  assert.equal(tabla[1][9], "Después");
  assert.equal(tabla[1][8], "2026-10-23 19:00");
  assert.equal(tabla[2][0], "Beto");
  assert.equal(tabla[2][1], "");
  assert.equal(tabla[2][5], "No vinieron");
});

test("sin persona ni mail, cada agenda es una fila (no se juntan a ciegas)", () => {
  const f = (id: string): FilaDescarga => ({ s: sesion({ id, invitado: id, email: undefined }), estado: "", clases: [] });
  assert.equal(tablaDeDescarga([f("a"), f("b")]).personas, 2);
});

test("el CSV lleva la marca de Excel y comillas donde hacen falta", () => {
  const csv = csvDeDescarga([["Nombre", "Nota"], ["Pérez, Ana", 'dijo "hola"']]);
  assert.ok(csv.startsWith("﻿Nombre,Nota"));
  assert.ok(csv.includes('"Pérez, Ana","dijo ""hola"""'));
});

/* La raíz del pedido de Santi: las agendas de un webinar existían pero no se encontraban. Estas guardas atan los tres caminos
   para que nadie los saque sin darse cuenta. */
import { readFileSync } from "node:fs";
const fuente = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");

test("la lista de Webinars lleva a las agendas del webinar (ancla #agendas que existe en la ficha)", () => {
  assert.match(fuente("src/app/(app)/webinars/page.tsx"), /\/webinars\/\$\{encodeURIComponent\(filtrados\[0\]\.id\)\}#agendas/);
  assert.match(fuente("src/components/webinars/AgendasWebinar.tsx"), /id="agendas"/);
});

test("la tarjeta de agendas del webinar filtra y baja el CSV; la Agenda filtra por webinar y baja el CSV", () => {
  const tarjeta = fuente("src/components/webinars/AgendasWebinar.tsx");
  assert.match(tarjeta, /tablaDeDescarga/);
  for (const c of ["no-vino", "reagendo", "cancelo"]) assert.ok(tarjeta.includes(`"${c}"`) || tarjeta.includes(c), c);
  const agenda = fuente("src/app/(app)/agenda/page.tsx");
  assert.match(agenda, /const FACETAS: Faceta\[\] = \[[^\]]*"webinar"/);
  assert.match(agenda, /tablaDeDescarga/);
});
