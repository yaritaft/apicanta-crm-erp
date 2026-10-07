import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Azar, basura, capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el webhook de Fathom (/api/fathom/webhook) con una nube de
   mentira: cada reunión se guarda atada a su llamada de Calendly, UNA vez
   (el id sale del recording_id), las que no tienen llamada (personales,
   internas) no se guardan, la que se ató a mano no se desata sola y con
   basura firmada contesta 200 (no se reintenta) sin guardar nada.
   ================================================================== */

const SECRETO = `whsec_${Buffer.from("fathom-estres-secreto-0123456789ab").toString("base64")}`;
process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-fathom-estres-falsa-0008";
process.env.FATHOM_WEBHOOK_SECRET = SECRETO;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete process.env[k];

const nube = instalarFetchFalso();
const { POST } = await import("@/app/api/fathom/webhook/route");
test.after(() => nube.restaurar());

const clave = Buffer.from(SECRETO.slice(6), "base64");
const enviar = (cuerpo: string, op: { id?: string; ts?: number; firma?: string } = {}) => {
  const id = op.id ?? `msg_${Math.random().toString(36).slice(2)}`;
  const t = String(op.ts ?? Math.floor(Date.now() / 1000));
  const firma = op.firma ?? `v1,${createHmac("sha256", clave).update(`${id}.${t}.${cuerpo}`).digest("base64")}`;
  return POST(new Request("http://localhost/api/fathom/webhook", { method: "POST", headers: { "webhook-id": id, "webhook-timestamp": t, "webhook-signature": firma }, body: cuerpo }));
};

const sesiones = () => nube.nube.filas("sesiones");
const graba = () => nube.nube.filas("grabaciones");

const reunion = (rec: string, invitados: string[], cuando: string, extra: Record<string, unknown> = {}) => ({
  recording_id: rec, title: "Llamada con cliente", url: `https://fathom.video/calls/${rec}`, share_url: `https://fathom.video/share/${rec}`,
  scheduled_start_time: cuando, recording_start_time: cuando, recording_end_time: new Date(Date.parse(cuando) + 30 * 60000).toISOString(), created_at: cuando,
  recorded_by: { name: "Cami Ruiz", email: "cami@apicanta.com" }, calendar_invitees: [{ name: "Cami", email: "cami@apicanta.com", is_external: false }, ...invitados.map((e) => ({ name: "Cliente", email: e, is_external: true }))],
  default_summary: { markdown_formatted: "## Resumen\n- Todo bien" }, transcript: [{ speaker: { display_name: "Cami" }, text: "Hola", timestamp: "00:00:01" }], action_items: [{ description: "Mandar propuesta", completed: false }], ...extra,
});

const sembrar = (inicia: string) => {
  nube.nube.vaciar();
  nube.nube.filas("sesiones").push({ id: "cal_A", email: "ana@cliente.com", inicia, anfitrion: "Cami Ruiz", estado: "agendada", calendlyInvitadoUri: "u/A" });
  nube.nube.filas("equipo").push({ id: "eq_1", nombre: "Cami Ruiz", email: "cami@apicanta.com" });
};

test("la reunión de una llamada de venta se guarda atada a ella, una sola vez, aunque el aviso llegue varias veces", propiedad("fathom idempotente", 30, async (az) => {
  const inicia = new Date(Date.now() - az.int(1, 5) * 3600000).toISOString();
  sembrar(inicia);
  const rec = `rec_${az.alfanum(10)}`;
  const cuerpo = JSON.stringify(reunion(rec, [az.pick(["ana@cliente.com", "ANA@Cliente.com"])], new Date(Date.parse(inicia) + az.int(0, 20) * 60000).toISOString()));
  const { valor } = await capturandoConsola(async () => {
    const rs: { recibido?: boolean; guardado?: boolean }[] = [];
    for (let i = 0; i < az.int(1, 4); i++) rs.push((await (await enviar(cuerpo)).json()) as { recibido?: boolean; guardado?: boolean });
    return rs;
  });
  assert.ok(valor.every((r) => r.recibido === true && r.guardado === true));
  assert.equal(graba().length, 1);
  assert.equal(graba()[0].id, `fathom_${rec}`);
  assert.equal(graba()[0].sesionId, "cal_A");
  assert.equal(graba()[0].emparejadaPor, "email-y-hora");
  assert.equal(graba()[0].grabadoPor, "cami@apicanta.com");
}));

