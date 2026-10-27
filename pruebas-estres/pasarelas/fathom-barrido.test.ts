import test from "node:test";
import assert from "node:assert/strict";
import { capturandoConsola } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el barrido de Fathom por los links (lib/fathom-barrido-servidor)
   con una nube y un Fathom de mentira: cada llamada con el link pegado
   recibe su transcripción aunque el mail no coincida, una vez, y si Fathom
   pide esperar el barrido sigue donde quedó en la vuelta siguiente.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-fathom-barrido-falsa-0009";
process.env.FATHOM_API_KEY = "clave-falsa-de-fathom";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "FATHOM_EQUIPOS"]) delete process.env[k];

const red = instalarFetchFalso();
const { avisarDeFathom, barrerLinks, estadoDeLinks } = await import("@/lib/fathom-barrido-servidor");
const { nubeServidor } = await import("@/lib/servidor");
test.after(() => red.restaurar());

const db = nubeServidor()!;
const sesiones = () => red.nube.filas("sesiones");
const graba = () => red.nube.filas("grabaciones");
const barrido = () => red.nube.filas("fathom_barrido");

const reunion = (rec: string, cuando: string) => ({
  recording_id: rec, title: "Llamada", url: `https://fathom.video/calls/${rec}`, share_url: `https://fathom.video/share/${rec}`,
  scheduled_start_time: cuando, recording_start_time: cuando, recording_end_time: new Date(Date.parse(cuando) + 30 * 60000).toISOString(), created_at: cuando,
  recorded_by: { name: "Cami Ruiz", email: "cami@apicanta.com" }, calendar_invitees: [{ name: "Cami", email: "cami@apicanta.com", is_external: false }, { name: "X", email: "alias@raro.com", is_external: true }],
  default_summary: { markdown_formatted: "## Resumen" }, transcript: [{ speaker: { display_name: "Cami" }, text: "Hola", timestamp: "00:00:01" }], action_items: [],
});

/* Fathom de mentira: dos páginas de reuniones; `pedirEsperar` hace que la segunda conteste 429 una vez. */
let pedidos: string[] = [];
let pedirEsperar = false;
const hace = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
red.manejar((url) => {
  if (url.host !== "api.fathom.ai") return null;
  pedidos.push(`${url.pathname}${url.search}`);
  if (url.pathname.endsWith("/teams")) return { json: { items: [] } };
  const cursor = url.searchParams.get("cursor");
  /* Lo que grabó una persona de afuera de la organización sólo sale si se pide por su correo. */
  if (url.searchParams.get("recorded_by[]") === "externo@gmail.com") return { json: { items: [reunion("rec_externo", hace(6))], next_cursor: null } };
  if (!cursor) return { json: { items: [reunion("rec_1", hace(30)), reunion("rec_personal", hace(29))], next_cursor: "p2" } };
  if (pedirEsperar) { pedirEsperar = false; return new Response("{}", { status: 429, headers: { "retry-after": "7" } }); }
  return { json: { items: [reunion("rec_2", hace(5))], next_cursor: null } };
});

const sembrar = () => {
  red.nube.vaciar();
  pedidos = [];
  sesiones().push(
    { id: "cal_A", email: "ana@cliente.com", inicia: hace(30), anfitrion: "Cami Ruiz", estado: "agendada", calendlyInvitadoUri: "u/A", grabacion: "https://fathom.video/share/rec_1" },
    { id: "cal_B", email: "beto@cliente.com", inicia: hace(5), anfitrion: "Cami Ruiz", estado: "agendada", calendlyInvitadoUri: "u/B", grabacion: "https://fathom.video/share/rec_2?t=3" },
    { id: "cal_C", email: "cata@cliente.com", inicia: hace(4), anfitrion: "Cami Ruiz", estado: "agendada", calendlyInvitadoUri: "u/C", grabacion: "https://drive.google.com/file/d/1" },
    { id: "cal_D", email: "dani@cliente.com", inicia: hace(3), anfitrion: "Cami Ruiz", estado: "agendada", calendlyInvitadoUri: "u/D" },
  );
  red.nube.filas("equipo").push({ id: "eq_1", nombre: "Cami Ruiz", email: "cami@apicanta.com" });
};

const grande = { reloj: Date.now() + 60_000, maxPaginas: 20 };

