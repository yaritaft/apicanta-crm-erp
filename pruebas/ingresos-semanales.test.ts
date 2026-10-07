import test from "node:test";
import assert from "node:assert/strict";
import {
  cobrosDeCelda, diasDelRango, etiquetaDeRango, ingresosPorCuentaYServicio, lunesDe, moverDias, semanaDe, SIN_CUENTA, SIN_SERVICIO,
} from "@/lib/ingresos-semanales";
import { cashCollected } from "@/lib/finanzas";
import { periodoAnterior, rangoDeFechas } from "@/lib/metricas";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Pago } from "@/lib/types";

/* Una semana chica a mano: lunes 5 a domingo 11 de octubre de 2026. */
function estado(): EstadoApp {
  const pago = (id: string, cuotaId: string, procesadorId: string | undefined, monto: number, fecha: string): Pago =>
    ({ id, cuotaId, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha, creadoEn: fecha });
  return {
    procesadores: [
      { id: "stripe", nombre: "Stripe" }, { id: "mercury", nombre: "ACH-WIRE Mercury" }, { id: "fin", nombre: "Financiera ARS Juan" },
    ],
    productos: [{ id: "mentoria", nombre: "Mentoría" }, { id: "downsell", nombre: "Downsell" }],
    ventas: [
      { id: "v1", productoId: "mentoria" }, { id: "v2", productoId: "downsell" }, { id: "v3" }, { id: "v4", productoId: "borrado" },
    ],
    cuotas: [
      { id: "c1", ventaId: "v1" }, { id: "c2", ventaId: "v2" }, { id: "c3", ventaId: "v3" }, { id: "c4", ventaId: "v4" },
    ],
    pagos: [
      pago("p1", "c1", "stripe", 100.1, "2026-10-05T15:00:00.000"),
      pago("p2", "c1", "stripe", 200.2, "2026-10-07T12:00:00.000"),
      pago("p3", "c1", "mercury", 0.3, "2026-10-09T09:00:00.000"),
      pago("p4", "c2", "stripe", 50, "2026-10-11T23:00:00.000"),
      pago("p5", "c3", "fin", 10, "2026-10-08T10:00:00.000"),
      pago("p6", "c1", undefined, 7.77, "2026-10-06T10:00:00.000"),
      pago("p7", "c4", "stripe", 1, "2026-10-06T11:00:00.000"),
      /* Fuera de la semana: el domingo anterior y el lunes siguiente. */
      pago("afuera1", "c1", "stripe", 999, "2026-10-04T23:59:00.000"),
      pago("afuera2", "c1", "stripe", 999, "2026-10-12T00:00:00.000"),
    ],
  } as unknown as EstadoApp;
}

const semana = () => rangoDeFechas("2026-10-05", "2026-10-11", "5 al 11 oct");

test("cada cobro de la semana cae en una sola celda: cuenta × servicio", () => {
  const e = estado();
  const r = ingresosPorCuentaYServicio(e, semana());
  const celda = (cuenta: string, servicio: string) => r.cuentas.find((c) => c.id === cuenta)?.porServicio[servicio];

  assert.equal(celda("stripe", "mentoria")?.monto, 300.3, "100,10 + 200,20");
  assert.equal(celda("stripe", "mentoria")?.cobros, 2);
  assert.equal(celda("stripe", "downsell")?.monto, 50, "el del domingo a las 23 entra");
  assert.equal(celda("mercury", "mentoria")?.monto, 0.3);
  assert.equal(celda("fin", SIN_SERVICIO)?.monto, 10, "una venta sin servicio va a «Sin servicio»");
  assert.equal(celda(SIN_CUENTA, "mentoria")?.monto, 7.77, "un cobro sin cuenta va a «Sin cuenta»");
  assert.equal(celda("stripe", "borrado")?.monto, 1, "un servicio que ya no existe se ve, no se pierde");
  assert.equal(r.cuentas.find((c) => c.id === "stripe")?.porServicio.borrado && r.servicios.find((c) => c.id === "borrado")?.nombre, "Servicio borrado");
  assert.equal(r.cuentas.find((c) => c.id === SIN_CUENTA)?.nombre, "Sin cuenta");
  assert.equal(r.pagos.length, 7, "los de afuera de la semana no están");
});

test("los totales de la tabla cierran exacto con el Cash Collected del mismo rango", () => {
  const e = estado();
  const m = semana();
  const r = ingresosPorCuentaYServicio(e, m);
  /* 100,10 + 200,20 + 0,30 + 50 + 10 + 7,77 + 1 = 369,37, con decimales que en punto flotante no suman redondo. */
  assert.equal(r.total.monto, 369.37);
  assert.equal(Math.round(cashCollected(e, m) * 100), r.total.centavos, "el total de la tabla es el Cash Collected, al centavo");
  assert.equal(r.total.cobros, 7);

  /* Las filas, las columnas y el total son la misma plata. */
  assert.equal(r.cuentas.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos);
  assert.equal(r.servicios.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos);
  for (const c of r.cuentas) assert.equal(Object.values(c.porServicio).reduce((a, x) => a + x.centavos, 0), c.total.centavos, c.nombre);
  for (const s of r.servicios) {
    assert.equal(r.cuentas.reduce((a, c) => a + (c.porServicio[s.id]?.centavos ?? 0), 0), s.total.centavos, s.nombre);
  }
});

