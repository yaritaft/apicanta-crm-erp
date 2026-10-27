import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { construirSemilla, ETAPAS } from "@/lib/seed";
import { filasTabla, escrituraDe, perfilDe, valorEditable } from "@/lib/crm-tabla";
import { conCorrecciones, diaDeNacimiento, nacimientoDePersona, nacimientoDeRespuestas, preguntasNuevas, respuestaPerfil, textoDeDia } from "@/lib/perfil";
import { nacimientoDeLaPersona } from "@/lib/persona";
import { avisosDePreguntasNuevas, MAXIMO_POR_AGENDA } from "@/lib/calendly-alertas";
import { ingresarInvitado } from "@/lib/calendly-sync";
import { idSesionCalendly, type EventoCalendly, type InvitadoCalendly } from "@/lib/calendly";
import { BaseFalsa } from "../pruebas-estres/closer/base-falsa";

/* 27/10: el formulario de Calendly de las agendas del webinar sumó «¿Cuál es tu fecha de nacimiento?». La app sólo reconocía las
   preguntas por lo que dicen, y ésta no la conocía: la respuesta quedaba en la llamada pero no llegaba a la ficha (Lili: «los closers
   preguntaron si se puede completar sola»). Acá: se reconoce, de ahí sale la edad, pasa al contrato, y una pregunta nueva avisa. */

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);
const NAC = { pregunta: "¿Cuál es tu fecha de nacimiento?", respuesta: "26/03/1998" };

/* Las preguntas que el formulario hizo de verdad hasta el 27/10 (sacadas de las respuestas guardadas en producción). */
const PREGUNTAS_REALES = [
  "Numero de telefono (Whatsapp)", "Numero de Telefono (Whatsapp)", "¿Cuál es tu número de WhatsApp? (Incluir el código del país)",
  "Cuál es tu nivel de ingles?", "Con que lenguajes y frameworks trabajas o trabajaste ?", "Hace cuantos años trabajas en programación?",
  "Hace cuantos años trabajas en programación ?", "Cuál es tu nivel de formación?", "Capacidad de inversión", "Cuánto ganas mensualmente en dólares?",
  "En el caso que veas claridad en la llamada sobre cómo conseguir un trabajo que te pague de 3000 USD a 6000 USD como AI Engineer qué situación te define mejor?",
  "En el caso que veas claridad en la llamada sobre cómo conseguir un trabajo que te pague de 3000 USD a 6000 USD de forma garantizada qué situación te define menor?",
  "Esta auditoría es sin costo. Si decides avanzar con el acompañamiento personalizado de Yari para duplicar o triplicar tu salario, la inversión mínima, dependiendo del plan de pago que elijas, parte desde los $690.",
  "Edad", "Usuario de Instagram:", "¿Cuál es tu fecha de nacimiento?",
];

test("cada pregunta que el formulario hizo de verdad tiene destino: ninguna es «nueva»", () => {
  const qa = PREGUNTAS_REALES.map((pregunta) => ({ pregunta, respuesta: "x" }));
  assert.deepEqual(preguntasNuevas(qa), []);
});

test("una pregunta que nadie conoce se detecta, una sola vez y sin importar mayúsculas ni tildes de las conocidas", () => {
  const qa = [
    { pregunta: "¿Cuál es tu color favorito?", respuesta: "azul" }, { pregunta: "¿Cuál es tu color favorito?", respuesta: "azul" },
    { pregunta: "NIVEL DE INGLES", respuesta: "B2" }, { pregunta: "  ", respuesta: "nada" },
  ];
  assert.deepEqual(preguntasNuevas(qa), ["¿Cuál es tu color favorito?"]);
  assert.deepEqual(preguntasNuevas(undefined), []);
});

test("«¿Cuál es tu fecha de nacimiento?» es la pregunta de la fecha de nacimiento, y «Edad» sigue siendo la edad", () => {
  const qa = [NAC, { pregunta: "Edad", respuesta: "28" }];
  assert.equal(respuestaPerfil(qa, "nacimiento"), "26/03/1998");
  assert.equal(respuestaPerfil(qa, "edad"), "28");
  assert.equal(nacimientoDeRespuestas(qa), "1998-03-26");
  assert.equal(respuestaPerfil([{ pregunta: "Edad", respuesta: "28" }], "nacimiento"), undefined);
});

test("la fecha se entiende como la escribe la gente (día/mes) y lo que no es una fecha real no pasa", () => {
  const caso = (t: string) => diaDeNacimiento(t, 2026);
  assert.equal(caso("26/03/1998"), "1998-03-26");
  assert.equal(caso("6/3/1998"), "1998-03-06");
  assert.equal(caso("26-03-1998"), "1998-03-26");
  assert.equal(caso("26.03.1998"), "1998-03-26");
  assert.equal(caso("1998-03-26"), "1998-03-26");
  assert.equal(caso("26/03/98"), "1998-03-26");
  assert.equal(caso("26 de marzo de 1998"), "1998-03-26");
  assert.equal(caso("26 Marzo 1998"), "1998-03-26");
  assert.equal(caso("5 de septiembre de 1990"), "1990-09-05");
  assert.equal(caso("03/26/1998"), "1998-03-26", "mes y día al revés: el «mes» 26 no existe");
  for (const mal of ["", "  ", "marzo", "31/02/1998", "32/01/1998", "00/01/1998", "26/13/1998", "26/03/1850", "hola", "28"]) assert.equal(caso(mal), null, `«${mal}»`);
  assert.equal(textoDeDia("1998-03-26"), "26/03/1998");
});

