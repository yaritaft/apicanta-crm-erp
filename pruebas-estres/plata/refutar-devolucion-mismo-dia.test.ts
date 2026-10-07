import "./plata-tz";
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { devolvibleDeVenta, mediodiaDeNegocio, problemaDeDevolucion, reversasDeComision } from "@/lib/devoluciones";
import { calcularPyL } from "@/lib/finanzas";
import { rangoDePeriodo } from "@/lib/periodos";
import type { EstadoApp } from "@/lib/types";

/* Reproducción independiente (sin los ayudantes de plata-mundo): objetos planos y la hora de Argentina (plata-tz).
   ARREGLADO (lote dev): «hasta ese día» es hasta el final del día de negocio; las afirmaciones que reproducían el agujero
   están invertidas. */

/** El día `d` del mes `m` (1-12) de 2026 a las `h`:`min` de Argentina, como lo guarda la app (ISO en UTC). */
const art = (m: number, d: number, h = 12, min = 0) => new Date(Date.UTC(2026, m - 1, d, h + 3, min)).toISOString();

/* Exactamente lo que hace el formulario (CargarDevolucion.tsx): el día elegido pasa a las 12:00 de Argentina. */
const mediodiaDelFormulario = (dia: string) => mediodiaDeNegocio(dia);

const RAIZ = join(import.meta.dirname, "..", "..");

const venta = (cierre: string) => ({ id: "v1", contactoNombre: "Belén", precioAcordado: 3000, fecha: cierre, moneda: "USD", closerId: "c1", excluidoMarketing: false, estado: "activa", creadoEn: cierre, extra: {} });
const equipo = [{ id: "c1", nombre: "Closer", rol: "closer", comisionRate: 0.1, activo: true, sinComision: false }];
const pagoDe = (id: string, cuotaId: string, monto: number, fecha: string) => ({ id, cuotaId, monto, feeMonto: 0, fecha, procesadorId: "proc_stripe", moneda: "USD", feeRate: 0, creadoEn: fecha });
const dev = (id: string, monto: number, fecha: string) => ({
  id, ventaId: "v1", monto, moneda: "USD", fecha, procesadorId: "proc_stripe", noDescontarAlCloser: false, estado: "confirmada", creadoEn: fecha, extra: {},
});
const estado = (o: { cuotas: unknown[]; pagos: unknown[]; devoluciones: unknown[]; cierre?: string }) => ({
  equipo, honorarios: [], ventas: [venta(o.cierre ?? art(9, 28))], cuotas: o.cuotas, pagos: o.pagos, devoluciones: o.devoluciones,
  gastos: [], sesiones: [], liquidaciones: [], ajustes: { monedaBase: "USD", tipoCambio: 1500 },
}) as unknown as EstadoApp;
const intento = (e: EstadoApp, monto: number, fecha: string) =>
  problemaDeDevolucion(e, { ventaId: "v1", monto, fecha, procesadorId: "proc_stripe", tieneComprobante: true });

/* Una venta de US$ 1.500 en una cuota, cobrada el 30/09 a la hora `h` de Argentina. */
const cobradaEl30 = (h: number, min = 0) => estado({
  cuotas: [{ id: "q1", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false }],
  pagos: [pagoDe("p1", "q1", 1500, art(9, 30, h, min))],
  devoluciones: [],
  cierre: art(9, 30, 10),
});

test("0 · el ancla: el formulario guarda las 12:00 de Argentina y las dos cuentas comparan por día de negocio", () => {
  const form = readFileSync(join(RAIZ, "src/components/devoluciones/CargarDevolucion.tsx"), "utf8");
  assert.ok(form.includes("const mediodia = mediodiaDeNegocio;"), "el formulario cambió");
  assert.ok(form.includes("const fechaIso = mediodia(dia);"), "el formulario ya no valida con el mediodía");
  assert.ok(form.includes("devolvibleDeVenta(e, venta.id, fechaIso, previa?.id)") && form.includes("problemaDeDevolucion("), "el formulario cambió");
  const lib = readFileSync(join(RAIZ, "src/lib/devoluciones.ts"), "utf8");
  assert.ok(!lib.includes("Date.parse(p.fecha) <= t"), "alguna cuenta vuelve a comparar instantes");
  assert.ok(lib.includes("diasDePago") && lib.includes("delDia("), "ya no compara por día");
  assert.equal(mediodiaDelFormulario("2026-09-30"), "2026-09-30T15:00:00.000Z", "mediodía de Argentina = 15:00Z");
});

