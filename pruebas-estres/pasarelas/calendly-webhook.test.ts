import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Azar, capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · Calendly: el webhook (/api/calendly/webhook) y la repesca del
   cron (/api/cron/calendly), de punta a punta con una nube de mentira y
   una API de Calendly de mentira (sin red).

   El aviso es «sólo el pitido»: la ruta le vuelve a preguntar a la API por
   el invitado. Por eso, lo que queda no depende del orden ni de cuántas
   veces llegue el mismo aviso (ni de si la repesca del cron corre en el
   medio): un contacto por mail, una oportunidad por persona y una llamada
   por invitado, con el estado que dice la API.
   ================================================================== */

const FIRMA = "calendly-firma-estres-8f7e6d5c4b3a2918";
const TOKEN_CRON = "cron-calendly-estres-7a6b5c4d3e2f1a09";
const TOKEN_API = "calendly-api-estres-0123456789abcdef";

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-calendly-estres-falsa-0006";
process.env.CALENDLY_WEBHOOK_SIGNING_KEY = FIRMA;
process.env.CRON_SECRET = TOKEN_CRON;
process.env.CALENDLY_TOKEN = TOKEN_API;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];

const nube = instalarFetchFalso();
const wh = await import("@/app/api/calendly/webhook/route");
const cron = await import("@/app/api/cron/calendly/route");
test.after(() => nube.restaurar());

interface Agenda { evento: string; invitado: string; email: string; nombre: string; estado: "active" | "canceled"; inicio: string; creada: string; utm?: Record<string, string>; tel?: string }

const API = "https://api.calendly.com";
const uriEvento = (a: Agenda) => `${API}/scheduled_events/${a.evento}`;
const uriInvitado = (a: Agenda) => `${uriEvento(a)}/invitees/${a.invitado}`;
const recursoInvitado = (a: Agenda) => ({
  uri: uriInvitado(a), email: a.email, name: a.nombre, status: a.estado, event: uriEvento(a), created_at: a.creada, updated_at: a.creada,
  questions_and_answers: [{ question: "¿Cuál es tu nivel de inglés?", answer: "Conversacional", position: 0 }, { question: "¿Cuántos años de experiencia programando?", answer: "3 años", position: 1 }],
  tracking: a.utm ?? { utm_source: "direct" }, text_reminder_number: a.tel ?? null, cancellation: a.estado === "canceled" ? { reason: "No puedo", created_at: a.creada } : null, rescheduled: false, no_show: null,
});
const recursoEvento = (a: Agenda) => ({
  uri: uriEvento(a), name: "Llamada de Asesoramiento - Webinar", status: a.estado, start_time: a.inicio, end_time: new Date(Date.parse(a.inicio) + 30 * 60000).toISOString(),
  created_at: a.creada, updated_at: a.creada, location: { join_url: "https://meet.example/x" }, event_memberships: [{ user_name: "Cami Ruiz", user_email: "cami@apicanta.com" }],
});