test("la corrección del equipo pisa lo que contestó, y vaciarla vuelve a lo que contestó", () => {
  assert.equal(nacimientoDeRespuestas(conCorrecciones([NAC], { nacimiento: "1997-12-01" })), "1997-12-01");
  assert.equal(nacimientoDeRespuestas(conCorrecciones([], { nacimiento: "1997-12-01" })), "1997-12-01", "si el formulario no la preguntó, se suma");
  assert.equal(nacimientoDeRespuestas(conCorrecciones([NAC], {})), "1998-03-26");
});

/* Una llamada de la semilla con las respuestas que queramos. */
function conRespuestas(respuestas: { pregunta: string; respuesta: string }[]) {
  const e = construirSemilla();
  const f0 = filasTabla(e).find((x) => x.sesion.estado !== "cancelada" && (x.sesion.contactoId || x.sesion.leadId))!;
  const sesiones = e.sesiones.map((s) => (s.id === f0.sesion.id ? { ...s, respuestas } : s));
  const e2 = { ...e, sesiones };
  return { e: e2, id: f0.id, sesionId: f0.sesion.id, fila: () => filasTabla(e2, Date.parse("2026-10-27T15:00:00-03:00")).find((x) => x.id === f0.id)! };
}

test("el CRM: con la fecha de nacimiento y sin «Edad», la edad sale sola de la fecha", () => {
  const { fila } = conRespuestas([NAC]);
  assert.equal(fila().nacimiento, "1998-03-26");
  assert.equal(fila().edad, "28", "26/03/1998 → 28 años el 27/10/2026");
});

test("el CRM: lo que contestó de edad manda; sin ninguna de las dos, las columnas quedan vacías", () => {
  assert.equal(conRespuestas([NAC, { pregunta: "Edad", respuesta: "30" }]).fila().edad, "30");
  const sin = conRespuestas([{ pregunta: "Cuál es tu nivel de ingles?", respuesta: "B2" }]).fila();
  assert.equal(sin.nacimiento, "");
  assert.equal(sin.edad, "");
  assert.equal(conRespuestas([{ pregunta: NAC.pregunta, respuesta: "no sé" }]).fila().edad, "", "una fecha ilegible no inventa una edad");
});

test("la ficha: «Fecha de nacimiento» aparece en «Quién es», editable, y se corrige como los demás datos", () => {
  const { e, id, fila } = conRespuestas([NAC, { pregunta: "Edad", respuesta: "28" }]);
  const f = fila();
  const dato = perfilDe([f]).find((d) => d.clave === "nacimiento")!;
  assert.equal(dato.titulo, "Fecha de nacimiento");
  assert.equal(dato.valor, "1998-03-26");
  assert.equal(valorEditable(f, "nacimiento"), "1998-03-26");
  const w = escrituraDe(f, "nacimiento", "1997-12-01", { ajustes: e.ajustes, quien: "Lili", cuando: "2026-10-27T15:00:00.000Z" });
  assert.ok(w && w.tipo === "perfil" && w.campo === "nacimiento" && w.valor === "1997-12-01");
  assert.ok(id);
});

test("el contrato y el asistente de ventas: la fecha que contestó al agendar se carga sola (la de la llamada más nueva que la tenga)", () => {
  const { e, sesionId } = conRespuestas([NAC]);
  const s = e.sesiones.find((x) => x.id === sesionId)!;
  assert.equal(nacimientoDeLaPersona(e, s.contactoId ?? s.leadId), "1998-03-26");
  assert.equal(nacimientoDeLaPersona(e, undefined), null);
  const nueva = { inicia: "2026-10-20T15:00:00Z", respuestas: [{ pregunta: NAC.pregunta, respuesta: "01/01/1990" }] };
  const vieja = { inicia: "2026-09-01T15:00:00Z", respuestas: [NAC] };
  assert.equal(nacimientoDePersona([vieja, nueva], null), "1990-01-01");
  assert.equal(nacimientoDePersona([vieja, { inicia: "2026-10-25T15:00:00Z", respuestas: [] }], null), "1998-03-26", "la más nueva sin la fecha no tapa a la anterior");
  assert.equal(nacimientoDePersona([vieja, nueva], { nacimiento: "1985-05-05" }), "1985-05-05", "lo que corrigió el equipo gana");
});

/* ---------- El aviso ---------- */

