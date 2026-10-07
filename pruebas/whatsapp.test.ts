import test from "node:test";
import assert from "node:assert/strict";
import {
  aplicarAviso, aplicarFoto, contarDentro, duracionTexto, estadoDelLector, fechasEnTexto, filtrarPorLector, listaParaCopiar,
  numeroDeGrupo, ordenarGrupos, resumenDeRegistros, resumirUnion, rotuloDeGrupo, sugerirWebinar, telefonoParaCopiar, unionDePersona,
  unionesDeRegistros, validarCuerpoGrupo, validarCuerpoLatido,
  type LatidoLector, type MiembroWhatsapp,
} from "@/lib/whatsapp";
import { construirSemilla } from "@/lib/seed";
import { personasDeWebinar } from "@/lib/webinar";

const AHORA = new Date("2026-10-07T18:00:00.000Z");
const G = "120363025246125486@g.us";
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();

/* ---------- lo que manda el lector ---------- */

test("una foto bien armada: los teléfonos salen como claves, sin repetir", () => {
  const v = validarCuerpoGrupo({
    grupo: { id: G, nombre: "  Webinar   24/09 " }, evento: "foto", en: hace(1),
    participantes: ["5491155551234", "5491155551234@s.whatsapp.net", "+54 9 11 4444-3333", "5215512345678:7@s.whatsapp.net"],
    total: 6, sinTelefono: 2,
  }, AHORA);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.valor.grupo.nombre, "Webinar 24/09");
  assert.deepEqual(v.valor.telefonos, ["5491155551234", "5491144443333", "525512345678"]);
  assert.equal(v.valor.recibidos, 4);
  assert.equal(v.valor.descartados, 0);
  assert.equal(v.valor.total, 6);
  assert.equal(v.valor.sinTelefono, 2);
});

test("lo que no es un teléfono se descarta y se cuenta; el id interno de WhatsApp no es un teléfono", () => {
  const v = validarCuerpoGrupo({
    grupo: { id: G }, evento: "entro", participantes: ["5491155551234", "98765432109876@lid", "hola", "", 12, { id: "x" }, null],
  }, AHORA);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual(v.valor.telefonos, ["5491155551234"]);
  assert.equal(v.valor.recibidos, 7);
  assert.equal(v.valor.descartados, 6);
  assert.equal(v.valor.grupo.nombre, "");
});

test("los errores dicen qué falta, sin devolver los teléfonos", () => {
  const casos: [unknown, RegExp][] = [
    [null, /objeto JSON/],
    [[], /objeto JSON/],
    [{ evento: "foto", participantes: [] }, /Falta «grupo»/],
    [{ grupo: { id: "a b" }, evento: "foto", participantes: [] }, /grupo\.id/],
    [{ grupo: { id: G, nombre: 5 }, evento: "foto", participantes: [] }, /grupo\.nombre/],
    [{ grupo: { id: G }, evento: "borrar", participantes: [] }, /«evento»/],
    [{ grupo: { id: G }, evento: "foto" }, /«participantes»/],
    [{ grupo: { id: G }, evento: "foto", participantes: "5491155551234" }, /«participantes»/],
    [{ grupo: { id: G }, evento: "foto", participantes: [], en: "ayer" }, /«en»/],
    [{ grupo: { id: G }, evento: "foto", participantes: [], total: -1 }, /«total»/],
    [{ grupo: { id: G }, evento: "foto", participantes: [], sinTelefono: 1.5 }, /«sinTelefono»/],
  ];
  for (const [cuerpo, esperado] of casos) {
    const v = validarCuerpoGrupo(cuerpo, AHORA);
    assert.ok(!v.ok, JSON.stringify(cuerpo));
    if (!v.ok) {
      assert.match(v.error, esperado);
      assert.ok(!/\d{8,}/.test(v.error), "el error no lleva números de teléfono");
    }
  }
});

test("hay un tope de participantes: 20.000 en una foto, 5.000 en un aviso", () => {
  const muchos = (n: number) => Array.from({ length: n }, (_, i) => String(5491100000000 + i));
  assert.ok(validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: muchos(20_000) }, AHORA).ok);
  assert.ok(!validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: muchos(20_001) }, AHORA).ok);
  assert.ok(validarCuerpoGrupo({ grupo: { id: G }, evento: "entro", participantes: muchos(5_000) }, AHORA).ok);
  assert.ok(!validarCuerpoGrupo({ grupo: { id: G }, evento: "entro", participantes: muchos(5_001) }, AHORA).ok);
});

