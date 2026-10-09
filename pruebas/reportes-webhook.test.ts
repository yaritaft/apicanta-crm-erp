import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/reportes/webhook/route";
import { leerItems, MAX_REPORTES_POR_PEDIDO, planificarReportes, type AlumnoBasico, type ReporteExistente } from "@/lib/reportes-webhook";
import { recibirReportes, type BaseReportes } from "@/lib/reportes-servidor";
import type { Reporte } from "@/lib/types";

const HOY = "2026-10-08"; /* jueves: su semana empieza el lunes 2026-10-05 */
const AHORA = "2026-10-08T15:00:00.000Z";
const ALUMNOS: AlumnoBasico[] = [
  { id: "a1", nombre: "Ana López", email: "Ana@Mail.com" },
  { id: "a2", nombre: "Beto Pérez", email: "beto@mail.com" },
  { id: "a3", nombre: "Juan Gómez", email: "juan1@mail.com" },
  { id: "a4", nombre: "juan gómez", email: "juan2@mail.com" },
];

/* ---------- Entender lo que manda la herramienta ---------- */

test("un reporte, una lista o {reportes: [...]} se leen igual, con los nombres de datos que traiga un formulario o el Airtable", () => {
  const uno = leerItems({ email: "ana@mail.com", semana: "2026-10-08", horas: 10, entrevistas: 2, postulaciones: "5", bloqueo: "Nada" });
  assert.deepEqual(uno.items, [{ posicion: 1, item: { email: "ana@mail.com", alumno: "", dia: "2026-10-08", horas: 10, entrevistas: 2, postulaciones: 5, bloqueo: "Nada" } }]);
  assert.deepEqual(uno.rechazados, []);
  /* Los títulos de un Airtable, con mayúsculas, tildes y espacios. */
  const airtable = leerItems({ Mail: "ana@mail.com", "Created time": "2026-10-08T14:00:00.000Z", "Horas de estudio": "7,5", Postulaciones: 3, "Comentarios": "Me trabé en SQL", Alumno: "Ana López" });
  assert.deepEqual(airtable.items[0].item, { email: "ana@mail.com", alumno: "Ana López", dia: "2026-10-08", horas: 7.5, entrevistas: undefined, postulaciones: 3, bloqueo: "Me trabé en SQL" });
  assert.equal(leerItems([{ email: "a@b.com" }, { email: "c@d.com" }]).items.length, 2);
  assert.equal(leerItems({ reportes: [{ email: "a@b.com" }] }).items.length, 1);
  /* Sin semana: no se inventa una; se toma la de hoy al planificar. */
  assert.equal(leerItems({ email: "a@b.com" }).items[0].item.dia, undefined);
  assert.equal(leerItems({ email: "a@b.com", semana: "08/10/2026" }).items[0].item.dia, "2026-10-08", "día/mes/año");
});

test("lo que no se entiende se rechaza con su posición y su motivo, y el resto entra", () => {
  const r = leerItems([
    { email: "ok@mail.com", horas: 5 },
    { email: "esto-no-es-un-mail" },
    {},
    "texto",
    { email: "x@mail.com", semana: "pronto" },
    { email: "x@mail.com", horas: -3 },
    { email: "x@mail.com", horas: 500 },
    { email: "x@mail.com", entrevistas: "muchas" },
    { alumno: "Sólo Nombre", horas: 2 },
  ]);
  assert.deepEqual(r.items.map((x) => x.posicion), [1, 9], "el que sólo trae nombre se lee (se busca por nombre al planificar)");
  assert.deepEqual(r.rechazados.map((x) => x.posicion), [2, 3, 4, 5, 6, 7, 8]);
  assert.match(r.rechazados[0].motivo, /mail no parece válido/);
  assert.match(r.rechazados[1].motivo, /de qué alumno es/);
  assert.match(r.rechazados[3].motivo, /semana no se entendió/);
  assert.match(r.rechazados[4].motivo, /horas de estudio tienen que ser un número/i);
  assert.match(r.rechazados[6].motivo, /entrevistas tienen que ser un número/i);
});

