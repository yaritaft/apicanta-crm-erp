import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import {
  cobrosQueYaSonPases, esMotivoDeMovimiento, gastoDelCosto, llegadaDeCobro, LLEGADA_A_MANO, paseDelCobro, paseDelDeposito, paseDesdeCobro,
  porQueNoEsMovimiento, saldosEsperados,
} from "@/lib/traspasos";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Movimiento, Traspaso } from "@/lib/types";

/* Aldana (25/11): «no me anda ese botón si lo quiero cargar desde el punto 2». Entraron US$ 15.000 a Mercury desde Bank of America. La
   sincronización guardó ese depósito dos veces: como movimiento entre cuentas «por confirmar» (Caja) y como cobro pendiente (Conciliación).
   Desde el cobro, «Dejarlo como movimiento entre cuentas» no hacía nada: la app se negaba en silencio porque «ya había un pase de ese
   depósito». Y confirmar el pase en la Caja dejaba el cobro pendiente para siempre. Un depósito, una sola decisión. */

const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
const FECHA = "2026-11-25T13:41:02.974Z";
const REF = "db490c68-e8d5-11f1-ba7b-cbd3dd775bc7";
const cobro = (extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `mov_mercury_${REF}`, proveedor: "mercury", referencia: REF, monto: 15000, moneda: "USD", fee: 0, neto: 15000, fecha: FECHA,
  estado: "pendiente", procesadorId: "proc_mercury", clienteNombre: "Bank of America", creadoEn: FECHA, origen: "api", ...extra,
} as Movimiento);
/* El pase que guarda la sincronización cuando ve llegar a Mercury plata de «Bank of America»: se propone, lo confirma una persona. */
const detectado = (extra: Partial<Traspaso> = {}): Traspaso => ({
  id: "tra_mercury_db490c68", fecha: FECHA, origenId: "proc_bofa", destinoId: "proc_mercury", montoSale: 15000, monedaSale: "USD",
  montoLlega: 15000, monedaLlega: "USD", estado: "propuesto", origen: "api", llegadaRef: `mercury:${REF}`, contraparte: "Bank of America",
  creadoEn: "2026-11-25T14:00:27.309Z", ...extra,
});
/* Lo que arma el formulario al abrirlo desde el cobro SIN mirar si ya había un pase (el formulario de antes): un id nuevo, cargado a mano. */
const dicho = (m: Movimiento, extra: Partial<Traspaso> = {}): Traspaso => ({
  id: "tra_nuevo_del_form", fecha: "2026-11-25T15:00:00.000Z", origenId: "proc_bofa", destinoId: "proc_mercury", montoSale: m.monto, monedaSale: "USD",
  montoLlega: m.monto, monedaLlega: "USD", estado: "confirmado", origen: "manual", llegadaRef: llegadaDeCobro(m), creadoEn: "2026-11-26T00:21:00.000Z", ...extra,
});
const armar = (movs: Movimiento[], traspasos: Traspaso[] = []) => {
  const e = { ...(construirSemilla() as EstadoApp), ventas: [], cuotas: [], pagos: [], movimientos: movs, gastos: [], traspasos, arqueos: [], actividad: [] };
  assert.ok(e.procesadores.some((p) => p.id === "proc_bofa") && e.procesadores.some((p) => p.id === "proc_mercury"), "la semilla trae las cuentas");
  assert.equal(acciones.importar(JSON.stringify(e)), true);
};
const mov = (id = cobro().id) => hoy().movimientos.find((m) => m.id === id)!;
const tra = (id = detectado().id) => hoy().traspasos!.find((t) => t.id === id);