test("la hora del aviso: sin hora es ahora; en el futuro o de hace años, ahora (y se avisa del desfase)", () => {
  const sin = validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: [] }, AHORA);
  assert.ok(sin.ok && sin.valor.en === AHORA.toISOString() && sin.valor.relojDesfasadoMin === undefined);
  const futuro = validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: [], en: "2026-10-07T20:00:00Z" }, AHORA);
  assert.ok(futuro.ok && futuro.valor.en === AHORA.toISOString());
  assert.ok(futuro.ok && futuro.valor.relojDesfasadoMin === 120);
  const viejo = validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: [], en: "1970-01-01T00:00:00Z" }, AHORA);
  assert.ok(viejo.ok && viejo.valor.en === AHORA.toISOString());
  const unPoco = validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: [], en: "2026-10-07T18:03:00Z" }, AHORA);
  assert.ok(unPoco.ok && unPoco.valor.en === AHORA.toISOString(), "tres minutos en el futuro, aceptable pero acotado a ahora");
  const bien = validarCuerpoGrupo({ grupo: { id: G }, evento: "foto", participantes: [], en: hace(30) }, AHORA);
  assert.ok(bien.ok && bien.valor.en === hace(30));
});

test("el latido: conectado sí o no, y cuántos grupos", () => {
  const ok = validarCuerpoLatido({ en: hace(0), conectado: false, grupos: 3 }, AHORA);
  assert.ok(ok.ok && ok.valor.conectado === false && ok.valor.grupos === 3);
  assert.ok(validarCuerpoLatido({ conectado: true }, AHORA).ok);
  assert.ok(!validarCuerpoLatido({ conectado: "si" }, AHORA).ok);
  assert.ok(!validarCuerpoLatido({ conectado: true, grupos: -2 }, AHORA).ok);
  assert.ok(!validarCuerpoLatido("hola", AHORA).ok);
  assert.ok(!validarCuerpoLatido({ grupos: 2 }, AHORA).ok, "sin «conectado» ni «estado» no hay latido");
});

/* Una imagen de mentira con la forma que manda el lector: un SVG en base64. */
const QR = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>').toString("base64")}`;

test("el latido trae cómo está con WhatsApp: el estado, y el código QR sólo cuando espera que lo vinculen", () => {
  /* Un lector de antes, sin estado: se deduce de «conectado». */
  const viejo = validarCuerpoLatido({ conectado: false }, AHORA);
  assert.ok(viejo.ok && viejo.valor.estado === "reconectando");
  const viejoOk = validarCuerpoLatido({ conectado: true }, AHORA);
  assert.ok(viejoOk.ok && viejoOk.valor.estado === "conectado");

  for (const estado of ["conectado", "esperando_qr", "reconectando", "cerrado"]) {
    const v = validarCuerpoLatido({ en: hace(0), conectado: estado === "conectado", estado, grupos: 1 }, AHORA);
    assert.ok(v.ok, estado);
    if (v.ok) assert.equal(v.valor.estado, estado);
  }
  /* Con «estado» solo alcanza. */
  const soloEstado = validarCuerpoLatido({ estado: "esperando_qr", qr: QR }, AHORA);
  assert.ok(soloEstado.ok && soloEstado.valor.conectado === false && soloEstado.valor.qr === QR);

  const esperando = validarCuerpoLatido({ en: hace(0), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR }, AHORA);
  assert.ok(esperando.ok && esperando.valor.qr === QR);
  const png = validarCuerpoLatido({ estado: "esperando_qr", qr: "data:image/png;base64,iVBORw0KGgo=" }, AHORA);
  assert.ok(png.ok);
});