test("un pedido vacío, enorme o que no es un reporte da un error claro", () => {
  assert.match(leerItems([]).error ?? "", /ningún reporte/);
  assert.match(leerItems("hola").error ?? "", /un reporte/);
  assert.match(leerItems(null).error ?? "", /un reporte/);
  assert.match(leerItems(Array.from({ length: MAX_REPORTES_POR_PEDIDO + 1 }, () => ({ email: "a@b.com" }))).error ?? "", /hasta 200/);
  assert.equal(leerItems(Array.from({ length: MAX_REPORTES_POR_PEDIDO }, () => ({ email: "a@b.com" }))).error, undefined);
  /* Un texto larguísimo se corta. */
  assert.equal(leerItems({ email: "a@b.com", bloqueo: "x".repeat(10_000) }).items[0].item.bloqueo?.length, 2000);
});

/* ---------- De qué alumno es y en qué semana cae ---------- */

const items = (...xs: Parameters<typeof leerItems>[0][]) => leerItems(xs).items;

test("el reporte cae en el lunes de su semana, se busca al alumno por mail (sin importar mayúsculas) y se arma con lo que vino", () => {
  const p = planificarReportes(items({ email: "ana@mail.com", semana: "2026-10-08", horas: 10, entrevistas: 2, postulaciones: 5, bloqueo: "Nada" }), ALUMNOS, [], HOY, AHORA);
  assert.deepEqual(p.filas, [{
    id: "rep_cs_a1_2026-10-05", alumnoId: "a1", semanaDel: "2026-10-05", estado: "completado", completadoEn: "2026-10-08T12:00:00.000Z",
    horasEstudio: 10, entrevistas: 2, postulaciones: 5, bloqueo: "Nada",
  }]);
  assert.deepEqual([p.nuevos, p.actualizados, p.rechazados], [1, 0, []]);
  /* Un reporte de domingo es de la semana que termina ese día (el lunes anterior). */
  assert.equal(planificarReportes(items({ email: "ana@mail.com", semana: "2026-10-11" }), ALUMNOS, [], HOY, AHORA).filas[0].semanaDel, "2026-10-05");
  assert.equal(planificarReportes(items({ email: "ana@mail.com", semana: "2026-10-12" }), ALUMNOS, [], HOY, AHORA).filas[0].semanaDel, "2026-10-12");
});

test("sin semana es la de hoy, y sin los datos opcionales no se inventan", () => {
  const p = planificarReportes(items({ email: "beto@mail.com" }), ALUMNOS, [], HOY, AHORA);
  assert.deepEqual(p.filas, [{ id: "rep_cs_a2_2026-10-05", alumnoId: "a2", semanaDel: "2026-10-05", estado: "completado", completadoEn: AHORA }]);
});

test("el nombre sólo sirve si es de un solo alumno; el mail que no existe se rechaza", () => {
  const p = planificarReportes(
    leerItems([{ alumno: "ANA LÓPEZ" }, { alumno: "Juan Gómez" }, { email: "nadie@mail.com" }, { alumno: "Desconocido" }, { email: "juan1@mail.com" }]).items,
    ALUMNOS, [], HOY, AHORA,
  );
  assert.deepEqual(p.filas.map((f) => f.alumnoId), ["a1", "a3"]);
  assert.deepEqual(p.rechazados.map((r) => [r.posicion, r.motivo.replace(/:.*/, "")]), [
    [2, "Hay más de un alumno con ese nombre"], [3, "No hay un alumno con ese mail."], [4, "No hay un alumno con ese nombre"],
  ]);
  /* Con dos alumnos con el mismo mail no se adivina. */
  const repetido = planificarReportes(items({ email: "dup@mail.com" }), [{ id: "x", nombre: "A", email: "dup@mail.com" }, { id: "y", nombre: "B", email: "DUP@mail.com" }], [], HOY, AHORA);
  assert.equal(repetido.filas.length, 0);
  assert.match(repetido.rechazados[0].motivo, /más de un alumno con ese mail/);
});

test("mandar de nuevo el reporte de la misma semana lo reemplaza, y el que ya había se actualiza con su mismo id", () => {
  const existentes: ReporteExistente[] = [{ id: "rep_viejo", alumnoId: "a1", semanaDel: "2026-10-06" }];
  const p = planificarReportes(items({ email: "ana@mail.com", semana: "2026-10-08", horas: 8 }, { email: "beto@mail.com", horas: 1 }, { email: "beto@mail.com", horas: 2 }), ALUMNOS, existentes, HOY, AHORA);
  const ana = p.filas.find((f) => f.alumnoId === "a1")!;
  assert.deepEqual([ana.id, ana.semanaDel, ana.horasEstudio], ["rep_viejo", "2026-10-05", 8], "el de esa semana, cargado un martes, es el mismo");
  assert.equal(p.filas.filter((f) => f.alumnoId === "a2").length, 1, "dos de Beto esa semana en un pedido: queda uno");
  assert.equal(p.filas.find((f) => f.alumnoId === "a2")!.horasEstudio, 2, "el último gana");
  assert.deepEqual([p.nuevos, p.actualizados], [1, 1]);
});

