import test from "node:test";
import assert from "node:assert/strict";
import { esCompra, opcionesDe, OPCIONES_POR_DEFECTO } from "@/lib/crm";
import {
  CANCELADA, CON_CIERRE, desenlaceDe, estadoDe, estadoDeAgenda, esReagendar, NO_SE_PRESENTO, ofrecidas, opcionDeCompraPara, POR_VENIR, preguntaDe, queMueve,
  REPROGRAMO, revisarOcultar, SIN_CARGAR, SIN_CIERRE, type Desenlace,
} from "@/lib/estados";
import type { EstadoSesion, OpcionCrm, OportunidadCrm, ResultadoLlamada, Sesion } from "@/lib/types";
import { Azar, conSemilla } from "./gen";

/* ==================================================================
   estados.ts: una sola fuente de los estados de una llamada.
   El orden de prioridad de «cómo terminó», lo que dice cada estado de la
   agenda, y la revisión de ocultar un estado (que no deje al cierre del día
   sin lo que necesita).
   ================================================================== */

const OPCIONES = OPCIONES_POR_DEFECTO.estadoLlamada;
const ESTADOS: EstadoSesion[] = ["agendada", "hecha", "no-show", "cancelada"];
const RESULTADOS: (ResultadoLlamada | undefined)[] = [undefined, "compro", "no-compro", "no-vino", "reprogramo"];

