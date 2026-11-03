import test from "node:test";
import assert from "node:assert/strict";
import { auditarCaja } from "@/lib/auditoria-caja";
import { arqueoVivo, esperadoDelArqueo } from "@/lib/arqueo";
import { saldosEsperados } from "@/lib/traspasos";
import { MENSAJE_CUENTA_EN_PESOS, problemasDelGasto } from "@/lib/carga-gasto";
import { construirSemilla } from "@/lib/seed";
import type { Arqueo, EstadoApp, Gasto, Pago, Procesador, Traspaso } from "@/lib/types";

/* ==================================================================
   Lo que apareció al revisar la caja con los datos reales (03/11), además del arqueo del 31/10:
   - un cobro de US$ 65 a la Financiera ARS anotado sin su tipo de cambio: la cuenta lo ignoraba y el total no;
   - el pago a ARCA (US$ 3.311,69) cargado en dólares desde la Financiera ARS: la cuenta no lo descontaba;
   - el esperado del arqueo era una foto: corregida la cuenta, el paso seguía mostrando la diferencia vieja.
   ================================================================== */

const proc = (id: string, nombre: string, moneda: "USD" | "ARS" = "USD"): Procesador => ({ id, nombre, moneda, feeRate: 0, activo: true, automatico: false });
const PROCESADORES = [proc("proc_mercury", "ACH-WIRE Mercury"), proc("proc_fin_ars", "Financiera ARS Juan", "ARS"), proc("proc_whop", "Whop")];
const A0 = "2026-10-08T01:00:00.000Z", A1 = "2026-10-21T04:00:00.000Z";
const pago = (id: string, procesadorId: string, monto: number, fecha: string, extra: Partial<Pago> = {}): Pago => ({ id, cuotaId: `c_${id}`, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha, creadoEn: fecha, ...extra });
const gasto = (id: string, monto: number, fecha: string, extra: Record<string, unknown>, cambios: Partial<Gasto> = {}): Gasto => ({ id, categoria: "Software", grupo: "operativo", concepto: id, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha, extra, ...cambios });
const arqueo0: Arqueo = {
  id: "a0", fecha: A0, total: 2000, creadoEn: A0, esperado: null, diferencia: null, tipoCambio: 1600,
  saldos: [{ procesadorId: "proc_mercury", monto: 1000, moneda: "USD", montoBase: 1000 }, { procesadorId: "proc_fin_ars", monto: 1_600_000, moneda: "ARS", montoBase: 1000 }],
};

function estado(cambios: Partial<EstadoApp> = {}): EstadoApp {
  const s = construirSemilla() as EstadoApp;
  return {
    ...s, procesadores: PROCESADORES, ventas: [], cuotas: [], pagos: [], gastos: [], devoluciones: [], movimientos: [], traspasos: [], liquidaciones: [],
    ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio: 1600 }, arqueos: [arqueo0], ...cambios,
  };
}

test("un cobro a la cuenta en pesos sin su cambio cuenta en la cuenta (con el de Ajustes), igual que en el total", () => {
  const e = estado({ pagos: [pago("p65", "proc_fin_ars", 65, "2026-10-10T15:00:00.000Z")] });
  assert.equal(saldosEsperados(e, arqueo0, A1).get("proc_fin_ars")!.entro, 65 * 1600);
  const contado = { fecha: A1, tipoCambio: 1600, saldos: [...arqueo0.saldos.slice(0, 1), { procesadorId: "proc_fin_ars", monto: 1_600_000 + 104_000, moneda: "ARS" as const, montoBase: 1065 }], total: 2065 };
  const x = esperadoDelArqueo(e, contado);
  assert.equal(x.diferencia, 0, "contó lo que había: da");
  assert.equal(x.conciliacion!.sinExplicar, 0);
});

