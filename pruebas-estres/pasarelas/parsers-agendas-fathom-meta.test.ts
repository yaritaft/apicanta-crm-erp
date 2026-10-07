import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  anfitrionDe, aniosDeTexto, canalDeEvento, enlaceDe, estadoDe, idPersonaCalendly, idSesionCalendly, nivelDeIngles, respuestaA, respuestasDe,
  utmDe, uuidDe, webinarDeUtm, type InvitadoCalendly,
} from "@/lib/calendly";
import { firmaCalendlyValida } from "@/lib/calendly-firma";
import {
  candidatasPara, decidirGrabacion, desdeParaImportar, duracion, leerReunion, llamadaDe, segundosDeEspera, ventanaDeBusqueda,
} from "@/lib/fathom";
import { firmaValida as firmaFathom } from "@/lib/fathom-servidor";
import { datosPersonales, firmaValida as firmaMeta, respuestasDe as respuestasDeMeta, tokenDeVerificacion, type LeadMeta } from "@/lib/meta-leads";
import { diaDelWebinar, leerUtm, slugUtm, textoUtm } from "@/lib/utm-estandar";
import { esDeMeta } from "@/lib/meta-creativo";
import { nombreDeArchivo, nombreSeguro, extensionDe } from "@/lib/meta-descarga";
import { normalizarUtm } from "@/lib/utms";
import { normalizarPais, OTRO_PAIS, SIN_PAIS, TODOS_LOS_PAISES } from "@/lib/paises";
import { basura, conEntorno, propiedad, textoLoco } from "./azar";

/* ==================================================================
   ESTRÉS · los traductores de lo que llega de Calendly, Fathom y Meta
   (lib/calendly.ts, fathom.ts, meta-leads.ts, utm-estandar.ts, paises.ts)
   y las firmas de sus webhooks.

   - Con basura (texto raro, campos que faltan, listas vacías) devuelven
     vacío o un valor válido: nada tira.
   - Los ids que se derivan (cal_…, fathom_…) son los mismos para lo mismo,
     así reintentar un aviso no duplica nada.
   - Las firmas: sólo la buena y reciente pasa; el límite de tiempo es exacto.
   ================================================================== */

/* ---------- Calendly ---------- */

test("Calendly: el nivel de inglés, los años y el canal con texto raro nunca tiran y dan un valor del conjunto", propiedad("traductores de Calendly", 800, (az) => {
  const t = az.bool(0.5) ? textoLoco(az, 80) : az.pick(["Conversacional aunque cometo errores", "Nivel básico NO CONVERSACIONAL", "Muy bueno, ningún problema", "NATIVO", "B2+", "Hace 4 años", "menos de 1", "1 año y medio", "no trabajo", "3,5", "0", "ninguno", "Intermedio (B1)"]);
  const n = nivelDeIngles(t);
  assert.ok(n === undefined || ["basico", "intermedio", "conversacional", "nativo", "ninguno"].includes(n));
  /* Mayúsculas y tildes no cambian la respuesta. */
  assert.equal(nivelDeIngles(t.toUpperCase()), n);
  assert.equal(nivelDeIngles(t.normalize("NFD").replace(/[̀-ͯ]/g, "")), n);
  const a = aniosDeTexto(t);
  assert.ok(a === undefined || (Number.isInteger(a) && a >= 0 && a <= 60), `años ${a}`);
  assert.ok(["webinar", "vsl", "setter", "otro"].includes(canalDeEvento(t)));
  assert.equal(canalDeEvento(t), canalDeEvento(t.toUpperCase()));
  assert.equal(nivelDeIngles(undefined), undefined);
  assert.equal(aniosDeTexto(""), undefined);
}));

test("Calendly: «no conversacional» le gana a «conversacional» y «muy bueno, ningún problema» no cae en «ninguno»", () => {
  assert.equal(nivelDeIngles("Nivel básico NO CONVERSACIONAL"), "basico");
  assert.equal(nivelDeIngles("no conversacional"), "basico");
  assert.equal(nivelDeIngles("Conversacional aunque cometo errores"), "conversacional");
  assert.equal(nivelDeIngles("Muy bueno, ningún problema"), "conversacional");
  assert.equal(nivelDeIngles("ninguno"), "ninguno");
  assert.equal(aniosDeTexto("menos de 1"), 0);
  assert.equal(aniosDeTexto("Hace 4 años"), 4);
  assert.equal(aniosDeTexto("3,5 años"), 3);
  assert.equal(aniosDeTexto("999 años"), undefined);
});

