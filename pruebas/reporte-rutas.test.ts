import test from "node:test";
import assert from "node:assert/strict";

/* Las rutas del reporte semanal, sin base ni sesión: lo que tienen que hacer ANTES de tocar nada. */
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM"]) delete process.env[k];

const { GET, POST } = await import("@/app/api/reportes/enviar/route");
const enlace = await import("@/app/api/reportes/enlace/route");
const avisar = await import("@/app/api/reportes/avisar/route");

const CODIGO = "3f2b8c1e-9d4a-4e6b-8a57-1c0d2e3f4a5b";
let n = 0;
const ip = () => `10.0.${Math.floor(++n / 250)}.${n % 250}`;
const post = (cuerpo: unknown, cabeceras: Record<string, string> = {}, direccion = "http://app.test/api/reportes/enviar") =>
  new Request(direccion, { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip(), ...cabeceras }, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) });
const bueno = { codigo: CODIGO, horas: 5, entrevistas: 1, postulaciones: 3 };

test("público: un código que no es un UUID se rechaza antes de ir a la base", async () => {
  const r = await POST(post({ ...bueno, codigo: "APYON0007" }));
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.equal(j.campo, "codigo");
});

test("público: el campo trampa dice que salió bien y no guarda nada (ni siquiera pregunta por la base)", async () => {
  const r = await POST(post({ ...bueno, sitio: "http://spam.example" }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("público: faltan cifras, números fuera de rango y cuerpos que no son JSON o son enormes", async () => {
  assert.equal((await POST(post({ codigo: CODIGO, horas: 1 }))).status, 400);
  assert.equal((await POST(post({ ...bueno, horas: 500 }))).status, 400);
  assert.equal((await POST(post("esto no es json"))).status, 400);
  const grande = await POST(post({ ...bueno, bloqueo: "x".repeat(100_000) }));
  assert.equal(grande.status, 413);
  /* Un formulario de Hackear Biz entero, con las respuestas largas al tope, entra. */
  const largas = Object.fromEntries(["trabajo", "accion", "marca", "logro", "bloqueo", "objetivo", "ayuda"].map((k) => [k, "ñ".repeat(2000)]));
  const entero = await POST(post({ codigo: CODIGO, formulario: "hackear-biz", respuestas: { ...BIZ, ...largas } }));
  assert.equal(entero.status, 503, "pasa la lectura y recién ahí falta la base");
});

const BIZ = {
  trabajo: "a", accion: "b", marca: "c", publicaciones: "Ninguna.", conversaciones: "0", ventas: "0", logro: "d", bloqueo: "e",
  compromiso: 8, objetivo: "f", ayuda: "g", clase: "Sí",
};

test("público: el formulario de Hackear Biz revisa cada pregunta y dice cuál falló", async () => {
  const falta = await POST(post({ codigo: CODIGO, formulario: "hackear-biz", respuestas: { ...BIZ, ventas: "" } }));
  assert.equal(falta.status, 400);
  assert.equal((await falta.json()).campo, "ventas");
  const escala = await POST(post({ codigo: CODIGO, formulario: "hackear-biz", respuestas: { ...BIZ, compromiso: 11 } }));
  assert.equal(escala.status, 400);
  assert.equal((await escala.json()).campo, "compromiso");
  const otro = await POST(post({ codigo: CODIGO, formulario: "hackear-xx", respuestas: BIZ }));
  assert.equal(otro.status, 400);
  assert.equal((await otro.json()).campo, "formulario");
  const bien = await POST(post({ codigo: CODIGO, formulario: "hackear-biz", respuestas: BIZ }));
  assert.equal(bien.status, 503, "todo bien, pero sin base configurada");
});

test("público: con todo bien pero sin base configurada contesta 503, sin decir nada de nadie", async () => {
  const r = await POST(post(bueno));
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /todavía no está habilitado/);
});

test("público: un mismo IP que insiste se frena (429)", async () => {
  const mismo = "10.9.9.9";
  const estados: number[] = [];
  for (let i = 0; i < 24; i++) estados.push((await POST(post({ ...bueno, codigo: "no" }, { "x-forwarded-for": mismo }))).status);
  assert.equal(estados[0], 400);
  assert.equal(estados[estados.length - 1], 429);
  assert.ok(estados.indexOf(429) >= 20 && estados.indexOf(429) <= 21, `primer 429 en ${estados.indexOf(429)}`);
});

test("público: el GET con un código malo da el mismo 404 que uno inexistente, y sin código también", async () => {
  const sin = await GET(new Request("http://app.test/api/reportes/enviar", { headers: { "x-forwarded-for": ip() } }));
  const malo = await GET(new Request("http://app.test/api/reportes/enviar?c=123", { headers: { "x-forwarded-for": ip() } }));
  assert.equal(sin.status, 404);
  assert.equal(malo.status, 404);
  assert.deepEqual(await sin.json(), await malo.json());
});

test("interno: sin sesión, el link y el aviso se rechazan (401): el código es la llave de ese alumno", async () => {
  const conLink = await enlace.POST(post({ alumnoId: "alu_1" }, {}, "http://app.test/api/reportes/enlace"));
  assert.equal(conLink.status, 401);
  const conAviso = await avisar.POST(post({ alumnoIds: ["alu_1"] }, {}, "http://app.test/api/reportes/avisar"));
  assert.equal(conAviso.status, 401);
});

test("el resto de /api/reportes sigue cerrado: el webhook pide su token", async () => {
  /* El resto de /api/reportes (el webhook) sigue pidiendo su token. */
  const { POST: webhook } = await import("@/app/api/reportes/webhook/route");
  delete process.env.REPORTES_WEBHOOK_TOKEN;
  const r = await webhook(post([{ email: "a@b.co", horas: 1 }], {}, "http://app.test/api/reportes/webhook"));
  assert.equal(r.status, 503);
});
