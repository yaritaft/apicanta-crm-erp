import "./plata-tz";
import test from "node:test";
import assert from "node:assert/strict";
import { devolvibleDeVenta, problemaDeDevolucion, reversasDeComision, totalDevuelto } from "@/lib/devoluciones";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import { conciliarReembolsos } from "@/lib/reembolsos";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp } from "@/lib/types";

/* Intento de refutar «cargar una devolución con fecha anterior a otra ya cargada deja devolver de más».
   Reproducción independiente (sin los ayudantes de plata-mundo): objetos planos y la hora de Argentina.
   ARREGLADO (lote dev): las afirmaciones que decían «BUG» están invertidas: la guarda mira la línea de tiempo entera. */

/** El día `d` de octubre de 2026 a las `h` de Argentina, como lo guarda la app (ISO en UTC). */
const oct = (d: number, h = 12) => new Date(Date.UTC(2026, 9, d, h + 3)).toISOString();

const venta = { id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: oct(1), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: oct(1), extra: {} };
const cuotas = [{ id: "q1", ventaId: "v1", numero: 1, monto: 3000, estado: "pagada", esReserva: false }];
const pagos = [{ id: "p1", cuotaId: "q1", monto: 3000, feeMonto: 0, fecha: oct(1, 10), procesadorId: "proc_stripe", moneda: "USD", feeRate: 0, creadoEn: oct(1, 10) }];
const equipo = [{ id: "c1", nombre: "Closer", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }];
const dev = (id: string, monto: number, fecha: string, mas: Record<string, unknown> = {}) => ({
  id, ventaId: "v1", monto, moneda: "USD", fecha, procesadorId: "proc_stripe", noDescontarAlCloser: false, estado: "confirmada", creadoEn: fecha, extra: {}, ...mas,
});
const estado = (devoluciones: unknown[]) => ({
  equipo, honorarios: [], ventas: [venta], cuotas, pagos, devoluciones, gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 },
}) as unknown as EstadoApp;
const intento = (e: EstadoApp, monto: number, fecha: string, ignorar?: string) =>
  problemaDeDevolucion(e, { ventaId: "v1", monto, fecha, procesadorId: "proc_stripe", tieneComprobante: true }, ignorar);

test("1 · la guarda no depende del orden en que se cargan: la misma devolución se rechaza el mismo día, después y ANTES", () => {
  const e = estado([dev("a", 3000, oct(10))]);
  assert.match(intento(e, 3000, oct(12))!, /No se puede devolver más de lo cobrado: quedan US\$ 0/, "después de A: rechazada");
  assert.match(intento(e, 3000, oct(10))!, /No se puede devolver más de lo cobrado/, "el mismo día que A: rechazada");
  assert.match(intento(e, 3000, oct(5))!, /No se puede devolver más de lo cobrado/, "ANTES de A: rechazada");
  assert.deepEqual(devolvibleDeVenta(e, "v1", oct(5)), { cobrado: 3000, devuelto: 0, queda: 0, limitadaPor: { dia: "2026-10-10", cobrado: 3000, devuelto: 3000 } }, "y dice por qué: la de después cuenta");
});

test("2 · lo que pasa en Finanzas con las dos cargadas: se resta 6.000 de una venta de 3.000, y la comisión se revierte una sola vez", () => {
  const e = estado([dev("a", 3000, oct(10)), dev("b", 3000, oct(5))]);
  const m = rangoDePeriodo("2026-10");
  const p = calcularPyL(e, m);
  assert.equal(p.cobrado, 3000);
  assert.equal(totalDevuelto(e, m), 6000);
  assert.equal(p.cashCollected, -3000, "Cash Collected negativo: devolvió el doble de lo que cobró");
  const revertido = reversasDeComision(e).reduce((a, r) => a + r.partes.reduce((s, x) => s + x.reversa, 0), 0);
  assert.equal(revertido, 300, "la reversa de comisión sí se acota a lo comisionado (10% de 3.000)");
  const filas = comisionesDelMes(e, m);
  const neto = filas.reduce((a, f) => a + f.comisionCloser, 0);
  assert.equal(neto, 0, "el closer queda en cero: se revirtió todo UNA vez, mientras que el cash se restó DOS");
});

