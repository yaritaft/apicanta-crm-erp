import test from "node:test";
import assert from "node:assert/strict";
import { ingresarInvitado } from "@/lib/calendly-sync";
import { closerDeLlamada, destinosDePase, planDePase, type DestinoDePase } from "@/lib/pasar-llamadas";
import { pasadaDe } from "@/lib/pasada-closer";
import { idSesionCalendly, type EventoCalendly, type InvitadoCalendly } from "@/lib/calendly";
import { ETAPAS } from "@/lib/seed";
import type { MiembroEquipo, Sesion } from "@/lib/types";
import { crearAzar, miembro } from "./azar";
import { BaseFalsa } from "./base-falsa";

/* ==================================================================
   Calendly no pisa la elección manual, de punta a punta: el código de
   verdad de la entrada (lib/calendly-sync.ts: ingresarInvitado) contra una
   base de mentira en memoria. Cada semilla arma la vida de una agenda:
   se agenda, el director la pasa a otro closer, el closer carga estados, y
   Calendly la vuelve a mandar (reintento del webhook, cancelación, no-show,
   reprogramación) con el anfitrión que tenga en ese momento.
   ================================================================== */

const EQUIPO: MiembroEquipo[] = [
  miembro("mariano", "Mariano", "closer", { email: "m@a.com" }),
  miembro("dante", "Dante Barbieri", "closer", { email: "d@a.com" }),
  miembro("valentin", "Valentín Abadía", "closer", { email: "v@a.com" }),
  miembro("lucia", "Lucía Pérez", "closer", { email: "l@a.com" }),
];
const HOSTS = ["Mariano Arias", "Mariano", "Dante Barbieri", "Valentin Abadia", "Lucia Perez", "V. Abadia", "Externo Uno"];

const URI = (tipo: "scheduled_events" | "invitees", n: string) => tipo === "invitees" ? `https://api.calendly.com/scheduled_events/ev_${n}/invitees/inv_${n}` : `https://api.calendly.com/scheduled_events/ev_${n}`;

function evento(n: string, host: string | undefined, estado: "active" | "canceled" = "active", dia = "2026-10-20"): EventoCalendly {
  return {
    uri: URI("scheduled_events", n), name: "Llamada de Asesoramiento - Webinar - Team", status: estado,
    start_time: `${dia}T18:00:00.000Z`, end_time: `${dia}T18:45:00.000Z`, created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z",
    location: null, ...(host ? { event_memberships: [{ user_name: host }] } : { event_memberships: [] }),
  };
}

function invitado(n: string, o: { estado?: "active" | "canceled"; noShow?: boolean; viejo?: string; reprogramada?: boolean } = {}): InvitadoCalendly {
  return {
    uri: URI("invitees", n), email: `persona${n.split("_")[0]}@x.com`, name: `Persona ${n}`, status: o.estado ?? "active", event: URI("scheduled_events", n),
    created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-02T10:00:00.000Z",
    ...(o.viejo ? { old_invitee: URI("invitees", o.viejo) } : {}),
    ...(o.estado === "canceled" ? { cancellation: { reason: "No puedo", created_at: "2026-10-02T09:00:00.000Z" }, rescheduled: Boolean(o.reprogramada) } : {}),
    ...(o.noShow ? { no_show: { created_at: "2026-10-20T20:00:00.000Z" } } : {}),
  };
}

function entorno() {
  const db = new BaseFalsa();
  const ctx = { db: db as never, webinars: [], etapas: ETAPAS.map(({ id, nombre, orden, esGanada, esPerdida }) => ({ id, nombre, orden, esGanada, esPerdida })), etapaSesion: "et_sesion" };
  const ingresar = (inv: InvitadoCalendly, ev: EventoCalendly) => ingresarInvitado(inv.uri, { invitado: inv, evento: ev, desdeLaApi: true }, ctx);
  const sesion = (n: string) => db.fila("sesiones", idSesionCalendly(URI("invitees", n))) as unknown as Sesion | undefined;
  return { db, ingresar, sesion };
}

