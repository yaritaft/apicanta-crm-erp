import test from "node:test";
import assert from "node:assert/strict";
import { candidatosDe, cruzarRegistros, herenciaDeFormulario, mismoNombre, personasDeAgenda } from "@/lib/cruce-formularios";
import { nuevoRegistro, type RegistroForm } from "@/lib/registros-webinar";
import type { Contacto, Sesion } from "@/lib/types";

const contacto = (id: string, nombre: string, email: string, telefono?: string, extra: Partial<Contacto> = {}): Contacto =>
  ({ id, nombre, email, telefono, creadoEn: "2026-09-20T00:00:00.000Z", extra: {}, ...extra });
const sesion = (id: string, contactoId: string | undefined, invitado: string, email: string, inicia = "2026-09-25T15:00:00.000Z"): Sesion =>
  ({ id, titulo: "Llamada", invitado, email, contactoId, inicia, duracionMin: 30, estado: "agendada", tipo: "llamada", origen: "calendly", creadoEn: inicia, extra: {} });
const reg = (o: Partial<RegistroForm> & { email: string }) => nuevoRegistro({ fechaWebinar: "2026-09-23", ...o });

/* Lo que Yari cuenta: el mismo teléfono con otro nombre y otro mail. */
const contactos = [
  contacto("c1", "Ana Pérez", "ana@mail.com", "+54 9 11 5123-4567", { pais: "Argentina" }),
  contacto("c2", "Juan Carlos Gómez", "jcgomez@mail.com", "+57 300 123 4567"),
  contacto("c3", "Maria Lopez", "maria.lopez@mail.com", "11 4444 5555"),
  contacto("c4", "Maria Lopez", "marialopez2@mail.com", "351 612 3456"),
  contacto("c5", "Pre-lead", "pre@mail.com"),
];
const sesiones = [
  sesion("s1", "c1", "Ana Pérez", "ana@mail.com"), sesion("s2", "c2", "Juan Carlos Gómez", "jcgomez@mail.com"),
  sesion("s3", "c3", "Maria Lopez", "maria.lopez@mail.com"), sesion("s4", "c4", "Maria Lopez", "marialopez2@mail.com"),
];
const personas = personasDeAgenda(contactos, sesiones);

test("las personas de la agenda: una por contacto, sin los que nunca agendaron", () => {
  assert.deepEqual(personas.map((p) => p.contactoId).sort(), ["c1", "c2", "c3", "c4"]);
});

test("1. mail: segura", () => {
  const [c] = candidatosDe(reg({ email: "ANA@mail.com", nombre: "Otra" }), personas);
  assert.equal(c.metodo, "mail"); assert.equal(c.segura, true); assert.equal(c.persona.contactoId, "c1");
});

test("2. teléfono: el mismo celular con otro mail y otro nombre, con y sin +54, 9, 0 y 15", () => {
  for (const tel of ["011 15 5123-4567", "+5491151234567", "11 5123 4567", "(011) 5123 4567"]) {
    const [c] = candidatosDe(reg({ email: "otro@gmail.com", nombre: "Anita P.", telefono: tel, pais: "Argentina" }), personas);
    assert.equal(c.persona.contactoId, "c1", tel);
    assert.equal(c.metodo, "telefono"); assert.equal(c.segura, true);
  }
});

test("3 y 4. teléfono sin código de área: seguro con el mismo nombre, dudoso solo", () => {
  const solo = candidatosDe(reg({ email: "x@x.com", nombre: "Fulano", telefono: "5123-4567", pais: "Argentina" }), personas);
  assert.equal(solo.length, 1);
  assert.equal(solo[0].segura, false, "puede ser de otra zona");
  const conNombre = candidatosDe(reg({ email: "x@x.com", nombre: "Pérez Ana", telefono: "5123-4567", pais: "Argentina" }), personas);
  assert.equal(conNombre[0].segura, true);
});

test("5. nombre: dudoso, nunca se une solo; con un homónimo hay dos candidatos para revisar", () => {
  const cs = candidatosDe(reg({ email: "ml@x.com", nombre: "Maria López" }), personas);
  assert.deepEqual(cs.map((c) => [c.persona.contactoId, c.metodo, c.segura]).sort(), [["c3", "nombre", false], ["c4", "nombre", false]]);
  assert.equal(mismoNombre("Juan", "Juan Pérez"), false, "una sola palabra no alcanza");
  assert.equal(mismoNombre("Juan Gómez", "Juan Carlos Gómez"), true);
  assert.equal(mismoNombre("Gómez, Juan Carlos", "juan carlos gomez"), true);
});

test("«No es» descarta: no se vuelve a proponer", () => {
  const r = reg({ email: "ml@x.com", nombre: "Maria López", descartados: ["c3"] });
  assert.deepEqual(candidatosDe(r, personas).map((c) => c.persona.contactoId), ["c4"]);
});

test("cruzar muchos: el índice trae lo mismo y separa seguras de dudosas", () => {
  const registros = [
    reg({ email: "ana@mail.com", nombre: "Ana" }),
    reg({ email: "otro@gmail.com", nombre: "Anita", telefono: "+57 300 123 4567" }),
    reg({ email: "ml@x.com", nombre: "Maria López" }),
    reg({ email: "nadie@x.com", nombre: "Nadie Conocido", telefono: "+34 612 34 56 78" }),
  ];
  const r = cruzarRegistros(registros, personas);
  assert.equal(r.length, 3, "el cuarto no se parece a nadie");
  assert.equal(r[0].segura?.persona.contactoId, "c1");
  assert.equal(r[1].segura?.persona.contactoId, "c2"); assert.equal(r[1].segura?.metodo, "telefono");
  assert.equal(r[2].segura, undefined); assert.equal(r[2].dudosas.length, 2);
});

test("al unir, el contacto de la agenda hereda el anuncio y los UTMs de la pauta sin perder lo suyo", () => {
  const c = contacto("c1", "Ana", "ana@mail.com", undefined, { utm: { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260923" } });
  const r = reg({
    email: "ana2@mail.com", telefono: "+54 9 11 5123-4567", pais: "Argentina", adId: "ad_120211111111111", webinarId: "web_1",
    utm: { utm_source: "meta", utm_medium: "paid", utm_content: "120211111111111" },
  });
  const h = herenciaDeFormulario(c, r)!;
  assert.equal(h.telefono, "+54 9 11 5123-4567"); assert.equal(h.origenAdId, "ad_120211111111111");
  assert.equal(h.utm?.utm_source, "meta", "la pauta es lo que atribuye la venta");
  assert.deepEqual(h.extra?.utmAgenda, { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260923" }, "los de la agenda quedan guardados");
  /* Si ya tiene pauta o ya tiene todo, no se toca. */
  assert.equal(herenciaDeFormulario({ ...c, ...h } as Contacto, r), null);
  const conPauta = contacto("c9", "X", "x@x.com", "1", { pais: "AR", origenAdId: "ad_1", origenWebinarId: "w", utm: { utm_source: "meta", utm_medium: "paid" } });
  assert.equal(herenciaDeFormulario(conPauta, r), null);
});