test("el aviso va a cada dueño, una vez por pregunta, y se acota", () => {
  const filas = avisosDePreguntasNuevas(["¿Color favorito?"], ["Yari@x.com", "juan@x.com", "yari@x.com", "sin-mail"], { id: "con_1", nombre: "Ana" }, hash);
  assert.equal(filas.length, 2, "los dueños sin repetir ni sin mail no suman");
  assert.deepEqual(filas.map((f) => f.para).sort(), ["juan@x.com", "yari@x.com"]);
  assert.match(filas[0].titulo, /¿Color favorito\?/);
  assert.equal(filas[0].contactoId, "con_1");
  assert.equal(filas[0].tipo, "calendly");
  const otra = avisosDePreguntasNuevas(["  ¿COLOR   favorito? "], ["yari@x.com"], { id: "con_2", nombre: "Beto" }, hash);
  assert.equal(otra[0].id, filas.find((f) => f.para === "yari@x.com")!.id, "la misma pregunta de otra persona no repite el aviso");
  assert.equal(avisosDePreguntasNuevas(Array.from({ length: 20 }, (_, i) => `P${i}`), ["a@x.com"], null, hash).length, MAXIMO_POR_AGENDA);
  assert.deepEqual(avisosDePreguntasNuevas([], ["a@x.com"], null, hash), []);
});

const URI = (n: string, tipo: "ev" | "inv") => (tipo === "inv" ? `https://api.calendly.com/scheduled_events/ev_${n}/invitees/inv_${n}` : `https://api.calendly.com/scheduled_events/ev_${n}`);
const evento = (n: string): EventoCalendly => ({
  uri: URI(n, "ev"), name: "Llamada de Asesoramiento - Webinar", status: "active", start_time: "2026-10-30T16:00:00.000Z", end_time: "2026-10-30T17:00:00.000Z",
  created_at: "2026-10-27T12:00:00.000Z", updated_at: "2026-10-27T12:00:00.000Z", location: null, event_memberships: [{ user_name: "Mariano Arias" }],
});
const invitado = (n: string, preguntas: { question: string; answer: string }[]): InvitadoCalendly => ({
  uri: URI(n, "inv"), email: `lead${n}@x.com`, name: `Lead ${n}`, status: "active", event: URI(n, "ev"),
  created_at: "2026-10-27T12:00:00.000Z", updated_at: "2026-10-27T12:00:00.000Z", questions_and_answers: preguntas,
});

function entorno() {
  const db = new BaseFalsa();
  db.tablas.usuarios_permitidos = [{ id: "u1", email: "Yari@x.com", rol: "dueno" }, { id: "u2", email: "closer@x.com", rol: "closer" }, { id: "u3", email: "juan@x.com", rol: "dueno" }];
  const ctx = { db: db as never, webinars: [], etapas: ETAPAS.map(({ id, nombre, orden, esGanada, esPerdida }) => ({ id, nombre, orden, esGanada, esPerdida })), etapaSesion: "et_sesion" };
  return { db, ingresar: (inv: InvitadoCalendly) => ingresarInvitado(inv.uri, { invitado: inv, evento: evento(inv.uri.split("inv_")[1]), desdeLaApi: true }, ctx) };
}

test("al guardar una agenda con una pregunta nueva, los dueños (y sólo ellos) reciben el aviso; con las conocidas, ninguno", async () => {
  const { db, ingresar } = entorno();
  await ingresar(invitado("a1", [{ question: "¿Cuál es tu fecha de nacimiento?", answer: "26/03/1998" }, { question: "Edad", answer: "28" }]));
  assert.equal((db.tablas.avisos ?? []).length, 0, "la fecha de nacimiento ya se conoce");
  const sesion = db.fila("sesiones", idSesionCalendly(URI("a1", "inv")))!;
  assert.deepEqual((sesion.respuestas as { pregunta: string }[]).map((q) => q.pregunta), ["¿Cuál es tu fecha de nacimiento?", "Edad"], "las respuestas se guardan igual");

  await ingresar(invitado("a2", [{ question: "¿Cuál es tu color favorito?", answer: "azul" }]));
  const avisos = (db.tablas.avisos ?? []) as { para: string; tipo: string; titulo: string; persona: string }[];
  assert.deepEqual(avisos.map((a) => a.para).sort(), ["juan@x.com", "yari@x.com"]);
  assert.ok(avisos.every((a) => a.tipo === "calendly" && /color favorito/.test(a.titulo) && a.persona === "Lead a2"));

  await ingresar(invitado("a3", [{ question: "¿Cuál es tu color favorito?", answer: "rojo" }]));
  assert.equal((db.tablas.avisos ?? []).length, 2, "la misma pregunta de otra persona no vuelve a avisar");
});

test("si no se puede avisar (la base de avisos falla), la agenda se guarda igual", async () => {
  const { db, ingresar } = entorno();
  const original = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => { if (t === "usuarios_permitidos") throw new Error("sin permiso"); return original(t); };
  const r = await ingresar(invitado("b1", [{ question: "¿Cuál es tu color favorito?", answer: "azul" }]));
  assert.ok(db.fila("sesiones", r.sesionId), "la llamada quedó guardada");
});
