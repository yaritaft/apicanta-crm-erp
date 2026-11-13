import test from "node:test";
import assert from "node:assert/strict";
import { motivoSinPagoDelPrograma, soloSeCobroLaReserva } from "@/lib/accesos-minimo";
import { datosDeVenta } from "@/components/contratos/cliente";
import { plantillaDelContrato, programaDeProducto, programasDe } from "@/lib/programas";
import { OPCIONES_POR_DEFECTO } from "@/lib/crm";
import { CANCELADA, desenlaceDe, estadoDe, estadoDeAgenda, NO_SE_PRESENTO, preguntaDe, queMueve, queMueveCorto, REPROGRAMO } from "@/lib/estados";
import { construirSemilla } from "@/lib/seed";
import type { Cuota, Venta } from "@/lib/types";

/* Lo del 13/11: Ramiro Bogado (una reserva de US$ 129 del Downsell) recibió el contrato del Downsell y los accesos, y Mariano
   pidió «Reagendó» entre los Estados de Llamada. */

/* ---------- Una venta que es sólo la reserva no se cobró del programa ---------- */

test("una venta de sólo la reserva, con una cuota, espera los accesos y dice cuánto pagó", () => {
  assert.match(
    motivoSinPagoDelPrograma([{ id: "r", monto: 129, esReserva: true }], [{ cuotaId: "r", monto: 129 }]) ?? "",
    /^Sólo pagó la reserva \(US\$ 129\): los accesos se dan solos/,
  );
  assert.equal(motivoSinPagoDelPrograma([{ id: "r", monto: 129, esReserva: true }], []), null, "sin pagos no hay evidencia");
  assert.equal(motivoSinPagoDelPrograma([{ id: "p", monto: 129, esReserva: false }], [{ cuotaId: "p", monto: 129 }]), null, "un pago único no es reserva");
});

test("en la carga: precio igual a la reserva (la cuota que queda es de 0) también es «sólo la reserva»", () => {
  const l = (esReserva: boolean, monto: number, cobros = 0) => ({ esReserva, monto, cobros: Array.from({ length: cobros }, () => ({})) });
  assert.equal(soloSeCobroLaReserva([l(true, 129, 1), l(false, 0)]), true);
  assert.equal(soloSeCobroLaReserva([l(true, 129, 1)]), true);
  assert.equal(soloSeCobroLaReserva([l(true, 129), l(false, 0)]), false, "sin cobro cargado no se sabe");
  assert.equal(soloSeCobroLaReserva([l(true, 129, 1), l(false, 371, 1)]), false, "ya pagó algo del programa");
});

/* El Downsell de producción no tiene contrato de reserva (sólo Hackear AI lo tiene): antes, la venta de sólo la reserva caía al
   contrato del programa; ahora sigue siendo una reserva y la ficha avisa que falta la plantilla. */
test("la venta de sólo la reserva de un programa sin contrato de reserva sigue siendo una reserva (no cae al contrato del programa)", () => {
  const e = construirSemilla();
  const venta = { id: "ven_r", contactoId: "lead_r", contactoNombre: "Ramiro B.", productoId: "prod_downsell", moneda: "USD", precioAcordado: 129 } as Venta;
  const cuotas = [{ id: "c0", ventaId: "ven_r", numero: 0, monto: 129, esReserva: true, estado: "pagada" }] as Cuota[];
  const programas = programasDe(e.ajustes);
  const programa = programaDeProducto(programas, "prod_downsell")!;
  assert.equal(programa.id, "downsell");
  assert.equal(plantillaDelContrato(programa, true).id, "", "el Downsell no tiene contrato de reserva");

  const d = datosDeVenta({ ...e, cuotas: [...e.cuotas, ...cuotas] }, venta);
  assert.equal(d.datos.reserva, true, "antes salía sin la marca y con «Un pago único de 129 USD»");
  assert.match(d.datos.modalidad, /129/);
  assert.doesNotMatch(d.datos.modalidad, /pago único/i);

  /* Una venta con plan de verdad sigue siendo del programa. */
  const plan = [...cuotas, { id: "c1", ventaId: "ven_r", numero: 1, monto: 371, esReserva: false, estado: "pendiente" }] as Cuota[];
  const conPlan = datosDeVenta({ ...e, cuotas: [...e.cuotas, ...plan] }, venta);
  assert.equal(conPlan.datos.reserva, undefined);
});

/* ---------- «Reagendó» entre los Estados de Llamada ---------- */

const reagendo = OPCIONES_POR_DEFECTO.estadoLlamada.find((o) => o.nombre === "Reagendó");

test("«Reagendó» está entre las opciones del closer, sin mover la agenda ni abrir una pregunta del cierre del día", () => {
  assert.ok(reagendo, "Mariano: «tendría que estar Reagendó»");
  assert.equal(reagendo!.llamada, undefined, "no la marca hecha ni que no vino");
  assert.equal(reagendo!.oportunidad, undefined, "no mueve la etapa del lead");
  assert.equal(preguntaDe(reagendo), "nada");
  assert.equal(new Set(OPCIONES_POR_DEFECTO.estadoLlamada.map((o) => o.nombre)).size, OPCIONES_POR_DEFECTO.estadoLlamada.length, "sin repetidas");
});

test("«Reagendó» no cambia cómo está la agenda y, en una agendada, cuenta como «pidió otra fecha»", () => {
  const opciones = OPCIONES_POR_DEFECTO.estadoLlamada;
  const base = { estado: "no-show" as const, estadoLlamada: undefined, estadoPreCall: undefined, resultado: undefined, inicia: "2026-11-10T15:00:00.000Z" };
  assert.equal(estadoDeAgenda({ estado: "agendada", estadoLlamada: undefined, canceladaEn: undefined }, "Reagendó", opciones), undefined);
  assert.equal(desenlaceDe(base, undefined, { venta: false, paso: true }), NO_SE_PRESENTO, "sin estado cargado: Calendly la dio por no-show");
  /* Va en el lugar de «Reagendar» del Pre-Call: una agenda que Calendly ya dio por no-show o cancelada sigue contando como tal. */
  assert.equal(desenlaceDe(base, reagendo, { venta: false, paso: true }), NO_SE_PRESENTO);
  assert.equal(desenlaceDe({ ...base, estado: "cancelada" }, reagendo, { venta: false, paso: true }), CANCELADA);
  /* En una agenda que sigue como «agendada» (la persona avisó antes de la hora), es «pidió otra fecha». */
  const agendada = { ...base, estado: "agendada" as const };
  assert.equal(desenlaceDe(agendada, reagendo, { venta: false, paso: true }), REPROGRAMO, "con «Reagendó»: pidió otra fecha");
  assert.equal(desenlaceDe(agendada, reagendo, { venta: false, paso: false }), REPROGRAMO);
  const ver = estadoDe({ ...agendada, estadoLlamada: "Reagendó" }, { opciones, ahora: Date.parse("2026-11-13T00:00:00Z") });
  assert.equal(ver.texto, "Reagendó");
  assert.equal(ver.desenlace, REPROGRAMO);
  assert.equal(ver.sinCargar, false);
});

test("Ajustes explica qué hace «Reagendó»", () => {
  assert.match(queMueve(reagendo!, "estadoLlamada").join(" "), /otra fecha/);
  assert.deepEqual(queMueveCorto(reagendo!, "estadoLlamada"), ["Vale como otra fecha"]);
});
