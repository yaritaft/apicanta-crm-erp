import test from "node:test";
import assert from "node:assert/strict";
import { conPanel, mesaDe, miPanelDe, rendimientoDe, vistaDePanel } from "@/lib/mi-panel";
import type { FilaTabla } from "@/lib/crm-tabla";
import { comisionesPorCloser } from "@/lib/finanzas";
import { rangoDePeriodo } from "@/lib/periodos";
import { esIncobrable, motivoIncobrable, notasDeIncobrable, notasSinIncobrable } from "@/lib/cuota-incobrable";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* «Mi panel» (reunión del 15/10): lo de cada closer, director y setter en una pantalla, y
   las cuotas que no se van a cobrar. */

const mes = rangoDePeriodo(PERIODO);
/* El estado de las pruebas de liquidación trae lo de plata; la tabla de llamadas pide además estas listas. */
const estado = () => {
  const e = estadoDePrueba();
  return { ...e, contactos: e.contactos ?? [], webinars: e.webinars ?? [], leads: e.leads ?? [], productos: e.productos ?? [], ajustes: e.ajustes ?? {} } as typeof e;
};
const quien = (e: ReturnType<typeof estadoDePrueba>, id: string) => e.equipo.find((x) => x.id === id)!;
const r2 = (n: number) => Math.round(n * 100) / 100;

test("la comisión del closer en su panel es la misma que suma Finanzas para él", () => {
  const e = estado();
  for (const id of ["mariano", "dante"]) {
    const panel = miPanelDe(e, quien(e, id), mes);
    const deFinanzas = comisionesPorCloser(e, mes).find((g) => g.closerId === id)?.total ?? 0;
    assert.equal(panel.vista, "closer");
    assert.equal(panel.comisionCloser, r2(deFinanzas), id);
  }
  /* Mariano: v1 (2.910 netos al 15%) y v2 (485 netos al 15%). */
  const m = miPanelDe(e, quien(e, "mariano"), mes);
  assert.equal(m.comisionCloser, r2((1455 + 1455 + 485) * 0.15));
  assert.equal(m.cobradoRango, 3500);
  assert.ok(m.comisiones.every((c) => c.closerId === "mariano"));
});

test("el director ve su comisión y el setter la suya, sobre las ventas donde figuran", () => {
  const e = estado();
  const santi = miPanelDe(e, quien(e, "santi"), mes);
  assert.equal(santi.vista, "director");
  assert.equal(santi.comisionDirector, r2(2910 * 0.05));
  const dani = miPanelDe(e, quien(e, "dani"), mes);
  assert.equal(dani.vista, "setter");
  assert.equal(dani.comisionSetter, r2(2910 * 0.05));
  assert.equal(dani.ventasDeSetter, 1);
});

test("a cada uno le calcula lo suyo: lo de otro closer no entra en su panel", () => {
  const e = estado();
  const dante = miPanelDe(e, quien(e, "dante"), mes);
  assert.equal(dante.cobradoRango, 2000);
  assert.ok(dante.comisiones.every((c) => c.ventaId === "v4"));
  assert.ok(dante.cobros.every((c) => c.venta?.closerId === "dante"));
});

test("quién tiene panel: closers, setters y directores activos; Yari y el resto, no", () => {
  const e = estado();
  const con = e.equipo.filter(conPanel).map((x) => x.id).sort();
  assert.deepEqual(con, ["dani", "dante", "mariano", "santi"]);
  assert.equal(conPanel({ rol: "closer", activo: false }), false, "Noelia y los que se fueron no aparecen");
  assert.equal(vistaDePanel({ rol: "ceo" }), "otro");
});

test("las cuotas por cobrar de su panel son las que le quedan a ese closer", () => {
  const e = estado();
  e.cuotas = [...e.cuotas, { id: "c1c", ventaId: "v1", numero: 3, monto: 700, vence: "2020-01-10T12:00:00.000Z", estado: "pendiente", esReserva: false }];
  const m = miPanelDe(e, quien(e, "mariano"), mes);
  assert.equal(m.porCobrar.length, 1);
  assert.equal(m.porCobrarTotal, 700);
  assert.equal(m.mesa.atrasado, 700);
  assert.equal(m.mesa.enRiesgo, 700, "vencida en 2020: pasa los 90 días");
  assert.equal(miPanelDe(e, quien(e, "dante"), mes).porCobrar.length, 0);
});

