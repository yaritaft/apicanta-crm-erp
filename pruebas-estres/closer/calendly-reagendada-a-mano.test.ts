import test from "node:test";
import assert from "node:assert/strict";
import { ingresarInvitado } from "@/lib/calendly-sync";
import { idSesionCalendly, type EventoCalendly, type InvitadoCalendly } from "@/lib/calendly";
import { ETAPAS } from "@/lib/seed";
import type { Sesion } from "@/lib/types";
import { BaseFalsa } from "./base-falsa";

/* Dante (19/10) reagendó una llamada por fuera de Calendly y la pasó a mano en el CRM. Calendly sigue diciendo el horario de antes
   cada vez que se vuelve a traer la agenda (reintento del webhook, cron): no la tiene que pisar. */

const URI = (tipo: "scheduled_events" | "invitees", n: string) => tipo === "invitees" ? `https://api.calendly.com/scheduled_events/ev_${n}/invitees/inv_${n}` : `https://api.calendly.com/scheduled_events/ev_${n}`;
const evento = (n: string): EventoCalendly => ({
  uri: URI("scheduled_events", n), name: "Llamada de Asesoramiento - Setter", status: "active", start_time: "2026-10-17T19:00:00.000Z", end_time: "2026-10-17T19:45:00.000Z",
  created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z", location: null, event_memberships: [{ user_name: "Dante Barbieri" }],
});
const invitado = (n: string): InvitadoCalendly => ({
  uri: URI("invitees", n), email: `persona${n}@x.com`, name: `Persona ${n}`, status: "active", event: URI("scheduled_events", n),
  created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-02T10:00:00.000Z",
});

function entorno() {
  const db = new BaseFalsa();
  const ctx = { db: db as never, webinars: [], etapas: ETAPAS.map(({ id, nombre, orden, esGanada, esPerdida }) => ({ id, nombre, orden, esGanada, esPerdida })), etapaSesion: "et_sesion" };
  const ingresar = (inv: InvitadoCalendly, ev: EventoCalendly) => ingresarInvitado(inv.uri, { invitado: inv, evento: ev, desdeLaApi: true }, ctx);
  const sesion = (n: string) => db.fila("sesiones", idSesionCalendly(URI("invitees", n))) as unknown as Sesion | undefined;
  return { db, ingresar, sesion };
}

test("una llamada pasada a mano a otro día conserva el que eligió el closer cuando Calendly la vuelve a mandar", async () => {
  const { db, ingresar, sesion } = entorno();
  await ingresar(invitado("t1"), evento("t1"));
  assert.equal(sesion("t1")!.inicia, "2026-10-17T19:00:00.000Z");
  /* Lo que escribe la tabla del CRM al pasar la llamada al lunes. */
  Object.assign(db.fila("sesiones", sesion("t1")!.id)!, {
    inicia: "2026-10-19T19:00:00.000Z",
    extra: { inicioManual: { antes: "2026-10-17T19:00:00.000Z", por: "Dante Barbieri", en: "2026-10-18T15:00:00.000Z" } },
  });
  await ingresar(invitado("t1"), evento("t1"));
  assert.equal(sesion("t1")!.inicia, "2026-10-19T19:00:00.000Z", "no vuelve al sábado");
  assert.deepEqual((sesion("t1")!.extra as { inicioManual?: { antes: string } }).inicioManual?.antes, "2026-10-17T19:00:00.000Z", "la marca sigue ahí");
});

test("una llamada que nadie tocó sigue el horario de Calendly (si el evento cambia, cambia)", async () => {
  const { db, ingresar, sesion } = entorno();
  await ingresar(invitado("t2"), evento("t2"));
  const movido = { ...evento("t2"), start_time: "2026-10-18T14:00:00.000Z", end_time: "2026-10-18T14:45:00.000Z" };
  await ingresar(invitado("t2"), movido);
  assert.equal(sesion("t2")!.inicia, "2026-10-18T14:00:00.000Z");
  assert.ok(db);
});