test("el código QR es una credencial: sólo una imagen, sólo esperando, y con tope", () => {
  const malos: [unknown, RegExp][] = [
    [{ estado: "dormido", conectado: false }, /«estado»/],
    [{ estado: "conectado", conectado: false }, /no coincide/],
    [{ estado: "esperando_qr", conectado: true }, /no coincide/],
    [{ estado: "conectado", qr: QR }, /sólo va cuando/],
    [{ estado: "reconectando", qr: QR }, /sólo va cuando/],
    [{ estado: "esperando_qr", qr: 42 }, /imagen/],
    [{ estado: "esperando_qr", qr: "https://malo.example/qr.png" }, /data URL/],
    [{ estado: "esperando_qr", qr: "data:text/html;base64,PHNjcmlwdD4=" }, /data URL/],
    [{ estado: "esperando_qr", qr: "data:image/svg+xml;base64,<script>alert(1)</script>" }, /data URL/],
    [{ estado: "esperando_qr", qr: "data:image/svg+xml,<svg/>" }, /data URL/],
    [{ estado: "esperando_qr", qr: `data:image/png;base64,${"A".repeat(80_100)}` }, /hasta 80 KB/],
  ];
  for (const [cuerpo, esperado] of malos) {
    const v = validarCuerpoLatido(cuerpo, AHORA);
    assert.ok(!v.ok, JSON.stringify(cuerpo).slice(0, 80));
    if (!v.ok) assert.match(v.error, esperado);
  }
  /* Justo en el tope entra. */
  assert.ok(validarCuerpoLatido({ estado: "esperando_qr", qr: `data:image/png;base64,${"A".repeat(80_000 - 22)}` }, AHORA).ok);
});

/* ---------- los miembros de un grupo ---------- */

const m = (telefono: string, extra: Partial<MiembroWhatsapp> = {}): MiembroWhatsapp =>
  ({ grupoId: G, telefono, dentro: true, entro: null, salio: null, ...extra });
const A = "5491100000001", B = "5491100000002", C = "5491100000003", D = "5491100000004";

test("la primera foto: todos ya estaban (no se sabe cuándo entraron)", () => {
  const r = aplicarFoto([], [A, B], hace(5), { grupoId: G, primeraFoto: true, sinTelefono: 0 });
  assert.equal(r.nuevos, 2);
  assert.deepEqual(r.crear.map((x) => [x.telefono, x.dentro, x.entro]), [[A, true, null], [B, true, null]]);
  assert.equal(contarDentro([], r), 2);
});

test("la segunda foto: los nuevos entraron entre las dos, y los que faltan salieron", () => {
  const antes = [m(A), m(B)];
  const r = aplicarFoto(antes, [B, C], hace(2), { grupoId: G, primeraFoto: false, sinTelefono: 0 });
  assert.deepEqual(r.crear.map((x) => [x.telefono, x.entro]), [[C, hace(2)]]);
  assert.deepEqual(r.actualizar.map((x) => [x.telefono, x.dentro, x.salio]), [[A, false, hace(2)]]);
  assert.equal(r.salieron, 1);
  assert.equal(contarDentro(antes, r), 2);
});

test("uno que había salido y aparece de nuevo, volvió", () => {
  const antes = [m(A, { dentro: false, salio: hace(60) })];
  const r = aplicarFoto(antes, [A], hace(1), { grupoId: G, primeraFoto: false, sinTelefono: 0 });
  assert.equal(r.volvieron, 1);
  assert.deepEqual(r.actualizar.map((x) => [x.dentro, x.entro, x.salio]), [[true, hace(1), hace(60)]]);
});

test("con participantes sin teléfono visible, una foto no marca a nadie como salido", () => {
  const antes = [m(A), m(B)];
  const r = aplicarFoto(antes, [B], hace(1), { grupoId: G, primeraFoto: false, sinTelefono: 3 });
  assert.equal(r.salieron, 0);
  assert.equal(r.actualizar.length, 0);
  assert.equal(contarDentro(antes, r), 2);
});

test("una foto más vieja que lo último que se supo de alguien no lo pisa", () => {
  /* A salió hace 1 minuto (aviso); llega tarde una foto de hace 3 que todavía lo tiene adentro. */
  const antes = [m(A, { dentro: false, salio: hace(1) })];
  const tarde = aplicarFoto(antes, [A], hace(3), { grupoId: G, primeraFoto: false, sinTelefono: 0 });
  assert.equal(tarde.volvieron, 0);
  assert.equal(tarde.actualizar.length, 0);
  /* Y al revés: B entró hace 1 minuto y una foto de hace 3 no lo tiene. */
  const entro = [m(B, { entro: hace(1) })];
  const otra = aplicarFoto(entro, [], hace(3), { grupoId: G, primeraFoto: false, sinTelefono: 0 });
  assert.equal(otra.salieron, 0);
});