/* La prioridad que dice el encabezado de estados.ts, escrita de nuevo. */
function esperado(estado: EstadoSesion, cargada: OpcionCrm | undefined, venta: boolean, paso: boolean, resultado: ResultadoLlamada | undefined, preCall: string | undefined): Desenlace {
  if (venta || (cargada && esCompra(cargada))) return CON_CIERRE;
  if (estado === "cancelada") return CANCELADA;
  if (estado === "no-show" || cargada?.llamada === "no-show") return NO_SE_PRESENTO;
  if (cargada && (cargada.llamada === "hecha" || cargada.oportunidad === "perdida" || cargada.oportunidad === "devolucion")) return SIN_CIERRE;
  if (resultado) return ({ compro: CON_CIERRE, "no-compro": SIN_CIERRE, "no-vino": NO_SE_PRESENTO, reprogramo: REPROGRAMO } as const)[resultado];
  if (/reagend|reprogram/.test((preCall ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())) return REPROGRAMO;
  return paso ? SIN_CARGAR : POR_VENIR;
}

test("desenlaceDe sigue la prioridad dicha, en todas las combinaciones de estado, opción cargada, venta, fecha, resultado viejo y Pre-Call", () => {
  let n = 0;
  for (const estado of ESTADOS) for (const cargada of [undefined, ...OPCIONES]) for (const venta of [false, true]) for (const paso of [false, true])
    for (const resultado of RESULTADOS) for (const preCall of [undefined, "Confirmado", "Reagendar", "Sin Respuesta"]) {
      const real = desenlaceDe({ estado, estadoPreCall: preCall, resultado }, cargada, { venta, paso });
      assert.equal(real, esperado(estado, cargada, venta, paso, resultado, preCall), JSON.stringify({ estado, cargada: cargada?.nombre, venta, paso, resultado, preCall }));
      n++;
    }
  assert.ok(n > 3000);
});

test("lo que el resto de la app da por cierto del desenlace: una compra o una venta siempre es «Con cierre»; una cancelada sin venta nunca «se presentó»", () => {
  for (const estado of ESTADOS) for (const cargada of [undefined, ...OPCIONES]) for (const paso of [false, true]) for (const resultado of RESULTADOS) {
    assert.equal(desenlaceDe({ estado, resultado }, cargada, { venta: true, paso }), CON_CIERRE);
    const d = desenlaceDe({ estado, resultado }, cargada, { venta: false, paso });
    if (cargada && esCompra(cargada)) assert.equal(d, CON_CIERRE);
    if (estado === "cancelada" && !(cargada && esCompra(cargada))) assert.equal(d, CANCELADA);
    /* Sin nada cargado y sin pasar, no hay nada que contar todavía. */
    if (estado === "agendada" && !cargada && !resultado && !paso) assert.equal(d, POR_VENIR);
    if (estado === "agendada" && !cargada && !resultado && paso) assert.equal(d, SIN_CARGAR);
  }
});

const sesion = (o: Partial<Sesion>): Pick<Sesion, "estado" | "estadoLlamada" | "canceladaEn"> => ({ estado: "agendada", ...o });

test("estadoDeAgenda: lo que dice cada estado de la agenda (hecha, no vino, cancelada) y nunca propone dejar la agenda como ya está", () => {
  for (const estado of ESTADOS) for (const o of OPCIONES) {
    const r = estadoDeAgenda(sesion({ estado }), o.nombre, OPCIONES);
    const quiere: EstadoSesion | undefined = o.llamada ?? (o.auto === "cancelada" ? "cancelada" : undefined);
    assert.equal(r, quiere && quiere !== estado ? quiere : undefined, `${estado} → ${o.nombre}`);
  }
  /* Un estado que no existe, o ninguno sobre una agenda sin estado, no mueve nada. */
  for (const estado of ESTADOS) { assert.equal(estadoDeAgenda(sesion({ estado }), "Estado fantasma", OPCIONES), undefined); assert.equal(estadoDeAgenda(sesion({ estado }), undefined, OPCIONES), undefined); assert.equal(estadoDeAgenda(sesion({ estado }), "", OPCIONES), undefined); }
});

test("estadoDeAgenda: cargar un estado en una agenda sin marcar y vaciarlo la deja como estaba (agendada)", () => {
  for (const o of OPCIONES) {
    const s0 = sesion({ estado: "agendada" });
    const a = estadoDeAgenda(s0, o.nombre, OPCIONES);
    const s1 = { ...s0, estadoLlamada: o.nombre, ...(a ? { estado: a } : {}) };
    const b = estadoDeAgenda(s1, undefined, OPCIONES);
    const final = b ?? s1.estado;
    assert.equal(final, "agendada", `${o.nombre}: cargarlo y vaciarlo dejó la agenda en ${final}`);
  }
});

test("lo que canceló Calendly sigue cancelado al vaciar el estado", () => {
  const s = sesion({ estado: "cancelada", canceladaEn: "2026-10-01T10:00:00.000Z", estadoLlamada: "Canceló (auto)" });
  assert.equal(estadoDeAgenda(s, undefined, OPCIONES), undefined);
  const s2 = sesion({ estado: "cancelada", estadoLlamada: "Canceló (auto)" });
  assert.equal(estadoDeAgenda(s2, undefined, OPCIONES), "agendada", "una cancelación marcada a mano sí se deshace");
});

test("BUG: vaciar el Estado de Llamada de una llamada que ya estaba marcada «hecha» a mano en la Agenda la devuelve a «agendada»", { todo: true }, () => {
  /* La Agenda tiene «Se hizo»; después el closer elige un Estado de Llamada que también es «hecha» (no cambia la agenda) y,
     al corregirlo, lo vacía: estadoDeAgenda supone que fue ese estado el que la marcó y la deshace, y la llamada que el closer
     había marcado como hecha vuelve a «agendada» (el Dashboard deja de contarla como asistencia). */
  const s0 = sesion({ estado: "hecha" });
  const a = estadoDeAgenda(s0, "Seguimiento Nutrición", OPCIONES);
  assert.equal(a, undefined, "elegir un estado que también es «hecha» no mueve la agenda");
  const s1 = { ...s0, estadoLlamada: "Seguimiento Nutrición" };
  assert.equal(estadoDeAgenda(s1, undefined, OPCIONES), undefined, "vaciarlo desmarcó una llamada que se había marcado hecha a mano");
});

/* ---------- Ocultar un estado ---------- */

/* Se oculta con probabilidad distinta en cada caso, así a veces queda una sola opción de compra o de seguimiento a la vista. */
const conOcultas = (r: Azar): OpcionCrm[] => { const p = r.pick([0.2, 0.5, 0.8, 0.9]); return OPCIONES.map((o) => ({ ...o, ...(r.bool(p) ? { oculta: true } : {}) })); };
const ajustesCon = (opciones: OpcionCrm[]) => ({ crm: { opciones: { estadoLlamada: opciones } } });
const visibles = (xs: OpcionCrm[]) => xs.filter((o) => !o.oculta);

test("revisarOcultar bloquea justo cuando ocultar dejaría al cierre del día sin un estado de compra o de seguimiento", () => {
  let bloqueos = 0, libres = 0;
  for (let semilla = 1; semilla <= 300; semilla++) {
    const r = new Azar(semilla);
    const opciones = conOcultas(r);
    const vis = visibles(opciones);
    const o = vis.length && r.bool(0.85) ? r.pick(vis) : r.pick(opciones);
    const rev = revisarOcultar(ajustesCon(opciones), "estadoLlamada", o.nombre, r.int(4));
    const despues = opciones.map((x) => (x.nombre === o.nombre ? { ...x, oculta: true } : x));
    const quedaCompra = visibles(despues).some((x) => esCompra(x));
    const quedaSeguimiento = visibles(despues).some((x) => preguntaDe(x) === "seguimiento");
    const rompeCompra = esCompra(o) && !quedaCompra;
    const rompeSeguimiento = preguntaDe(o) === "seguimiento" && !quedaSeguimiento;
    const ctx = conSemilla(semilla, `ocultar «${o.nombre}» con ${opciones.filter((x) => x.oculta).map((x) => x.nombre).join(", ") || "nada"} ya oculto`);
    assert.equal(rev.bloquea !== null, rompeCompra || rompeSeguimiento, ctx);
    if (rev.bloquea === null) {
      libres++;
      /* Si se puede ocultar, el cierre del día sigue teniendo con qué cargar la venta y dejar una llamada en seguimiento. */
      if (visibles(opciones).some((x) => esCompra(x))) assert.ok(quedaCompra || !esCompra(o), ctx);
      for (const tipo of ["compra-full", "compra-cuotas", "reserva", "downsell"] as OportunidadCrm[]) {
        if (quedaCompra) assert.ok(opcionDeCompraPara(despues, tipo), ctx);
      }
    } else bloqueos++;
    assert.deepEqual(rev.mueve, queMueve(o, "estadoLlamada"), ctx);
    assert.ok(rev.usos >= 0);
  }
  assert.ok(bloqueos > 10 && libres > 10, `cobertura: ${bloqueos} bloqueos, ${libres} libres`);
});

test("revisarOcultar y queMueve no se caen con ningún estado ni campo, ni con un nombre que no existe", () => {
  for (const campo of ["estadoLlamada", "estadoPreCall", "preCall"] as const) {
    const lista = opcionesDe({ crm: undefined }, campo);
    for (const o of lista) {
      assert.doesNotThrow(() => revisarOcultar({ crm: undefined }, campo, o.nombre, 3), `${campo} ${o.nombre}`);
      assert.ok(Array.isArray(queMueve(o, campo)));
    }
    const r = revisarOcultar({ crm: undefined }, campo, "No existe", 2);
    assert.deepEqual(r, { mueve: [], bloquea: null, avisos: [], usos: 2 });
  }
  assert.ok(revisarOcultar({ crm: undefined }, "estadoPreCall", "Reagendar").bloquea, "Reagendar es el único del Pre-Call que dice «pidió otra fecha»");
});

test("ofrecidas y opcionDeCompraPara: lo oculto no se ofrece (salvo lo que la llamada ya tiene) y la compra elegida es visible si hay alguna visible", () => {
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = new Azar(semilla + 40);
    const opciones = conOcultas(r);
    const actual = r.bool() ? r.pick(opciones).nombre : undefined;
    const of = ofrecidas(opciones, actual);
    assert.ok(of.every((o) => !o.oculta || o.nombre === actual), conSemilla(semilla, "ofreció una oculta"));
    assert.equal(of.length, opciones.filter((o) => !o.oculta || o.nombre === actual).length, conSemilla(semilla, "faltó una visible"));
    for (const tipo of ["compra-full", "compra-cuotas", "reserva", "downsell"] as OportunidadCrm[]) {
      const c = opcionDeCompraPara(opciones, tipo);
      if (opciones.some((o) => esCompra(o))) assert.ok(c && esCompra(c), conSemilla(semilla, `sin compra para ${tipo}`));
      if (visibles(opciones).some((o) => esCompra(o))) assert.ok(c && !c.oculta, conSemilla(semilla, `eligió una oculta para ${tipo}`));
      const propia = visibles(opciones).find((o) => o.oportunidad === tipo);
      if (propia) assert.equal(c, propia, conSemilla(semilla, `la propia de ${tipo}`));
    }
  }
});

