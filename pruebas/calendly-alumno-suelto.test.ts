import test from "node:test";
import assert from "node:assert/strict";
import { ingresarInvitado } from "@/lib/calendly-sync";
import { idSesionCalendly, type EventoCalendly, type InvitadoCalendly } from "@/lib/calendly";
import { idResell } from "@/lib/resells";
import { ETAPAS } from "@/lib/seed";
import { BaseFalsa } from "../pruebas-estres/closer/base-falsa";

/* Lili (26/10): Daniel Arroyo agendó su resell con Mariano como «Daniel» y no lo encontraba «ni en la ficha ni en la lista». Era
   un alumno del Airtable sin persona en la app: Calendly creaba una nueva con el nombre que escribió. Ahora la persona nueva
   lleva su nombre de alumno, la llamada y el resell también, y el alumno queda atado a ella. */

const URI = (tipo: "scheduled_events" | "invitees", n: string) => tipo === "invitees" ? `https://api.calendly.com/scheduled_events/ev_${n}/invitees/inv_${n}` : `https://api.calendly.com/scheduled_events/ev_${n}`;
const evento = (n: string): EventoCalendly => ({
  uri: URI("scheduled_events", n), name: "Llamada de Asesoramiento - Próximos pasos", status: "active", start_time: "2026-10-30T14:00:00.000Z", end_time: "2026-10-30T15:00:00.000Z",
  created_at: "2026-10-26T20:27:43.000Z", updated_at: "2026-10-26T20:27:43.000Z", location: null, event_memberships: [{ user_name: "Mariano Arias" }],
});
const invitado = (n: string, nombre: string, email: string): InvitadoCalendly => ({
  uri: URI("invitees", n), email, name: nombre, status: "active", event: URI("scheduled_events", n),
  created_at: "2026-10-26T20:27:43.000Z", updated_at: "2026-10-26T20:27:43.000Z",
});

function entorno() {
  const db = new BaseFalsa();
  db.tablas.alumnos = [
    { id: "alu_daniel", nombre: "Daniel Arroyo Mendoza", email: "darroyomen@gmail.com", pais: "Perú", leadId: null },
    { id: "alu_atado", nombre: "Ana Atada Pérez", email: "ana@x.com", pais: "", leadId: "lea_ana" },
  ];
  const ctx = { db: db as never, webinars: [], etapas: ETAPAS.map(({ id, nombre, orden, esGanada, esPerdida }) => ({ id, nombre, orden, esGanada, esPerdida })), etapaSesion: "et_sesion" };
  const ingresar = (inv: InvitadoCalendly) => ingresarInvitado(inv.uri, { invitado: inv, evento: evento(inv.uri.split("inv_")[1]), desdeLaApi: true }, ctx);
  return { db, ingresar };
}

test("un alumno sin persona en la app que agenda con otro nombre: entra con su nombre de alumno y queda atado", async () => {
  const { db, ingresar } = entorno();
  const r = await ingresar(invitado("d1", "Daniel", "DArroyoMen@gmail.com"));
  const sesion = db.fila("sesiones", idSesionCalendly(URI("invitees", "d1")))!;
  assert.equal(db.fila("contactos", r.contactoId)!.nombre, "Daniel Arroyo Mendoza");
  assert.equal(db.fila("contactos", r.contactoId)!.pais, "Perú");
  assert.equal(sesion.invitado, "Daniel Arroyo Mendoza");
  assert.equal(db.fila("resells", idResell(String(sesion.id)))!.nombre, "Daniel Arroyo Mendoza", "en la agenda de resells se lo encuentra por su nombre");
  assert.equal(db.fila("alumnos", "alu_daniel")!.leadId, r.leadId, "su ficha de alumno muestra la llamada");
});

test("un alumno que ya tiene persona no se toca: manda la persona que ya estaba", async () => {
  const { db, ingresar } = entorno();
  db.tablas.contactos = [{ id: "con_ana", nombre: "Ana P.", email: "ana@x.com" }];
  const r = await ingresar(invitado("a1", "Anita", "ana@x.com"));
  assert.equal(r.contactoId, "con_ana");
  assert.equal(db.fila("contactos", "con_ana")!.nombre, "Ana P.");
  assert.equal(db.fila("alumnos", "alu_atado")!.leadId, "lea_ana");
});

test("quien no es alumno entra como siempre, con el nombre que escribió", async () => {
  const { db, ingresar } = entorno();
  const r = await ingresar(invitado("n1", "Nuevo Lead", "nuevo@x.com"));
  assert.equal(db.fila("contactos", r.contactoId)!.nombre, "Nuevo Lead");
});