test("cada llamada con su link recibe su transcripción (aunque el mail no coincida); la personal y la de Drive no se guardan", async () => {
  sembrar();
  const { valor: r } = await capturandoConsola(() => barrerLinks(db, { ...grande, reloj: Date.now() + 60_000 }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.estado, "terminado");
  assert.equal(r.porLink, 2);
  assert.deepEqual(graba().map((g) => [g.recordingId, g.sesionId, g.emparejadaPor]).sort(), [["rec_1", "cal_A", "link"], ["rec_2", "cal_B", "link"]]);
  assert.ok(graba().every((g) => Array.isArray(g.transcripcion) && (g.transcripcion as unknown[]).length === 1));
  const e = await estadoDeLinks(db);
  assert.deepEqual([e.conLink, e.conTranscripcion, e.pendientes, e.enCurso], [2, 2, 0, false]);
  assert.deepEqual(e.faltanPorCloser, []);
  assert.ok(barrido()[0].ultimoCompleto);
});

test("sin llamadas pendientes no le pregunta nada a Fathom; otra vuelta enseguida tampoco repite el barrido", async () => {
  const antes = pedidos.length;
  const { valor: r } = await capturandoConsola(() => barrerLinks(db, { ...grande, reloj: Date.now() + 60_000 }));
  assert.equal(r.estado, "nada");
  assert.equal(pedidos.length, antes);
});

test("si Fathom pide esperar, guarda dónde quedó y la vuelta siguiente sigue de ahí sin repetir lo hecho", async () => {
  sembrar();
  pedirEsperar = true;
  const { valor: a } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 20 }));
  assert.equal(a.estado, "esperar");
  assert.equal(a.esperar, 7);
  assert.equal(graba().length, 1, "lo de la primera página quedó guardado");
  assert.ok(barrido()[0].cursor, "el barrido sigue en curso");
  const { valor: b } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 20 }));
  assert.equal(b.estado, "terminado");
  assert.equal(graba().length, 2);
  /* Pidió la primera página una vez, la segunda dos (la del 429 y la buena) y ninguna otra: no volvió a empezar. */
  assert.equal(pedidos.filter((p) => p.includes("/meetings") && !p.includes("cursor")).length, 1);
  assert.equal(barrido()[0].cursor, null);
});

test("con pocas páginas por vuelta, el barrido se reparte y termina", async () => {
  sembrar();
  const { valor: a } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 1 }));
  assert.equal(a.estado, "en-curso");
  const { valor: b } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 1 }));
  assert.equal(b.estado, "terminado");
  assert.equal(graba().length, 2);
});

