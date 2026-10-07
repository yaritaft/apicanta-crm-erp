import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { Azar, capturandoConsola, propiedad, textoLoco } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · las puertas de TODAS las rutas de /api.

   Se importa cada route.ts de src/app/api y se la llama con Request
   falsos (sin red: el fetch está cortado y Supabase es una nube de
   mentira en memoria, con un «equipo» de mentira que contesta
   puede_entrar / nivel_area / es_dueno):

   - Sin credencial o con credenciales de basura, ninguna ruta protegida
     contesta 2xx ni tira una excepción (nunca un 500). Las que son públicas
     a propósito (la landing, los webhooks firmados, el GET de «¿estás
     listo?») se listan aparte y se miran con lo suyo.
   - Con la sesión del equipo puesta y cuerpos que no son lo esperado
     (lista, número, texto, objeto con tipos cambiados), ninguna ruta tira.
   - Ninguna respuesta ni línea de consola lleva un secreto del entorno.
   - Los webhooks firmados (Calendly, Meta, Fathom): sólo la firma buena
     entra, con tolerancia de tiempo cuando la pasarela la define.
   - El formulario de la landing: basura, honeypot, orígenes, límite por IP.
   ================================================================== */

const SECRETOS: Record<string, string> = {
  CRON_SECRET: "cron-secreto-estres-6f1a2b3c4d5e",
  WHATSAPP_LECTOR_TOKEN: "lector-token-estres-7a8b9c0d1e2f",
  CALENDLY_WEBHOOK_SIGNING_KEY: "calendly-firma-estres-3c4d5e6f7a8b",
  META_APP_SECRET: "meta-app-secreto-estres-9d8c7b6a5f4e",
  PASARELAS_WEBHOOK_TOKEN: "pasarelas-token-estres-1b2c3d4e5f6a",
  META_SYSTEM_TOKEN: "meta-system-estres-0a1b2c3d4e5f",
  FATHOM_API_KEY: "fathom-api-estres-5e6f7a8b9c0d",
  FATHOM_WEBHOOK_SECRET: "whsec_ZmF0aG9tLWVzdHJlcy1zZWNyZXRv",
  CALENDLY_TOKEN: "calendly-token-estres-2d3e4f5a6b7c",
  SUPABASE_SERVICE_ROLE_KEY: "svc-rutas-estres-falsa-0003",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-rutas-estres-falsa-0004",
};
Object.assign(process.env, SECRETOS, { SUPABASE_URL: URL_NUBE, NEXT_PUBLIC_SUPABASE_URL: URL_NUBE });
for (const k of ["REGISTRO_ORIGENES", "META_PIXEL_ID", "META_CAPI_TOKEN", "STRIPE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[k];

const nube = instalarFetchFalso();
/* Un equipo de mentira: cualquier sesión es de un dueño. Se puede apagar por prueba. */
const EQUIPO = { activo: true };
nube.nube.rpc.set("puede_entrar", () => EQUIPO.activo);
nube.nube.rpc.set("nivel_area", () => (EQUIPO.activo ? 2 : 0));
nube.nube.rpc.set("es_dueno", () => EQUIPO.activo);
nube.nube.rpc.set("mi_acceso", () => ({ tipo: EQUIPO.activo ? "dueno" : "equipo", miembroId: null }));
nube.manejar(() => ({ status: 503, json: { error: { message: "externo caído (prueba)" } } }));
test.after(() => nube.restaurar());

const RAIZ = fileURLToPath(new URL("../../src/app/api/", import.meta.url));
const archivos: string[] = [];
const recorrer = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (n === "route.ts") archivos.push(p); } };
recorrer(RAIZ);
archivos.sort();

