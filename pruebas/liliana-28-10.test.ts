import test from "node:test";
import assert from "node:assert/strict";
import { motivoSinPagoDelPrograma, soloSeCobroLaReserva } from "@/lib/accesos-minimo";
import { entraComoCasoDeExito } from "@/lib/resells";
import { ingresarInvitado } from "@/lib/calendly-sync";
import type { EventoCalendly, InvitadoCalendly } from "@/lib/calendly";
import { egresoDelPrograma, egresoEscritoAMano, escrituraCliente, filasClientes, listasCs, otrosMailsDe, valorEditableCliente } from "@/lib/clientes-cs";
import { guiaDeBienvenida, textoDeBienvenida } from "@/lib/bienvenida-alumno";
import { construirSemilla, ETAPAS } from "@/lib/seed";
import { BaseFalsa } from "../pruebas-estres/closer/base-falsa";

/* Lo de Liliana del 27/10 y 28/10: la reserva que recibió todos los accesos (Luis Mejía), el testimonio que no se veía agendado, la
   llamada de renovación anotada como caso de éxito, el fin del programa corrido dos veces, más de un mail por alumno y las salas de
   Zoom en la bienvenida. Los contratos y los accesos, en pruebas/contratos-a-mano.test.ts. */

/* ---------- El mínimo para dar los accesos ---------- */

const PLAN = [
  { id: "r", monto: 100, esReserva: true }, { id: "c1", monto: 1400, esReserva: false }, { id: "c2", monto: 1500, esReserva: false },
];

test("sólo entró la reserva y el plan sigue con cuotas: los accesos esperan, y el motivo dice cuánto pagó", () => {
  assert.match(motivoSinPagoDelPrograma(PLAN, [{ cuotaId: "r", monto: 100 }]) ?? "", /Sólo pagó la reserva \(US\$ 100 de US\$ 3\.000\)/);
  assert.match(motivoSinPagoDelPrograma(PLAN, [{ cuotaId: "r", monto: 50 }, { cuotaId: "r", monto: 50 }]) ?? "", /US\$ 100 de/);
});

test("con un pago de cualquier cuota del programa, o sin evidencia, o sin reserva: se dan", () => {
  assert.equal(motivoSinPagoDelPrograma(PLAN, [{ cuotaId: "r", monto: 100 }, { cuotaId: "c1", monto: 1400 }]), null);
  assert.equal(motivoSinPagoDelPrograma(PLAN, [{ cuotaId: "c2", monto: 1 }]), null, "pagó una del programa sin la reserva");
  assert.equal(motivoSinPagoDelPrograma(PLAN, []), null, "sin pagos cargados el contrato se manda antes de cargar los cobros");
  assert.equal(motivoSinPagoDelPrograma([], []), null);
  assert.equal(motivoSinPagoDelPrograma(null, null), null);
  assert.equal(motivoSinPagoDelPrograma([{ id: "a", monto: 3000, esReserva: false }], [{ cuotaId: "a", monto: 3000 }]), null);
  assert.equal(motivoSinPagoDelPrograma([{ id: "r", monto: 100, esReserva: true }], [{ cuotaId: "r", monto: 100 }]), null, "una venta que es sólo la reserva no tiene cuotas por cobrar");
});

test("en la carga de la venta: sólo se cobró la reserva ⇒ le toca el contrato de la reserva", () => {
  const l = (esReserva: boolean, monto: number, cobros = 0) => ({ esReserva, monto, cobros: Array.from({ length: cobros }, () => ({})) });
  assert.equal(soloSeCobroLaReserva([l(true, 100, 1), l(false, 1400), l(false, 750)]), true, "el caso de Dante con Luis Mejía");
  assert.equal(soloSeCobroLaReserva([l(true, 100, 1), l(false, 1400, 1), l(false, 750)]), false);
  assert.equal(soloSeCobroLaReserva([l(true, 100), l(false, 1400), l(false, 750)]), false, "sin cobros cargados no se sabe");
  assert.equal(soloSeCobroLaReserva([l(false, 3000, 1)]), false, "un pago único no tiene reserva");
  assert.equal(soloSeCobroLaReserva([l(true, 100, 1)]), false, "ya es de sólo la reserva (otro camino)");
});

/* ---------- Testimonio y renovación ---------- */

