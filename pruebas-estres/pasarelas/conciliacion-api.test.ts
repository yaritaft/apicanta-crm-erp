import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";
import { filaParaBase, nuevoRegistro } from "@/lib/registros-webinar";

/* ==================================================================
   ESTRÉS · /api/conciliacion, lo que necesita la pantalla «Pendientes de
   conciliar» de la tabla de formularios, contra una nube de mentira:

   - sólo contesta a quien tiene Finanzas, Marketing o Webinars, nunca al que
     ve «sólo lo suyo», y para unir o descartar hace falta poder editar;
   - los candidatos son los formularios SIN unir que comparten mail o
     teléfono con las personas pedidas, o se llaman parecido (con o sin tildes);
   - lo que devuelve no lleva IP, navegador, cookies ni respuestas;
   - unir no pisa lo que otra persona (o el proceso automático) unió antes.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.NEXT_PUBLIC_SUPABASE_URL = URL_NUBE;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-conciliacion-falsa-0008";
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-conciliacion-falsa-0008";

const nube = instalarFetchFalso();
/* Quién pide: puede entrar, su nivel y si ve sólo lo suyo. */
const YO = { entra: true, nivel: 2, soloLoSuyo: false };
nube.nube.rpc.set("puede_entrar", () => YO.entra);
nube.nube.rpc.set("nivel_area", () => YO.nivel);
nube.nube.rpc.set("solo_lo_suyo", () => YO.soloLoSuyo);
nube.nube.declarar("cron_estado", [["clave"]]);
const { POST } = await import("@/app/api/conciliacion/route");
const { guardarEstadoDelCruce } = await import("@/lib/cruce-nube");
const { nubeServidor } = await import("@/lib/servidor");
test.after(() => nube.restaurar());