test("el caso de Aldana: desde el cobro, con el pase que ya había visto la cuenta por confirmar, el botón anda y no carga otro", () => {
  armar([cobro()], [detectado()]);
  assert.equal(porQueNoEsMovimiento(hoy().traspasos, mov(), dicho(cobro())), null, "se puede: no hay nada que lo impida");
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro(), { notas: "Para pagar sueldos" })), true);
  const e = hoy();
  assert.equal(e.traspasos!.length, 1, "es el mismo pase, no uno más");
  const t = e.traspasos![0];
  assert.equal(t.id, detectado().id, "conserva el id que le puso la sincronización: no vuelve a entrar con la misma punta");
  assert.equal(t.origen, "api");
  assert.equal(t.contraparte, "Bank of America", "lo que dijo el banco no se pierde");
  assert.equal(t.estado, "confirmado");
  assert.equal(t.notas, "Para pagar sueldos", "con lo que dijo la persona");
  assert.equal(mov().estado, "ignorado", "el cobro sale de la bandeja");
  assert.match(mov().motivo ?? "", /^Movimiento entre cuentas: salió de Bank of America y llegó a ACH-WIRE Mercury\. No es una venta\. Para pagar sueldos$/);
  /* La caja: la plata se cuenta una sola vez. */
  const s = saldosEsperados(e, undefined, "2026-11-27T00:00:00.000Z");
  assert.equal(s.get("proc_mercury")!.pases, 15000);
  assert.equal(s.get("proc_bofa")!.pases, -15000);
  assert.equal(s.get("proc_mercury")!.entro, 0, "no entra como cobro");
});

test("como estaba en producción: el pase ya confirmado en la Caja y el cobro todavía pendiente; el botón también anda", () => {
  armar([cobro()], [detectado({ estado: "confirmado" })]);
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro())), true);
  assert.equal(hoy().traspasos!.length, 1);
  assert.equal(tra()!.estado, "confirmado");
  assert.equal(mov().estado, "ignorado");
  assert.ok(esMotivoDeMovimiento(mov().motivo));
});

test("la persona puede decir otra cosa que el banco: «todavía no sé de dónde salió» queda sin cuenta de salida", () => {
  armar([cobro()], [detectado()]);
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro(), { origenId: undefined })), true);
  assert.equal(tra()!.origenId, undefined);
  assert.match(mov().motivo ?? "", /desde una cuenta que todavía no se identificó/);
});

test("confirmar el pase en la Caja saca solo el cobro de la bandeja de Conciliación, con el motivo", () => {
  /* Con el «Sí» de la lista… */
  armar([cobro()], [detectado()]);
  acciones.marcarTraspaso(detectado().id, "confirmado");
  assert.equal(mov().estado, "ignorado");
  assert.match(mov().motivo ?? "", /salió de Bank of America y llegó a ACH-WIRE Mercury/);
  /* …y con el formulario («Sí, es un movimiento entre cuentas» → Confirmar el movimiento). */
  armar([cobro()], [detectado()]);
  acciones.guardarTraspaso({ ...detectado(), estado: "confirmado", notas: "Sueldos" });
  assert.equal(mov().estado, "ignorado");
  assert.match(mov().motivo ?? "", /Sueldos$/);
});

test("guardar una nota en un pase por confirmar NO lo decide: el cobro sigue en la bandeja", () => {
  armar([cobro()], [detectado()]);
  acciones.guardarTraspaso({ ...detectado(), notas: "preguntarle a Yari" });
  assert.equal(tra()!.estado, "propuesto");
  assert.equal(mov().estado, "pendiente");
});

test("«no es un movimiento entre cuentas» devuelve a la bandeja el cobro que había salido por eso, y sólo ése", () => {
  armar([cobro()], [detectado()]);
  acciones.marcarTraspaso(detectado().id, "confirmado");
  assert.equal(mov().estado, "ignorado");
  acciones.marcarTraspaso(detectado().id, "ignorado");
  assert.equal(mov().estado, "pendiente", "ya no hay nada que diga que no es una venta");
  assert.equal(mov().motivo, undefined);
  /* El que una persona dejó sin venta con sus palabras no se toca. */
  armar([cobro({ estado: "ignorado", motivo: "Liquidación probable de Hotmart" })], [detectado({ estado: "confirmado" })]);
  acciones.marcarTraspaso(detectado().id, "ignorado");
  assert.equal(mov().estado, "ignorado");
  assert.equal(mov().motivo, "Liquidación probable de Hotmart");
});

