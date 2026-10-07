import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { controlDeCobro } from "@/lib/control-cobros";
import { cashCollected } from "@/lib/finanzas";
import { rangoDeFechas } from "@/lib/metricas";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { Comprobante, EstadoApp, Pago } from "@/lib/types";

/* El store de verdad, sin nube (la semilla de ejemplo): lo que hacen las acciones del control cruzado. */
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const pagoDe = (id: string) => estado().pagos.find((p) => p.id === id) as Pago;
const todo = rangoDeFechas("2000-01-01", "2100-12-31", "todo");

const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};
const archivo = (ruta: string): Comprobante => ({ ruta, nombre: `${ruta}.png`, tipo: "image/png", tamanio: 1234, subidoEn: "2026-10-06T10:00:00.000Z" });

/* Un cobro que no está atado a la pasarela y todavía no tiene nada (las pruebas comparten el estado: cada una toma uno nuevo). */
const elegir = () => estado().pagos.find((p) => !p.movimientoId && !p.comprobante && controlDeCobro(p).estado === "pendiente")!;

test("chequear deja escrito quién y cuándo, queda en la actividad y no toca ningún número", () => {
  fijarAcceso(null);
  const antes = estado();
  const p = elegir();
  const cc = cashCollected(antes, todo);
  assert.equal(controlDeCobro(p).estado, "pendiente");

  assert.equal(acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: "chequeado" }), true);
  const despues = estado();
  const ya = despues.pagos.find((x) => x.id === p.id)!;
  assert.equal(ya.chequeoFinanzas, "chequeado");
  assert.ok(ya.chequeoFinanzasPor, "quién");
  assert.ok(ya.chequeoFinanzasEn, "cuándo");
  assert.equal(controlDeCobro(ya).estado, "chequeado");
  assert.match(despues.actividad[0].detalle, /lo chequeó finanzas/);
  assert.equal(cashCollected(despues, todo), cc, "el Cash Collected es el mismo");
  assert.deepEqual([ya.monto, ya.feeMonto, ya.fecha], [p.monto, p.feeMonto, p.fecha]);
  assert.equal(despues.pagos.length, antes.pagos.length);

  /* Quitarlo vuelve a pendiente. */
  assert.equal(acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: null }), true);
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "pendiente");
  assert.equal(pagoDe(p.id).chequeoFinanzasPor, undefined);
});

test("rechazar pide el motivo, y el rechazo manda hasta que se arregla", () => {
  fijarAcceso(null);
  const p = elegir();
  assert.equal(acciones.chequearPago(p.id, { casillero: "director", veredicto: "rechazado" }), false, "sin motivo no");
  assert.equal(acciones.chequearPago(p.id, { casillero: "director", veredicto: "rechazado", nota: "   " }), false);
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "pendiente");

  assert.equal(acciones.chequearPago(p.id, { casillero: "director", veredicto: "rechazado", nota: "no coincide el monto" }), true);
  const c = controlDeCobro(pagoDe(p.id));
  assert.equal(c.estado, "rechazado");
  assert.equal(c.rechazos[0].nota, "no coincide el monto");

  /* Que finanzas lo chequee no tapa el rechazo del director. */
  acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: "chequeado" });
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "rechazado");
  /* Quien rechazó lo da por bueno cuando se arregla. */
  acciones.chequearPago(p.id, { casillero: "director", veredicto: "chequeado" });
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "chequeado");
});

test("cada tipo de cuenta usa sólo su casillero: el director el suyo, finanzas el suyo, el closer ninguno", () => {
  const p = elegir();

  fijarAcceso(acceso("closer"));
  assert.equal(acciones.chequearPago(p.id, { casillero: "director", veredicto: "chequeado" }), false);
  assert.equal(acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: "chequeado" }), false);
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "pendiente", "el closer no puede chequear");

  fijarAcceso(acceso("director"));
  assert.equal(acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: "chequeado" }), false, "el director no ve Finanzas");
  assert.equal(acciones.chequearPago(p.id, { casillero: "director", veredicto: "chequeado" }), true);
  assert.equal(pagoDe(p.id).chequeoDirector, "chequeado");
  assert.equal(pagoDe(p.id).chequeoFinanzas, undefined);

  const q = elegir();
  fijarAcceso(acceso("admin"));
  assert.equal(acciones.chequearPago(q.id, { casillero: "finanzas", veredicto: "chequeado" }), true);

  fijarAcceso(acceso("setter"));
  assert.equal(acciones.chequearPago(elegir().id, { casillero: "director", veredicto: "chequeado" }), false);
  fijarAcceso(null);
});

