import test from "node:test";
import assert from "node:assert/strict";
import { aContactarHoy, CONFIG_POR_DEFECTO, filasDeSeguimiento, proximoConPausas, seguimientoVacio } from "@/lib/seguimiento";
import { filasClientes } from "@/lib/clientes-cs";
import type { EstadoApp, SeguimientoAlumno } from "@/lib/types";

/* Lo de Lili del 13/11: Marco Mazzetti (demora hasta el 21/11 y pausa del 22/11 al 22/12, y la ficha decía «en 15 días lo tenés que
   contactar») y Fernando Cabrera (reservó el 12/9, pagó todo el 27/9 y el Plan de pago seguía diciendo «Reserva»). Las dos fichas de
   Ignacio Lorenzo se unieron en la base (unificar_alumnos), sin código. */

const HOY = "2026-11-13";
const D = (desde: string, hasta: string) => ({ desde, hasta });

/* ---------- El próximo contacto con demora y pausas ---------- */

test("sin demora ni pausas el próximo es el que era", () => {
  assert.equal(proximoConPausas("2026-11-27", [], HOY), "2026-11-27");
});

test("Marco Mazzetti: la demora que corre hoy y la pausa que viene detrás: el próximo es el día en que retoma", () => {
  const marco = [D("2026-09-22", "2026-11-21"), D("2026-11-22", "2026-12-22")];
  assert.equal(proximoConPausas("2026-11-27", marco, HOY), "2026-12-22", "el contacto a los 15 días caía adentro de la pausa");
  /* El orden en que se cargaron no importa. */
  assert.equal(proximoConPausas("2026-11-27", [...marco].reverse(), HOY), "2026-12-22");
});

test("la pausa que corre hoy empuja cualquier contacto anterior a su fin; uno posterior queda", () => {
  const pausa = [D("2026-10-13", "2026-11-27")];
  assert.equal(proximoConPausas("2026-10-20", pausa, HOY), "2026-11-27", "Fernando: tocaba el 20/10, está pausado");
  assert.equal(proximoConPausas("2026-11-27", pausa, HOY), "2026-11-27", "el día que retoma, toca");
  assert.equal(proximoConPausas("2026-12-05", pausa, HOY), "2026-12-05");
});

test("una pausa que todavía no empezó sólo mueve el contacto que cae adentro, no el que toca antes ni después", () => {
  const viene = [D("2026-11-22", "2026-12-22")];
  assert.equal(proximoConPausas("2026-11-16", viene, HOY), "2026-11-16", "antes de la pausa: se le habla igual");
  assert.equal(proximoConPausas("2026-11-22", viene, HOY), "2026-12-22", "el primer día de la pausa ya no");
  assert.equal(proximoConPausas("2026-12-21", viene, HOY), "2026-12-22");
  assert.equal(proximoConPausas("2026-12-22", viene, HOY), "2026-12-22", "el día que retoma");
  assert.equal(proximoConPausas("2027-01-05", viene, HOY), "2027-01-05");
});

test("si al retomar cae en otra pausa, sigue hasta el fin de ésa; una cadena de tres también", () => {
  assert.equal(proximoConPausas("2026-11-20", [D("2026-11-18", "2026-12-01"), D("2026-12-01", "2026-12-20")], HOY), "2026-12-20");
  assert.equal(proximoConPausas("2026-11-14", [D("2026-11-10", "2026-11-20"), D("2026-11-20", "2026-12-05"), D("2026-12-05", "2026-12-15")], HOY), "2026-12-15");
});

/* ---------- En Clientes y en «A contactar hoy» ---------- */

const alumno = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: "2026-09-22T12:00:00.000Z", cohorte: "", plan: "", extra: {}, ...extra,
});
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), ...c });
const estado = (extra: Partial<EstadoApp>): EstadoApp => ({
  ajustes: {}, alumnos: [], seguimientos: [], leads: [], contactos: [], ventas: [], productos: [], cuotas: [], equipo: [], etapasServicio: [],
  reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [], pagos: [], ...extra,
} as unknown as EstadoApp);

const MARCO = seg("marco", {
  contratoFirmado: "Firmado", ultimoContacto: "2026-11-12", proximoContacto: "2026-11-27", cadenciaDias: 15, followUp: "No avanzando",
  pausas: [
    { id: "d", tipo: "demora", desde: "2026-09-22", hasta: "2026-11-21", motivo: "", creadoEn: "", creadoPor: "", autorizadoPor: "" },
    { id: "p", tipo: "pausa", desde: "2026-11-22", hasta: "2026-12-22", motivo: "", creadoEn: "", creadoPor: "", autorizadoPor: "" },
  ] as SeguimientoAlumno["pausas"],
});

