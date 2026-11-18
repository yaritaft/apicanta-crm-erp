import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acciones } from "@/lib/store";
import { estadoVacio } from "@/lib/seed";
import { planParaCompletar, problemaDeCompletar, reservaSinCompletar, reservaSuelta, reservasSueltasDe } from "@/lib/reservas";
import { indiceDeReservas } from "@/lib/reservas";
import type { Alumno, Cuota, EstadoApp, Lead, Movimiento, Pago, Sesion, Venta } from "@/lib/types";

/* Aldana, 18/11 (Carlos Juca): dejó US$ 400 de reserva de Hackear AI el 16/11 y al otro día pagó los 2.600 que faltaban. La venta
   de la reserva valía 400 y no tenía cuotas por cobrar, así que no había por dónde cargarle el resto: el closer cargó OTRA venta
   de 3.000 con la reserva adentro (a mano, por segunda vez) y quedaron 3.400 cobrados. Ahora la reserva se completa sobre la misma
   venta, y el asistente avisa antes de cargar otra. */

const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const TIPO = "Llamada de Asesoramiento - Webinar - Team";

const LEAD: Lead = {
  id: "con_juca", nombre: "Carlos Juca", email: "juca@example.com", telefono: "+593 997498206", fuente: "Webinar", etapaId: "et_inscripto",
  monto: 400, moneda: "USD", responsable: "", etiquetas: [], creadoEn: "2026-11-11T23:19:00Z", actualizadoEn: "2026-11-16T21:05:00Z", extra: {},
} as unknown as Lead;
const LLAMADA: Sesion = {
  id: "cal_juca", titulo: TIPO, tipo: TIPO, invitado: "Carlos Juca", leadId: "con_juca", inicia: "2026-11-16T20:00:00Z", duracionMin: 45,
  estado: "hecha", origen: "calendly", creadoEn: "2026-11-12T12:00:00Z", extra: {}, anfitrion: "Valentín Abadía", estadoLlamada: "Reserva",
} as unknown as Sesion;
const RESERVA: Venta = {
  id: "ven_reserva", contactoId: "con_juca", contactoNombre: "Carlos Juca", productoId: "prod_hackear_ai", precioAcordado: 400, moneda: "USD",
  excluidoMarketing: false, estado: "activa", fecha: "2026-11-16T21:03:03Z", creadoEn: "2026-11-16T21:05:51Z", extra: {}, notas: "", sesionId: "cal_juca",
} as unknown as Venta;
const CUOTA_RESERVA: Cuota = { id: "cuo_reserva", ventaId: "ven_reserva", numero: 0, monto: 400, vence: "2026-11-16T21:03:03Z", estado: "pagada", esReserva: true };
const PAGO_RESERVA: Pago = {
  id: "pag_reserva", cuotaId: "cuo_reserva", procesadorId: "proc_stripe", monto: 400, moneda: "USD", feeRate: 0, feeMonto: 17.9,
  fecha: "2026-11-16T21:02:22Z", creadoEn: "2026-11-16T21:05:51Z", movimientoId: "mov_reserva", chequeado: true,
} as unknown as Pago;
const MOV_RESTO: Movimiento = {
  id: "mov_resto", proveedor: "stripe", procesadorId: "proc_stripe", referencia: "ch_resto", monto: 2600, moneda: "USD", fee: 114.7, neto: 2485.3,
  fecha: "2026-11-17T18:42:07Z", clienteNombre: "Carlos Juca", clienteEmail: "juca@example.com", estado: "pendiente",
} as unknown as Movimiento;
const ALUMNO: Alumno = {
  id: "alu_juca", nombre: "Carlos Juca", email: "juca@example.com", cohorte: "", plan: "Hackear AI", cuotaMensual: 0, moneda: "USD", estado: "activo",
  inicio: "2026-11-16T21:03:03Z", progreso: 0, notas: "", creadoEn: "2026-11-16T21:05:51Z", extra: {}, ventaId: "ven_reserva", leadId: "con_juca",
} as unknown as Alumno;

