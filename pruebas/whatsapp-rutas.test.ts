import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as postGrupos } from "@/app/api/whatsapp/grupos/route";
import { POST as postLatido } from "@/app/api/whatsapp/latido/route";
import { GET as getEstado } from "@/app/api/whatsapp/estado/route";
import { GET as getWebinar, POST as postWebinar } from "@/app/api/whatsapp/webinar/route";
import { RepoMemoria, tokenValido, leerAccion, recibirGrupo, sinNumeros } from "@/lib/whatsapp-servidor";
import { validarCuerpoGrupo } from "@/lib/whatsapp";

/* Las rutas de /api del lector, de punta a punta con el archivo de prueba
   local (sin Supabase): lo que se manda, lo que contestan y lo que queda. */

const TOKEN = "token-de-prueba-que-no-es-real";
const G = "120363025246125486@g.us";
const A = "5491100000001", B = "5491100000002", C = "5491100000003";

const pedido = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${ruta}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
const delLector = { authorization: `Bearer ${TOKEN}` };
const leer = async (r: Response) => (await r.json()) as Record<string, any>;

/* Cada prueba con su archivo y su entorno, y todo vuelve a como estaba. */
async function conEntorno(env: Record<string, string | undefined>, f: () => Promise<void>) {
  const antes: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { antes[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { await f(); } finally { for (const k of Object.keys(env)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; } }
}
async function conArchivo(f: () => Promise<void>, extra: Record<string, string | undefined> = {}) {
  const carpeta = mkdtempSync(join(tmpdir(), "apicanta-wa-"));
  try {
    await conEntorno({ WHATSAPP_LECTOR_TOKEN: TOKEN, WHATSAPP_ARCHIVO_LOCAL: join(carpeta, "datos.json"), NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, ...extra }, f);
  } finally { rmSync(carpeta, { recursive: true, force: true }); }
}

test("sin WHATSAPP_LECTOR_TOKEN en la app: 503 con un mensaje claro, aunque manden un token", async () => {
  await conEntorno({ WHATSAPP_LECTOR_TOKEN: undefined }, async () => {
    for (const [ruta, post] of [["/api/whatsapp/grupos", postGrupos], ["/api/whatsapp/latido", postLatido]] as const) {
      const r = await post(pedido(ruta, {}, delLector));
      assert.equal(r.status, 503, ruta);
      assert.match((await leer(r)).error, /WHATSAPP_LECTOR_TOKEN/);
    }
  });
});

test("sin el token, o con otro: 401", async () => {
  await conArchivo(async () => {
    const cuerpo = { grupo: { id: G, nombre: "x" }, evento: "foto", participantes: [A] };
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", cuerpo))).status, 401);
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", cuerpo, { authorization: "Bearer otro" }))).status, 401);
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", cuerpo, { authorization: TOKEN }))).status, 401, "sin «Bearer»");
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", cuerpo, { authorization: "Bearer " }))).status, 401);
    assert.equal((await postLatido(pedido("/api/whatsapp/latido", { conectado: true }))).status, 401);
    /* Con el correcto, pasa. */
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", cuerpo, delLector))).status, 200);
  });
});

test("el token se compara en tiempo constante: igual sólo si es idéntico", () => {
  assert.equal(tokenValido("abc", "abc"), true);
  assert.equal(tokenValido("abd", "abc"), false);
  assert.equal(tokenValido("abcd", "abc"), false);
  assert.equal(tokenValido("ab", "abc"), false);
  assert.equal(tokenValido("", "abc"), false);
  assert.equal(tokenValido(null, "abc"), false);
  assert.equal(tokenValido("abc", ""), false);
});

test("cuerpos que no sirven: 400 con qué falta, 413 si es enorme", async () => {
  await conArchivo(async () => {
    const mal = await postGrupos(pedido("/api/whatsapp/grupos", "esto no es json", delLector));
    assert.equal(mal.status, 400);
    assert.match((await leer(mal)).error, /JSON/);

    const sinGrupo = await postGrupos(pedido("/api/whatsapp/grupos", { evento: "foto", participantes: [] }, delLector));
    assert.equal(sinGrupo.status, 400);
    assert.match((await leer(sinGrupo)).error, /grupo/);

    const enorme = await postGrupos(pedido("/api/whatsapp/grupos", { grupo: { id: G }, evento: "foto", participantes: ["5".repeat(30)] }, { ...delLector, "content-length": "5000000" }));
    assert.equal(enorme.status, 413);

    const textoGrande = JSON.stringify({ grupo: { id: G }, evento: "foto", participantes: [], relleno: "x".repeat(1_100_000) });
    assert.equal((await postGrupos(pedido("/api/whatsapp/grupos", textoGrande, delLector))).status, 413);

    const latidoMalo = await postLatido(pedido("/api/whatsapp/latido", { conectado: "sí" }, delLector));
    assert.equal(latidoMalo.status, 400);
  });
});

test("de punta a punta: latido, foto, avisos, atar al webinar y ver quién está adentro", async () => {
  await conArchivo(async () => {
    /* El latido: el lector está vivo y conectado. */
    const l = await postLatido(pedido("/api/whatsapp/latido", { en: new Date().toISOString(), conectado: true, grupos: 1 }, delLector));
    assert.equal(l.status, 200);
    const estado1 = await leer(await getEstado(new Request("http://localhost/api/whatsapp/estado")));
    assert.equal(estado1.configurado, true);
    assert.equal(estado1.modo, "prueba-local");
    assert.equal(estado1.lector.conectado, true);
    assert.deepEqual(estado1.grupos, []);

    /* La primera foto: tres adentro, y uno que WhatsApp no deja ver por teléfono. */
    const f1 = await postGrupos(pedido("/api/whatsapp/grupos", {
      grupo: { id: G, nombre: "Webinar 08/10 - Grupo 1" }, evento: "foto", en: new Date(Date.now() - 60_000).toISOString(),
      participantes: [`${A}@s.whatsapp.net`, B, `+${C}`], total: 4, sinTelefono: 1,
    }, delLector));
    assert.equal(f1.status, 200);
    const j1 = await leer(f1);
    assert.deepEqual([j1.recibidos, j1.validos, j1.descartados, j1.nuevos, j1.miembros], [3, 3, 0, 3, 3]);
    assert.ok(!JSON.stringify(j1).includes(A), "la respuesta no devuelve teléfonos");

    /* El grupo aparece solo, todavía sin webinar. */
    const estado2 = await leer(await getEstado(new Request("http://localhost/api/whatsapp/estado")));
    assert.equal(estado2.grupos.length, 1);
    assert.deepEqual([estado2.grupos[0].nombre, estado2.grupos[0].webinarId, estado2.grupos[0].miembros, estado2.grupos[0].sinTelefono], ["Webinar 08/10 - Grupo 1", null, 3, 1]);

    /* Atarlo a un webinar. */
    const atar = await postWebinar(pedido("/api/whatsapp/webinar", { accion: "atar", grupoId: G, webinarId: "web_8" }));
    assert.equal(atar.status, 200);
    assert.equal((await postWebinar(pedido("/api/whatsapp/webinar", { accion: "atar", grupoId: "otro@g.us", webinarId: "web_8" }))).status, 404);

    /* Un aviso: B salió. */
    const sale = await postGrupos(pedido("/api/whatsapp/grupos", { grupo: { id: G, nombre: "Webinar 08/10 - Grupo 1" }, evento: "salio", participantes: [B] }, delLector));
    assert.equal((await leer(sale)).salieron, 1);

    const w = await leer(await getWebinar(new Request("http://localhost/api/whatsapp/webinar?id=web_8")));
    assert.deepEqual(w.dentro.sort(), [A, C]);
    assert.deepEqual(Object.keys(w.salieron), [B]);
    assert.equal(w.grupos.length, 1);
    assert.equal(w.grupos[0].miembros, 2);

    /* De otro webinar no hay nada. */
    const otro = await leer(await getWebinar(new Request("http://localhost/api/whatsapp/webinar?id=web_9")));
    assert.deepEqual([otro.grupos, otro.dentro], [[], []]);

    /* Soltarlo. */
    assert.equal((await postWebinar(pedido("/api/whatsapp/webinar", { accion: "soltar", grupoId: G }))).status, 200);
    assert.deepEqual((await leer(await getWebinar(new Request("http://localhost/api/whatsapp/webinar?id=web_8")))).dentro, []);
  });
});

test("lo que no se entiende de la pantalla se rechaza", async () => {
  await conArchivo(async () => {
    for (const cuerpo of [{}, { accion: "borrar" }, { accion: "contactado", webinarId: "w", personaId: "p" }, { accion: "atar" }, { accion: "atar", grupoId: G }, { accion: "soltar" }, "x"]) {
      assert.equal((await postWebinar(pedido("/api/whatsapp/webinar", cuerpo))).status, 400, JSON.stringify(cuerpo));
    }
    assert.equal((await getWebinar(new Request("http://localhost/api/whatsapp/webinar"))).status, 400);
    assert.equal((await getWebinar(new Request("http://localhost/api/whatsapp/webinar?id=a%20b"))).status, 400);
    assert.equal(leerAccion({ accion: "atar", grupoId: G, webinarId: "web_1" }).ok, true);
  });
});

test("en producción, sin la clave de servicio, no guarda: dice qué falta", async () => {
  await conArchivo(async () => {
    const r = await postGrupos(pedido("/api/whatsapp/grupos", { grupo: { id: G }, evento: "foto", participantes: [A] }, delLector));
    assert.equal(r.status, 503);
    assert.match((await leer(r)).error, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.equal((await getEstado(new Request("http://localhost/api/whatsapp/estado"))).status, 503);
  }, { NODE_ENV: "production" });
});

test("con Supabase configurado en la app pero sin clave de servicio, tampoco cae a un archivo", async () => {
  await conArchivo(async () => {
    const r = await postGrupos(pedido("/api/whatsapp/grupos", { grupo: { id: G }, evento: "foto", participantes: [A] }, delLector));
    assert.equal(r.status, 503);
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://ejemplo.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x" });
});

/* ---------- las reglas del grupo, sin pasar por HTTP ---------- */

const cuerpo = (evento: "foto" | "entro" | "salio", telefonos: string[], en: string, extra: object = {}) => {
  const v = validarCuerpoGrupo({ grupo: { id: G, nombre: "Grupo" }, evento, participantes: telefonos, en, ...extra }, new Date("2026-10-07T18:00:00Z"));
  assert.ok(v.ok);
  return (v as { valor: Parameters<typeof recibirGrupo>[1] }).valor;
};
const T = (min: number) => new Date(new Date("2026-10-07T18:00:00Z").getTime() - min * 60_000).toISOString();

test("una foto que llega tarde no pisa una más nueva, ni una vacía vacía el grupo", async () => {
  const repo = new RepoMemoria();
  await recibirGrupo(repo, cuerpo("foto", [A, B], T(10)));
  const vieja = await recibirGrupo(repo, cuerpo("foto", [A], T(20)));
  assert.match(vieja.ignorada ?? "", /más nueva/);
  const vacia = await recibirGrupo(repo, cuerpo("foto", [], T(5)));
  assert.match(vacia.ignorada ?? "", /vacía/);
  assert.equal((await repo.leerGrupo(G))?.miembros, 2);
  assert.equal(await repo.contarDentro(G), 2);
});

test("un aviso de antes de la última foto no hace nada: ya está en la foto", async () => {
  const repo = new RepoMemoria();
  await recibirGrupo(repo, cuerpo("foto", [A, B], T(10)));
  const viejo = await recibirGrupo(repo, cuerpo("salio", [B], T(15)));
  assert.match(viejo.ignorada ?? "", /última foto/);
  const nuevo = await recibirGrupo(repo, cuerpo("salio", [B], T(5)));
  assert.equal(nuevo.salieron, 1);
  assert.equal(nuevo.miembros, 1);
});

test("una foto con participantes sin teléfono visible no saca a nadie, y la siguiente sin ellos sí", async () => {
  const repo = new RepoMemoria();
  await recibirGrupo(repo, cuerpo("foto", [A, B], T(30)));
  const conLid = await recibirGrupo(repo, cuerpo("foto", [A], T(20), { sinTelefono: 2, total: 3 }));
  assert.equal(conLid.salieron, 0);
  assert.equal(conLid.miembros, 2);
  const limpia = await recibirGrupo(repo, cuerpo("foto", [A], T(10), { sinTelefono: 0 }));
  assert.equal(limpia.salieron, 1);
  assert.equal(limpia.miembros, 1);
});

test("los avisos de un grupo que todavía no tiene foto lo crean, y la primera foto después no los pisa", async () => {
  const repo = new RepoMemoria();
  const e = await recibirGrupo(repo, cuerpo("entro", [A], T(20)));
  assert.equal(e.nuevos, 1);
  assert.equal((await repo.leerGrupo(G))?.ultimaFoto, null);
  const f = await recibirGrupo(repo, cuerpo("foto", [A, B], T(10)));
  assert.equal(f.nuevos, 1, "B es nuevo; A ya estaba");
  const miembros = await repo.leerMiembros(G);
  assert.equal(miembros.find((m) => m.telefono === A)?.entro, T(20), "A conserva cuándo lo vimos entrar");
});

test("los errores de la base no llevan teléfonos", () => {
  assert.equal(sinNumeros("Key (grupoId, telefono)=(120363025246125486@g.us, 5491155551234) already exists"), "Key (grupoId, telefono)=(…@g.us, …) already exists");
});
