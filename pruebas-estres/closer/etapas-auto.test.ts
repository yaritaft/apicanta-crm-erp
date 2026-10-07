import test from "node:test";
import assert from "node:assert/strict";
import { ETAPAS } from "@/lib/seed";
import { OPCIONES_POR_DEFECTO } from "@/lib/crm";
import {
  etapaPorEvento, etapaTrasEventos, etapasClave, eventosDeLlamada, leadDeSesion, type EventoEtapa,
} from "@/lib/etapas-auto";
import type { Etapa, Lead, OpcionCrm, Sesion } from "@/lib/types";
import { clonar, enAR, porSemillas, type Azar } from "./azar";

/* ==================================================================
   La etapa de la oportunidad se mueve sola con lo que pasa en el CRM
   (lib/etapas-auto.ts). Reglas del comentario del módulo:
   - agendar y hacer la llamada sólo hacen avanzar (agendar reabre al perdido);
   - comprar gana desde donde esté (también desde Perdido);
   - perderse no le quita la compra a quien ya compró; una devolución sí;
   - sacar el «NO Calificado» devuelve al lead a donde lo deja la llamada.
   ================================================================== */

const EVENTOS: EventoEtapa[] = ["agendo", "llamada-hecha", "compro", "perdida", "devolucion", "sigue", "sigue-hecha"];

/* Etapas de la app, a veces con otro orden de números, sin alguna del medio, o con nombres cambiados. */
function etapasAlAzar(r: Azar): Etapa[] {
  let es = clonar(ETAPAS);
  if (r.si(0.3)) es = es.filter((e) => !["et_nuevo", "et_contactado"].includes(e.id) || r.si(0.5));
  if (r.si(0.15)) es = es.filter((e) => e.id !== "et_propuesta");
  if (r.si(0.1)) es = es.filter((e) => e.id !== "et_sesion");
  if (r.si(0.1)) es = es.map((e) => (e.id === "et_sesion" ? { ...e, id: "x_agendado", nombre: "Agendado" } : e));
  if (r.si(0.1)) es = es.map((e) => (e.id === "et_propuesta" ? { ...e, id: "x_prop", nombre: "Propuesta enviada" } : e));
  if (r.si(0.1)) es = es.filter((e) => !e.esGanada);
  if (r.si(0.1)) es = es.filter((e) => !e.esPerdida);
  /* Con números de orden corridos (editables en Ajustes). */
  const k = r.entre(0, 7);
  return r.mezclar(es.map((e) => ({ ...e, orden: e.orden * 3 + k })));
}

const hechoEn = (etapas: Etapa[]) => (id?: string) => etapas.find((e) => e.id === id);

test("etapaPorEvento: el resultado es siempre una etapa que existe y distinta de donde está, o null (1000 semillas)", () => {
  porSemillas(1000, 1, (r) => {
    const etapas = etapasAlAzar(r);
    const ids = new Set(etapas.map((e) => e.id));
    for (let i = 0; i < 40; i++) {
      const desde = r.elige([undefined, "no-existe", ...etapas.map((e) => e.id)]);
      const ev = r.elige(EVENTOS);
      const a = etapaPorEvento(desde, ev, etapas);
      if (a === null) continue;
      assert.ok(ids.has(a), `${ev}: ${a} no es una etapa`);
      assert.notEqual(a, desde);
    }
  });
});

test("etapaPorEvento: agendar y hacer la llamada sólo hacen avanzar; nunca sacan de Inscripto ni de Perdido (salvo agendar, que reabre al perdido) (1000 semillas)", () => {
  porSemillas(1000, 2000, (r) => {
    const etapas = etapasAlAzar(r);
    const por = hechoEn(etapas);
    for (const e of etapas) {
      const k = etapasClave(etapas);
      const sesion = etapaPorEvento(e.id, "agendo", etapas);
      const hecha = etapaPorEvento(e.id, "llamada-hecha", etapas);
      if (e.esGanada) { assert.equal(sesion, null); assert.equal(hecha, null); }
      if (e.esPerdida) {
        assert.equal(hecha, null, "una llamada hecha no reabre al perdido");
        assert.ok(sesion === null || sesion === k.sesion?.id, "agendar lo reabre en Sesión agendada");
        assert.equal(sesion, k.sesion && k.sesion.id !== e.id ? k.sesion.id : null);
      }
      if (!e.esGanada && !e.esPerdida) {
        for (const d of [sesion, hecha]) if (d) assert.ok(por(d)!.orden > e.orden, `avanzar: de ${e.nombre} a ${por(d)!.nombre}`);
      }
    }
    /* Sin etapa (lead sin etapa) agendar la pone en Sesión agendada y la llamada hecha en Propuesta, si existen. */
    const k = etapasClave(etapas);
    assert.equal(etapaPorEvento(undefined, "agendo", etapas), k.sesion?.id ?? null);
    assert.equal(etapaPorEvento(undefined, "llamada-hecha", etapas), k.propuesta?.id ?? null);
  });
});