const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
interface Ruta { ruta: string; metodo: (typeof METODOS)[number]; fn: (req: Request, ctx: { params: Promise<{ proveedor: string }> }) => Promise<Response> }
const rutas: Ruta[] = [];
for (const a of archivos) {
  const mod = (await import(pathToFileURL(a).href)) as Record<string, unknown>;
  const rel = a.slice(RAIZ.length - 1, -"/route.ts".length).replace("[proveedor]", "stripe");
  for (const m of METODOS) if (typeof mod[m] === "function") rutas.push({ ruta: rel, metodo: m, fn: mod[m] as Ruta["fn"] });
}

/* Públicas a propósito: lo que contestan sin credencial. Todo lo demás exige sesión, secreto o firma. */
const PUBLICAS = new Set([
  "GET /calendly/webhook", "GET /pasarelas/webhook/stripe", "OPTIONS /webinar/registro", "POST /webinar/registro",
  "GET /meta/callback", "GET /youtube/callback", "GET /meta/login",
]);
const clave = (r: Ruta) => `${r.metodo} ${r.ruta}`;

const pedido = (r: Ruta, op: { headers?: Record<string, string>; cuerpo?: string; query?: string } = {}) =>
  new Request(`http://localhost/api${r.ruta}${op.query ?? "?x=1"}`, {
    method: r.metodo,
    headers: { "content-type": "application/json", ...(op.headers ?? {}) },
    body: r.metodo === "GET" || r.metodo === "OPTIONS" ? undefined : (op.cuerpo ?? "{}"),
  });
const llamar = (r: Ruta, op?: Parameters<typeof pedido>[1]) => r.fn(pedido(r, op), { params: Promise.resolve({ proveedor: "stripe" }) });

const valoresSecretos = Object.values(SECRETOS);
const sinSecretos = (texto: string, donde: string) => {
  for (const v of valoresSecretos) assert.equal(texto.includes(v), false, `${donde}: se coló un secreto (${v.slice(0, 10)}…)`);
};

test("se encontraron las rutas de /api (si esto falla, la prueba no está mirando nada)", () => {
  assert.ok(rutas.length >= 40, `sólo ${rutas.length} rutas`);
  for (const p of PUBLICAS) assert.ok(rutas.some((r) => clave(r) === p), `la pública «${p}» ya no existe: actualizá la lista`);
});

test("sin credencial o con basura: ninguna ruta protegida contesta 2xx ni tira, y ninguna filtra un secreto", async () => {
  EQUIPO.activo = false;
  const { texto } = await capturandoConsola(async () => {
    for (const r of rutas) {
      if (PUBLICAS.has(clave(r))) continue;
      for (const op of ([
        {}, { headers: { authorization: "Bearer xx.yy.zz" } }, { headers: { authorization: "Bearer " + "A".repeat(5000) } },
        { headers: { cookie: "apicanta_meta_token=abc; apicanta_meta_state=zzz" } },
        { headers: { authorization: "Basic dXNlcjpwYXNz" }, cuerpo: "[1,2,3]" }, { cuerpo: "{" }, { cuerpo: '"x"' }, { query: "?token=x&dias=abc&ad=1&id=%00&desde=ayer" },
        { headers: { authorization: "Bearer undefined" } }, { headers: { "stripe-signature": "t=1,v1=0", "x-hub-signature-256": "sha256=zz", "calendly-webhook-signature": "t=1,v1=0", "webhook-signature": "v1,zz", "webhook-id": "x", "webhook-timestamp": "1" } },
      ] as Parameters<typeof llamar>[1][])) {
        const res = await llamar(r, op);
        assert.ok(res.status >= 300, `${clave(r)} contestó ${res.status} sin credencial`);
        assert.ok(res.status < 500 || res.status === 503 || res.status === 502, `${clave(r)} contestó ${res.status}`);
        sinSecretos(await res.text(), clave(r));
      }
    }
  });
  sinSecretos(texto, "consola");
  EQUIPO.activo = true;
});

