import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { conciliarPuntas, gastoDelCosto, llegadaDeCobro, paseDelCobro, saldosEsperados, situacionDe } from "@/lib/traspasos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Movimiento, Traspaso } from "@/lib/types";

/* Reunión con Aldana (19/10): dos entradas de USDT Trust (125 y 60,50) no son ventas, son un cambio de Yari con un amigo.
   «Es un movimiento entre cuentas»: el cobro queda sin venta y el pase queda cargado (con el cobro como su llegada). */

const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const DIA = (d: number) => `2026-10-${String(d).padStart(2, "0")}T15:00:00.000Z`;
const cobro = (id: string, monto: number, d: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `mov_trust_${id}`, proveedor: "trust", referencia: id, monto, moneda: "USD", fee: 0, neto: monto, fecha: DIA(d),
  estado: "pendiente", procesadorId: "proc_trust", clienteNombre: "Billetera TJ7hhY", creadoEn: DIA(d), origen: "api", ...extra,
} as Movimiento);
const armar = (movs: Movimiento[]) => {
  const e = { ...(construirSemilla() as EstadoApp), ventas: [], cuotas: [], pagos: [], movimientos: movs, gastos: [], traspasos: [], arqueos: [], actividad: [] };
  assert.ok(e.procesadores.some((p) => p.id === "proc_trust") && e.procesadores.some((p) => p.id === "proc_mercury"), "la semilla trae las cuentas");
  assert.equal(acciones.importar(JSON.stringify(e)), true);
};
const pase = (m: Movimiento, extra: Partial<Traspaso> = {}): Traspaso => ({
  id: `tra_${m.referencia}`, fecha: m.fecha, destinoId: "proc_trust", montoSale: m.monto, monedaSale: "USD", montoLlega: m.monto, monedaLlega: "USD",
  estado: "confirmado", llegadaRef: llegadaDeCobro(m), origen: "manual", creadoEn: m.fecha, ...extra,
});
const mov = (id: string) => hoy().movimientos.find((m) => m.id === id)!;

test("un cobro que es un movimiento entre cuentas: queda el pase con el cobro como su llegada y el cobro, sin venta con su motivo", () => {
  const m = cobro("c125", 125, 4);
  armar([m]);
  const t = pase(m, { origenId: "proc_mercury" });
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, t), true);
  const e = hoy();
  assert.equal(mov(m.id).estado, "ignorado");
  assert.match(mov(m.id).motivo ?? "", /Movimiento entre cuentas: salió de .*Mercury.* y llegó a .*Trust/i);
  assert.equal(paseDelCobro(e.traspasos, mov(m.id))?.id, t.id);
  assert.equal(e.traspasos!.length, 1);
  assert.ok(e.actividad.some((a) => /movimiento entre cuentas/i.test(a.detalle ?? "")), "queda anotado en la actividad");
  /* La caja: Mercury tiene 125 menos y USDT Trust, 125 más. */
  const s = saldosEsperados(e, undefined, "2026-10-19T00:00:00.000Z");
  assert.equal(s.get("proc_trust")!.pases, 125);
  assert.equal(s.get("proc_mercury")!.pases, -125);
  /* El cobro no suma como cobrado: no hay pago. */
  assert.equal(s.get("proc_trust")!.entro, 0);
});

test("sin saber de dónde salió: el pase queda sin cuenta de salida (a averiguar) y la caja sólo sube en la cuenta de llegada", () => {
  const m = cobro("c60", 60.5, 6);
  armar([m]);
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, pase(m, { notas: "Cambio de Yari con un amigo" })), true);
  const e = hoy();
  const t = paseDelCobro(e.traspasos, mov(m.id))!;
  assert.equal(t.origenId, undefined);
  assert.match(mov(m.id).motivo ?? "", /llegó a .*Trust.* desde una cuenta que todavía no se identificó/);
  assert.match(mov(m.id).motivo ?? "", /Cambio de Yari con un amigo/, "la nota también queda en el motivo");
  assert.equal(situacionDe(t), "detectado", "una de las dos puntas está a la vista");
  const s = saldosEsperados(e, undefined, "2026-10-19T00:00:00.000Z");
  assert.equal(s.get("proc_trust")!.pases, 60.5);
  /* Cuando se averigua, se corrige el mismo pase: el cobro sigue atado. */
  assert.equal(acciones.guardarTraspaso({ ...t, origenId: "proc_stripe", montoSale: 60.5 }), undefined);
  const e2 = hoy();
  assert.equal(paseDelCobro(e2.traspasos, mov(m.id))?.origenId, "proc_stripe");
  assert.equal(saldosEsperados(e2, undefined, "2026-10-19T00:00:00.000Z").get("proc_stripe")!.pases, -60.5);
});

