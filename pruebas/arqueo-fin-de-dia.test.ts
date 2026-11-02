import test from "node:test";
import assert from "node:assert/strict";
import { finDelDiaDeNegocio, diaDeNegocio } from "@/lib/dia-negocio";
import { saldosEsperados } from "@/lib/traspasos";
import type { Pago, Procesador } from "@/lib/types";

/* ==================================================================
   Aldana (01/11): «hay una venta de Whop que fue de ayer y me la está contando como que es de hoy». Era del 31/10 a las 21:22 (00:22 UTC del 1/11) y el arqueo
   «al 31/10» cortaba a las 20:00, así que la plata que ya estaba en Whop caía en el arqueo siguiente.
   ================================================================== */

const whop = { id: "proc_whop", nombre: "Whop", feeRate: 0.03, activo: true, automatico: true } as unknown as Procesador;
const cobro = (id: string, fecha: string): Pago => ({ id, cuotaId: "c1", monto: 500, feeMonto: 25.37, fecha, procesadorId: "proc_whop", moneda: "USD", feeRate: 0.05, creadoEn: fecha });
const e = (pagos: Pago[]) => ({ procesadores: [whop], pagos, gastos: [], traspasos: [] });
const previo = { fecha: "2026-10-26T06:34:00.545Z", saldos: [{ procesadorId: "proc_whop", moneda: "USD" as const, monto: 1000, montoBase: 1000 }] };

test("el final de un día es el último instante de ese día en Argentina", () => {
  assert.equal(finDelDiaDeNegocio("2026-10-31"), "2026-11-01T02:59:59.999Z");
  assert.equal(diaDeNegocio(finDelDiaDeNegocio("2026-10-31")), "2026-10-31", "sigue siendo del 31/10");
  assert.equal(diaDeNegocio(new Date(Date.parse(finDelDiaDeNegocio("2026-10-31")) + 1).toISOString()), "2026-11-01", "un instante después ya es del 1/11");
  assert.equal(finDelDiaDeNegocio("2026-12-31"), "2027-01-01T02:59:59.999Z", "pasa de año");
});

test("un arqueo al 31/10 cuenta lo cobrado a las 21:22 de ese día; el de las 20:00 de antes lo dejaba para el siguiente", () => {
  const noche = cobro("p_noche", "2026-11-01T00:22:02.000Z");       // 31/10 21:22 en Argentina
  const dia = cobro("p_dia", "2026-10-30T15:00:00.000Z");
  const hasta = saldosEsperados(e([dia, noche]), previo, finDelDiaDeNegocio("2026-10-31")).get("proc_whop")!;
  assert.equal(hasta.entro, 949.26, "los dos cobros (2 × 474,63)");
  const alasVeinte = saldosEsperados(e([dia, noche]), previo, "2026-10-31T23:00:00.000Z").get("proc_whop")!;
  assert.equal(alasVeinte.entro, 474.63, "con el corte viejo (20:00) el de la noche quedaba afuera");
  /* Y lo del 1/11 sigue siendo del arqueo siguiente. */
  const delUno = cobro("p_uno", "2026-11-01T14:00:00.000Z");
  assert.equal(saldosEsperados(e([dia, noche, delUno]), previo, finDelDiaDeNegocio("2026-10-31")).get("proc_whop")!.entro, 949.26);
});