test("con sesión del equipo y cuerpos que no son lo esperado (lista, número, texto, tipos cambiados) ninguna ruta tira ni contesta 500", propiedad("cuerpos raros con sesión", 12, async (az) => {
  EQUIPO.activo = true;
  const { texto } = await capturandoConsola(async () => {
    for (const r of rutas) {
      if (r.metodo === "GET" || r.metodo === "OPTIONS") continue;
      const cuerpo = az.pick(["[]", "5", '"x"', "true", '{"accion":null}', '{"accion":5,"email":5,"id":{},"momento":[]}', '{"cuentaId":5,"desde":1,"hasta":2}', "[null]", '{"__proto__":{"x":1}}', JSON.stringify({ accion: textoLoco(az, 20), email: textoLoco(az, 20) })]);
      let res: Response;
      try {
        res = await llamar(r, { headers: { authorization: "Bearer jwt.falso.del-equipo", "x-forwarded-for": `10.9.${az.int(0, 255)}.${az.int(0, 255)}` }, cuerpo });
      } catch (e) {
        assert.fail(`${clave(r)} tiró «${e instanceof Error ? e.message : e}» con el cuerpo ${cuerpo.slice(0, 80)}`);
      }
      assert.ok(res.status < 500 || res.status === 502 || res.status === 503, `${clave(r)} contestó ${res.status} con ${cuerpo.slice(0, 80)}`);
      sinSecretos(await res.text(), clave(r));
    }
  });
  sinSecretos(texto, "consola");
}));

test("los GET públicos «¿estás listo?» no exponen nada: sólo ok y listo", async () => {
  for (const p of ["GET /calendly/webhook", "GET /pasarelas/webhook/stripe"]) {
    const r = rutas.find((x) => clave(x) === p)!;
    const res = await llamar(r);
    assert.equal(res.status, 200);
    const j = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(j).sort(), ["listo", "ok"]);
    assert.equal(typeof j.listo, "boolean");
  }
});

test("los crons: sólo el secreto exacto abre; «Bearer undefined» y variantes no", async () => {
  const crons = rutas.filter((r) => r.ruta.startsWith("/cron/"));
  assert.equal(crons.length, 4);
  const antes = process.env.CRON_SECRET;
  try {
    await capturandoConsola(async () => {
    for (const r of crons) {
      for (const h of ["Bearer undefined", "Bearer ", "Bearer null", `bearer ${antes}`, `Bearer ${antes} `, `Bearer ${antes}x`, `${antes}`, `Bearer ${antes!.slice(1)}`, "Bearer " + antes!.toUpperCase()]) {
        const res = await llamar(r, { headers: { authorization: h } });
        /* El espacio final lo recorta el protocolo: ese caso es el secreto exacto. */
        if (h === `Bearer ${antes} `) continue;
        assert.equal(res.status, 401, `${r.ruta} con «${h.slice(0, 30)}»`);
      }
      delete process.env.CRON_SECRET;
      assert.equal((await llamar(r, { headers: { authorization: "Bearer undefined" } })).status, 401, `${r.ruta} sin la variable`);
      assert.equal((await llamar(r, { headers: { authorization: "Bearer " } })).status, 401, `${r.ruta} sin la variable y sin token`);
      process.env.CRON_SECRET = antes;
    }
    });
  } finally { process.env.CRON_SECRET = antes; }
});

/* ---------- Calendly ---------- */

