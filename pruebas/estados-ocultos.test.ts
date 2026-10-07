import test from "node:test";
import assert from "node:assert/strict";
import { esCompra, opcionesDe, OPCIONES_POR_DEFECTO } from "@/lib/crm";
import {
  estadoDeAgenda, estadoDe, ofrecidas, opcionDeCompraPara, preguntaDe, queMueve, revisarOcultar,
} from "@/lib/estados";
import { escrituraDe, filasTabla } from "@/lib/crm-tabla";
import { eventosDeLlamada } from "@/lib/etapas-auto";
import { construirSemilla } from "@/lib/seed";
import type { Ajustes, CampoOpcionesCrm, OpcionCrm, OportunidadCrm } from "@/lib/types";

/* ==================================================================
   Ocultar un estado de llamada (F2-05): no se ofrece al cargar, no se
   borra, y antes se revisa qué mueve y si ocultarlo rompe algo.
   ================================================================== */

type Crm = Pick<Ajustes, "crm">;
const ocultando = (campo: CampoOpcionesCrm, ...nombres: string[]): Crm => ({
  crm: { opciones: { [campo]: opcionesDe({ crm: undefined }, campo).map((o) => (nombres.includes(o.nombre) ? { ...o, oculta: true } : o)) } },
});
const nombres = (xs: OpcionCrm[]) => xs.map((o) => o.nombre);

test("lo oculto no se ofrece, salvo que la llamada ya lo tenga: ahí se sigue viendo y sigue elegido", () => {
  const todas = OPCIONES_POR_DEFECTO.estadoLlamada.map((o) => (o.nombre === "Califica Downsell" ? { ...o, oculta: true } : o));
  assert.equal(ofrecidas(todas).length, todas.length - 1);
  assert.ok(!nombres(ofrecidas(todas)).includes("Califica Downsell"));
  assert.ok(nombres(ofrecidas(todas, "Califica Downsell")).includes("Califica Downsell"), "la llamada que ya lo tiene lo sigue viendo");
  /* Sin nada oculto, la lista es la de siempre. */
  assert.deepEqual(ofrecidas(OPCIONES_POR_DEFECTO.estadoLlamada), OPCIONES_POR_DEFECTO.estadoLlamada);
});

test("oculto no es borrado: la lista completa sigue ahí, con sus colores y lo que mueve", () => {
  const a = ocultando("estadoLlamada", "Compra Cuotas", "Inasistió");
  const todas = opcionesDe(a, "estadoLlamada");
  assert.equal(todas.length, OPCIONES_POR_DEFECTO.estadoLlamada.length);
  const cuotas = todas.find((o) => o.nombre === "Compra Cuotas")!;
  assert.equal(cuotas.oculta, true);
  assert.equal(cuotas.color, "verde2");
  assert.equal(preguntaDe(cuotas), "venta", "sigue siendo una compra para el cierre del día");
  /* Lo que hacía en la Agenda, también. */
  assert.equal(estadoDeAgenda({ estado: "agendada", estadoLlamada: undefined, canceladaEn: undefined }, "Compra Cuotas", todas), "hecha");
  /* Y una llamada que lo tiene lo muestra con su color. */
  const ver = estadoDe({ estado: "hecha", estadoLlamada: "Compra Cuotas", estadoPreCall: undefined, resultado: undefined, inicia: "2026-09-03T15:00:00.000Z" }, { opciones: todas, ahora: Date.parse("2026-10-01T00:00:00Z") });
  assert.equal(ver.texto, "Compra Cuotas");
  assert.equal(ver.color, "verde2");
  assert.equal(ver.desenlace, "Con cierre");
  /* Deshacer o corregir una celda al estado oculto sigue pudiendo escribirse. */
  const e = construirSemilla();
  const fila = filasTabla(e)[0];
  const w = escrituraDe(fila, "estadoLlamada", "Compra Cuotas", { ajustes: { ...e.ajustes, ...a } as Ajustes, quien: "Yo", cuando: "2026-10-01T00:00:00.000Z" });
  assert.ok(!w || (w.tipo === "llamada" && w.cambios.estadoLlamada === "Compra Cuotas"));
});

