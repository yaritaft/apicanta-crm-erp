import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  datosDeLaPersona, normalizarEmail, normalizarNombre, normalizarTelefono, paisParaMeta, sha256,
} from "@/lib/capi-datos";
import {
  evaluarRegistro, eventosDeRegistro, idEventoCalificado, type RegistroParaMeta,
} from "@/lib/capi-registro";
import { estadoCapi, nombreEventoCalificado } from "@/lib/capi-estado";
import { eventoParaMeta } from "@/lib/meta-capi";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/* ---------- Normalizar y hashear ---------- */

test("el mail se normaliza (sin espacios, en minúsculas) y un mail roto no pasa", () => {
  assert.equal(normalizarEmail("  Ana.Perez@Gmail.COM "), "ana.perez@gmail.com");
  assert.equal(normalizarEmail("ana@"), "");
  assert.equal(normalizarEmail(undefined), "");
});

test("el teléfono queda en dígitos con código de país, sin +, 00 ni ceros de más", () => {
  assert.equal(normalizarTelefono("+54 9 11 5555-1234"), "5491155551234");
  assert.equal(normalizarTelefono("0054 9 11 5555 1234"), "5491155551234");
  assert.equal(normalizarTelefono("(+52) 55 1234 5678"), "525512345678");
  assert.equal(normalizarTelefono("abc"), "");
  assert.equal(normalizarTelefono("1234"), "", "muy corto para ser un teléfono");
  assert.equal(normalizarTelefono("+54 9 11 5555 1234 99999"), "", "más de 15 dígitos");
});

test("un número nacional recibe el código del país de la persona, y uno que ya lo trae no se duplica", () => {
  assert.equal(normalizarTelefono("55 1234 5678", "México"), "525512345678");
  assert.equal(normalizarTelefono("525512345678", "MX"), "525512345678");
  assert.equal(normalizarTelefono("099 123 456", "Uruguay"), "59899123456");
  /* Sin país no se adivina: queda como está. */
  assert.equal(normalizarTelefono("1155551234"), "1155551234");
  /* Un «+» es un número internacional: no se le pone nada. */
  assert.equal(normalizarTelefono("+34 612 345 678", "Argentina"), "34612345678");
});

test("el nombre: primer nombre y último apellido, en minúsculas y sin tildes ni signos", () => {
  assert.deepEqual(normalizarNombre("  María José  Pérez-Gómez de la Cruz "), { nombre: "maria", apellido: "cruz" });
  assert.deepEqual(normalizarNombre("Ana"), { nombre: "ana", apellido: "" });
  assert.deepEqual(normalizarNombre("D'Angelo, Luis"), { nombre: "d'angelo", apellido: "luis" });
  assert.deepEqual(normalizarNombre(""), { nombre: "", apellido: "" });
});

test("el país sale como código ISO en minúsculas, venga como venga", () => {
  assert.equal(paisParaMeta("Argentina"), "ar");
  assert.equal(paisParaMeta("MX"), "mx");
  assert.equal(paisParaMeta("Rosario, Argentina"), "ar");
  assert.equal(paisParaMeta(""), "");
});

test("user_data: lo personal va con SHA-256 de lo normalizado y lo técnico va tal cual", () => {
  const u = datosDeLaPersona({
    email: " Ana@Mail.com ", telefono: "+54 9 11 5555-1234", nombre: "Ana Pérez", pais: "Argentina",
    externalId: "con_1", ip: "190.1.2.3", userAgent: "Mozilla/5.0", fbp: "fb.1.1.123", fbc: "fb.1.1.abc",
  });
  assert.deepEqual(u.em, [hash("ana@mail.com")]);
  assert.deepEqual(u.ph, [hash("5491155551234")]);
  assert.deepEqual(u.fn, [hash("ana")]);
  assert.deepEqual(u.ln, [hash("perez")]);
  assert.deepEqual(u.country, [hash("ar")]);
  assert.deepEqual(u.external_id, [hash("con_1")]);
  assert.equal(u.client_ip_address, "190.1.2.3");
  assert.equal(u.client_user_agent, "Mozilla/5.0");
  assert.equal(u.fbp, "fb.1.1.123");
  assert.equal(u.fbc, "fb.1.1.abc");
  /* Nada personal viaja en claro. */
  const crudo = JSON.stringify(u);
  assert.ok(!crudo.includes("ana@mail.com") && !crudo.includes("5491155551234") && !crudo.includes("perez"));
});