test("avisos: entró, salió, volvió; el que nunca vimos no se saca", () => {
  const e = aplicarAviso([], "entro", [A, A, B], hace(2), G);
  assert.deepEqual(e.crear.map((x) => [x.telefono, x.entro]), [[A, hace(2)], [B, hace(2)]]);

  const adentro = [m(A), m(B)];
  const s = aplicarAviso(adentro, "salio", [A, C], hace(1), G);
  assert.deepEqual(s.actualizar.map((x) => [x.telefono, x.dentro, x.salio]), [[A, false, hace(1)]]);
  assert.equal(s.crear.length, 0, "C nunca estuvo en la base: no hay nada que sacar");

  const afuera = [m(A, { dentro: false, salio: hace(30) })];
  const v = aplicarAviso(afuera, "entro", [A], hace(1), G);
  assert.equal(v.volvieron, 1);
});

test("avisos fuera de orden: el más nuevo gana", () => {
  /* Salió a las T-1 pero el aviso de que había entrado (T-3) llega después. */
  const salido = [m(A, { dentro: false, entro: hace(10), salio: hace(1) })];
  const tarde = aplicarAviso(salido, "entro", [A], hace(3), G);
  assert.equal(tarde.volvieron, 0);
  assert.equal(tarde.actualizar.length, 0);
  /* Y un «salió» viejo no saca a quien entró después. */
  const entro = [m(A, { entro: hace(1) })];
  const viejo = aplicarAviso(entro, "salio", [A], hace(5), G);
  assert.equal(viejo.salieron, 0);
});

/* ---------- ¿está vivo el lector? ---------- */

const latido = (min: number, extra: Partial<LatidoLector> = {}): LatidoLector => ({
  ultimoLatido: hace(min), conectado: true, grupos: 2, ultimaConexion: hace(min), desde: hace(5000), ...extra,
});

test("sin latidos nunca: no hay alarma (no hay lector configurado)", () => {
  const e = estadoDelLector(null, AHORA.getTime());
  assert.equal(e.tipo, "nunca");
  assert.equal(e.alarma, false);
});

test("el lector conectado, con señal, sin señal y caído", () => {
  const t = AHORA.getTime();
  assert.deepEqual([estadoDelLector(latido(1), t).tipo, estadoDelLector(latido(1), t).alarma], ["conectado", false]);
  assert.deepEqual([estadoDelLector(latido(6), t).tipo, estadoDelLector(latido(6), t).alarma], ["conectado", false]);
  assert.deepEqual([estadoDelLector(latido(8), t).tipo, estadoDelLector(latido(8), t).alarma], ["sin-senal", false]);
  assert.deepEqual([estadoDelLector(latido(15), t).tipo, estadoDelLector(latido(15), t).alarma], ["sin-senal", false]);
  const caido = estadoDelLector(latido(16), t);
  assert.deepEqual([caido.tipo, caido.alarma, caido.tono], ["caido", true, "danger"]);
  assert.match(caido.titulo, /Sin señal hace 16 minutos/);
});

test("vivo pero sin WhatsApp: avisa sólo si pasan 15 minutos desde que se cortó", () => {
  const t = AHORA.getTime();
  /* Un lector de antes (sin «estado»): «conectado: false» es que está reconectando. */
  const reciente = estadoDelLector(latido(1, { conectado: false, ultimaConexion: hace(4) }), t);
  assert.deepEqual([reciente.tipo, reciente.alarma, reciente.tono, reciente.titulo], ["reconectando", false, "warning", "Reconectando"]);
  const largo = estadoDelLector(latido(1, { conectado: false, ultimaConexion: hace(40) }), t);
  assert.deepEqual([largo.tipo, largo.alarma, largo.tono], ["reconectando", true, "danger"]);
  /* Nunca se conectó: se espera a que pasen 15 minutos desde el primer latido. */
  const nuevo = estadoDelLector(latido(1, { conectado: false, ultimaConexion: null, desde: hace(3) }), t);
  assert.equal(nuevo.alarma, false);
  assert.match(nuevo.detalle, /todavía no se conectó/);
  const viejo = estadoDelLector(latido(1, { conectado: false, ultimaConexion: null, desde: hace(120) }), t);
  assert.equal(viejo.alarma, true);
});