test("Calendly: los ids salen del uuid del invitado: el mismo invitado siempre da el mismo id, con o sin barra final", propiedad("ids de Calendly", 300, (az) => {
  const ev = az.alfanum(12), inv = az.alfanum(12);
  const uri = `https://api.calendly.com/scheduled_events/${ev}/invitees/${inv}`;
  assert.equal(uuidDe(uri), inv);
  assert.equal(uuidDe(uri + "/"), inv);
  assert.equal(idSesionCalendly(uri), `cal_${inv}`);
  assert.equal(idPersonaCalendly(uri + "/"), `lea_cal_${inv}`);
  assert.equal(idSesionCalendly(uri), idSesionCalendly(uri));
  assert.notEqual(idSesionCalendly(uri), idSesionCalendly(`https://api.calendly.com/scheduled_events/${ev}/invitees/${az.alfanum(13)}`));
  assert.equal(typeof uuidDe(textoLoco(az, 40)), "string");
}));

test("Calendly: utmDe, respuestasDe, estadoDe, anfitrionDe y enlaceDe con campos que faltan, nulos y listas vacías no tiran", propiedad("campos de Calendly", 400, (az) => {
  const tracking = az.pick([undefined, {}, { utm_source: null, utm_medium: "  ", utm_campaign: "webinar_20261014" }, { utm_source: az.alfanum(5), utm_term: textoLoco(az, 10) }]);
  const u = utmDe(tracking as InvitadoCalendly["tracking"]);
  if (u) for (const [k, v] of Object.entries(u)) assert.ok(k.startsWith("utm_") && v === v.trim() && v.length > 0);
  const qa = az.pick([undefined, [], [{ question: "  ¿Inglés? ", answer: " Bueno " }, { question: "x", answer: "" }, { question: "y", answer: "   " }]]);
  const inv = { uri: "u", email: "a@b.com", name: "A", status: az.pick(["active", "canceled"] as const), event: "e", created_at: "2026-10-01T00:00:00Z", updated_at: "x", questions_and_answers: qa, tracking, no_show: az.pick([null, undefined, {}]) } as InvitadoCalendly;
  const r = respuestasDe(inv);
  assert.ok(r.every((x) => x.pregunta === x.pregunta.trim() && x.respuesta !== "" && x.respuesta === x.respuesta.trim()));
  assert.ok(["cancelada", "no-show", undefined].includes(estadoDe(inv)));
  if (inv.status === "canceled") assert.equal(estadoDe(inv), "cancelada");
  assert.equal(respuestaA(r, /ingles/), r.find((x) => /ingles/.test(x.pregunta.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))?.respuesta);
  const ev = { uri: "e", name: textoLoco(az, 20), status: "active", start_time: "x", end_time: "y", created_at: "z", updated_at: "w", location: az.pick([undefined, null, {}, { join_url: "https://meet/x" }, { location: "javascript:alert(1)" }, { join_url: "ftp://x" }]), event_memberships: az.pick([undefined, [], [{}], [{ user_name: "Cami" }], [{ user_email: "c@x.com" }]]) } as never;
  anfitrionDe(ev);
  const e = enlaceDe(ev);
  assert.ok(e === undefined || /^https?:\/\//.test(e), `enlace ${e}`);
}));

test("webinarDeUtm: con UTMs raros, webinars con fechas inválidas y «cuando» roto no tira y devuelve el id de un webinar que existe", propiedad("webinarDeUtm", 600, (az) => {
  const webinars = Array.from({ length: az.int(0, 5) }, (_, i) => ({ id: `w${i}`, fecha: az.pick(["2026-09-23T22:00:00Z", "2026-10-14T22:00:00Z", "2025-09-23T22:00:00Z", "no es fecha", "", "2026-10-14"]) }));
  const utm = az.pick<Record<string, string> | undefined>([undefined, {}, { utm_campaign: "webinar_20261014" }, { utm_campaign: "webinar_20261301" }, { utm_source: "Webinar", utm_medium: "14-10" }, { utm_source: "Webinar", utm_medium: "99-99" }, { utm_campaign: "clase0_webinar_20260923" }, { utm_campaign: "clase0_20261016" }, { utm_source: textoLoco(az, 10), utm_medium: textoLoco(az, 10), utm_campaign: textoLoco(az, 20) }]);
  const w = webinarDeUtm(utm, webinars, az.pick(["2026-10-01T12:00:00Z", "no es fecha", "", "2026-10-14"]));
  assert.ok(w === undefined || webinars.some((x) => x.id === w));
}));

test("leerUtm / diaDelWebinar / textoUtm / normalizarUtm / slugUtm: con basura no tiran y devuelven cosas con forma", propiedad("UTMs", 800, (az) => {
  const crudo = az.pick<Record<string, string | undefined> | null | undefined>([null, undefined, {}, { utm_source: "direct", utm_medium: "none" },
    Object.fromEntries(Array.from({ length: az.int(0, 5) }, () => [az.pick(["utm_source", "SOURCE", "Utm_Medium", "campaign", "utm_content", "utm_term", textoLoco(az, 5)]), az.pick([textoLoco(az, 30), "webinar_20261014", "clase0_webinar_20261014", "vsl_martin", " Webinar ", "14-10", undefined])]))]);
  const l = leerUtm(crudo);
  assert.ok(["estandar", "viejo", "sin-utm", "otro"].includes(l.formato));
  const d = diaDelWebinar(l, az.pick([[], ["2026-10-14"], ["2026-09-23", "2026-10-14"], ["basura"], [""]]));
  assert.ok(d === undefined || typeof d === "string");
  const t = textoUtm(l);
  assert.ok(t === undefined || t.length > 0);
  const n = normalizarUtm(crudo as Record<string, string> | null | undefined);
  for (const [k, v] of Object.entries(n)) assert.ok(["source", "medium", "campaign", "content"].includes(k) && v === v!.trim());
  const s = slugUtm(textoLoco(az, 40));
  assert.match(s, /^[a-z0-9_-]*$/);
  assert.equal(slugUtm(s), s, "idempotente");
}));

test("normalizarPais: nunca tira, da «sin», «otro» o un país de la lista, y es idempotente", propiedad("países", 800, (az) => {
  const t = az.pick<string | null | undefined>([null, undefined, "", "Argentina", "argentina ", "ARGENTINA", "Rosario, Argentina", "México", "Mexico", "EE.UU.", "USA", "United States", "🇦🇷", "AR", "ar", "Espana", "n/a", "-", "Narnia", textoLoco(az, 30), `${textoLoco(az, 10)}, Chile`, "x".repeat(5000)]);
  const iso = normalizarPais(t);
  assert.ok(iso === SIN_PAIS || iso === OTRO_PAIS || TODOS_LOS_PAISES.some((p) => p.iso === iso), `«${t}» dio «${iso}»`);
  if (iso !== SIN_PAIS && iso !== OTRO_PAIS) assert.equal(normalizarPais(iso), iso, `idempotencia de «${t}»`);
  assert.equal(normalizarPais(` ${t ?? ""} `), iso, "los espacios de los costados no cuentan");
}));

/* ---------- Fathom ---------- */

test("Fathom: leerReunion con basura da null o una grabación con id derivado del recording_id; leerla dos veces da lo mismo", propiedad("leerReunion", 800, (az) => {
  const p = az.pick<unknown>([null, undefined, 5, "x", [], {}, basura(az), basura(az), { meeting: basura(az) }, { recording_id: az.int(1, 99999999) }, { meeting: { recording_id: `r${az.alfanum(6)}`, title: textoLoco(az, 20), calendar_invitees: basura(az), transcript: basura(az), action_items: basura(az), recorded_by: basura(az), default_summary: basura(az) } }]);
  const g = leerReunion(p);
  assert.deepEqual(leerReunion(p), g, "determinista");
  if (g) {
    assert.equal(g.id, `fathom_${g.recordingId}`);
    assert.ok(g.recordingId !== "");
    assert.ok(Array.isArray(g.invitados) && Array.isArray(g.accionables));
    assert.ok(g.invitados.every((i) => i.email === undefined || i.email === i.email.toLowerCase()));
    assert.ok(g.accionables.every((a) => a.texto !== ""));
    assert.ok(g.transcripcion === null || g.transcripcion!.every((f) => f.texto !== ""));
  }
}));

test("Fathom: llamadaDe, decidirGrabacion, candidatasPara, desdeParaImportar, ventanaDeBusqueda, segundosDeEspera y duracion con fechas rotas no tiran", propiedad("fathom puro", 600, (az) => {
  const f = az.pick(["2026-10-07T15:00:00Z", "no es fecha", "", undefined]);
  const g = { empieza: f, grabadaDesde: az.pick([f, "2026-10-07T15:00:00Z", undefined]), creadoEn: az.pick([undefined, "2026-10-07T15:00:00Z"]), invitados: az.pick([[], [{ email: "a@b.com" }], [{ email: "A@B.COM" }, { nombre: "x" }, {}]]), grabadoPor: az.pick([undefined, "closer@x.com"]), grabadoPorNombre: az.pick([undefined, "Cami Ruiz"]) };
  const llamadas = Array.from({ length: az.int(0, 4) }, (_, i) => ({ id: `s${i}`, email: az.pick(["a@b.com", "A@B.com ", null, undefined, "otro@x.com"]), inicia: az.pick(["2026-10-07T15:30:00Z", "no es fecha", "2026-10-09T15:00:00Z"]), anfitrion: az.pick(["Cami Ruiz", null, undefined, ""]) }));
  const r = llamadaDe(g, llamadas, az.pick([[], [{ nombre: "Cami Ruiz", email: "closer@x.com" }], [{ nombre: "x" }]]));
  assert.ok(r === null || llamadas.some((l) => l.id === r));
  const d = decidirGrabacion(az.pick([null, undefined, { sesionId: "s1", emparejadaPor: "a-mano" as const }, { sesionId: "s2", emparejadaPor: "email-y-hora" as const }, { sesionId: null, emparejadaPor: null }]), az.pick([null, "s9"]));
  assert.equal(typeof d.guardar, "boolean");
  assert.equal(d.guardar, d.sesionId !== null);
  const c = candidatasPara([basura(az), { meeting: { recording_id: "r1", scheduled_start_time: "2026-10-07T15:00:00Z" } }, null], az.pick(["2026-10-07T15:00:00Z", "no es fecha"]));
  assert.ok(Array.isArray(c));
  const desde = desdeParaImportar(az.pick([null, undefined, "2026-10-01", "x"]), az.pick([null, undefined, "2026-09-21T00:00:00Z", "x"]), az.pick([Date.parse("2026-10-07T00:00:00Z"), 0]));
  assert.ok(desde === null || !Number.isNaN(Date.parse(desde)));
  const v = ventanaDeBusqueda(az.pick(["2026-10-07T15:00:00Z", "x", ""]));
  assert.ok(v === null || Date.parse(v.hasta) > Date.parse(v.desde));
  const s = segundosDeEspera(az.pick([null, undefined, "", "7", "1e3", "-5", "abc", "Wed, 21 Oct 2026 07:28:00 GMT", "0", "99999", "1.5"]), Date.parse("2026-10-07T00:00:00Z"));
  assert.ok(Number.isInteger(s) && s >= 5 && s <= 120, `espera ${s}`);
  assert.equal(typeof duracion({ grabadaDesde: az.pick([undefined, "2026-10-07T15:00:00Z", "x"]), grabadaHasta: az.pick([undefined, "2026-10-07T16:15:00Z", "x"]) }), "string");
}));

test("Fathom: la grabación se ata a la llamada del invitado (no a la de otro) y la que se ató a mano no se desata sola", () => {
  const g = { empieza: "2026-10-07T15:00:00Z", invitados: [{ email: "ana@cliente.com" }, { email: "closer@apicanta.com" }], grabadoPor: "closer@apicanta.com", grabadoPorNombre: "Cami Ruiz" };
  const llamadas = [
    { id: "otra-persona", email: "beto@cliente.com", inicia: "2026-10-07T15:00:00Z", anfitrion: "Cami Ruiz" },
    { id: "la-de-ana", email: " ANA@cliente.com", inicia: "2026-10-07T17:30:00Z", anfitrion: "Cami Ruiz" },
    { id: "ana-lejos", email: "ana@cliente.com", inicia: "2026-10-09T15:00:00Z", anfitrion: "Cami Ruiz" },
  ];
  assert.equal(llamadaDe(g as never, llamadas, [{ nombre: "Cami Ruiz", email: "closer@apicanta.com" }]), "la-de-ana");
  assert.equal(llamadaDe({ ...g, invitados: [{ email: "closer@apicanta.com" }] } as never, llamadas, []), null, "una reunión interna no se ata a nada");
  assert.equal(decidirGrabacion({ sesionId: "s1", emparejadaPor: "a-mano" }, "s2").sesionId, "s1");
  assert.deepEqual(decidirGrabacion(null, null), { guardar: false, sesionId: null, por: null });
});

test("firma de Fathom (Standard Webhooks): sólo la buena y reciente pasa; el límite de 5 minutos es exacto", propiedad("firma de Fathom (pura)", 200, (az) => {
  const secreto = `whsec_${Buffer.from(az.alfanum(24)).toString("base64")}`;
  const clave = Buffer.from(secreto.slice(6), "base64");
  const id = `msg_${az.alfanum(8)}`, cuerpo = textoLoco(az, 200);
  const ahora = 1_790_000_000;
  const ts = (d: number) => String(ahora + d);
  const firma = (t: string, c = cuerpo, i = id) => `v1,${createHmac("sha256", clave).update(`${i}.${t}.${c}`).digest("base64")}`;
  const val = (t: string, f: string, extra: Partial<Parameters<typeof firmaFathom>[0]> = {}) => firmaFathom({ cuerpo, id, timestamp: t, firma: f, secreto, ahora: ahora * 1000, ...extra });
  assert.equal(val(ts(0), firma(ts(0))), true);
  assert.equal(val(ts(-300), firma(ts(-300))), true, "justo 5 minutos");
  assert.equal(val(ts(300), firma(ts(300))), true);
  assert.equal(val(ts(-301), firma(ts(-301))), false);
  assert.equal(val(ts(301), firma(ts(301))), false);
  assert.equal(val(ts(0), firma(ts(0), cuerpo + "x")), false);
  assert.equal(val(ts(0), firma(ts(0), cuerpo, "otro")), false);
  assert.equal(val(ts(0), firma(ts(0)).replace("v1,", "v2,")), false);
  assert.equal(val(ts(0), `v1,${az.alfanum(40)} ${firma(ts(0))}`), true, "con varias firmas alcanza una buena");
  assert.equal(val(ts(0), "", {}), false);
  assert.equal(val("", firma(ts(0))), false);
  assert.equal(firmaFathom({ cuerpo, id: null, timestamp: ts(0), firma: firma(ts(0)), secreto }), false);
  assert.equal(firmaFathom({ cuerpo, id, timestamp: ts(0), firma: firma(ts(0)), secreto: "", ahora: ahora * 1000 }), false);
  assert.equal(firmaFathom({ cuerpo, id, timestamp: ts(0), firma: firma(ts(0)), secreto: "whsec_", ahora: ahora * 1000 }), false, "un secreto vacío no vale");
  assert.equal(val("abc", firma("abc")), false);
  assert.equal(val("NaN", firma("NaN")), false);
}));

test("firma de Calendly (pura): el límite de 3 minutos es exacto y la firma sólo vale para ese cuerpo", propiedad("firma de Calendly (pura)", 200, (az) => {
  const clave = az.alfanum(32), cuerpo = textoLoco(az, 100);
  const t = 1_790_000_000;
  const cab = (tt: number, c = cuerpo, k = clave) => `t=${tt},v1=${createHmac("sha256", k).update(`${tt}.${c}`).digest("hex")}`;
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave, t), true);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave, t + 180), true);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave, t + 181), false);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave, t - 180), true);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave, t - 181), false);
  assert.equal(firmaCalendlyValida(cuerpo + "x", cab(t), clave, t), false);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t), clave + "x", t), false);
  assert.equal(firmaCalendlyValida(cuerpo, null, clave, t), false);
  assert.equal(firmaCalendlyValida(cuerpo, textoLoco(az, 50), clave, t), false);
  assert.equal(firmaCalendlyValida(cuerpo, cab(t).toUpperCase(), clave, t), false);
}));