test("un gasto en dólares desde la cuenta en pesos baja la cuenta; y al cargarlo ahora se pide en pesos", () => {
  const arca = gasto("arca", 3311.69, "2026-10-10T15:00:00.000Z", { cuenta: "Financiera ARS Juan" });
  const e = estado({ gastos: [arca] });
  assert.equal(Math.round(saldosEsperados(e, arqueo0, A1).get("proc_fin_ars")!.salio), Math.round(3311.69 * 1600));
  const contado = { fecha: A1, tipoCambio: 1600, saldos: [arqueo0.saldos[0], { procesadorId: "proc_fin_ars", monto: 1_600_000 - 3311.69 * 1600, moneda: "ARS" as const, montoBase: 1000 - 3311.69 }], total: 1000 + 1000 - 3311.69 };
  assert.equal(Math.abs(esperadoDelArqueo(e, contado).diferencia!) < 0.01, true);
  /* En la carga: la cuenta es en pesos y el gasto en dólares → se pide en pesos. En pesos, o desde una cuenta en dólares, pasa. */
  const b = { concepto: "Pago ARCA", categoria: "Impuestos", proveedor: "ARCA", monto: "3.311,69", moneda: "USD" as const, tipoCambio: "", fecha: "2026-10-10T12:00:00.000Z", cuenta: "Financiera ARS Juan" };
  assert.equal(problemasDelGasto(b, "USD", PROCESADORES).cuenta, MENSAJE_CUENTA_EN_PESOS);
  assert.equal(problemasDelGasto({ ...b, moneda: "ARS", tipoCambio: "1.600" }, "USD", PROCESADORES).cuenta, undefined);
  assert.equal(problemasDelGasto({ ...b, cuenta: "Mercury" }, "USD", PROCESADORES).cuenta, undefined);
  assert.equal(problemasDelGasto(b, "USD").cuenta, undefined, "sin la lista de cuentas no opina");
});

test("la diferencia del arqueo es la de hoy: cargado el gasto que faltaba, se acomoda sola y lo guardado queda como constancia", () => {
  const a1: Arqueo = { id: "a1", fecha: A1, total: 1900, tipoCambio: 1600, creadoEn: A1, esperado: 2000, diferencia: -100,
    saldos: [{ procesadorId: "proc_mercury", monto: 900, moneda: "USD", montoBase: 900 }, { procesadorId: "proc_fin_ars", monto: 1_600_000, moneda: "ARS", montoBase: 1000 }] };
  const sinGasto = estado({ arqueos: [arqueo0, a1] });
  assert.deepEqual([arqueoVivo(sinGasto, a1).diferencia, arqueoVivo(sinGasto, a1).cambio], [-100, false]);
  const conGasto = estado({ arqueos: [arqueo0, a1], gastos: [gasto("hosting", 100, "2026-10-12T15:00:00.000Z", { cuentaId: "proc_mercury" })] });
  const v = arqueoVivo(conGasto, a1);
  assert.deepEqual([v.diferencia, v.cambio, v.guardada.diferencia], [0, true, -100]);
  /* Sin el arqueo anterior (se borró) no hay de dónde recalcular: vale lo guardado. */
  assert.deepEqual([arqueoVivo({ ...conGasto, arqueos: [a1] }, a1).diferencia, arqueoVivo({ ...conGasto, arqueos: [a1] }, a1).cambio], [-100, false]);
});

test("la auditoría: limpia no dice nada, y nombra lo que puede descuadrar la caja", () => {
  assert.deepEqual(auditarCaja(estado(), A1), []);
  const pase: Traspaso = { id: "t1", fecha: "2026-10-12T15:00:00.000Z", origenId: "proc_whop", destinoId: "proc_mercury", montoSale: 500, monedaSale: "USD", montoLlega: 500, monedaLlega: "USD", estado: "confirmado", origen: "manual", creadoEn: "2026-10-12T15:00:00.000Z" };
  const e = estado({
    equipo: [{ id: "eq_ang", nombre: "Angelo Nisi", rol: "growth", comisionRate: 0, activo: true, sinComision: false }] as EstadoApp["equipo"],
    pagos: [pago("p65", "proc_fin_ars", 65, "2026-10-10T15:00:00.000Z")],
    traspasos: [pase],
    gastos: [
      gasto("sin_cuenta", 40, "2026-11-01T15:00:00.000Z", {}),
      gasto("arca", 3311.69, "2026-10-10T15:00:00.000Z", { cuenta: "Financiera ARS Juan" }),
      gasto("angelo", 500, "2026-10-26T15:00:00.000Z", { cuentaId: "proc_mercury" }, { concepto: "Angelo Nisi", categoria: "Equipo / Salarios" }),
      gasto("doble", 500, "2026-10-12T15:00:00.000Z", { cuentaId: "proc_whop" }),
    ],
  });
  const claves = auditarCaja(e, "2026-11-02T15:00:00.000Z").map((h) => h.clave);
  assert.deepEqual(claves.sort(), ["cobros-pesos-sin-cambio", "gastos-dolares-desde-pesos", "gastos-sin-cuenta", "pagos-equipo-sin-marcar", "pase-y-gasto"].sort());
  assert.ok(auditarCaja(e, "2026-11-02T15:00:00.000Z").every((h) => h.gravedad === "aviso"), "nada de esto es un error de la app");
});