/* ---------- De punta a punta, con una base de mentira ---------- */

function base(existentes: ReporteExistente[] = []) {
  const guardados: Reporte[] = [];
  const consultas: string[][] = [];
  const b: BaseReportes = {
    alumnos: async () => ALUMNOS,
    reportesDe: async (ids) => { consultas.push(ids); return existentes.filter((r) => ids.includes(r.alumnoId)); },
    guardar: async (filas) => { guardados.push(...filas); },
  };
  return { b, guardados, consultas };
}

test("recibir reportes guarda lo que se entendió y cuenta lo demás", async () => {
  const { b, guardados, consultas } = base([{ id: "rep_viejo", alumnoId: "a1", semanaDel: "2026-10-05" }]);
  const r = await recibirReportes(b, [{ email: "ana@mail.com", horas: 4 }, { email: "beto@mail.com", horas: 6 }, { email: "esto-no-es-un-mail" }, { email: "nadie@mail.com" }], HOY, AHORA);
  assert.deepEqual(r, {
    ok: true, recibidos: 4, guardados: 2, nuevos: 1, actualizados: 1,
    rechazados: [{ posicion: 3, motivo: "El mail no parece válido." }, { posicion: 4, motivo: "No hay un alumno con ese mail." }],
  });
  assert.deepEqual(guardados.map((g) => g.id).sort(), ["rep_cs_a2_2026-10-05", "rep_viejo"]);
  assert.deepEqual(consultas, [["a1", "a2"]], "sólo se piden los reportes de los alumnos que tocan");
});

test("si no hay nada que guardar no se toca la base; si el pedido no se entiende, 400", async () => {
  const { b, guardados, consultas } = base();
  const r = await recibirReportes(b, [{ email: "nadie@mail.com" }], HOY, AHORA);
  assert.equal(r.ok && r.guardados, 0);
  assert.deepEqual([guardados.length, consultas.length], [0, 0], "no hay reportes que pedir ni guardar");
  assert.deepEqual(await recibirReportes(b, [], HOY, AHORA), { ok: false, status: 400, error: "No hay ningún reporte para guardar." });
});

/* ---------- La ruta ---------- */

async function conEntorno(env: Record<string, string | undefined>, f: () => Promise<void>) {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { antes[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { await f(); } finally { for (const k of Object.keys(env)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
}
const pedido = (cuerpo: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/reportes/webhook", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
const TOKEN = "token-de-prueba-de-los-reportes";

test("la ruta pide su secreto: sin variable 503, con otro token 401, y sin base 503", async () => {
  await conEntorno({ REPORTES_WEBHOOK_TOKEN: undefined }, async () => {
    const r = await POST(pedido({ email: "a@b.com" }, { authorization: `Bearer ${TOKEN}` }));
    assert.equal(r.status, 503);
    assert.match(((await r.json()) as { error: string }).error, /REPORTES_WEBHOOK_TOKEN/);
  });
  await conEntorno({ REPORTES_WEBHOOK_TOKEN: TOKEN, SUPABASE_SERVICE_ROLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined }, async () => {
    assert.equal((await POST(pedido({ email: "a@b.com" }))).status, 401, "sin token");
    assert.equal((await POST(pedido({ email: "a@b.com" }, { authorization: "Bearer otro" }))).status, 401, "otro token");
    assert.equal((await POST(pedido({ email: "a@b.com" }, { authorization: `Basic ${TOKEN}` }))).status, 401, "no es Bearer");
    assert.equal((await POST(pedido("{no es json", { authorization: `Bearer ${TOKEN}` }))).status, 400);
    const sinBase = await POST(pedido({ email: "a@b.com" }, { authorization: `Bearer ${TOKEN}` }));
    assert.equal(sinBase.status, 503);
    assert.match(((await sinBase.json()) as { error: string }).error, /SUPABASE_SERVICE_ROLE_KEY/);
    const grande = await POST(pedido({ email: "a@b.com", bloqueo: "x".repeat(450_000) }, { authorization: `Bearer ${TOKEN}` }));
    assert.equal(grande.status, 413);
  });
});