function armar(over: Partial<EstadoApp> = {}) {
  const e = {
    ...estadoVacio(), leads: [LEAD], sesiones: [LLAMADA], ventas: [RESERVA], cuotas: [CUOTA_RESERVA], pagos: [PAGO_RESERVA],
    movimientos: [MOV_RESTO], alumnos: [ALUMNO], actividad: [], ...over,
  } as unknown as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}
const cobradoDe = (e: EstadoApp, ventaId: string) => {
  const ids = new Set(e.cuotas.filter((c) => c.ventaId === ventaId).map((c) => c.id));
  return e.pagos.filter((p) => ids.has(p.cuotaId)).reduce((t, p) => t + p.monto, 0);
};

/* ---------- Qué es una reserva suelta ---------- */

test("una venta que vale sólo la reserva, ya pagada y sin nada más por cobrar, es una reserva suelta", () => {
  const r = reservaSuelta(RESERVA, [CUOTA_RESERVA]);
  assert.ok(r);
  assert.equal(r.pagado, 400);
  assert.deepEqual(r.cobradas.map((c) => c.id), ["cuo_reserva"]);
});

test("con cuotas del programa por cobrar no es suelta: ahí el pago se carga en su cuota, como siempre", () => {
  const pendiente: Cuota = { id: "c1", ventaId: "ven_reserva", numero: 1, monto: 2600, estado: "pendiente", esReserva: false };
  assert.equal(reservaSuelta({ ...RESERVA, precioAcordado: 3000 }, [CUOTA_RESERVA, pendiente]), null);
  /* Sigue siendo una reserva sin completar para Servicio. */
  assert.deepEqual(reservaSinCompletar([CUOTA_RESERVA, pendiente]), { pagado: 400, falta: 2600 });
});

test("una cuota en cero colgando (Ramiro Bogado, 13/11) no la saca de suelta; una venta de baja o ya con un pago del programa, sí", () => {
  const enCero: Cuota = { id: "c0", ventaId: "ven_reserva", numero: 1, monto: 0, estado: "pendiente", esReserva: false };
  assert.ok(reservaSuelta(RESERVA, [CUOTA_RESERVA, enCero]));
  assert.equal(reservaSuelta({ ...RESERVA, estado: "cancelada" }, [CUOTA_RESERVA]), null);
  const pagada: Cuota = { id: "c1", ventaId: "ven_reserva", numero: 1, monto: 2600, estado: "pagada", esReserva: false };
  assert.equal(reservaSuelta(RESERVA, [CUOTA_RESERVA, pagada]), null);
  /* Una venta común sin reserva tampoco. */
  assert.equal(reservaSuelta(RESERVA, [{ ...pagada, monto: 400 }]), null);
});

test("las reservas sueltas de una persona se encuentran por su ficha, su mail o su teléfono; las de otra persona no", () => {
  armar();
  const e = hoy();
  assert.deepEqual(reservasSueltasDe(e, { contactoId: "con_juca" }).map((r) => r.venta.id), ["ven_reserva"]);
  assert.deepEqual(reservasSueltasDe(e, { email: "JUCA@example.com" }).map((r) => r.venta.id), ["ven_reserva"]);
  assert.deepEqual(reservasSueltasDe(e, { telefono: "0997498206" }).map((r) => r.venta.id), ["ven_reserva"]);
  assert.deepEqual(reservasSueltasDe(e, { contactoId: "con_otra", nombre: "Carla Jara" }), []);
  /* Sin nadie elegido todavía (el buscador vacío) no propone nada. */
  assert.deepEqual(reservasSueltasDe(e, {}), []);
});

/* ---------- Completarla: una sola venta ---------- */