test("los cuatro estados que cuenta el lector, con su título en la pantalla", () => {
  const t = AHORA.getTime();
  const de = (estado: LatidoLector["estado"], extra: Partial<LatidoLector> = {}) =>
    estadoDelLector(latido(1, { estado, conectado: estado === "conectado", ...extra }), t);
  assert.deepEqual([de("conectado").tipo, de("conectado").titulo, de("conectado").tono], ["conectado", "Conectado", "success"]);
  const qr = de("esperando_qr", { ultimaConexion: hace(2) });
  assert.deepEqual([qr.tipo, qr.titulo, qr.alarma, qr.tono], ["esperando-qr", "Esperando que lo escaneen", false, "warning"]);
  assert.match(qr.detalle, /Ajustes → WhatsApp/);
  const rec = de("reconectando", { ultimaConexion: hace(5) });
  assert.deepEqual([rec.tipo, rec.titulo, rec.alarma], ["reconectando", "Reconectando", false]);
  const cerrado = de("cerrado", { ultimaConexion: hace(5) });
  assert.deepEqual([cerrado.tipo, cerrado.titulo], ["cerrado", "Sesión cerrada"]);
  /* Esperando el código desde hace mucho: salta el aviso, igual que con la señal. */
  const mucho = de("esperando_qr", { ultimaConexion: hace(60) });
  assert.deepEqual([mucho.alarma, mucho.tono], [true, "danger"]);
  /* Primera vez: sin conexión previa, se cuenta desde el primer latido. */
  assert.equal(de("esperando_qr", { ultimaConexion: null, desde: hace(5) }).alarma, false);
  assert.equal(de("esperando_qr", { ultimaConexion: null, desde: hace(30) }).alarma, true);
  /* Sin señal manda sobre el estado que dijo la última vez. */
  assert.equal(estadoDelLector(latido(20, { estado: "esperando_qr", conectado: false }), t).tipo, "caido");
  assert.equal(estadoDelLector(latido(8, { estado: "conectado" }), t).tipo, "sin-senal");
});

test("los minutos, en palabras", () => {
  assert.equal(duracionTexto(0), "menos de un minuto");
  assert.equal(duracionTexto(1), "1 minuto");
  assert.equal(duracionTexto(23), "23 minutos");
  assert.equal(duracionTexto(60), "1 hora");
  assert.equal(duracionTexto(180), "3 horas");
  assert.equal(duracionTexto(60 * 72), "3 días");
});

/* ---------- qué grupo es de qué webinar ---------- */

test("las fechas que dice un nombre", () => {
  const d = (t: string) => fechasEnTexto(t).map((f) => `${f.dia}/${f.mes}${f.anio ? `/${f.anio}` : ""}`);
  assert.deepEqual(d("Webinar 24/09 - Hackear IT"), ["24/9"]);
  assert.deepEqual(d("Taller 08/10/2026 - Yari Taft"), ["8/10/2026"]);
  assert.deepEqual(d("WEB 24-09-26"), ["24/9/2026"]);
  assert.deepEqual(d("Hackear IT 2026-09-24"), ["24/9/2026"]);
  assert.deepEqual(d("grupo 20260924"), ["24/9/2026"]);
  assert.deepEqual(d("Webinar 24 de septiembre"), ["24/9"]);
  assert.deepEqual(d("Webinar 3 de Octubre de 2026"), ["3/10/2026"]);
  assert.deepEqual(d("Taller 24 sep"), ["24/9"]);
  assert.deepEqual(d("Taller sept 24"), ["24/9"]);
  assert.deepEqual(d("Clase 3 y 4 de oct"), ["4/10"]);
  assert.deepEqual(d("Grupo VIP 2"), []);
  assert.deepEqual(d("v1.5 del grupo"), [], "una versión no es una fecha");
  assert.deepEqual(d("31/02"), [], "un 31 de febrero no existe");
  assert.deepEqual(d("45/13"), []);
  assert.deepEqual(d("12 marketing"), [], "marketing no es marzo");
  /* Los grupos de los talleres: «Taller Online 08/10/26 #1». El «#N» no es una fecha. */
  assert.deepEqual(d("Taller Online 08/10/26 #1"), ["8/10/2026"]);
  assert.deepEqual(d("Taller Online 08/10/2026 #12"), ["8/10/2026"]);
  assert.deepEqual(d("  TALLER   ONLINE   08 / 10 / 26   #  3  "), ["8/10/2026"], "con espacios de más");
  assert.deepEqual(d("taller online 8/10/26 #1"), ["8/10/2026"]);
  assert.deepEqual(d("Taller Online 8-10 #2"), ["8/10"]);
});

