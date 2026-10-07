import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST as postGrupos } from "@/app/api/whatsapp/grupos/route";
import { POST as postLatido } from "@/app/api/whatsapp/latido/route";
import { GET as getEstado } from "@/app/api/whatsapp/estado/route";
import { GET as getWebinar, POST as postWebinar } from "@/app/api/whatsapp/webinar/route";
import { NextResponse } from "next/server";
import { ErrorSinTablaQr, RepoMemoria, tokenValido, leerAccion, recibirGrupo, recibirLatido, responderEstado, sinNumeros, type DepsDeEstado } from "@/lib/whatsapp-servidor";
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

/* ---------- el código QR para vincular el número ---------- */

/* Una imagen de mentira con la forma que manda el lector: un SVG en base64. */
const QR1 = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0h1v1H0z"/></svg>').toString("base64")}`;
const QR2 = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M1 1h1v1H1z"/></svg>').toString("base64")}`;
const latidoCon = (cuerpo: object) => postLatido(pedido("/api/whatsapp/latido", { en: new Date().toISOString(), grupos: 0, ...cuerpo }, delLector));
const verEstado = async (query = "") => leer(await getEstado(new Request(`http://localhost/api/whatsapp/estado${query}`)));

test("el código QR viaja en el latido, se guarda aparte, se renueva y se borra al conectarse", async () => {
  await conArchivo(async () => {
    assert.equal((await latidoCon({ estado: "esperando_qr", conectado: false, qr: QR1 })).status, 200);

    /* Sin pedirlo, el código no sale en ninguna parte de la respuesta. */
    const sinPedir = await verEstado();
    assert.equal(sinPedir.lector.estado, "esperando_qr");
    assert.equal(sinPedir.qr, undefined);
    assert.ok(!JSON.stringify(sinPedir).includes(QR1.slice(30, 60)), "ni escondido en otro campo");

    /* Pidiéndolo (en la app local quien mira es el dueño): el código, y que lo puede ver. */
    const conQr = await verEstado("?qr=1");
    assert.deepEqual([conQr.puedeVerQr, conQr.qr], [true, QR1]);

    /* WhatsApp cambia el código cada ~20 segundos: el nuevo reemplaza al viejo. */
    await latidoCon({ estado: "esperando_qr", conectado: false, qr: QR2 });
    assert.equal((await verEstado("?qr=1")).qr, QR2);
    /* Un latido sin código (el periódico) no lo pisa. */
    await latidoCon({ estado: "esperando_qr", conectado: false });
    assert.equal((await verEstado("?qr=1")).qr, QR2);

    /* Se conecta: el código viejo se borra de la base (es una credencial) y deja de verse. */
    assert.equal((await latidoCon({ estado: "conectado", conectado: true, grupos: 2 })).status, 200);
    assert.equal(JSON.parse(readFileSync(process.env.WHATSAPP_ARCHIVO_LOCAL!, "utf8")).qr, null);
    const conectado = await verEstado("?qr=1");
    assert.equal(conectado.lector.estado, "conectado");
    assert.deepEqual([conectado.qr, conectado.puedeVerQr], [undefined, undefined]);
  });
});

test("un código de hace más de un minuto no se muestra", async () => {
  await conArchivo(async () => {
    await latidoCon({ estado: "esperando_qr", conectado: false, qr: QR1 });
    const archivo = process.env.WHATSAPP_ARCHIVO_LOCAL!;
    const datos = JSON.parse(readFileSync(archivo, "utf8"));
    datos.qr.en = new Date(Date.now() - 75_000).toISOString();
    writeFileSync(archivo, JSON.stringify(datos));
    const r = await verEstado("?qr=1");
    assert.deepEqual([r.puedeVerQr, r.qr], [true, null]);
    datos.qr.en = new Date(Date.now() - 20_000).toISOString();
    writeFileSync(archivo, JSON.stringify(datos));
    assert.equal((await verEstado("?qr=1")).qr, QR1);
  });
});