test("el evento «Testimonio» siempre es caso de éxito; «Próximos pasos», sólo si el alumno tiene un testimonio por grabar", () => {
  const testimonio = { tipo: "Testimonio", titulo: "Testimonio" };
  const proximos = { tipo: "Llamada de Asesoramiento - Próximos pasos", titulo: "Llamada de Asesoramiento - Próximos pasos" };
  assert.equal(entraComoCasoDeExito(testimonio, false), true);
  assert.equal(entraComoCasoDeExito(proximos, false), false, "Juan Diego Mosquera: una renovación a secas");
  assert.equal(entraComoCasoDeExito(proximos, true), true);
  assert.equal(entraComoCasoDeExito({ tipo: "Llamada de Auditoría", titulo: "" }, true), false);
});

const URI = (tipo: "ev" | "inv", n: string) => (tipo === "inv" ? `https://api.calendly.com/scheduled_events/ev_${n}/invitees/inv_${n}` : `https://api.calendly.com/scheduled_events/ev_${n}`);
const evento = (n: string, nombre: string): EventoCalendly => ({
  uri: URI("ev", n), name: nombre, status: "active", start_time: "2026-11-02T18:00:00.000Z", end_time: "2026-11-02T19:00:00.000Z",
  created_at: "2026-10-27T19:54:10.000Z", updated_at: "2026-10-27T19:54:10.000Z", location: null, event_memberships: [{ user_name: "Mariano Arias" }],
});
const invitado = (n: string, nombre: string, email: string): InvitadoCalendly => ({
  uri: URI("inv", n), email, name: nombre, status: "active", event: URI("ev", n),
  created_at: "2026-10-27T19:54:10.000Z", updated_at: "2026-10-27T19:54:10.000Z",
});
function entorno() {
  const db = new BaseFalsa();
  db.tablas.alumnos = [
    { id: "alu_nahuel", nombre: "Nahuel Alonso", email: "nalonso.arg@gmail.com", leadId: null },
    { id: "alu_pablo", nombre: "Pablo Ascencao", email: "pablo.ascencao@gmail.com", leadId: null },
  ];
  db.tablas.testimonios = [{ id: "tes_1", alumnoId: "alu_pablo", followUp: "Pendiente de agendar", estadoVideo: "" }];
  const ctx = { db: db as never, webinars: [], etapas: ETAPAS.map(({ id, nombre, orden, esGanada, esPerdida }) => ({ id, nombre, orden, esGanada, esPerdida })), etapaSesion: "et_sesion" };
  return { db, ingresar: (n: string, evento_: string, nombre: string, email: string) => ingresarInvitado(URI("inv", n), { invitado: invitado(n, nombre, email), evento: evento(n, evento_), desdeLaApi: true }, ctx) };
}

test("al agendar: la renovación a secas (Nahuel, Juan Diego) entra como «No»; el testimonio por grabar y el evento Testimonio, como caso de éxito", async () => {
  const { db, ingresar } = entorno();
  await ingresar("n1", "Llamada de Asesoramiento - Próximos pasos", "Nahuel Alonso", "nalonso.arg@gmail.com");
  assert.notEqual(db.tablas.resells.find((r) => r.nombre === "Nahuel Alonso")?.casoDeExito, true, "no se marca solo");

  await ingresar("p1", "Llamada de Asesoramiento - Próximos pasos", "Pablo Ascencao", "pablo.ascencao@gmail.com");
  assert.equal(db.tablas.resells.find((r) => r.nombre === "Pablo Ascencao")?.casoDeExito, true, "tiene un testimonio por grabar");

  await ingresar("t1", "Testimonio", "Otro Caso", "otro@x.com");
  assert.equal(db.tablas.resells.find((r) => r.nombre === "Otro Caso")?.casoDeExito, true, "el evento Testimonio de Yari");
  assert.equal(db.tablas.resells.length, 3, "las tres entran a la agenda de resells");
});

/* ---------- El fin del programa ---------- */

test("una fecha de egreso escrita a mano es la definitiva: la demora y las pausas no la corren otra vez (Javier Hernández)", () => {
  const pausas = [
    { id: "d", tipo: "demora" as const, desde: "2026-08-05", hasta: "2026-10-05", motivo: "", creadoEn: "", creadoPor: "" },
    { id: "p", tipo: "pausa" as const, desde: "2026-10-06", hasta: "2026-11-20", motivo: "", creadoEn: "", creadoPor: "" },
  ];
  assert.equal(egresoEscritoAMano("2026-08-05", "2027-02-20", 3), true);
  assert.equal(egresoDelPrograma("2026-08-05", "2027-02-20", 3, pausas), "2027-02-20", "antes daba el 6 de junio de 2027");
  assert.equal(egresoDelPrograma("2026-08-05", null, 3, pausas), "2027-02-19", "calculado: 5/10 + 3 meses + 45 días de pausa");
});

