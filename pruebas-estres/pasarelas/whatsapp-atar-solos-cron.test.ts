import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el cron diario que ata solos los grupos de WhatsApp a su webinar,
   contra una nube de mentira en memoria: ata sólo lo seguro (fecha completa y
   un único webinar ese día), no pisa lo atado a mano, no se repite y deja su
   constancia en cron_estado.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-atar-grupos-falsa-0009";
process.env.CRON_SECRET = "secreto-de-prueba-del-cron-0009";

const nube = instalarFetchFalso();
const { GET } = await import("@/app/api/cron/whatsapp-atar-grupos/route");
test.after(() => nube.restaurar());

const llamar = (auth?: string) => GET(new Request("http://localhost/api/cron/whatsapp-atar-grupos", { headers: auth ? { authorization: auth } : {} }));
const OK = () => `Bearer ${process.env.CRON_SECRET}`;
const grupo = (id: string, nombre: string, webinarId: string | null = null) => ({ id, nombre, webinarId, miembros: 10, sinTelefono: 0, ultimaFoto: null });

function sembrar() {
  nube.nube.vaciar();
  nube.nube.declarar("whatsapp_grupos", [["id"]]);
  nube.nube.declarar("cron_estado", [["clave"]]);
  nube.nube.tablas.set("whatsapp_grupos", []);
  nube.nube.tablas.set("cron_estado", []);
  nube.nube.filas("webinars").push(
    { id: "w2110", titulo: "Taller 21/10/2026", fecha: "2026-10-21T22:00:00.000Z", estado: "programado", extra: {} },
    { id: "w0411", titulo: "Taller 04/11/2026", fecha: "2026-11-04T22:00:00.000Z", estado: "programado", extra: {} },
    { id: "wa", titulo: "Doble A", fecha: "2026-12-02T22:00:00.000Z", estado: "programado", extra: {} },
    { id: "wb", titulo: "Doble B", fecha: "2026-12-02T15:00:00.000Z", estado: "programado", extra: {} },
  );
  nube.nube.filas("whatsapp_grupos").push(
    grupo("g1", "Taller Online 21/10/26 #1"),
    grupo("g2", "Taller Online 21/10/26 #2"),
    grupo("g3", "Taller Online 04/11/26 #1"),
    grupo("sinanio", "Taller Online 04/11 19 HS (ARG)"),
    grupo("sinfecha", "Yari Taft - taller online #1"),
    grupo("doble", "Taller Online 02/12/26 #1"),
    grupo("manual", "Taller Online 21/10/26 #3", "wa"),
    grupo("sinwebinar", "Taller Online 03/06/26"),
  );
}
const f = (id: string) => nube.nube.filas("whatsapp_grupos").find((x) => x.id === id)!;

test("sin el secreto, o con uno equivocado, no hace nada", async () => {
  sembrar();
  assert.equal((await llamar()).status, 401);
  assert.equal((await llamar("Bearer equivocado")).status, 401);
  assert.equal((await llamar("Bearer undefined")).status, 401);
  assert.equal(f("g1").webinarId, null);
});

test("ata sólo lo seguro: la fecha completa de un único webinar; lo demás queda como estaba", async () => {
  sembrar();
  const res = await llamar(OK());
  assert.equal(res.status, 200);
  const j = (await res.json()) as { atados: { grupo: string; webinarId: string }[]; fallidos: unknown[]; webinars: number };
  assert.equal(j.atados.length, 3);
  assert.deepEqual(j.fallidos, []);
  assert.equal(j.webinars, 4);
  assert.deepEqual([f("g1").webinarId, f("g2").webinarId, f("g3").webinarId], ["w2110", "w2110", "w0411"]);
  assert.equal(f("sinanio").webinarId, null, "sin año no se adivina");
  assert.equal(f("sinfecha").webinarId, null);
  assert.equal(f("doble").webinarId, null, "dos webinars el mismo día: no se sabe cuál");
  assert.equal(f("sinwebinar").webinarId, null, "no hay webinar de esa fecha en la app");
  assert.equal(f("manual").webinarId, "wa", "lo atado a mano no se pisa, ni siquiera si el nombre dice otro día");
});

test("correrlo otra vez no cambia nada; el grupo que esperaba su webinar se ata cuando el webinar aparece", async () => {
  sembrar();
  await llamar(OK());
  const antes = JSON.stringify(nube.nube.filas("whatsapp_grupos"));
  const r2 = (await (await llamar(OK())).json()) as { atados: unknown[] };
  assert.deepEqual(r2.atados, []);
  assert.equal(JSON.stringify(nube.nube.filas("whatsapp_grupos")), antes);
  nube.nube.filas("webinars").push({ id: "w0306", titulo: "Taller 03/06/2026", fecha: "2026-06-03T22:00:00.000Z", estado: "finalizado", extra: {} });
  const r3 = (await (await llamar(OK())).json()) as { atados: { grupo: string }[] };
  assert.deepEqual(r3.atados.map((a) => a.grupo), ["Taller Online 03/06/26"]);
  assert.equal(f("sinwebinar").webinarId, "w0306");
});

test("cada corrida deja su constancia en cron_estado (una sola fila), con lo que ató", async () => {
  sembrar();
  await llamar(OK());
  const fila = () => nube.nube.filas("cron_estado").filter((x) => x.clave === "whatsapp-atar-grupos");
  assert.equal(fila().length, 1);
  assert.equal(fila()[0].ok, true);
  assert.equal(((fila()[0].resultado as { atados: unknown[] }).atados).length, 3);
  assert.ok(fila()[0].ultimaUnionEn, "ató algo: queda cuándo");
  const primera = fila()[0].ultimaUnionEn;
  await llamar(OK());
  assert.equal(fila().length, 1, "sigue siendo una fila");
  assert.equal(fila()[0].ultimaUnionEn, primera, "una corrida sin nada nuevo no mueve «la última vez que ató»");
});

test("sin la tabla cron_estado el cron corre igual; sin las tablas de WhatsApp no falla", async () => {
  sembrar();
  nube.nube.tablas.delete("cron_estado");
  const res = await llamar(OK());
  assert.equal(res.status, 200);
  assert.equal(f("g1").webinarId, "w2110");
  nube.nube.tablas.delete("whatsapp_grupos");
  const sin = await llamar(OK());
  assert.equal(sin.status, 200);
  assert.equal(((await sin.json()) as { sinTablas?: boolean }).sinTablas, true);
});

test("si la base falla al leer, devuelve 502 y no deja nada a medias", async () => {
  sembrar();
  nube.nube.tablas.delete("webinars");
  const res = await llamar(OK());
  assert.equal(res.status, 502);
  assert.equal(f("g1").webinarId, null);
});