test("etapaPorEvento: comprar gana desde donde esté; perderse no le quita la compra a quien compró y una devolución sí; «sigue» sólo toca al perdido (1000 semillas)", () => {
  porSemillas(1000, 3000, (r) => {
    const etapas = etapasAlAzar(r);
    const k = etapasClave(etapas);
    for (const e of etapas) {
      assert.equal(etapaPorEvento(e.id, "compro", etapas), e.esGanada ? null : k.ganada?.id ?? null, `compro desde ${e.nombre}`);
      assert.equal(etapaPorEvento(e.id, "perdida", etapas), e.esGanada || e.esPerdida ? null : k.perdida?.id ?? null, `perdida desde ${e.nombre}`);
      assert.equal(etapaPorEvento(e.id, "devolucion", etapas), e.esPerdida ? null : k.perdida?.id ?? null, `devolución desde ${e.nombre}`);
      if (!e.esPerdida) { assert.equal(etapaPorEvento(e.id, "sigue", etapas), null); assert.equal(etapaPorEvento(e.id, "sigue-hecha", etapas), null); }
      else {
        assert.equal(etapaPorEvento(e.id, "sigue", etapas), k.sesion && k.sesion.id !== e.id ? k.sesion.id : null);
        assert.equal(etapaPorEvento(e.id, "sigue-hecha", etapas), k.propuesta && k.propuesta.id !== e.id ? k.propuesta.id : null);
      }
    }
  });
});

test("etapaPorEvento es idempotente: repetir el mismo evento no mueve nada más (1000 semillas × 7 eventos)", () => {
  porSemillas(1000, 4000, (r) => {
    const etapas = etapasAlAzar(r);
    for (const e of [undefined, ...etapas.map((x) => x.id)]) {
      for (const ev of EVENTOS) {
        const una = etapaPorEvento(e, ev, etapas);
        const despues = una ?? e;
        const dos = etapaPorEvento(despues, ev, etapas);
        /* «sigue» y «sigue-hecha» salen de Perdido hacia una etapa abierta, donde ya no hacen nada. */
        assert.equal(dos, null, `${ev} dos veces desde ${e}: ${una} y después ${dos}`);
      }
    }
  });
});

test("etapaTrasEventos es el pliegue de etapaPorEvento y nunca devuelve la misma etapa (1000 semillas)", () => {
  porSemillas(1000, 5000, (r) => {
    const etapas = etapasAlAzar(r);
    for (let i = 0; i < 30; i++) {
      const desde = r.elige([undefined, ...etapas.map((e) => e.id)]);
      const evs = Array.from({ length: r.entre(0, 5) }, () => r.elige(EVENTOS));
      let plegada = desde;
      for (const ev of evs) plegada = etapaPorEvento(plegada, ev, etapas) ?? plegada;
      const res = etapaTrasEventos(desde, evs, etapas);
      assert.equal(res, plegada !== desde && plegada ? plegada : null);
      assert.notEqual(res, desde);
    }
  });
});

/* ---------- Lo que dice una llamada de su oportunidad ---------- */

const OPS: OpcionCrm[] = clonar(OPCIONES_POR_DEFECTO.estadoLlamada);
const PIERDEN = new Set(OPS.filter((o) => o.oportunidad === "perdida" || o.oportunidad === "devolucion").map((o) => o.nombre));