test("el número de un grupo: «Taller Online 08/10/26 #2» es el Grupo #2", () => {
  assert.equal(numeroDeGrupo("Taller Online 08/10/26 #1"), 1);
  assert.equal(numeroDeGrupo("Taller Online 08/10/26 #12"), 12);
  assert.equal(numeroDeGrupo("taller online 08/10/26 # 3"), 3);
  assert.equal(numeroDeGrupo("Taller Online 08/10/26"), null);
  assert.equal(numeroDeGrupo("Hackear IT #"), null);
  assert.equal(numeroDeGrupo(undefined), null);
  assert.equal(rotuloDeGrupo("Taller Online 08/10/26 #2"), "Grupo #2");
  assert.equal(rotuloDeGrupo("Taller Online 08/10/26"), "");
  const g = (nombre: string) => ({ nombre });
  assert.deepEqual(
    ordenarGrupos([g("Taller Online 08/10/26 #10"), g("Taller Online 08/10/26 #2"), g("Zeta"), g("Taller Online 08/10/26 #1"), g("Alfa")]).map((x) => x.nombre),
    ["Taller Online 08/10/26 #1", "Taller Online 08/10/26 #2", "Taller Online 08/10/26 #10", "Alfa", "Zeta"],
  );
});

test("«Taller Online dd/mm/aa #N»: todos los grupos de un taller dan el mismo webinar", () => {
  const w = (id: string, iso: string, titulo = "Taller Online") => ({ id, titulo, fecha: iso });
  /* Dos talleres con el mismo título (el título no distingue), a las 19 de Argentina. */
  const webinars = [w("t1", "2026-09-24T22:00:00.000Z"), w("t2", "2026-10-08T22:00:00.000Z"), w("t3", "2026-10-22T22:00:00.000Z")];
  const ahora = AHORA.getTime();
  for (const nombre of [
    "Taller Online 08/10/26 #1", "Taller Online 08/10/26 #2", "Taller Online 08/10/26 #17", "taller online 08/10/26 #3",
    "TALLER ONLINE 08/10/2026 #4", "  Taller   Online   08/10/26   #5  ", "Taller Online 8/10/26 #6",
  ]) {
    assert.equal(sugerirWebinar(nombre, webinars, ahora)?.webinarId, "t2", nombre);
  }
  assert.equal(sugerirWebinar("Taller Online 24/09/26 #1", webinars, ahora)?.webinarId, "t1");
  assert.equal(sugerirWebinar("Taller Online 22/10/26 #2", webinars, ahora)?.webinarId, "t3");
  /* Un taller que no está cargado, o un grupo sin fecha: sin sugerencia (el título «Taller Online» es de tres webinars). */
  assert.equal(sugerirWebinar("Taller Online 12/11/26 #1", webinars, ahora), null);
  assert.equal(sugerirWebinar("Taller Online #1", webinars, ahora), null);
  /* Con el año de otro taller no se confunde. */
  assert.equal(sugerirWebinar("Taller Online 08/10/25 #1", webinars, ahora), null);
});

test("el webinar de un grupo por su nombre", () => {
  const w = (id: string, iso: string, titulo = "Taller") => ({ id, titulo, fecha: iso });
  /* 19:00 de Argentina = 22:00 UTC. */
  const webinars = [
    w("w1", "2026-09-24T22:00:00.000Z"), w("w2", "2026-10-08T22:00:00.000Z"),
    w("w3", "2025-10-08T22:00:00.000Z"), w("w4", "2026-10-22T02:30:00.000Z"),
  ];
  const ahora = AHORA.getTime();
  assert.equal(sugerirWebinar("Webinar 24/09 - Grupo 1", webinars, ahora)?.webinarId, "w1");
  assert.equal(sugerirWebinar("Webinar 8 de octubre", webinars, ahora)?.webinarId, "w2", "sin año, el más cercano a hoy");
  assert.equal(sugerirWebinar("Webinar 08/10/2025", webinars, ahora)?.webinarId, "w3", "con año, el de ese año");
  /* El 22/10 a las 23:30 de Argentina cae el 22 en Argentina, aunque en UTC ya sea el 22 a las 02:30. */
  assert.equal(sugerirWebinar("Taller 21/10", webinars, ahora)?.webinarId, "w4");
  assert.equal(sugerirWebinar("Webinar 25/12", webinars, ahora), null);
  assert.equal(sugerirWebinar("Grupo de alumnos", webinars, ahora), null);
  assert.equal(sugerirWebinar("", webinars, ahora), null);
  const m = sugerirWebinar("Webinar 24/09", webinars, ahora);
  assert.match(m?.motivo ?? "", /24\/09/);
  /* Por el título entero. */
  const titulados = [w("t1", "2026-11-05T22:00:00.000Z", "Cómo conseguir tu primer trabajo remoto en USA")];
  assert.equal(sugerirWebinar("COMO CONSEGUIR TU PRIMER TRABAJO REMOTO EN USA - grupo 2", titulados, ahora)?.webinarId, "t1");
});

