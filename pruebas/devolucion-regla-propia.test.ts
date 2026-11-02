import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion } from "@/lib/honorarios";
import type { EstadoApp, LineaLiquidada, PersonaLiquidada } from "@/lib/types";
import { devolucion, estadoDeYari, iso, OCTUBRE } from "./estado-devolucion";

/* ==================================================================
   Aldana (01/11): «en comisiones de Santi hubo dos reembolsos que el sistema no descontó esa comisión, así que la descontó de forma manual».

   Santiago cobra el 5% por una regla de su liquidación («Comisión de director», sólo ventas desde el 1/7) y en su ficha tiene comisión 0. La devolución
   le revertía lo que decía la FICHA (0): no le descontaba nada. Ahora se le revierte lo que dice la regla con la que se le calculó la comisión.
   ================================================================== */

/** El caso de Yari (Belén Godoy, devolución de 3.000 el 03/10) con Santi como en producción: 0 en la ficha y su 5% en una regla que Finanzas no calcula. */
function conDirectorConReglaPropia(desde: string): EstadoApp {
  const base = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })] });
  return {
    ...base,
    equipo: base.equipo.map((m) => (m.id === "santi" ? { ...m, comisionRate: 0 } : m)),
    honorarios: base.honorarios.map((h) => h.miembroId !== "santi" ? h : {
      ...h, conceptos: h.conceptos.map((c) => ({ ...c, soloVentasDesdeInicio: true, desde, procesadoresDeTodas: true })),
    }),
  };
}

const de = (e: EstadoApp, id: string): PersonaLiquidada => {
  const p = calcularLiquidacion(e, OCTUBRE, undefined).personas.find((x) => x.miembroId === id);
  assert.ok(p, `falta ${id}`);
  return p;
};
const reversa = (p: PersonaLiquidada): LineaLiquidada | undefined => p.lineas.find((l) => l.tipo === "devolucion");

test("el director con su 5% en una regla de la liquidación (0 en la ficha) también recibe la devolución", () => {
  const dev = reversa(de(conDirectorConReglaPropia("2026-07-01"), "santi"));
  assert.ok(dev, "antes no tenía ninguna línea de devolución");
  assert.equal(dev.clave, "devolucion:d1:director");
  assert.equal(dev.nombre, "Devolución de Belén Godoy");
  /* 5% de lo que entró post pasarelas (1.455 por cuota), las dos cuotas: lo mismo que se le comisionó. */
  assert.equal(dev.monto, -145.5);
  assert.equal(dev.devolucionId, "d1");
  /* Su comisión es un costo de la liquidación (Finanzas no la calcula), así que su reversa también: al cerrar baja ese costo en vez de «ya estar en Finanzas». */
  assert.equal(dev.enFinanzas, false);
  assert.match(dev.desglose?.regla ?? "", /5%/);
});

test("una venta anterior al inicio de su regla no le comisionó nada: no hay qué descontarle", () => {
  /* La regla empieza en noviembre: la venta del 28/09 nunca contó para esta comisión. */
  assert.equal(reversa(de(conDirectorConReglaPropia("2026-11-01"), "santi")), undefined);
});

test("quien cobra por la tasa de su ficha (la que calcula Finanzas) sigue como siempre: lo mismo y «ya está en Finanzas»", () => {
  const e = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })] });
  const santi = reversa(de(e, "santi"));
  assert.equal(santi?.monto, -145.5);
  assert.equal(santi?.enFinanzas, true);
  const mariano = reversa(de(e, "mariano"));
  assert.equal(mariano?.monto, -436.5);
  assert.equal(mariano?.enFinanzas, true);
});

test("a los closers no les cambia nada porque el director tenga una regla propia", () => {
  const propia = conDirectorConReglaPropia("2026-07-01");
  const normal = estadoDeYari({ devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })] });
  assert.equal(reversa(de(propia, "mariano"))?.monto, reversa(de(normal, "mariano"))?.monto);
});
