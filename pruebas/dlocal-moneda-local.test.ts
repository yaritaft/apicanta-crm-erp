import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { problemaDeDatos, type CobroBorrador } from "@/components/cobros/EditorCobros";
import {
  camposDeMonedaLocal, cambioQueResulta, cobrosSinMonedaLocal, enSuMoneda, faltaMonedaLocal, monedaPropuesta, pideMonedaLocal,
} from "@/lib/moneda-local";
import { puedeCompletarMonedaLocal } from "@/lib/candado-cobro";
import { pasaControl } from "@/lib/control-cobros";
import { filasExcelCobros } from "@/lib/excelCobros";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { Cuota, EstadoApp, Pago, Venta } from "@/lib/types";

/* ==================================================================
   Aldana (13/11): «no me ponen el valor de conversión en dLocal ni el monto real pagado por la persona, y sin eso no puedo pasar los
   comprobantes a Financiera». Matías Rolon pagó US$ 2.584 por dLocal en cuatro partes y tres no decían cuántos pesos fueron: la app sólo
   pedía el cambio en las cuentas en pesos. Ahora un cobro de dLocal no se guarda sin la moneda y lo que pagó en ella, y los que ya estaban
   se completan sin que el chequeo de Finanzas se pierda.
   ================================================================== */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

const venta = { id: "v_mr", contactoNombre: "Matias Rolon", productoId: "prod_hackear_ai", precioAcordado: 2584, moneda: "USD", closerId: "eq_dante", excluidoMarketing: false, estado: "activa", fecha: "2026-11-13T14:50:00.000Z", creadoEn: "2026-11-13T14:50:00.000Z", extra: {} } as unknown as Venta;
const cuota = { id: "c_mr", ventaId: "v_mr", numero: 1, monto: 2584, vence: "2026-11-13T15:00:00.000Z", estado: "pendiente", esReserva: false } as Cuota;
const COMPROBANTE = { ruta: "data:image/png;base64,AAAA", nombre: "dlocal.png", tipo: "image/png", tamanio: 4, subidoEn: "2026-11-13T15:00:00.000Z" };

function armar(pagos: Pago[] = []) {
  fijarAcceso(null);
  const b = construirSemilla() as EstadoApp;
  const e = { ...b, ventas: [venta, ...b.ventas], cuotas: [cuota, ...b.cuotas], pagos: [...pagos, ...b.pagos] } as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
}
const borrador = (extra: Partial<CobroBorrador> = {}): CobroBorrador => ({
  id: "cob_1", procesadorId: "proc_dlocal", monto: 958, fecha: "2026-11-13T14:54:52.000Z", referencia: "", comprobante: COMPROBANTE, ...extra,
});

test("qué cuentas lo piden y qué moneda se propone por el país o el teléfono", () => {
  assert.equal(pideMonedaLocal({ proveedor: "dlocal", nombre: "Dlocal" }), true);
  assert.equal(pideMonedaLocal({ nombre: "dLocal Go" }), true, "una cuenta sin proveedor, por el nombre");
  assert.equal(pideMonedaLocal({ proveedor: "whop", nombre: "Whop" }), false);
  assert.equal(pideMonedaLocal({ nombre: "Financiera ARS Juan" }), false, "la Financiera en pesos tiene su propio campo");
  assert.equal(monedaPropuesta({ telefono: "+54 11 6523-5300" }), "ARS");
  assert.equal(monedaPropuesta({ telefono: "+52 1 55 1234 5678" }), "MXN");
  assert.equal(monedaPropuesta({ telefono: "+57 300 123 4567" }), "COP");
  assert.equal(monedaPropuesta({ telefono: "+598 99 123 456" }), "UYU", "el prefijo más largo gana: 598 no es Brasil (55)");
  assert.equal(monedaPropuesta({ pais: "Perú", telefono: "+54 11 1" }), "PEN", "el país cargado manda sobre el teléfono");
  assert.equal(monedaPropuesta({ telefono: "1155555555" }), "ARS", "sin el +, no se adivina: lo más común");
  assert.equal(monedaPropuesta(undefined), "ARS");
});

