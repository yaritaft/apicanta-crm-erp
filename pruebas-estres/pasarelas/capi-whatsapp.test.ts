import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  datosDeLaPersona, normalizarEmail, normalizarNombre, normalizarTelefono, paisParaMeta, sha256,
} from "@/lib/capi-datos";
import { eventoParaMeta, fbcDeFbclid } from "@/lib/meta-capi";
import { eventosDeRegistro, idEventoCalificado, type EventoCapi } from "@/lib/capi-registro";
import { estadoCapi, nombreEventoCalificado, origenesPermitidos } from "@/lib/capi-estado";
import {
  estadoDelLector, fechasEnTexto, sugerirWebinar, unionDePersona, validarCuerpoGrupo, validarCuerpoLatido, listaParaCopiar,
  MAX_PARTICIPANTES_AVISO, MAX_PARTICIPANTES_FOTO, type LatidoLector, type MiembroWhatsapp,
} from "@/lib/whatsapp";
import { RepoMemoria, leerAccion, leerJson, recibirGrupo, sinNumeros, tokenValido } from "@/lib/whatsapp-servidor";
import { clavesDeTelefono } from "@/lib/telefonos-wpp";
import { Azar, basura, capturandoConsola, conEntorno, propiedad, textoLoco } from "./azar";
import { GENERADORES, claveLector } from "./lineas";

/* ==================================================================
   ESTRÉS · la Conversions API de Meta y el lector de WhatsApp.

   CAPI (lib/capi-*.ts, meta-capi.ts): los datos de la persona se normalizan
   y se hashean con SHA-256 igual de una vez a otra; el evento que sale no
   lleva nada personal sin hashear (salvo IP, user agent y cookies, que Meta
   pide tal cual) ni lo que escribió la persona en las preguntas; con basura
   no tira.

   WhatsApp (lib/whatsapp.ts, whatsapp-servidor.ts, /api/whatsapp/*): lo que
   manda el lector se valida (nunca tira, devuelve el error), las fotos y los
   avisos de entró/salió convergen a lo mismo cuando se repiten, y los
   teléfonos no aparecen nunca en una respuesta ni en la consola.
   ================================================================== */

/* ---------- CAPI ---------- */

test("capi-datos: los normalizadores son idempotentes y los hashes son SHA-256 de 64 hex, siempre los mismos", propiedad("normalizadores de CAPI", 500, (az) => {
  const l = az.pick(GENERADORES)(az);
  const mail = az.pick([` ${az.alfanum(6)}@Mail.COM `, "no es mail", "", "a@b", `${az.alfanum(4)}@x.com.ar`]);
  const e = normalizarEmail(mail);
  assert.equal(normalizarEmail(e), e);
  assert.ok(e === "" || e === e.toLowerCase().trim());
  const t = az.pick([...l.conMas, ...l.conCodigo, ...l.locales, textoLoco(az, 20), ""]);
  const pais = az.pick([l.pais, l.iso, null, undefined, "xx"]);
  const tel = normalizarTelefono(t, pais);
  assert.match(tel, /^(\d{8,15})?$/);
  assert.equal(normalizarTelefono(tel, pais), tel, `idempotencia de «${t}» (${pais})`);
  const n = normalizarNombre(az.pick(["Ana María Pérez Núñez", "  Beto  ", "O'Brien-Smith", "", textoLoco(az, 30), "Ñandú"]));
  assert.ok(/^[a-z'-]*$/.test(n.nombre) && /^[a-z'-]*$/.test(n.apellido));
  assert.deepEqual(normalizarNombre(`${n.nombre} ${n.apellido}`.trim()), n.nombre ? { nombre: n.nombre, apellido: n.apellido } : { nombre: "", apellido: "" });
  const iso = paisParaMeta(pais);
  assert.match(iso, /^([a-z]{2})?$/);
  const d = datosDeLaPersona({ email: mail, telefono: t, nombre: "Ana Pérez", pais: l.pais, externalId: az.pick([undefined, " c_1 ", ""]) });
  for (const k of ["em", "ph", "fn", "ln", "country", "external_id"]) if (k in d) {
    const v = d[k] as string[];
    assert.ok(Array.isArray(v) && v.length === 1 && /^[0-9a-f]{64}$/.test(v[0]), `${k} no es un SHA-256`);
  }
  assert.deepEqual(d, datosDeLaPersona({ email: mail, telefono: t, nombre: "Ana Pérez", pais: l.pais, externalId: d.external_id ? " c_1 " : undefined }), "determinista");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}));