/* ---------- Meta (formularios) ---------- */

test("Meta Lead Ads: datosPersonales y respuestasDe con campos que faltan o vienen raros no tiran; la firma del webhook sólo vale con el App Secret", propiedad("Meta leads", 500, async (az) => {
  const campos = Array.from({ length: az.int(0, 8) }, () => ({ nombre: az.pick(["full_name", "first_name", "last_name", "email", "phone_number", "country", "city", "inversion", "nivel_de_ingles", textoLoco(az, 8)]), valores: az.pick([[], [""], ["  "], ["Ana"], ["a", "b"], ["sí_no"]]) }));
  const lead: LeadMeta = { id: az.alfanum(8), creado: "2026-10-07T12:00:00+0000", formularioId: "f1", campos };
  const p = datosPersonales(lead);
  for (const v of Object.values(p)) assert.ok(v === undefined || v.length > 0);
  const r = respuestasDeMeta(lead, az.pick([undefined, { id: "f1", nombre: "F", estado: "ACTIVE", preguntas: { inversion: "¿Cuánto invertís?" } }]));
  assert.ok(r.every((x) => x.respuesta.length > 0 && !/_/.test(x.respuesta)));
  /* La firma. */
  await conEntorno({ META_APP_SECRET: "app-secreto-estres-12345" }, async () => {
    const cuerpo = textoLoco(az, 200);
    const firma = (c: string, k = "app-secreto-estres-12345") => `sha256=${createHmac("sha256", k).update(c, "utf8").digest("hex")}`;
    assert.equal(firmaMeta(cuerpo, firma(cuerpo)), true);
    assert.equal(firmaMeta(cuerpo, firma(cuerpo, "otro")), false);
    assert.equal(firmaMeta(cuerpo + "x", firma(cuerpo)), false);
    assert.equal(firmaMeta(cuerpo, null), false);
    assert.equal(firmaMeta(cuerpo, "sha256="), false);
    assert.equal(firmaMeta(cuerpo, firma(cuerpo).slice(7)), false, "sin el prefijo sha256=");
    assert.equal(firmaMeta(cuerpo, `sha256=${"zz".repeat(32)}`), false);
    assert.notEqual(tokenDeVerificacion(), null);
    assert.equal((tokenDeVerificacion() ?? "").includes("app-secreto-estres-12345"), false);
  });
  await conEntorno({ META_APP_SECRET: undefined }, async () => {
    assert.equal(firmaMeta("x", "sha256=" + "0".repeat(64)), false, "sin App Secret no se acepta nada");
    assert.equal(tokenDeVerificacion(), null);
  });
}));