test("el latido con un código malo se rechaza, y uno enorme también", async () => {
  await conArchivo(async () => {
    const malo = await latidoCon({ estado: "esperando_qr", conectado: false, qr: "https://malo.example/qr.png" });
    assert.equal(malo.status, 400);
    assert.match((await leer(malo)).error, /data URL/);
    assert.equal((await latidoCon({ estado: "conectado", conectado: true, qr: QR1 })).status, 400, "un código sólo va esperando");
    assert.equal((await latidoCon({ estado: "dormido", conectado: false })).status, 400);
    const enorme = await latidoCon({ estado: "esperando_qr", conectado: false, qr: `data:image/png;base64,${"A".repeat(90_000)}` });
    assert.equal(enorme.status, 413, "pasa el tope del pedido");
    /* Y nada de eso dejó un código guardado (ni siquiera se escribió el archivo). */
    const archivo = process.env.WHATSAPP_ARCHIVO_LOCAL!;
    assert.ok(!existsSync(archivo) || JSON.parse(readFileSync(archivo, "utf8")).qr == null);
  });
});

/* Quién pide: la persona del equipo con el nivel que le toque, sin tocar Supabase. */
function dependencias(opciones: { webinars: boolean; ajustes: boolean; ahora?: Date; repo?: RepoMemoria }) {
  const llamadas: string[] = [];
  const repo = opciones.repo ?? new RepoMemoria();
  const deps: DepsDeEstado = {
    exigirArea: async (_p, areas, minimo) => {
      llamadas.push(`${areas.join("+")}:${minimo}`);
      const permitido = areas[0] === "ajustes" ? opciones.ajustes : opciones.webinars;
      return permitido ? null : NextResponse.json({ error: "Tu tipo de cuenta no ve esto." }, { status: 403 });
    },
    repositorio: () => ({ repo, modo: "nube" }),
    ahora: () => opciones.ahora ?? new Date(),
  };
  return { deps, repo, llamadas };
}
const pedirEstado = (query = "") => new Request(`http://localhost/api/whatsapp/estado${query}`);

test("el código QR sólo lo ve quien edita Ajustes: con permiso sale, sin permiso no", async () => {
  const dueno = dependencias({ webinars: true, ajustes: true });
  await recibirLatido(dueno.repo, { en: new Date().toISOString(), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR1 });

  /* Con permiso: el código, y se preguntó por Ajustes con edición. */
  const conPermiso = await leer(await responderEstado(pedirEstado("?qr=1"), dueno.deps));
  assert.deepEqual([conPermiso.puedeVerQr, conPermiso.qr], [true, QR1]);
  assert.deepEqual(dueno.llamadas, ["webinars:1", "ajustes:2"]);

  /* Ve los Webinars pero no edita Ajustes (marketing, el director…): ve el estado, no el código. */
  const sinPermiso = dependencias({ webinars: true, ajustes: false, repo: dueno.repo });
  const r = await responderEstado(pedirEstado("?qr=1"), sinPermiso.deps);
  assert.equal(r.status, 200);
  const cuerpo = await leer(r);
  assert.deepEqual([cuerpo.puedeVerQr, cuerpo.qr], [false, null]);
  assert.equal(cuerpo.lector.estado, "esperando_qr", "el estado sí");
  assert.ok(!JSON.stringify(cuerpo).includes(QR1.slice(30, 60)), "el código no viaja");

  /* Edita Ajustes pero no ve los Webinars: una sola regla para el código, es de quien edita Ajustes. Recibe el estado del lector y el
     código, sin los grupos. */
  const soloAjustes = dependencias({ webinars: false, ajustes: true, repo: dueno.repo });
  const rAjustes = await leer(await responderEstado(pedirEstado("?qr=1"), soloAjustes.deps));
  assert.deepEqual([rAjustes.puedeVerQr, rAjustes.qr, rAjustes.sinGrupos, rAjustes.grupos], [true, QR1, true, []]);
  assert.deepEqual(soloAjustes.llamadas, ["webinars:1", "ajustes:2"]);

  /* Sin ver los Webinars ni editar Ajustes: lo que diga la sesión (401 / 403), y nada del código. */
  const nada = dependencias({ webinars: false, ajustes: false, repo: dueno.repo });
  const rechazo = await responderEstado(pedirEstado("?qr=1"), nada.deps);
  assert.equal(rechazo.status, 403);
  assert.ok(!JSON.stringify(await leer(rechazo)).includes("base64"));
  /* Y sin pedir el código, quien no ve los Webinars no recibe ni el estado, aunque edite Ajustes. */
  const sinPedir = dependencias({ webinars: false, ajustes: true, repo: dueno.repo });
  assert.equal((await responderEstado(pedirEstado(), sinPedir.deps)).status, 403);
  assert.deepEqual(sinPedir.llamadas, ["webinars:1"]);
});