const firmaCalendly = (cuerpo: string, clave = SECRETOS.CALENDLY_WEBHOOK_SIGNING_KEY, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", clave).update(`${t}.${cuerpo}`).digest("hex")}`;

test("webhook de Calendly: sólo la firma buena y reciente entra; vieja (más de 3 minutos), futura, de otra clave o mal escrita da 401", propiedad("firma de Calendly", 60, async (az) => {
  const r = rutas.find((x) => clave(x) === "POST /calendly/webhook")!;
  const cuerpo = JSON.stringify({ event: "routing_form_submission.created", payload: { x: az.alfanum(5) } });
  const ahora = Math.floor(Date.now() / 1000);
  const buena = await llamar(r, { headers: { "calendly-webhook-signature": firmaCalendly(cuerpo) }, cuerpo });
  assert.equal(buena.status, 200);
  assert.equal(((await buena.json()) as { ignorado?: string }).ignorado, "routing_form_submission.created");
  for (const t of [ahora - 181, ahora - 3600, ahora + 181, ahora + 86400, 0, ahora - 10 ** 9]) {
    const res = await llamar(r, { headers: { "calendly-webhook-signature": firmaCalendly(cuerpo, SECRETOS.CALENDLY_WEBHOOK_SIGNING_KEY, t) }, cuerpo });
    assert.equal(res.status, 401, `t=${t - ahora}s`);
  }
  for (const cab of [
    firmaCalendly(cuerpo, "otra-clave"), firmaCalendly(cuerpo + " "), "", "t=,v1=", "v1=" + "0".repeat(64), `t=${ahora}`, `t=${ahora},v1=`, `t=abc,v1=${"0".repeat(64)}`,
    `t=${ahora},v1=${"0".repeat(64)}`, `t=${ahora},v1=${"0".repeat(63)}`, "x".repeat(5000), az.alfanum(az.int(1, 90)), ",,,", "=,=",
    `t=${ahora}, v1=${"f".repeat(64)}`, `t=${ahora},v1=${"é".repeat(64)}`,
  ]) {
    const res = await llamar(r, { headers: { "calendly-webhook-signature": cab }, cuerpo });
    assert.equal(res.status, 401, `cabecera «${cab.slice(0, 40)}»`);
  }
}));

test("webhook de Calendly: sin la variable de la clave no acepta nada, ni siquiera una firma hecha con una clave vacía", async () => {
  const r = rutas.find((x) => clave(x) === "POST /calendly/webhook")!;
  const antes = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  try {
    const cuerpo = "{}";
    assert.equal((await llamar(r, { headers: { "calendly-webhook-signature": firmaCalendly(cuerpo, "") }, cuerpo })).status, 401);
    assert.equal((await llamar(r, { headers: { "calendly-webhook-signature": firmaCalendly(cuerpo, "undefined") }, cuerpo })).status, 401);
  } finally { process.env.CALENDLY_WEBHOOK_SIGNING_KEY = antes; }
});

/* ---------- Meta (formularios) ---------- */

test("webhook de los formularios de Meta: la verificación y la firma", async () => {
  const get = rutas.find((x) => clave(x) === "GET /meta/leads/webhook")!;
  const post = rutas.find((x) => clave(x) === "POST /meta/leads/webhook")!;
  const { tokenDeVerificacion } = await import("@/lib/meta-leads");
  const v = tokenDeVerificacion()!;
  assert.ok(v && !v.includes(SECRETOS.META_APP_SECRET), "el token de verificación no es el secreto");
  const ok = await llamar(get, { query: `?hub.mode=subscribe&hub.verify_token=${v}&hub.challenge=12345` });
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "12345");
  for (const q of ["", "?hub.mode=subscribe", "?hub.mode=subscribe&hub.verify_token=", `?hub.mode=subscribe&hub.verify_token=${v}x`, `?hub.mode=otro&hub.verify_token=${v}`,
    `?hub.verify_token=${v}`, `?hub.mode=subscribe&hub.verify_token=${SECRETOS.META_APP_SECRET}`]) {
    assert.equal((await llamar(get, { query: q })).status, 403, q);
  }
  const cuerpo = JSON.stringify({ object: "page", entry: [] });
  const firma = (c: string, k = SECRETOS.META_APP_SECRET) => `sha256=${createHmac("sha256", k).update(c, "utf8").digest("hex")}`;
  assert.equal((await llamar(post, { headers: { "x-hub-signature-256": firma(cuerpo) }, cuerpo })).status, 200);
  for (const cab of ["", "sha256=", "sha256=zz", firma(cuerpo, "otra"), firma(cuerpo + " "), firma(cuerpo).replace("sha256=", "sha1="), "x".repeat(4000), firma(cuerpo).toUpperCase(), firma(cuerpo).slice(0, -2)]) {
    assert.equal((await llamar(post, { headers: { "x-hub-signature-256": cab }, cuerpo })).status, 401, `«${cab.slice(0, 30)}»`);
  }
  /* Firmado pero roto: 400 (no un 500). */
  const roto = "{";
  assert.equal((await llamar(post, { headers: { "x-hub-signature-256": firma(roto) }, cuerpo: roto })).status, 400);
});

