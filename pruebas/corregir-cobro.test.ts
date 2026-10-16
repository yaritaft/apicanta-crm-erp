import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { candadoDeCobro, corrigeSiempre } from "@/lib/candado-cobro";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { EstadoApp, Movimiento, Pago } from "@/lib/types";

/* Corregir y borrar un cobro ya cargado (daily con los closers, 16/10): el store de verdad, sin nube. */
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const pagoDe = (id: string) => estado().pagos.find((p) => p.id === id) as Pago | undefined;
const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};
const DATOS = (p: Pago, cambios: Record<string, unknown> = {}) => ({
  cobro: { procesadorId: p.procesadorId, monto: p.monto, fecha: p.fecha, referencia: p.referencia, comprobante: p.comprobante, ...cambios },
});

/* Un cobro suelto (no atado a la pasarela) de una cuota que quedó saldada con ese solo cobro. Las pruebas comparten el estado: cada una toma uno nuevo. */
const usados = new Set<string>();
function elegir(): { pago: Pago; cuotaId: string } {
  const e = estado();
  for (const p of e.pagos) {
    if (usados.has(p.id) || p.movimientoId || p.chequeoFinanzas || p.monto < 50) continue;
    const c = e.cuotas.find((x) => x.id === p.cuotaId);
    const venta = c ? e.ventas.find((v) => v.id === c.ventaId) : undefined;
    const delaCuota = e.pagos.filter((x) => x.cuotaId === p.cuotaId);
    if (c && venta?.estado === "activa" && c.estado === "pagada" && delaCuota.length === 1 && Math.abs(c.monto - p.monto) < 0.01) {
      usados.add(p.id);
      return { pago: p, cuotaId: c.id };
    }
  }
  throw new Error("no hay un cobro así en la semilla");
}

test("el candado: Finanzas lo chequeó o el mes está liquidado; quien carga se frena, Finanzas y los dueños no", () => {
  const closer = acceso("closer"), director = acceso("director"), admin = acceso("admin");
  assert.deepEqual(candadoDeCobro({}, closer), { bloqueado: false });
  assert.equal(candadoDeCobro({ chequeoFinanzas: "chequeado" }, closer).bloqueado, true);
  assert.equal(candadoDeCobro({ chequeoFinanzas: "chequeado" }, director).bloqueado, true);
  assert.equal(candadoDeCobro({ chequeoFinanzas: "rechazado" }, closer).bloqueado, false, "un cobro rechazado se corrige");
  assert.equal(candadoDeCobro({}, closer, true).bloqueado, true, "mes cerrado");
  assert.match(candadoDeCobro({}, closer, true).motivo ?? "", /liquidación/);
  for (const a of [ACCESO_DUENO, admin]) {
    assert.ok(corrigeSiempre(a));
    const c = candadoDeCobro({ chequeoFinanzas: "chequeado" }, a, true);
    assert.equal(c.bloqueado, false, "corrige siempre");
    assert.ok(c.motivo, "pero se le avisa por qué conviene mirar");
  }
  assert.equal(candadoDeCobro({ chequeoFinanzas: "chequeado" }, null).bloqueado, true, "sin acceso: no es de Finanzas");
});

test("corregir el monto de un cobro: mismo id, quién lo cargó se mantiene, la cuota vuelve a pendiente y queda en la actividad", () => {
  fijarAcceso(null);
  const { pago, cuotaId } = elegir();
  const antes = estado();
  const cargadoPor = pago.cargadoPor;
  const nuevo = Math.round(pago.monto / 2);
  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { monto: nuevo })), true);
  const despues = estado();
  const ya = despues.pagos.find((p) => p.id === pago.id)!;
  assert.equal(ya.monto, nuevo);
  assert.equal(ya.cargadoPor, cargadoPor, "quién lo cargó no cambia");
  assert.equal(ya.creadoEn, pago.creadoEn);
  assert.equal(despues.pagos.length, antes.pagos.length, "se corrige, no se duplica");
  assert.equal(despues.cuotas.find((c) => c.id === cuotaId)!.estado, "pendiente", "ya no cubre la cuota");
  assert.match(despues.actividad[0].detalle, /Se corrigió un cobro/);
  assert.match(despues.actividad[0].detalle, new RegExp(`el monto de ${pago.monto} a ${nuevo}`));

  /* Y al volver a subirlo, la cuota se salda otra vez. */
  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { monto: pago.monto })), true);
  assert.equal(estado().cuotas.find((c) => c.id === cuotaId)!.estado, "pagada");
});

test("cambiar el monto, el día o la prueba deja sin efecto lo que ya había chequeado el director; cambiar la referencia, no", () => {
  fijarAcceso(null);
  const { pago } = elegir();
  assert.equal(acciones.chequearPago(pago.id, { casillero: "director", veredicto: "chequeado" }), true);
  assert.equal(pagoDe(pago.id)!.chequeoDirector, "chequeado");

  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { referencia: "otra referencia" })), true);
  assert.equal(pagoDe(pago.id)!.chequeoDirector, "chequeado", "sólo la referencia: el chequeo sigue");

  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { monto: pago.monto + 1 })), true);
  assert.equal(pagoDe(pago.id)!.chequeoDirector, undefined, "otro monto: había que chequearlo de nuevo");
});