test("el egreso que es el automático (inicio + duración) sigue corriéndose con la pausa", () => {
  const pausas = [{ id: "p", tipo: "pausa" as const, desde: "2026-08-24", hasta: "2026-09-07", motivo: "", creadoEn: "", creadoPor: "" }];
  assert.equal(egresoEscritoAMano("2026-08-05", "2026-11-05", 3), false);
  assert.equal(egresoDelPrograma("2026-08-05", "2026-11-05", 3, pausas), "2026-11-19");
  assert.equal(egresoDelPrograma("2026-08-05", "2026-11-05", 3, []), "2026-11-05");
  assert.equal(egresoDelPrograma("2026-08-05", "2026-12-01", null, pausas), "2026-12-15", "sin duración no hay con qué compararlo: como siempre");
});

/* ---------- Otros mails ---------- */

test("otros mails: sin repetir, en minúscula, sin el principal y sin lo que no es un mail", () => {
  assert.deepEqual(otrosMailsDe("A@x.com, b@y.com; a@x.com  c@z.org\nnoesmail"), ["a@x.com", "b@y.com", "c@z.org"]);
  assert.deepEqual(otrosMailsDe(["Uno@x.com", "uno@x.com", 5, "principal@x.com"], "Principal@x.com"), ["uno@x.com"]);
  assert.deepEqual(otrosMailsDe(null), []);
});

test("otros mails: se corrigen en la ficha del alumno, con validación, y se pueden vaciar", () => {
  const hoy = "2026-10-28";
  const f = filasClientes(construirSemilla(), hoy)[0];
  assert.ok(f, "la semilla trae alumnos");
  const listas = listasCs(null);
  const w = escrituraCliente(f, "otrosMails", "Viejo@Wisboo.com, otro@zoom.us", listas);
  assert.ok(w.tipo === "seguimiento" && JSON.stringify(w.cambios) === JSON.stringify({ otrosMails: ["viejo@wisboo.com", "otro@zoom.us"] }));
  const mal = escrituraCliente(f, "otrosMails", "ok@x.com, esto no", listas);
  assert.ok(mal.tipo === "no" && /no parece un mail/.test(mal.motivo));
  const vacio = escrituraCliente(f, "otrosMails", "", listas);
  assert.ok(vacio.tipo === "seguimiento" && (vacio.cambios as { otrosMails: string[] }).otrosMails.length === 0);
  const con = { ...f, otrosMails: ["a@x.com", "b@x.com"] };
  assert.equal(valorEditableCliente(con, "otrosMails"), "a@x.com, b@x.com");
});

/* ---------- Las salas de Zoom en la bienvenida ---------- */

const CONFIG = {
  salasZoom: {
    martes: { link: "https://zoom.us/s/111", id: "111", clave: "aaa111" },
    miercoles: { link: "https://zoom.us/s/222", id: "222", clave: "bbb222" },
    jueves: { link: "https://zoom.us/s/333", id: "333", clave: "ccc333" },
  },
};

test("el mail de Hackear AI trae el link, el ID y la clave de cada sala; el resto de los programas, no", () => {
  const completo = guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack", config: CONFIG })!;
  const { texto } = textoDeBienvenida(completo);
  for (const x of ["https://zoom.us/s/111", "ID: 111 · Clave: aaa111", "https://zoom.us/s/222", "Clave: bbb222", "https://zoom.us/s/333", "Clave: ccc333", "bajá la app de Zoom"]) assert.ok(texto.includes(x), x);
  assert.ok(texto.indexOf("Martes: práctica") < texto.indexOf("https://zoom.us/s/111") && texto.indexOf("https://zoom.us/s/111") < texto.indexOf("Miércoles"), "cada sala bajo su día");
  for (const programa of ["downsell"]) assert.doesNotMatch(textoDeBienvenida(guiaDeBienvenida({ programa, config: CONFIG })!).texto, /zoom\.us/);
  assert.doesNotMatch(textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", reserva: true, config: CONFIG })!).texto, /zoom\.us/, "la reserva todavía no tiene accesos");
});

test("sin salas en la config (o con un link que no es https) el mail queda como estaba", () => {
  const sin = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack", config: {} })!).texto;
  assert.doesNotMatch(sin, /zoom\.us|bajá la app de Zoom/);
  const mal = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", config: { salasZoom: { martes: { link: "http://x.com", clave: "k" } } } })!).texto;
  assert.doesNotMatch(mal, /http:\/\/x\.com|Clave: k/);
});
