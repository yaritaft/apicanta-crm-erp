import test from "node:test";
import assert from "node:assert/strict";
import {
  desdeDelDiagnostico, diagnosticar, leerMiembrosDeFathom, leerReunionDiag, plataformaDe,
  type EntradaDiagnostico, type LlamadaDiag, type MiembroDiag,
} from "@/lib/fathom-diagnostico";
import {
  equipoDeLaPasada, equiposDeVentas, escribirPasada, esEquipoDeVentas, grabadaPor, leerEquipos, leerPasada, PRIMERA_PASADA, seguir,
} from "@/lib/fathom-equipos";

/* El diagnóstico de Fathom (F2-04) con respuestas simuladas de su API:
   los items son como los devuelve GET /meetings (sin transcripción). */

const AHORA = Date.parse("2026-10-06T12:00:00Z");
const DESDE = "2026-09-16T00:00:00.000Z";

const equipoApp: MiembroDiag[] = [
  { nombre: "Yari Taft", email: "yari@apicanta.com", rol: "ceo", activo: true },
  { nombre: "Dante Barbieri", email: "dante@apicanta.com", rol: "closer", activo: true },
  { nombre: "Valentín Abadía", email: "valentin@apicanta.com", rol: "closer", activo: true },
];

const YARI = { name: "Yari Taft", email: "yari@apicanta.com", team: "Sales" };
const DANTE = { name: "Dante Barbieri", email: "dante@apicanta.com", team: "Sales" };
const VALEN = { name: "Valentín Abadía", email: "valentin@apicanta.com", team: "Sales" };

let n = 0;
/** Una reunión como la devuelve Fathom: quién grabó, con quién y cuándo. */
function reunion(por: { name: string; email: string; team?: string }, con: string | null, cuando: string, extra: Record<string, unknown> = {}) {
  n++;
  const invitados = [{ name: por.name, email: por.email, is_external: false }];
  if (con) invitados.push({ name: con, email: con, is_external: true });
  return {
    title: `Reunión secreta ${n}`, meeting_title: `Reunión secreta ${n}`, recording_id: 1000 + n,
    url: `https://fathom.video/calls/${1000 + n}`, share_url: `https://fathom.video/share/x${n}`,
    created_at: cuando, scheduled_start_time: cuando, recording_start_time: cuando, recording_end_time: cuando,
    calendar_invitees_domains_type: con ? "one_or_more_external" : "only_internal",
    calendar_invitees: invitados, recorded_by: por, ...extra,
  };
}

let l = 0;
const llamada = (anfitrion: string, email: string, inicia: string, enlace: string, estado = "hecha"): LlamadaDiag =>
  ({ id: `ses_${++l}`, email, inicia, anfitrion, enlace, estado });

const ZOOM = "https://us02web.zoom.us/j/123456";
const MEET = "https://meet.google.com/abc-defg-hij";

function entrada(p: Partial<EntradaDiagnostico>): EntradaDiagnostico {
  return {
    ahora: AHORA, desde: DESDE, generales: [], generalesCompleto: true, equipos: ["Sales"], miembros: null, porEquipo: [],
    conexion: { conectado: true, paraElEquipo: true }, llamadas: [], equipoApp, yaGuardadas: [], errores: [], ...p,
  };
}

test("la plataforma sale del enlace de la reunión", () => {
  assert.equal(plataformaDe("https://us02web.zoom.us/j/123?pwd=x"), "zoom");
  assert.equal(plataformaDe("https://zoom.us/j/9"), "zoom");
  assert.equal(plataformaDe("https://meet.google.com/abc-defg-hij"), "meet");
  assert.equal(plataformaDe("https://teams.microsoft.com/l/meetup-join/xyz"), "teams");
  assert.equal(plataformaDe("https://ejemplo.com/sala"), "otra");
  assert.equal(plataformaDe(""), "sin-enlace");
  assert.equal(plataformaDe(null), "sin-enlace");
});