test("Carlos Juca: completar la reserva deja UNA venta de 3.000 con 3.000 cobrados (no 3.400) y el pago de la pasarela conciliado", () => {
  armar();
  const r = acciones.completarReserva({
    ventaId: "ven_reserva", precioAcordado: 3000,
    cuotas: [{ id: "cuo_resto", monto: 2600, vence: "2026-11-17T15:00:00Z" }],
    cobros: [{ cuotaId: "cuo_resto", procesadorId: "proc_stripe", monto: 2600, fecha: "2026-11-17T18:42:07Z", movimientoId: "mov_resto" }],
    notas: "Completó la reserva",
  });
  assert.deepEqual(r, { ok: true });
  const e = hoy();
  assert.equal(e.ventas.length, 1, "no nace otra venta");
  const v = e.ventas[0];
  assert.equal(v.id, "ven_reserva");
  assert.equal(v.precioAcordado, 3000);
  assert.equal(v.fecha, RESERVA.fecha, "conserva la fecha del día que cerró con la reserva");
  assert.equal(v.notas, "Completó la reserva");
  assert.equal((v.extra.reservaCompletada as { valia: number }).valia, 400);
  const cuotas = e.cuotas.filter((c) => c.ventaId === v.id).sort((a, b) => a.numero - b.numero);
  assert.deepEqual(cuotas.map((c) => [c.numero, c.monto, c.estado, c.esReserva]), [[0, 400, "pagada", true], [1, 2600, "pagada", false]]);
  assert.equal(cobradoDe(e, v.id), 3000);
  /* La reserva cobrada no se tocó. */
  assert.deepEqual(e.pagos.find((p) => p.id === "pag_reserva"), JSON.parse(JSON.stringify(PAGO_RESERVA)));
  const nuevo = e.pagos.find((p) => p.cuotaId === "cuo_resto")!;
  assert.equal(nuevo.movimientoId, "mov_resto");
  assert.equal(nuevo.feeMonto, 114.7, "la comisión es la real de la pasarela");
  assert.equal(e.movimientos.find((m) => m.id === "mov_resto")!.estado, "conciliado");
  /* Ya no es una reserva: ni suelta ni sin completar. */
  assert.equal(reservaSuelta(v, cuotas), null);
  assert.equal(reservaSinCompletar(cuotas), null);
});

test("con el primer pago del programa el alumno deja de ser reserva y arranca ese día; la llamada pasa de «Reserva» a compra", () => {
  armar();
  acciones.completarReserva({
    ventaId: "ven_reserva", precioAcordado: 3000,
    cuotas: [{ id: "cuo_resto", monto: 2600, vence: "2026-11-17T15:00:00Z" }],
    cobros: [{ cuotaId: "cuo_resto", procesadorId: "proc_stripe", monto: 2600, fecha: "2026-11-17T18:42:07Z", movimientoId: "mov_resto" }],
  });
  const e = hoy();
  const a = e.alumnos.find((x) => x.id === "alu_juca")!;
  assert.equal(a.ventaId, "ven_reserva");
  assert.equal(a.inicio, "2026-11-17T18:42:07Z");
  assert.equal(indiceDeReservas(e.cuotas)(a), false, "Servicio ya no lo ve como reserva");
  assert.equal(e.sesiones.find((s) => s.id === "cal_juca")!.estadoLlamada, "Compra Full");
  assert.ok(e.actividad.some((x) => x.entidadId === "ven_reserva" && /completó la reserva: la venta pasó de 400 a 3000/.test(x.detalle)));
});

test("en cuotas, con sólo la primera pagada: queda una venta con lo que falta por cobrar, y la llamada en «Compra Cuotas»", () => {
  armar();
  acciones.completarReserva({
    ventaId: "ven_reserva", precioAcordado: 3000,
    cuotas: [{ id: "c1", monto: 1300, vence: "2026-11-17T15:00:00Z" }, { id: "c2", monto: 1300, vence: "2026-12-17T15:00:00Z" }],
    cobros: [{ cuotaId: "c1", procesadorId: "proc_stripe", monto: 1300, fecha: "2026-11-17T18:00:00Z" }],
  });
  const e = hoy();
  const cuotas = e.cuotas.filter((c) => c.ventaId === "ven_reserva").sort((a, b) => a.numero - b.numero);
  assert.deepEqual(cuotas.map((c) => [c.numero, c.monto, c.estado]), [[0, 400, "pagada"], [1, 1300, "pagada"], [2, 1300, "pendiente"]]);
  assert.equal(cobradoDe(e, "ven_reserva"), 1700);
  assert.equal(e.sesiones[0].estadoLlamada, "Compra Cuotas");
});

