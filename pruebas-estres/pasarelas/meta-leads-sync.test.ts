import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Azar, capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · los formularios de Meta (lib/meta-leads-sync.ts y
   /api/meta/leads/webhook) con una nube de mentira y un Graph de
   mentira (sin red).

   - Reingresar el mismo lead (Meta reintenta el webhook) no duplica
     contactos, inscripciones ni oportunidades; en cualquier orden.
   - Lo que el equipo cargó (nombre, teléfono) no se pisa.
   - La nube de verdad (PostgREST) corta en 1000 filas sin avisar: lo que
     se cuenta sobre todos los contactos tiene que pedirse por páginas.
   ================================================================== */

const SECRETO_APP = "meta-app-secreto-estres-4f3e2d1c0b9a";
process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-metaleads-estres-falsa-0009";
process.env.META_SYSTEM_TOKEN = "meta-system-estres-token-0a1b2c3d4e5f6a7b";
process.env.META_APP_SECRET = SECRETO_APP;
delete process.env.META_APP_ID;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];

const nube = instalarFetchFalso();
const { ingresarAvisosMeta } = await import("@/lib/meta-leads-sync");
const webhook = await import("@/app/api/meta/leads/webhook/route");
test.after(() => nube.restaurar());

interface LeadGraph { id: string; email?: string; nombre?: string; tel?: string; campania?: string; creado: string }
let leadsGraph: LeadGraph[] = [];

function servirGraph() {
  nube.soltar();
  nube.manejar((url) => {
    if (url.host !== "graph.facebook.com") return undefined;
    const id = url.pathname.split("/").pop() ?? "";
    if (id === "P1") return { json: { id: "P1", name: "Página", access_token: "page-token-estres-aaaaaaaaaaaaaaaa" } };
    if (id === "F1") return { json: { id: "F1", name: "Formulario [WEBINAR]", status: "ACTIVE", questions: [{ key: "nivel_de_ingles", label: "¿Cuál es tu nivel de inglés?" }] } };
    const l = leadsGraph.find((x) => x.id === id);
    if (!l) return { status: 400, json: { error: { message: "Unsupported get request", code: 100 } } };
    const campos = [
      ...(l.nombre ? [{ name: "full_name", values: [l.nombre] }] : []), ...(l.email ? [{ name: "email", values: [l.email] }] : []), ...(l.tel ? [{ name: "phone_number", values: [l.tel] }] : []),
      { name: "nivel_de_ingles", values: ["conversacional"] },
    ];
    return { json: { id: l.id, created_time: l.creado, form_id: "F1", field_data: campos, ad_id: "120000000000001", ad_name: "Anuncio 1", campaign_name: l.campania, platform: "fb", is_organic: false } };
  });
}

const avisar = (ids: string[]) => ingresarAvisosMeta(ids.map((leadgen_id) => ({ leadgen_id, page_id: "P1", form_id: "F1" })));
const contactos = () => nube.nube.filas("contactos");
const leads = () => nube.nube.filas("leads");
const dia = (iso: string) => iso.slice(0, 10).replaceAll("-", "");

function sembrar() {
  nube.nube.vaciar();
  nube.nube.filas("webinars").push({ id: "web_a", fecha: new Date(Date.now() + 7 * 86400000).toISOString(), formularios: 0, extra: {} });
  nube.nube.filas("etapas").push({ id: "et_nuevo", orden: 1, nombre: "Nuevo" });
}