/* ---------- quién está en el grupo ---------- */

test("unida, no unida y sin teléfono", () => {
  const dentro = new Set(["5491155551234", "573001234567"]);
  const salieron = new Map([["5491144443333", hace(90)]]);
  const u = (tel: string | undefined, pais?: string) => unionDePersona(tel, pais, dentro, salieron);

  assert.equal(u("+54 9 11 5555-1234").estado, "unida");
  assert.equal(u("011 15 5555-1234", "Argentina").estado, "unida");
  assert.equal(u("300 123 4567", "Colombia").estado, "unida");
  assert.equal(u("3001234567").estado, "unida", "sin país, el candidato colombiano también cuenta");

  const no = u("+54 9 11 6666-7777");
  assert.equal(no.estado, "no-unida");
  assert.equal(no.numero, "5491166667777");
  assert.equal(no.salio, undefined);

  const salio = u("11 4444-3333", "AR");
  assert.equal(salio.estado, "no-unida");
  assert.equal(salio.salio, hace(90));

  assert.deepEqual([u("").estado, u(undefined).estado, u("   ").estado], ["sin-telefono", "sin-telefono", "sin-telefono"]);
  const raro = u("no tengo");
  assert.equal(raro.estado, "sin-telefono");
  assert.equal(raro.ilegible, true);
  assert.equal(raro.numero, "");
});

test("sin saber el país, el link no se inventa: se usa lo que se escribió", () => {
  const dentro = new Set<string>();
  assert.equal(unionDePersona("11 5555-1234", undefined, dentro).numero, "1155551234");
  assert.equal(unionDePersona("11 5555-1234", "Argentina", dentro).numero, "5491155551234");
  assert.equal(unionDePersona("+57 300 123 4567", undefined, dentro).numero, "573001234567");
  /* Sólo el que trae el país se copia con el +. */
  assert.equal(unionDePersona("11 5555-1234", undefined, dentro).completo, false);
  assert.equal(unionDePersona("11 5555-1234", "Argentina", dentro).completo, true);
  assert.equal(unionDePersona("+54 9 11 5555-1234", undefined, dentro).completo, true);
  assert.equal(unionDePersona("5491155551234", undefined, dentro).completo, true, "con el código de país puesto a mano también");
});

test("N de M: las que no dejaron teléfono no cuentan en M", () => {
  const r = resumirUnion(["unida", "unida", "no-unida", "sin-telefono", "no-unida", "no-unida"]);
  assert.deepEqual(r, { conTelefono: 5, unidas: 2, noUnidas: 3, sinTelefono: 1 });
  assert.deepEqual(resumirUnion([]), { conTelefono: 0, unidas: 0, noUnidas: 0, sinTelefono: 0 });
});

test("la lista para copiar: teléfonos con el +, o nombre y teléfono para una planilla", () => {
  const filas = [{ nombre: "Ana\tPérez", numero: "5491155551234" }, { nombre: "Beto", numero: "573001234567" }, { nombre: "Sin número", numero: "" }];
  assert.equal(listaParaCopiar(filas, false), "+5491155551234\n+573001234567");
  assert.equal(listaParaCopiar(filas, true), "Ana Pérez\t+5491155551234\nBeto\t+573001234567");
  assert.equal(listaParaCopiar([], false), "");
  /* Un número escrito sin el país no se copia con un + inventado. */
  assert.equal(listaParaCopiar([{ nombre: "Cris", numero: "1155551234", completo: false }], false), "1155551234");
  assert.equal(listaParaCopiar([{ nombre: "Cris", numero: "1155551234", completo: false }], true), "Cris\t1155551234");
  assert.equal(telefonoParaCopiar({ numero: "5491155551234", completo: true }), "+5491155551234");
});