test("sin pedir el código (?qr=1) o sin que el lector lo espere, no se pregunta por Ajustes ni se lee el código", async () => {
  const a = dependencias({ webinars: true, ajustes: true });
  await recibirLatido(a.repo, { en: new Date().toISOString(), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR1 });
  const sinPedir = await leer(await responderEstado(pedirEstado(), a.deps));
  assert.deepEqual([sinPedir.qr, sinPedir.puedeVerQr], [undefined, undefined]);
  assert.deepEqual(a.llamadas, ["webinars:1"]);

  const b = dependencias({ webinars: true, ajustes: true });
  await recibirLatido(b.repo, { en: new Date().toISOString(), conectado: true, estado: "conectado", grupos: 1 });
  const conectado = await leer(await responderEstado(pedirEstado("?qr=1"), b.deps));
  assert.deepEqual([conectado.qr, conectado.puedeVerQr], [undefined, undefined]);
  assert.deepEqual(b.llamadas, ["webinars:1"], "conectado no hay código: se ahorra la pregunta");
});

test("el código vence al minuto, medido con la hora del servidor", async () => {
  const hoy = new Date("2026-10-07T18:00:00.000Z");
  const repo = new RepoMemoria();
  await recibirLatido(repo, { en: hoy.toISOString(), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR1 }, hoy);
  const alos = (seg: number) => dependencias({ webinars: true, ajustes: true, repo, ahora: new Date(hoy.getTime() + seg * 1000) });
  assert.equal((await leer(await responderEstado(pedirEstado("?qr=1"), alos(59).deps))).qr, QR1);
  assert.equal((await leer(await responderEstado(pedirEstado("?qr=1"), alos(60).deps))).qr, null);
  assert.equal((await leer(await responderEstado(pedirEstado("?qr=1"), alos(600).deps))).qr, null);
});

test("sin la tabla del código, el latido entra igual y la pantalla lo dice", async () => {
  class SinTablaQr extends RepoMemoria {
    async guardarQr(): Promise<void> { throw new ErrorSinTablaQr(); }
    async leerQr(): Promise<never> { throw new ErrorSinTablaQr(); }
    async borrarQr(): Promise<void> { throw new ErrorSinTablaQr(); }
  }
  const repo = new SinTablaQr();
  const r = await recibirLatido(repo, { en: new Date().toISOString(), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR1 });
  assert.match(r.aviso ?? "", /whatsapp-lector-qr\.sql/);
  assert.equal((await repo.leerLatido())?.estado, "esperando_qr", "el estado se guardó igual");
  /* Un latido normal, sin código, no molesta con avisos. */
  assert.equal((await recibirLatido(repo, { en: new Date().toISOString(), conectado: true, estado: "conectado", grupos: 1 })).aviso, undefined);

  const d = dependencias({ webinars: true, ajustes: true, repo });
  await repo.guardarLatido({ ultimoLatido: new Date().toISOString(), enLector: null, conectado: false, grupos: 0, estado: "esperando_qr" });
  const cuerpo = await leer(await responderEstado(pedirEstado("?qr=1"), d.deps));
  assert.deepEqual([cuerpo.qr, cuerpo.qrSinTabla, cuerpo.puedeVerQr], [null, true, true]);
});