test("subir otro comprobante: el primero no reinicia nada; cambiar uno que ya estaba, sí", () => {
  fijarAcceso(null);
  const p = elegir();
  assert.equal(acciones.cambiarComprobante(p.id, archivo("a")), true);
  assert.equal(pagoDe(p.id).comprobante?.ruta, "a");

  acciones.chequearPago(p.id, { casillero: "director", veredicto: "chequeado" });
  acciones.chequearPago(p.id, { casillero: "finanzas", veredicto: "chequeado" });
  assert.equal(controlDeCobro(pagoDe(p.id)).chequeos.length, 2);

  assert.equal(acciones.cambiarComprobante(p.id, archivo("a")), true, "el mismo archivo no cambia nada");
  assert.equal(controlDeCobro(pagoDe(p.id)).estado, "chequeado");

  assert.equal(acciones.cambiarComprobante(p.id, archivo("b")), true);
  const ya = pagoDe(p.id);
  assert.equal(ya.comprobante?.ruta, "b");
  assert.equal(controlDeCobro(ya).estado, "pendiente", "se chequeó contra el comprobante de antes");
  assert.equal(ya.chequeoDirector, undefined);
  assert.match(estado().actividad[0].detalle, /los chequeos vuelven a quedar pendientes/);

  /* Un setter no edita los cobros. */
  fijarAcceso(acceso("setter"));
  assert.equal(acciones.cambiarComprobante(p.id, archivo("c")), false);
  assert.equal(pagoDe(p.id).comprobante?.ruta, "b");
  /* El closer sí: es quien arregla el que le rechazaron. */
  fijarAcceso(acceso("closer"));
  assert.equal(acciones.cambiarComprobante(p.id, archivo("c")), true);
  fijarAcceso(null);
});

test("un cobro que se carga ya no viene chequeado por quien lo carga, y lleva quién lo cargó", () => {
  fijarAcceso(null);
  const e = estado();
  const cuota = e.cuotas.find((c) => c.estado === "pendiente" && !e.pagos.some((p) => p.cuotaId === c.id) && e.ventas.find((v) => v.id === c.ventaId)?.estado === "activa")!;
  const proc = e.procesadores.find((p) => !p.proveedor && p.activo)!;
  const antes = e.pagos.length;
  assert.equal(acciones.registrarPago({
    cuotaId: cuota.id, reajuste: "pendiente",
    cobros: [{ procesadorId: proc.id, monto: cuota.monto, fecha: "2026-10-05T15:00:00.000Z", comprobante: archivo("transferencia") }],
  }), true);
  const despues = estado();
  assert.equal(despues.pagos.length, antes + 1);
  const nuevo = despues.pagos.find((p) => !e.pagos.some((x) => x.id === p.id))!;
  assert.equal(nuevo.chequeado, undefined, "el tilde ya no lo pone quien carga");
  assert.equal(controlDeCobro(nuevo).estado, "pendiente");
  assert.ok(nuevo.cargadoPor, "queda quién lo cargó");
  assert.equal(nuevo.comprobante?.ruta, "transferencia");
});

test("un cobro conciliado con la pasarela sigue viniendo marcado: la plata está ahí", () => {
  fijarAcceso(null);
  const e = estado();
  const mov = e.movimientos.find((m) => m.estado === "pendiente")!;
  const cuota = e.cuotas.find((c) => c.estado === "pendiente" && !e.pagos.some((p) => p.cuotaId === c.id))!;
  const antes = e.pagos.length;
  assert.equal(acciones.conciliar(mov.id, [{ cuotaId: cuota.id, monto: Math.min(mov.monto, cuota.monto) }]), true);
  const despues = estado();
  const nuevo = despues.pagos.find((p) => !e.pagos.some((x) => x.id === p.id))!;
  assert.equal(despues.pagos.length, antes + 1);
  assert.equal(nuevo.chequeado, true);
  assert.equal(controlDeCobro(nuevo).estado, "chequeado");
  assert.equal(controlDeCobro(nuevo).conciliado, true);
  assert.ok(nuevo.cargadoPor, "el que concilió");
});
