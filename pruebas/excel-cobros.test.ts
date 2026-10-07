import test from "node:test";
import assert from "node:assert/strict";
import { escribirXlsx } from "@/lib/xlsxEscribir";
import { filasExcelCobros, hojaCobros, nombreArchivoCobros, TITULOS_EXCEL_COBROS, totalesExcelCobros } from "@/lib/excelCobros";
import { corteFinanciera, hojaCorte } from "@/lib/reporteFinanciera";
import { conChequeo } from "@/lib/control-cobros";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Pago, Procesador } from "@/lib/types";

const celdasDe = (hoja: ReturnType<typeof hojaCobros>, fila: number) =>
  hoja.celdas.filter((c) => c.fila === fila).sort((a, b) => a.columna - b.columna).map((c) => c.valor);

test("el Excel de cobros trae lo que pide la Financiera (fecha, nombre, CUIT, monto, comprobante) y lo que dice el control", () => {
  for (const t of ["Fecha", "Nombre de quien transfiere", "CUIT", "Monto USD", "Monto ARS", "Comprobante", "Conciliado", "Chequeo", "Chequeado por", "Cuándo", "Cargado por"]) {
    assert.ok(TITULOS_EXCEL_COBROS.includes(t), `falta la columna ${t}`);
  }
});

test("la hoja tiene los encabezados arriba, un cobro por fila y los totales al pie, y los totales suman las filas", () => {
  const e = construirSemilla() as EstadoApp;
  const pagos = e.pagos.slice(0, 40);
  const filas = filasExcelCobros(e, pagos);
  assert.equal(filas.length, 40);
  const hoja = hojaCobros(filas);

  assert.deepEqual(celdasDe(hoja, 1), TITULOS_EXCEL_COBROS, "los encabezados en la fila 1: se pueden filtrar o subir tal cual");
  for (let k = 0; k < filas.length; k++) assert.ok(celdasDe(hoja, 2 + k).length >= 1, `fila ${2 + k}`);
  assert.equal(hoja.filtro, "A1:R41", "el filtro cubre los encabezados y los cobros, no los totales");

  const filaTotal = filas.length + 3;
  const total = hoja.celdas.filter((c) => c.fila === filaTotal);
  const col = (titulo: string) => TITULOS_EXCEL_COBROS.indexOf(titulo) + 1;
  const usd = total.find((c) => c.columna === col("Monto USD"))?.valor as number;
  const ars = total.find((c) => c.columna === col("Monto ARS"))?.valor;
  const sumaUsd = filas.reduce((a, f) => a + Math.round(f.montoUsd * 100), 0) / 100;
  assert.equal(usd, sumaUsd, "el total en dólares es la suma de las filas, al centavo");
  assert.equal(usd, Math.round(pagos.reduce((a, p) => a + p.monto, 0) * 100) / 100, "y es el Cash Collected de esos cobros");
  assert.equal(total.find((c) => c.columna === col("Cliente"))?.valor, "TOTAL · 40 cobros");
  assert.equal(totalesExcelCobros(filas).cobros, 40);
  assert.equal(ars, totalesExcelCobros(filas).ars || undefined);

  /* Las celdas de monto de cada fila son los montos de los cobros. */
  const montos = hoja.celdas.filter((c) => c.columna === col("Monto USD") && c.fila >= 2 && c.fila <= 41).map((c) => c.valor);
  assert.deepEqual(montos, filas.map((f) => f.montoUsd));
});

test("el Excel dice quién chequeó, cuándo y si está conciliado", () => {
  const e = construirSemilla() as EstadoApp;
  const [p0, p1, p2] = e.pagos;
  const en = "2026-10-06T14:30:00.000Z";
  const pagos: Pago[] = [
    conChequeo(p0, "director", "chequeado", { por: "santi@apicanta.com", en }),
    conChequeo(p1, "finanzas", "rechazado", { por: "aldana@apicanta.com", en, nota: "no coincide el monto" }),
    p2,
  ];
  const equipo = [...e.equipo, { id: "x", nombre: "Santiago Burghiani", email: "santi@apicanta.com" }] as EstadoApp["equipo"];
  const [a, b, c] = filasExcelCobros({ ...e, equipo }, pagos);
  const filaDe = (id: string) => [a, b, c].find((f) => f.pagoId === id)!;
  assert.equal(filaDe(p0.id).chequeo, "Chequeado");
  assert.equal(filaDe(p0.id).chequeadoPor, "Santiago", "el nombre de Equipo, no el correo");
  assert.ok(filaDe(p0.id).chequeadoEn.length > 0);
  assert.equal(filaDe(p1.id).chequeo, "Rechazado");
  assert.equal(filaDe(p2.id).chequeo, "Sin chequear");
  assert.equal(filaDe(p2.id).chequeadoPor, "");
  assert.ok(["Sí", "No", "A mano"].includes(filaDe(p2.id).conciliado));
});