const pedir = async (cuerpo: unknown, token: string | null = "jwt-de-prueba") => {
  const r = await POST(new Request("http://localhost/api/conciliacion", {
    method: "POST", body: JSON.stringify(cuerpo), headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : { "content-type": "application/json" },
  }));
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const reg = (email: string, extra: Record<string, unknown> = {}) =>
  filaParaBase(nuevoRegistro({ email, origen: "excel", registradoEn: "2026-09-01T12:00:00.000Z", ip: "190.1.2.3", userAgent: "Mozilla", fbp: "fb.1.2", ...extra } as never));
const filaDe = (id: string) => nube.nube.filas("registros_webinar").find((r) => r.id === id)!;

function sembrar() {
  Object.assign(YO, { entra: true, nivel: 2, soloLoSuyo: false });
  nube.nube.vaciar();
  nube.nube.filas("contactos").push({ id: "c1", nombre: "Ana Pérez", email: "ana@mail.com", extra: {} });
  nube.nube.filas("registros_webinar").push(
    reg("ana@mail.com", { id: "r_mail" }),
    reg("otro@mail.com", { id: "r_tel", nombre: "A. P.", telefono: "+54 9 11 5555 1111" }),
    reg("x@mail.com", { id: "r_nombre", nombre: "Ana Perez" }),
    reg("y@mail.com", { id: "r_otra", nombre: "Zoe Quiroga" }),
    reg("ana@mail.com", { id: "r_unido", contactoId: "c9", cruce: "mail" }),
  );
}

test("sin sesión, 401; el que ve sólo lo suyo (closer), 403; el que sólo puede mirar no puede unir ni descartar", async () => {
  sembrar();
  assert.equal((await pedir({ accion: "unidos", contactoIds: ["c1"] }, null)).status, 401);
  YO.entra = false;
  assert.equal((await pedir({ accion: "unidos", contactoIds: ["c1"] })).status, 401);
  YO.entra = true; YO.soloLoSuyo = true;
  assert.equal((await pedir({ accion: "buscar", q: "ana" })).status, 403);
  YO.soloLoSuyo = false; YO.nivel = 0;
  assert.equal((await pedir({ accion: "buscar", q: "ana" })).status, 403);
  YO.nivel = 1;
  assert.equal((await pedir({ accion: "buscar", q: "ana" })).status, 200, "con nivel de ver, puede buscar");
  assert.equal((await pedir({ accion: "unir", registroId: "r_mail", contactoId: "c1", cruce: "manual" })).status, 403);
  assert.equal((await pedir({ accion: "noes", registroId: "r_mail", personaId: "c1" })).status, 403);
  assert.equal(filaDe("r_mail").contactoId, undefined, "nada se unió");
});

test("unidos: de los contactos pedidos, los que ya tienen un formulario", async () => {
  sembrar();
  const r = await pedir({ accion: "unidos", contactoIds: ["c1", "c9", "c_nadie"] });
  assert.deepEqual(r.json.unidos, ["c9"]);
  assert.deepEqual((await pedir({ accion: "unidos", contactoIds: "no es una lista" })).json.unidos, []);
});

test("candidatos: por mail, por teléfono y por nombre (con o sin tildes), sin los ya unidos, y sin datos de navegación", async () => {
  sembrar();
  const r = await pedir({ accion: "candidatos", emails: ["ana@mail.com"], telefonos: ["5491155551111"], nombres: ["Ana Pérez"] });
  const registros = r.json.registros as Record<string, unknown>[];
  const ids = registros.map((x) => x.id).sort();
  /* El teléfono se guardó como se escribió; el cruce lo normaliza (lib/registros-webinar.ts): se pide por esa clave. */
  const tel = String(filaDe("r_tel").telefonoNorm);
  const r2 = await pedir({ accion: "candidatos", emails: [], telefonos: [tel], nombres: [] });
  assert.deepEqual((r2.json.registros as { id: string }[]).map((x) => x.id), ["r_tel"]);
  assert.deepEqual(ids.includes("r_mail"), true, "por mail");
  assert.deepEqual(ids.includes("r_nombre"), true, "por nombre: «Ana Perez» sin tilde es «Ana Pérez»");
  assert.equal(ids.includes("r_unido"), false, "un formulario ya unido no se propone");
  assert.equal(ids.includes("r_otra"), false, "otra persona no aparece");
  for (const x of registros) for (const k of ["ip", "userAgent", "fbp", "fbc", "respuestas"]) assert.equal(k in x, false, `no viaja ${k}`);
});

test("buscar a mano: por mail, por teléfono o por nombre; menos de 3 letras no busca; trae también los ya unidos", async () => {
  sembrar();
  const ids = async (q: string) => ((await pedir({ accion: "buscar", q })).json.registros as { id: string }[]).map((x) => x.id).sort();
  assert.deepEqual(await ids("ana@mail"), ["r_mail", "r_unido"]);
  assert.deepEqual(await ids("quiroga"), ["r_otra"]);
  assert.deepEqual(await ids("QUIROGA zoe"), ["r_otra"], "sin importar mayúsculas ni el orden");
  assert.deepEqual(await ids("perez"), ["r_nombre"]);
  assert.deepEqual(await ids("5555 1111"), ["r_tel"]);
  assert.deepEqual(await ids("an"), []);
  assert.deepEqual(await ids("%%%"), [], "los comodines no son una búsqueda");
});

test("unir: ata el formulario al contacto; si ya estaba unido o el contacto no existe, no pisa nada", async () => {
  sembrar();
  const ok = await pedir({ accion: "unir", registroId: "r_mail", contactoId: "c1", cruce: "manual" });
  assert.equal(ok.status, 200);
  assert.equal(filaDe("r_mail").contactoId, "c1");
  assert.equal(filaDe("r_mail").cruce, "manual");
  assert.ok(filaDe("r_mail").cruceEn);
  assert.equal("ip" in (ok.json.registro as object), false);

  const otra = await pedir({ accion: "unir", registroId: "r_mail", contactoId: "c1", cruce: "manual" });
  assert.equal(otra.status, 409, "ya estaba unido: no se vuelve a unir");
  const ocupado = await pedir({ accion: "unir", registroId: "r_unido", contactoId: "c1", cruce: "manual" });
  assert.equal(ocupado.status, 409);
  assert.equal(filaDe("r_unido").contactoId, "c9", "lo que otro unió antes no se pisa");
  assert.equal((await pedir({ accion: "unir", registroId: "r_tel", contactoId: "c_no_existe", cruce: "manual" })).status, 409);
  assert.equal(filaDe("r_tel").contactoId, undefined);
  assert.equal((await pedir({ accion: "unir", registroId: "r_tel", contactoId: "c1", cruce: "inventado" })).status, 400);
  assert.equal((await pedir({ accion: "unir", registroId: "", contactoId: "c1", cruce: "manual" })).status, 400);
});

test("«No es»: se anota una sola vez y el formulario ya no se propone para esa persona", async () => {
  sembrar();
  assert.equal((await pedir({ accion: "noes", registroId: "r_nombre", personaId: "c1" })).status, 200);
  assert.equal((await pedir({ accion: "noes", registroId: "r_nombre", personaId: "c1" })).status, 200);
  assert.deepEqual(filaDe("r_nombre").descartados, ["c1"]);
  assert.equal((await pedir({ accion: "noes", registroId: "r_no_esta", personaId: "c1" })).status, 409);
});

test("el estado del cruce: sin tabla avisa; la corrida lo deja asentado y «unió algo» sólo cambia cuando une", async () => {
  sembrar();
  const sin = nube.nube.tablas.get("cron_estado");
  nube.nube.tablas.delete("cron_estado");
  assert.deepEqual((await pedir({ accion: "estado" })).json, { sinTabla: true });
  nube.nube.tablas.set("cron_estado", sin ?? []);
  assert.deepEqual((await pedir({ accion: "estado" })).json, { estado: null }, "todavía no corrió");

  const db = nubeServidor()!;
  await guardarEstadoDelCruce(db, { personas: 950, candidatos: 1, unidos: 1, contactosCompletados: 1, dudosas: 0, errores: [] });
  const primera = (await pedir({ accion: "estado" })).json.estado as { ok: boolean; ultimaUnionEn: string; resultado: { unidos: number } };
  assert.equal(primera.ok, true);
  assert.equal(primera.resultado.unidos, 1);
  assert.ok(primera.ultimaUnionEn);

  await guardarEstadoDelCruce(db, { personas: 950, candidatos: 0, unidos: 0, contactosCompletados: 0, dudosas: 0, errores: [] });
  const segunda = (await pedir({ accion: "estado" })).json.estado as { ultimaUnionEn: string; resultado: { unidos: number } };
  assert.equal(segunda.resultado.unidos, 0);
  assert.equal(segunda.ultimaUnionEn, primera.ultimaUnionEn, "una corrida sin nada nuevo no cambia la última vez que unió");

  await guardarEstadoDelCruce(db, { error: "se cayó la base" });
  const tercera = (await pedir({ accion: "estado" })).json.estado as { ok: boolean; resultado: { error: string } };
  assert.equal(tercera.ok, false);
  assert.equal(tercera.resultado.error, "se cayó la base");
});

test("acción desconocida o cuerpo roto: 400, nunca un error del servidor", async () => {
  sembrar();
  assert.equal((await pedir({ accion: "borrar-todo" })).status, 400);
  assert.equal((await pedir("texto suelto")).status, 400);
  assert.equal((await pedir(null)).status, 400);
});
