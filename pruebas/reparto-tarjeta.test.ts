import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { borradorDesdeElBanco, type MovimientoDelBanco } from "@/lib/movimientos-del-banco";
import { borradorInicial, datosDelGasto } from "@/lib/carga-gasto";
import { saldosEsperados } from "@/lib/traspasos";
import { construirSemilla } from "@/lib/seed";
import {
  CATEGORIA_SIN_REVISAR, esPagoDeTarjeta, esParteDeUnPago, faltaRepartir, leerCompras, numeroDeCompra, problemaDelReparto,
} from "@/lib/reparto-tarjeta";
import type { Devolucion, EstadoApp, Gasto, Movimiento, Traspaso } from "@/lib/types";

/* ==================================================================
   Aldana (24/10): «consumos de la tarjeta de crédito, la mayoría de honorarios del CEO, y se está cargando sólo el total que se paga a la tarjeta:
   ¿está quedando discriminado a qué categoría corresponde cada uno?». No: el banco sólo avisa el pago diario («Mercury Credit · IO AUTOPAY») y queda un
   solo gasto «Pendiente de revisión». Ahora se reparte en sus compras, cada una con su categoría, y suman lo que se pagó.
   ================================================================== */

const estado = () => {
  const base = construirSemilla() as EstadoApp;
  return { ...base, movimientos: [] as Movimiento[], traspasos: [] as Traspaso[], gastos: [] as Gasto[], devoluciones: [] as Devolucion[], pagos: [] };
};

/* El pago del 22/10 de US$ 2.212,62, cargado como gasto desde el movimiento del banco (el camino real de «Cargar como gasto»). */
function conElPagoDeLaTarjeta() {
  const e = estado();
  const pago = { ref: "mercury:fcdcb3d8", refApp: ["fcdcb3d8"], tipo: "pago-tarjeta", monto: -2212.62, contraparte: "Mercury Credit", detalle: "IO AUTOPAY", fecha: "2026-10-22T14:00:00.000Z" } as MovimientoDelBanco;
  const b = { ...borradorInicial(e.ajustes), ...borradorDesdeElBanco(pago, "ACH-WIRE Mercury", false), categoria: CATEGORIA_SIN_REVISAR, categoriaElegida: true };
  const datos = datosDelGasto(b, { base: "USD", opciones: [] });
  const gasto = { ...datos, id: "g_tarjeta" } as Gasto;
  const conGasto = { ...e, gastos: [gasto] } as EstadoApp;
  assert.equal(acciones.importar(JSON.stringify(conGasto)), true);
  return { e: conGasto, gasto };
}
const estadoActual = () => JSON.parse(acciones.exportar()) as EstadoApp;

test("el pago de la tarjeta cargado del banco es «Pendiente de revisión» y se reconoce como repartible; un gasto cualquiera no", () => {
  const { gasto } = conElPagoDeLaTarjeta();
  assert.equal(gasto.concepto, "Pago de la tarjeta de crédito Mercury");
  assert.equal(gasto.categoria, CATEGORIA_SIN_REVISAR);
  assert.equal(esPagoDeTarjeta(gasto), true);
  assert.equal(esPagoDeTarjeta({ ...gasto, extra: { cuenta: "ACH-WIRE Mercury" } }), false, "sin la referencia del banco no es el pago del banco");
  assert.equal(esPagoDeTarjeta({ ...gasto, concepto: "Zoom" }), false);
});

test("numeroDeCompra entiende los dos formatos y el signo no importa", () => {
  assert.equal(numeroDeCompra("-$45.99"), 45.99);
  assert.equal(numeroDeCompra("1.234,56"), 1234.56);
  assert.equal(numeroDeCompra("1,234.56"), 1234.56);
  assert.equal(numeroDeCompra("US$ 15,99"), 15.99);
  assert.equal(numeroDeCompra("(45,00)"), 45);
  assert.equal(numeroDeCompra("1.500"), 1500, "sin decimales claros, el punto separa miles");
  assert.equal(numeroDeCompra("Zoom"), null);
});

test("leer lo pegado: una compra por línea, con la categoría que sugiere la app; lo que no se reconoce queda «Pendiente de revisión»", () => {
  const e = estado();
  const compras = leerCompras("Zoom 15,99\nOct 22 Meta Ads 1.200,50\nUn comercio raro 42\nsin monto acá\n", e);
  assert.deepEqual(compras.map((c) => [c.concepto, c.monto, c.categoria]), [
    ["Zoom", 15.99, "Software"], ["Meta Ads", 1200.5, "Meta Ads"], ["Un comercio raro", 42, CATEGORIA_SIN_REVISAR],
  ]);
});

test("leer lo pegado: el CSV de la tarjeta, con encabezado; el autopay y el cashback no son compras", () => {
  const e = estado();
  const csv = [
    "Date (UTC),Description,Amount,Status,Last Four Digits",
    '2026-10-22,"Zoom.us 888-799",-15.99,Sent,4242',
    '2026-10-22,"Notion Labs",-96.00,Sent,4242',
    '2026-10-22,"Mercury Credit IO AUTOPAY",2212.62,Sent,',
    '2026-10-22,"Mercury IO Cashback",5.22,Sent,',
  ].join("\n");
  const compras = leerCompras(csv, e);
  assert.deepEqual(compras.map((c) => [c.concepto, c.monto]), [["Zoom.us 888-799", 15.99], ["Notion Labs", 96]]);
});

