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
const { barrerLinks, estadoDeLinks } = await import("@/lib/fathom-barrido-servidor");
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
