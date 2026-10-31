import test from "node:test";
import assert from "node:assert/strict";
import { origenDelSetterPorVenta, textoDelOrigen } from "@/lib/setter-agendas";
import { MINIMO_QUE_AVISA, settersConComisionInusual } from "@/lib/comision-inusual";
import { pasaFiltrosDeVenta } from "@/lib/filtros-de-venta";
import type { EstadoApp } from "@/lib/types";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Aldana (31/10): «necesito saber qué ventas está comisionando Daniel: su comisión es mil y pico y nunca comisionó tanto por setting».
   Se ven las ventas por setter, de dónde sale cada una, y la liquidación avisa cuando un setter cobra el doble de su mejor mes.
   ================================================================== */

const venta = (id: string, setterId: string | undefined, contactoId: string | undefined, fecha = "2026-10-26T15:00:00.000Z") => ({ id, setterId, contactoId, fecha });
const sesion = (id: string, contactoId: string, extra: Record<string, unknown> = {}) => ({
  id, contactoId, leadId: undefined, inicia: "2026-10-24T15:00:00.000Z", setterId: "dani", setterMarcadoEn: undefined, utm: {}, ...extra,
});

test("cada venta con setter dice cómo lo tiene: marcó la agenda, entró por su link o lo puso el closer", () => {
  const e = {
    ventas: [venta("v1", "dani", "c1"), venta("v2", "dani", "c2"), venta("v3", "dani", "c3"), venta("v4", undefined, "c1")],
    sesiones: [
      sesion("s1", "c1", { setterMarcadoEn: "2026-10-24T20:00:00.000Z" }),
      sesion("s2", "c2", { utm: { utm_campaign: "setter_daniel" } }),
    ],
  };
  const o = origenDelSetterPorVenta(e as never);
  assert.deepEqual(o.get("v1"), { via: "marcada", marcadaEl: "2026-10-24", despuesDeLaVenta: false });
  assert.deepEqual(o.get("v2"), { via: "link" });
  assert.deepEqual(o.get("v3"), { via: "closer" });
  assert.equal(o.has("v4"), false, "una venta sin setter no figura");
  assert.equal(textoDelOrigen(o.get("v1")), "marcó la agenda el 24/10");
  assert.equal(textoDelOrigen(o.get("v2")), "entró por su link");
  assert.equal(textoDelOrigen(o.get("v3")), "lo puso el closer");
});

test("si el setter marcó la agenda un día después de la venta, lo dice: el closer ya había cerrado", () => {
  const e = {
    ventas: [venta("tarde", "dani", "c1", "2026-10-22T15:00:00.000Z"), venta("mismoDia", "dani", "c2", "2026-10-24T15:00:00.000Z"), venta("antes", "dani", "c3", "2026-10-27T15:00:00.000Z")],
    sesiones: [
      sesion("s1", "c1", { inicia: "2026-10-21T15:00:00.000Z", setterMarcadoEn: "2026-10-24T20:00:00.000Z" }),
      sesion("s2", "c2", { inicia: "2026-10-23T15:00:00.000Z", setterMarcadoEn: "2026-10-24T20:00:00.000Z" }),
      sesion("s3", "c3", { inicia: "2026-10-26T15:00:00.000Z", setterMarcadoEn: "2026-10-24T20:00:00.000Z" }),
    ],
  };
  const o = origenDelSetterPorVenta(e as never);
  assert.equal(o.get("tarde")?.despuesDeLaVenta, true);
  assert.equal(o.get("mismoDia")?.despuesDeLaVenta, false, "el mismo día no alcanza para sospechar");
  assert.equal(o.get("antes")?.despuesDeLaVenta, false);
  assert.equal(textoDelOrigen(o.get("tarde")), "marcó la agenda el 24/10 (la venta ya estaba hecha)");
});

test("una agenda marcada de hace más de 45 días, o de otro setter, no es el origen: lo puso el closer", () => {
  const e = {
    ventas: [venta("v1", "dani", "c1", "2026-10-26T15:00:00.000Z"), venta("v2", "dani", "c2")],
    sesiones: [
      sesion("s1", "c1", { inicia: "2026-08-01T15:00:00.000Z", setterMarcadoEn: "2026-08-02T00:00:00.000Z" }),
      sesion("s2", "c2", { setterId: "otro", setterMarcadoEn: "2026-10-24T20:00:00.000Z" }),
    ],
  };
  const o = origenDelSetterPorVenta(e as never);
  assert.equal(o.get("v1")?.via, "closer");
  assert.equal(o.get("v2")?.via, "closer");
});

test("el filtro de ventas por setter: sólo pasan las del setter elegido; «sin» las que no tienen", () => {
  const base = { vendedor: "", servicio: "", estrategia: "", proyecto: "" };
  assert.equal(pasaFiltrosDeVenta({ setterId: "dani" } as never, { ...base, setter: "dani" }), true);
  assert.equal(pasaFiltrosDeVenta({ setterId: "otro" } as never, { ...base, setter: "dani" }), false);
  assert.equal(pasaFiltrosDeVenta({} as never, { ...base, setter: "dani" }), false);
  assert.equal(pasaFiltrosDeVenta({} as never, { ...base, setter: "" }), true, "sin filtro, todas");
});

/* Dani (setter, 5%) en la liquidación de prueba: cobros de septiembre en v1 (Belén, con Dani de setter). */
function conMesesAnteriores(montoDeSeptiembre: number, montoDeAgosto: number): EstadoApp {
  const e = estadoDePrueba();
  const p1 = e.pagos.find((p) => p.id === "p1")!;
  const p2 = e.pagos.find((p) => p.id === "p2")!;
  const agosto = { ...p1, id: "p_ago", fecha: "2026-08-12T15:00:00.000Z", monto: montoDeAgosto, feeMonto: montoDeAgosto * 0.03 };
  const sept = e.pagos.map((p) => (p.id === "p1" || p.id === "p2" ? { ...p, monto: montoDeSeptiembre / 2, feeMonto: (montoDeSeptiembre / 2) * 0.03 } : p));
  return { ...e, pagos: [...sept, agosto] } as EstadoApp;
}

test("la liquidación avisa cuando un setter cobra más del doble de su mejor mes de los seis anteriores", () => {
  const e = conMesesAnteriores(40_000, 10_000);
  const a = settersConComisionInusual(e, PERIODO);
  assert.equal(a.length, 1);
  assert.equal(a[0].miembroId, "dani");
  assert.equal(a[0].mesDelMejor, "2026-08");
  assert.ok(a[0].veces >= 2);
  assert.ok(a[0].esteMes >= MINIMO_QUE_AVISA && a[0].esteMes > a[0].mejorAntes * 2);
});

test("no avisa si es parecido a lo de siempre, si es poco o si nunca había cobrado", () => {
  assert.equal(settersConComisionInusual(conMesesAnteriores(20_000, 15_000), PERIODO).length, 0, "no llega al doble");
  assert.equal(settersConComisionInusual(conMesesAnteriores(2_000, 100), PERIODO).length, 0, "es poco: no llega al mínimo");
  const sinHistoria = estadoDePrueba();
  assert.equal(settersConComisionInusual(sinHistoria, PERIODO).length, 0, "sin meses anteriores no hay con qué comparar");
});
