import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, renglonDe } from "@/lib/honorarios";
import { tasaDeSetterEnVenta } from "@/lib/comision";
import { comisionSetterDePago, comisionesSetterYReferidor } from "@/lib/finanzas";
import { evaluarPasos } from "@/lib/desglose";
import type { EstadoApp, LineaLiquidada, ResultadoLiquidacion } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Aldana (31/10): las ventas que un setter se queda con sólo marcar la agenda no tienen que comisionar el 5% de siempre: Fede define
   cuánto (o nada). Una venta puede traer su propio % para el setter (Venta.comisionSetter): vacío = el de siempre, 0 = no comisiona.
   Finanzas lo usa en cada cobro; la liquidación saca la comisión entera y un renglón aparte suma o resta la diferencia.
   En el mes de prueba, Daniel (5%) tiene la venta v1: dos cobros de US$ 1.500 con US$ 45 de pasarela cada uno = US$ 2.910 netos.
   ================================================================== */

const NETO = 2910;
const conPropio = (comisionSetter: number | null | undefined): EstadoApp => {
  const e = estadoDePrueba();
  e.ventas = e.ventas.map((v) => (v.id === "v1" ? { ...v, comisionSetter } : v));
  return e;
};
const liquidar = (e: EstadoApp): ResultadoLiquidacion => calcularLiquidacion(e, PERIODO, null);
const lineasDeDaniel = (r: ResultadoLiquidacion): LineaLiquidada[] => r.personas.find((p) => p.miembroId === "dani")!.lineas;
const totalDeDaniel = (r: ResultadoLiquidacion) => r.personas.find((p) => p.miembroId === "dani")!.total;
const rangoDelMes = () => ({ desde: new Date(2026, 8, 1), hasta: new Date(2026, 8, 30, 23, 59, 59) }) as never;

test("sin porcentaje propio, nada cambia: la comisión es la de siempre y no hay renglón de ajuste", () => {
  const e = conPropio(undefined);
  const r = liquidar(e);
  assert.equal(lineasDeDaniel(r).some((l) => l.clave.startsWith("setter-propio:")), false);
  assert.equal(r2(comisionesSetterYReferidor(e, rangoDelMes()).setter), r2(NETO * 0.05));
  assert.equal(totalDeDaniel(r), 250 + r2(NETO * 0.05));
});

test("con 0%, la venta no comisiona: Finanzas da 0 y la liquidación resta lo de arriba con un renglón aparte", () => {
  const e = conPropio(0);
  const r = liquidar(e);
  assert.equal(e.pagos.filter((p) => p.cuotaId.startsWith("c1")).reduce((a, p) => a + comisionSetterDePago(e, e.ventas[0], p), 0), 0);
  const entera = lineasDeDaniel(r).find((l) => l.clave === "c_com")!;
  const ajuste = lineasDeDaniel(r).find((l) => l.clave === "setter-propio:c_com")!;
  assert.equal(entera.monto, r2(NETO * 0.05), "la comisión sale entera, con el % de su regla");
  assert.equal(ajuste.monto, -r2(NETO * 0.05), "y el renglón aparte la resta");
  assert.equal(ajuste.nombre, "Ajuste por porcentaje propio");
  assert.equal(ajuste.tipo, "descuento");
  assert.equal(totalDeDaniel(r), 250, "queda sólo el sueldo");
  assert.equal(ajuste.enFinanzas, entera.enFinanzas, "va del mismo lado que la comisión (la del setter entra al cerrar como gasto)");
});

test("con otro %, la liquidación da lo mismo que Finanzas (con los centavos del redondeo por cobro)", () => {
  const e = conPropio(0.025);
  const r = liquidar(e);
  const ajuste = lineasDeDaniel(r).find((l) => l.clave === "setter-propio:c_com")!;
  assert.equal(ajuste.monto, r2(NETO * 0.025 - NETO * 0.05));
  const enFinanzas = comisionesSetterYReferidor(e, rangoDelMes()).setter;
  const enLiquidacion = totalDeDaniel(r) - 250;
  assert.ok(Math.abs(enFinanzas - enLiquidacion) < 0.02, `Finanzas ${enFinanzas} vs liquidación ${enLiquidacion}`);
});

test("un % mayor suma: el renglón también va hacia arriba", () => {
  const r = liquidar(conPropio(0.10));
  const ajuste = lineasDeDaniel(r).find((l) => l.clave === "setter-propio:c_com")!;
  assert.equal(ajuste.monto, r2(NETO * 0.05));
  assert.equal(totalDeDaniel(r), 250 + r2(NETO * 0.10));
});

test("el mismo % de su regla no genera renglón; un valor inválido se ignora", () => {
  assert.equal(lineasDeDaniel(liquidar(conPropio(0.05))).some((l) => l.clave.startsWith("setter-propio:")), false);
  assert.equal(tasaDeSetterEnVenta({ comisionRate: 0.05 }, { comisionSetter: -1 }), 0.05, "negativo: se ignora");
  assert.equal(tasaDeSetterEnVenta({ comisionRate: 0.05 }, { comisionSetter: null }), 0.05);
  assert.equal(tasaDeSetterEnVenta({ comisionRate: 0.05 }, { comisionSetter: 0 }), 0, "0 es un valor: no comisiona");
  assert.equal(tasaDeSetterEnVenta({ comisionRate: 0.05, comisionServicios: { p_ment: 0.03 } }, { productoId: "p_ment" }), 0.03, "sin propio, el del servicio");
});

test("el desglose del renglón de ajuste cierra con el monto", () => {
  const r = liquidar(conPropio(0));
  const ajuste = lineasDeDaniel(r).find((l) => l.clave === "setter-propio:c_com")!;
  assert.ok(ajuste.desglose, "trae su desglose");
  assert.deepEqual(evaluarPasos(ajuste.desglose!.pasos).fallas, [], "la cuenta del desglose cierra");
  assert.equal(evaluarPasos(ajuste.desglose!.pasos).valor, ajuste.monto, "y da el monto");
  assert.match(ajuste.desglose!.avisos?.join(" ") ?? "", /Belén Godoy: 0%/);
  assert.ok(renglonDe(r, "dani", "setter-propio:c_com"), "se puede abrir como cualquier renglón");
});

test("una comisión corregida a mano no lleva ajuste: la cuenta ya no es de la app", () => {
  const e = conPropio(0);
  const r = calcularLiquidacion(e, PERIODO, { entradas: { "dani:c_com": { monto: 200 } }, extras: [] } as never);
  assert.equal(lineasDeDaniel(r).some((l) => l.clave.startsWith("setter-propio:")), false);
});

function r2(n: number) { return Math.round(n * 100) / 100; }
