import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { estadoVacio } from "@/lib/seed";
import { indiceDeReservas } from "@/lib/reservas";
import type { Alumno, Cuota, EstadoApp, Venta } from "@/lib/types";

/* Lili, 17/11 (Alan Vargas): la reserva quedó en una venta y lo que faltaba en otra; Finanzas canceló la primera por repetida y el
   alumno siguió atado a esa: Servicio lo veía de baja y, al volver a «Activo», como una reserva que nunca arranca (no la podía
   corregir). Ahora, si la persona tiene otra venta activa, el servicio pasa a ella en vez de a baja. */

const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const venta = (id: string, fecha: string, estado: Venta["estado"] = "activa", contactoId = "con_alan"): Venta => ({
  id, contactoId, contactoNombre: "Alan Vargas", productoId: "prod_dp", estado, fecha, moneda: "USD", precioAcordado: 937.5, extra: {},
} as unknown as Venta);
const cuota = (id: string, ventaId: string, over: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId, numero: 0, monto: 62.5, vence: "2026-11-14T22:08:00Z", estado: "pagada", esReserva: true, ...over }) as Cuota;
const alumno = (over: Partial<Alumno> = {}): Alumno => ({
  id: "alu_alan", nombre: "Alan Vargas", email: "alan@example.com", cohorte: "", plan: "Downsell Plus+", cuotaMensual: 0, moneda: "USD",
  estado: "activo", inicio: "2026-11-14T22:08:00Z", progreso: 0, notas: "", creadoEn: "2026-11-14T22:20:00Z", extra: {}, etapaServicioId: "ets_nueva",
  ventaId: "ven_reserva", leadId: "con_alan", ...over,
} as unknown as Alumno);

function armar(ventas: Venta[], alumnos: Alumno[] = [alumno()]) {
  const e = {
    ...estadoVacio(), ventas, alumnos, actividad: [],
    cuotas: [cuota("c_res", "ven_reserva"), cuota("c_resto", "ven_resto", { numero: 1, esReserva: false, monto: 937.5 })],
  } as unknown as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}

test("al cancelar la venta de la reserva, el alumno pasa a la otra venta activa de la persona (no a baja)", () => {
  armar([venta("ven_reserva", "2026-11-14T22:08:00Z"), venta("ven_resto", "2026-11-16T16:20:00Z")]);
  acciones.actualizar<Venta>("ventas", "ven_reserva", { estado: "cancelada" }, "Alan Vargas", "Se canceló la venta de Alan Vargas.");
  const a = hoy().alumnos.find((x) => x.id === "alu_alan")!;
  assert.equal(a.ventaId, "ven_resto", "queda en la venta que sigue");
  assert.equal(a.estado, "activo", "no pasa a baja");
  /* Con eso ya no figura como una reserva sin completar. */
  const e = hoy();
  assert.equal(indiceDeReservas(e.cuotas)(a), false);
});

test("si no hay otra venta activa, sigue pasando a baja como siempre", () => {
  armar([venta("ven_reserva", "2026-11-14T22:08:00Z"), venta("ven_otra_persona", "2026-11-16T16:20:00Z", "activa", "con_otra")]);
  acciones.actualizar<Venta>("ventas", "ven_reserva", { estado: "cancelada" }, "Alan Vargas", "Se canceló la venta de Alan Vargas.");
  const a = hoy().alumnos.find((x) => x.id === "alu_alan")!;
  assert.equal(a.estado, "baja");
  assert.equal(a.ventaId, "ven_reserva");
});

test("elige la más reciente si hay varias, y no toma una cancelada", () => {
  armar([
    venta("ven_reserva", "2026-11-14T22:08:00Z"), venta("ven_vieja", "2026-11-10T10:00:00Z"),
    venta("ven_resto", "2026-11-16T16:20:00Z"), venta("ven_cancelada", "2026-11-17T10:00:00Z", "cancelada"),
  ]);
  acciones.actualizar<Venta>("ventas", "ven_reserva", { estado: "cancelada" }, "Alan Vargas");
  assert.equal(hoy().alumnos.find((x) => x.id === "alu_alan")!.ventaId, "ven_resto");
});

test("si la venta cancelada se reactiva, el alumno vuelve a ella", () => {
  armar([venta("ven_reserva", "2026-11-14T22:08:00Z"), venta("ven_resto", "2026-11-16T16:20:00Z")]);
  acciones.actualizar<Venta>("ventas", "ven_reserva", { estado: "cancelada" }, "Alan Vargas");
  acciones.actualizar<Venta>("ventas", "ven_reserva", { estado: "activa" }, "Alan Vargas");
  const a = hoy().alumnos.find((x) => x.id === "alu_alan")!;
  assert.equal(a.ventaId, "ven_reserva");
  assert.equal(a.extra?.ventaAntesDeLaBaja, undefined);
  assert.equal(a.estado, "activo");
});
