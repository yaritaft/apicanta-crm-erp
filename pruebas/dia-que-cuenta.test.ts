import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { corridoPorRetencion, diaQueCuenta, retenciones } from "@/lib/acreditacion";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { resumenDeCash } from "@/lib/ventas-y-cash";
import { fecha, fechaLarga, isoDia } from "@/lib/format";
import type { EstadoApp, Pago } from "@/lib/types";

/* 16/11: Aldana vio en Ventas y cash, con el período 1/11 al 16/11, 45 cobros y US$ 40.318, y en la lista de cobros del mes 42 y US$ 37.118. Eran
   tres cobros de Hotmart pagados el 27/10 que se acreditaron el 11 y el 12/11 (la cuenta retiene 15 días): el CC los cuenta en noviembre, y el día por
   día los mostraba en octubre porque agrupaba por el día del pago. Además la tabla escribía cada día un día antes («31 oct» era el 1/11).
   Estos tests fijan la regla: una sola fecha define a qué período pertenece un cobro. */

const pago = (id: string, fecha: string, monto: number, procesadorId: string): Pago => ({ id, fecha, monto, procesadorId, cuotaId: "x", feeMonto: 0 } as unknown as Pago);

function estado(): EstadoApp {
  const e = construirSemilla() as EstadoApp;
  return {
    ...e, ventas: [], cuotas: [], devoluciones: [],
    procesadores: [{ id: "proc_hotmart", nombre: "Hotmart", diasDeRetencion: 15, retencionDesde: "2026-10-26" }, { id: "proc_stripe", nombre: "Stripe" }] as unknown as EstadoApp["procesadores"],
    pagos: [
      pago("h1", "2026-10-27T04:44:48.000Z", 2300, "proc_hotmart"),
      pago("h2", "2026-10-27T19:22:05.000Z", 1000, "proc_hotmart"),
      pago("h3", "2026-10-28T01:45:43.000Z", 400, "proc_hotmart"),
      pago("s1", "2026-11-01T18:19:26.000Z", 1200, "proc_stripe"),
      pago("s2", "2026-11-05T15:00:00.000Z", 500, "proc_stripe"),
      pago("h4", "2026-11-05T15:00:00.000Z", 700, "proc_hotmart"), // se acredita el 20/11: afuera del período
    ],
  };
}

test("el día por día de Ventas y cash suma el CC y no tiene ningún día fuera del período", () => {
  const e = estado();
  const r = resumenDeCash(e, "2026-11-01", "2026-11-16");
  assert.equal(r.cobros, 5);
  assert.equal(r.cobrado, 3700 + 1200 + 500);
  assert.equal(r.porDia.reduce((a, d) => a + d.cobros, 0), r.cobros, "los cobros de las filas suman el total");
  assert.equal(r.porDia.reduce((a, d) => a + d.cobrado, 0), r.cobrado, "y la plata también");
  for (const d of r.porDia) assert.ok(d.dia >= "2026-11-01" && d.dia <= "2026-11-16", `${d.dia} está dentro del período`);
  const dia11 = r.porDia.find((d) => d.dia === "2026-11-11");
  assert.equal(dia11?.cobrado, 2300 + 1000 + 400, "lo pagado el 27/10 (hora argentina) figura el día que se acredita");
  assert.deepEqual(dia11?.pagadosEl, ["2026-10-27"], "y dice cuándo se pagó");
});

test("lo que la retención corre se explica: lista por fecha de pago − lo que se acredita después + lo pagado antes = CC", () => {
  const e = estado();
  const desde = "2026-11-01", hasta = "2026-11-16";
  const c = corridoPorRetencion(e, desde, hasta);
  assert.deepEqual(c.deAntes, { cobros: 3, monto: 3700 });
  assert.deepEqual(c.despues, { cobros: 1, monto: 700 });
  const lista = e.pagos.filter((p) => { const d = diaDeNegocio(p.fecha); return d >= desde && d <= hasta; });
  const sumaLista = lista.reduce((a, p) => a + p.monto, 0);
  const r = resumenDeCash(e, desde, hasta);
  assert.equal(sumaLista - c.despues.monto + c.deAntes.monto, r.entrado);
  assert.equal(r.acreditadoDeAntes.cobros, 3);
  assert.equal(r.acreditaDespues.cobros, 1);
});

test("sin cuentas que retengan, el criterio es el día del pago y nada se corre", () => {
  const e = { ...estado(), procesadores: [] } as unknown as EstadoApp;
  const ret = retenciones(e.procesadores);
  for (const p of e.pagos) assert.equal(diaQueCuenta(p, ret), diaDeNegocio(p.fecha));
  const c = corridoPorRetencion(e, "2026-11-01", "2026-11-16");
  assert.deepEqual(c, { deAntes: { cobros: 0, monto: 0 }, despues: { cobros: 0, monto: 0 } });
});

test("un día suelto («2026-11-01») se escribe como ese día, no el anterior", () => {
  assert.equal(fechaLarga("2026-11-01"), "1 nov 2026");
  assert.equal(fechaLarga("2026-10-27"), "27 oct 2026");
  assert.equal(fecha("2026-11-01"), "01/11");
  assert.equal(isoDia("2026-11-01"), "2026-11-01");
  /* un instante sigue leyéndose en hora argentina: la medianoche UTC del 1/11 es el 31/10 a las 21 */
  assert.equal(fechaLarga("2026-11-01T00:22:02.000Z"), "31 oct 2026");
});

test("en cualquier período (con pagos a cualquier hora, de cuentas que retienen o no) el día por día cierra con el total y no se sale de las fechas", () => {
  let semilla = 7;
  const azar = () => { semilla = (semilla * 48271) % 2147483647; return semilla / 2147483647; };
  const base = estado();
  const pagos: Pago[] = Array.from({ length: 300 }, (_, i) => {
    const t = Date.parse("2026-10-10T00:00:00.000Z") + Math.floor(azar() * 45 * 86_400_000);
    return pago(`p${i}`, new Date(t).toISOString(), 100 + Math.floor(azar() * 900), azar() < 0.4 ? "proc_hotmart" : "proc_stripe");
  });
  const e = { ...base, pagos } as EstadoApp;
  for (let i = 0; i < 60; i++) {
    const a = new Date(Date.parse("2026-10-15T12:00:00.000Z") + Math.floor(azar() * 30 * 86_400_000));
    const b = new Date(a.getTime() + Math.floor(azar() * 20 * 86_400_000));
    const desde = a.toISOString().slice(0, 10), hasta = b.toISOString().slice(0, 10);
    const r = resumenDeCash(e, desde, hasta);
    assert.equal(r.porDia.reduce((s, d) => s + d.cobros, 0), r.cobros, `${desde}→${hasta}: cobros`);
    assert.ok(Math.abs(r.porDia.reduce((s, d) => s + d.cobrado, 0) - r.cobrado) < 0.01, `${desde}→${hasta}: plata`);
    for (const d of r.porDia) assert.ok(d.dia >= desde && d.dia <= hasta, `${desde}→${hasta}: ${d.dia} fuera`);
    const c = corridoPorRetencion(e, desde, hasta);
    const lista = e.pagos.filter((p) => { const d = diaDeNegocio(p.fecha); return d >= desde && d <= hasta; }).reduce((s, p) => s + p.monto, 0);
    assert.ok(Math.abs(lista - c.despues.monto + c.deAntes.monto - r.entrado) < 0.01, `${desde}→${hasta}: la lista y el CC se explican`);
  }
});
