import test from "node:test";
import assert from "node:assert/strict";
import { precioDeLista, reservaSinCompletar, reservaSuelta, indiceDeReservas } from "@/lib/reservas";
import { indiceDeSituaciones } from "@/lib/situacion-alumno";
import { filasClientes } from "@/lib/clientes-cs";
import { motivoSinPagoDelPrograma } from "@/lib/accesos-minimo";
import { construirSemilla } from "@/lib/seed";
import type { Alumno, Cuota, EstadoApp, Producto, Venta } from "@/lib/types";

/* ==================================================================
   Liliana, 27/11: «Leonardo Beltrán (alumno súper viejo) tiene cargado programa Downsell y en estado: reserva. Tiene accesos como
   Downsell». Pagó US$ 500 de un Downsell que vale 497 en una sola cuota, y esa cuota venía marcada como reserva de la planilla vieja:
   la regla veía «sólo pagó la reserva» sin mirar que ya cubría el programa. Ahora una «reserva» que cubre el precio de lista del
   producto es el pago entero, en todos lados (situación, Clientes, ficha, completar la reserva, accesos). Nombres inventados.
   ================================================================== */

const cuota = (id: string, ventaId: string, monto: number, esReserva: boolean, estado = "pagada"): Cuota =>
  ({ id, ventaId, numero: esReserva ? 0 : 1, monto, esReserva, estado, vence: "2025-10-10T15:00:00.000Z" } as Cuota);
const venta = (id: string, productoId: string, precio: number): Venta =>
  ({ id, productoId, estado: "activa", fecha: "2025-10-10T15:00:00.000Z", precioAcordado: precio, moneda: "USD", contactoId: `lead_${id}` } as unknown as Venta);
const productos = [
  { id: "prod_downsell", nombre: "Downsell", precioLista: 497 },
  { id: "prod_ai", nombre: "Hackear AI", precioLista: 3000 },
  { id: "prod_sin", nombre: "Sin precio", precioLista: 0 },
] as Producto[];

test("la regla: una «reserva» que cubre el precio de lista del programa no es reserva; una de verdad sigue siéndolo", () => {
  /* El caso de Lili: 500 de un Downsell de 497. */
  assert.equal(reservaSinCompletar([cuota("c1", "v1", 500, true)], 497), null);
  /* Sin el precio (como antes), sigue diciendo reserva: por eso todos los lugares le pasan el precio. */
  assert.deepEqual(reservaSinCompletar([cuota("c1", "v1", 500, true)]), { pagado: 500, falta: 0 });
  /* Reservas de verdad: 100 de 497, 50 de 3000 con el resto por cobrar, y un producto sin precio de lista. */
  assert.deepEqual(reservaSinCompletar([cuota("c1", "v1", 100, true)], 497), { pagado: 100, falta: 0 });
  assert.deepEqual(reservaSinCompletar([cuota("c1", "v1", 50, true), cuota("c2", "v1", 2950, false, "pendiente")], 3000), { pagado: 50, falta: 2950 });
  assert.deepEqual(reservaSinCompletar([cuota("c1", "v1", 500, true)], 0), { pagado: 500, falta: 0 });
  /* Dos reservas que juntas cubren el programa: tampoco es reserva. */
  assert.equal(reservaSinCompletar([cuota("c1", "v1", 300, true), cuota("c2", "v1", 200, true)], 497), null);
});

test("precioDeLista sale del producto de la venta; sin producto o sin precio, null", () => {
  const de = precioDeLista({ ventas: [venta("v1", "prod_downsell", 500), venta("v2", "prod_sin", 10), { id: "v3", productoId: undefined } as unknown as Venta], productos });
  assert.deepEqual([de("v1"), de("v2"), de("v3"), de("v_x"), de(null)], [497, null, null, null, null]);
});

test("Leonardo figura activo (no reserva) en la situación, en Clientes y en el índice; la reserva de verdad sigue siendo reserva", () => {
  const base = construirSemilla();
  const al = (id: string, ventaId: string) => ({ id, nombre: `Alumno ${id}`, email: `${id}@mail.com`, estado: "activo", ventaId, inicio: "2025-10-10T15:00:00.000Z",
    cohorte: "", plan: "Downsell", progreso: 0, cuotaMensual: 0, extra: {} } as Alumno);
  const e: EstadoApp = {
    ...base,
    productos,
    alumnos: [al("leo", "v_leo"), al("res", "v_res")],
    ventas: [venta("v_leo", "prod_downsell", 500), venta("v_res", "prod_downsell", 100)],
    cuotas: [cuota("q_leo", "v_leo", 500, true), cuota("q_res", "v_res", 100, true)],
    seguimientos: [],
  };
  const de = indiceDeSituaciones(e);
  assert.equal(de(e.alumnos[0]), "activo");
  assert.equal(de(e.alumnos[1]), "reserva");
  const filas = filasClientes(e, "2026-11-27");
  assert.equal(filas.find((f) => f.id === "leo")!.estadoAlumno, "Activo");
  assert.equal(filas.find((f) => f.id === "res")!.estadoAlumno, "Reserva");
  const esReserva = indiceDeReservas(e.cuotas, precioDeLista(e));
  assert.deepEqual([esReserva(e.alumnos[0]), esReserva(e.alumnos[1])], [false, true]);
});

test("no se ofrece «completar la reserva» de algo ya pagado, y los accesos no se frenan por esa «reserva»", () => {
  const v = venta("v_leo", "prod_downsell", 500);
  assert.equal(reservaSuelta(v, [cuota("q", "v_leo", 500, true)], 497), null);
  assert.ok(reservaSuelta(v, [cuota("q", "v_leo", 100, true)], 497), "la reserva suelta de verdad se sigue ofreciendo");
  const cuotas = [{ id: "q", monto: 500, esReserva: true }];
  const pagos = [{ cuotaId: "q", monto: 500 }];
  assert.equal(motivoSinPagoDelPrograma(cuotas, pagos, "USD", 497), null);
  assert.match(motivoSinPagoDelPrograma(cuotas, pagos, "USD") ?? "", /Sólo pagó la reserva/, "sin el precio, como antes");
  assert.match(motivoSinPagoDelPrograma([{ id: "q", monto: 100, esReserva: true }], [{ cuotaId: "q", monto: 100 }], "USD", 497) ?? "", /Sólo pagó la reserva/);
});