/* Lo que hace la app cuando el director pasa la llamada: escribe `anfitrion` y `extra` en la fila. */
function pasar(db: BaseFalsa, s: Sesion, destino: DestinoDePase, por = "Santi", cuando = "2026-10-08T14:00:00.000Z") {
  const plan = planDePase(s, destino, { equipo: EQUIPO, por, cuando });
  if (!plan) return null;
  Object.assign(db.fila("sesiones", s.id)!, { anfitrion: plan.cambios.anfitrion, extra: plan.cambios.extra });
  return plan;
}

const destinosDe = (s: Sesion) => destinosDePase({ equipo: EQUIPO, sesiones: [s] });

test("una agenda nueva: queda con el anfitrión de Calendly, sin marca; volver a mandarla (reintento) no cambia nada", async () => {
  const { ingresar, sesion } = entorno();
  const r1 = await ingresar(invitado("a1"), evento("a1", "Dante Barbieri"));
  assert.equal(r1.sesionId, idSesionCalendly(URI("invitees", "a1")));
  const antes = structuredClone(sesion("a1"));
  assert.equal(antes?.anfitrion, "Dante Barbieri");
  assert.equal(pasadaDe(antes!), undefined);
  await ingresar(invitado("a1"), evento("a1", "Dante Barbieri"));
  assert.deepEqual(sesion("a1"), antes, "idempotente");
  /* Sin anfitrión en el evento: no se inventa uno. */
  await ingresar(invitado("a2"), evento("a2", undefined));
  assert.equal(sesion("a2")?.anfitrion, undefined);
});

test("150 semillas: tras pasarla a mano, ningún reingreso de Calendly (reintento, cancelación, no-show) le cambia el closer; la marca anota lo que dice Calendly", async () => {
  let reingresos = 0, conMarca = 0, sinMarca = 0;
  const semillas = Array.from({ length: 150 }, (_, i) => i + 1);
  for (const semilla of semillas) {
    let fallo: Error | null = null;
    await (async () => {
      const r = crearAzar(semilla);
      const { db, ingresar, sesion } = entorno();
      const hostInicial = r.elige(HOSTS);
      await ingresar(invitado("b1"), evento("b1", hostInicial));
      let s = sesion("b1")!;
      /* El closer ya cargó cosas: nada de eso puede perderse. */
      if (r.si(0.5)) Object.assign(db.fila("sesiones", s.id)!, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: "2026-10-20T21:00:00.000Z", notas: "Quiere pensarlo", estado: "hecha", extra: { atribucion: { webinar: "w1" } } });
      let marcada = false;
      for (let paso = 0; paso < r.entre(1, 8); paso++) {
        s = sesion("b1")!;
        if (r.si(0.45)) {
          const plan = pasar(db, s, r.elige(destinosDe(s)), r.elige(["Santi", "Yari"]));
          if (plan) marcada = Boolean(pasadaDe(sesion("b1")!));
          continue;
        }
        const antes = structuredClone(sesion("b1")!);
        const marcaAntes = pasadaDe(antes);
        const hostNuevo = r.si(0.15) ? undefined : r.elige(HOSTS);
        const tipo = r.elige(["reintento", "cancelacion", "no-show", "reintento"] as const);
        await ingresar(
          invitado("b1", { estado: tipo === "cancelacion" ? "canceled" : "active", noShow: tipo === "no-show" }),
          evento("b1", hostNuevo, tipo === "cancelacion" ? "canceled" : "active"),
        );
        reingresos++;
        const despues = sesion("b1")!;
        try {
          if (marcaAntes) {
            conMarca++;
            assert.equal(despues.anfitrion, antes.anfitrion, "Calendly pisó al closer elegido");
            const m = pasadaDe(despues)!;
            assert.ok(m, "se perdió la marca");
            assert.equal(m.a, marcaAntes.a); assert.equal(m.por, marcaAntes.por); assert.equal(m.en, marcaAntes.en);
            assert.equal(m.calendly, hostNuevo ?? marcaAntes.calendly, "la marca anota lo que dice Calendly ahora");
            assert.equal(closerDeLlamada(despues, EQUIPO).miembro?.id, closerDeLlamada(antes, EQUIPO).miembro?.id);
          } else {
            sinMarca++;
            assert.equal(despues.anfitrion, hostNuevo ?? antes.anfitrion, "sin marca, manda Calendly");
            assert.equal(pasadaDe(despues), undefined);
          }
          /* Lo que cargó el equipo no se pisa; lo que decide Calendly, sí. */
          for (const k of ["estadoLlamada", "estadoLlamadaEn", "notas"] as const) assert.equal(despues[k], antes[k], k);
          assert.deepEqual(despues.extra.atribucion, antes.extra.atribucion);
          assert.equal(despues.estado, tipo === "cancelacion" ? "cancelada" : tipo === "no-show" ? "no-show" : antes.estado, `estado tras ${tipo}`);
        } catch (e) { fallo = e as Error; fallo.message = `[semilla ${semilla}, paso ${tipo}, marca antes ${Boolean(marcaAntes)}] ${fallo.message}`; }
        if (fallo) break;
      }
      void marcada;
    })();
    if (fallo) throw fallo;
  }
  assert.ok(reingresos > 200 && conMarca > 60 && sinMarca > 100, `reingresos ${reingresos}, con marca ${conMarca}, sin marca ${sinMarca}`);
});