/* ---------- Fathom ---------- */

test("webhook de Fathom: sólo la firma Standard Webhooks buena y reciente guarda; todo lo demás 401", propiedad("firma de Fathom", 40, async (az) => {
  const r = rutas.find((x) => clave(x) === "POST /fathom/webhook")!;
  const id = `msg_${az.alfanum(10)}`;
  const t = String(Math.floor(Date.now() / 1000));
  const cuerpo = JSON.stringify({ meeting: { title: "sin id" } });
  const secreto = SECRETOS.FATHOM_WEBHOOK_SECRET;
  const clave64 = Buffer.from(secreto.slice(6), "base64");
  const firma = (c: string, ts = t, ident = id) => `v1,${createHmac("sha256", clave64).update(`${ident}.${ts}.${c}`).digest("base64")}`;
  const buena = await llamar(r, { headers: { "webhook-id": id, "webhook-timestamp": t, "webhook-signature": firma(cuerpo) }, cuerpo });
  assert.equal(buena.status, 200, "una reunión sin recording_id con firma buena se contesta 200 sin guardar (para que no la reintenten)");
  assert.deepEqual(await buena.json(), { recibido: true, guardado: false });
  const viejo = String(Math.floor(Date.now() / 1000) - 301);
  for (const [i, ts, f] of [
    [id, viejo, firma(cuerpo, viejo)], [id, t, firma(cuerpo + " ")], [id, t, firma(cuerpo, t, "otro-id")], [id, t, "v1,"], [id, t, ""], [id, t, "v2," + firma(cuerpo).slice(3)],
    [id, "abc", firma(cuerpo, "abc")], ["", t, firma(cuerpo)], [id, "", firma(cuerpo)], [id, String(Number(t) + 10_000), firma(cuerpo, String(Number(t) + 10_000))],
    [id, t, `v1,${"A".repeat(44)}`], [id, t, "x".repeat(3000)], [id, t, `${firma(cuerpo)} ${firma(cuerpo, t, "x")}`.split(" ").reverse().join(" ")],
  ] as [string, string, string][]) {
    const headers: Record<string, string> = {};
    if (i) headers["webhook-id"] = i;
    if (ts) headers["webhook-timestamp"] = ts;
    if (f) headers["webhook-signature"] = f;
    const res = await llamar(r, { headers, cuerpo });
    /* La última combinación trae la firma buena en segundo lugar: es válida («puede haber varias»). */
    if (f.includes(" ") && f.split(" ").some((x) => x === firma(cuerpo))) { assert.equal(res.status, 200); continue; }
    assert.equal(res.status, 401, `id «${i}» t «${ts}» firma «${f.slice(0, 30)}»`);
  }
}));

/* ---------- El formulario de la landing (público) ---------- */

const registro = rutas.find((x) => clave(x) === "POST /webinar/registro")!;
let ipN = 0;
const ipNueva = () => `203.0.113.${++ipN % 250}`;
const formulario = (campos: Record<string, string>, headers: Record<string, string> = {}) =>
  llamar(registro, {
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ipNueva(), ...headers },
    cuerpo: new URLSearchParams(campos).toString(),
  });

