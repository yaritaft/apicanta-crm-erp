import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { cuotasARepartir, problemaDelPlan, repartirParejo, sumarDias, totalARepartir } from "@/lib/plan-de-cuotas";
import type { Cuota, EstadoApp, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Cambiar el plan de pagos (Aldana, 28/10): el cliente que iba a pagar en dos cuotas va a pagar en tres.
   ================================================================== */

const venta = { id: "v1", contactoNombre: "Cliente", precioAcordado: 2000, moneda: "USD", estado: "activa", fecha: "2026-09-01T15:00:00.000Z", productoId: "p", excluidoMarketing: false, creadoEn: "2026-09-01T15:00:00.000Z", extra: {} } as unknown as Venta;
const cuota = (c: Partial<Cuota> & Pick<Cuota, "id" | "numero" | "monto">): Cuota => ({ ventaId: "v1", estado: "pendiente", esReserva: false, vence: "2026-10-15T15:00:00.000Z", ...c });
const pago = (id: string, cuotaId: string, monto: number): Pago => ({ id, cuotaId, monto, feeMonto: 0, fecha: "2026-09-15T15:00:00.000Z", procesadorId: "x", moneda: "USD", feeRate: 0, creadoEn: "2026-09-15T15:00:00.000Z" }) as unknown as Pago;

/* Una cuota ya cobrada y dos pendientes de 500 (lo que falta: 1000). */
const cuotas = [
  cuota({ id: "c1", numero: 1, monto: 1000, estado: "pagada", vence: "2026-09-15T15:00:00.000Z" }),
  cuota({ id: "c2", numero: 2, monto: 500, vence: "2026-10-15T15:00:00.000Z", closerId: "heredero" }),
  cuota({ id: "c3", numero: 3, monto: 500, vence: "2026-11-15T15:00:00.000Z", closerId: "heredero" }),
];
const estado = (extra: Partial<EstadoApp> = {}) => ({ cuotas, pagos: [pago("p1", "c1", 1000)], ...extra }) as unknown as EstadoApp;

test("el mismo día del mes que viene, y el último si ese mes no lo tiene", () => {
  assert.equal(sumarDias("2026-01-31", "mensual", 1), "2026-02-28");
  assert.equal(sumarDias("2026-01-31", "mensual", 2), "2026-03-31");
  assert.equal(sumarDias("2026-11-15", "mensual", 2), "2027-01-15");
  assert.equal(sumarDias("2026-10-28", "quincenal", 1), "2026-11-12");
  assert.equal(sumarDias("2026-10-28", "semanal", 2), "2026-11-11");
});

test("el plan parejo suma lo que hay que repartir y la última se lleva el redondeo", () => {
  const p = repartirParejo(1000, 3, "2026-10-15", "mensual");
  assert.deepEqual(p.map((c) => c.monto), [333.33, 333.33, 333.34]);
  assert.deepEqual(p.map((c) => c.vence), ["2026-10-15", "2026-11-15", "2026-12-15"]);
  assert.equal(repartirParejo(500, 1, "2026-10-15", "mensual").length, 1);
  assert.equal(repartirParejo(1000, 99, "2026-10-15", "mensual").length, 24, "con un tope");
});

test("se reparten las pendientes sin cobros, no las cobradas, las cobradas en parte ni las incobrables", () => {
  const e = estado({
    cuotas: [
      ...cuotas,
      cuota({ id: "c4", numero: 4, monto: 300, vence: "2026-12-15T15:00:00.000Z" }),
      cuota({ id: "c5", numero: 5, monto: 300, estado: "cancelada", notas: "Incobrable: se dio de baja" }),
    ],
    pagos: [pago("p1", "c1", 1000), pago("p2", "c4", 100)],
  });
  assert.deepEqual(cuotasARepartir(e, "v1").map((c) => c.id), ["c2", "c3"], "c4 tiene un cobro en parte");
  assert.equal(totalARepartir(cuotasARepartir(e, "v1")), 1000);
});

test("el plan se valida: suma exacta, montos positivos y fechas", () => {
  assert.equal(problemaDelPlan(1000, repartirParejo(1000, 3, "2026-10-15", "mensual")), null);
  assert.match(problemaDelPlan(1000, [{ monto: 500, vence: "2026-10-15" }, { monto: 400, vence: "2026-11-15" }])!, /suman 900 y hay que repartir 1000/);
  assert.match(problemaDelPlan(1000, [{ monto: 1000, vence: "" }])!, /fecha/);
  assert.match(problemaDelPlan(1000, [{ monto: 0, vence: "2026-10-15" }, { monto: 1000, vence: "2026-10-15" }])!, /más de cero/);
  assert.match(problemaDelPlan(1000, [])!, /al menos una/);
});

test("el almacén: de dos cuotas a tres, lo cobrado queda, el precio queda y las nuevas siguen la numeración", () => {
  assert.equal(acciones.importar(JSON.stringify({ ...(construirSemilla() as EstadoApp), ventas: [venta], cuotas, pagos: [pago("p1", "c1", 1000)], actividad: [] })), true);
  const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
  const plan = repartirParejo(1000, 3, "2026-10-15", "mensual");

  assert.equal(acciones.cambiarPlanDeCuotas("v1", plan, ""), null, "sin motivo no se cambia");
  assert.equal(acciones.cambiarPlanDeCuotas("v1", [{ monto: 900, vence: "2026-10-15" }], "x"), null, "si no suma lo mismo, no");
  assert.equal(hoy().cuotas.length, 3, "nada cambió");

  const texto = acciones.cambiarPlanDeCuotas("v1", plan, "El cliente avisó que paga en 3");
  assert.match(texto ?? "", /pasaron de 2 cuotas a 3/);
  const e = hoy();
  const de = e.cuotas.filter((c) => c.ventaId === "v1");
  assert.equal(de.length, 4);
  assert.equal(de.find((c) => c.id === "c1")?.estado, "pagada", "la cobrada sigue igual");
  assert.equal(de.some((c) => c.id === "c2" || c.id === "c3"), false, "las pendientes se reemplazaron");
  const nuevas = de.filter((c) => c.id !== "c1").sort((a, b) => a.numero - b.numero);
  assert.deepEqual(nuevas.map((c) => c.numero), [2, 3, 4]);
  assert.deepEqual(nuevas.map((c) => c.monto), [333.33, 333.33, 333.34]);
  assert.deepEqual(nuevas.map((c) => (c.vence ?? "").slice(0, 10)), ["2026-10-15", "2026-11-15", "2026-12-15"]);
  assert.ok(nuevas.every((c) => c.estado === "pendiente" && c.closerId === "heredero"), "quien heredó las cuotas sigue cobrando");
  assert.match(nuevas[0].notas ?? "", /antes las cuotas 2: 500 el 2026-10-15; 3: 500 el 2026-11-15/);
  assert.equal(e.ventas.find((v) => v.id === "v1")?.precioAcordado, 2000, "el precio de la venta no cambia");
  assert.equal(e.actividad.length, 1);
  assert.match(e.actividad[0].detalle ?? "", /Se cambió el plan de pagos/);

  /* Con lo que falta ya repartido en tres, otra vez: ahora en dos. */
  assert.ok(acciones.cambiarPlanDeCuotas("v1", repartirParejo(1000, 2, "2026-11-01", "mensual"), "Mejor en 2"));
  assert.deepEqual(hoy().cuotas.filter((c) => c.ventaId === "v1" && c.estado === "pendiente").map((c) => c.monto).sort(), [500, 500]);
});

test("una venta dada de baja, o sin nada para repartir, no cambia", () => {
  assert.equal(acciones.importar(JSON.stringify({ ...(construirSemilla() as EstadoApp), ventas: [{ ...venta, estado: "cancelada" }], cuotas, pagos: [pago("p1", "c1", 1000)], actividad: [] })), true);
  assert.equal(acciones.cambiarPlanDeCuotas("v1", repartirParejo(1000, 3, "2026-10-15", "mensual"), "x"), null);
  assert.equal(acciones.importar(JSON.stringify({ ...(construirSemilla() as EstadoApp), ventas: [venta], cuotas: [cuotas[0]], pagos: [pago("p1", "c1", 1000)], actividad: [] })), true);
  assert.equal(acciones.cambiarPlanDeCuotas("v1", [{ monto: 1, vence: "2026-10-15" }], "x"), null, "todo cobrado: no hay nada para repartir");
});