test("1 · cobro de 1.500 el 30/09 a las 16:00 y devolución de 1.500 el 30/09: el formulario la acepta", () => {
  const e = cobradaEl30(16);
  const fecha = mediodiaDelFormulario("2026-09-30");
  assert.equal(intento(e, 1500, fecha), null);
  assert.deepEqual(devolvibleDeVenta(e, "v1", fecha), { cobrado: 1500, devuelto: 0, queda: 1500 }, "y la ayuda del campo dice «Se cobró US$ 1.500»");
});

test("2 · el corte es el día, no el mediodía: cobros del mismo 30/09 a distintas horas", () => {
  const fecha = mediodiaDelFormulario("2026-09-30");
  const res = Object.fromEntries([[9, 0], [11, 59], [12, 0], [12, 1], [16, 0], [23, 59]].map(([h, m]) => [`${h}:${String(m).padStart(2, "0")}`, intento(cobradaEl30(h, m), 1500, fecha) === null ? "se puede" : "RECHAZADA"]));
  assert.deepEqual(res, { "9:00": "se puede", "11:59": "se puede", "12:00": "se puede", "12:01": "se puede", "16:00": "se puede", "23:59": "se puede" });
  /* Y un cobro del día siguiente, por temprano que sea, no. */
  assert.notEqual(intento(estado({ cuotas: cobradaEl30(0).cuotas, pagos: [pagoDe("p1", "q1", 1500, art(10, 1, 0, 1))], devoluciones: [] }), 1500, fecha), null);
});

test("3 · la causa es sólo comparar instantes: con el fin del día de Argentina la misma entrada pasa", () => {
  const e = cobradaEl30(16);
  const finDelDia = art(9, 30, 23, 59);
  assert.equal(intento(e, 1500, finDelDia), null);
  assert.deepEqual(devolvibleDeVenta(e, "v1", finDelDia), { cobrado: 1500, devuelto: 0, queda: 1500 });
});

test("4 · la ficha de la venta (usa «ahora») y el formulario (usa mediodía) dicen lo mismo: hay 1.500 por devolver", () => {
  const e = cobradaEl30(16);
  const ahora = art(9, 30, 17);
  assert.equal(devolvibleDeVenta(e, "v1", ahora).queda, 1500, "DevolucionesDeVenta.tsx: devolvibleDeVenta(e, venta.id, new Date().toISOString()).queda");
  assert.equal(devolvibleDeVenta(e, "v1", mediodiaDelFormulario("2026-09-30")).queda, 1500, "CargarDevolucion.tsx: la misma cuenta con la fecha del formulario");
  /* Los dos llamados están así en el código. */
  const ficha = readFileSync(join(RAIZ, "src/components/devoluciones/DevolucionesDeVenta.tsx"), "utf8");
  assert.ok(ficha.includes("devolvibleDeVenta(e, venta.id, new Date().toISOString()).queda"));
});

test("5 · ya no hace falta fecharla al día siguiente: la devolución del 30/09 resta en septiembre", () => {
  const sin = cobradaEl30(16);
  const al30 = estado({ ...{ cuotas: sin.cuotas, pagos: sin.pagos }, devoluciones: [dev("d1", 1500, mediodiaDelFormulario("2026-09-30"))], cierre: art(9, 30, 10) });
  assert.equal(intento(sin, 1500, mediodiaDelFormulario("2026-09-30")), null, "fecharla el 30/09 se acepta");
  const sept = calcularPyL(al30, rangoDePeriodo("2026-09")), oct = calcularPyL(al30, rangoDePeriodo("2026-10"));
  assert.equal(sept.cobrado, 1500);
  assert.equal(sept.devoluciones, 1500, "septiembre ve la devolución que pasó el 30/09");
  assert.equal(sept.cashCollected, 0);
  assert.equal(oct.devoluciones, 0);
  assert.equal(oct.cashCollected, 0);
});

/* ---------- La variante de la comisión ---------- */

const dosCobros = {
  cuotas: [
    { id: "qa", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false },
    { id: "qb", ventaId: "v1", numero: 2, monto: 1500, estado: "pagada", esReserva: false },
  ],
  pagos: [pagoDe("pa", "qa", 1500, art(9, 28, 10)), pagoDe("pb", "qb", 1500, art(10, 3, 16))],
};