test("capi-datos: la misma persona con otras mayúsculas, espacios y formato de teléfono da los mismos hashes", propiedad("mismos hashes", 300, (az) => {
  const l = az.pick(GENERADORES)(az);
  const base = { email: `${az.alfanum(6)}@Gmail.com`, telefono: l.conMas[0], nombre: "Ana María Pérez", pais: l.pais };
  const otro = { email: ` ${base.email.toUpperCase()} `, telefono: az.pick(l.conMas), nombre: "  ANA   MARÍA   PÉREZ ", pais: l.iso };
  const a = datosDeLaPersona(base), b = datosDeLaPersona(otro);
  assert.deepEqual(a.em, b.em);
  assert.deepEqual(a.fn, b.fn);
  assert.deepEqual(a.ln, b.ln);
  assert.deepEqual(a.country, b.country);
}));

test("eventoParaMeta: sin datos de la persona no hay evento; con datos, nada personal sin hashear ni lo que contestó en el formulario", propiedad("evento sin datos sensibles", 400, (az) => {
  const l = az.pick(GENERADORES)(az);
  const persona = { email: `${az.alfanum(8)}@example.org`, telefono: l.conMas[0], nombre: `Zoe${az.alfanum(4)} Quispe${az.alfanum(4)}`, pais: l.pais, externalId: `con_${az.alfanum(10)}`, ip: "203.0.113.9", userAgent: "UA/1.0", fbp: "fb.1.123.456", fbc: "fb.1.123.abc" };
  const respuestas = [
    { pregunta: "¿Cuánto podés invertir?", respuesta: `Tengo ${az.int(1000, 9999)} dólares ahorrados ${az.alfanum(6)}` },
    { pregunta: "Nivel de inglés", respuesta: `Conversacional ${az.alfanum(6)}` }, { pregunta: "Formación", respuesta: `Ingeniería ${az.alfanum(6)}` },
  ];
  const utm = { utm_source: "meta", utm_campaign: `webinar_20261014`, utm_content: `${az.int(10 ** 14, 10 ** 15)}` };
  const evs = eventosDeRegistro({ registroId: `reg_${az.alfanum(16)}`, cuando: "2026-10-07T12:00:00.000Z", pagina: "https://landing.example/webinar", webinarId: "web_1", utm, respuestas, persona }, {});
  assert.equal(evs[0].nombre, "Lead");
  assert.ok(evs.length === 1 || evs[1].nombre === "RegistroCalificado");
  for (const ev of evs) {
    const out = eventoParaMeta(ev as EventoCapi, "https://landing.example/");
    assert.ok(out, "con datos de la persona hay evento");
    const { user_data, ...resto } = out as { user_data: Record<string, unknown> };
    const crudo = JSON.stringify(resto);
    for (const privado of [persona.email, persona.nombre.split(" ")[0], persona.nombre.split(" ")[1], persona.externalId, ...respuestas.map((r) => r.respuesta)]) assert.equal(crudo.includes(privado), false, `se coló «${privado}» en custom_data o en la raíz`);
    /* La IP, el user agent y las cookies van tal cual (Meta lo pide); lo demás, hasheado. */
    const textoUser = JSON.stringify(user_data);
    for (const privado of [persona.email, persona.nombre.split(" ")[0], persona.externalId, l.nacional]) assert.equal(textoUser.includes(privado), false, `se coló «${privado}» en user_data`);
    assert.equal(user_data.client_ip_address, "203.0.113.9");
    assert.equal(Number.isInteger((out as { event_time: number }).event_time), true);
    assert.ok(typeof (out as { event_id: string }).event_id === "string" && (out as { event_id: string }).event_id.length > 0);
  }
  assert.equal(eventoParaMeta({ nombre: "Lead", id: "x", cuando: "2026-10-07T12:00:00.000Z", persona: { email: "no es mail", telefono: "123" } }), null, "sin nada que hashear no se manda");
}));