test("el Excel es un .xlsx de verdad", async () => {
  const e = construirSemilla() as EstadoApp;
  const datos = await escribirXlsx({ hojas: [hojaCobros(filasExcelCobros(e, e.pagos.slice(0, 5)))] });
  assert.ok(datos.length > 500);
  assert.equal(String.fromCharCode(datos[0], datos[1]), "PK", "un zip");
});

test("el nombre del archivo lleva el período", () => {
  assert.equal(nombreArchivoCobros("2026-09-01", "2026-09-30"), "Cobros 01-09-2026 a 30-09-2026.xlsx");
});

/* ---------- El reporte para la Financiera, con el control cruzado ---------- */

function estadoConCobro(p: Partial<Pago>): EstadoApp {
  const financiera = { id: "proc_fin", nombre: "Financiera ARS Juan", feeRate: 0.06, activo: true, automatico: false, moneda: "ARS" } as Procesador;
  const pago = {
    id: "p1", cuotaId: "c1", procesadorId: "proc_fin", monto: 625, moneda: "USD", feeRate: 0.06, feeMonto: 37.5,
    fecha: "2026-10-05T15:00:00.000Z", creadoEn: "2026-10-05T15:00:00.000Z", tipoCambio: 1584, montoArs: 990000,
    pagador: "Belén Godoy", cuit: "27-12345678-9", comprobanteLink: "https://drive.example.com/c", ...p,
  } as Pago;
  return {
    procesadores: [financiera], pagos: [pago], productos: [{ id: "prod1", nombre: "Mentoría" }],
    cuotas: [{ id: "c1", ventaId: "v1" }], ventas: [{ id: "v1", contactoNombre: "Belén Godoy", productoId: "prod1", closerId: "m1" }],
    equipo: [{ id: "m1", nombre: "Dante Barbieri" }],
  } as unknown as EstadoApp;
}

test("«Pago Verificado» del reporte sale del control cruzado", () => {
  const verificado = (p: Partial<Pago>) => corteFinanciera(estadoConCobro(p), "proc_fin", "2026-10-01", "2026-10-31").filas[0].verificado;
  assert.equal(verificado({}), false, "sin chequear");
  assert.equal(verificado({ chequeoDirector: "chequeado" }), true, "el director alcanza");
  assert.equal(verificado({ chequeoFinanzas: "chequeado" }), true, "finanzas alcanza");
  assert.equal(verificado({ chequeado: true }), true, "lo que ya estaba marcado se conserva");
  assert.equal(verificado({ chequeoFinanzas: "rechazado" }), false, "rechazado no es verificado");
  assert.equal(verificado({ chequeado: true, chequeoDirector: "rechazado" }), false);
});

test("el reporte para la Financiera queda con fecha, nombre, CUIT, monto y comprobante, sin CVU ni banco", () => {
  const hoja = hojaCorte(corteFinanciera(estadoConCobro({}), "proc_fin", "2026-10-01", "2026-10-31"));
  const encabezados = hoja.celdas.filter((c) => c.fila === 9 && c.columna >= 2 && c.columna <= 9).sort((a, b) => a.columna - b.columna).map((c) => c.valor);
  assert.deepEqual(encabezados, [
    "Fecha", "Nombre de quien transfiere", "Cuit", "Transferencia ARS", "Transferencia USD", "Comprobante", "Pago Verificado", "Unidad de Negocio",
  ]);
  const textos = hoja.celdas.map((c) => c.valor).filter((v): v is string => typeof v === "string");
  assert.ok(!textos.includes("CVU"));
  /* El CUIT es lo único que va como texto. */
  assert.deepEqual(hoja.numerosComoTexto?.[0], "D10:D10");
});
