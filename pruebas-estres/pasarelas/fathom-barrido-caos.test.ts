import test from "node:test";
import assert from "node:assert/strict";
import { Azar, capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el barrido de Fathom con un Fathom caótico: 429 con y sin
   Retry-After, errores 500, 401, cuerpos que no son JSON, reuniones sin
   recording_id, la misma reunión repetida en varias páginas, páginas
   vacías con cursor y un cursor que nunca termina. Con lo que pase:
   el barrido nunca tira un error sin atrapar, nunca guarda dos veces
   la misma grabación ni la ata a una llamada que no tiene su link, y
   si Fathom mejora, termina y deja atadas todas las visibles.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-fathom-caos-falsa-0010";
process.env.FATHOM_API_KEY = "clave-falsa-de-fathom";
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "FATHOM_EQUIPOS"]) delete process.env[k];

const red = instalarFetchFalso();
const { avisarDeFathom, barrerLinks } = await import("@/lib/fathom-barrido-servidor");
const { nubeServidor } = await import("@/lib/servidor");
test.after(() => red.restaurar());
const db = nubeServidor()!;
const sesiones = () => red.nube.filas("sesiones");
const graba = () => red.nube.filas("grabaciones");

const hace = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const reunion = (rec: string, cuando: string) => ({
  recording_id: rec, title: "Llamada", url: `https://fathom.video/calls/${rec}`, share_url: `https://fathom.video/share/${rec}`,
  scheduled_start_time: cuando, recording_start_time: cuando, recording_end_time: cuando, created_at: cuando,
  recorded_by: { name: "Cami Ruiz", email: "cami@apicanta.com" }, calendar_invitees: [{ name: "X", email: "alias@raro.com", is_external: true }],
  default_summary: { markdown_formatted: "## Resumen" }, transcript: [{ speaker: { display_name: "Cami" }, text: "Hola", timestamp: "00:00:01" }], action_items: [],
});

interface Caos { p429: number; p500: number; p401: number; pJsonRoto: number; pBasura: number; cursorInfinito: boolean }

/** Instala un Fathom que se porta mal con probabilidades dadas. `universo` son las reuniones que existen. */
function fathomCaotico(az: Azar, universo: string[], c: Caos) {
  const porPagina = 10;
  let pedidos = 0;
  red.soltar();
  red.manejar((url) => {
    if (url.host !== "api.fathom.ai") return null;
    pedidos++;
    if (url.pathname.endsWith("/teams")) return { json: { items: [{ name: "Sales" }, { name: "Otro" }] } };
    if (az.bool(c.p401)) return new Response("{}", { status: 401 });
    if (az.bool(c.p429)) return new Response("{}", { status: 429, headers: az.bool(0.5) ? { "retry-after": String(az.int(0, 3)) } : {} });
    if (az.bool(c.p500)) return new Response("boom", { status: 500 });
    if (az.bool(c.pJsonRoto)) return new Response("<html>no es json</html>", { status: 200, headers: { "content-type": "text/html" } });
    const desde = Number(url.searchParams.get("cursor")?.replace("c", "") ?? 0) || 0;
    const items: unknown[] = universo.slice(desde, desde + porPagina).map((r) => reunion(r, hace(70)));
    if (az.bool(c.pBasura)) items.push(null, 5, "x", {}, { recording_id: "" }, { meeting: null }, [], { recording_id: { raro: true } });
    if (az.bool(0.2) && items.length) items.push(items[0]);
    const sigue = desde + porPagina < universo.length;
    return { json: { items, next_cursor: c.cursorInfinito ? "c0" : sigue ? `c${desde + porPagina}` : null } };
  });
  return () => pedidos;
}