test("150 semillas: la reprogramación hereda el closer elegido de la agenda que reemplaza (y su marca), incluso en cadena", async () => {
  let conMarca = 0, cadenas = 0;
  for (let semilla = 1; semilla <= 150; semilla++) {
    const r = crearAzar(semilla);
    const { db, ingresar, sesion } = entorno();
    await ingresar(invitado("c1"), evento("c1", r.elige(HOSTS)));
    let actual = "c1";
    for (let i = 0; i < r.entre(1, 4); i++) {
      const s = sesion(actual)!;
      if (r.si(0.7)) pasar(db, sesion(actual)!, r.elige(destinosDe(s)));
      const vieja = structuredClone(sesion(actual)!);
      const marcaVieja = pasadaDe(vieja);
      const siguiente = `c${i + 2}`;
      const hostNuevo = r.si(0.15) ? undefined : r.elige(HOSTS);
      /* Calendly: la vieja se cancela como reprogramada y entra la nueva, con su anfitrión. */
      await ingresar(invitado(actual, { estado: "canceled", reprogramada: true }), evento(actual, r.elige(HOSTS), "canceled"));
      await ingresar(invitado(siguiente, { viejo: actual }), evento(siguiente, hostNuevo, "active", "2026-10-27"));
      const nueva = sesion(siguiente)!;
      const vieja2 = sesion(actual)!;
      assert.equal(nueva.reprogramadaDe, vieja.id, "reprogramadaDe");
      assert.equal(vieja2.estado, "cancelada", "estado de la vieja");
      assert.equal(vieja2.motivoCancelacion, "Reprogramada", "motivo");
      if (marcaVieja) {
        conMarca++;
        assert.equal(nueva.anfitrion, vieja.anfitrion, "la reprogramada sigue con el closer elegido");
        const m = pasadaDe(nueva)!;
        assert.ok(m && m.a === marcaVieja.a && m.por === marcaVieja.por, "hereda la marca");
        /* Lo que decía Calendly: el anfitrión nuevo o, si no vino, lo último que había anotado la vieja (que la cancelación acaba de actualizar). */
        assert.equal(m.calendly, hostNuevo ?? pasadaDe(vieja2)!.calendly, "la marca heredada anota lo que dice Calendly ahora");
      } else {
        /* (Un evento sin anfitrión no existe en Calendly: acá sólo se comprueba que no se inventa uno.) */
        assert.equal(nueva.anfitrion, hostNuevo, "sin marca manda Calendly");
        assert.equal(pasadaDe(nueva), undefined);
      }
      /* La vieja, pasada a mano, sigue con su closer aunque se cancele; sin marca la sigue Calendly. */
      if (marcaVieja) assert.equal(vieja2.anfitrion, vieja.anfitrion, "la vieja con marca cambió de closer");
      /* Lo que cargó el equipo en la vieja no se hereda salvo notas y Pre-Call (el estado de llamada no). */
      assert.equal(nueva.estadoLlamada, undefined, "estadoLlamada de la nueva");
      actual = siguiente;
      if (i > 0) cadenas++;
    }
  }
  assert.ok(conMarca > 100 && cadenas > 50, `con marca ${conMarca}, en cadena ${cadenas}`);
});
