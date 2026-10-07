import test from "node:test";
import assert from "node:assert/strict";
import { capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el formulario de la landing del webinar de punta a punta
   (src/app/api/webinar/registro), contra una nube de mentira en memoria.

   La misma persona se anota varias veces, con el mail escrito de otra
   forma (mayúsculas, espacios), por un <form> o por JSON, a un webinar o a
   otro, y el equipo marca a algunas como «unido» o «contactado» entre medio.
   Tiene que quedar:
   - un contacto por mail (la misma persona), con un registro por webinar;
   - una fila en registros_webinar por mail y webinar (el id sale de ambos);
   - las marcas del equipo intactas;
   - lo escrito a mano (nombre, teléfono) sin pisar por el formulario.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-landing-estres-falsa-0005";
for (const k of ["REGISTRO_ORIGENES", "META_PIXEL_ID", "META_CAPI_TOKEN", "META_SYSTEM_TOKEN"]) delete process.env[k];

const nube = instalarFetchFalso();
const { POST } = await import("@/app/api/webinar/registro/route");
test.after(() => nube.restaurar());

const en = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString();
const sembrar = () => {
  nube.nube.vaciar();
  nube.nube.filas("webinars").push(
    { id: "web_a", fecha: en(3), estado: "programado", formularios: 0, extra: {} },
    { id: "web_b", fecha: en(10), estado: "programado", formularios: 0, extra: {} },
  );
};

let n = 0;
const registrar = async (campos: Record<string, string>, tipo: "json" | "form" = "form") => {
  const ip = `198.18.${Math.floor(++n / 250)}.${n % 250}`;
  const req = new Request("http://localhost/api/webinar/registro", {
    method: "POST",
    headers: { "content-type": tipo === "json" ? "application/json" : "application/x-www-form-urlencoded", "x-forwarded-for": ip },
    body: tipo === "json" ? JSON.stringify(campos) : new URLSearchParams(campos).toString(),
  });
  const res = await POST(req);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const contactos = () => nube.nube.filas("contactos");
const registros = () => nube.nube.filas("registros_webinar");

test("el mismo mail escrito de otra forma y por otra vía es la misma persona: un contacto, un registro por webinar, sin duplicar", propiedad("registros idempotentes", 30, async (az) => {
  sembrar();
  const personas = Array.from({ length: az.int(1, 4) }, (_, i) => ({ mail: `${az.alfanum(6).toLowerCase()}${i}@${az.pick(["gmail.com", "hotmail.com", "mail.com.ar"])}`, nombre: az.pick(["Ana Pérez", "Beto Núñez", "Cami"]), tel: `+54 9 11 ${az.digitos(4)}-${az.digitos(4)}`, pais: "Argentina" }));
  const envios: { p: (typeof personas)[number]; web: string }[] = [];
  for (const p of personas) for (const web of az.pick([["web_a"], ["web_b"], ["web_a", "web_b"]])) for (let k = az.int(1, 3); k > 0; k--) envios.push({ p, web });
  const variante = (m: string) => az.pick([m, m.toUpperCase(), ` ${m} `, m[0].toUpperCase() + m.slice(1)]);
  const nuevos = new Map<string, number>();
  for (const e of az.mezclar(envios)) {
    const r = await registrar({ email: variante(e.p.mail), nombre: e.p.nombre, telefono: e.p.tel, pais: e.p.pais, webinar: e.web, utm_source: "meta" }, az.pick(["json", "form"]));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.ok, true);
    assert.equal(r.json.webinarId, e.web);
    if (r.json.nuevo) nuevos.set(e.p.mail, (nuevos.get(e.p.mail) ?? 0) + 1);
  }
  assert.equal(contactos().length, personas.length, "un contacto por persona");
  for (const p of personas) assert.equal(nuevos.get(p.mail), 1, "«nuevo» es verdad una sola vez por persona");
  const esperadas = new Set(envios.map((e) => `${e.p.mail}|${e.web}`));
  assert.equal(registros().length, esperadas.size, "una fila por mail y webinar");
  assert.equal(new Set(registros().map((r) => r.id)).size, registros().length);
  for (const c of contactos()) {
    assert.equal(c.email, (c.email as string).trim().toLowerCase(), "el mail del contacto está normalizado");
    const regs = (c.extra as { registrosWebinar: { webinarId: string }[] }).registrosWebinar;
    assert.equal(new Set(regs.map((x) => x.webinarId)).size, regs.length, "un registro por webinar en el contacto");
    assert.equal(regs.length, new Set(envios.filter((e) => e.p.mail === c.email).map((e) => e.web)).size);
  }
}));

test("lo que el equipo marcó (unido, contactado, notas) y lo que cargó a mano no se pisa cuando la persona vuelve a anotarse", async () => {
  sembrar();
  await registrar({ email: "ana@mail.com", nombre: "Ana Pérez", telefono: "", pais: "", webinar: "web_a" });
  /* El equipo la marca y le completa el teléfono a mano. */
  const fila = registros()[0];
  Object.assign(fila, { grupo: "unido", grupoPor: "beto@apicanta.com", grupoEn: "2026-10-07T00:00:00.000Z", contactado: true, contactadoPor: "beto@apicanta.com", notas: "Pidió que la llamen" });
  Object.assign(contactos()[0], { telefono: "+54 9 11 5555-0000", nombre: "Ana P. (corregido)" });
  for (let i = 0; i < 3; i++) await registrar({ email: " ANA@mail.com ", nombre: "Otra Ana", telefono: "+54 9 11 9999-9999", pais: "Chile", webinar: "web_a" });
  assert.equal(registros().length, 1);
  assert.equal(registros()[0].grupo, "unido");
  assert.equal(registros()[0].grupoPor, "beto@apicanta.com");
  assert.equal(registros()[0].contactado, true);
  assert.equal(registros()[0].notas, "Pidió que la llamen");
  assert.equal(contactos().length, 1);
  assert.equal(contactos()[0].telefono, "+54 9 11 5555-0000", "el teléfono cargado a mano no se pisa");
  assert.equal(contactos()[0].nombre, "Ana P. (corregido)");
});

test("el webinar: el que dice el campo (su id o su día), si no el próximo vivo; uno que no existe cae al próximo", async () => {
  sembrar();
  const dia = (iso: string) => iso.slice(0, 10);
  const wa = nube.nube.filas("webinars")[0], wb = nube.nube.filas("webinars")[1];
  assert.equal((await registrar({ email: "a1@mail.com", webinar: "web_b" })).json.webinarId, "web_b");
  assert.equal((await registrar({ email: "a2@mail.com", webinar: dia(wb.fecha as string) })).json.webinarId, "web_b");
  assert.equal((await registrar({ email: "a3@mail.com" })).json.webinarId, "web_a", "sin dato: el próximo");
  assert.equal((await registrar({ email: "a4@mail.com", webinar: "no-existe" })).json.webinarId, "web_a");
  assert.equal((await registrar({ email: "a5@mail.com", utm_campaign: `webinar_${dia(wb.fecha as string).replaceAll("-", "")}` })).json.webinarId, "web_b", "por el UTM del estándar");
  wa.estado = "borrador"; wb.estado = "borrador";
  assert.equal((await registrar({ email: "a6@mail.com" })).json.webinarId, null, "ninguno vigente: queda sin webinar y no rompe");
});

test("campos desconocidos: van a las respuestas, cortados a 500 caracteres y a 20 como máximo; los UTMs y los conocidos no", async () => {
  sembrar();
  const campos: Record<string, string> = { email: "r@mail.com", nombre: "R", utm_source: "meta", sitio: "", webinar: "web_a" };
  for (let i = 0; i < 30; i++) campos[`pregunta_${i}`] = "x".repeat(i === 0 ? 2000 : 5);
  const r = await registrar(campos);
  assert.equal(r.status, 200);
  const respuestas = registros()[0].respuestas as { pregunta: string; respuesta: string }[];
  assert.ok(respuestas.length <= 20);
  assert.ok(respuestas.every((x) => x.respuesta.length <= 500));
  assert.ok(respuestas.every((x) => !["email", "nombre", "utm_source", "sitio", "webinar"].includes(x.pregunta)));
});

test("la base caída no filtra detalles: contesta 500 con un mensaje fijo", async () => {
  sembrar();
  const original = nube.nube.atender.bind(nube.nube);
  nube.nube.atender = async () => new Response(JSON.stringify({ code: "XX000", message: "connection refused (detalle interno de la base)" }), { status: 500, headers: { "content-type": "application/json" } });
  try {
    const { valor: r } = await capturandoConsola(() => registrar({ email: "caida@mail.com" }));
    assert.equal(r.status, 500);
    assert.equal(r.json.ok, false);
    const texto = JSON.stringify(r.json);
    assert.equal(texto.includes("connection refused"), false, "el error de la base no sale en la respuesta");
    assert.equal(texto.includes("svc-landing"), false);
  } finally { nube.nube.atender = original; }
});

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: un mail con «*» se pasa como comodín al ilike (exacto() sólo escapa \\, % y _): una persona nueva se mezcla con el contacto de otra", { todo: true }, async () => {
  /* PostgREST toma «*» como comodín en like/ilike (es el alias de «%» para no tener que codificarlo en la URL).
     «*@gmail.com» es un mail válido para el regex del formulario y encuentra el primer contacto de Gmail: la nueva
     inscripción se suma a SU extra.registrosWebinar y le completa lo que le falte. Lo mismo en calendly-sync y
     meta-leads-sync (tienen su propia copia de exacto()). */
  sembrar();
  contactos().push({ id: "con_victima", nombre: "Víctima", email: "victima@gmail.com", extra: {}, creadoEn: "2026-10-01T00:00:00.000Z" });
  const r = await registrar({ email: "*@gmail.com", nombre: "Atacante", telefono: "+54 9 11 1111-1111", webinar: "web_a" });
  assert.equal(r.status, 200);
  const busqueda = nube.nube.pedidos.filter((p) => p.url.includes("/contactos?") && p.url.includes("ilike")).map((p) => p.url);
  assert.ok(busqueda.length > 0);
  assert.ok(busqueda.every((u) => !/ilike\.[^&]*\*/.test(u)), `el patrón lleva un «*» sin escapar: ${busqueda[0]}`);
  const victima = contactos().find((c) => c.id === "con_victima")!;
  assert.deepEqual(victima.extra, {}, "el contacto de otra persona no se toca");
  assert.equal(victima.telefono, undefined);
});
