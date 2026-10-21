import test from "node:test";
import assert from "node:assert/strict";
import {
  cruzarProductosWisboo, leerBotTelegram, leerCuentaPandadoc, leerPlantillasPandadoc, leerProductosWisboo,
  leerInscripcionZoom, leerReunionesZoom, leerWebhookTelegram, nombreDeReunion, PRODUCTOS_WISBOO,
} from "@/lib/accesos-alumnos";
import { clavePandadoc } from "@/lib/accesos-alumnos-servidor";
import { cambiarGrupoEnProgramas } from "@/lib/programas";
import { marcasDeLaFicha, motivoZoom } from "@/lib/accesos-servidor";

/* La prueba de conexión de los accesos de alumnos (Ajustes → Integraciones)
   con respuestas como las devuelven Telegram, Wisboo, PandaDoc y Zoom. */

const BASE = "https://apicanta-erp.vercel.app";

test("Telegram: un bot sin webhook está libre para conectarse", () => {
  const w = leerWebhookTelegram({ ok: true, result: { url: "", pending_update_count: 3 } }, BASE);
  assert.deepEqual(w, { uso: "libre", host: null, pendientes: 3, ultimoError: null });
});

test("Telegram: si el webhook es de otra herramienta se dice cuál, sin la dirección entera", () => {
  const w = leerWebhookTelegram({
    ok: true, result: { url: "https://hooks.otra.com/bot/SECRETO123", pending_update_count: 0, last_error_message: "Wrong response from the webhook: 500" },
  }, BASE);
  assert.equal(w.uso, "otra");
  assert.equal(w.host, "hooks.otra.com");
  assert.equal(w.ultimoError, "Wrong response from the webhook: 500");
  assert.ok(!JSON.stringify(w).includes("SECRETO123"));
});

test("Telegram: el webhook propio se reconoce (con o sin barra al final de la base)", () => {
  assert.equal(leerWebhookTelegram({ result: { url: `${BASE}/api/telegram/webhook` } }, `${BASE}/`).uso, "nuestro");
  assert.equal(leerWebhookTelegram({ result: { url: `${BASE}/api/telegram/webhook?x=1` } }, BASE).uso, "nuestro");
  assert.equal(leerWebhookTelegram({ result: { url: `${BASE}/api/telegram/webhookfalso` } }, BASE).uso, "otra");
});

test("Telegram: respuesta rota no inventa nada", () => {
  assert.equal(leerWebhookTelegram(null, BASE).uso, "libre");
  assert.equal(leerBotTelegram({ ok: false }), null);
  assert.deepEqual(leerBotTelegram({ ok: true, result: { username: "apicanta_bot", first_name: "Apicanta" } }), { usuario: "apicanta_bot", nombre: "Apicanta" });
});

test("Wisboo: lee los productos y cruza los de los programas por id", () => {
  const { productos, total } = leerProductosWisboo({
    object: "list",
    data: [
      { id: PRODUCTOS_WISBOO[0].id, name: "Mentoría (Hackear IT)", product_type: "course_type", state: "published" },
      { id: "PRO-otro", name: "Curso suelto", product_type: "course_type", state: "not_published" },
      { name: "sin id" },
    ],
    metadata: { page_number: 1, page_size: 100, total_record_count: 2 },
  });
  assert.equal(productos.length, 2);
  assert.equal(total, 2);
  const cruce = cruzarProductosWisboo(productos);
  assert.equal(cruce.length, PRODUCTOS_WISBOO.length);
  assert.equal(cruce[0].enWisboo?.nombre, "Mentoría (Hackear IT)");
  assert.equal(cruce.filter((c) => c.enWisboo).length, 1);
});

test("Wisboo: los seis productos de los programas tienen id distinto", () => {
  assert.equal(new Set(PRODUCTOS_WISBOO.map((p) => p.id)).size, PRODUCTOS_WISBOO.length);
  assert.ok(PRODUCTOS_WISBOO.every((p) => p.id.startsWith("PRO-")));
});

test("PandaDoc: plantillas y de quién es la clave", () => {
  assert.deepEqual(leerPlantillasPandadoc({ results: [{ id: "t1", name: "Contrato Hackear Biz", date_modified: "2026-10-01T00:00:00Z" }, { name: "sin id" }] }),
    [{ id: "t1", nombre: "Contrato Hackear Biz", modificada: "2026-10-01T00:00:00Z" }]);
  assert.deepEqual(leerCuentaPandadoc({ email: "yari@apicanta.com", workspace_name: "Apicanta" }), { email: "yari@apicanta.com", espacio: "Apicanta" });
  assert.equal(leerCuentaPandadoc({}), null);
});

