import test from "node:test";
import assert from "node:assert/strict";
import { cajaEsperada } from "@/lib/caja";
import { costosDelMes } from "@/lib/finanzas";
import { candidatosDePago, candidatosElegidos, cuentaSugerida, gastoDelPago, pagosSinRegistrar, totalRegistrado } from "@/lib/pagos-liquidacion";
import { saldosEsperados } from "@/lib/traspasos";
import type { Arqueo, EstadoApp, Gasto, Liquidacion, PersonaLiquidada } from "@/lib/types";
import { estadoDeYari } from "./estado-devolucion";

/* ==================================================================
   Marcar un pago de la liquidación = registrar de qué cuenta salió (Aldana, 11/11).

   Octubre, cerrada el 3/11: Dante cobra 3.924,51 = un pago a cuenta del 26/10 (2.567,56, ya marcado como pago al equipo) + 1.356,95 que trajo el
   banco el 6/11 sin marcar. Daniel, el setter, cobra 601,56 por Binance y no tiene ningún gasto.
   ================================================================== */

const persona = (miembroId: string, nombre: string, total: number): PersonaLiquidada => ({
  miembroId, nombre, categoriaGasto: "Equipo / Salarios", lineas: [], aPagar: { USD: total }, total, fijo: 0, variable: total,
});
const DANTE = persona("eq_dante", "Dante Barbieri", 3924.51);
const DANIEL = persona("eq_daniel", "Daniel Rodriguez", 601.56);
const NACHO = persona("eq_nacho", "Nacho", 204);

const liq = (pagos: Liquidacion["pagos"] = {}): Liquidacion => ({
  id: "liq_2026-10", periodo: "2026-10", estado: "cerrada", entradas: {}, extras: [], pagos, gastoIds: [],
  resultado: { personas: [DANTE, DANIEL, NACHO], total: 4730.07, fijo: 0, variable: 0, aPagar: { USD: 4730.07 }, tipoCambio: 1500, profit: 0, calculadoEn: "2026-11-03T00:31:00.000Z" },
  cerradaEn: "2026-11-03T03:31:00.000Z", creadoEn: "2026-10-01T12:00:00.000Z",
});

const gasto = (id: string, proveedor: string, monto: number, fecha: string, extra: Record<string, unknown> = {}, cambios: Partial<Gasto> = {}): Gasto => ({
  id, categoria: "Comisiones closers", grupo: "operativo", concepto: proveedor, proveedor, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha, extra, ...cambios,
});
const A_CUENTA = gasto("g_a_cuenta", "Dante Barbieri", 2567.56, "2026-10-27T15:00:00.000Z", { cuentaId: "proc_mercury", pagoDeEquipo: true });
const DEL_BANCO = gasto("g_banco", "Dante Barbieri", 1356.95, "2026-11-06T15:00:00.000Z", { cuenta: "ACH-WIRE Mercury", bancoRef: "mercury:e6f9", proveedorEquipoId: "eq_dante" });
const CUENTAS = [
  { id: "proc_mercury", nombre: "ACH-WIRE Mercury", feeRate: 0, activo: true, automatico: true },
  { id: "proc_binance", nombre: "USDT Binance", feeRate: 0, activo: true, automatico: false },
];
const ARQUEO: Arqueo = {
  id: "a0", fecha: "2026-10-26T00:00:00.000Z", total: 20000, creadoEn: "2026-10-26T00:00:00.000Z",
  saldos: [{ procesadorId: "proc_mercury", monto: 15000, moneda: "USD", montoBase: 15000 }, { procesadorId: "proc_binance", monto: 5000, moneda: "USD", montoBase: 5000 }],
};
const estado = (gastos: Gasto[], liquidaciones: Liquidacion[] = [liq()]): EstadoApp =>
  estadoDeYari({ gastos, liquidaciones, procesadores: CUENTAS, pagos: [], arqueos: [ARQUEO] });

test("los candidatos de Dante son sus dos pagos (el del 26/10 ya marcado y el del banco), y se eligen los dos porque suman lo liquidado", () => {
  const e = estado([A_CUENTA, DEL_BANCO]);
  const c = candidatosDePago(e, liq(), DANTE);
  assert.deepEqual(c.map((x) => [x.gasto.id, x.motivo, x.yaMarcado]), [["g_a_cuenta", "nombre", true], ["g_banco", "id", false]]);
  assert.deepEqual(candidatosElegidos(c, DANTE.total), ["g_a_cuenta", "g_banco"]);
  /* Si lo cargado pasa de lo liquidado, no se elige el que se pasa. */
  assert.deepEqual(candidatosElegidos(c, 3000), ["g_a_cuenta"]);
});

test("no ofrece lo que no es de la persona ni lo de otro mes, ni lo que ya enlazó otro pago", () => {
  const ajeno = gasto("g_ajeno", "Marcela Nadie", 1356.95, "2026-11-06T15:00:00.000Z");
  const septiembre = gasto("g_sep", "Dante Barbieri", 500, "2026-09-10T15:00:00.000Z");
  const software = gasto("g_soft", "Dante Barbieri", 80, "2026-11-02T15:00:00.000Z", {}, { categoria: "Software" });
  const delCierre = gasto("g_liq", "Dante Barbieri", 3924.51, "2026-10-31T15:00:00.000Z", { liquidacionId: "liq_2026-10" });
  const e = estado([A_CUENTA, DEL_BANCO, ajeno, septiembre, software, delCierre]);
  assert.deepEqual(candidatosDePago(e, liq(), DANTE).map((x) => x.gasto.id), ["g_a_cuenta", "g_banco"]);
  /* El que ya enlazó el pago de otra persona de la misma liquidación no se ofrece. */
  const enlazado = estado([A_CUENTA, DEL_BANCO], [liq({ eq_otro: { pagadoEn: "2026-11-06T22:05:00.000Z", gastoIds: ["g_banco"] } })]);
  assert.deepEqual(candidatosDePago(enlazado, liq(), DANTE).map((x) => x.gasto.id), ["g_a_cuenta"]);
});

