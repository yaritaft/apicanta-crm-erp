import test from "node:test";
import assert from "node:assert/strict";
import { asegurarWebhookDeWhop, explicarErrorWhop, tocaIntentar, webhookNuestro, RUTA_WEBHOOK_WHOP } from "@/lib/whop-webhook-servidor";

/* ==================================================================
   El webhook de Whop se conecta solo (Juan Cruz, 24/11: «configurá el
   webhook de Whop así entra al instante»). El cron de cada 5 minutos se
   fija si Whop lo tiene y, si no, lo crea con la clave del servidor.
   ================================================================== */

const BASE = "https://apicanta-erp.vercel.app";
const T0 = Date.parse("2026-11-24T23:30:00Z");

test("webhookNuestro: reconoce el que apunta a la app con cualquier token, no otros", () => {
  const lista = [
    { id: "hook_otro", url: "https://zapier.com/hooks/123", enabled: true },
    { id: "hook_app", url: `${BASE}${RUTA_WEBHOOK_WHOP}?token=viejo`, enabled: false },
  ];
  assert.deepEqual(webhookNuestro(lista, BASE), { id: "hook_app", url: `${BASE}${RUTA_WEBHOOK_WHOP}?token=viejo`, enabled: false });
  assert.equal(webhookNuestro([{ id: "x", url: `${BASE}${RUTA_WEBHOOK_WHOP}x` }], BASE), undefined, "otra ruta que empieza igual no");
  assert.equal(webhookNuestro([], BASE), undefined);
});

test("tocaIntentar: con el webhook anotado no; con un error, recién a las 6 horas", () => {
  assert.equal(tocaIntentar(null, T0), true);
  assert.equal(tocaIntentar({ webhookId: "hook_1" }, T0), false);
  assert.equal(tocaIntentar({ webhookError: "403", webhookEn: new Date(T0 - 3600_000).toISOString() }, T0), false);
  assert.equal(tocaIntentar({ webhookError: "403", webhookEn: new Date(T0 - 7 * 3600_000).toISOString() }, T0), true);
});

test("explicarErrorWhop: el 403 dice qué permiso falta", () => {
  assert.match(explicarErrorWhop(403, "forbidden"), /developer:manage_webhook/);
  assert.match(explicarErrorWhop(401, "invalid"), /no aceptó la clave/);
});

/* Una base y un Whop de mentira. */
function escenario(o: { existentes?: Record<string, unknown>[]; crear?: { status: number; body: Record<string, unknown> } } = {}) {
  const fila: Record<string, unknown> = { proveedor: "whop" };
  const pedidos: { metodo: string; ruta: string; cuerpo?: Record<string, unknown> }[] = [];
  const db = {
    from(tabla: string) {
      const q = {
        select() { return q; }, eq() { return q; }, order() { return q; },
        limit: async () => ({ data: tabla === "movimientos" ? [{ referencia: "pay_ultimo" }] : [], error: null }),
        maybeSingle: async () => ({ data: { ...fila }, error: null }),
        upsert: async (f: Record<string, unknown>) => { Object.assign(fila, f); return { error: null }; },
      };
      return q;
    },
  };
  const fetchAnterior = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const ruta = u.pathname.replace("/api/v1", "") + u.search;
    pedidos.push({ metodo: init.method ?? "GET", ruta, cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
    if (ruta.startsWith("/payments/")) return new Response(JSON.stringify({ id: "pay_ultimo", company: { id: "biz_apicanta" } }));
    if (ruta.startsWith("/webhooks?")) return new Response(JSON.stringify({ data: o.existentes ?? [] }));
    if ((init.method ?? "GET") === "POST") return new Response(JSON.stringify(o.crear?.body ?? { id: "hook_nuevo", webhook_secret: "ws_no_se_guarda" }), { status: o.crear?.status ?? 201 });
    if (init.method === "PATCH") return new Response(JSON.stringify({ id: "hook_app", enabled: true }));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const env = { ...process.env };
  Object.assign(process.env, { VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "apicanta-erp.vercel.app", WHOP_API_KEY: "whop_k", PASARELAS_WEBHOOK_TOKEN: "tok_123" });
  const fin = () => { globalThis.fetch = fetchAnterior; for (const k of ["VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "WHOP_API_KEY", "PASARELAS_WEBHOOK_TOKEN"]) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } };
  return { db: db as never, fila, pedidos, fin };
}

test("sin webhook en Whop: lo crea apuntando a producción con el token, sólo pagos cobrados, y anota el id (no el secreto)", async () => {
  const e = escenario();
  try {
    assert.equal(await asegurarWebhookDeWhop(e.db, T0), "conectado");
    const post = e.pedidos.find((p) => p.metodo === "POST");
    assert.equal(post?.ruta, "/webhooks");
    assert.equal(post?.cuerpo?.url, `${BASE}${RUTA_WEBHOOK_WHOP}?token=tok_123`);
    assert.deepEqual(post?.cuerpo?.events, ["payment.succeeded"]);
    assert.equal(post?.cuerpo?.resource_id, "biz_apicanta");
    assert.equal(e.fila.webhookId, "hook_nuevo");
    assert.equal(e.fila.webhookError, null);
    assert.ok(!JSON.stringify(e.fila).includes("ws_no_se_guarda"), "el secreto de firma no se guarda en una tabla que leen los closers");
    assert.equal(await asegurarWebhookDeWhop(e.db, T0 + 300_000), "ya estaba", "la vuelta siguiente no le pega a Whop");
    assert.equal(e.pedidos.filter((p) => p.metodo === "POST").length, 1);
  } finally { e.fin(); }
});

test("si ya había uno nuestro apagado, lo prende y no crea otro", async () => {
  const e = escenario({ existentes: [{ id: "hook_app", url: `${BASE}${RUTA_WEBHOOK_WHOP}?token=tok_123`, enabled: false }] });
  try {
    assert.equal(await asegurarWebhookDeWhop(e.db, T0), "estaba apagado: prendido");
    assert.ok(e.pedidos.some((p) => p.metodo === "PATCH" && p.ruta === "/webhooks/hook_app" && p.cuerpo?.enabled === true));
    assert.ok(!e.pedidos.some((p) => p.metodo === "POST"));
    assert.equal(e.fila.webhookId, "hook_app");
  } finally { e.fin(); }
});

test("si Whop no deja (403), anota por qué y no reintenta hasta 6 horas después", async () => {
  const e = escenario({ crear: { status: 403, body: { error: { message: "You do not have permission" } } } });
  try {
    assert.equal(await asegurarWebhookDeWhop(e.db, T0), "Whop no dejó crearlo");
    assert.match(String(e.fila.webhookError), /developer:manage_webhook.*You do not have permission/);
    assert.equal(await asegurarWebhookDeWhop(e.db, T0 + 3600_000), "esperando para reintentar");
    assert.equal(e.pedidos.filter((p) => p.metodo === "POST").length, 1);
  } finally { e.fin(); }
});

test("fuera de producción no toca Whop", async () => {
  const e = escenario();
  try {
    process.env.VERCEL_ENV = "preview";
    assert.equal(await asegurarWebhookDeWhop(e.db, T0), "no corresponde");
    assert.equal(e.pedidos.length, 0);
  } finally { e.fin(); }
});