test("eventosDeLlamada: 'llamada-hecha' sólo cuando pasa a hecha, y perder/seguir sólo cuando cambia el estado de la llamada (1000 semillas)", () => {
  porSemillas(1000, 6000, (r) => {
    for (let i = 0; i < 40; i++) {
      const estados = ["agendada", "hecha", "no-show", "cancelada"] as const;
      const antes = { estado: r.elige(estados), estadoLlamada: r.elige([undefined, "", ...OPS.map((o) => o.nombre)]) };
      const despues = { estado: r.elige(estados), estadoLlamada: r.elige([undefined, "", ...OPS.map((o) => o.nombre)]) };
      const ev = eventosDeLlamada(antes, despues, OPS);
      assert.equal(ev.includes("llamada-hecha"), despues.estado === "hecha" && antes.estado !== "hecha");
      const mismo = (antes.estadoLlamada ?? "") === (despues.estadoLlamada ?? "");
      if (mismo) assert.ok(ev.every((x) => x === "llamada-hecha"), "sin cambiar el estado no hay perdida ni «sigue»");
      const op = (n?: string) => OPS.find((o) => o.nombre === n);
      if (!mismo) {
        assert.equal(ev.includes("perdida"), op(despues.estadoLlamada)?.oportunidad === "perdida");
        assert.equal(ev.includes("devolucion"), op(despues.estadoLlamada)?.oportunidad === "devolucion");
        const sigue = ev.includes("sigue") || ev.includes("sigue-hecha");
        assert.equal(sigue, !PIERDEN.has(despues.estadoLlamada ?? "") && PIERDEN.has(antes.estadoLlamada ?? ""));
        if (sigue) assert.equal(ev.includes(despues.estado === "hecha" ? "sigue-hecha" : "sigue"), true);
      }
      assert.ok(ev.length <= 2);
    }
  });
});

test("cargar «NO Calificado» y sacarlo devuelve al lead a donde estaba, también si la llamada recién se hizo (1000 semillas)", () => {
  const etapas = clonar(ETAPAS);
  porSemillas(1000, 7000, (r) => {
    const desde = r.elige(["et_nuevo", "et_contactado", "et_sesion", "et_propuesta"]);
    const sesionAntes = r.elige(["agendada", "hecha"] as const);
    const antes = { estado: sesionAntes, estadoLlamada: undefined as string | undefined };
    /* Carga el estado: la agenda pasa a hecha (lo marca el estado). */
    const cargado = { estado: "hecha" as const, estadoLlamada: "NO Calificado" };
    const e1 = eventosDeLlamada(antes, cargado, OPS);
    const tras = etapaTrasEventos(desde, e1, etapas);
    const perdido = tras ?? desde;
    assert.equal(perdido, "et_perdido", "queda perdido");
    /* Lo saca: la agenda vuelve a lo que era (la app la devuelve a «agendada» si el estado la había marcado). */
    const vacio = { estado: sesionAntes === "agendada" ? ("agendada" as const) : ("hecha" as const), estadoLlamada: undefined };
    const e2 = eventosDeLlamada({ estado: "hecha", estadoLlamada: "NO Calificado" }, vacio, OPS);
    const vuelve = etapaTrasEventos(perdido, e2, etapas) ?? perdido;
    /* El lead queda en Propuesta (si la llamada está hecha) o en Sesión agendada (si no): nunca en Perdido. */
    assert.equal(vuelve, sesionAntes === "hecha" ? "et_propuesta" : "et_sesion");
  });
});

/* ---------- La oportunidad de una llamada ---------- */

const lead = (id: string, contactoId: string | undefined, actualizadoEn: string | undefined, creadoEn = "2026-09-01T00:00:00Z"): Lead =>
  ({ id, contactoId, nombre: id, creadoEn, actualizadoEn, etapaId: "et_nuevo", monto: 0, moneda: "USD", etiquetas: [], extra: {} }) as unknown as Lead;

test("leadDeSesion: el lead propio; si no, la oportunidad más reciente de la misma persona (500 semillas)", () => {
  porSemillas(500, 8000, (r) => {
    const leads: Lead[] = Array.from({ length: r.entre(0, 8) }, (_, i) => lead(`l${i}`, r.elige(["c1", "c2", undefined]), r.si(0.7) ? enAR(`2026-09-${String(r.entre(1, 28)).padStart(2, "0")}`, 12) : undefined, enAR(`2026-08-${String(r.entre(1, 28)).padStart(2, "0")}`, 12)));
    const s = { leadId: r.elige([undefined, "l0", "l3", "nada"]), contactoId: r.elige([undefined, "c1", "c2", "c9"]) } as Pick<Sesion, "leadId" | "contactoId">;
    const got = leadDeSesion(leads, s);
    const propio = s.leadId ? leads.find((l) => l.id === s.leadId) : undefined;
    if (propio) { assert.equal(got, propio); return; }
    if (!s.contactoId) { assert.equal(got, undefined); return; }
    const suyas = leads.filter((l) => l.contactoId === s.contactoId || l.id === s.contactoId);
    if (suyas.length === 0) { assert.equal(got, undefined); return; }
    const reciente = (l: Lead) => l.actualizadoEn ?? l.creadoEn;
    assert.ok(got && suyas.includes(got));
    for (const l of suyas) assert.ok(reciente(got!) >= reciente(l), "la más reciente");
  });
});