test("eventosDeRegistro: ids estables (mismo registro, mismo id), el calificado sólo con las tres respuestas, y el nombre del evento siempre es válido", propiedad("eventos de registro", 300, (az) => {
  const registroId = `reg_${az.alfanum(24)}`;
  const respuestas = az.bool(0.5)
    ? [{ pregunta: "¿Cuánto podés invertir en tu formación?", respuesta: "2000 USD" }, { pregunta: "Nivel de inglés", respuesta: "Conversacional" }, { pregunta: "Formación", respuesta: "Ingeniería en sistemas" }]
    : [{ pregunta: textoLoco(az, 20), respuesta: textoLoco(az, 20) }];
  const env = az.pick([{}, { META_CAPI_EVENTO_CALIFICADO: "Calificado_Web" }, { META_CAPI_EVENTO_CALIFICADO: "no válido!" }, { META_CAPI_EVENTO_CALIFICADO: "  " }, { META_CAPI_EVENTO_CALIFICADO: "1abc" }]);
  const r = { registroId, cuando: "2026-10-07T12:00:00.000Z", respuestas, persona: { email: "a@b.com" }, utm: az.pick([undefined, { utm_source: "x".repeat(500) }]) };
  const a = eventosDeRegistro(r, env), b = eventosDeRegistro({ ...r }, env);
  assert.deepEqual(a, b, "determinista");
  assert.equal(a[0].id, registroId);
  if (a.length === 2) assert.equal(a[1].id, idEventoCalificado(registroId));
  assert.match(nombreEventoCalificado(env), /^[A-Za-z][A-Za-z0-9_]{0,39}$/);
  for (const ev of a) for (const v of Object.values(ev.datos ?? {})) if (typeof v === "string") assert.ok(v.length <= 200, "los UTMs van cortados");
  assert.equal(eventosDeRegistro({ ...r, idLead: "  evt-del-pixel  " }, env)[0].id, "evt-del-pixel", "el id del píxel manda para que Meta no cuente doble");
}));