test("esReagendar entiende las formas de pedir otra fecha y nada más", () => {
  for (const x of ["Reagendar", "reagendar", "REAGENDAR", "Reagendá", "reagendó", "Reprogramó", "reprogramar", "Quiere reagendar"]) assert.ok(esReagendar(x), x);
  for (const x of ["Confirmado", "Sin Respuesta", "", null, undefined, "agendar", "re-agenda"]) assert.ok(!esReagendar(x), String(x));
});

test("estadoDe: la opción cargada manda sobre la automática, y sin ninguna dice «Por venir» o «Sin cargar» según la fecha", () => {
  const base = { estado: "agendada" as const, resultado: undefined, estadoPreCall: undefined };
  const ahora = Date.parse("2026-10-07T15:00:00.000Z");
  const futura = { ...base, inicia: "2026-10-08T15:00:00.000Z" }, pasada = { ...base, inicia: "2026-10-06T15:00:00.000Z" };
  assert.equal(estadoDe(futura, { opciones: OPCIONES, ahora }).texto, POR_VENIR);
  assert.equal(estadoDe(pasada, { opciones: OPCIONES, ahora }).texto, SIN_CARGAR);
  assert.equal(estadoDe(pasada, { opciones: OPCIONES, ahora }).sinCargar, true);
  assert.equal(estadoDe(futura, { opciones: OPCIONES, ahora }).sinCargar, false);
  /* La puesta por la app aparece como automática; la cargada la pisa. */
  const auto = estadoDe(pasada, { opciones: OPCIONES, auto: "2da Agenda (auto)", ahora });
  assert.equal(auto.texto, "2da Agenda (auto)"); assert.equal(auto.auto, true); assert.equal(auto.vacio, false);
  const cargada = estadoDe({ ...pasada, estadoLlamada: "Compra Full" }, { opciones: OPCIONES, auto: "2da Agenda (auto)", ahora });
  assert.equal(cargada.texto, "Compra Full"); assert.equal(cargada.auto, false); assert.equal(cargada.desenlace, CON_CIERRE);
  /* Un estado que ya no está entre las opciones se sigue mostrando (gris), no desaparece. */
  const huerfano = estadoDe({ ...pasada, estadoLlamada: "Estado viejo" }, { opciones: OPCIONES, ahora });
  assert.equal(huerfano.texto, "Estado viejo"); assert.equal(huerfano.color, "gris1");
  /* Pidió otra fecha: no hay nada que decir, la agenda nueva entra sola. */
  const reag = estadoDe({ ...pasada, estadoPreCall: "Reagendar" }, { opciones: OPCIONES, ahora });
  assert.equal(reag.texto, ""); assert.equal(reag.desenlace, REPROGRAMO); assert.equal(reag.sinCargar, false);
  /* Una sesión que no es de venta y se hizo: «Hecha». */
  assert.equal(estadoDe({ ...pasada, estado: "hecha" }, { opciones: OPCIONES, deVenta: false, ahora }).texto, "Hecha");
});