test("borrar el pase también devuelve el cobro a la bandeja", () => {
  armar([cobro()], [detectado()]);
  acciones.marcarTraspaso(detectado().id, "confirmado");
  acciones.borrarTraspaso(detectado().id);
  assert.equal(hoy().traspasos!.length, 0);
  assert.equal(mov().estado, "pendiente");
});

test("«volver a pendientes» desde el cobro deja el pase que vio la cuenta otra vez por confirmar: las dos listas dicen lo mismo", () => {
  armar([cobro()], [detectado()]);
  acciones.marcarTraspaso(detectado().id, "confirmado");
  assert.equal(acciones.marcarMovimiento(cobro().id, "pendiente"), true);
  assert.equal(mov().estado, "pendiente");
  assert.equal(tra()!.estado, "propuesto", "si no, la sincronización lo volvería a sacar de la bandeja");
  assert.deepEqual(cobrosQueYaSonPases(hoy().movimientos, hoy().traspasos), [], "no queda nada desparejo");
  /* Y se puede volver a decidir desde cualquiera de los dos lados. */
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro())), true);
  assert.equal(tra()!.estado, "confirmado");
  assert.equal(mov().estado, "ignorado");
});

test("corregir de dónde salió actualiza el motivo que escribió la app (no el que escribió una persona)", () => {
  armar([cobro()], [detectado({ origenId: undefined })]);
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro(), { origenId: undefined })), true);
  assert.match(mov().motivo ?? "", /todavía no se identificó/);
  acciones.guardarTraspaso({ ...tra()!, origenId: "proc_relay" });
  assert.match(mov().motivo ?? "", /salió de Relay y llegó a ACH-WIRE Mercury/);
  /* El motivo escrito a mano queda. */
  armar([cobro({ estado: "ignorado", motivo: "es movimiento entre cuentas y ya esta cargado" })], [detectado({ estado: "confirmado" })]);
  acciones.guardarTraspaso({ ...detectado({ estado: "confirmado" }), notas: "x" });
  assert.equal(mov().motivo, "es movimiento entre cuentas y ya esta cargado");
});

test("un cobro conciliado con una cuota no se toca al confirmar el pase", () => {
  armar([cobro({ estado: "conciliado", pagoId: "p1", ventaId: "v1" })], [detectado()]);
  acciones.marcarTraspaso(detectado().id, "confirmado");
  assert.equal(mov().estado, "conciliado");
  assert.match(porQueNoEsMovimiento(hoy().traspasos, mov(), dicho(cobro())) ?? "", /ya está atado a un pago/);
  assert.equal(acciones.asignarCobroComoMovimiento(cobro().id, dicho(cobro())), false);
});

test("nunca en silencio: cada cosa que impide dejarlo como movimiento tiene su explicación", () => {
  const m = cobro();
  assert.match(porQueNoEsMovimiento([], undefined, dicho(m)) ?? "", /ya no está/);
  assert.match(porQueNoEsMovimiento([], { ...m, estado: "conciliado" }, dicho(m)) ?? "", /atado a un pago/);
  assert.match(porQueNoEsMovimiento([detectado({ estado: "confirmado" })], { ...m, estado: "ignorado" }, dicho(m)) ?? "", /ya está como movimiento entre cuentas/);
  assert.match(porQueNoEsMovimiento([], m, dicho(m, { montoLlega: 0 })) ?? "", /cuánto llegó/);
  assert.match(porQueNoEsMovimiento([], m, dicho(m, { llegadaRef: "mercury:otro" })) ?? "", /no es el de este cobro/);
  /* Lo que antes lo trababa ya no lo traba: un pase del mismo depósito, por confirmar o confirmado, con el cobro pendiente. */
  assert.equal(porQueNoEsMovimiento([detectado()], m, dicho(m)), null);
  assert.equal(porQueNoEsMovimiento([detectado({ estado: "confirmado" })], m, dicho(m)), null);
  assert.equal(porQueNoEsMovimiento([], m, dicho(m)), null);
});