test("landing: lo que no es un mail válido da 400 con un mensaje, nunca 500, con lo que sea en los demás campos", propiedad("registro con basura", 150, async (az) => {
  const mails = ["", " ", "a", "a@", "@b.com", "a@b", "a b@c.com", "a@b.c", "a@@b.com", "x", "a@b..", `${"a".repeat(300)}`, "a@b .com", "a@\nb.com", "mail sin arroba.com"];
  const res = await formulario({ email: az.pick(mails), nombre: textoLoco(az, 100), telefono: textoLoco(az, 50), pais: textoLoco(az, 20), webinar: textoLoco(az, 20), [textoLoco(az, 10) || "k"]: textoLoco(az, 600) });
  assert.equal(res.status, 400);
  const j = (await res.json()) as { ok: boolean; error: string };
  assert.equal(j.ok, false);
  assert.match(j.error, /email/i);
}));

test("landing: JSON, formulario, texto plano, vacío, claves en mayúsculas y cuerpos gigantes: 400 (o 503 sin base), nunca 500", async () => {
  const casos: [string, string][] = [
    ["application/json", "{}"], ["application/json", "{"], ["application/json", ""], ["application/json", "[]"], ["application/json", "5"], ["application/json", '"x"'],
    ["application/json", JSON.stringify({ EMAIL: 5, Nombre: { a: 1 }, utm_source: [1, 2] })], ["application/json", JSON.stringify({ email: "x".repeat(1_000_000) })],
    ["application/json; charset=utf-8", JSON.stringify({ email: null, correo: {} })], ["text/plain", "email=a@b.com"], ["multipart/form-data; boundary=x", "--x--"],
    ["application/x-www-form-urlencoded", "%E0%A4%A"], ["application/x-www-form-urlencoded", "email=" + "%00".repeat(100)], ["", ""],
  ];
  for (const [tipo, cuerpo] of casos) {
    const res = await llamar(registro, { headers: { "content-type": tipo, "x-forwarded-for": ipNueva() }, cuerpo });
    assert.ok(res.status === 400 || res.status === 503, `${tipo} ${cuerpo.slice(0, 30)} dio ${res.status}`);
    const j = (await res.json()) as { ok?: boolean };
    assert.equal(j.ok, false);
  }
});

test("landing: el campo trampa «sitio» (lleno) contesta ok sin guardar nada", async () => {
  const antes = nube.nube.escrituras.length;
  const trampa = await formulario({ email: "bot@spam.com", sitio: "http://spam" });
  assert.equal(trampa.status, 200);
  assert.deepEqual(await trampa.json(), { ok: true });
  assert.equal(nube.nube.escrituras.length, antes, "no escribió nada");
  assert.equal(nube.nube.pedidos.length > 0 ? nube.nube.pedidos.filter((p) => p.cuerpo?.includes("bot@spam.com")).length : 0, 0, "ni siquiera lo buscó");
});

test("landing: con REGISTRO_ORIGENES sólo pasan esos dominios (403 con otro); sin Origin (un curl o un servidor) pasa", async () => {
  process.env.REGISTRO_ORIGENES = "https://landing.apicanta.com, https://www.apicanta.com";
  try {
    const mal = await formulario({ email: "a@b.com" }, { origin: "https://evil.example" });
    assert.equal(mal.status, 403);
    assert.equal(mal.headers.get("access-control-allow-origin"), "https://landing.apicanta.com", "no se refleja el origen malo");
    const bien = await formulario({ email: "a@b.com" }, { origin: "https://www.apicanta.com" });
    assert.notEqual(bien.status, 403);
    assert.equal(bien.headers.get("access-control-allow-origin"), "https://www.apicanta.com");
    const pre = await llamar(rutas.find((x) => clave(x) === "OPTIONS /webinar/registro")!, { headers: { origin: "https://evil.example" } });
    assert.equal(pre.status, 204);
    assert.notEqual(pre.headers.get("access-control-allow-origin"), "https://evil.example");
  } finally { delete process.env.REGISTRO_ORIGENES; }
});