test("el reparto tiene que sumar exacto lo que se pagó", () => {
  const compras = [{ concepto: "Zoom", monto: 15.99, categoria: "Software" }, { concepto: "Honorarios", monto: 2000, categoria: "Honorarios del CEO" }];
  assert.equal(faltaRepartir(2212.62, compras), 196.63);
  assert.match(problemaDelReparto(2212.62, compras) ?? "", /Faltan 196\.63/);
  assert.match(problemaDelReparto(2212.62, [...compras, { concepto: "Resto", monto: 197, categoria: "Software" }]) ?? "", /Sobran 0\.37/);
  assert.equal(problemaDelReparto(2212.62, [...compras, { concepto: "Resto", monto: 196.63, categoria: "Software" }]), null);
  assert.match(problemaDelReparto(100, []) ?? "", /al menos una/);
  assert.match(problemaDelReparto(100, [{ concepto: "", monto: 100, categoria: "Software" }]) ?? "", /qué fue la compra 1/);
  assert.match(problemaDelReparto(100, [{ concepto: "x", monto: 0, categoria: "Software" }]) ?? "", /monto de la compra 1/);
});

test("repartir el pago: el gasto único se va, quedan sus compras con su categoría y grupo, y la cuenta de Mercury espera lo mismo", () => {
  const { e, gasto } = conElPagoDeLaTarjeta();
  const previo = { fecha: "2026-10-20T00:00:00.000Z", saldos: [{ procesadorId: "proc_mercury", monto: 10000, moneda: "USD" as const, montoBase: 10000 }] };
  const antes = saldosEsperados(e, previo, "2026-10-23T00:00:00.000Z").get("proc_mercury")!;
  assert.equal(antes.esperado, 10000 - 2212.62);

  const compras = [
    { concepto: "Honorarios Yari", monto: 2000, categoria: "Honorarios del CEO" },
    { concepto: "Zoom", monto: 15.99, categoria: "Software" },
    { concepto: "Meta Ads", monto: 196.63, categoria: "Meta Ads" },
  ];
  const r = acciones.repartirPagoDeTarjeta(gasto.id, compras);
  assert.equal(r.ok, true);
  const despues = estadoActual();
  assert.equal(despues.gastos.some((g) => g.id === "g_tarjeta"), false, "el gasto único ya no está");
  const partes = despues.gastos.filter((g) => esParteDeUnPago(g));
  assert.deepEqual(partes.map((g) => [g.concepto, g.monto, g.categoria, g.grupo]).sort(), [
    ["Honorarios Yari", 2000, "Honorarios del CEO", "dueno"], ["Meta Ads", 196.63, "Meta Ads", "operativo"], ["Zoom", 15.99, "Software", "operativo"],
  ].sort());
  assert.equal(Math.round(partes.reduce((a, g) => a + g.monto, 0) * 100) / 100, 2212.62);
  for (const g of partes) {
    assert.equal(g.fecha, gasto.fecha, "el mismo día");
    assert.equal(g.extra.cuenta, "ACH-WIRE Mercury", "la misma cuenta");
    assert.equal(g.extra.bancoRef, "mercury:fcdcb3d8", "la misma referencia del banco: el movimiento sigue figurando como cargado");
    assert.equal(g.extra.repartidoDe, "g_tarjeta");
    assert.equal(esPagoDeTarjeta(g), false, "una parte no se vuelve a repartir");
  }
  const caja = saldosEsperados(despues, previo, "2026-10-23T00:00:00.000Z").get("proc_mercury")!;
  assert.equal(caja.esperado, antes.esperado, "la caja de la cuenta no cambia: sólo cambia dónde cae cada compra");
  assert.match(despues.actividad[0].detalle, /Se repartió el pago de la tarjeta de 2\.212,62 USD en 3 compras/);
});

test("repartir: si no suma, si no es el pago de la tarjeta o si ya se repartió, no toca nada", () => {
  const { gasto } = conElPagoDeLaTarjeta();
  const noSuma = acciones.repartirPagoDeTarjeta(gasto.id, [{ concepto: "Zoom", monto: 15.99, categoria: "Software" }]);
  assert.equal(noSuma.ok, false);
  assert.equal(estadoActual().gastos.length, 1, "no se tocó");
  assert.equal(acciones.repartirPagoDeTarjeta("no_existe", []).ok, false);
  const una = acciones.repartirPagoDeTarjeta(gasto.id, [{ concepto: "Todo honorarios", monto: 2212.62, categoria: "Honorarios del CEO" }]);
  assert.equal(una.ok, true, "con una sola línea alcanza: es reclasificar el pago entero");
  const parte = estadoActual().gastos[0];
  assert.equal(acciones.repartirPagoDeTarjeta(parte.id, [{ concepto: "x", monto: 2212.62, categoria: "Software" }]).ok, false, "ya repartido");
});
