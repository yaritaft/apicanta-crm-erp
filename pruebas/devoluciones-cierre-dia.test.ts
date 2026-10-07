import test from "node:test";
import assert from "node:assert/strict";
import { ventasSinCierre } from "@/lib/cierre-del-dia";
import { reversasDeComision } from "@/lib/devoluciones";
import { comisionesDelMes } from "@/lib/finanzas";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp, Sesion } from "@/lib/types";
import { OCTUBRE, SEPTIEMBRE, devolucion, estadoDeYari, iso } from "./estado-devolucion";

/* ==================================================================
   Devolución + descuento por cierre del día (los dos lotes juntos).

   Con el interruptor prendido, a Mariano no se le paga la comisión de una
   venta que salió de una llamada de un día sin cierre a tiempo. Si después
   esa venta se devuelve, no hay nada que revertirle: no se le pagó. Al
   director sí se le revierte lo que se le comisionó. Con el interruptor
   apagado, todo igual que antes.
   ================================================================== */

const TIPO = "Llamada de Asesoramiento - Webinar - Team";
const llamada: Sesion = {
  id: "cal_v1", titulo: TIPO, tipo: TIPO, invitado: "Belén Godoy", inicia: iso(SEPTIEMBRE, 28), duracionMin: 45, estado: "hecha",
  origen: "calendly", creadoEn: iso(SEPTIEMBRE, 27), extra: {}, anfitrion: "Mariano Arias",
  /* Se cargó al otro día: ese 28/09 es un día con strike. */
  estadoLlamada: "Compra Cuotas", estadoLlamadaEn: iso(SEPTIEMBRE, 29, 18),
} as Sesion;

function escenario(prendido: boolean): EstadoApp {
  const base = estadoDeYari();
  return {
    ...base,
    sesiones: [llamada],
    ventas: base.ventas.map((v) => ({ ...v, sesionId: "cal_v1" })),
    devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })],
    ajustes: { ...base.ajustes, crm: { cierreDelDia: { cuentaDesde: "2026-09-01", descuenta: prendido, descuentaDesde: "2026-09-01" } } },
  } as EstadoApp;
}

test("prendido y con la venta sin cierre a tiempo, no se le revierte al closer lo que no se le pagó", () => {
  const e = escenario(true);
  assert.deepEqual([...ventasSinCierre(e)], ["v1"], "la venta es de un día con strike");
  const [r] = reversasDeComision(e);
  const closer = r.partes.find((p) => p.rol === "closer")!;
  const director = r.partes.find((p) => p.rol === "director")!;
  assert.equal(closer.reversa, 0, "a Mariano no se le pagó esa comisión");
  /* Al director sí: 5% de lo cobrado post pasarelas (2 × 1.455 = 2.910) = 145,50. */
  assert.equal(director.reversa, 145.5);

  /* Finanzas dice lo mismo: octubre revierte sólo al director. */
  const filas = comisionesDelMes(e, rangoDePeriodo(OCTUBRE)).filter((f) => f.devolucionId);
  assert.equal(filas.reduce((a, f) => a + f.comisionCloser, 0), 0);
  assert.equal(filas.reduce((a, f) => a + f.comisionDirector, 0), -145.5);
});

test("apagado, se le revierte todo lo comisionado: igual que antes del cierre del día", () => {
  const e = escenario(false);
  assert.equal(ventasSinCierre(e).size, 0);
  const [r] = reversasDeComision(e);
  assert.equal(r.partes.find((p) => p.rol === "closer")!.reversa, 436.5, "15% de 2.910");
  assert.equal(r.partes.find((p) => p.rol === "director")!.reversa, 145.5);
});
