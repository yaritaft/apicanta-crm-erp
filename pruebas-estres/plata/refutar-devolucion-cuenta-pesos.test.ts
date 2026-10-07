import "./plata-tz";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acciones, fijarAcceso } from "@/lib/store";
import { ACCESO_DUENO } from "@/lib/permisos";
import { estadoVacio } from "@/lib/seed";
import { cajaEsperada } from "@/lib/caja";
import { saldosEsperados } from "@/lib/traspasos";
import { cambioParaDevolver, devolvibleDeVenta, pesosDeLaDevolucion, problemaDeDevolucion, procesadorDeLaVenta } from "@/lib/devoluciones";
import { esCuentaEnPesos } from "@/lib/reporteFinanciera";
import type { Devolucion, EstadoApp } from "@/lib/types";

/* Intento de refutar «una devolución cargada desde el formulario por una cuenta en pesos nunca resta de esa cuenta».
   Va por las acciones reales del store (las mismas que usa la pantalla) y con el catálogo real de cuentas (seed):
   cobro por la Financiera en pesos con el tipo de cambio y los pesos que pide el formulario de cobros, y la
   devolución con los argumentos que arma CargarDevolucion.guardar().
   ARREGLADO (lote dev): el formulario pide los pesos por una cuenta en pesos (los propone con el cambio del cobro) y
   los guarda; las afirmaciones que decían «BUG» están invertidas. */

const art = (d: number, h = 12) => new Date(Date.UTC(2026, 9, d, h + 3)).toISOString();
const hoy = () => JSON.parse(acciones.exportar()) as EstadoApp;

function armar() {
  const e = {
    ...estadoVacio(),
    equipo: [{ id: "c1", nombre: "Closer", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }],
    ventas: [{ id: "v1", contactoNombre: "Belén", precioAcordado: 1000, fecha: art(10), moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: art(10), extra: {} }],
    cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1000, estado: "pendiente", esReserva: false }],
    actividad: [], gastos: [],
  } as unknown as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(e)), true);
  fijarAcceso(ACCESO_DUENO);
  /* El cobro, como lo carga el formulario de cobros en una cuenta en pesos: dólares, tipo de cambio y los pesos. */
  assert.equal(acciones.registrarPago({
    cuotaId: "q1", reajuste: "pendiente",
    cobros: [{ procesadorId: "proc_financiera_ars", monto: 1000, fecha: art(12, 10), tipoCambio: 1500, montoArs: 1_500_000, pagador: "Belén", cuit: "27-12345678-4" }],
  }), true);
}

/* Lo que manda CargarDevolucion.guardar() al guardar una devolución NUEVA: por una cuenta en pesos, los pesos que propone
   (monto × el cambio del cobro de esa venta por esa cuenta) y el cambio. */
function comoLoGuardaElFormulario(monto: number, medio: string | undefined) {
  const e = hoy();
  const cuenta = e.procesadores.find((p) => p.id === medio);
  const pesos = cuenta && esCuentaEnPesos(cuenta) ? pesosDeLaDevolucion(monto, cambioParaDevolver(e, "v1", medio)?.tipoCambio) : {};
  const comun = {
    monto, fecha: art(20), procesadorId: medio || undefined, comprobante: { ruta: "x", nombre: "x.png", tipo: "image/png", tamano: 1 } as never,
    noDescontarAlCloser: false, motivo: undefined, notas: undefined, montoArs: pesos.montoArs, tipoCambio: pesos.tipoCambio,
  };
  return { e, id: acciones.registrarDevolucion({ ventaId: "v1", ...comun, sesionId: undefined, darDeBaja: false, marcarLlamada: true }) };
}

const previo = { fecha: art(1), saldos: [{ procesadorId: "proc_financiera_ars", monto: 0, moneda: "ARS", montoBase: 0 }, { procesadorId: "proc_stripe", monto: 0, moneda: "USD", montoBase: 0 }] } as never;

