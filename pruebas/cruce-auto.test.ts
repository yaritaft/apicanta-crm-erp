import test from "node:test";
import assert from "node:assert/strict";
import { cruceAutomatico, personasDeAgendaYVentas, type DatosCruce } from "@/lib/cruce-auto";
import { nuevoRegistro } from "@/lib/registros-webinar";
import type { Contacto } from "@/lib/types";

/* Ana agendó en Calendly; Beto compró (la venta apunta a su lead y el lead a su contacto); Carla no hizo ninguna de las dos. */
const contactos = [
  { id: "c1", nombre: "Ana Pérez", email: "ana@mail.com", telefono: "+54 9 11 5555 1111", pais: "Argentina" },
  { id: "c2", nombre: "Beto Gómez", email: "beto@mail.com" },
  { id: "c3", nombre: "Carla Ruiz", email: "carla@mail.com" },
] as unknown as Contacto[];
const base = (extra: Partial<DatosCruce> = {}): DatosCruce => ({
  registros: [], contactos,
  sesiones: [{ id: "s1", contactoId: "c1", email: "ana@mail.com", invitado: "Ana Pérez", inicia: "2026-10-10T15:00:00.000Z", estado: "agendada" }] as unknown as DatosCruce["sesiones"],
  leads: [{ id: "l2", contactoId: "c2", nombre: "Beto Gómez", email: "beto@mail.com", telefono: "+54 9 351 444 2222", pais: "Argentina" }],
  ventas: [{ id: "v2", contactoId: "l2", contactoNombre: "Beto Gómez", fecha: "2026-10-12T15:00:00.000Z" }],
  ...extra,
});
const reg = (email: string, extra: Record<string, unknown> = {}) => nuevoRegistro({ email, origen: "excel", registradoEn: "2026-09-01T12:00:00.000Z", ...extra } as never);

test("las personas contra las que se cruza: las que agendaron y las que compraron", () => {
  const ps = personasDeAgendaYVentas(base());
  assert.deepEqual(ps.map((p) => p.id).sort(), ["c1", "c2"]);
  assert.equal(ps.find((p) => p.id === "c2")!.telefono, "+54 9 351 444 2222", "el teléfono del lead completa al contacto que no lo tiene");
});

test("se unen solos los del mismo mail o mismo teléfono, a agenda o a venta; el nombre parecido no", () => {
  const r1 = reg("ana@mail.com", { nombre: "Ana Pérez", adId: "ad_1", webinarId: "w1" });
  const r2 = reg("otro@mail.com", { nombre: "Ana P", telefono: "+54 9 11 5555 1111" });
  const r3 = reg("beto@mail.com", { nombre: "Beto" });
  const r4 = reg("distinto@mail.com", { nombre: "Ana Pérez" });
  const r5 = reg("carla@mail.com", { nombre: "Carla Ruiz" });
  const r6 = reg("nadie@mail.com", { nombre: "Nadie" });
  const res = cruceAutomatico(base({ registros: [r1, r2, r3, r4, r5, r6] }));
  const por = new Map(res.uniones.map((u) => [u.registroId, u]));
  assert.deepEqual([por.get(r1.id)?.contactoId, por.get(r1.id)?.metodo], ["c1", "mail"]);
  assert.deepEqual([por.get(r2.id)?.contactoId, por.get(r2.id)?.metodo], ["c1", "telefono"]);
  assert.deepEqual([por.get(r3.id)?.contactoId, por.get(r3.id)?.metodo], ["c2", "mail"], "el que compró también cuenta");
  assert.equal(por.has(r4.id), false, "un nombre parecido es dudoso: lo ve una persona");
  assert.equal(res.dudosas, 1);
  assert.equal(por.has(r5.id) || por.has(r6.id), false, "quien no agendó ni compró no se une");
});

test("un registro ya unido (solo o a mano) no se toca", () => {
  const ya = reg("ana@mail.com", { contactoId: "c9", cruce: "manual" });
  const res = cruceAutomatico(base({ registros: [ya] }));
  assert.deepEqual(res.uniones, []);
});

test("el contacto hereda del primer formulario que llenó: anuncio y webinar, sin pisar lo que ya tiene", () => {
  const primero = reg("ana@mail.com", { registradoEn: "2026-08-01T12:00:00.000Z", adId: "ad_1", webinarId: "w1", pais: "Chile" });
  const segundo = reg("ana@mail.com", { fechaWebinar: "2026-09-02", registradoEn: "2026-09-01T12:00:00.000Z", adId: "ad_2", webinarId: "w2" });
  const res = cruceAutomatico(base({ registros: [segundo, primero] }));
  assert.equal(res.uniones.length, 2, "los dos registros se atan a Ana");
  const h = res.herencias.find((x) => x.contactoId === "c1")!;
  assert.deepEqual(h.cambios, { origenAdId: "ad_1", origenWebinarId: "w1" }, "el primero llena los huecos; el país ya lo tenía");
});

test("sin nada que cruzar, no hace nada", () => {
  const res = cruceAutomatico(base({ registros: [reg("nadie@mail.com")] }));
  assert.deepEqual([res.uniones.length, res.herencias.length, res.dudosas], [0, 0, 0]);
});