/* La API de mentira: responde lo que dice `agendas` en ese momento. */
let agendas: Agenda[] = [];
function servirCalendly() {
  nube.soltar();
  nube.manejar((url) => {
    if (url.host !== "api.calendly.com") return undefined;
    const m = /^\/scheduled_events\/([^/]+)(?:\/invitees(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (url.pathname === "/users/me") return { json: { resource: { current_organization: `${API}/organizations/ORG` } } };
    if (url.pathname === "/scheduled_events") return { json: { collection: [...new Map(agendas.map((a) => [a.evento, recursoEvento(a)])).values()], pagination: { next_page: null } } };
    if (!m) return undefined;
    const [, ev, inv] = m;
    if (inv) { const a = agendas.find((x) => x.evento === ev && x.invitado === inv); return a ? { json: { resource: recursoInvitado(a) } } : { status: 404, json: { title: "Resource Not Found" } }; }
    if (url.pathname.endsWith("/invitees")) return { json: { collection: agendas.filter((x) => x.evento === ev).map(recursoInvitado), pagination: {} } };
    const a = agendas.find((x) => x.evento === ev);
    return a ? { json: { resource: recursoEvento(a) } } : { status: 404, json: {} };
  });
}

const firmar = (cuerpo: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", FIRMA).update(`${t}.${cuerpo}`).digest("hex")}`;
const avisar = (a: Agenda, tipo = a.estado === "canceled" ? "invitee.canceled" : "invitee.created") => {
  const cuerpo = JSON.stringify({ event: tipo, payload: { uri: uriInvitado(a), email: a.email, name: a.nombre, status: a.estado, scheduled_event: { uri: uriEvento(a) } } });
  return wh.POST(new Request("http://localhost/api/calendly/webhook", { method: "POST", headers: { "calendly-webhook-signature": firmar(cuerpo) }, body: cuerpo }));
};
const repescar = () => cron.GET(new Request("http://localhost/api/cron/calendly", { headers: { authorization: `Bearer ${TOKEN_CRON}` } }));

const contactos = () => nube.nube.filas("contactos");
const leads = () => nube.nube.filas("leads");
const sesiones = () => nube.nube.filas("sesiones");

function agendasAleatorias(az: Azar): Agenda[] {
  const personas = Array.from({ length: az.int(1, 4) }, (_, i) => ({ email: `${az.alfanum(6).toLowerCase()}${i}@${az.pick(["gmail.com", "mail.com"])}`, nombre: az.pick(["Ana Pérez", "Beto Núñez", "Cami Ruiz", "Dani Gómez"]) }));
  const out: Agenda[] = [];
  for (const p of personas) for (let k = az.int(1, 3); k > 0; k--) {
    out.push({
      evento: `EV${az.alfanum(10)}`, invitado: `INV${az.alfanum(10)}`, email: az.pick([p.email, p.email.toUpperCase(), ` ${p.email}`.trimStart()]), nombre: p.nombre,
      estado: az.pick(["active", "active", "active", "canceled"]), inicio: new Date(Date.now() + az.int(1, 20) * 86400000).toISOString(), creada: new Date(Date.now() - az.int(1, 5) * 3600000).toISOString(),
      utm: az.pick<Record<string, string> | undefined>([undefined, { utm_source: "meta", utm_medium: "paid", utm_campaign: "webinar_20261014" }, { utm_source: "Webinar", utm_medium: "14-10" }]), tel: az.pick([undefined, "+54 9 11 5555-1234"]),
    });
  }
  return out;
}

const esperado = (as: Agenda[]) => {
  const personas = new Set(as.map((a) => a.email.trim().toLowerCase()));
  const conAgendaActiva = new Set(as.filter((a) => a.estado === "active").map((a) => a.email.trim().toLowerCase()));
  return { personas, conAgendaActiva };
};

function verificar(as: Agenda[]) {
  const e = esperado(as);
  assert.equal(sesiones().length, as.length, "una llamada por invitado");
  for (const a of as) {
    const s = sesiones().find((x) => x.id === `cal_${a.invitado}`);
    assert.ok(s, `falta la llamada de ${a.invitado}`);
    assert.equal(s.estado, a.estado === "canceled" ? "cancelada" : "agendada");
    assert.equal(s.calendlyInvitadoUri, uriInvitado(a));
    assert.equal(s.origen, "calendly");
  }
  assert.equal(new Set(contactos().map((c) => (c.email as string).trim().toLowerCase())).size, contactos().length, "un contacto por mail");
  assert.equal(contactos().length, e.personas.size, "un contacto por persona");
  /* Una oportunidad por persona, y sólo si alguna agenda estuvo activa en el momento de entrar. */
  const porContacto = new Map<string, number>();
  for (const l of leads()) porContacto.set(l.contactoId as string, (porContacto.get(l.contactoId as string) ?? 0) + 1);
  for (const n of porContacto.values()) assert.equal(n, 1, "una oportunidad por contacto");
  for (const s of sesiones()) assert.ok(contactos().some((c) => c.id === s.contactoId), "cada llamada apunta a un contacto que existe");
  void e.conAgendaActiva;
}

test("el mismo aviso una vez, varias veces, en cualquier orden y mezclado con la repesca del cron deja lo mismo", propiedad("calendly idempotente", 25, async (az) => {
  nube.nube.vaciar();
  agendas = agendasAleatorias(az);
  servirCalendly();
  const avisos = az.mezclar([...agendas, ...agendas, ...az.mezclar(agendas).slice(0, 2)]);
  const { texto } = await capturandoConsola(async () => {
    for (const a of avisos) {
      assert.equal((await avisar(a)).status, 200);
      if (az.bool(0.15)) assert.ok([200, 207].includes((await repescar()).status));
    }
    /* Y dos a la vez. */
    const a0 = agendas[0];
    const rs = await Promise.all([avisar(a0), avisar(a0), repescar()]);
    for (const r of rs) assert.ok([200, 207].includes(r.status));
  });
  assert.equal(texto.includes(TOKEN_API) || texto.includes(FIRMA) || texto.includes(TOKEN_CRON), false, "ningún secreto en la consola");
  verificar(agendas);
  const foto = JSON.stringify([sesiones().map((s) => [s.id, s.estado]).sort(), contactos().map((c) => c.id).sort(), leads().map((l) => l.id).sort()]);
  /* Una vuelta más de todo: nada cambia. */
  await capturandoConsola(async () => {
    for (const a of agendas) await avisar(a);
    await repescar();
  });
  assert.equal(JSON.stringify([sesiones().map((s) => [s.id, s.estado]).sort(), contactos().map((c) => c.id).sort(), leads().map((l) => l.id).sort()]), foto);
}));

test("el estado lo dice la API, no el aviso: un «created» viejo que llega después de la cancelación no revive la llamada", async () => {
  nube.nube.vaciar();
  const a: Agenda = { evento: "EVx1", invitado: "INVx1", email: "ana@mail.com", nombre: "Ana", estado: "active", inicio: new Date(Date.now() + 86400000).toISOString(), creada: new Date().toISOString() };
  agendas = [a];
  servirCalendly();
  await capturandoConsola(() => avisar(a));
  assert.equal(sesiones()[0].estado, "agendada");
  /* Se cancela en Calendly; llegan el aviso de cancelación y, tarde, el «created» reenviado. */
  agendas = [{ ...a, estado: "canceled" }];
  servirCalendly();
  await capturandoConsola(async () => { await avisar(agendas[0], "invitee.canceled"); await avisar(a, "invitee.created"); });
  assert.equal(sesiones().length, 1);
  assert.equal(sesiones()[0].estado, "cancelada");
  assert.equal(contactos().length, 1);
});

test("lo que el equipo cargó no se pisa al volver a traer la agenda: llamada hecha, nombre corregido, teléfono propio, notas y closer elegido a mano", async () => {
  nube.nube.vaciar();
  const a: Agenda = { evento: "EVx2", invitado: "INVx2", email: "beto@mail.com", nombre: "Beto", estado: "active", inicio: new Date(Date.now() + 86400000).toISOString(), creada: new Date().toISOString(), tel: "+54 9 11 1111-1111" };
  agendas = [a];
  servirCalendly();
  await capturandoConsola(() => avisar(a));
  Object.assign(sesiones()[0], { estado: "hecha", notas: "Fue una buena llamada", invitado: "Beto Corregido", titulo: "Mi título" });
  Object.assign(contactos()[0], { telefono: "+54 9 11 9999-9999", nombre: "Beto Corregido" });
  await capturandoConsola(async () => { for (let i = 0; i < 3; i++) await avisar(a); });
  assert.equal(sesiones().length, 1);
  assert.equal(sesiones()[0].estado, "hecha", "una llamada ya hecha no vuelve a «agendada»");
  assert.equal(sesiones()[0].notas, "Fue una buena llamada");
  assert.equal(sesiones()[0].invitado, "Beto Corregido");
  assert.equal(sesiones()[0].titulo, "Mi título");
  assert.equal(contactos()[0].telefono, "+54 9 11 9999-9999", "el teléfono cargado a mano no se pisa");
  assert.equal(contactos()[0].nombre, "Beto Corregido");
  assert.equal(leads().length, 1);
});

test("un aviso firmado de un invitado que la API no conoce (404) o con la API caída contesta 200 con el error y no guarda nada a medias", async () => {
  nube.nube.vaciar();
  const a: Agenda = { evento: "EVx3", invitado: "INVx3", email: "cami@mail.com", nombre: "Cami", estado: "active", inicio: new Date(Date.now() + 86400000).toISOString(), creada: new Date().toISOString() };
  agendas = [];
  servirCalendly();
  const { valor: r } = await capturandoConsola(() => avisar(a));
  assert.equal(r.status, 200, "con un error, Calendly reintenta y termina desactivando la suscripción");
  const j = (await r.json()) as { ok: boolean; error?: string };
  assert.equal(j.ok, false);
  assert.equal(JSON.stringify(j).includes(TOKEN_API), false);
  assert.equal(contactos().length + leads().length + sesiones().length, 0);
});

test("avisos firmados raros: tipos que no son de invitados se ignoran, y un payload sin uri o con tipos cambiados no tira", propiedad("avisos de Calendly raros", 120, async (az) => {
  nube.nube.vaciar();
  agendas = [];
  servirCalendly();
  const tipo = az.pick(["invitee.created", "invitee.canceled", "invitee_no_show.created", "invitee_no_show.deleted", "routing_form_submission.created", "", "x", "invitee.", "inviteeXcreated"]);
  const payload = az.pick<unknown>([{}, null, [], "x", 5, { uri: 5 }, { uri: "" }, { uri: `${API}/scheduled_events/E/invitees/I`, email: 5 }, { invitee: 5 }, { uri: `${API}/scheduled_events/E/invitees/I`, scheduled_event: "x" }]);
  const cuerpo = JSON.stringify({ event: tipo, payload });
  const { valor: r } = await capturandoConsola(() => wh.POST(new Request("http://localhost/api/calendly/webhook", { method: "POST", headers: { "calendly-webhook-signature": firmar(cuerpo) }, body: cuerpo })));
  assert.equal(r.status, 200, `${tipo} ${cuerpo.slice(0, 80)}`);
  assert.equal(contactos().length + sesiones().length, 0);
}));