test("el formulario propone la Financiera en pesos, propone los pesos con el cambio del cobro, y la devolución queda con montoArs y tipoCambio", () => {
  armar();
  const e = hoy();
  const pago = e.pagos[0];
  assert.equal(pago.procesadorId, "proc_financiera_ars");
  assert.equal(pago.montoArs, 1_500_000, "el cobro sí guardó los pesos");
  assert.equal(pago.tipoCambio, 1500, "y el tipo de cambio");
  assert.equal(procesadorDeLaVenta(e, "v1"), "proc_financiera_ars", "el formulario propone la cuenta con la que se pagó");
  assert.equal(devolvibleDeVenta(e, "v1", art(20)).queda, 1000);
  assert.equal(problemaDeDevolucion(e, { ventaId: "v1", monto: 400, fecha: art(20), procesadorId: "proc_financiera_ars", tieneComprobante: true }), null, "se puede guardar");
  assert.notEqual(problemaDeDevolucion(e, { ventaId: "v1", monto: 400, fecha: art(20), procesadorId: "proc_financiera_ars", tieneComprobante: true, sinPesos: true }), null, "pero no sin los pesos");

  const { id } = comoLoGuardaElFormulario(400, procesadorDeLaVenta(e, "v1"));
  assert.ok(id);
  const d = hoy().devoluciones.find((x) => x.id === id) as Devolucion;
  assert.equal(d.procesadorId, "proc_financiera_ars");
  assert.equal(d.monto, 400);
  assert.equal(d.montoArs, 600_000, "se guardaron los pesos");
  assert.equal(d.tipoCambio, 1500, "y el tipo de cambio");
});

test("la caja total resta los 400 y la cuenta en pesos también: «tendría que haber» de la Financiera baja 600.000", () => {
  armar();
  const { id } = comoLoGuardaElFormulario(400, "proc_financiera_ars");
  assert.ok(id);
  const e = hoy();
  const hasta = art(30);
  const total = cajaEsperada(e, { fecha: art(1), total: 0 }, hasta);
  assert.equal(total.devoluciones, 400, "el total de la caja sí la resta");
  assert.equal(total.cobrado, 1000);
  const fin = saldosEsperados(e, previo, hasta).get("proc_financiera_ars")!;
  assert.equal(fin.entro, 1_500_000, "lo que entró (la semilla le pone 0% a la Financiera)");
  assert.equal(fin.salio, 600_000, "la devolución de US$ 400 (600.000 pesos a 1.500) sale de la cuenta");
  assert.equal(fin.esperado, 900_000);
  /* Y una cargada antes del arreglo, sin los pesos, cae al cambio del cobro. */
  const sinPesos = { ...hoy(), devoluciones: hoy().devoluciones.map((d) => ({ ...d, montoArs: undefined, tipoCambio: undefined })) } as EstadoApp;
  assert.equal(saldosEsperados(sinPesos, previo, hasta).get("proc_financiera_ars")!.salio, 600_000, "las de antes también");
  /* El mismo día, la misma plata por una cuenta en dólares sí resta: el hueco es sólo de las cuentas en pesos. */
  armar();
  const dolares = comoLoGuardaElFormulario(400, "proc_stripe");
  assert.ok(dolares.id);
  assert.equal(saldosEsperados(hoy(), previo, hasta).get("proc_stripe")!.salio, 400);
});

test("si la devolución trajera los pesos (o el tipo de cambio) el hueco no existe: lo único que falta es que el formulario los pida", () => {
  armar();
  const e0 = hoy();
  const id = acciones.registrarDevolucion({
    ventaId: "v1", monto: 400, fecha: art(20), procesadorId: "proc_financiera_ars", noDescontarAlCloser: false,
    montoArs: 600_000, tipoCambio: 1500,
  });
  assert.ok(id);
  const d = hoy().devoluciones.find((x) => x.id === id)!;
  assert.equal(d.montoArs, 600_000, "el store sí los guarda cuando se los pasan");
  const fin = saldosEsperados(hoy(), previo, art(30)).get("proc_financiera_ars")!;
  assert.equal(fin.salio, 600_000);
  assert.equal(fin.esperado, 900_000);
  assert.equal(e0.devoluciones.length, 0);
});

test("el formulario pide los pesos y el tipo de cambio por una cuenta en pesos, y le dice a quien carga que resta de «la caja de {cuenta}»", () => {
  const src = readFileSync(new URL("../../src/components/devoluciones/CargarDevolucion.tsx", import.meta.url), "utf8");
  assert.match(src, /montoArs: pesos\.montoArs, tipoCambio: pesos\.tipoCambio/, "guarda los pesos y el cambio");
  assert.match(src, /Pesos que salieron de la cuenta/, "los pide");
  assert.match(src, /la caja de \$\{cuenta\}/, "promete que resta de la caja de la cuenta elegida");
  /* Los demás lugares de la app no llenan esos dos campos: entran por este formulario (confirmar la propuesta de una pasarela incluido). */
  for (const f of ["src/lib/reembolsos.ts", "src/lib/devolucion-ui.ts", "src/components/devoluciones/ReembolsosPasarelas.tsx",
    "src/components/devoluciones/DevolucionesDeVenta.tsx", "src/components/devoluciones/DevolucionGlobal.tsx", "src/components/finanzas/ListaDevoluciones.tsx"]) {
    const s = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.equal(/montoArs|tipoCambio/.test(s), false, f);
  }
});