test("si todavía no pagó nada del programa, se arma el plan pero sigue siendo reserva: no arranca ni cambia la llamada", () => {
  armar();
  const r = acciones.completarReserva({
    ventaId: "ven_reserva", precioAcordado: 3000,
    cuotas: [{ id: "c1", monto: 2600, vence: "2026-11-25T15:00:00Z" }], cobros: [],
  });
  assert.deepEqual(r, { ok: true });
  const e = hoy();
  assert.equal(e.ventas[0].precioAcordado, 3000);
  assert.deepEqual(reservaSinCompletar(e.cuotas.filter((c) => c.ventaId === "ven_reserva")), { pagado: 400, falta: 2600 });
  assert.equal(e.alumnos[0].inicio, ALUMNO.inicio);
  assert.equal(e.sesiones[0].estadoLlamada, "Reserva");
  /* Y ya no es suelta: lo que sigue es cargar el pago en su cuota. */
  assert.deepEqual(reservasSueltasDe(e, { contactoId: "con_juca" }), []);
});

test("un estado de llamada que alguien puso a mano no se pisa", () => {
  armar({ sesiones: [{ ...LLAMADA, estadoLlamada: "Seguimiento de Pago" }] } as Partial<EstadoApp>);
  acciones.completarReserva({
    ventaId: "ven_reserva", precioAcordado: 3000, cuotas: [{ id: "c1", monto: 2600, vence: "2026-11-17T15:00:00Z" }],
    cobros: [{ cuotaId: "c1", procesadorId: "proc_stripe", monto: 2600, fecha: "2026-11-17T18:00:00Z" }],
  });
  assert.equal(hoy().sesiones[0].estadoLlamada, "Seguimiento de Pago");
});

test("reservó un programa y al final entra al Downsell: cambia el servicio de la venta y el plan del alumno", () => {
  armar();
  acciones.completarReserva({
    ventaId: "ven_reserva", productoId: "prod_downsell", precioAcordado: 500,
    cuotas: [{ id: "c1", monto: 100, vence: "2026-11-17T15:00:00Z" }],
    cobros: [{ cuotaId: "c1", procesadorId: "proc_stripe", monto: 100, fecha: "2026-11-17T18:00:00Z" }],
  });
  const e = hoy();
  assert.equal(e.ventas[0].productoId, "prod_downsell");
  assert.equal(e.ventas[0].precioAcordado, 500);
  assert.equal(e.alumnos[0].plan, "Downsell");
  assert.equal(e.sesiones[0].estadoLlamada, "Compra Downsell");
});

test("la cuota en cero que colgaba de la reserva se reemplaza por el plan nuevo, sin dejar una cuota fantasma", () => {
  const enCero: Cuota = { id: "c0", ventaId: "ven_reserva", numero: 1, monto: 0, estado: "pendiente", esReserva: false };
  armar({ cuotas: [CUOTA_RESERVA, enCero] } as Partial<EstadoApp>);
  acciones.completarReserva({ ventaId: "ven_reserva", precioAcordado: 3000, cuotas: [{ id: "c1", monto: 2600, vence: "2026-11-25T15:00:00Z" }], cobros: [] });
  const cuotas = hoy().cuotas.filter((c) => c.ventaId === "ven_reserva").sort((a, b) => a.numero - b.numero);
  assert.deepEqual(cuotas.map((c) => [c.id, c.numero, c.monto]), [["cuo_reserva", 0, 400], ["c1", 1, 2600]]);
});

/* ---------- Lo que no se deja ---------- */

