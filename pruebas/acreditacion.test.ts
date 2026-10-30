import test from "node:test";
import assert from "node:assert/strict";
import { estaPorAcreditar, fechaDeAcreditacion, porAcreditar, retenciones } from "@/lib/acreditacion";
import { cobrado, comisionesDelMes } from "@/lib/finanzas";
import { saldosEsperados } from "@/lib/traspasos";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Cuándo se acredita un cobro (Aldana, 28/10/2026): Hotmart retiene lo cobrado y lo acredita 15 días después; hasta entonces el cobro no
   cuenta en la caja ni en las comisiones.
   ================================================================== */

const CUENTAS = [
  { id: "proc_hotmart", diasDeRetencion: 15, retencionDesde: "2026-10-26" },
  { id: "proc_stripe" },
  { id: "proc_sin_dias", diasDeRetencion: 0 },
];

test("sólo retienen las cuentas con días", () => {
  const r = retenciones(CUENTAS);
  assert.deepEqual([...r.keys()], ["proc_hotmart"]);
  assert.equal(retenciones(undefined).size, 0);
});

test("un cobro de la cuenta que retiene se acredita 15 días después, desde la fecha de inicio; los anteriores y los de otras cuentas, al instante", () => {
  const r = retenciones(CUENTAS);
  const hotmart = (fecha: string) => ({ fecha, procesadorId: "proc_hotmart" });
  assert.equal(fechaDeAcreditacion(hotmart("2026-10-27T15:00:00.000Z"), r).slice(0, 10), "2026-11-11", "entró el 27/10 y se ve acreditado el 11/11");
  assert.equal(fechaDeAcreditacion(hotmart("2026-10-20T15:00:00.000Z"), r).slice(0, 10), "2026-10-20", "antes de la fecha de inicio: como siempre");
  assert.equal(fechaDeAcreditacion({ fecha: "2026-10-27T15:00:00.000Z", procesadorId: "proc_stripe" }, r).slice(0, 10), "2026-10-27");
  assert.equal(fechaDeAcreditacion({ fecha: "2026-10-27T15:00:00.000Z" }, r).slice(0, 10), "2026-10-27");
  const ahora = Date.parse("2026-10-30T12:00:00.000Z");
  assert.equal(estaPorAcreditar(hotmart("2026-10-27T15:00:00.000Z"), r, ahora), true);
  assert.equal(estaPorAcreditar(hotmart("2026-10-27T15:00:00.000Z"), r, Date.parse("2026-11-12T12:00:00.000Z")), false);
  assert.equal(estaPorAcreditar(hotmart("2026-10-20T15:00:00.000Z"), r, ahora), false);
});

/* La liquidación de prueba tiene cobros de septiembre por Hotmart (p3 el 8, p5 el 14): con 20 días de retención desde el 1/9, p5 pasa a octubre. */
function conRetencion(): EstadoApp {
  const e = estadoDePrueba();
  return { ...e, procesadores: e.procesadores.map((p) => (p.id === "proc_hotmart" ? { ...p, diasDeRetencion: 20, retencionDesde: "2026-09-01" } : p)) } as EstadoApp;
}

test("el cobrado del mes cuenta cada cobro el día que se acredita", () => {
  const sin = estadoDePrueba();
  const con = conRetencion();
  const sep = rangoDePeriodo(PERIODO);
  const oct = rangoDePeriodo("2026-10");
  const p5 = sin.pagos.find((p) => p.id === "p5")!;
  const p3 = sin.pagos.find((p) => p.id === "p3")!;
  assert.equal(cobrado(sin, oct), 0);
  /* p3 (8/9) se acredita el 28/9 y p5 (14/9) el 4/10: p5 sale de septiembre y entra en octubre. */
  assert.equal(cobrado(con, sep), cobrado(sin, sep) - p5.monto);
  assert.equal(cobrado(con, oct), p5.monto);
  assert.ok(p3.monto > 0);
});

test("las comisiones de un closer salen de lo acreditado: lo que todavía no se acredita no comisiona", () => {
  const sin = estadoDePrueba();
  const con = conRetencion();
  const sep = rangoDePeriodo(PERIODO);
  const de = (e: EstadoApp) => comisionesDelMes(e, sep).reduce((a, c) => a + c.cobradoEnMes, 0);
  assert.ok(de(con) < de(sin), "con el cobro de Hotmart fuera de septiembre, comisiona menos ese mes");
});

test("la caja espera el cobro de una cuenta que retiene el día que se acredita", () => {
  const con = conRetencion();
  const hastaSep = saldosEsperados(con, undefined, "2026-09-30T23:59:59.000Z").get("proc_hotmart")!;
  const hastaOct = saldosEsperados(con, undefined, "2026-10-10T23:59:59.000Z").get("proc_hotmart")!;
  assert.ok(hastaOct.entro > hastaSep.entro, "p5 entra a la caja de Hotmart el 4/10, no el 14/9");
});

test("lo que está por acreditar: cuántos cobros y cuánto", () => {
  const con = conRetencion();
  const p5 = con.pagos.find((p) => p.id === "p5")!;
  const r = porAcreditar(con, Date.parse("2026-10-01T12:00:00.000Z"));
  assert.equal(r.cobros, 1);
  assert.equal(r.monto, Math.round((p5.monto - p5.feeMonto) * 100) / 100);
  assert.deepEqual(porAcreditar(estadoDePrueba()), { cobros: 0, monto: 0 });
});
