import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { contactoDeVenta, cuotasQuePagaronVencidas, vencidasConSeguimiento } from "@/lib/cobranza-seguimiento";
import type { Cuota, EstadoApp, Lead, Pago, Venta } from "@/lib/types";

/* ==================================================================
   El seguimiento de las cuotas vencidas (Aldana, 28/10): el closer ve las atrasadas de sus clientes con el teléfono y marca cómo va
   el cobro; cuando paga, queda un día como «Pagó».
   ================================================================== */

const AHORA = Date.parse("2026-10-28T15:00:00.000Z");
const dia = (d: string, h = 15) => `${d}T${String(h).padStart(2, "0")}:00:00.000Z`;
const venta = (id: string, closerId: string, contactoId: string, extra: Partial<Venta> = {}): Venta =>
  ({ id, contactoNombre: `Cliente ${id}`, contactoId, precioAcordado: 2000, moneda: "USD", estado: "activa", fecha: dia("2026-09-01"), productoId: "p", closerId, excluidoMarketing: false, creadoEn: dia("2026-09-01"), extra, ...extra }) as unknown as Venta;
const cuota = (id: string, ventaId: string, numero: number, monto: number, vence: string, extra: Partial<Cuota> = {}): Cuota =>
  ({ id, ventaId, numero, monto, vence, estado: "pendiente", esReserva: false, ...extra });
const pago = (id: string, cuotaId: string, monto: number, fecha: string): Pago =>
  ({ id, cuotaId, monto, feeMonto: 0, fecha, procesadorId: "x", moneda: "USD", feeRate: 0, creadoEn: fecha }) as unknown as Pago;
const lead = (id: string, telefono: string, pais: string): Lead => ({ id, nombre: id, email: `${id}@x.com`, telefono, pais }) as unknown as Lead;

function estado(): EstadoApp {
  return {
    ...(construirSemilla() as EstadoApp),
    leads: [lead("l1", "+54 9 11 5555-1234", "Argentina"), lead("l2", "", "")],
    contactos: [],
    ventas: [venta("v1", "dante", "l1"), venta("v2", "mariano", "l2"), venta("v3", "dante", "l1"), venta("v4", "dante", "l1", { estado: "cancelada" })],
    cuotas: [
      cuota("c1", "v1", 2, 500, dia("2026-10-10")),                   // vencida hace 18 días, de Dante
      cuota("c2", "v2", 2, 700, dia("2026-10-20")),                   // vencida, de Mariano
      cuota("c3", "v3", 2, 300, dia("2026-10-25"), { estado: "pagada" }), // se pagó ayer, vencía el 25: estaba atrasada
      cuota("c4", "v1", 3, 500, dia("2026-12-10")),                   // todavía no vence
      cuota("c5", "v4", 2, 100, dia("2026-10-01")),                   // venta cancelada: no cuenta
      cuota("c6", "v3", 3, 250, dia("2026-10-27"), { estado: "pagada" }), // se pagó en fecha: nunca estuvo vencida
    ],
    pagos: [pago("p3", "c3", 300, dia("2026-10-28", 10)), pago("p6", "c6", 250, dia("2026-10-27", 12))],
    actividad: [],
  };
}

test("el teléfono de la persona: del contacto o del lead que todavía lo guarda", () => {
  const e = estado();
  assert.deepEqual(contactoDeVenta(e, { contactoId: "l1" }), { telefono: "+54 9 11 5555-1234", pais: "Argentina" });
  assert.deepEqual(contactoDeVenta(e, { contactoId: "l2" }), { telefono: undefined, pais: undefined });
  assert.deepEqual(contactoDeVenta(e, {}), {});
});

test("un closer ve sus cuotas vencidas, las más atrasadas primero, con el teléfono de cada cliente", () => {
  const e = estado();
  const dante = vencidasConSeguimiento(e, "dante", AHORA);
  assert.deepEqual(dante.map((f) => f.cuota.id), ["c1"], "la de Mariano, la que vence en diciembre y la de la venta cancelada no");
  assert.equal(dante[0].telefono, "+54 9 11 5555-1234");
  assert.equal(dante[0].vencida.diasAtraso, 18);
  assert.deepEqual(vencidasConSeguimiento(e, "mariano", AHORA).map((f) => f.cuota.id), ["c2"]);
  assert.deepEqual(vencidasConSeguimiento(e, null, AHORA).map((f) => f.cuota.id), ["c1", "c2"], "sin closer, todas (Finanzas)");
});

test("las que estaban vencidas y se cobraron hace poco figuran como «pagó»; las que se pagaron en fecha, no", () => {
  const e = estado();
  const dante = cuotasQuePagaronVencidas(e, "dante", AHORA);
  assert.deepEqual(dante.map((f) => f.cuota.id), ["c3"]);
  assert.equal(dante[0].diasTarde, 3);
  assert.deepEqual(cuotasQuePagaronVencidas(e, "mariano", AHORA), []);
  /* Pasado un día y medio, ya no aparece. */
  assert.deepEqual(cuotasQuePagaronVencidas(e, "dante", AHORA + 48 * 3_600_000), []);
  assert.deepEqual(cuotasQuePagaronVencidas(e, null, AHORA).map((f) => f.cuota.id), ["c3"]);
});

test("el almacén: marcar cómo va el cobro, cambiarlo y sacarlo; queda en la actividad y no toca el resto de la cuota", () => {
  assert.equal(acciones.importar(JSON.stringify(estado())), true);
  const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;
  const c1 = () => hoy().cuotas.find((c) => c.id === "c1")!;

  acciones.seguirCobro("c1", "contactado", "  Dijo que paga el viernes ");
  assert.equal(c1().seguimientoCobro?.estado, "contactado");
  assert.equal(c1().seguimientoCobro?.nota, "Dijo que paga el viernes");
  assert.ok(c1().seguimientoCobro?.por && c1().seguimientoCobro?.en);
  assert.equal(c1().monto, 500);
  assert.equal(c1().estado, "pendiente");
  assert.match(hoy().actividad[0].detalle ?? "", /Cobranza de la cuota 2: contactado/);

  acciones.seguirCobro("c1", "baja");
  assert.equal(c1().seguimientoCobro?.estado, "baja");
  assert.equal(c1().seguimientoCobro?.nota, undefined, "sin nota nueva, queda sin nota");

  acciones.seguirCobro("c1", null);
  assert.equal("seguimientoCobro" in c1(), false, "sacar la marca la borra");
  assert.match(hoy().actividad[0].detalle ?? "", /Se sacó la marca de cobranza/);

  acciones.seguirCobro("no-existe", "contactado");
  assert.equal(hoy().actividad.length, 3, "una cuota que no existe no deja nada");
});
