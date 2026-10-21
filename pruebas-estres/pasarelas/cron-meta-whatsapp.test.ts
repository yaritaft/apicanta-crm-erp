import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el cron de Meta trae también el costo de WhatsApp API (lo que cobra Meta por los mensajes de la API) de la cuenta de
   WhatsApp Business, contra una nube de mentira y una API de Meta de mentira: lo guarda día por día, deja su estado en cron_estado y,
   pase lo que pase con WhatsApp (permiso, red, tabla), la sincronización de anuncios sigue como siempre.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-meta-whatsapp-falsa-0011";
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_NUBE;
process.env.CRON_SECRET = "secreto-de-prueba-del-cron-0011";
process.env.META_SYSTEM_TOKEN = "token-de-sistema-falso-0011";
delete process.env.META_WABA_ID;
delete process.env.META_WABA_IDS;

const fake = instalarFetchFalso();
const { GET } = await import("@/app/api/cron/meta/route");
test.after(() => fake.restaurar());

const llamar = () => GET(new Request("http://localhost/api/cron/meta", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
const unix = (dia: string) => Date.parse(`${dia}T00:00:00Z`) / 1000;
const hoy = new Date().toISOString().slice(0, 10);

type Modo = "bien" | "sin-permiso" | "sin-red";
function meta(modo: Modo) {
  const pedidos: string[] = [];
  fake.soltar();
  fake.manejar(async (url) => {
    if (url.host !== "graph.facebook.com") return null;
    pedidos.push(`${url.pathname}?${[...url.searchParams.keys()].filter((k) => k !== "access_token").join("&")}`);
    if (url.pathname.endsWith("/me/adaccounts")) return { json: { data: [] } };
    if (!url.pathname.includes("517225948145267")) return null;
    if (modo === "sin-red") throw new TypeError("fetch failed");
    if (modo === "sin-permiso") return { status: 400, json: { error: { message: "(#200) Requires whatsapp_business_management permission", code: 200 } } };
    if (url.searchParams.get("fields") === "currency") return { json: { currency: "USD", id: "517225948145267" } };
    return { json: { pricing_analytics: { data: [{ data_points: [
      { start: unix(hoy), end: unix(hoy) + 86400, pricing_category: "MARKETING", volume: 200, cost: 16.4 },
      { start: unix(hoy), end: unix(hoy) + 86400, pricing_category: "UTILITY", volume: 40, cost: 0.9 },
    ] }] }, id: "517225948145267" } };
  });
  return pedidos;
}

function sembrar() {
  fake.nube.vaciar();
  fake.nube.declarar("whatsapp_costos", [["dia", "cuenta", "categoria"]]);
  fake.nube.declarar("cron_estado", [["clave"]]);
  fake.nube.tablas.set("whatsapp_costos", []);
  fake.nube.tablas.set("cron_estado", []);
}

test("trae el costo de la cuenta de WhatsApp, lo guarda por día y categoría y deja su estado", async () => {
  sembrar();
  const pedidos = meta("bien");
  const res = await llamar();
  assert.equal(res.status, 200);
  const j = (await res.json()) as { whatsapp: { cuenta: string; dias: number; total: number; error?: string }[] };
  assert.equal(j.whatsapp.length, 1);
  assert.equal(j.whatsapp[0].cuenta, "517225948145267");
  assert.equal(j.whatsapp[0].total, 17.3);
  assert.equal(j.whatsapp[0].error, undefined);
  const filas = fake.nube.filas("whatsapp_costos");
  assert.deepEqual(filas.map((f) => [f.dia, f.categoria, f.costo, f.moneda]).sort(), [[hoy, "MARKETING", 16.4, "USD"], [hoy, "UTILITY", 0.9, "USD"]]);
  assert.ok(pedidos.some((p) => p.includes("fields")), "pidió con la expansión de campos");
  const estado = fake.nube.filas("cron_estado").find((x) => x.clave === "meta-whatsapp-costos")!;
  assert.equal(estado.ok, true);
});

test("correrlo otra vez no repite filas: se actualizan las mismas", async () => {
  sembrar();
  meta("bien");
  await llamar();
  await llamar();
  assert.equal(fake.nube.filas("whatsapp_costos").length, 2);
  assert.equal(fake.nube.filas("cron_estado").filter((x) => x.clave === "meta-whatsapp-costos").length, 1);
});

test("sin el permiso en el token, el error queda dicho en el estado y los anuncios siguen como siempre (200)", async () => {
  sembrar();
  meta("sin-permiso");
  const res = await llamar();
  assert.equal(res.status, 200, "WhatsApp no tumba la sincronización de anuncios");
  const j = (await res.json()) as { whatsapp: { error?: string }[]; resultados: unknown[] };
  assert.match(j.whatsapp[0].error ?? "", /whatsapp_business_management/);
  assert.deepEqual(j.resultados, []);
  assert.equal(fake.nube.filas("whatsapp_costos").length, 0);
  const estado = fake.nube.filas("cron_estado").find((x) => x.clave === "meta-whatsapp-costos")!;
  assert.equal(estado.ok, false);
});

test("sin red hacia Meta tampoco rompe nada", async () => {
  sembrar();
  meta("sin-red");
  const res = await llamar();
  assert.equal(res.status, 200);
  const j = (await res.json()) as { whatsapp: { error?: string }[] };
  assert.ok(j.whatsapp[0].error, "queda anotado");
});

test("sin la tabla whatsapp_costos creada, el error dice que falta el SQL y el cron sigue", async () => {
  sembrar();
  fake.nube.tablas.delete("whatsapp_costos");
  meta("bien");
  const res = await llamar();
  assert.equal(res.status, 200);
  const j = (await res.json()) as { whatsapp: { error?: string }[] };
  assert.match(j.whatsapp[0].error ?? "", /whatsapp-costos\.sql/);
});