test("6 · variante de comisión: con una devolución de 3.000 al 03/10 12:00, reversasDeComision revierte 300 de 300", () => {
  const e = estado({ ...dosCobros, devoluciones: [dev("d1", 3000, mediodiaDelFormulario("2026-10-03"))] });
  const [rv] = reversasDeComision(e);
  assert.equal(rv.cobradoVenta, 3000, "el cobro de las 16:00 entra");
  assert.equal(rv.devuelto, 3000, "se devuelve todo lo cobrado ese día");
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.reversa, 300);
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.comision, 300, "y la «comisión» que mira es la de los dos cobros (10% de 3.000)");
});

test("7 · esa devolución se puede cargar: el formulario deja los 3.000 del 03/10, y nada más", () => {
  const sinDev = estado({ ...dosCobros, devoluciones: [] });
  assert.equal(intento(sinDev, 3000, mediodiaDelFormulario("2026-10-03")), null);
  assert.match(intento(sinDev, 3001, mediodiaDelFormulario("2026-10-03"))!, /No se puede devolver más de lo cobrado: quedan US\$ 3\.000/);
  assert.equal(intento(sinDev, 1500, mediodiaDelFormulario("2026-10-03")), null, "ni 1.500 ese día");
  assert.equal(intento(sinDev, 3000, mediodiaDelFormulario("2026-10-04")), null, "ni los 3.000 fechados el 04/10");
  /* Con los 3.000 el 04/10 la comisión se revierte entera (300): la cuenta es consistente con la validación. */
  const e = estado({ ...dosCobros, devoluciones: [dev("d1", 3000, mediodiaDelFormulario("2026-10-04"))] });
  const [rv] = reversasDeComision(e);
  assert.equal(rv.partes.find((p) => p.miembroId === "c1")!.reversa, 300);
});

test("8 · no hay otro camino: lo único que crea una devolución «confirmada» es registrarDevolucion, que sólo llama el formulario", () => {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/\.(ts|tsx)$/.test(n)) archivos.push(p);
    }
  };
  recorrer(join(RAIZ, "src"));
  const crea = archivos.filter((f) => /estado:\s*"confirmada"/.test(readFileSync(f, "utf8"))).map((f) => f.slice(RAIZ.length + 1));
  assert.deepEqual(crea.sort(), ["src/components/devoluciones/CargarDevolucion.tsx", "src/lib/store.ts"], "alguien más crea devoluciones confirmadas");
  const llaman = archivos.filter((f) => /registrarDevolucion\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(RAIZ.length + 1));
  assert.deepEqual(llaman.sort(), ["src/components/devoluciones/CargarDevolucion.tsx", "src/lib/store.ts"]);
  /* Las pasarelas (servidor y CSV) sólo proponen. */
  const rem = readFileSync(join(RAIZ, "src/lib/reembolsos.ts"), "utf8");
  assert.ok(/estado:\s*"propuesta"/.test(rem) && !/estado:\s*"confirmada"/.test(rem));
});

test("9 · un disparador real que no depende de que el cliente pida la plata el mismo día: la propuesta de Hotmart/CSV trae la fecha del COBRO y el formulario la abre con ese día, y la acepta", async () => {
  const { propuestaDe } = await import("@/lib/reembolsos");
  const { diaDeNegocio } = await import("@/lib/dia-negocio");
  const e = cobradaEl30(16);
  /* Hotmart no dice cuándo se devolvió: la fecha es la de la compra (pasarelas-api.ts · reembolsoDeHotmart, fechaDelCobro: true). */
  const p = propuestaDe({
    proveedor: "hotmart", referencia: "reembolso:HP1", referenciasCobro: ["HP1"], monto: 1500, moneda: "USD",
    fecha: art(9, 30, 16), fechaDelCobro: true, procesadorId: "proc_stripe",
  }, "v1", art(10, 7));
  /* CargarDevolucion: dia = día de negocio de base.fecha, fechaIso = mediodia(dia). */
  const dia = diaDeNegocio(p.fecha);
  assert.equal(dia, "2026-09-30");
  assert.equal(
    problemaDeDevolucion(e, { ventaId: "v1", monto: p.monto, fecha: mediodiaDelFormulario(dia), procesadorId: "proc_stripe", tieneComprobante: false, tienePasarela: true }),
    null,
    "se abre con el día de la compra y el formulario la deja confirmar",
  );
  /* Si el cobro fue antes del mediodía, se abre bien. */
  const temprano = cobradaEl30(10);
  assert.equal(problemaDeDevolucion(temprano, { ventaId: "v1", monto: 1500, fecha: mediodiaDelFormulario(dia), procesadorId: "proc_stripe", tieneComprobante: false, tienePasarela: true }), null);
});