test("un pago por el mismo monto exacto, sin el nombre (una sociedad), también se reconoce", () => {
  const sociedad = gasto("g_soc", "Emperador Financiero LLC", 601.56, "2026-11-05T15:00:00.000Z");
  const c = candidatosDePago(estado([sociedad]), liq(), DANIEL);
  assert.deepEqual(c.map((x) => [x.gasto.id, x.motivo]), [["g_soc", "monto"]]);
});

test("la cuenta sugerida: la del último pago registrado, si no la de los gastos que se enlazan, si no Mercury", () => {
  const previa: Liquidacion = { ...liq({ eq_daniel: { pagadoEn: "2026-10-05T12:00:00.000Z", cuentaId: "proc_binance", gastoIds: [] } }), id: "liq_2026-09", periodo: "2026-09" };
  assert.equal(cuentaSugerida(estado([], [previa, liq()]), "eq_daniel"), "proc_binance", "Daniel cobra por Binance: la próxima vez ya viene elegida");
  assert.equal(cuentaSugerida(estado([A_CUENTA]), "eq_dante", [A_CUENTA]), "proc_mercury");
  assert.equal(cuentaSugerida(estado([]), "eq_nuevo"), "proc_mercury");
});

test("el gasto del pago: sale de la cuenta elegida, queda marcado como pago al equipo y no suma al costo", () => {
  const e = estado([]);
  const g = gastoDelPago(e, liq(), DANIEL, { dia: "2026-11-04", cuentaId: "proc_binance", monto: 601.56 }, "gas_x", "2026-11-12T12:00:00.000Z");
  assert.equal(g.monto, 601.56);
  assert.equal(g.extra.pagoDeEquipo, true);
  assert.equal(g.extra.cuentaId, "proc_binance");
  assert.equal(g.extra.pagoDeLiquidacion, "liq_2026-10");
  assert.equal(g.extra.liquidacionId, undefined, "no es el gasto del cierre: ése no es un pago, no resta de la caja");
  assert.equal(g.fecha, "2026-11-04T15:00:00.000Z");
  const conPago = { ...e, gastos: [g] };
  const rango = { clave: "2026-11", etiqueta: "nov", desde: new Date("2026-11-01T03:00:00.000Z"), hasta: new Date("2026-11-30T23:59:59.999Z") };
  assert.equal(costosDelMes(conPago, rango).length, 0, "no cuenta otra vez como costo del mes");
  const mov = cajaEsperada(conPago, ARQUEO, "2026-11-08T02:59:59.999Z");
  assert.equal(mov.equipo, 601.56, "resta de la caja");
  /* Y baja la cuenta de Binance, no la de Mercury. */
  const porCuenta = saldosEsperados(conPago, ARQUEO, "2026-11-08T02:59:59.999Z");
  assert.equal(porCuenta.get("proc_binance")!.esperado, 4398.44);
  assert.equal(porCuenta.get("proc_mercury")!.esperado, 15000);
});

test("una cuenta en pesos recibe los pesos: el gasto guarda cuánto salió en pesos", () => {
  const e = estadoDeYari({ procesadores: [...CUENTAS, { id: "proc_fin", nombre: "Financiera ARS", feeRate: 0, activo: true, automatico: false, moneda: "ARS" }], liquidaciones: [liq()], gastos: [], pagos: [] });
  const g = gastoDelPago(e, liq(), DANIEL, { dia: "2026-11-04", cuentaId: "proc_fin", monto: 100 }, "gas_y", "2026-11-12T12:00:00.000Z");
  assert.equal(g.extra.monedaOriginal, "ARS");
  assert.equal(g.extra.montoOriginal, 150000, "100 dólares al cambio de la liquidación");
});

test("quién figura pagado y la caja no sabe de qué cuenta salió: las marcas viejas, o un pago registrado a medias", () => {
  const marcas = { pagadoEn: "2026-11-04T23:31:00.000Z" };
  const e = estado([A_CUENTA, DEL_BANCO]);
  const sin = pagosSinRegistrar(e, liq({ eq_daniel: marcas, eq_dante: { ...marcas, gastoIds: ["g_a_cuenta", "g_banco"], cuentaId: "proc_mercury" }, eq_nacho: { ...marcas, gastoIds: [] } }));
  assert.deepEqual(sin.map((x) => x.miembroId).sort(), ["eq_daniel", "eq_nacho"], "Dante está completo (2.567,56 + 1.356,95); Daniel y Nacho figuran pagados sin nada registrado");
  assert.equal(totalRegistrado(e, { gastoIds: ["g_a_cuenta", "g_banco"] }), 3924.51);
  /* Una liquidación abierta no tiene pagos que registrar. */
  assert.deepEqual(pagosSinRegistrar(e, { ...liq({ eq_daniel: marcas }), estado: "abierta" }), []);
});