/* ---------- Lo que baja de Meta ---------- */

test("esDeMeta (la lista de dónde se puede bajar un archivo de un anuncio): lo que acepta es siempre un host de Meta, con trucos de URL, userinfo, barras y caracteres raros", propiedad("esDeMeta", 2000, (az) => {
  const dominios = ["fbcdn.net", "facebook.com", "fb.com", "fbsbx.com", "cdninstagram.com", "instagram.com"];
  const trucos = ["@", "\\", "%2f", "%40", "#", "?", " ", "\t", "\n", ":", "..", "/", ".", "-", "\u0000", "%00", "\u2024", "xn--", "evil.com", "127.0.0.1", "[::1]"];
  const meta = `${az.pick(["video", "scontent-eze1-1", "a.b", ""])}${az.bool() ? "." : ""}${az.pick(dominios)}`;
  const partes = [az.pick(["https://", "http://", "HTTPS://", "https:/", "//", "https:\\\\", ""]), az.bool() ? az.pick(trucos) : "", az.pick([meta, "evil.com", `${meta}.evil.com`, `evil${meta}`, `${meta}evil.com`]), az.bool() ? az.pick(trucos) : "", az.pick(["/", "/v/t42/x.mp4", "", "/@evil.com"])];
  const url = partes.join("");
  if (esDeMeta(url)) {
    let host: string;
    try { host = new URL(url).hostname.toLowerCase(); } catch { assert.fail(`aceptó una URL que no se puede leer: ${JSON.stringify(url)}`); }
    assert.ok(dominios.some((d) => host === d || host.endsWith(`.${d}`)), `aceptó ${JSON.stringify(url)} cuyo host real es ${host}`);
    assert.ok(url.toLowerCase().startsWith("https://"));
  }
}));

test("nombres de archivo de la descarga: sin barras ni caracteres de control, de hasta 80 caracteres, nunca vacío, con extensión del tipo", propiedad("nombre de archivo", 500, (az) => {
  const n = nombreSeguro(az.bool(0.3) ? null : textoLoco(az, 200) + az.pick(["", ".mp4", " - Copia 2.MOV"]));
  assert.ok(n.length > 0 && n.length <= 80);
  assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/.test(n), `«${n}»`);
  const f = nombreDeArchivo(textoLoco(az, 100), { extension: extensionDe(az.pick([null, undefined, "video/mp4; codecs=x", "IMAGE/PNG", "application/x-evil", ""]), az.pick(["video", "imagen"] as const)), indice: az.int(0, 3), total: az.int(1, 4), etiqueta: az.pick([undefined, "Historias y Reels", textoLoco(az, 20)]), portada: az.bool() });
  assert.match(f, /\.(mp4|mov|webm|m4v|jpg|png|webp|gif)$/);
  assert.ok(!/[\\/\u0000-\u001f"]/.test(f));
}));