test("no se completa por un valor que no supera la reserva, ni con cuotas que no suman lo que falta, ni una venta de baja", () => {
  armar();
  const pedir = (precioAcordado: number, monto: number) =>
    acciones.completarReserva({ ventaId: "ven_reserva", precioAcordado, cuotas: [{ id: "c1", monto, vence: "2026-11-25T15:00:00Z" }], cobros: [] });
  assert.match((pedir(400, 0) as { error: string }).error, /mayor que lo que ya pagó/);
  assert.match((pedir(3000, 3000) as { error: string }).error, /suman 3000 y lo que falta es 2600/);
  assert.match((acciones.completarReserva({ ventaId: "no_existe", precioAcordado: 3000, cuotas: [], cobros: [] }) as { error: string }).error, /No encuentro/);
  /* Nada cambió. */
  const e = hoy();
  assert.equal(e.ventas[0].precioAcordado, 400);
  assert.equal(e.cuotas.length, 1);

  assert.equal(problemaDeCompletar({ ...RESERVA, estado: "cancelada" }, [CUOTA_RESERVA], [PAGO_RESERVA], { precio: 3000, cuotas: [{ id: "c1", monto: 2600 }] }), "Esa venta está dada de baja: primero hay que reactivarla.");
  assert.equal(problemaDeCompletar(RESERVA, [CUOTA_RESERVA], [PAGO_RESERVA], { precio: 3000, cuotas: [{ id: "c1", monto: 2600 }] }), null);
});

test("el plan numera las cuotas nuevas después de las que quedan y no toca lo cobrado", () => {
  const plan = planParaCompletar(RESERVA, [CUOTA_RESERVA], [PAGO_RESERVA], {
    precio: 3000, cuotas: [{ id: "a", monto: 1000, vence: "2026-11-20T15:00:00Z" }, { id: "b", monto: 1600, vence: "2026-12-20T15:00:00Z" }],
  });
  assert.deepEqual(plan.quedan.map((c) => c.id), ["cuo_reserva"]);
  assert.deepEqual(plan.quitadas, []);
  assert.deepEqual(plan.nuevas.map((c) => [c.id, c.numero, c.monto, c.estado, c.esReserva, c.ventaId]),
    [["a", 1, 1000, "pendiente", false, "ven_reserva"], ["b", 2, 1600, "pendiente", false, "ven_reserva"]]);
  assert.equal(plan.cobrado, 400);
  assert.equal(plan.falta, 2600);
});

/* ---------- El asistente: avisa y frena antes de cargar otra venta ---------- */

test("el asistente de venta avisa de la reserva al elegir a la persona, no deja registrar otra venta sin decir que es otra compra, y completa sobre la misma", () => {
  const asistente = readFileSync(new URL("../src/components/ventas/AsistenteVenta.tsx", import.meta.url), "utf8");
  /* El aviso sale en el paso del cliente, al abrir desde la ficha y en el resumen (ahí con el «es otra compra»). */
  assert.equal(asistente.match(/<AvisoReservaSuelta /g)?.length, 3);
  assert.match(asistente, /ctx\.conReservaSuelta\) return "Ya dejó una reserva: completala, o marcá que es otra compra"/);
  /* Completar no pasa por registrarVenta. */
  assert.match(asistente, /if \(completarId\) \{ guardarCompletada\(completarId\); return; \}/);
  assert.match(asistente, /acciones\.completarReserva\(/);
  /* En el paso de cobros la reserva ya cargada no se puede volver a cargar. */
  assert.match(asistente, /La reserva ya está cargada: no la vuelvas a cargar/);

  const aviso = readFileSync(new URL("../src/components/ventas/AvisoReservaSuelta.tsx", import.meta.url), "utf8");
  assert.match(aviso, /Completar esta reserva/);
  assert.match(aviso, /no cargues una venta nueva/);

  /* Y en la ficha, la venta que es sólo la reserva lo dice y tiene el botón. */
  const tarjeta = readFileSync(new URL("../src/components/ficha/TarjetaVenta.tsx", import.meta.url), "utf8");
  assert.match(tarjeta, /Completar la reserva · pagó lo que faltaba/);
  assert.match(tarjeta, /Es sólo la reserva: todavía no entró al programa/);
});
