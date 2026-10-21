import test from "node:test";
import assert from "node:assert/strict";
import { cuotasVencidas } from "@/lib/finanzas";
import { totalDeMora, vencidasDelPeriodo } from "@/lib/mora-filtros";
import type { EstadoApp } from "@/lib/types";

/* Juan Cruz (21/10): en el paso «Cuotas del mes cobradas o resueltas» de octubre aparecían 33 cuotas vencidas desde junio, con 115 días de
   atraso. Adentro de un paso, la tabla tiene que mostrar sólo lo que vencía en ese período; lo de meses anteriores se resuelve en su cierre. */

const AHORA = Date.parse("2026-10-21T15:00:00.000Z");
const estado = (): Pick<EstadoApp, "ventas" | "cuotas" | "pagos"> => {
  const venta = (id: string, nombre: string) => ({ id, contactoNombre: nombre, estado: "activa", productoId: "pm", closerId: "dante" });
  const cuota = (id: string, ventaId: string, numero: number, vence: string, monto = 500) =>
    ({ id, ventaId, numero, monto, vence, estado: "pendiente", esReserva: false });
  return {
    ventas: [venta("v1", "Oscar Llamuca"), venta("v2", "Francisco Karriere"), venta("v3", "Ana de octubre"), venta("v4", "Beto del 1/10")] as never,
    cuotas: [
      cuota("c1", "v1", 2, "2026-06-28T15:00:00.000Z"), cuota("c2", "v1", 3, "2026-07-28T15:00:00.000Z"), cuota("c3", "v2", 2, "2026-09-02T15:00:00.000Z"),
      cuota("c4", "v3", 2, "2026-10-12T15:00:00.000Z", 700), cuota("c5", "v4", 1, "2026-10-01T03:30:00.000Z", 300),
      cuota("c6", "v3", 3, "2026-11-12T15:00:00.000Z"),
    ] as never,
    pagos: [],
  };
};

test("adentro del paso de octubre sólo quedan las cuotas que vencían en octubre; las de junio a septiembre quedan afuera", () => {
  const vencidas = cuotasVencidas(estado() as EstadoApp, AHORA);
  assert.deepEqual(vencidas.map((v) => v.cuotaId).sort(), ["c1", "c2", "c3", "c4", "c5"], "la de noviembre todavía no venció");
  const octubre = vencidasDelPeriodo(vencidas, { desde: "2026-10-01", hasta: "2026-10-31" });
  assert.deepEqual(octubre.map((v) => v.cuotaId).sort(), ["c4", "c5"]);
  assert.equal(totalDeMora(octubre).saldo, 1000, "700 + 300");
  assert.equal(totalDeMora(octubre).cuotas, 2);
});

test("el período mira el día de Argentina: lo que vence a las 00:30 del 1/10 (03:30 UTC) es de octubre; lo del 31/10 a la noche, también", () => {
  const e = estado();
  const cuotas = [...(e.cuotas as never as { id: string }[])];
  const tarde = { ...(cuotas[3] as object), id: "c9", vence: "2026-11-01T01:30:00.000Z" } as never; // 31/10 22:30 en Argentina
  const vencidas = cuotasVencidas({ ...e, cuotas: [...e.cuotas, tarde] } as EstadoApp, Date.parse("2026-11-05T15:00:00.000Z"));
  const octubre = vencidasDelPeriodo(vencidas, { desde: "2026-10-01", hasta: "2026-10-31" }).map((v) => v.cuotaId);
  assert.ok(octubre.includes("c5") && octubre.includes("c9"), "el 1/10 y el 31/10 son de octubre");
  assert.ok(!octubre.includes("c3"), "el 2/9 no");
});

test("septiembre muestra lo que sigue sin cobrar de septiembre, y un mes sin cuotas vencidas queda vacío", () => {
  const vencidas = cuotasVencidas(estado() as EstadoApp, AHORA);
  assert.deepEqual(vencidasDelPeriodo(vencidas, { desde: "2026-09-01", hasta: "2026-09-30" }).map((v) => v.cuotaId), ["c3"]);
  assert.deepEqual(vencidasDelPeriodo(vencidas, { desde: "2026-08-01", hasta: "2026-08-31" }), []);
  assert.equal(totalDeMora([]).saldo, 0);
});

test("adentro del paso, lo que vence hoy todavía no cuenta (igual que «venció y sigue sin cobrar» del paso); afuera, sí", () => {
  const e = estado();
  const hoyMismo = { ...(e.cuotas[3] as object), id: "c8", vence: "2026-10-21T12:00:00.000Z" } as never; // 09:00 en Argentina
  const vencidas = cuotasVencidas({ ...e, cuotas: [...e.cuotas, hoyMismo] } as EstadoApp, AHORA); // ahora son las 12:00 en Argentina: ya pasó la hora de la cuota
  assert.ok(vencidas.some((v) => v.cuotaId === "c8"), "la tabla de siempre la cuenta");
  const octubre = { desde: "2026-10-01", hasta: "2026-10-31" };
  assert.deepEqual(vencidasDelPeriodo(vencidas, octubre, "2026-10-21").map((v) => v.cuotaId).sort(), ["c4", "c5"]);
  assert.deepEqual(vencidasDelPeriodo(vencidas, octubre).map((v) => v.cuotaId).sort(), ["c4", "c5", "c8"], "sin «hoy», entra");
});