test("Marco Mazzetti en la ficha (Clientes) y en la lista de seguimiento: toca el día que retoma, no a los 15 días", () => {
  const e = estado({ alumnos: [alumno("marco", "Marco Luciano Mazzetti")] as never, seguimientos: [MARCO] });
  assert.equal(filasClientes(e, HOY)[0].proximo, "2026-12-22");
  assert.equal(filasDeSeguimiento(e, HOY)[0].proximoContacto, "2026-12-22");
  /* El 27/11 (cuando le «tocaba» antes) no aparece en la lista de a quién contactar. */
  for (const dia of ["2026-11-27", "2026-12-01", "2026-12-21"]) assert.equal(aContactarHoy(filasDeSeguimiento(e, dia)).length, 0, dia);
  /* El día que retoma, sí. */
  assert.equal(aContactarHoy(filasDeSeguimiento(e, "2026-12-22")).length, 1);
  assert.equal(filasClientes(e, "2026-12-22")[0].situacion, "hoy");
});

test("la lista de seguimiento y Clientes dicen lo mismo del que está pausado y se pasó (antes sólo Clientes lo sabía)", () => {
  const pausado = seg("pausado", { contratoFirmado: "Firmado", ultimoContacto: "2026-10-01", pausas: [{ id: "p", tipo: "pausa", desde: "2026-10-10", hasta: "2026-11-27", motivo: "", creadoEn: "", creadoPor: "", autorizadoPor: "" }] as SeguimientoAlumno["pausas"] });
  const e = estado({ alumnos: [alumno("pausado", "Pausado")] as never, seguimientos: [pausado] });
  assert.equal(aContactarHoy(filasDeSeguimiento(e, HOY)).length, 0, "no figura vencido mientras está en pausa");
  assert.equal(filasClientes(e, HOY)[0].proximo, filasDeSeguimiento(e, HOY)[0].proximoContacto);
});

/* ---------- Fernando Cabrera: el Plan de pago que decía «Reserva» ---------- */

const venta = { id: "v1", contactoId: "l1", productoId: "p1", estado: "activa", fecha: "2026-09-12T15:00:00.000Z", closerId: "", contactoNombre: "Fernando" };
const cuota = (n: number, monto: number, esReserva: boolean, estado = "pagada") => ({ id: `c${n}`, ventaId: "v1", numero: n, monto, esReserva, estado, vence: "2026-09-12T15:00:00.000Z" });
const conPlan = (planDePago: string, cuotas: ReturnType<typeof cuota>[], followUp = "") => estado({
  alumnos: [alumno("fer", "Fernando Cabrera", { ventaId: "v1", leadId: "l1", inicio: "2026-09-27T12:00:00.000Z" })] as never,
  seguimientos: [seg("fer", { planDePago, followUp, contratoFirmado: "Firmado" })],
  ventas: [venta] as never, productos: [{ id: "p1", nombre: "Hackear AI", tipo: "principal" }] as never, cuotas: cuotas as never,
});

test("reservó y después pagó todo: el «Reserva» a secas del Plan de pago se muestra con lo que dicen sus cuotas", () => {
  const f = filasClientes(conPlan("Reserva", [cuota(0, 200, true), cuota(1, 2300, false)]), HOY)[0];
  assert.equal(f.enReserva, false);
  assert.equal(f.plan, "Pago único + reserva");
  assert.equal(f.planSugerido, true, "sale como sugerido (lo que dicen las cuotas), no como algo que Lili escribió");
});

test("si todavía es sólo la reserva, o el plan está escrito de otra forma, o el Follow Up dice Reserva: no se toca", () => {
  const soloReserva = filasClientes(conPlan("Reserva", [cuota(0, 200, true), cuota(1, 2300, false, "pendiente")]), HOY)[0];
  assert.equal(soloReserva.enReserva, true);
  assert.equal(soloReserva.plan, "Reserva", "todavía no completó");
  assert.equal(filasClientes(conPlan("Reserva + 3 cuotas de 500", [cuota(0, 200, true), cuota(1, 2300, false)]), HOY)[0].plan, "Reserva + 3 cuotas de 500");
  const porFollowUp = filasClientes(conPlan("Reserva", [cuota(0, 200, true), cuota(1, 2300, false)], "Reserva"), HOY)[0];
  assert.equal(porFollowUp.enReserva, true);
  assert.equal(porFollowUp.plan, "Reserva");
  /* Sin cuotas cargadas (pagó por fuera de la app) no hay con qué reemplazarlo: queda lo que se escribió. */
  assert.equal(filasClientes(conPlan("Reserva", []), HOY)[0].plan, "Reserva");
  /* Un plan que ya estaba bien no cambia. */
  assert.equal(filasClientes(conPlan("1 x 3000 USD", [cuota(1, 3000, false)]), HOY)[0].plan, "1 x 3000 USD");
});