test("el pase que queda: el que ya había, con lo dicho; si alguien lo había descartado, es ése de nuevo (no otro encima)", () => {
  const m = cobro();
  const nuevo = paseDesdeCobro(undefined, dicho(m, { estado: "propuesto" }));
  assert.equal(nuevo.id, "tra_nuevo_del_form");
  assert.equal(nuevo.estado, "confirmado");
  const fundido = paseDesdeCobro(detectado({ salidaRef: "bofa:1" }), dicho(m, { montoSale: 15025 }));
  assert.equal(fundido.id, detectado().id);
  assert.equal(fundido.salidaRef, "bofa:1");
  assert.equal(fundido.montoSale, 15025, "lo que salió lo dice la persona");
  assert.equal(fundido.creadoEn, detectado().creadoEn);
  /* Descartado antes («No es un pase») y ahora sí: */
  assert.equal(paseDelCobro([detectado({ estado: "ignorado" })], m), undefined);
  assert.equal(paseDelDeposito([detectado({ estado: "ignorado" })], m)?.id, detectado().id);
  armar([m], [detectado({ estado: "ignorado" })]);
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, dicho(m)), true);
  assert.equal(hoy().traspasos!.length, 1);
  assert.equal(tra()!.estado, "confirmado");
});

test("el costo del pase va como gasto del pase que queda, no de uno que no existe", () => {
  const m = cobro();
  armar([m], [detectado()]);
  const t = dicho(m, { montoSale: 15025 });
  const gasto = gastoDelCosto(hoy(), t)!;
  assert.equal(gasto.id, "gas_tra_nuevo_del_form");
  assert.equal(acciones.asignarCobroComoMovimiento(m.id, t, gasto), true);
  const e = hoy();
  assert.equal(e.gastos.length, 1);
  assert.equal(e.gastos[0].id, `gas_${detectado().id}`);
  assert.equal(e.gastos[0].extra?.traspasoId, detectado().id);
  assert.equal(tra()!.gastoId, e.gastos[0].id);
  assert.equal(e.gastos[0].monto, 25);
});

test("lo que acomoda el servidor en cada sincronización: sólo cobros pendientes con su pase confirmado", () => {
  const m = cobro();
  const par = (movs: Movimiento[], ts: Traspaso[]) => cobrosQueYaSonPases(movs, ts).map((x) => `${x.cobro.id}>${x.pase.id}`);
  assert.deepEqual(par([m], [detectado({ estado: "confirmado" })]), [`${m.id}>${detectado().id}`]);
  assert.deepEqual(par([m], [detectado()]), [], "por confirmar: todavía decide una persona");
  assert.deepEqual(par([m], [detectado({ estado: "ignorado" })]), []);
  assert.deepEqual(par([{ ...m, estado: "conciliado" }], [detectado({ estado: "confirmado" })]), [], "un cobro conciliado no se toca");
  assert.deepEqual(par([{ ...m, estado: "ignorado" }], [detectado({ estado: "confirmado" })]), []);
  assert.deepEqual(par([m], [detectado({ estado: "confirmado", llegadaRef: LLEGADA_A_MANO })]), [], "la llegada dada por hecha a mano no es ningún cobro");
  assert.deepEqual(par([m], [detectado({ estado: "confirmado", llegadaRef: "mercury:otra" })]), []);
  assert.deepEqual(par([{ ...m, proveedor: "stripe" } as Movimiento], [detectado({ estado: "confirmado" })]), [], "la misma referencia en otra pasarela no es el mismo depósito");
  /* Un pase cargado a mano el día que salió, al que la cuenta le vio la llegada después (Aldana, 11/11): también. */
  assert.deepEqual(par([m], [detectado({ estado: "confirmado", origen: "manual", id: "tra_mano" })]), [`${m.id}>tra_mano`]);
  assert.deepEqual(cobrosQueYaSonPases(undefined, undefined), []);
});