test("3 · corregir hacia arriba una devolución con fecha anterior también cuenta la de después", () => {
  const e = estado([dev("a", 1000, oct(10)), dev("b", 1000, oct(5))]);
  /* B (05/10) pasa de 1.000 a 3.000: con la A de 1.000 del 10/10 quedaría devuelto 4.000 de 3.000. */
  assert.notEqual(intento(e, 3000, oct(5), "b"), null, "rechazada");
  assert.equal(intento(e, 2000, oct(5), "b"), null, "hasta 2.000 sí: da justo 3.000 con la A");
  const despues = estado([dev("a", 1000, oct(10)), dev("b", 2000, oct(5))]);
  assert.equal(totalDevuelto(despues, rangoDePeriodo("2026-10")), 3000);
});

test("4 · el caso realista: la propuesta de la pasarela se confirma (07/10) y después se carga a mano la misma devolución con la fecha en que se hizo (05/10)", () => {
  const confirmada = dev("dev_stripe_re_1", 3000, oct(7), { referencia: "stripe:re_1", proveedor: "stripe", extra: { origen: "pasarela", referenciasCobro: ["ch_1"] } });
  const base = estado([confirmada]);
  /* A mano, con la fecha en que se hizo: ya no la deja cargar. */
  assert.match(intento(base, 3000, oct(5))!, /No se puede devolver más de lo cobrado/, "la app no deja cargarla");
  /* Un estado heredado de antes del arreglo (las dos cargadas) sigue sin que la pasarela avise del duplicado. */
  const e = estado([confirmada, dev("manual", 3000, oct(5))]);
  assert.equal(totalDevuelto(e, rangoDePeriodo("2026-10")), 6000);
  /* Y la pasarela, la próxima vez que sincroniza, no la detecta como repetida: el reembolso ya estaba atado a la otra. */
  const res = conciliarReembolsos(
    { ...e, movimientos: [], procesadores: [{ id: "proc_stripe", nombre: "Stripe", proveedor: "stripe" }], contactos: [], leads: [] } as unknown as Parameters<typeof conciliarReembolsos>[0],
    [{ proveedor: "stripe", referencia: "re_1", referenciasCobro: ["ch_1"], monto: 3000, moneda: "USD", fecha: oct(7), procesadorId: "proc_stripe" }],
    oct(8),
  );
  assert.deepEqual({ atadas: res.atadas.length, nuevas: res.nuevas.length, yaEstaban: res.yaEstaban }, { atadas: 0, nuevas: 0, yaEstaban: 1 }, "nadie avisa del duplicado");
});

test("5 · en orden (la que se carga después tiene fecha posterior) sí se rechaza, y no hay sobredevolución", () => {
  const e = estado([dev("b", 3000, oct(5))]);
  assert.match(intento(e, 3000, oct(10))!, /No se puede devolver más de lo cobrado/);
});

test("6 · el invariante se puede cumplir sin bloquear cargas legítimas fuera de orden: una guarda que también mira el total devuelto rechaza los casos 1, 3 y 4 y acepta las dos órdenes de una venta con dos cobros", () => {
  const conTotal = (e: EstadoApp, monto: number, fecha: string, ignorar?: string) => {
    const base = intento(e, monto, fecha, ignorar);
    if (base) return base;
    const otras = (e.devoluciones ?? []).filter((d) => d.ventaId === "v1" && d.estado === "confirmada" && d.id !== ignorar).reduce((a, d) => a + d.monto, 0);
    const cobradoTotal = e.pagos.reduce((a, p) => a + p.monto, 0);
    return monto + otras > cobradoTotal + 0.01 ? "pasa de lo cobrado" : null;
  };
  assert.notEqual(conTotal(estado([dev("a", 3000, oct(10))]), 3000, oct(5)), null, "caso 1");
  assert.notEqual(conTotal(estado([dev("a", 1000, oct(10)), dev("b", 1000, oct(5))]), 3000, oct(5), "b"), null, "caso 3");
  assert.notEqual(conTotal(estado([dev("r", 3000, oct(7), { referencia: "stripe:re_1" })]), 3000, oct(5)), null, "caso 4");
  /* Dos cobros de 1.500 (01/10 y 08/10) y dos devoluciones de 1.500 (05/10 y 10/10): las dos órdenes de carga son legítimas. */
  const dos = { ...estado([]), pagos: [pagos[0] && { ...pagos[0], monto: 1500 }, { ...pagos[0], id: "p2", monto: 1500, fecha: oct(8, 10) }] } as unknown as EstadoApp;
  const con = (...ds: unknown[]) => ({ ...dos, devoluciones: ds }) as unknown as EstadoApp;
  assert.equal(conTotal(con(dev("a", 1500, oct(5))), 1500, oct(10)), null, "en orden");
  assert.equal(conTotal(con(dev("b", 1500, oct(10))), 1500, oct(5)), null, "al revés");
});