test("el mismo lead una vez, varias veces y en cualquier orden: un contacto por mail, una inscripción por lead, una oportunidad por persona", propiedad("leads de Meta idempotentes", 30, async (az) => {
  sembrar();
  const campania = `webinar_${dia(nube.nube.filas("webinars")[0].fecha as string)}`;
  const personas = Array.from({ length: az.int(1, 4) }, (_, i) => ({ email: `${az.alfanum(6).toLowerCase()}${i}@${az.pick(["gmail.com", "mail.com"])}`, nombre: az.pick(["Ana Pérez", "Beto Núñez", "Cami Ruiz"]) }));
  leadsGraph = [];
  for (const p of personas) for (let k = az.int(1, 3); k > 0; k--) leadsGraph.push({ id: `L${az.alfanum(10)}`, email: az.pick([p.email, p.email.toUpperCase()]), nombre: p.nombre, tel: "+54 9 11 5555-1234", campania, creado: new Date(Date.now() - az.int(1, 60) * 60000).toISOString() });
  servirGraph();
  const ids = leadsGraph.map((l) => l.id);
  await capturandoConsola(async () => {
    for (const lote of [az.mezclar(ids), az.mezclar([...ids, ...ids]), az.mezclar(ids).slice(0, 2)]) {
      const r = await avisar(lote);
      assert.deepEqual(r.errores, []);
    }
  });
  assert.equal(contactos().length, personas.length, "un contacto por persona");
  for (const c of contactos()) {
    const inscripciones = (c.extra as { formulariosMeta: { leadgenId: string }[] }).formulariosMeta;
    const esperadas = leadsGraph.filter((l) => l.email!.toLowerCase() === (c.email as string).toLowerCase()).map((l) => l.id).sort();
    assert.deepEqual(inscripciones.map((i) => i.leadgenId).sort(), esperadas, "una inscripción por lead, sin repetir");
  }
  assert.equal(new Set(leads().map((l) => l.contactoId)).size, leads().length, "una oportunidad por persona");
  assert.equal(leads().length, personas.length);
  /* Reingresar un lead lo pone al final de la lista de inscripciones: el orden no cuenta, el conjunto sí. */
  const canon = () => JSON.stringify(contactos().map((c): Record<string, unknown> => ({ ...c, extra: { formulariosMeta: [...(c.extra as { formulariosMeta: { leadgenId: string }[] }).formulariosMeta].sort((a, b) => a.leadgenId.localeCompare(b.leadgenId)) } })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const foto = canon();
  await capturandoConsola(() => avisar(ids));
  assert.equal(canon(), foto, "otra vuelta no cambia nada");
  /* «Formularios» del webinar = las inscripciones. */
  assert.equal(nube.nube.filas("webinars")[0].formularios, leadsGraph.length);
}));

test("lo que el equipo cargó a mano (nombre y teléfono corregidos) no se pisa cuando Meta vuelve a mandar el lead", async () => {
  sembrar();
  leadsGraph = [{ id: "Lx1", email: "ana@mail.com", nombre: "Ana", tel: "+54 9 11 1111-1111", campania: "x", creado: new Date().toISOString() }];
  servirGraph();
  await capturandoConsola(() => avisar(["Lx1"]));
  Object.assign(contactos()[0], { nombre: "Ana Corregida", telefono: "+54 9 11 9999-9999" });
  await capturandoConsola(() => avisar(["Lx1", "Lx1"]));
  assert.equal(contactos().length, 1);
  assert.equal(contactos()[0].nombre, "Ana Corregida");
  assert.equal(contactos()[0].telefono, "+54 9 11 9999-9999");
});

test("webhook firmado: un aviso roto o sin leadgen no tira; sin firma 401", async () => {
  sembrar();
  servirGraph();
  const firmar = (c: string) => `sha256=${createHmac("sha256", SECRETO_APP).update(c, "utf8").digest("hex")}`;
  const enviar = (c: string, firma = firmar(c)) => webhook.POST(new Request("http://localhost/api/meta/leads/webhook", { method: "POST", headers: { "x-hub-signature-256": firma }, body: c }));
  for (const cuerpo of [{}, { object: "user" }, { object: "page" }, { object: "page", entry: null }, { object: "page", entry: [{}] }, { object: "page", entry: [{ changes: [{ field: "feed", value: {} }] }] }, { object: "page", entry: [{ changes: [{ field: "leadgen", value: {} }] }] }, { object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: 5 } }] }] }]) {
    const r = await enviar(JSON.stringify(cuerpo));
    assert.equal(r.status, 200, JSON.stringify(cuerpo));
  }
  assert.equal((await enviar("{}", "")).status, 401);
  assert.equal((await enviar("{")).status, 400);
  assert.equal(contactos().length, 0);
});

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: «Formularios» de un webinar se cuenta sobre las primeras 1000 filas que devuelve la nube: con más de 1000 contactos con formularios de Meta el número BAJA", { todo: true }, async () => {
  /* completarFormularios() (y contexto()) piden `contactos.select("extra").not("extra->formulariosMeta","is",null)` sin
     paginar. PostgREST (Supabase) corta en 1000 sin avisar: con 1.500 inscripciones el conteo da 1.000 y, como el campo
     «formularios» del webinar sigue siendo el que puso la propia sincronización (extra.formulariosAuto), se lo pisa con
     un número menor. En el resto de la app ya se pagina por esto (registros-nube, whatsapp-servidor, agendas-sync). */
  sembrar();
  const web = nube.nube.filas("webinars")[0];
  const campania = `webinar_${dia(web.fecha as string)}`;
  for (let i = 0; i < 1500; i++) {
    contactos().push({ id: `con_${i}`, nombre: `P${i}`, email: `p${i}@mail.com`, extra: { formulariosMeta: [{ leadgenId: `viejo${i}`, formularioId: "F1", formulario: "F", webinarId: "web_a", creado: "2026-10-01T00:00:00Z", respuestas: [] }] }, creadoEn: "2026-10-01T00:00:00Z" });
  }
  Object.assign(web, { formularios: 1500, extra: { formulariosAuto: 1500 } });
  leadsGraph = [{ id: "Lnuevo", email: "nuevo@mail.com", nombre: "Nuevo", campania, creado: new Date().toISOString() }];
  servirGraph();
  const { valor: r } = await capturandoConsola(() => avisar(["Lnuevo"]));
  assert.deepEqual(r.errores, []);
  assert.equal(web.formularios, 1501, "1.500 que ya estaban + 1 nuevo");
});