test("la misma persona da el mismo hash escrita de formas distintas", () => {
  const a = datosDeLaPersona({ email: "ANA@mail.com", telefono: "+54 9 11 5555-1234" });
  const b = datosDeLaPersona({ email: " ana@mail.com", telefono: "5491155551234" });
  assert.deepEqual(a, b);
  assert.equal(sha256("x"), hash("x"));
});

test("un dato inválido no viaja y una persona sin nada reconocible no genera evento", () => {
  const u = datosDeLaPersona({ email: "no-es-mail", telefono: "123", pais: "???" });
  assert.deepEqual(u, {});
  assert.equal(eventoParaMeta({ nombre: "Lead", id: "x", cuando: "2026-10-07T12:00:00Z", persona: { email: "no-es-mail" } }), null);
});

/* ---------- Quién califica ---------- */

const R = (pregunta: string, respuesta: string) => ({ pregunta, respuesta });
const CALIFICA = [
  R("inversion", "Puedo invertir en mí de 1000 a 2000 USD"),
  R("nivel_ingles", "Conversacional aunque cometo errores"),
  R("formacion", "Universitaria completa"),
];

test("califica quien cumple inversión, inglés y carrera, aunque la pregunta sea el nombre del campo", () => {
  const ev = evaluarRegistro(CALIFICA);
  assert.deepEqual(ev, { calificada: true, inversion: "si", ingles: "si", carrera: "si" });
});

test("con una sola regla que no cumple, no califica", () => {
  assert.equal(evaluarRegistro([CALIFICA[0], R("nivel_ingles", "Básico"), CALIFICA[2]]).calificada, false);
  assert.equal(evaluarRegistro([R("inversion", "Menos de 600 USD"), CALIFICA[1], CALIFICA[2]]).calificada, false);
  assert.equal(evaluarRegistro([CALIFICA[0], CALIFICA[1], R("formacion", "Autodidacta")]).calificada, false);
});

test("si la landing no pregunta algo, no califica: sin dato no alcanza", () => {
  const sin = evaluarRegistro([CALIFICA[1], CALIFICA[2]]);
  assert.equal(sin.calificada, false);
  assert.equal(sin.inversion, "sin-dato");
  assert.equal(evaluarRegistro([]).calificada, false);
});

/* ---------- El id y los eventos ---------- */

const registro = (extra: Partial<RegistroParaMeta> = {}): RegistroParaMeta => ({
  registroId: "reg_0123456789abcdef", cuando: "2026-10-07T15:00:00.000Z", pagina: "https://landing.com/webinar?x=1",
  webinarId: "web_1007", utm: { utm_source: "meta", utm_campaign: "webinar_20261007", utm_content: "ad_angulo_1" },
  respuestas: CALIFICA, persona: { email: "ana@mail.com", nombre: "Ana Pérez", pais: "Argentina", ip: "190.1.2.3" },
  ...extra,
});

test("el id del evento calificado es estable: el mismo registro da siempre el mismo id", () => {
  assert.equal(idEventoCalificado("reg_0123456789abcdef"), "rcal_0123456789abcdef");
  assert.equal(idEventoCalificado("reg_0123456789abcdef"), idEventoCalificado("reg_0123456789abcdef"));
  assert.notEqual(idEventoCalificado("reg_aaaa"), idEventoCalificado("reg_bbbb"));
  const a = eventosDeRegistro(registro(), {});
  const b = eventosDeRegistro(registro(), {});
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
});

test("quien califica genera Lead y RegistroCalificado, con UTMs, webinar y criterios", () => {
  const [lead, cal] = eventosDeRegistro(registro(), {});
  assert.equal(lead.nombre, "Lead");
  assert.equal(lead.id, "reg_0123456789abcdef");
  assert.equal(cal.nombre, "RegistroCalificado");
  assert.equal(cal.id, "rcal_0123456789abcdef");
  assert.notEqual(cal.id, lead.id, "no se pisan entre sí en Meta");
  assert.deepEqual(cal.datos, {
    utm_source: "meta", utm_campaign: "webinar_20261007", utm_content: "ad_angulo_1",
    webinar: "web_1007", calificado: "si", inversion: "si", ingles: "si", carrera: "si",
  });
  assert.equal(cal.url, "https://landing.com/webinar?x=1");
});

test("lo que escribió en crudo no viaja a Meta (la inversión es dato financiero)", () => {
  const eventos = eventosDeRegistro(registro(), {});
  const todo = JSON.stringify(eventos.map((x) => eventoParaMeta(x)));
  assert.ok(!/1000 a 2000|Conversacional|Universitaria/.test(todo));
});