test("si salió más de lo que llegó, la diferencia queda como gasto de comisión y se va junto con el movimiento", () => {
  const m = cobro("c200", 200, 8);
  armar([m]);
  const t = pase(m, { origenId: "proc_mercury", montoSale: 205 });
  const gasto = gastoDelCosto(hoy(), t, 0);
  assert.ok(gasto && gasto.monto === 5);
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, t, gasto), true);
  assert.equal(hoy().gastos.length, 1);
  assert.equal(acciones.deshacerMovimientoDeCobro(m.id), true);
  assert.equal(hoy().gastos.length, 0, "se borra el gasto del costo");
  assert.equal(hoy().traspasos!.length, 0);
});

test("lo que no se puede: un cobro conciliado, uno que ya es un movimiento, un pase que no es el de este cobro o sin monto", () => {
  const conciliado = cobro("conc", 99, 3, { estado: "conciliado", pagoId: "p1", ventaId: "v1" });
  const libre = cobro("libre", 50, 5);
  armar([conciliado, libre]);
  assert.equal(acciones.asignarCobroComoMovimiento(conciliado.id, pase(conciliado)), false, "ya es un pago");
  assert.equal(mov(conciliado.id).estado, "conciliado");
  assert.equal(acciones.asignarCobroComoMovimiento(libre.id, { ...pase(libre), llegadaRef: "trust:otro" }), false, "no es la llegada de este cobro");
  assert.equal(acciones.asignarCobroComoMovimiento(libre.id, { ...pase(libre), montoLlega: 0 }), false);
  assert.equal(acciones.asignarCobroComoMovimiento("no-existe", pase(libre)), false);
  assert.equal(hoy().traspasos!.length, 0, "nada de eso dejó un movimiento");
  assert.equal(acciones.asignarCobroComoMovimiento(libre.id, pase(libre)), true);
  assert.equal(acciones.asignarCobroComoMovimiento(libre.id, { ...pase(libre), id: "tra_otro" }), false, "no se carga dos veces");
  assert.equal(hoy().traspasos!.length, 1);
});

test("deshacer: el cobro vuelve a pendientes sin motivo y se borra el movimiento; «volver a pendientes» a secas no deja un pase huérfano", () => {
  const m = cobro("c70", 70, 9);
  armar([m]);
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, pase(m)), true);
  assert.equal(acciones.marcarMovimiento(m.id, "pendiente"), false, "con un pase cargado a mano no vuelve solo");
  assert.equal(mov(m.id).estado, "ignorado");
  assert.equal(acciones.deshacerMovimientoDeCobro(m.id), true);
  assert.equal(mov(m.id).estado, "pendiente");
  assert.equal(mov(m.id).motivo, undefined);
  assert.equal(hoy().traspasos!.length, 0);
  assert.equal(acciones.deshacerMovimientoDeCobro(m.id), false, "ya no hay nada que deshacer");
  /* Se puede volver a asignar. */
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, pase(m)), true);
});

test("un cobro atado a un movimiento que vio la sincronización (no cargado a mano) vuelve a la bandeja sin borrar ese movimiento", () => {
  const m = cobro("cApi", 80, 10, { estado: "ignorado", motivo: "Liquidación probable" });
  armar([m]);
  const delApi = pase(m, { origen: "api", origenId: "proc_stripe", id: "tra_api_1" });
  assert.equal(acciones.guardarTraspaso(delApi), undefined);
  assert.equal(acciones.deshacerMovimientoDeCobro(m.id), false, "no es de los cargados desde el cobro");
  assert.equal(acciones.marcarMovimiento(m.id, "pendiente"), true, "la bandeja no se traba");
  assert.equal(hoy().traspasos!.length, 1, "el movimiento que vio la cuenta sigue");
});

test("un cobro asignado a un movimiento no se vuelve a ofrecer como pase nuevo cuando la sincronización trae la misma punta", () => {
  const m = cobro("cMercury", 300, 12, { proveedor: "mercury", procesadorId: "proc_mercury" });
  armar([m]);
  const t = pase(m, { destinoId: "proc_mercury", origenId: "proc_stripe", id: "tra_m" });
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, t), true);
  const r = conciliarPuntas(hoy().traspasos!, [{ lado: "llegada", cuentaId: "proc_mercury", otraCuentaId: "proc_stripe", monto: 300, moneda: "USD", fecha: m.fecha, ref: llegadaDeCobro(m), seguro: true }], DIA(13));
  assert.equal(r.nuevos.length, 0, "la punta ya está: no crea otro pase");
});