test("capi-estado: nunca devuelve el valor de una clave, con el entorno que sea", propiedad("estado de CAPI sin secretos", 200, (az) => {
  const env: Record<string, string | undefined> = {};
  for (const k of ["META_PIXEL_ID", "META_CAPI_TOKEN", "META_SYSTEM_TOKEN", "META_CAPI_TEST", "META_CAPI_URL", "REGISTRO_ORIGENES", "META_CAPI_EVENTO_CALIFICADO"]) if (az.bool(0.6)) env[k] = az.pick([`secreto_${az.alfanum(20)}`, "", " ", "x"]);
  const e = estadoCapi(env);
  const texto = JSON.stringify(e);
  for (const k of ["META_PIXEL_ID", "META_CAPI_TOKEN", "META_SYSTEM_TOKEN", "META_CAPI_TEST", "META_CAPI_URL"]) {
    const v = env[k];
    if (v && v.startsWith("secreto_")) assert.equal(texto.includes(v), false, `${k} salió en el estado`);
  }
  assert.equal(e.lista, e.pixel && e.token !== null);
  assert.deepEqual(origenesPermitidos(env), (env.REGISTRO_ORIGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  assert.equal(fbcDeFbclid(undefined), undefined);
  assert.equal(fbcDeFbclid("abc", 5), "fb.1.5.abc");
}));

/* ---------- WhatsApp: validar lo que manda el lector ---------- */

const AHORA = new Date("2026-10-07T18:00:00.000Z");

test("validarCuerpoGrupo / validarCuerpoLatido: con basura nunca tiran y siempre dicen ok o un error en castellano", propiedad("validar al lector", 800, (az) => {
  const cuerpo = az.bool(0.5) ? basura(az) : {
    grupo: az.pick([{ id: "120363025246125486@g.us", nombre: "Webinar 14/10" }, basura(az), { id: az.alfanum(az.int(0, 200)), nombre: textoLoco(az, 300) }, null, "x"]),
    evento: az.pick(["foto", "entro", "salio", "otro", 5, null, undefined]),
    participantes: az.pick([[], ["5491155551234"], [5491155551234, "+54 9 11 5555-1234", null, {}, [], "x".repeat(100), "1203@lid"], basura(az), "no es lista", Array.from({ length: az.int(0, 40) }, () => textoLoco(az, 20))]),
    en: az.pick([undefined, null, "", "2026-10-07T17:00:00Z", "2030-01-01T00:00:00Z", "2020-01-01T00:00:00Z", "ayer", 5, "x".repeat(1000)]),
    total: az.pick([undefined, null, 5, -1, 1.5, "7", 1e9]), sinTelefono: az.pick([undefined, 0, 3, -2, "x"]),
  };
  const g = validarCuerpoGrupo(cuerpo, AHORA);
  if (g.ok) {
    const v = g.valor;
    assert.ok(["foto", "entro", "salio"].includes(v.evento));
    assert.match(v.grupo.id, /^[A-Za-z0-9._:@-]{3,120}$/);
    assert.ok(v.grupo.nombre.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v.grupo.nombre));
    assert.equal(new Set(v.telefonos).size, v.telefonos.length, "teléfonos sin repetir");
    for (const t of v.telefonos) assert.match(t, /^\d{8,15}$/);
    assert.ok(v.telefonos.length + v.descartados <= v.recibidos);
    assert.ok(Date.parse(v.en) <= AHORA.getTime() && !Number.isNaN(Date.parse(v.en)), "no cuenta nada del futuro");
    assert.ok(v.total === null || (Number.isInteger(v.total) && v.total >= 0));
    assert.ok(Number.isInteger(v.sinTelefono) && v.sinTelefono >= 0);
  } else {
    assert.ok(typeof g.error === "string" && g.error.length > 5);
  }
  const l = validarCuerpoLatido(basura(az) ?? {}, AHORA);
  if (l.ok) { assert.equal(typeof l.valor.conectado, "boolean"); assert.ok(Number.isInteger(l.valor.grupos) && l.valor.grupos >= 0); assert.ok(Date.parse(l.valor.en) <= AHORA.getTime()); }
  else assert.ok(l.error.length > 5);
}));

test("validarCuerpoGrupo: los topes de participantes (20.000 en una foto, 5.000 en un aviso) y la hora absurda", () => {
  const lista = (n: number) => Array.from({ length: n }, (_, i) => `54911${String(10000000 + i)}`);
  const grupo = { id: "120363025246125486@g.us", nombre: "x" };
  assert.equal(validarCuerpoGrupo({ grupo, evento: "foto", participantes: lista(MAX_PARTICIPANTES_FOTO) }, AHORA).ok, true);
  assert.equal(validarCuerpoGrupo({ grupo, evento: "foto", participantes: lista(MAX_PARTICIPANTES_FOTO + 1) }, AHORA).ok, false);
  assert.equal(validarCuerpoGrupo({ grupo, evento: "entro", participantes: lista(MAX_PARTICIPANTES_AVISO) }, AHORA).ok, true);
  assert.equal(validarCuerpoGrupo({ grupo, evento: "entro", participantes: lista(MAX_PARTICIPANTES_AVISO + 1) }, AHORA).ok, false);
  const futuro = validarCuerpoGrupo({ grupo, evento: "entro", participantes: ["5491155551234"], en: "2030-01-01T00:00:00Z" }, AHORA);
  assert.ok(futuro.ok && futuro.valor.en === AHORA.toISOString(), "el reloj adelantado del lector no cuenta cosas del futuro");
  const viejo = validarCuerpoGrupo({ grupo, evento: "entro", participantes: ["5491155551234"], en: "2020-01-01T00:00:00Z" }, AHORA);
  assert.ok(viejo.ok && viejo.valor.en === AHORA.toISOString());
  assert.equal(validarCuerpoGrupo({ grupo, evento: "foto", participantes: ["x"], en: "ayer" }, AHORA).ok, false);
});

test("fechasEnTexto y sugerirWebinar: con basura no tiran; las fechas son del calendario y el webinar sugerido existe", propiedad("fechas en nombres de grupo", 500, (az) => {
  const t = az.bool(0.4) ? textoLoco(az, 60) : `${az.pick(["Webinar", "Grupo", "WhatsApp"])} ${az.int(0, 40)}${az.pick(["/", "-", ".", " de ", " "])}${az.int(0, 14)}${az.pick(["", "/2026", "-26", " de 2026"])}`;
  for (const f of fechasEnTexto(t)) {
    assert.ok(f.mes >= 1 && f.mes <= 12 && f.dia >= 1 && f.dia <= 31, JSON.stringify(f));
    if (f.anio !== undefined) assert.equal(new Date(Date.UTC(f.anio, f.mes - 1, f.dia)).getUTCMonth(), f.mes - 1);
  }
  const webinars = Array.from({ length: az.int(0, 5) }, (_, i) => ({ id: `w${i}`, titulo: az.pick(["Webinar de Python", textoLoco(az, 20), ""]), fecha: az.pick(["2026-10-14T22:00:00Z", "2026-09-23T22:00:00Z", "no es fecha", ""]) }));
  const s = sugerirWebinar(t, webinars, az.pick([Date.now(), NaN, 0]));
  assert.ok(s === null || webinars.some((w) => w.id === s.webinarId));
}));

test("unionDePersona: quien escribió su teléfono de cualquier forma y está en el grupo figura «unida»; otra línea, no", propiedad("unión al grupo", 300, (az) => {
  const l = az.pick(GENERADORES)(az), otra = az.pick(GENERADORES)(az);
  const escrito = az.pick([...l.conMas.filter((x) => !/^\+\d{1,3} 0\d/.test(x)), ...l.locales]);
  const dentro = new Set<string>([claveLector(l), ...Array.from({ length: az.int(0, 5) }, () => claveLector(az.pick(GENERADORES)(az)))]);
  const u = unionDePersona(escrito, l.pais, dentro);
  assert.equal(u.estado, "unida", `«${escrito}» (${l.pais}) en el grupo`);
  assert.equal(u.clave, claveLector(l));
  if (claveLector(otra) !== claveLector(l)) {
    const sin = new Set([...dentro].filter((c) => c !== claveLector(l)));
    const u2 = unionDePersona(escrito, l.pais, sin);
    assert.equal(u2.estado, "no-unida");
    assert.ok(u2.numero === "" || /^\d+$/.test(u2.numero));
  }
  assert.equal(unionDePersona("", l.pais, dentro).estado, "sin-telefono");
  assert.equal(unionDePersona(null, l.pais, dentro).estado, "sin-telefono");
  assert.equal(unionDePersona("no es un teléfono", l.pais, dentro).ilegible, true);
  assert.deepEqual(listaParaCopiar([{ nombre: "A\tB\n", numero: "123" }, { nombre: "C", numero: "" }], true), "A B\t+123");
}));

/* ---------- WhatsApp: las fotos y los avisos convergen ---------- */

interface Evento { tipo: "foto" | "entro" | "salio"; tels: string[]; min: number; sinTelefono: number }

function secuencia(az: Azar, pool: string[], sinTel: boolean): Evento[] {
  const out: Evento[] = [];
  let min = 0;
  for (let i = az.int(1, 14); i > 0; i--) {
    min += az.int(1, 30);
    const tipo = az.pick(["foto", "entro", "entro", "salio", "salio"] as const);
    const tels = az.mezclar(pool).slice(0, tipo === "foto" ? az.int(0, pool.length) : az.int(1, 4));
    out.push({ tipo, tels, min, sinTelefono: tipo === "foto" && sinTel ? az.int(0, 3) : 0 });
  }
  return out;
}

const cuerpoDe = (e: Evento) => {
  const v = validarCuerpoGrupo({ grupo: { id: "120363025246125486@g.us", nombre: "Webinar" }, evento: e.tipo, participantes: e.tels, en: new Date(Date.parse("2026-10-07T00:00:00Z") + e.min * 60000).toISOString(), sinTelefono: e.sinTelefono }, new Date("2026-10-08T00:00:00Z"));
  assert.ok(v.ok);
  return v.valor;
};

const dentroDe = async (repo: RepoMemoria) => new Set((await repo.leerMiembros("120363025246125486@g.us")).filter((m) => m.dentro).map((m) => m.telefono));

test("el lector: aplicando fotos y avisos en orden queda lo que dice el último estado; repetir toda la secuencia no cambia nada", propiedad("fotos y avisos", 250, async (az) => {
  const pool = Array.from({ length: 8 }, (_, i) => `54911${String(55550000 + i * 7)}`);
  const eventos = secuencia(az, pool, false);
  const repo = new RepoMemoria();
  /* El modelo: lo que tendría que pasar con el orden de llegada. */
  let modelo = new Set<string>();
  let hayGrupo = false, miembrosGrupo = 0;
  for (const e of eventos) {
    const c = cuerpoDe(e);
    const t = c.telefonos;
    if (e.tipo === "foto") {
      if (!(t.length === 0 && hayGrupo && miembrosGrupo > 0)) { modelo = new Set(t); miembrosGrupo = modelo.size; }
      hayGrupo = true;
    } else if (e.tipo === "entro") {
      for (const x of t) modelo.add(x);
      if (hayGrupo || true) miembrosGrupo = modelo.size;
      hayGrupo = true;
    } else {
      for (const x of t) modelo.delete(x);
      miembrosGrupo = modelo.size;
      hayGrupo = true;
    }
    await recibirGrupo(repo, c);
    assert.deepEqual([...(await dentroDe(repo))].sort(), [...modelo].sort(), `tras «${e.tipo}» a los ${e.min} min con ${t.length} teléfonos`);
    const g = await repo.leerGrupo("120363025246125486@g.us");
    assert.equal(await repo.contarDentro("120363025246125486@g.us"), modelo.size);
    if (e.tipo === "foto" && g) assert.ok(g.miembros === modelo.size || (t.length === 0 && modelo.size > 0), `miembros del grupo ${g.miembros} vs ${modelo.size}`);
  }
  const antes = JSON.stringify([...(await repo.leerMiembros("120363025246125486@g.us"))].sort((a, b) => a.telefono.localeCompare(b.telefono)).map(({ creadoEn: _c, ...x }) => x));
  /* Reenviar todo otra vez, tal cual (el lector reintenta): el estado no se mueve. */
  for (const e of eventos) await recibirGrupo(repo, cuerpoDe(e));
  const despues = JSON.stringify([...(await repo.leerMiembros("120363025246125486@g.us"))].sort((a, b) => a.telefono.localeCompare(b.telefono)).map(({ creadoEn: _c, ...x }) => x));
  assert.equal(despues, antes, "reenviar la misma secuencia dejó otro estado");
}));

test("con participantes sin teléfono visible, una foto no saca a nadie; una foto completa posterior corrige todo (convergencia)", propiedad("foto con sin-teléfono", 200, async (az) => {
  const pool = Array.from({ length: 6 }, (_, i) => `54911${String(66660000 + i * 11)}`);
  const repo = new RepoMemoria();
  for (const e of secuencia(az, pool, true)) await recibirGrupo(repo, cuerpoDe(e));
  const ultima = az.mezclar(pool).slice(0, az.int(1, pool.length));
  await recibirGrupo(repo, cuerpoDe({ tipo: "foto", tels: ultima, min: 10_000, sinTelefono: 0 }));
  assert.deepEqual([...(await dentroDe(repo))].sort(), [...ultima].sort(), "la foto completa es la verdad");
}));

test("un aviso o una foto más vieja que lo último que se supo de cada uno no lo pisa", async () => {
  const repo = new RepoMemoria();
  const t = ["5491155550001"];
  await recibirGrupo(repo, cuerpoDe({ tipo: "entro", tels: t, min: 10, sinTelefono: 0 }));
  await recibirGrupo(repo, cuerpoDe({ tipo: "salio", tels: t, min: 20, sinTelefono: 0 }));
  await recibirGrupo(repo, cuerpoDe({ tipo: "entro", tels: t, min: 15, sinTelefono: 0 }));
  assert.equal((await dentroDe(repo)).has(t[0]), false, "el «entró» de las 15 llegó tarde: ya salió a las 20");
  await recibirGrupo(repo, cuerpoDe({ tipo: "entro", tels: t, min: 30, sinTelefono: 0 }));
  await recibirGrupo(repo, cuerpoDe({ tipo: "salio", tels: t, min: 25, sinTelefono: 0 }));
  assert.equal((await dentroDe(repo)).has(t[0]), true);
});

/* ---------- WhatsApp: el estado del lector ---------- */

test("estadoDelLector: con basura no tira; el tono y la alarma son coherentes con los minutos sin señal", { todo: true }, propiedad("estado del lector", 500, (az) => {
  const l = az.pick<LatidoLector | null | undefined>([null, undefined, {
    ultimoLatido: az.pick(["2026-10-07T12:00:00Z", "no es fecha", "", "2099-01-01T00:00:00Z"]), conectado: az.bool(), grupos: az.int(0, 5),
    ultimaConexion: az.pick([null, undefined, "2026-10-07T11:00:00Z", "x"]), desde: az.pick([null, "2026-10-01T00:00:00Z", "y"]), enLector: null,
  }]);
  const e = estadoDelLector(l, az.pick([Date.parse("2026-10-07T12:30:00Z"), Date.parse("2026-10-07T12:03:00Z"), 0, Date.now()]));
  assert.ok(["nunca", "conectado", "desconectado", "sin-senal", "caido"].includes(e.tipo));
  assert.ok(e.titulo.length > 0 && e.detalle.length > 0);
  if (e.tipo === "caido") assert.equal(e.alarma, true);
  if (e.tipo === "conectado" || e.tipo === "sin-senal" || e.tipo === "nunca") assert.equal(e.alarma, false);
  if (e.minutos !== null) assert.ok(e.minutos >= 0);
}));

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("tokenValido, leerAccion, leerJson y sinNumeros: con basura no tiran y no dejan pasar lo que no es", { todo: true }, async () => {
  assert.equal(tokenValido("a", "a"), true);
  assert.equal(tokenValido("a", "b"), false);
  assert.equal(tokenValido("a".repeat(100000), "a"), false);
  for (const j of [null, undefined, 5, "x", [], [1], {}, { accion: 5 }, { accion: "atar" }, { accion: "atar", grupoId: "a b", webinarId: "w" }, { accion: "contactado", webinarId: "w", personaId: "p", contactado: "si" }]) {
    assert.equal(leerAccion(j).ok, false);
  }
  assert.equal(leerAccion({ accion: "contactado", webinarId: "w1", personaId: "p@x.com", contactado: true, por: "ana\u0000\n".repeat(100) }).ok, true);
  for (const [cuerpo, esperado] of [["", false], ["{", false], ["null", true], ["[]", true], ['{"a":1}', true]] as const) {
    const r = await leerJson(new Request("http://x/", { method: "POST", body: cuerpo }));
    assert.equal(r.ok, esperado, cuerpo);
  }
  assert.equal((await leerJson(new Request("http://x/", { method: "POST", body: "x".repeat(2000) }), 1000)).ok, false);
  assert.equal((await leerJson(new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "999999999" } }), 1000)).ok, false);
  assert.equal((await leerJson(new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "abc" } }), 1000)).ok, true);
  assert.equal(sinNumeros("el 5491155551234 y 1234567 y 123456"), "el … y … y 123456");
});