test("el estado de compra de una venta prefiere los que están a la vista; sin nada oculto da lo de siempre", () => {
  const lista = OPCIONES_POR_DEFECTO.estadoLlamada;
  /* La cuenta de antes, sin ocultar nada. */
  const antes = (tipo: OportunidadCrm) => lista.find((o) => o.oportunidad === tipo) ?? lista.find((o) => esCompra(o));
  for (const t of ["compra-full", "compra-cuotas", "reserva", "downsell"] as const) assert.equal(opcionDeCompraPara(lista, t), antes(t), t);
  /* Con «Reserva» oculta, una venta con reserva queda como el primer estado de compra que queda a la vista. */
  const sinReserva = lista.map((o) => (o.nombre === "Reserva" ? { ...o, oculta: true } : o));
  assert.equal(opcionDeCompraPara(sinReserva, "reserva")?.nombre, "Compra Full");
  assert.equal(opcionDeCompraPara(sinReserva, "compra-cuotas")?.nombre, "Compra Cuotas");
  /* Si no queda ninguno a la vista (no debería pasar: se avisa antes), se usa el que haya. */
  const todasOcultas = lista.map((o) => (esCompra(o) ? { ...o, oculta: true } : o));
  assert.equal(opcionDeCompraPara(todasOcultas, "reserva")?.nombre, "Reserva");
});

/* ---------- Qué mueve cada estado ---------- */

test("queMueve dice qué hace cada estado en la Agenda, en la etapa del lead y en el cierre del día", () => {
  const por = (n: string) => OPCIONES_POR_DEFECTO.estadoLlamada.find((o) => o.nombre === n)!;
  assert.deepEqual(queMueve(por("Compra Cuotas"), "estadoLlamada"), [
    "Marca la llamada como hecha en la Agenda",
    "Es una compra en cuotas: el cierre del día pide cargar la venta y, con la venta, el lead pasa a Inscripto",
  ]);
  assert.deepEqual(queMueve(por("NO Calificado"), "estadoLlamada"), [
    "Marca la llamada como hecha en la Agenda",
    "Pasa el lead a Perdido (salvo que ya haya comprado)",
    "El cierre del día pregunta por qué se perdió y si hizo la oferta",
  ]);
  assert.deepEqual(queMueve(por("Seguimiento Nutrición"), "estadoLlamada"), [
    "Marca la llamada como hecha en la Agenda",
    "El cierre del día pregunta por qué no cerró, si hizo la oferta y para cuándo lo estima",
  ]);
  assert.deepEqual(queMueve(por("Inasistió"), "estadoLlamada"), [
    "Marca que no vino en la Agenda", "Se pone sola cuando la llamada queda como que no vino",
  ]);
  assert.deepEqual(queMueve(por("Devolución"), "estadoLlamada"), ["Pasa el lead a Perdido aunque haya comprado"]);
  assert.deepEqual(queMueve(OPCIONES_POR_DEFECTO.estadoPreCall[1], "estadoPreCall"), ["En el cierre del día vale como «pidió otra fecha»: la agenda nueva entra sola"]);
  assert.deepEqual(queMueve(OPCIONES_POR_DEFECTO.estadoPreCall[0], "estadoPreCall"), [], "Confirmado es una etiqueta");
  assert.deepEqual(queMueve(OPCIONES_POR_DEFECTO.preCall[0], "preCall"), []);
});

/* ---------- La revisión antes de ocultar ---------- */

test("un estado suelto se oculta sin problema, y avisa cuántas llamadas lo tienen", () => {
  const r = revisarOcultar({ crm: undefined }, "estadoLlamada", "Califica Downsell", 3);
  assert.equal(r.bloquea, null);
  assert.deepEqual(r.avisos, ["3 llamadas lo tienen cargado: siguen mostrándolo igual, con su color."]);
  assert.equal(revisarOcultar({ crm: undefined }, "estadoLlamada", "Califica Downsell", 1).avisos[0], "Una llamada lo tiene cargado: siguen mostrándolo igual, con su color.");
  assert.deepEqual(revisarOcultar({ crm: undefined }, "estadoLlamada", "Califica Downsell", 0).avisos, []);
  assert.deepEqual(revisarOcultar({ crm: undefined }, "preCall", "1° Mje Enviado", 0), { mueve: [], bloquea: null, avisos: [], usos: 0 });
  /* Uno que no existe no mueve nada. */
  assert.equal(revisarOcultar({ crm: undefined }, "estadoLlamada", "No existe", 0).bloquea, null);
});