test("las que faltan se cuentan por closer, para saber a quién pedirle que comparta sus grabaciones", async () => {
  sembrar();
  sesiones().push({ id: "cal_E", email: "e@c.com", inicia: hace(60), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/E", grabacion: "https://fathom.video/share/no_visible" });
  sesiones().push({ id: "cal_G", email: "g@c.com", inicia: hace(62), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/G", grabacion: "https://fathom.video/share/ni_idea" });
  sesiones().push({ id: "cal_F", email: "f@c.com", inicia: hace(61), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/F", grabacion: "https://fathom.video/share/tampoco" });
  const e = await estadoDeLinks(db);
  assert.deepEqual(e.faltanPorCloser, [{ closer: "Mariano Arias", n: 3 }, { closer: "Cami Ruiz", n: 2 }]);
});

test("lo que grabó un closer de afuera de la organización se trae pidiéndolo por su correo de Equipo", async () => {
  sembrar();
  red.nube.filas("equipo").push({ id: "eq_2", nombre: "Externo Gómez", email: "Externo@Gmail.com", rol: "closer" });
  red.nube.filas("equipo").push({ id: "eq_3", nombre: "Setter", email: "setter@x.com", rol: "setter" });
  sesiones().push({ id: "cal_X", email: "x@cliente.com", inicia: hace(6), anfitrion: "Externo Gómez", estado: "agendada", calendlyInvitadoUri: "u/X", grabacion: "https://fathom.video/share/rec_externo" });
  const { valor: r } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 20 }));
  assert.equal(r.estado, "terminado", r.error);
  assert.ok(graba().some((g) => g.recordingId === "rec_externo" && g.sesionId === "cal_X" && g.emparejadaPor === "link"));
  assert.ok(pedidos.some((p) => p.includes("recorded_by%5B%5D=externo%40gmail.com")), "lo pidió por su correo");
  assert.ok(!pedidos.some((p) => p.includes("setter%40x.com")), "sólo closers");
});

/* ---------- que no pase en silencio ---------- */

const avisos = () => red.nube.filas("avisos");
const sembrarPrivadas = () => {
  red.nube.vaciar();
  pedidos = [];
  sesiones().push(
    { id: "cal_P1", email: "a@c.com", inicia: hace(100), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/P1", grabacion: "https://fathom.video/share/privada_1" },
    { id: "cal_P2", email: "b@c.com", inicia: hace(60), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/P2", grabacion: "https://fathom.video/share/privada_2" },
    { id: "cal_P3", email: "c@c.com", inicia: hace(5), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: "u/P3", grabacion: "https://fathom.video/share/privada_3" },
  );
  red.nube.filas("equipo").push({ id: "eq_m", nombre: "Mariano Arias", email: "Mariano@x.com", rol: "closer" });
  red.nube.filas("usuarios_permitidos").push({ email: "yari@x.com", rol: "dueno", id: "u1" }, { email: "santi@x.com", rol: "director", id: "u2" }, { email: "closer@x.com", rol: "closer", id: "u3" });
};

test("tras un barrido completo, las grabaciones privadas con más de 36 horas avisan al closer y a los supervisores, una sola vez", async () => {
  sembrarPrivadas();
  const { valor: r } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 60_000, maxPaginas: 20 }));
  assert.equal(r.estado, "terminado");
  assert.equal(r.tipo, "completo");
  const { valor: n } = await capturandoConsola(() => avisarDeFathom(db, r));
  assert.equal(n, 3, "el closer, el dueño y el director");
  const para = (m: string) => avisos().filter((a) => a.para === m);
  assert.equal(para("mariano@x.com").length, 1);
  assert.match(String(para("mariano@x.com")[0].titulo), /^2 grabaciones de Fathom que la app no puede ver/);
  assert.match(String(para("mariano@x.com")[0].cuerpo), /Visible to Sales Only/);
  assert.equal(para("yari@x.com").length, 1);
  assert.match(String(para("santi@x.com")[0].cuerpo), /Mariano Arias 2/);
  assert.equal(para("closer@x.com").length, 0, "otros tipos de cuenta no reciben nada");
  assert.ok(avisos().every((a) => a.tipo === "fathom"));
  /* Otra vuelta el mismo día: no se repiten. */
  await capturandoConsola(() => avisarDeFathom(db, r));
  assert.equal(avisos().length, 3);
});

test("un barrido de lo fresco no dice que una grabación no llega: sólo el completo", async () => {
  sembrarPrivadas();
  const { valor: n } = await capturandoConsola(() => avisarDeFathom(db, { ok: true, estado: "terminado", tipo: "fresco", paginas: 1, vistas: 0, nuevas: 0, porLink: 0, pendientes: 3 }));
  assert.equal(n, 0);
});

test("si la conexión con Fathom falla, los dueños se enteran por la campanita (uno por día)", async () => {
  sembrarPrivadas();
  const caida = { ok: false, estado: "en-curso" as const, tipo: "completo" as const, error: "Fathom no aceptó la clave (FATHOM_API_KEY).", paginas: 0, vistas: 0, nuevas: 0, porLink: 0, pendientes: 3 };
  await capturandoConsola(() => avisarDeFathom(db, caida));
  await capturandoConsola(() => avisarDeFathom(db, caida));
  const deError = avisos().filter((a) => String(a.titulo).startsWith("Fathom dejó de traer"));
  assert.deepEqual(deError.map((a) => a.para), ["yari@x.com"]);
  assert.match(String(deError[0].cuerpo), /no aceptó la clave/);
});

test("un barrido completo que lleva más de 3 días sin terminar avisa a los dueños", async () => {
  sembrarPrivadas();
  red.nube.filas("fathom_barrido").push({ id: 1, ultimoCompleto: hace(24 * 5), ultimoFresco: hace(1), cursor: null });
  await capturandoConsola(() => avisarDeFathom(db, { ok: true, estado: "nada", paginas: 0, vistas: 0, nuevas: 0, porLink: 0, pendientes: 3 }));
  assert.ok(avisos().some((a) => a.para === "yari@x.com" && /lleva días sin terminar/.test(String(a.titulo))));
});