test("una reunión de Fathom se lee con quién grabó, su equipo y su tipo", () => {
  const r = leerReunionDiag(reunion(DANTE, "lead@gmail.com", "2026-09-20T15:00:00Z"))!;
  assert.equal(r.g.grabadoPor, "dante@apicanta.com");
  assert.equal(r.equipo, "Sales");
  assert.equal(r.tipo, "con-externos");
  assert.equal(leerReunionDiag(reunion(YARI, null, "2026-09-20T15:00:00Z"))!.tipo, "solo-internos");
  /* Sin el campo del tipo, se deduce de los invitados. */
  assert.equal(leerReunionDiag({ recording_id: 5, calendar_invitees: [{ email: "a@b.com", is_external: true }] })!.tipo, "con-externos");
  assert.equal(leerReunionDiag({ recording_id: 6 })!.tipo, "sin-dato");
  assert.equal(leerReunionDiag({ title: "sin id" }), null);
});

test("(c) las que sólo aparecen al pedir por equipo: la app no pedía las del equipo", () => {
  const deYari = reunion(YARI, "a@lead.com", "2026-09-22T15:00:00Z");
  const deDante = reunion(DANTE, "b@lead.com", "2026-09-23T15:00:00Z");
  const deValen = reunion(VALEN, "c@lead.com", "2026-09-24T15:00:00Z");
  const d = diagnosticar(entrada({
    generales: [deYari],
    porEquipo: [{ equipo: "Sales", items: [deYari, deDante, deValen], completo: true }],
    llamadas: [
      llamada("Yari Taft", "a@lead.com", "2026-09-22T15:00:00Z", MEET),
      llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", MEET),
      llamada("Valentín Abadía", "c@lead.com", "2026-09-24T15:00:00Z", MEET),
    ],
  }));
  assert.equal(d.veredicto.causa, "c");
  assert.equal(d.sinFiltrar, 1);
  assert.equal(d.reuniones, 3);
  assert.equal(d.soloPorEquipo, 2);
  const ventas = d.equipos.find((q) => q.nombre === "Sales")!;
  assert.deepEqual([ventas.deVentas, ventas.reuniones, ventas.soloAhi], [true, 3, 2]);
  assert.match(d.veredicto.explicacion, /Team Calls/);
});

test("(b) los closers tienen llamadas y la clave no ve ninguna reunión suya: visibilidad", () => {
  const deYari = reunion(YARI, "a@lead.com", "2026-09-22T15:00:00Z");
  const d = diagnosticar(entrada({
    generales: [deYari],
    porEquipo: [{ equipo: "Sales", items: [deYari], completo: true }],
    miembros: [{ email: "yari@apicanta.com", nombre: "Yari Taft" }],
    llamadas: [
      llamada("Yari Taft", "a@lead.com", "2026-09-22T15:00:00Z", MEET),
      llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", MEET),
      llamada("Dante Barbieri", "d@lead.com", "2026-09-25T15:00:00Z", MEET),
      llamada("Valentín Abadía", "c@lead.com", "2026-09-24T15:00:00Z", MEET),
      llamada("Valentín Abadía", "e@lead.com", "2026-09-26T15:00:00Z", MEET),
    ],
  }));
  assert.equal(d.veredicto.causa, "b");
  assert.equal(d.soloPorEquipo, 0);
  assert.match(d.veredicto.explicacion, /Dante Barbieri, Valentín Abadía/);
  /* Los closers no figuran en el equipo de Fathom: se dice. */
  assert.ok(d.veredicto.pistas.some((p) => /No figuran entre los integrantes/.test(p) && /Dante/.test(p)));
  const dante = d.closers.find((c) => c.nombre === "Dante Barbieri")!;
  assert.deepEqual([dante.llamadas, dante.conGrabacion, dante.grabadasPorEl, dante.enFathom], [2, 0, 0, false]);
  assert.ok(d.veredicto.pasos[0].startsWith("Manu"));
});

