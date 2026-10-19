import test from "node:test";
import assert from "node:assert/strict";
import { MOTIVOS_DE_COBRO, MOTIVOS_DE_REEMBOLSO, faltaElMotivo, motivoCompleto, motivoDeDescarte, textoDeMotivo } from "@/lib/motivos";
import { resumenDe, transaccionesDe } from "@/lib/transacciones";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Movimiento } from "@/lib/types";
import { devolucion } from "./estado-devolucion";

/* Revisión con Aldana (19/10): todo cobro y todo reembolso de una pasarela que no cuenta tiene que decir por qué. */

const DIA = (m: number, d: number) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [], devoluciones: [],
});
const mov = (id: string, estado: Movimiento["estado"], motivo?: string): Movimiento =>
  ({ id, proveedor: "whop", referencia: id, monto: 300, moneda: "USD", fee: 0, neto: 300, fecha: DIA(10, 5), estado, clienteNombre: `Cliente ${id}`, ...(motivo ? { motivo } : {}) } as Movimiento);

test("las opciones de motivo: «Otro» obliga a escribir, las demás no, y el texto guardado es el que lee el equipo", () => {
  for (const lista of [MOTIVOS_DE_COBRO, MOTIVOS_DE_REEMBOLSO]) {
    const otro = lista.find((o) => o.id === "otro")!;
    assert.equal(motivoCompleto(undefined, "algo"), false, "sin elegir nada no alcanza");
    assert.equal(motivoCompleto(otro, ""), false);
    assert.equal(motivoCompleto(otro, "  ab "), false, "demasiado corto");
    assert.equal(motivoCompleto(otro, "Lo pidió Manu"), true);
    assert.equal(textoDeMotivo(otro, "  Lo pidió Manu "), "Lo pidió Manu", "«Otro» guarda sólo lo escrito");
    for (const o of lista.filter((x) => x.id !== "otro")) {
      assert.equal(motivoCompleto(o, ""), true, `${o.id}: el detalle es opcional`);
      assert.equal(textoDeMotivo(o, ""), o.texto);
      assert.equal(textoDeMotivo(o, " lo devolvió Whop "), `${o.texto}: lo devolvió Whop`);
    }
    assert.equal(new Set(lista.map((o) => o.id)).size, lista.length, "ids únicos");
  }
});

test("faltaElMotivo y motivoDeDescarte: sólo hablan de lo que quedó sin venta o descartado", () => {
  assert.equal(faltaElMotivo({ estado: "ignorado" }), true);
  assert.equal(faltaElMotivo({ estado: "ignorado", motivo: "  " }), true);
  assert.equal(faltaElMotivo({ estado: "ignorado", motivo: "Se reembolsó" }), false);
  assert.equal(faltaElMotivo({ estado: "pendiente" }), false, "un pendiente no se explica");
  assert.equal(faltaElMotivo({ estado: "conciliado", motivo: null }), false);
  assert.equal(motivoDeDescarte({ extra: { motivoDescarte: " No es de un cliente " } }), "No es de un cliente");
  assert.equal(motivoDeDescarte({ extra: { motivoDescarte: "   " } }), undefined);
  assert.equal(motivoDeDescarte({ extra: {} }), undefined);
});

test("Transacciones muestra lo sin venta con su motivo, avisa el que no lo tiene, y los reembolsos por confirmar o descartados se ven sin sumar", () => {
  const e = vacio();
  e.movimientos = [mov("a", "ignorado", "Se reembolsó: lo devolvió Whop"), mov("b", "ignorado"), mov("c", "pendiente")];
  e.devoluciones = [
    { ...devolucion({ id: "r1", monto: 50, fecha: DIA(10, 6), ventaId: "v-x" }), estado: "propuesta", referencia: "re_1", extra: { referenciasCobro: ["zzz"] } },
    { ...devolucion({ id: "r2", monto: 60, fecha: DIA(10, 7), ventaId: "v-x" }), estado: "ignorada", referencia: "re_2", extra: { motivoDescarte: "El cobro nunca contó como cobrado" } },
    { ...devolucion({ id: "r3", monto: 70, fecha: DIA(10, 8), ventaId: "v-x" }), estado: "ignorada", referencia: "re_3", extra: {} },
  ];
  const { filas, resumen } = transaccionesDe(e);
  const por = (id: string) => filas.find((f) => f.id === id)!;
  assert.equal(por("sin-venta:a").detalle, "Se reembolsó: lo devolvió Whop");
  assert.match(por("sin-venta:b").detalle, /Falta escribir por qué no es una venta/);
  assert.equal(por("sin-conciliar:c").origen, "sin-conciliar");
  assert.equal(por("reembolso:r1").origen, "reembolso-propuesto");
  assert.equal(por("reembolso:r2").origen, "sin-devolucion");
  assert.equal(por("reembolso:r2").detalle, "El cobro nunca contó como cobrado");
  assert.match(por("reembolso:r3").detalle, /Falta escribir por qué no es una devolución/);
  /* Nada de esto suma: son cobros que no fueron y reembolsos que no se confirmaron. */
  assert.equal(resumen.ingresos, 0);
  assert.equal(resumen.egresos, 0);
  assert.equal(resumen.sinConciliar, 300, "el pendiente sigue aparte");
  assert.equal(resumen.sinVentaN, 2);
  assert.equal(resumen.sinVenta, 600);
  assert.equal(resumen.sinMotivoN, 1, "sólo «b» no dice por qué");
  assert.deepEqual(resumenDe(filas), resumen);
});