test("un closer no corrige ni borra un cobro que Finanzas ya chequeó; con el chequeo de Finanzas sacado, sí", () => {
  fijarAcceso(null);
  const { pago } = elegir();
  assert.equal(acciones.chequearPago(pago.id, { casillero: "finanzas", veredicto: "chequeado" }), true);

  fijarAcceso(acceso("closer"));
  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { monto: pago.monto + 5 })), false, "se frena");
  assert.equal(acciones.eliminarPago(pago.id), false, "y tampoco se borra");
  assert.equal(pagoDe(pago.id)!.monto, pago.monto, "no cambió nada");

  fijarAcceso(acceso("admin"));
  assert.equal(acciones.corregirPago(pago.id, DATOS(pago, { monto: pago.monto + 5 })), true, "Finanzas corrige igual");
  fijarAcceso(null);
});

test("borrar un cobro: desaparece, la cuota vuelve a pendiente y queda en la actividad", () => {
  fijarAcceso(null);
  const { pago, cuotaId } = elegir();
  const antes = estado();
  assert.equal(acciones.eliminarPago(pago.id), true);
  const despues = estado();
  assert.equal(despues.pagos.length, antes.pagos.length - 1);
  assert.equal(pagoDe(pago.id), undefined);
  assert.equal(despues.cuotas.find((c) => c.id === cuotaId)!.estado, "pendiente");
  assert.match(despues.actividad[0].detalle, /Se borró un cobro/);
  assert.equal(acciones.eliminarPago("pag_que_no_existe"), false);
});

test("corregir un cobro atado a la pasarela: el pago viejo se libera, el nuevo se concilia, y soltarlo lo deja sin el tilde", () => {
  fijarAcceso(null);
  const e0 = estado();
  /* Dos pagos de pasarela sin conciliar, del mismo proveedor y de montos distintos. */
  const libres = e0.movimientos.filter((m) => m.estado === "pendiente" && m.monto > 20);
  const porProveedor = new Map<string, Movimiento[]>();
  for (const m of libres) porProveedor.set(m.proveedor, [...(porProveedor.get(m.proveedor) ?? []), m]);
  const par = [...porProveedor.values()].find((xs) => xs.length >= 2);
  assert.ok(par, "la semilla trae pagos de pasarela sin conciliar");
  const [a, b] = par!;
  const cuota = e0.cuotas.find((c) => c.estado === "pendiente" && e0.ventas.find((v) => v.id === c.ventaId)?.estado === "activa" && c.monto >= Math.max(a.monto, b.monto));
  assert.ok(cuota, "una cuota pendiente que alcance");

  /* Se carga el cobro atado a A (por la acción de siempre) y se busca el pago que quedó. */
  assert.equal(acciones.registrarPago({ cuotaId: cuota!.id, cobros: [{ procesadorId: a.procesadorId, monto: a.monto, fecha: a.fecha, movimientoId: a.id }], reajuste: "pendiente" }), true);
  const pago = estado().pagos.find((p) => p.movimientoId === a.id)!;
  assert.equal(estado().movimientos.find((m) => m.id === a.id)!.estado, "conciliado");

  /* Se corrige para que sea el pago B: A queda libre y B conciliado. */
  assert.equal(acciones.corregirPago(pago.id, { cobro: { procesadorId: b.procesadorId, monto: b.monto, fecha: b.fecha, movimientoId: b.id } }), true);
  const e1 = estado();
  assert.equal(e1.movimientos.find((m) => m.id === a.id)!.estado, "pendiente", "el viejo se libera");
  assert.equal(e1.movimientos.find((m) => m.id === a.id)!.pagoId, undefined);
  assert.equal(e1.movimientos.find((m) => m.id === b.id)!.estado, "conciliado");
  assert.equal(e1.movimientos.find((m) => m.id === b.id)!.pagoId, pago.id);
  assert.equal(e1.pagos.find((p) => p.id === pago.id)!.movimientoId, b.id);

  /* Se suelta de la pasarela (queda como cobro con comprobante): B se libera. */
  assert.equal(acciones.corregirPago(pago.id, { cobro: { procesadorId: b.procesadorId, monto: b.monto, fecha: b.fecha } }), true);
  const e2 = estado();
  assert.equal(e2.movimientos.find((m) => m.id === b.id)!.estado, "pendiente");
  assert.equal(e2.pagos.find((p) => p.id === pago.id)!.movimientoId, undefined);

  /* Borrarlo no deja ningún movimiento colgado. */
  assert.equal(acciones.corregirPago(pago.id, { cobro: { procesadorId: a.procesadorId, monto: a.monto, fecha: a.fecha, movimientoId: a.id } }), true);
  assert.equal(acciones.eliminarPago(pago.id), true);
  const e3 = estado();
  assert.equal(e3.movimientos.find((m) => m.id === a.id)!.estado, "pendiente");
  assert.equal(e3.pagos.some((p) => p.movimientoId === a.id), false);
});