test("PandaDoc: la clave de producción sólo se usa en la app publicada", () => {
  const antes = { e: process.env.VERCEL_ENV, p: process.env.PANDADOC_API_KEY, s: process.env.PANDADOC_SANDBOX_KEY };
  try {
    process.env.PANDADOC_API_KEY = "prod";
    process.env.PANDADOC_SANDBOX_KEY = "sand";
    process.env.VERCEL_ENV = "production";
    assert.deepEqual(clavePandadoc(), { clave: "prod", modo: "produccion" });
    process.env.VERCEL_ENV = "preview";
    assert.deepEqual(clavePandadoc(), { clave: "sand", modo: "prueba" });
    delete process.env.VERCEL_ENV;
    assert.deepEqual(clavePandadoc(), { clave: "sand", modo: "prueba" });
    delete process.env.PANDADOC_SANDBOX_KEY;
    assert.equal(clavePandadoc(), null, "en local sin sandbox no cae a la de producción");
  } finally {
    for (const [k, v] of [["VERCEL_ENV", antes.e], ["PANDADOC_API_KEY", antes.p], ["PANDADOC_SANDBOX_KEY", antes.s]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("Zoom: las reuniones con su id como texto (pasan los 10 dígitos)", () => {
  assert.deepEqual(leerReunionesZoom({ meetings: [{ id: 92674392836, topic: "Clase Hackear AI", type: 8 }, { topic: "sin id" }] }),
    [{ id: "92674392836", tema: "Clase Hackear AI", tipo: 8 }]);
  assert.deepEqual(leerReunionesZoom(null), []);
});

test("Telegram: cuando un grupo pasa a supergrupo, el id nuevo reemplaza al viejo en los programas", () => {
  const programas = [
    { id: "principals", nombre: "Principals", telegram: ["-5096373090"] },
    { id: "hackear-ai", nombre: "Hackear AI", telegram: ["-100111", "-5096373090", "-1003910580644"] },
    { id: "downsell", nombre: "Downsell", telegram: [] },
  ];
  assert.deepEqual(cambiarGrupoEnProgramas(programas, "-5096373090", "-1003910580644"), [
    { id: "principals", nombre: "Principals", telegram: ["-1003910580644"] },
    { id: "hackear-ai", nombre: "Hackear AI", telegram: ["-100111", "-1003910580644"] },
    { id: "downsell", nombre: "Downsell", telegram: [] },
  ]);
  /* Sin programas guardados (los de siempre) o sin ese grupo: no hay nada que guardar. */
  assert.equal(cambiarGrupoEnProgramas(null, "-1", "-2"), null);
  assert.equal(cambiarGrupoEnProgramas(programas, "-999", "-2"), null);
});

test("Zoom: si la reunión acepta inscriptos y cómo se llama para elegirla", () => {
  assert.equal(leerInscripcionZoom({ type: 8, settings: { approval_type: 0 } }), true);
  assert.equal(leerInscripcionZoom({ type: 2, settings: { approval_type: 1 } }), true);
  assert.equal(leerInscripcionZoom({ type: 8, settings: { approval_type: 2 } }), false);
  /* Recurrente sin horario fijo: Zoom no deja registro aunque diga otra cosa. */
  assert.equal(leerInscripcionZoom({ type: 3, settings: { approval_type: 0 } }), false);
  assert.equal(leerInscripcionZoom(null), null);
  const todas = [
    { id: "85046895266", tema: "Sesión de consultas IA", tipo: 8, inscripcion: true },
    { id: "84967094264", tema: "Sesión de consultas IA", tipo: 3, inscripcion: false },
    { id: "83219238566", tema: "Clases de marketing", tipo: 8, inscripcion: null },
  ];
  assert.equal(nombreDeReunion(todas[0], todas), "Sesión de consultas IA · …5266");
  assert.equal(nombreDeReunion(todas[1], todas), "Sesión de consultas IA · …4264 (sin inscripción)");
  assert.equal(nombreDeReunion(todas[2], todas), "Clases de marketing");
});

test("Accesos: lo que hizo la app queda en las marcas de la ficha de Customer Success", () => {
  const dado = (plataforma: "wisboo" | "telegram" | "zoom", programa = "hackear-ai", estado: "dado" | "entro" | "quitado" | "fallo" = "dado") => ({ plataforma, programa, estado });
  assert.deepEqual(marcasDeLaFicha([dado("wisboo"), dado("telegram"), dado("zoom")]), { acceso: "Completos", accesoWibo: true, accesoZoom: true });
  assert.deepEqual(marcasDeLaFicha([dado("wisboo", "downsell"), dado("telegram", "downsell")]), { acceso: "Downsell", accesoWibo: true, accesoZoom: false });
  /* Después del outboarding (todo quitado) o si todo falló: sin acceso. */
  assert.deepEqual(marcasDeLaFicha([dado("wisboo", "hackear-ai", "quitado"), dado("zoom", "hackear-ai", "fallo")]), { acceso: "Sin acceso", accesoWibo: false, accesoZoom: false });
});

test("Zoom: por qué no inscribió a alguien, en castellano", () => {
  assert.match(motivoZoom(429, { code: 429, message: "You have exceeded the daily rate limit" }), /límite por día/);
  assert.match(motivoZoom(300, { code: 3043, message: "Meeting does not have registration enabled." }), /Registro/);
  assert.match(motivoZoom(404, null), /no encuentra la reunión/);
  assert.equal(motivoZoom(400, { message: "Invalid email" }), "Zoom no lo inscribió (contestó 400: Invalid email).");
});
