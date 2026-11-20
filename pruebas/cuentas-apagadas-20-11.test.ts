import test from "node:test";
import assert from "node:assert/strict";
import { cuentasPorUso, opcionesDeCuenta } from "@/lib/cuentas-por-uso";
import type { EstadoApp } from "@/lib/types";

/* Aldana puede apagar un medio de pago y el closer ya no lo ve al cargar un cobro (20/11). */

const e = {
  procesadores: [
    { id: "p_a", nombre: "Stripe", activo: true },
    { id: "p_b", nombre: "Financiera Vieja", activo: false },
    { id: "p_c", nombre: "Whop", activo: true },
  ],
  pagos: [{ procesadorId: "p_c" }, { procesadorId: "p_c" }, { procesadorId: "p_b" }],
} as unknown as Pick<EstadoApp, "procesadores" | "pagos">;

test("una cuenta apagada no se ofrece para un cobro nuevo, aunque tenga cobros", () => {
  assert.deepEqual(cuentasPorUso(e).map((p) => p.id), ["p_c", "p_a"]);
  assert.deepEqual(opcionesDeCuenta(e).map((o) => o.valor), ["p_c", "p_a"]);
  assert.deepEqual(opcionesDeCuenta(e, [undefined, ""]).map((o) => o.valor), ["p_c", "p_a"]);
});

test("al corregir un cobro de una cuenta que después se apagó, esa cuenta sigue en su selector (marcada), y sólo esa", () => {
  const o = opcionesDeCuenta(e, ["p_b"]);
  assert.deepEqual(o.map((x) => x.valor), ["p_c", "p_a", "p_b"]);
  assert.equal(o.at(-1)!.texto, "Financiera Vieja (apagada)");
});

test("volver a prenderla la ofrece de nuevo, sin la marca", () => {
  const prendida = { ...e, procesadores: e.procesadores.map((p) => (p.id === "p_b" ? { ...p, activo: true } : p)) } as typeof e;
  assert.deepEqual(opcionesDeCuenta(prendida, ["p_b"]).map((x) => x.texto), ["Whop", "Financiera Vieja", "Stripe"], "ordenadas por uso");
});
