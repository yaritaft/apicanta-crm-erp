import test from "node:test";
import assert from "node:assert/strict";
import { conPanel, miPanelDe, vistaDePanel } from "@/lib/mi-panel";
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
  assert.equal(m.cobradoMes, 3500);
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
  assert.equal(dante.cobradoMes, 2000);
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
  assert.equal(m.porCobrarVencido, 700);
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
