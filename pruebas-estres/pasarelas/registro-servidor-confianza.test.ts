import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el servidor de confianza del formulario (Apps Script del Sheet)

   El Apps Script de la landing manda a /api/webinar/registro los registros de
   TODAS las personas desde las mismas IP de Google. Con el límite de 10 por
   minuto por IP, en el pico de un webinar se cortarían. Con la clave
   REGISTRO_TOKEN en la cabecera x-registro-token ese servidor lo saltea y no
   se guarda su IP (sería la de Google, no la de la persona). Cualquier otro,
   o sin la variable definida, sigue con el límite de siempre.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-servidor-confianza-falsa-0001";
for (const k of ["REGISTRO_ORIGENES", "META_PIXEL_ID", "META_CAPI_TOKEN", "META_SYSTEM_TOKEN", "REGISTRO_TOKEN"]) delete process.env[k];

const nube = instalarFetchFalso();
const { POST } = await import("@/app/api/webinar/registro/route");
test.after(() => nube.restaurar());

const CLAVE = "clave-de-prueba-de-32-caracteres-x";

let n = 0;
const enviar = async (ip: string, cabeceras: Record<string, string> = {}) => {
  n++;
  const req = new Request("http://localhost/api/webinar/registro", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...cabeceras },
    body: JSON.stringify({ nombre: `Persona ${n}`, email: `persona${n}@mail-prueba.com`, telefono: "+54 11 5555-0000" }),
  });
  return (await POST(req)).status;
};
const enviarVarios = async (veces: number, ip: string, cabeceras: Record<string, string> = {}) => {
  const estados: number[] = [];
  for (let i = 0; i < veces; i++) estados.push(await enviar(ip, cabeceras));
  return estados;
};

test("con la clave correcta, 40 registros desde la misma IP pasan todos y no se guarda esa IP", async () => {
  nube.nube.vaciar();
  process.env.REGISTRO_TOKEN = CLAVE;
  const estados = await enviarVarios(40, "198.51.100.10", { "x-registro-token": CLAVE });
  assert.deepEqual([...new Set(estados)], [200]);
  assert.equal(nube.nube.filas("contactos").length, 40);
  const filas = nube.nube.filas("registros_webinar");
  assert.equal(filas.length, 40);
  assert.ok(filas.every((f) => !f.ip), "ningún registro guarda la IP del servidor de confianza");
});

test("sin clave: el límite de 10 por minuto por IP sigue igual (y la IP se guarda)", async () => {
  nube.nube.vaciar();
  process.env.REGISTRO_TOKEN = CLAVE;
  const estados = await enviarVarios(14, "198.51.100.20");
  assert.deepEqual(estados.slice(0, 10), Array(10).fill(200));
  assert.deepEqual(estados.slice(10), Array(4).fill(429));
  assert.ok(nube.nube.filas("registros_webinar").every((f) => f.ip === "198.51.100.20"));
});

test("una clave equivocada (del mismo largo o de otro) no saltea el límite", async () => {
  nube.nube.vaciar();
  process.env.REGISTRO_TOKEN = CLAVE;
  const igualLargo = "clave-equivocada".padEnd(CLAVE.length, "-");
  assert.equal(igualLargo.length, CLAVE.length);
  const a = await enviarVarios(12, "198.51.100.30", { "x-registro-token": igualLargo });
  assert.equal(a.filter((s) => s === 429).length, 2);
  const b = await enviarVarios(12, "198.51.100.31", { "x-registro-token": CLAVE + "-de-mas" });
  assert.equal(b.filter((s) => s === 429).length, 2);
});

test("si la variable no está definida, o es corta, ninguna cabecera vale (ni siendo igual)", async () => {
  nube.nube.vaciar();
  delete process.env.REGISTRO_TOKEN;
  const a = await enviarVarios(12, "198.51.100.40", { "x-registro-token": CLAVE });
  assert.equal(a.filter((s) => s === 429).length, 2);
  process.env.REGISTRO_TOKEN = "corta";
  const b = await enviarVarios(12, "198.51.100.41", { "x-registro-token": "corta" });
  assert.equal(b.filter((s) => s === 429).length, 2);
});

test("lo que manda el Apps Script del Sheet queda bien: nombre y teléfono, los UTMs aparte y lo demás como respuestas", async () => {
  nube.nube.vaciar();
  process.env.REGISTRO_TOKEN = CLAVE;
  /* El cuerpo exacto que arma enviarAApicanta_ a partir de lo que manda la landing (apicantait.com). */
  const cuerpo = {
    email: "Ana.Perez@Mail.com", english: "B2+", experience: "3-4", variant: "v2", sheet_name: "Lanzamiento 21",
    utm_source: "fb", utm_campaign: "campaña", utm_content: "anuncio-uno", ad_id: "120001", adset_name: "Frío",
    nombre: "Ana Pérez", telefono: "+54 11 5555-0000", pais: "Argentina", pagina: "/",
  };
  const res = await POST(new Request("http://localhost/api/webinar/registro", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.50", "x-registro-token": CLAVE },
    body: JSON.stringify(cuerpo),
  }));
  assert.equal(res.status, 200);
  const c = nube.nube.filas("contactos");
  assert.equal(c.length, 1);
  assert.equal(c[0].nombre, "Ana Pérez");
  assert.equal(c[0].email, "ana.perez@mail.com");
  assert.equal(c[0].telefono, "+54 11 5555-0000");
  assert.equal(c[0].pais, "Argentina");
  assert.deepEqual(c[0].utm, { utm_source: "fb", utm_campaign: "campaña", utm_content: "anuncio-uno" });
  const r = nube.nube.filas("registros_webinar");
  assert.equal(r.length, 1);
  const respuestas = JSON.stringify(r[0].respuestas);
  for (const k of ["english", "experience", "variant", "sheet_name", "ad_id", "adset_name"]) assert.ok(respuestas.includes(`"${k}"`), `falta la respuesta ${k}`);
  assert.ok(!r[0].ip);
});