function mundo(az: Azar) {
  red.nube.vaciar();
  const n = az.int(5, 40);
  const visibles = Array.from({ length: n }, (_, i) => `rec_v${i}`);
  /* Cada reunión visible tiene su llamada con el link (a veces con barra final o parámetros); además, llamadas con links a reuniones que Fathom no muestra. */
  visibles.forEach((r, i) => sesiones().push({
    id: `cal_v${i}`, email: `v${i}@c.com`, inicia: hace(az.int(40, 300)), anfitrion: az.pick(["Mariano Arias", "Dante Barbieri"]), estado: "agendada", calendlyInvitadoUri: `u/v${i}`,
    grabacion: `https://fathom.video/share/${r}${az.pick(["", "/", "?t=3", "/?tab=summary"])}`,
  }));
  const ocultas = az.int(0, 8);
  for (let i = 0; i < ocultas; i++) sesiones().push({
    id: `cal_o${i}`, email: `o${i}@c.com`, inicia: hace(az.int(40, 300)), anfitrion: "Mariano Arias", estado: "agendada", calendlyInvitadoUri: `u/o${i}`, grabacion: `https://fathom.video/share/oculta_${i}`,
  });
  sesiones().push({ id: "cal_drive", email: "d@c.com", inicia: hace(80), anfitrion: "Dante Barbieri", estado: "agendada", calendlyInvitadoUri: "u/d", grabacion: "https://drive.google.com/file/d/1" });
  red.nube.filas("equipo").push({ id: "eq_1", nombre: "Mariano Arias", email: "mariano@x.com", rol: "closer" }, { id: "eq_2", nombre: "Dante Barbieri", email: "dante@x.com", rol: "closer" });
  red.nube.filas("usuarios_permitidos").push({ id: "u1", email: "yari@x.com", rol: "dueno" });
  return { visibles, ocultas };
}

test("un Fathom que se porta mal: nunca rompe, no duplica ni ata mal, y al mejorar termina con todas las visibles atadas", propiedad("barrido caótico", 40, async (az) => {
  const { visibles, ocultas } = mundo(az);
  const caos: Caos = { p429: az.int(0, 35) / 100, p500: az.int(0, 25) / 100, p401: az.bool(0.1) ? 0.3 : 0, pJsonRoto: az.int(0, 15) / 100, pBasura: az.int(0, 50) / 100, cursorInfinito: false };
  fathomCaotico(az, visibles, caos);
  let terminado = false;
  /* Durante el caos: muchas vueltas chicas, con errores. Nada puede tirar. */
  for (let v = 0; v < 120 && !terminado; v++) {
    const { valor: r } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 20_000, maxPaginas: az.int(1, 6), forzar: az.bool(0.3) }));
    assert.ok(["en-curso", "terminado", "esperar", "nada"].includes(r.estado));
    if (r.estado === "terminado") terminado = true;
    await capturandoConsola(() => avisarDeFathom(db, r));
  }
  /* Fathom se arregla: tiene que terminar y dejar todo atado. */
  fathomCaotico(az, visibles, { p429: 0, p500: 0, p401: 0, pJsonRoto: 0, pBasura: 0.3, cursorInfinito: false });
  for (let v = 0; v < 40 && !terminado; v++) {
    const { valor: r } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 20_000, maxPaginas: 50 }));
    if (r.estado === "terminado") terminado = true;
  }
  const rec = graba().map((g) => String(g.recordingId));
  assert.equal(new Set(rec).size, rec.length, "ninguna grabación repetida");
  for (const g of graba()) {
    const s = sesiones().find((x) => x.id === g.sesionId);
    assert.ok(s, `la grabación ${g.recordingId} quedó atada a una llamada que no existe`);
    if (g.emparejadaPor === "link") assert.ok(String(s!.grabacion).includes(String(g.recordingId)), "atada por link a una llamada con OTRO link");
    assert.ok(!String(g.recordingId).startsWith("oculta_"), "una reunión que Fathom no muestra no puede estar guardada");
  }
  assert.ok(terminado, "con Fathom sano el barrido termina");
  const atadas = new Set(graba().map((g) => g.sesionId));
  for (let i = 0; i < visibles.length; i++) assert.ok(atadas.has(`cal_v${i}`), `falta atar cal_v${i} (${visibles.length} visibles, ${ocultas} ocultas)`);
  assert.ok(!atadas.has("cal_drive"));
  const ids = red.nube.filas("avisos").map((a) => String(a.id));
  assert.equal(new Set(ids).size, ids.length, "avisos sin repetir");
}));

test("un Fathom cuyo cursor nunca termina no deja el barrido girando para siempre", async () => {
  const az = new Azar(777);
  const { visibles } = mundo(az);
  fathomCaotico(az, visibles, { p429: 0, p500: 0, p401: 0, pJsonRoto: 0, pBasura: 0, cursorInfinito: true });
  let terminado = false;
  for (let v = 0; v < 5 && !terminado; v++) {
    const { valor: r } = await capturandoConsola(() => barrerLinks(db, { reloj: Date.now() + 20_000, maxPaginas: 30 }));
    if (r.estado === "terminado") terminado = true;
  }
  assert.ok(terminado, "con el mismo cursor una y otra vez hay que darlo por terminado");
});
