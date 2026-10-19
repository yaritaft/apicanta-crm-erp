import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { analyticsTodavia } from "@/lib/youtube";
import { analyticsDeVideo } from "@/lib/youtube-analytics";
import { pedirApi } from "@/lib/youtube-servidor";

/* ==================================================================
   YouTube Analytics de un webinar que todavía no pasó.

   La ficha del webinar pide los números «desde el día anterior al
   webinar». Con uno programado a futuro, ese día cae después de hoy y
   Google contesta 412 («'start-date' must be before or the same as the
   'end-date'») a cada uno de los ocho reportes: a quien mira se le decía
   «YouTube Analytics no quiso dar los números» y los registros de errores
   de Vercel se llenaban (19/10/2026). Ahora no se le pregunta a Google, y
   se dice que todavía no hay números.

   También: lo esperable (comentarios cerrados, un 404) se anota como aviso
   y no como error, para que los registros de errores muestren sólo lo que
   hay que mirar.
   ================================================================== */

test("un inicio posterior a hoy: todavía no hay números", () => {
  assert.match(analyticsTodavia("2026-10-20", "2026-10-19") ?? "", /Todavía no hay números/);
  assert.match(analyticsTodavia("2027-01-01", "2026-10-19") ?? "", /Todavía no hay números/);
});

test("un inicio de hoy o anterior se puede pedir", () => {
  assert.equal(analyticsTodavia("2026-10-19", "2026-10-19"), null);
  assert.equal(analyticsTodavia("2026-10-18", "2026-10-19"), null);
  assert.equal(analyticsTodavia("2025-12-31", "2026-01-01"), null);
});

test("las fechas comparan bien al cambiar de mes y de año", () => {
  assert.notEqual(analyticsTodavia("2026-11-01", "2026-10-31"), null);
  assert.notEqual(analyticsTodavia("2027-01-01", "2026-12-31"), null);
  assert.equal(analyticsTodavia("2026-10-31", "2026-11-01"), null);
});

test("analyticsDeVideo con un inicio a futuro no le pregunta nada a Google ni a la base", async () => {
  const fetchOriginal = globalThis.fetch;
  const llamadas: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => { llamadas.push(String(url)); throw new Error("no debía llamarse"); }) as typeof fetch;
  try {
    const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await analyticsDeVideo("abcdefghijk", manana);
    assert.ok("todavia" in r, JSON.stringify(r));
    assert.deepEqual(llamadas, []);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("analyticsDeVideo con un inicio pasado sigue su camino (sin canal conectado: error claro, sin llamar a Google)", async () => {
  const fetchOriginal = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (async () => { llamadas += 1; throw new Error("no debía llamarse"); }) as typeof fetch;
  try {
    const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const r = await analyticsDeVideo("abcdefghijk", ayer);
    assert.ok("error" in r && /no está conectado/i.test(r.error), JSON.stringify(r));
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

/* ---------- Qué va al registro de errores y qué a los avisos ---------- */

async function pedirConRespuesta(status: number, motivo: string) {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ error: { code: status, message: motivo, errors: [{ reason: motivo }] } }),
    { status, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
  const error = mock.method(console, "error", () => {});
  const aviso = mock.method(console, "warn", () => {});
  try {
    await pedirApi("commentThreads", { videoId: "abcdefghijk" }, "clave-falsa", 0);
    return { errores: error.mock.callCount(), avisos: aviso.mock.callCount() };
  } finally {
    error.mock.restore();
    aviso.mock.restore();
    globalThis.fetch = fetchOriginal;
  }
}

test("comentarios cerrados (403) y videos que no existen (404) son avisos, no errores", async () => {
  assert.deepEqual(await pedirConRespuesta(403, "commentsDisabled"), { errores: 0, avisos: 1 });
  assert.deepEqual(await pedirConRespuesta(404, "videoNotFound"), { errores: 0, avisos: 1 });
  assert.deepEqual(await pedirConRespuesta(403, "liveChatEnded"), { errores: 0, avisos: 1 });
});

test("lo que sí hay que mirar (cuota, clave inválida, caída de Google) sigue siendo un error", async () => {
  assert.deepEqual(await pedirConRespuesta(403, "quotaExceeded"), { errores: 1, avisos: 0 });
  assert.deepEqual(await pedirConRespuesta(400, "keyInvalid"), { errores: 1, avisos: 0 });
  assert.deepEqual(await pedirConRespuesta(500, "backendError"), { errores: 1, avisos: 0 });
});