test("el último estado de compra, el último de seguimiento y «Reagendar» no se pueden ocultar: se rompería el cierre del día", () => {
  /* Compra: se pueden ocultar tres y el cuarto queda protegido. */
  const compras = ["Compra Full", "Compra Cuotas", "Reserva", "Compra Downsell"];
  assert.equal(revisarOcultar(ocultando("estadoLlamada", compras[0], compras[1], compras[2]), "estadoLlamada", compras[3]).bloquea?.includes("último estado de compra"), true);
  assert.equal(revisarOcultar(ocultando("estadoLlamada", compras[0], compras[1]), "estadoLlamada", compras[2]).bloquea, null, "quedan dos");
  /* Seguimiento. */
  const seguimientos = ["Seguimiento de Pago", "Seguimiento Nutrición", "Califica Downsell", "Llamada Interrumpida"];
  assert.equal(seguimientos.every((n) => preguntaDe(OPCIONES_POR_DEFECTO.estadoLlamada.find((o) => o.nombre === n)) === "seguimiento"), true);
  assert.equal(revisarOcultar(ocultando("estadoLlamada", ...seguimientos.slice(0, 3)), "estadoLlamada", seguimientos[3]).bloquea?.includes("último estado de seguimiento"), true);
  /* Reagendar. */
  const r = revisarOcultar({ crm: undefined }, "estadoPreCall", "Reagendar");
  assert.ok(r.bloquea?.includes("Reagendar"));
  assert.equal(revisarOcultar({ crm: undefined }, "estadoPreCall", "Sin Respuesta").bloquea, null);
  assert.equal(revisarOcultar({ crm: undefined }, "estadoPreCall", "Confirmado").bloquea, null);
});

test("ocultar una compra que tiene tipo propio avisa a cuál va a quedar la llamada cuando se cargue una venta de ese tipo", () => {
  const r = revisarOcultar({ crm: undefined }, "estadoLlamada", "Reserva");
  assert.equal(r.bloquea, null);
  assert.deepEqual(r.avisos, ["Las ventas con reserva van a dejar la llamada como «Compra Full»: ya no hay un estado de compra propio para ellas."]);
  assert.equal(revisarOcultar({ crm: undefined }, "estadoLlamada", "Compra Cuotas").avisos[0], "Las ventas en cuotas van a dejar la llamada como «Compra Full»: ya no hay un estado de compra propio para ellas.");
});

test("ocultar lo último que pasa un lead a Perdido, o que marca que no vino a mano, avisa; un «auto» avisa que se sigue poniendo solo", () => {
  /* Perdida: hay dos («Lead descartado» y «NO Calificado»); al ocultar el segundo ya no queda ninguno. */
  assert.deepEqual(revisarOcultar({ crm: undefined }, "estadoLlamada", "Lead descartado").avisos, []);
  const perdida = revisarOcultar(ocultando("estadoLlamada", "Lead descartado"), "estadoLlamada", "NO Calificado");
  assert.equal(perdida.bloquea, null);
  assert.ok(perdida.avisos.some((a) => a.startsWith("Ya no habría ningún estado de oportunidad perdida")));
  /* Devolución: es el único. */
  assert.ok(revisarOcultar({ crm: undefined }, "estadoLlamada", "Devolución").avisos.some((a) => a.startsWith("Ya no habría ningún estado de devolución")));
  /* No vino: «Dejó de Contestar» e «Inasistió» marcan que no vino; «Inasistió» es automático. */
  assert.equal(revisarOcultar({ crm: undefined }, "estadoLlamada", "Dejó de Contestar").avisos.length, 0);
  const inasistio = revisarOcultar({ crm: undefined }, "estadoLlamada", "Inasistió");
  assert.equal(inasistio.bloquea, null);
  assert.deepEqual(inasistio.avisos, ["Se sigue poniendo sola cuando corresponde; lo que cambia es que nadie podrá elegirla a mano."]);
  const sinNinguno = revisarOcultar(ocultando("estadoLlamada", "Dejó de Contestar"), "estadoLlamada", "Inasistió");
  assert.ok(sinNinguno.avisos.some((a) => a.startsWith("Ya no habría ningún estado que marque a mano que no vino")));
});

test("lo que pasa con el lead no cambia por ocultar: ocultar no toca las reglas de la etapa", () => {
  const ocultas = opcionesDe(ocultando("estadoLlamada", "NO Calificado", "Compra Full"), "estadoLlamada");
  const completas = OPCIONES_POR_DEFECTO.estadoLlamada;
  for (const nuevo of ["NO Calificado", "Devolución", "Compra Full", "Seguimiento Nutrición"]) {
    const a = { estado: "agendada" as const, estadoLlamada: undefined }, d = { estado: "hecha" as const, estadoLlamada: nuevo };
    assert.deepEqual(eventosDeLlamada(a, d, ocultas), eventosDeLlamada(a, d, completas), nuevo);
  }
});