test("el tipo de cambio sale de los dos montos y los pesos argentinos también van en montoArs", () => {
  assert.equal(cambioQueResulta(1_550_044, 958), 1618);
  assert.equal(cambioQueResulta(0, 958), undefined);
  assert.equal(cambioQueResulta(1000, 0), undefined);
  assert.deepEqual(camposDeMonedaLocal("ARS", 1_550_044, 958), { monedaLocal: "ARS", montoLocal: 1_550_044, tipoCambio: 1618, montoArs: 1_550_044 });
  assert.deepEqual(camposDeMonedaLocal("MXN", 17_900, 958), { monedaLocal: "MXN", montoLocal: 17_900, tipoCambio: 18.6848 }, "en pesos mexicanos no hay montoArs");
  assert.equal(camposDeMonedaLocal("ARS", 0, 958), null);
});

test("un cobro de dLocal no se guarda sin la moneda y lo que pagó en ella", () => {
  armar();
  const e = estado();
  const sinNada = problemaDeDatos(e, [borrador()], "la cuota 1");
  assert.match(sinNada ?? "", /cuánto pagó la persona por dLocal en su moneda/);
  assert.match(problemaDeDatos(e, [borrador({ monedaLocal: "ARS" })], "la cuota 1") ?? "", /dLocal/, "la moneda sola no alcanza");
  assert.equal(problemaDeDatos(e, [borrador({ monedaLocal: "ARS", montoLocal: 1_550_044 })], "la cuota 1"), null);
  assert.equal(problemaDeDatos(e, [borrador({ procesadorId: "proc_whop" })], "la cuota 1"), null, "Whop no lo pide");
});

test("al registrarlo quedan la moneda, el monto en su moneda y el cambio; en otra moneda, sin pesos argentinos", () => {
  armar();
  const base = { procesadorId: "proc_dlocal", fecha: "2026-11-13T14:54:52.000Z", referencia: "", comprobante: COMPROBANTE };
  assert.equal(acciones.registrarPago({
    cuotaId: "c_mr", reajuste: "pendiente",
    cobros: [
      { ...base, monto: 958, monedaLocal: "ARS", montoLocal: 1_550_044, tipoCambio: 1600, montoArs: 1_532_800 },
      { ...base, monto: 860, monedaLocal: "MXN", montoLocal: 16_070 },
    ],
  }), true);
  const pagos = estado().pagos.filter((p) => p.cuotaId === "c_mr").sort((a, b) => b.monto - a.monto);
  assert.equal(pagos.length, 2);
  const [ars, mxn] = pagos;
  assert.equal(ars.monedaLocal, "ARS");
  assert.equal(ars.montoLocal, 1_550_044);
  assert.equal(ars.tipoCambio, 1618, "el cambio es el que resulta de lo que pagó, no uno escrito aparte");
  assert.equal(ars.montoArs, 1_550_044);
  assert.equal(mxn.monedaLocal, "MXN");
  assert.equal(mxn.montoLocal, 16_070);
  assert.equal(mxn.tipoCambio, 18.686);
  assert.equal(mxn.montoArs, undefined, "un cobro en pesos mexicanos no inventa pesos argentinos");
  assert.equal(faltaMonedaLocal(estado().procesadores, ars), false);
});