test("quien no califica sólo genera el Lead, marcado como no calificado", () => {
  const eventos = eventosDeRegistro(registro({ respuestas: [CALIFICA[0], R("nivel_ingles", "Básico"), CALIFICA[2]] }), {});
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].nombre, "Lead");
  assert.equal(eventos[0].datos?.calificado, "no");
});

test("el Lead usa el id del píxel de la landing si lo manda (para que Meta no cuente doble)", () => {
  const [lead, cal] = eventosDeRegistro(registro({ idLead: "ev_pixel_77" }), {});
  assert.equal(lead.id, "ev_pixel_77");
  assert.equal(cal.id, "rcal_0123456789abcdef");
});

test("el nombre del evento se puede cambiar por variable, pero sólo con un nombre que Meta acepta", () => {
  assert.equal(nombreEventoCalificado({}), "RegistroCalificado");
  assert.equal(nombreEventoCalificado({ META_CAPI_EVENTO_CALIFICADO: "Registro_Calificado_Webinar" }), "Registro_Calificado_Webinar");
  assert.equal(nombreEventoCalificado({ META_CAPI_EVENTO_CALIFICADO: "registro calificado!" }), "RegistroCalificado");
  const [, cal] = eventosDeRegistro(registro(), { META_CAPI_EVENTO_CALIFICADO: "Calificado" });
  assert.equal(cal.nombre, "Calificado");
});

test("el cuerpo que va a Meta: event_id, hora en segundos, fuente web con su página y custom_data", () => {
  const [, cal] = eventosDeRegistro(registro(), {});
  const x = eventoParaMeta(cal, "https://landing.com") as Record<string, unknown>;
  assert.equal(x.event_name, "RegistroCalificado");
  assert.equal(x.event_id, "rcal_0123456789abcdef");
  assert.equal(x.event_time, Math.floor(Date.parse("2026-10-07T15:00:00.000Z") / 1000));
  assert.equal(x.action_source, "website");
  assert.equal(x.event_source_url, "https://landing.com/webinar?x=1");
  assert.equal((x.custom_data as Record<string, unknown>).calificado, "si");
  assert.deepEqual((x.user_data as Record<string, unknown>).em, [hash("ana@mail.com")]);
  /* Un evento de la web sin página usa la de la variable; uno del sistema no la necesita. */
  const sinPagina = eventoParaMeta({ ...cal, url: undefined }, "https://landing.com") as Record<string, unknown>;
  assert.equal(sinPagina.event_source_url, "https://landing.com");
  const venta = eventoParaMeta({ ...cal, url: undefined, origen: "system_generated", valor: 1500.456, moneda: "USD", datos: undefined }, "https://landing.com") as Record<string, unknown>;
  assert.equal(venta.event_source_url, undefined);
  assert.deepEqual(venta.custom_data, { value: 1500.46, currency: "USD" });
});

/* ---------- Qué falta cargar ---------- */

test("sin variables: no está lista y dice qué cargar, sin mostrar ningún valor", () => {
  const e = estadoCapi({});
  assert.equal(e.lista, false);
  assert.deepEqual(e.faltan.filter((f) => f.obligatoria).map((f) => f.variable), ["META_PIXEL_ID", "META_CAPI_TOKEN"]);
  assert.ok(e.faltan.some((f) => f.variable === "REGISTRO_ORIGENES" && !f.obligatoria));
  assert.equal(e.token, null);
});

test("con el píxel y el token está lista; con el token del sistema, lista pero avisa", () => {
  const ok = estadoCapi({ META_PIXEL_ID: "123", META_CAPI_TOKEN: "secreto", REGISTRO_ORIGENES: "https://a.com, https://b.com" });
  assert.equal(ok.lista, true);
  assert.equal(ok.token, "capi");
  assert.deepEqual(ok.origenes, ["https://a.com", "https://b.com"]);
  assert.deepEqual(ok.faltan, []);
  assert.ok(!JSON.stringify(ok).includes("secreto"), "nunca devuelve una clave");

  const sistema = estadoCapi({ META_PIXEL_ID: "123", META_SYSTEM_TOKEN: "otro" });
  assert.equal(sistema.lista, true);
  assert.equal(sistema.token, "sistema");
  assert.equal(sistema.faltan.find((f) => f.variable === "META_CAPI_TOKEN")?.obligatoria, false);

  assert.equal(estadoCapi({ META_PIXEL_ID: "123" }).lista, false, "sin token no hay envío");
  assert.equal(estadoCapi({ META_PIXEL_ID: "1", META_CAPI_TOKEN: "t", META_CAPI_TEST: "TEST123" }).prueba, true);
});
