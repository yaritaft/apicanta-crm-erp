import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { cobradoDeVenta, gruposDeVentasRepetidas, ventaParaDejar, ventasIdenticas, mismaPersona } from "@/lib/ventas-repetidas";
import { construirSemilla } from "@/lib/seed";
import type { Alumno, Cuota, Devolucion, EstadoApp, Movimiento, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Aldana (24/10): «hay ventas que se cargaron dos veces, y un pago lo chequeé yo con el comprobante y el otro lo concilió la pasarela. Estaría
   bueno un cartel de aviso cuando ya existe una venta idéntica»; «cancelé una venta pero me sigue apareciendo como cobrada 6000. Estaría bueno
   poder eliminar ventas». El caso: Jorge David Llamas Olivero, Hackear AI US$ 3.000, dos veces, un mismo cobro de Whop.
   ================================================================== */

const base = () => construirSemilla() as EstadoApp;
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;

const venta = (id: string, extra: Partial<Venta> = {}): Venta => ({
  id, contactoId: "lead_jorge", contactoNombre: "Jorge David Llamas Olivero", productoId: "prod_hackear_ai", precioAcordado: 3000, moneda: "USD",
  closerId: "eq_valentin", excluidoMarketing: false, estado: "activa", fecha: "2026-10-24T01:13:07.000Z", creadoEn: "2026-10-24T01:14:22.000Z", extra: {}, ...extra,
}) as Venta;
const cuota = (id: string, ventaId: string): Cuota => ({ id, ventaId, numero: 1, monto: 3000, vence: "2026-10-24T01:13:07.000Z", estado: "pagada", esReserva: false }) as Cuota;
const pago = (id: string, cuotaId: string, extra: Partial<Pago> = {}): Pago => ({
  id, cuotaId, procesadorId: "proc_whop", monto: 3000, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: "2026-10-24T01:13:27.000Z", creadoEn: "2026-10-24T01:14:22.000Z", ...extra,
}) as Pago;
const movimiento = (extra: Partial<Movimiento> = {}): Movimiento => ({
  id: "mov_whop_pay_HFl", proveedor: "whop", procesadorId: "proc_whop", referencia: "pay_HFl", monto: 3000, moneda: "USD", fee: 111.37, neto: 2888.63,
  fecha: "2026-10-23T23:55:03.000Z", clienteNombre: "JORGE DAVID LLAMAS O", estado: "pendiente", origen: "api", creadoEn: "2026-10-24T00:00:00.000Z", ...extra,
}) as Movimiento;

/* Jorge: la venta de Valentín con su cobro a mano y la que se cargó después con el cobro de Whop (ya cancelada por Aldana, pero con su cobro). */
function conLasDosDeJorge(extra: Partial<EstadoApp> = {}) {
  const b = base();
  const lead = { id: "lead_jorge", nombre: "Jorge David Llamas Olivero", email: "jotallamas@gmail.com", telefono: "+56 9 5807 2467" };
  const e = {
    ...b,
    leads: [lead, ...b.leads],
    ventas: [venta("v_orig"), venta("v_dup", { contactoNombre: "JORGE DAVID LLAMAS O", estado: "cancelada", fecha: "2026-10-23T23:55:03.000Z", creadoEn: "2026-10-24T04:19:41.000Z" }), ...b.ventas],
    cuotas: [cuota("c_orig", "v_orig"), cuota("c_dup", "v_dup"), ...b.cuotas],
    pagos: [pago("p_orig", "c_orig", { chequeoFinanzas: "chequeado" }), pago("p_dup", "c_dup", { movimientoId: "mov_whop_pay_HFl", referencia: "pay_HFl", feeMonto: 111.37 }), ...b.pagos],
    movimientos: [movimiento({ estado: "conciliado", vinculado: true, pagoId: "p_dup", cuotaId: "c_dup", ventaId: "v_dup" }), ...b.movimientos],
    devoluciones: [] as Devolucion[],
    ...extra,
  } as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  return e;
}

test("el caso de Jorge: dos ventas idénticas, una cancelada que sigue sumando; la pareja se encuentra y se sabe cuál dejar", () => {
  const e = conLasDosDeJorge();
  assert.equal(cobradoDeVenta(e, "v_orig") + cobradoDeVenta(e, "v_dup"), 6000, "hoy suma 6.000 aunque una esté cancelada");
  const grupos = gruposDeVentasRepetidas(e).filter((g) => g.some((v) => v.id === "v_orig"));
  assert.deepEqual(grupos.map((g) => g.map((v) => v.id).sort()), [["v_dup", "v_orig"]]);
  assert.equal(ventaParaDejar(e, grupos[0]).id, "v_orig", "se deja la activa, la primera que se cargó");
  /* Una cancelada SIN cobros no es una repetida: no suma nada. */
  const sinCobro = { ...e, pagos: e.pagos.filter((p) => p.id !== "p_dup") } as EstadoApp;
  assert.deepEqual(gruposDeVentasRepetidas(sinCobro).filter((g) => g.some((v) => v.id === "v_orig")), []);
});

test("el aviso al cargar: la misma persona, el mismo servicio, el mismo precio y esos días; otra persona, otro precio o otra semana no avisan", () => {
  const e = conLasDosDeJorge();
  const quien = { contactoId: "lead_jorge", nombre: "Jorge David Llamas Olivero", email: "jotallamas@gmail.com" };
  const dato = { quien, productoId: "prod_hackear_ai", precioAcordado: 3000, fecha: "2026-10-24T20:00:00.000Z" };
  assert.deepEqual(ventasIdenticas(e, dato).map((v) => v.id), ["v_orig", "v_dup"], "las dos ya cargadas (la cancelada también, porque sigue cobrada)");
  /* Por mail o por teléfono, aunque el nombre y el contacto cambien. */
  assert.equal(ventasIdenticas(e, { ...dato, quien: { nombre: "J. Llamas", email: "JOTALLAMAS@gmail.com" } }).length >= 1, true);
  assert.equal(ventasIdenticas(e, { ...dato, quien: { nombre: "Otro", telefono: "56958072467" } }).length >= 1, true);
  assert.deepEqual(ventasIdenticas(e, { ...dato, quien: { nombre: "Mariana Lopez", email: "mari@x.com" } }), [], "otra persona");
  assert.deepEqual(ventasIdenticas(e, { ...dato, precioAcordado: 2500 }), [], "otro precio");
  assert.deepEqual(ventasIdenticas(e, { ...dato, fecha: "2026-11-20T00:00:00.000Z" }), [], "otro mes");
  assert.deepEqual(ventasIdenticas(e, { ...dato, productoId: "prod_hackear_it" }), [], "otro servicio");
  assert.equal(mismaPersona({ nombre: "Sebastian" }, { nombre: "Sebastian Vega" }), false, "un nombre parecido no alcanza");
});

test("eliminar la repetida: se va con su cobro, el cobro de Whop se ata al pago idéntico de la venta que queda y la suma vuelve a 3.000", () => {
  conLasDosDeJorge();
  const r = acciones.eliminarVenta("v_dup", "Cargada dos veces: el mismo cobro", { reatarA: "v_orig" });
  assert.deepEqual(r, { ok: true, cobros: 1, cuotas: 1, reatados: 1 });
  const e = estado();
  assert.equal(e.ventas.some((v) => v.id === "v_dup"), false);
  assert.equal(e.cuotas.some((c) => c.ventaId === "v_dup"), false);
  assert.equal(e.pagos.some((p) => p.id === "p_dup"), false);
  assert.equal(cobradoDeVenta(e, "v_orig"), 3000, "ya no suma 6.000");
  const m = e.movimientos.find((x) => x.id === "mov_whop_pay_HFl")!;
  assert.deepEqual([m.estado, m.pagoId, m.ventaId], ["conciliado", "p_orig", "v_orig"]);
  const p = e.pagos.find((x) => x.id === "p_orig")!;
  assert.equal(p.movimientoId, "mov_whop_pay_HFl");
  assert.equal(p.feeMonto, 111.37, "toma la comisión real de la pasarela");
  assert.ok(e.actividad.some((a) => /Se eliminó la venta/.test(a.detalle ?? "") && /el mismo cobro/.test(a.detalle ?? "")), "queda en la actividad con el motivo");
  assert.deepEqual(gruposDeVentasRepetidas(e).filter((g) => g.some((v) => v.id === "v_orig")), []);
});

test("sin reatar: el cobro de la pasarela vuelve a la bandeja (pendiente, sin venta)", () => {
  conLasDosDeJorge();
  const r = acciones.eliminarVenta("v_dup", "Cargada dos veces");
  assert.deepEqual(r, { ok: true, cobros: 1, cuotas: 1, reatados: 0 });
  const m = estado().movimientos.find((x) => x.id === "mov_whop_pay_HFl")!;
  assert.deepEqual([m.estado, m.pagoId ?? null, m.ventaId ?? null], ["pendiente", null, null]);
});

test("sin motivo, o con devoluciones cargadas, no se elimina nada", () => {
  conLasDosDeJorge();
  const r1 = acciones.eliminarVenta("v_dup", "  ");
  assert.equal(r1.ok, false);
  conLasDosDeJorge({ devoluciones: [{ id: "dev1", ventaId: "v_dup", monto: 100, moneda: "USD", fecha: "2026-10-24T00:00:00.000Z", estado: "confirmada", noDescontarAlCloser: false, creadoEn: "2026-10-24T00:00:00.000Z", extra: {} } as Devolucion] });
  const r2 = acciones.eliminarVenta("v_dup", "Cargada dos veces");
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /devoluciones/);
  assert.equal(estado().ventas.some((v) => v.id === "v_dup"), true);
});

test("una venta que el cliente no pagó se elimina con sus cuotas; su servicio pasa a la otra venta o queda de baja", () => {
  const b = base();
  const e = {
    ...b, ventas: [venta("v_sin_pago", { contactoId: "lead_x", contactoNombre: "Andres Gallego" }), ...b.ventas],
    cuotas: [{ ...cuota("c_sp", "v_sin_pago"), estado: "pendiente" as const }, ...b.cuotas],
    alumnos: [{ id: "alu_sp", nombre: "Andres Gallego", ventaId: "v_sin_pago", estado: "activo", extra: {} } as unknown as Alumno, ...b.alumnos],
  } as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  const r = acciones.eliminarVenta("v_sin_pago", "Dante la cargó y el cliente no pagó");
  assert.deepEqual(r, { ok: true, cobros: 0, cuotas: 1, reatados: 0 });
  const despues = estado();
  assert.equal(despues.ventas.some((v) => v.id === "v_sin_pago"), false);
  const alumno = despues.alumnos.find((a) => a.id === "alu_sp")!;
  assert.equal(alumno.estado, "baja", "su servicio queda de baja (se puede reactivar)");
  assert.equal(alumno.ventaId ?? null, null);
});