test("uno ya cargado sin eso: se avisa, se completa y lo chequeado sigue chequeado", () => {
  const viejo = {
    id: "pag_mr_127", cuotaId: "c_mr", procesadorId: "proc_dlocal", monto: 127, moneda: "USD", feeRate: 0.05, feeMonto: 6.35,
    fecha: "2026-11-13T14:52:17.000Z", creadoEn: "2026-11-13T15:00:49.000Z", comprobante: COMPROBANTE, cargadoPor: "dante@apicanta.com",
    chequeoFinanzas: "chequeado", chequeoFinanzasPor: "aldana@apicanta.com", chequeoFinanzasEn: "2026-11-14T10:00:00.000Z",
  } as Pago;
  const conPesos = { ...viejo, id: "pag_mr_639", monto: 639, montoArs: 1_033_902, tipoCambio: 1618 } as Pago;
  armar([viejo, conPesos]);
  const e = estado();
  assert.equal(faltaMonedaLocal(e.procesadores, viejo), true);
  assert.equal(faltaMonedaLocal(e.procesadores, conPesos), false, "los de antes con pesos y cambio cuentan como pesos argentinos");
  assert.deepEqual(enSuMoneda(conPesos), { moneda: "ARS", monto: 1_033_902, tipoCambio: 1618 });
  const deMatias = (xs: Pago[]) => xs.filter((p) => p.cuotaId === "c_mr").map((p) => p.id);
  assert.deepEqual(deMatias(cobrosSinMonedaLocal(e)), ["pag_mr_127"]);
  assert.deepEqual(deMatias(cobrosSinMonedaLocal(e, { cargadoPor: "DANTE@apicanta.com" })), ["pag_mr_127"], "el aviso de Mi panel: los que cargó él");
  assert.deepEqual(deMatias(cobrosSinMonedaLocal(e, { cargadoPor: "mariano@apicanta.com" })), []);
  assert.ok(pasaControl(viejo, e.procesadores, "sin-moneda-local"));
  assert.ok(!pasaControl(conPesos, e.procesadores, "sin-moneda-local"));

  /* El closer que lo cargó lo puede completar aunque Finanzas ya lo chequeó: no cambia lo que se chequeó. */
  const closer = acceso("closer");
  assert.equal(puedeCompletarMonedaLocal(viejo, closer), true);
  assert.equal(puedeCompletarMonedaLocal(conPesos, closer), false, "cambiar lo que ya estaba y se chequeó es de Finanzas");
  assert.equal(puedeCompletarMonedaLocal(conPesos, ACCESO_DUENO), true);
  assert.equal(puedeCompletarMonedaLocal(viejo, acceso("marketing")), false, "quien no registra pagos, no");

  fijarAcceso(closer);
  assert.equal(acciones.completarMonedaLocal("pag_mr_127", { moneda: "ARS", montoLocal: 205_486 }), true);
  assert.equal(acciones.completarMonedaLocal("pag_mr_639", { moneda: "ARS", montoLocal: 1 }), false, "el closer no pisa lo chequeado");
  fijarAcceso(null);
  const despues = estado();
  const p = despues.pagos.find((x) => x.id === "pag_mr_127")!;
  assert.equal(p.monedaLocal, "ARS");
  assert.equal(p.montoLocal, 205_486);
  assert.equal(p.tipoCambio, 1618);
  assert.equal(p.montoArs, 205_486);
  assert.equal(p.monto, 127, "el monto en dólares no se toca");
  assert.equal(p.chequeoFinanzas, "chequeado", "lo chequeado sigue chequeado");
  assert.equal(p.chequeoFinanzasPor, "aldana@apicanta.com");
  assert.match(JSON.stringify(despues.actividad[0]), /completó lo que pagó en su moneda/);
  assert.deepEqual(deMatias(cobrosSinMonedaLocal(despues)), []);
  assert.equal(despues.pagos.find((x) => x.id === "pag_mr_639")!.montoArs, 1_033_902);
});

test("el Excel de cobros lleva la moneda y lo que pagó en ella, y no inventa pesos argentinos en otra moneda", () => {
  const mxn = { id: "pag_mx", cuotaId: "c_mr", procesadorId: "proc_dlocal", monto: 860, moneda: "USD", feeRate: 0.05, feeMonto: 43, fecha: "2026-11-13T14:58:29.000Z", creadoEn: "2026-11-13T15:00:49.000Z", monedaLocal: "MXN", montoLocal: 16_070, tipoCambio: 18.686 } as Pago;
  const ars = { ...mxn, id: "pag_ar", monedaLocal: "ARS", montoLocal: 1_391_480, montoArs: 1_391_480, tipoCambio: 1618 } as Pago;
  armar([mxn, ars]);
  const filas = filasExcelCobros(estado(), [mxn, ars]);
  const fx = filas.find((f) => f.pagoId === "pag_mx")!, fa = filas.find((f) => f.pagoId === "pag_ar")!;
  assert.equal(fx.monedaLocal, "MXN");
  assert.equal(fx.montoLocal, 16_070);
  assert.equal(fx.montoArs, undefined, "sin «Monto ARS» = 860 × 18,686");
  assert.equal(fx.tipoCambio, 18.686);
  assert.equal(fa.monedaLocal, "ARS");
  assert.equal(fa.montoArs, 1_391_480);
});