test("de la cuenta que más entró a la que menos, y «sin cuenta» y «sin servicio» al final", () => {
  const r = ingresosPorCuentaYServicio(estado(), semana());
  /* Stripe 351,30 · Financiera 10 · Mercury 0,30; «sin cuenta» (7,77) va al final aunque entró más que Mercury. */
  assert.deepEqual(r.cuentas.map((c) => c.id), ["stripe", "fin", "mercury", SIN_CUENTA]);
  /* Mentoría 308,37 · Downsell 50 · el servicio borrado 1; «sin servicio» (10) al final. */
  assert.deepEqual(r.servicios.map((c) => c.id), ["mentoria", "downsell", "borrado", SIN_SERVICIO]);
});

test("cada celda abre los cobros que la forman, y suman lo mismo que la celda", () => {
  const e = estado();
  const r = ingresosPorCuentaYServicio(e, semana());
  for (const c of r.cuentas) {
    for (const [servicioId, celda] of Object.entries(c.porServicio)) {
      const lista = cobrosDeCelda(e, r, c.id, servicioId);
      assert.equal(lista.length, celda.cobros);
      assert.equal(lista.reduce((a, p) => a + Math.round(p.monto * 100), 0), celda.centavos, `${c.nombre} × ${servicioId}`);
    }
    assert.equal(cobrosDeCelda(e, r, c.id).reduce((a, p) => a + Math.round(p.monto * 100), 0), c.total.centavos, `fila ${c.nombre}`);
  }
  assert.equal(cobrosDeCelda(e, r).length, r.total.cobros, "sin decir cuál, todos");
});

test("una semana sin cobros da una tabla vacía en cero", () => {
  const r = ingresosPorCuentaYServicio(estado(), rangoDeFechas("2026-09-01", "2026-09-07", "x"));
  assert.deepEqual([r.cuentas.length, r.servicios.length, r.total.centavos, r.total.cobros], [0, 0, 0, 0]);
});

test("con los datos de ejemplo, cualquier semana cierra con el Cash Collected, al centavo", () => {
  const e = construirSemilla() as EstadoApp;
  const fechas = e.pagos.map((p) => p.fecha.slice(0, 10)).sort();
  const desde = fechas[0], hasta = fechas[fechas.length - 1];
  let n = 0;
  for (let lunes = lunesDe(desde); lunes <= hasta; lunes = moverDias(lunes, 7)) {
    const m = rangoDeFechas(lunes, moverDias(lunes, 6), lunes);
    const r = ingresosPorCuentaYServicio(e, m);
    assert.equal(r.total.centavos, Math.round(cashCollected(e, m) * 100), `semana del ${lunes}`);
    assert.equal(r.cuentas.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos, `filas de la semana del ${lunes}`);
    assert.equal(r.servicios.reduce((a, c) => a + c.total.centavos, 0), r.total.centavos, `columnas de la semana del ${lunes}`);
    n += r.total.cobros;
  }
  assert.ok(n > 0, "alguna semana tuvo cobros");
  /* Y todo el período junto. */
  const todo = rangoDeFechas(desde, hasta, "todo");
  assert.equal(ingresosPorCuentaYServicio(e, todo).total.centavos, Math.round(cashCollected(e, todo) * 100));
  /* Un rango elegido a mano, de 10 días, también. */
  const diez = rangoDeFechas(moverDias(hasta, -9), hasta, "10 días");
  assert.equal(ingresosPorCuentaYServicio(e, diez).total.centavos, Math.round(cashCollected(e, diez) * 100));
});

test("la semana va de lunes a domingo", () => {
  assert.deepEqual(semanaDe("2026-10-07"), { desde: "2026-10-05", hasta: "2026-10-11" }, "un miércoles");
  assert.equal(lunesDe("2026-10-05"), "2026-10-05", "un lunes es su lunes");
  assert.equal(lunesDe("2026-10-11"), "2026-10-05", "un domingo es de la semana que termina");
  assert.equal(lunesDe("2026-01-01"), "2025-12-29", "cruza de año");
  assert.equal(moverDias("2026-03-01", -1), "2026-02-28");
  assert.equal(moverDias("2026-10-05", 7), "2026-10-12");
  assert.equal(moverDias("2026-10-25", 1), "2026-10-26", "los cambios de hora no corren el día");
  assert.equal(diasDelRango("2026-10-05", "2026-10-11"), 7);
  assert.equal(diasDelRango("2026-10-05", "2026-10-05"), 1);
});

test("la semana anterior, para compararla, es la de los 7 días de antes", () => {
  assert.deepEqual(periodoAnterior("2026-10-05", "2026-10-11"), { desde: "2026-09-28", hasta: "2026-10-04" });
});

test("cómo se escribe el rango", () => {
  assert.equal(etiquetaDeRango("2026-09-28", "2026-10-04", "2026-10-07"), "28 sep al 4 oct");
  assert.equal(etiquetaDeRango("2025-12-29", "2026-01-04", "2026-01-07"), "29 dic 2025 al 4 ene 2026", "con el año si cruza de año");
  assert.equal(etiquetaDeRango("2026-10-05", "2026-10-11", "2026-10-07"), "5 al 11 oct", "del mismo mes");
  assert.equal(etiquetaDeRango("2025-10-06", "2025-10-12", "2026-10-07"), "6 al 12 oct 2025", "con el año si no es el actual");
  assert.equal(etiquetaDeRango("2026-10-07", "2026-10-07", "2026-10-07"), "7 oct");
});
