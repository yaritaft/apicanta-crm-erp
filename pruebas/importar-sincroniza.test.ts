import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNAS_DE_CONTROL_DEL_COBRO, estadoDespuesDeImportar, fechaPlanilla, importarPlanilla, leerFilasVentas, type FilaVentas, type ResultadoImport,
} from "@/lib/angelo";
import { COLUMNAS_QUE_PONE_LA_BASE } from "@/lib/control-cobros";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Movimiento } from "@/lib/types";

/* ==================================================================
   Importar la planilla de Angelo SINCRONIZANDO (reunión del 07/10).

   El id de cada cobro sale del contenido de su fila (persona, fecha, monto,
   cuenta, característica y comprobante): si alguien corrige uno de esos datos
   en la planilla, el cobro cambia de id y reimportar dejaba el viejo y sumaba
   el nuevo (en septiembre eran US$ 17.000 de más). Ahora lo que la planilla ya
   no trae se saca, sin tocar lo que tenga datos cargados en la app, y los cobros
   que ya había conciliado una pasarela se fusionan con los de la planilla.
   ================================================================== */

const dia = (d: number, mes = 9) => `2026-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;

const fila = (n: number, o: Partial<FilaVentas> = {}): FilaVentas => ({
  fila: n, fecha: dia(10), nombre: "Ana Prueba", email: "ana@ejemplo.test", pais: "Argentina", telefono: "",
  vendedor: "Mariano Arias", servicio: "Mentoría", proyecto: "MENT", estrategia: "Lanzamiento", tipoPago: "Contado", plan: "1 pago",
  caracteristica: "Paid in full", tipoVenta: "Venta Nueva", cuenta: "Stripe", valorTotal: 3000, montoUsd: 3000, chequeado: false,
  pagador: "", cuit: "", comprobante: "", observaciones: "", setter: "", referidor: "", referidorTelefono: "", ingresoComunidad: "", ...o,
});

/* Seis clientes distintos, uno por venta (con menos, borrar uno ya sería más del 20%). */
const planilla = (): FilaVentas[] => [
  fila(2, { email: "ana@ejemplo.test", nombre: "Ana Prueba", fecha: dia(3), montoUsd: 3000, valorTotal: 3000 }),
  fila(3, { email: "beto@ejemplo.test", nombre: "Beto Prueba", fecha: dia(5), montoUsd: 2000, valorTotal: 2000, cuenta: "Whop" }),
  fila(4, { email: "caro@ejemplo.test", nombre: "Caro Prueba", fecha: dia(8), montoUsd: 1500, valorTotal: 1500 }),
  fila(5, { email: "dani@ejemplo.test", nombre: "Dani Prueba", fecha: dia(11), montoUsd: 1000, valorTotal: 1000 }),
  fila(6, { email: "eli@ejemplo.test", nombre: "Eli Prueba", fecha: dia(12), montoUsd: 500, valorTotal: 500, cuenta: "Whop" }),
  fila(7, { email: "fede@ejemplo.test", nombre: "Fede Prueba", fecha: dia(15), montoUsd: 700, valorTotal: 700 }),
];

function estadoVacio(): EstadoApp {
  const e = construirSemilla();
  for (const k of ["ventas", "cuotas", "pagos", "contactos", "leads", "movimientos", "devoluciones"] as const) (e as unknown as Record<string, unknown[]>)[k] = [];
  return e;
}

/* Importa y aplica, como lo hace la acción del store. */
function importar(e: EstadoApp, filas: FilaVentas[]): { e: EstadoApp; r: ResultadoImport } {
  const r = importarPlanilla(e, filas);
  const x = estadoDespuesDeImportar(e, r);
  return { e: { ...e, ...x.estado }, r };
}

const total = (e: EstadoApp) => Math.round(e.pagos.reduce((a, p) => a + p.monto, 0) * 100) / 100;

test("la primera importación no saca nada", () => {
  const { r } = importar(estadoVacio(), planilla());
  assert.equal(r.ventasQueSobran.length, 0);
  assert.equal(r.pagosQueSobran.length, 0);
  assert.equal(r.resumen.sacaCobros, 0);
});

test("reimportar lo mismo no duplica ni saca nada", () => {
  const uno = importar(estadoVacio(), planilla());
  const dos = importar(uno.e, planilla());
  assert.equal(total(dos.e), 8700);
  assert.equal(dos.e.pagos.length, 6);
  assert.equal(dos.r.pagosQueSobran.length, 0);
});

test("si se corrige el monto de un cobro en la planilla, el viejo se saca y el total no se infla", () => {
  const uno = importar(estadoVacio(), planilla());
  assert.equal(total(uno.e), 8700);
  /* Beto había pagado 2.000 y en la planilla se corrigió a 1.800: cambia el id del cobro y de la venta. */
  const corregida = planilla();
  corregida[1] = fila(3, { email: "beto@ejemplo.test", nombre: "Beto Prueba", fecha: dia(5), montoUsd: 1800, valorTotal: 2000, cuenta: "Whop", plan: "2 pagos", caracteristica: "Cuota #1" });
  const dos = importar(uno.e, corregida);
  assert.ok(dos.r.pagosQueSobran.length >= 1, "el cobro viejo tiene que sobrar");
  assert.equal(total(dos.e), 8500);                                 // sin los 2.000 viejos, con los 1.800 corregidos
  const idsPagos = new Set(dos.e.pagos.map((p) => p.id));
  assert.equal(idsPagos.size, dos.e.pagos.length, "ningún cobro repetido");
});

test("una venta que la planilla ya no trae se saca con sus cuotas y cobros", () => {
  const uno = importar(estadoVacio(), planilla());
  const sin = planilla().filter((f) => f.email !== "caro@ejemplo.test");
  const dos = importar(uno.e, sin);
  assert.equal(dos.r.ventasQueSobran.length, 1);
  assert.ok(dos.r.resumen.sacaMonto > 0);
  assert.equal(total(dos.e), 7200);
  assert.equal(dos.e.ventas.filter((v) => v.contactoNombre.startsWith("Caro")).length, 0);
  /* No quedan cuotas sueltas de la venta que se fue. */
  const idsVentas = new Set(dos.e.ventas.map((v) => v.id));
  assert.ok(dos.e.cuotas.filter((c) => c.id.includes("cuo_ef_")).every((c) => idsVentas.has(c.ventaId)));
});

test("un archivo recortado (no llega hasta donde llegaba lo importado) no saca nada, y lo avisa", () => {
  const uno = importar(estadoVacio(), planilla());
  const soloLoReciente = planilla().filter((f) => f.fecha >= dia(11));
  const dos = importar(uno.e, soloLoReciente);
  assert.equal(dos.r.pagosQueSobran.length, 0);
  assert.equal(dos.r.ventasQueSobran.length, 0);
  assert.ok(dos.r.avisos.some((a) => a.tipo === "archivo-parcial"));
  assert.equal(dos.e.pagos.length, 6);
});

test("no se saca un cobro con datos cargados en la app (chequeo, comprobante o pasarela): se deja y se avisa", () => {
  const uno = importar(estadoVacio(), planilla());
  const marcado = uno.e.pagos.find((p) => p.monto === 2000)!;
  const e = { ...uno.e, pagos: uno.e.pagos.map((p) => (p.id === marcado.id ? { ...p, chequeoFinanzas: "chequeado" as const } : p)) };
  const corregida = planilla();
  corregida[1] = fila(3, { email: "beto@ejemplo.test", nombre: "Beto Prueba", fecha: dia(5), montoUsd: 1800, valorTotal: 2000, cuenta: "Whop", plan: "2 pagos", caracteristica: "Cuota #1" });
  const dos = importar(e, corregida);
  assert.ok(dos.r.protegidos.length >= 1);
  assert.ok(dos.r.avisos.some((a) => a.tipo === "sobran-con-datos"));
  assert.ok(dos.e.pagos.some((p) => p.id === marcado.id), "el cobro chequeado sigue");
});

test("no se saca una venta con una devolución cargada", () => {
  const uno = importar(estadoVacio(), planilla());
  const venta = uno.e.ventas.find((v) => v.contactoNombre.startsWith("Caro"))!;
  const e = { ...uno.e, devoluciones: [{ id: "dev1", ventaId: venta.id, monto: 100, fecha: dia(9), estado: "propuesta" }] } as unknown as EstadoApp;
  const dos = importar(e, planilla().filter((f) => f.email !== "caro@ejemplo.test"));
  assert.equal(dos.r.ventasQueSobran.length, 0);
  assert.ok(dos.r.protegidos.some((p) => p.tipo === "venta" && /devolución/.test(p.motivo)));
});

test("un cobro que ya había conciliado una pasarela se fusiona con el de la planilla: toma su comisión real y no se cuenta dos veces", () => {
  const uno = importar(estadoVacio(), planilla());
  /* La pasarela concilió un cobro de Caro (1.500, Stripe, el 08/09) antes de que la planilla lo trajera: pago propio sobre la misma cuota. */
  const original = uno.e.pagos.find((p) => p.monto === 1500)!;
  const mov: Movimiento = {
    id: "mov_stripe_1", proveedor: "stripe", referencia: "pi_123", monto: 1500, moneda: "USD", fee: 52.5, neto: 1447.5, fecha: dia(8),
    estado: "conciliado", pagoId: "pag_conciliado_1", cuotaId: original.cuotaId, origen: "api", creadoEn: dia(8),
  } as Movimiento;
  const conciliado = { ...original, id: "pag_conciliado_1", movimientoId: mov.id, feeMonto: 52.5, feeRate: 0.035, referencia: "pi_123", chequeado: true };
  /* En la base todavía no está el cobro de la planilla: sólo el conciliado. */
  const e: EstadoApp = { ...uno.e, pagos: [conciliado, ...uno.e.pagos.filter((p) => p.id !== original.id)], movimientos: [mov] };
  const dos = importar(e, planilla());
  assert.equal(dos.r.fusiones.length, 1);
  assert.equal(dos.r.fusiones[0].viejoId, "pag_conciliado_1");
  assert.equal(total(dos.e), 8700, "el cobro no se cuenta dos veces");
  const fusionado = dos.e.pagos.find((p) => p.id === original.id)!;
  assert.equal(fusionado.movimientoId, "mov_stripe_1");
  assert.equal(fusionado.feeMonto, 52.5);
  assert.equal(dos.e.pagos.some((p) => p.id === "pag_conciliado_1"), false);
  /* El movimiento ahora apunta al cobro de la planilla. */
  assert.equal(dos.e.movimientos[0].pagoId, original.id);
});

test("un cobro de pasarela que NO está en la planilla se deja (puede ser real)", () => {
  const uno = importar(estadoVacio(), planilla());
  const original = uno.e.pagos.find((p) => p.monto === 1500)!;
  const solo = { ...original, id: "pag_solo", monto: 1200, movimientoId: "mov_x", fecha: dia(30) };
  const e: EstadoApp = { ...uno.e, pagos: [solo, ...uno.e.pagos] };
  const dos = importar(e, planilla());
  assert.equal(dos.r.fusiones.length, 0);
  assert.ok(dos.e.pagos.some((p) => p.id === "pag_solo"));
});

test("una fecha con un año imposible («8/10/0206») no entra: se avisa con su fila", () => {
  assert.equal(fechaPlanilla("8/10/0206"), null);
  assert.equal(fechaPlanilla("8/10/2026"), "2026-10-08T15:00:00.000Z");
  assert.equal(fechaPlanilla("2026-10-08"), "2026-10-08T15:00:00.000Z");
  assert.equal(fechaPlanilla("46000"), "2025-12-09T15:00:00.000Z".replace("2025-12-09", "2025-12-09"));
  const tabla = [
    ["Fecha del pago", "Email", "Servicio adquirido", "Monto abonado USD", "Valor total de la venta"],
    ["8/10/0206", "x@ejemplo.test", "Mentoría", "500", "500"],
    ["", "", "", "", ""],
    ["8/10/2026", "y@ejemplo.test", "Mentoría", "500", "500"],
  ];
  const l = leerFilasVentas(tabla);
  assert.equal(l.filas.length, 1);
  assert.deepEqual(l.descartadas, [{ fila: 2, texto: "8/10/0206", monto: 500 }]);
  const r = importarPlanilla(estadoVacio(), l.filas, { descartadas: l.descartadas });
  const aviso = r.avisos.find((a) => a.tipo === "fecha-invalida");
  assert.deepEqual(aviso?.filas, [2]);
});

test("la lista de columnas de control que repite angelo.ts es la oficial", () => {
  assert.deepEqual([...COLUMNAS_DE_CONTROL_DEL_COBRO].sort(), [...COLUMNAS_QUE_PONE_LA_BASE].sort());
});

test("sincronizar apagado: no saca nada aunque sobre", () => {
  const uno = importar(estadoVacio(), planilla());
  const r = importarPlanilla(uno.e, planilla().filter((f) => f.email !== "caro@ejemplo.test"), { sincronizar: false });
  assert.equal(r.ventasQueSobran.length, 0);
  assert.equal(r.pagosQueSobran.length, 0);
});