test("landing: pasados 10 intentos por minuto desde una IP contesta 429 (y otra IP no se ve afectada)", async () => {
  const ip = "198.51.100.77";
  const estados: number[] = [];
  for (let i = 0; i < 13; i++) estados.push((await llamar(registro, { headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip }, cuerpo: "email=no-es-mail" })).status);
  assert.deepEqual(estados.slice(0, 10), Array(10).fill(400));
  assert.deepEqual(estados.slice(10), [429, 429, 429]);
  assert.equal((await formulario({ email: "x" })).status, 400, "otra IP sigue pasando");
});

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: un cuerpo JSON «null» tira TypeError (500) en rutas que lo leen con .json().catch(() => ({})) y después le piden una propiedad", { todo: true }, async () => {
  /* `(await req.json().catch(() => ({})))` sólo cubre el JSON inválido: «null» es JSON válido y devuelve null.
     Sin credencial: POST /fathom (lee b.accion ANTES de pedir sesión) y POST /webinar/registro (pública). Con
     sesión del equipo: accesos, calendly/agendas (PATCH), meta/leads, y la del webhook de pasarelas (con token). */
  EQUIPO.activo = true;
  const tiran: string[] = [];
  for (const r of rutas) {
    if (r.metodo === "GET" || r.metodo === "OPTIONS") continue;
    try {
      const res = await llamar(r, { headers: { authorization: "Bearer jwt.falso", "x-forwarded-for": ipNueva() }, cuerpo: "null", query: `?token=${SECRETOS.PASARELAS_WEBHOOK_TOKEN}` });
      if (res.status === 500) tiran.push(`${clave(r)} → 500`);
    } catch (e) { tiran.push(`${clave(r)} → ${e instanceof Error ? e.message.slice(0, 50) : e}`); }
  }
  assert.deepEqual(tiran, [], "con «null» ninguna ruta debería tirar");
});

test("BUG: POST /api/fathom con cuerpo «null» tira TypeError (500) SIN credencial (lee el cuerpo antes de exigir la sesión)", { todo: true }, async () => {
  EQUIPO.activo = false;
  try {
    const r = rutas.find((x) => clave(x) === "POST /fathom")!;
    const res = await llamar(r, { cuerpo: "null" });
    assert.equal(res.status, 401);
  } finally { EQUIPO.activo = true; }
});

test("BUG: POST /api/webinar/registro (pública) con cuerpo JSON «null» tira TypeError (500) en vez de 400", { todo: true }, async () => {
  /* leerCuerpo(): Object.entries(null) está fuera del try de la ruta. */
  const res = await llamar(registro, { headers: { "x-forwarded-for": ipNueva() }, cuerpo: "null" });
  assert.equal(res.status, 400);
});

test("BUG: POST /api/meta/sync y /api/meta/jerarquia con un cuerpo vacío o que no es JSON tiran (500) en vez de 400", { todo: true }, async () => {
  /* `const { cuentaId, desde, hasta } = (await req.json()) as …` sin .catch. Hace falta sesión del equipo y Meta configurado. */
  EQUIPO.activo = true;
  const tiran: string[] = [];
  for (const ruta of ["POST /meta/sync", "POST /meta/jerarquia"]) {
    for (const cuerpo of ["", "{", "hola", "null"]) {
      try {
        const res = await llamar(rutas.find((x) => clave(x) === ruta)!, { headers: { authorization: "Bearer jwt.falso" }, cuerpo });
        if (res.status >= 500 && res.status !== 502 && res.status !== 503) tiran.push(`${ruta} «${cuerpo}» → ${res.status}`);
      } catch (e) { tiran.push(`${ruta} «${cuerpo}» → ${e instanceof Error ? e.message.slice(0, 40) : e}`); }
    }
  }
  assert.deepEqual(tiran, []);
});

test("BUG: el campo trampa «website» no se mira cuando «sitio» viene vacío (que es como lo manda la landing legítima)", { todo: true }, async () => {
  /* (d.sitio ?? d.website ?? "").trim(): «??» sólo salta a «website» si «sitio» es null o undefined, no si es "". */
  const res = await formulario({ email: "bot@spam.com", sitio: "", website: "http://spam" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true }, "es un bot: se le contesta ok y no se sigue");
});