test("con los datos de ejemplo: los leads de un webinar quedan unidos o no según el grupo", () => {
  const e = construirSemilla();
  const web = e.webinars.find((w) => personasDeWebinar(e, w.id).length >= 6)!;
  assert.ok(web, "hay un webinar de ejemplo con gente");
  const personas = personasDeWebinar(e, web.id);
  const conTel = personas.filter((p) => p.telefono);
  assert.ok(conTel.length >= 6);

  /* El grupo tiene a la mitad. Son los teléfonos del seed, que son +54 9 11…. */
  const mitad = conTel.slice(0, Math.floor(conTel.length / 2));
  const dentro = new Set(mitad.map((p) => unionDePersona(p.telefono, p.pais, new Set()).clave!));
  const estados = personas.map((p) => unionDePersona(p.telefono, p.pais, dentro).estado);
  const r = resumirUnion(estados);
  assert.equal(r.unidas, mitad.length);
  assert.equal(r.conTelefono, conTel.length);
  assert.equal(r.noUnidas, conTel.length - mitad.length);
  assert.equal(r.sinTelefono, personas.length - conTel.length);
});

/* ---------- Formularios contra el grupo ---------- */

const registros = [
  { id: "r1", telefono: "+54 9 11 5555-0001", pais: "Argentina" },                       // en el grupo, ya marcado
  { id: "r2", telefono: "011 15 5555-0002", pais: "Argentina", grupo: "unido" },          // en el grupo con otra escritura
  { id: "r3", telefono: "11 5555-0003", pais: "AR" },                                     // en el grupo, sin marcar
  { id: "r4", telefono: "+57 300 123 0004", pais: "Colombia" },                            // no está
  { id: "r5", telefono: "+54 9 11 5555-0005", pais: "Argentina", grupo: "unido" },        // marcado a mano, pero no está
  { id: "r6", telefono: "" },                                                              // sin teléfono
  { id: "r7", telefono: "no tengo" },                                                      // algo que no es un teléfono
];
const adentro = ["5491155550001", "5491155550002", "5491155550003"];

test("cada registro de Formularios queda en el grupo, afuera o sin teléfono", () => {
  const u = unionesDeRegistros(registros, adentro, { "5491155550005": "2026-10-05T12:00:00.000Z" });
  assert.deepEqual([...u.entries()].map(([id, x]) => [id, x.estado]), [
    ["r1", "unida"], ["r2", "unida"], ["r3", "unida"], ["r4", "no-unida"], ["r5", "no-unida"], ["r6", "sin-telefono"], ["r7", "sin-telefono"],
  ]);
  assert.equal(u.get("r5")!.salio, "2026-10-05T12:00:00.000Z", "dice cuándo salió el que estuvo");
  assert.equal(u.get("r7")!.ilegible, true);
});

test("los números de arriba de Formularios: dentro, fuera, sin teléfono y cuántos faltan marcar", () => {
  const u = unionesDeRegistros(registros, adentro);
  const r = resumenDeRegistros(registros, u);
  assert.deepEqual(r, { total: 7, conTelefono: 5, dentro: 3, fuera: 2, sinTelefono: 2, porMarcar: 2 });
  /* «Marcar como unidos» toca sólo a los que el lector ve adentro y la hoja no tiene como «unido». */
  assert.equal(r.dentro - registros.filter((x) => x.grupo === "unido" && u.get(x.id)!.estado === "unida").length, r.porMarcar);
  assert.deepEqual(resumenDeRegistros([], new Map()), { total: 0, conTelefono: 0, dentro: 0, fuera: 0, sinTelefono: 0, porMarcar: 0 });
});

test("el filtro por lo que dice el lector", () => {
  const u = unionesDeRegistros(registros, adentro);
  const ids = (f: "" | "dentro" | "fuera" | "sin-telefono") => filtrarPorLector(registros, f, u).map((x) => x.id);
  assert.deepEqual(ids(""), ["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
  assert.deepEqual(ids("dentro"), ["r1", "r2", "r3"]);
  assert.deepEqual(ids("fuera"), ["r4", "r5"]);
  assert.deepEqual(ids("sin-telefono"), ["r6", "r7"]);
  /* Un registro que no se cruzó (llegó después) no está en ninguno de los filtros. */
  assert.deepEqual(filtrarPorLector([{ id: "nuevo" }], "dentro", u), []);
});