test("(b) la clave no ve ninguna reunión", () => {
  const d = diagnosticar(entrada({
    llamadas: [llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", ZOOM)],
  }));
  assert.equal(d.reuniones, 0);
  assert.equal(d.veredicto.causa, "b");
  assert.match(d.veredicto.titulo, /no ve ninguna/);
});

test("(a) las de Zoom no tienen grabación y las de Meet sí: Fathom no se une a Zoom", () => {
  const deValenMeet = [1, 2, 3].map((i) => reunion(VALEN, `m${i}@lead.com`, `2026-09-2${i}T15:00:00Z`));
  const d = diagnosticar(entrada({
    generales: deValenMeet,
    llamadas: [
      ...[1, 2, 3].map((i) => llamada("Valentín Abadía", `m${i}@lead.com`, `2026-09-2${i}T15:00:00Z`, MEET)),
      ...[1, 2, 3, 4].map((i) => llamada("Dante Barbieri", `z${i}@lead.com`, `2026-09-2${i}T18:00:00Z`, ZOOM)),
    ],
  }));
  assert.equal(d.veredicto.causa, "a");
  assert.deepEqual(d.plataformas.map((p) => [p.plataforma, p.llamadas, p.conGrabacion]), [["zoom", 4, 0], ["meet", 3, 3]]);
  assert.match(d.veredicto.explicacion, /4 llamadas de Zoom/);
  assert.match(d.veredicto.pasos[0], /Manu/);
});

test("(b) con llamadas sólo de Zoom y sin ninguna grabación, avisa que también puede ser (a)", () => {
  const deYari = reunion(YARI, "a@lead.com", "2026-09-22T15:00:00Z");
  const d = diagnosticar(entrada({
    generales: [deYari],
    llamadas: [1, 2, 3, 4].map((i) => llamada("Dante Barbieri", `z${i}@lead.com`, `2026-09-2${i}T18:00:00Z`, ZOOM)),
  }));
  assert.equal(d.veredicto.causa, "b");
  assert.match(d.veredicto.explicacion, /causa \(a\)/);
});

test("(d) Fathom devuelve las de Dante, pero el invitado entró con otro mail: no se atan", () => {
  const sueltas = [1, 2, 3].map((i) => reunion(DANTE, `otro${i}@gmail.com`, `2026-09-2${i}T15:00:00Z`));
  const d = diagnosticar(entrada({
    generales: sueltas,
    llamadas: [1, 2, 3].map((i) => llamada("Dante Barbieri", `calendly${i}@lead.com`, `2026-09-2${i}T15:00:00Z`, MEET)),
  }));
  assert.equal(d.veredicto.causa, "d");
  assert.equal(d.atado.sinAgenda, 3);
  assert.equal(d.atado.atadas, 0);
  assert.match(d.veredicto.pasos[0], /Buscar en Fathom/);
});

test("todo bien: las llamadas de los closers están atadas", () => {
  const rs = [
    reunion(DANTE, "b@lead.com", "2026-09-23T15:00:00Z"),
    reunion(VALEN, "c@lead.com", "2026-09-24T15:00:00Z"),
  ];
  const d = diagnosticar(entrada({
    generales: rs, yaGuardadas: ["1001"],
    llamadas: [
      llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", ZOOM),
      llamada("Valentín Abadía", "c@lead.com", "2026-09-24T15:00:00Z", MEET),
    ],
  }));
  assert.equal(d.veredicto.causa, "ok");
  assert.match(d.veredicto.explicacion, /2 de 2/);
});

test("sin llamadas de Calendly no hay con qué comparar", () => {
  const d = diagnosticar(entrada({ generales: [reunion(YARI, "a@lead.com", "2026-09-22T15:00:00Z")] }));
  assert.equal(d.veredicto.causa, "sin-datos");
});

test("las cuentas: tipos, atadas, nuevas, ya existían, sin agenda y personales", () => {
  n = 0; /* ids 1001, 1002, ... */
  const atadaNueva = reunion(DANTE, "a@lead.com", "2026-09-23T15:00:00Z");            // 1001
  const atadaYaGuardada = reunion(VALEN, "b@lead.com", "2026-09-24T15:00:00Z");       // 1002
  const sinAgenda = reunion(DANTE, "x@lead.com", "2026-09-25T15:00:00Z");             // 1003
  const personal = reunion(YARI, null, "2026-09-26T15:00:00Z");                       // 1004
  const sinDato = { recording_id: 99, scheduled_start_time: "2026-09-27T15:00:00Z", recorded_by: YARI, calendar_invitees: [] };
  const d = diagnosticar(entrada({
    generales: [atadaNueva, atadaYaGuardada, sinAgenda, personal, sinDato, atadaNueva],
    yaGuardadas: ["1002"],
    llamadas: [
      llamada("Dante Barbieri", "a@lead.com", "2026-09-23T15:00:00Z", ZOOM),
      llamada("Valentín Abadía", "b@lead.com", "2026-09-24T15:00:00Z", MEET),
      llamada("Valentín Abadía", "cancelada@lead.com", "2026-09-24T19:00:00Z", MEET, "cancelada"),
    ],
  }));
  /* La repetida cuenta una vez. */
  assert.equal(d.reuniones, 5);
  assert.deepEqual(d.atado, { atadas: 2, nuevas: 1, yaExistian: 1, sinAgenda: 1, personales: 2 });
  assert.deepEqual(d.tipos, { conAfuera: 3, soloInternas: 1, sinDato: 1 });
  /* La cancelada no es una llamada que debiera tener grabación. */
  assert.equal(d.closers.find((c) => c.nombre === "Valentín Abadía")!.llamadas, 1);
  const dante = d.grabadores.find((g) => g.email === "dante@apicanta.com")!;
  assert.deepEqual([dante.esCloser, dante.reuniones, dante.atadas, dante.sinAgenda], [true, 2, 1, 1]);
  assert.equal(d.grabadores.find((g) => g.email === "yari@apicanta.com")!.esCloser, false);
});

test("el diagnóstico no lleva títulos ni contenido de las reuniones, ni la clave", () => {
  const d = diagnosticar(entrada({
    generales: [reunion(DANTE, "b@lead.com", "2026-09-23T15:00:00Z", { default_summary: { markdown_formatted: "resumen privado" }, transcript: [{ text: "transcripción privada" }] })],
    llamadas: [llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", ZOOM)],
  }));
  const todo = JSON.stringify(d);
  assert.ok(!/secreta|privad|share|fathom\.video/i.test(todo));
});

test("la conexión sin alcance de equipo se avisa", () => {
  const d = diagnosticar(entrada({
    generales: [reunion(DANTE, "b@lead.com", "2026-09-23T15:00:00Z")],
    conexion: { conectado: true, paraElEquipo: false },
    llamadas: [llamada("Dante Barbieri", "b@lead.com", "2026-09-23T15:00:00Z", ZOOM)],
  }));
  assert.ok(d.veredicto.pistas.some((p) => /Desconectar y Conectar/.test(p)));
});

test("la ventana del diagnóstico: desde el día antes de la primera llamada, hasta 45 días", () => {
  assert.equal(desdeDelDiagnostico("2026-09-21T10:00:00Z", AHORA), "2026-09-20T10:00:00.000Z");
  assert.equal(desdeDelDiagnostico("2026-01-01T10:00:00Z", AHORA), new Date(AHORA - 45 * 86_400_000).toISOString());
  assert.equal(desdeDelDiagnostico(null, AHORA), new Date(AHORA - 45 * 86_400_000).toISOString());
});

test("los integrantes del equipo de Fathom", () => {
  assert.deepEqual(leerMiembrosDeFathom([{ name: "Dante", email: "DANTE@apicanta.com" }, { foo: 1 }]), [{ nombre: "Dante", email: "dante@apicanta.com", equipo: undefined }]);
});

/* ---------- las llamadas de equipo en «Traer lo anterior» ---------- */

test("qué equipos de Fathom son de ventas", () => {
  assert.deepEqual(leerEquipos([{ name: "Sales" }, { name: " Marketing " }, { name: "Sales" }, { x: 1 }]), ["Sales", "Marketing"]);
  for (const s of ["Sales", "sales team", "Ventas", "Equipo de Ventas", "Closers", "Equipo Comercial"]) assert.ok(esEquipoDeVentas(s), s);
  for (const s of ["Marketing", "Soporte", "Finanzas", "Wholesalers"]) assert.ok(!esEquipoDeVentas(s), s);
  assert.deepEqual(equiposDeVentas(["Marketing", "Sales", "Closers"]), ["Sales", "Closers"]);
  /* FATHOM_EQUIPOS manda, aunque Fathom no lo liste. */
  assert.deepEqual(equiposDeVentas(["Marketing", "Sales"], "Apicanta Closers, ventas , VENTAS"), ["Apicanta Closers", "ventas"]);
  assert.deepEqual(equiposDeVentas(["Marketing"], ""), []);
});

test("«Traer lo anterior» pasa por todo lo que la clave ve y después por cada equipo de ventas", async () => {
  const deVentas = async () => ["Sales", "Closers"];
  /* Primera página, con más páginas de Fathom: sigue en la misma pasada. */
  let p = PRIMERA_PASADA;
  assert.equal(equipoDeLaPasada(p), null);
  let sig = (await seguir(p, "cursor-2", deVentas))!;
  assert.deepEqual(sig, { i: -1, c: "cursor-2" });
  /* Se pasa por la pantalla como un texto opaco. */
  p = leerPasada(escribirPasada(sig));
  assert.deepEqual(p, { i: -1, c: "cursor-2" });
  /* Se acaba la general: arranca el primer equipo de ventas. */
  sig = (await seguir(p, null, deVentas))!;
  assert.deepEqual(sig, { e: ["Sales", "Closers"], i: 0, c: null });
  p = leerPasada(escribirPasada(sig));
  assert.equal(equipoDeLaPasada(p), "Sales");
  /* Con páginas en ese equipo, sigue ahí; sin más, pasa al siguiente. */
  p = leerPasada(escribirPasada((await seguir(p, "c-3", deVentas))!));
  assert.equal(equipoDeLaPasada(p), "Sales");
  assert.equal(p.c, "c-3");
  p = leerPasada(escribirPasada((await seguir(p, null, deVentas))!));
  assert.equal(equipoDeLaPasada(p), "Closers");
  assert.equal(p.c, null);
  /* Y al terminar el último, termina. */
  assert.equal(await seguir(p, null, deVentas), null);
});

test("sin equipos de ventas, «Traer lo anterior» termina con la pasada general", async () => {
  assert.equal(await seguir(PRIMERA_PASADA, null, async () => []), null);
});

test("un cursor roto empieza de cero en vez de romper", () => {
  for (const c of [null, undefined, "", "no-es-base64-json!", Buffer.from("{}").toString("base64url"), Buffer.from(JSON.stringify({ i: 5, e: ["x"] })).toString("base64url")]) {
    assert.deepEqual(leerPasada(c), PRIMERA_PASADA);
  }
});

test("en el cierre del día, una reunión del equipo es del closer por su mail o, si grabó con otra cuenta, por su nombre", () => {
  const de = (name: string, email: string) => ({ recording_id: 1, recorded_by: { name, email } });
  assert.ok(grabadaPor(de("Dante Barbieri", "dante@apicanta.com"), "Dante@Apicanta.com", "Dante Barbieri"));
  assert.ok(grabadaPor(de("Dante B.", "dante.personal@gmail.com"), "dante@apicanta.com", "Dante Barbieri") === false);
  assert.ok(grabadaPor(de("Dante Barbieri", "dante.personal@gmail.com"), "dante@apicanta.com", "Dante"));
  assert.ok(!grabadaPor(de("Valentín Abadía", "valentin@apicanta.com"), "dante@apicanta.com", "Dante Barbieri"));
  assert.ok(!grabadaPor({ recording_id: 2 }, "dante@apicanta.com", "Dante Barbieri"));
});