test("una reunión sin llamada de Calendly (personal, interna o con otro mail) no se guarda: 200 para que Fathom no la reintente", async () => {
  const inicia = new Date(Date.now() - 3600000).toISOString();
  sembrar(inicia);
  const casos = [
    reunion("rec_personal", [], inicia), reunion("rec_otro", ["otra@persona.com"], inicia),
    reunion("rec_lejos", ["ana@cliente.com"], new Date(Date.parse(inicia) + 6 * 3600000).toISOString()),
    reunion("rec_interna", ["cami@apicanta.com"], inicia),
  ];
  for (const c of casos) {
    const r = await enviar(JSON.stringify(c));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { recibido: true, guardado: false });
  }
  assert.equal(graba().length, 0);
});

test("la grabación atada a mano no se desata sola: un aviso nuevo de la misma reunión no la cambia de llamada", async () => {
  const inicia = new Date(Date.now() - 3600000).toISOString();
  sembrar(inicia);
  graba().push({ id: "fathom_rec_mano", fuente: "fathom", recordingId: "rec_mano", sesionId: "cal_OTRA", emparejadaPor: "a-mano", titulo: "x", invitados: [], accionables: [], creadoEn: "2026-10-01T00:00:00.000Z" });
  await enviar(JSON.stringify(reunion("rec_mano", ["ana@cliente.com"], inicia)));
  assert.equal(graba().length, 1);
  assert.equal(graba()[0].sesionId, "cal_OTRA");
  assert.equal(graba()[0].emparejadaPor, "a-mano");
});

test("basura firmada (JSON roto, null, listas, tipos cambiados): 400 si no es JSON, 200 sin guardar si no trae un recording_id; nunca 500", propiedad("basura de Fathom", 150, async (az) => {
  sembrar(new Date().toISOString());
  const roto = az.pick(["", "{", "hola", "[1,", "\u0000"]);
  assert.equal((await enviar(roto)).status, 400);
  const cuerpo = JSON.stringify(az.pick<unknown>([null, [], 5, "x", {}, { meeting: null }, basura(az), { recording_id: az.pick([null, "", {}, [], false]) }, { meeting: { recording_id: "", calendar_invitees: "x" } }])) ?? "null";
  const { valor: r } = await capturandoConsola(() => enviar(cuerpo));
  assert.equal(r.status, 200, cuerpo.slice(0, 100));
  assert.equal(graba().length, 0);
}));

test("la firma: sin cabeceras, de otra clave, vieja o con el cuerpo cambiado: 401 y no guarda; sin secreto configurado: 503", async () => {
  const inicia = new Date(Date.now() - 3600000).toISOString();
  sembrar(inicia);
  const cuerpo = JSON.stringify(reunion("rec_firma", ["ana@cliente.com"], inicia));
  const otra = Buffer.from("otra-clave");
  const id = "msg_1", t = String(Math.floor(Date.now() / 1000));
  const con = (k: Buffer, c: string, ts = t) => `v1,${createHmac("sha256", k).update(`${id}.${ts}.${c}`).digest("base64")}`;
  assert.equal((await enviar(cuerpo, { id, firma: con(otra, cuerpo) })).status, 401);
  assert.equal((await enviar(cuerpo, { id, firma: con(clave, cuerpo + " ") })).status, 401);
  const viejo = String(Math.floor(Date.now() / 1000) - 400);
  assert.equal((await enviar(cuerpo, { id, ts: Number(viejo), firma: con(clave, cuerpo, viejo) })).status, 401);
  assert.equal((await POST(new Request("http://localhost/api/fathom/webhook", { method: "POST", body: cuerpo }))).status, 401);
  assert.equal(graba().length, 0);
  const antes = process.env.FATHOM_WEBHOOK_SECRET;
  delete process.env.FATHOM_WEBHOOK_SECRET;
  try {
    const r = await enviar(cuerpo);
    assert.equal(r.status, 503, "sin secreto no se acepta nada");
    assert.equal(graba().length, 0);
  } finally { process.env.FATHOM_WEBHOOK_SECRET = antes; }
  void Azar;
});