test("una cuota incobrable es una cancelada con su motivo; volver a cobrarla devuelve las notas de antes", () => {
  const cuota = { estado: "pendiente" as const, notas: "Fecha cambiada del 2026-09-10 al 2026-10-10" };
  const notas = notasDeIncobrable(cuota, " se dio de baja ");
  const marcada = { estado: "cancelada" as const, notas };
  assert.ok(esIncobrable(marcada));
  assert.equal(motivoIncobrable(marcada), "se dio de baja");
  assert.equal(notasSinIncobrable(marcada), cuota.notas);
  /* Una cancelada por la baja de la venta no es incobrable. */
  assert.equal(esIncobrable({ estado: "cancelada", notas: undefined }), false);
  assert.equal(esIncobrable({ estado: "pendiente", notas: notas }), false);
  assert.equal(notasSinIncobrable({ notas: "Incobrable: sin plata" }), undefined);
});

test("la mesa de cobro separa lo del mes, lo vencido, lo de más de 90 días, lo futuro y lo incobrable", () => {
  const e = estado();
  const cuota = (id: string, numero: number, monto: number, vence: string | undefined, extra: Record<string, unknown> = {}) =>
    ({ id, ventaId: "v1", numero, monto, vence, estado: "pendiente" as const, esReserva: false, ...extra });
  e.cuotas = [
    ...e.cuotas.filter((c) => c.ventaId !== "v1"),
    cuota("m1", 1, 500, "2026-10-20T12:00:00.000Z"),                      // vence este mes
    cuota("m2", 2, 300, "2026-10-03T12:00:00.000Z"),                      // este mes, y ya paga 100
    cuota("a1", 3, 400, "2026-09-10T12:00:00.000Z"),                      // vencida, no llega a 90 días
    cuota("a2", 4, 250, "2026-06-01T12:00:00.000Z"),                      // vencida hace más de 90 días
    cuota("f1", 5, 600, "2026-12-15T12:00:00.000Z"),                      // futura
    cuota("s1", 6, 150, undefined),                                       // sin fecha
    cuota("i1", 7, 200, "2026-08-01T12:00:00.000Z", { estado: "cancelada", notas: "Incobrable: se dio de baja" }),
    cuota("x1", 8, 999, "2026-10-25T12:00:00.000Z", { estado: "cancelada" }), // cancelada de verdad: no cuenta
  ];
  e.pagos = [...e.pagos, { id: "pp", cuotaId: "m2", monto: 100, feeMonto: 0, fecha: "2026-10-05T12:00:00.000Z", procesadorId: "proc_stripe", moneda: "USD", feeRate: 0, creadoEn: "2026-10-05T12:00:00.000Z" } as never];
  const m = mesaDe(e, "mariano", "2026-10-15");
  assert.equal(m.mesProyectado, 800);
  assert.equal(m.mesCobrado, 100);
  assert.equal(m.mesPendiente, 700);
  assert.equal(m.mesPct, 12.5);
  assert.equal(m.atrasado, 650);
  assert.equal(m.enRiesgo, 250);
  assert.equal(m.futuro, 600);
  assert.equal(m.sinFecha, 150);
  assert.equal(m.incobrable, 200);
  assert.equal(mesaDe(e, "dante", "2026-10-15").mesProyectado, 0, "lo de otro closer no entra");
});

test("el rendimiento no cuenta las canceladas ni las reprogramadas, y una tasa sin base no es 0%", () => {
  const fila = (resultado: string, extra: Partial<FilaTabla> = {}) => ({ resultado, pasada: true, oferta: "", ...extra }) as FilaTabla;
  const filas = [
    fila("Con cierre", { oferta: "Sí" }), fila("Sin cierre", { oferta: "Sí" }), fila("Sin cierre", { oferta: "No" }),
    fila("No se presentó"), fila("Cancelada"), fila("Reprogramó"), fila("Por venir", { pasada: false }),
  ];
  const r = rendimientoDe(filas, [{ precioAcordado: 3000 }, { precioAcordado: 1000 }] as never, 2500);
  assert.equal(r.agendas, 5);
  assert.equal(r.pasaron, 4);
  assert.equal(r.showUps, 3);
  assert.equal(r.noShows, 1);
  assert.equal(r.ofertas, 2);
  assert.equal(r.pctCierre, 66.7);
  assert.equal(r.pctShowUp, 75);
  assert.equal(r.pctOferta, 66.7);
  assert.equal(r.ticket, 2000);
  assert.equal(r.cobrado, 2500);
  const vacio = rendimientoDe([], [], 0);
  assert.equal(vacio.pctCierre, null);
  assert.equal(vacio.pctShowUp, null);
  assert.equal(vacio.ticket, null);
});