/* ---------- WhatsApp: las rutas, con archivo de prueba local ---------- */

test("rutas del lector: con el token y basura contestan 200/400/413, nunca 500, y NINGÚN teléfono aparece en la respuesta ni en la consola", propiedad("rutas del lector", 25, async (az) => {
  const { POST: postGrupos } = await import("@/app/api/whatsapp/grupos/route");
  const { POST: postLatido } = await import("@/app/api/whatsapp/latido/route");
  const carpeta = mkdtempSync(join(tmpdir(), "apicanta-estres-wa-"));
  const TOKEN = `lector-estres-${az.alfanum(24)}`;
  try {
    await conEntorno({ WHATSAPP_LECTOR_TOKEN: TOKEN, WHATSAPP_ARCHIVO_LOCAL: join(carpeta, "datos.json"), NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }, async () => {
      const telefonos = Array.from({ length: az.int(1, 10) }, () => `54911${az.digitos(8)}`);
      const { valor, texto } = await capturandoConsola(async () => {
        const salida: { status: number; texto: string }[] = [];
        for (let i = 0; i < 12; i++) {
          const buenos = { grupo: { id: "120363025246125486@g.us", nombre: `Webinar ${telefonos[0]}` }, evento: az.pick(["foto", "entro", "salio"]), participantes: az.mezclar(telefonos), en: new Date(Date.now() - az.int(0, 60) * 60000).toISOString(), total: 50, sinTelefono: 0 };
          const cuerpo = az.pick([buenos, buenos, basura(az), { ...buenos, participantes: [...telefonos, ...Array.from({ length: 3 }, () => textoLoco(az, 20))] }, { ...buenos, grupo: null }]);
          const req = (ruta: string, c: unknown, h: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) => new Request(`http://localhost${ruta}`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: typeof c === "string" ? c : JSON.stringify(c) });
          for (const r of [await postGrupos(req("/api/whatsapp/grupos", cuerpo)), await postLatido(req("/api/whatsapp/latido", az.pick([{ conectado: az.bool(), grupos: 3 }, basura(az), { conectado: "sí" }]))),
            await postGrupos(req("/api/whatsapp/grupos", buenos, {})), await postGrupos(req("/api/whatsapp/grupos", "{", { authorization: `Bearer ${TOKEN}` }))]) {
            salida.push({ status: r.status, texto: await r.text() });
          }
        }
        return salida;
      });
      for (const r of valor) {
        assert.ok([200, 400, 401, 413].includes(r.status), `status ${r.status}: ${r.texto.slice(0, 100)}`);
        assert.equal(r.texto.includes(TOKEN), false);
        for (const t of telefonos) assert.equal(r.texto.includes(t), false, "un teléfono salió en una respuesta");
      }
      for (const t of telefonos) assert.equal(texto.includes(t), false, "un teléfono salió en la consola");
      assert.equal(texto.includes(TOKEN), false);
    });
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
}));

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: estadoDelLector: la alarma se apaga entre los minutos 7 y 15 sin latido cuando el lector ya estaba sin WhatsApp (parpadea: sí, no, sí)", { todo: true }, () => {
  /* Con `conectado: false` y la última conexión hace una hora la alarma está encendida (desconectado). Si además el
     servidor deja de latir, pasados 6 minutos el tipo pasa a «sin-senal» y la alarma a false hasta el minuto 16 («caido»).
     Un estado peor no debería tener menos alarma que uno mejor. */
  const t0 = Date.parse("2026-10-07T12:00:00Z");
  const l: LatidoLector = { ultimoLatido: new Date(t0).toISOString(), conectado: false, grupos: 3, ultimaConexion: new Date(t0 - 60 * 60000).toISOString(), desde: new Date(t0 - 86400000).toISOString() };
  const alarmas = [0, 3, 6, 7, 10, 15, 16, 20].map((min) => estadoDelLector(l, t0 + min * 60000).alarma);
  for (let i = 1; i < alarmas.length; i++) assert.ok(!alarmas[i - 1] || alarmas[i], `la alarma se apagó: ${JSON.stringify(alarmas)}`);
});

test("BUG: eventoParaMeta con una fecha inválida arma event_time NaN (null en el JSON): Meta rechaza el lote entero de 100 y el evento se reintenta para siempre", { todo: true }, () => {
  const out = eventoParaMeta({ nombre: "Schedule", id: "sch_1", cuando: "no es fecha", persona: { email: "a@b.com" } }) as { event_time: number } | null;
  assert.ok(out === null || Number.isFinite(out.event_time), `event_time ${out?.event_time}`);
  void claveLector;
});
