import test from "node:test";
import assert from "node:assert/strict";
import { enOtros } from "@/lib/caja";
import { corteFinanciera, hojaCorte } from "@/lib/reporteFinanciera";
import type { EstadoApp, Pago, Procesador } from "@/lib/types";

test("las cuentas que no se usan seguido van en «Otros», salvo que se diga otra cosa", () => {
  for (const n of ["Mercado Pago Yari", "Galicia (ARS)", "Galicia (USD)", "Efectivo USD", "USDT Binance", "mercadopago"]) {
    assert.equal(enOtros({ nombre: n }), true, n);
  }
  for (const n of ["Stripe", "ACH-WIRE Mercury", "Hotmart", "Whop", "USDT Trust", "Dlocal", "Financiera ARS Juan"]) {
    assert.equal(enOtros({ nombre: n }), false, n);
  }
  /* Lo que se decide a mano manda sobre el nombre, para los dos lados. */
  assert.equal(enOtros({ nombre: "Stripe", cajaOtros: true }), true);
  assert.equal(enOtros({ nombre: "Galicia (ARS)", cajaOtros: false }), false);
});

/* Un estado mínimo con un cobro a la Financiera, sin CBU. */
function estadoConCobro(p: Partial<Pago>): EstadoApp {
  const financiera = { id: "proc_fin", nombre: "Financiera ARS Juan", feeRate: 0.06, activo: true, automatico: false, moneda: "ARS" } as Procesador;
  const pago = {
    id: "p1", cuotaId: "c1", procesadorId: "proc_fin", monto: 625, moneda: "USD", feeRate: 0.06, feeMonto: 37.5,
    fecha: "2026-10-05T15:00:00.000Z", creadoEn: "2026-10-05T15:00:00.000Z", tipoCambio: 1584, montoArs: 990000, ...p,
  } as Pago;
  return {
    procesadores: [financiera], pagos: [pago], productos: [{ id: "prod1", nombre: "Mentoría" }],
    cuotas: [{ id: "c1", ventaId: "v1" }], ventas: [{ id: "v1", contactoNombre: "Belén Godoy", productoId: "prod1", closerId: "m1" }],
    equipo: [{ id: "m1", nombre: "Dante Barbieri" }],
  } as unknown as EstadoApp;
}

test("el reporte para la Financiera ya no pide el CBU: con nombre, CUIT y comprobante alcanza", () => {
  const e = estadoConCobro({ pagador: "Belén Godoy", cuit: "27-12345678-9", comprobanteLink: "https://drive.example.com/comprobante" });
  const corte = corteFinanciera(e, "proc_fin", "2026-10-01", "2026-10-31");
  assert.equal(corte.filas.length, 1);
  assert.deepEqual(corte.filas[0].faltan, []);
  assert.equal(corte.filas[0].montoArs, 990000, "los pesos que se escribieron");
  assert.equal(corte.filas[0].montoUsd, 625);
});

test("al reporte le sigue faltando lo que de verdad hace falta", () => {
  const e = estadoConCobro({});
  const [fila] = corteFinanciera(e, "proc_fin", "2026-10-01", "2026-10-31").filas;
  assert.deepEqual(fila.faltan, ["el nombre de quien transfirió", "el CUIT", "el comprobante"]);
});

test("la hoja del reporte no tiene la columna CVU", () => {
  const e = estadoConCobro({ pagador: "Belén Godoy", cuit: "27-12345678-9", comprobanteLink: "https://drive.example.com/c" });
  const hoja = hojaCorte(corteFinanciera(e, "proc_fin", "2026-10-01", "2026-10-31"));
  const textos = hoja.celdas.map((c) => c.valor).filter((v): v is string => typeof v === "string");
  assert.ok(textos.includes("Cuit"), "sigue el CUIT");
  assert.ok(textos.includes("Transferencia ARS"), "siguen los pesos");
  assert.ok(!textos.includes("CVU"), "ya no está el CVU");
});

test("un cobro viejo que traía CBU sigue mostrando su banco", () => {
  /* 0720 = Santander. El banco sale de los tres primeros números. */
  const cbu = "0720000088000035332112";
  const e = estadoConCobro({ pagador: "Belén Godoy", cuit: "27-12345678-9", comprobanteLink: "https://x.example.com/c", cvu: cbu });
  const [fila] = corteFinanciera(e, "proc_fin", "2026-10-01", "2026-10-31").filas;
  assert.deepEqual(fila.faltan, []);
  assert.ok(fila.banco.length > 0);
});
