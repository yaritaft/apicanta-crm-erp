import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, historialParaFinanzas, mismoHistorial, tasaParaFinanzas } from "@/lib/honorarios";
import { comisionesDelMes, totalComisiones } from "@/lib/finanzas";
import { tasaDeComision, tasaDeSetterEnVenta } from "@/lib/comision";
import { rangoDePeriodo } from "@/lib/periodos";
import { reglasAcordadas, sinConfirmarSiCambio } from "@/lib/reglas";
import { conComisionGeneral, esquemaDelCuadro } from "@/lib/comisiones";
import { reversasDeComision } from "@/lib/devoluciones";
import {
  cambiosDeReglas, conVersiones, diaAnterior, mismoCalculo, reglasConHistoria, sinVersion, versionAnterior, type DesdeCuando,
} from "@/lib/versiones-regla";
import type { ConceptoPago, EstadoApp, MiembroEquipo } from "@/lib/types";
import { concepto, devolucion, estadoDeYari, iso, OCTUBRE, SEPTIEMBRE } from "./estado-devolucion";

/* ==================================================================
   Yari (20/11): «si cada vez que yo te digo "las comisiones ahora se
   calculan así", vos borrás lo que tenemos y ponés otra cosa, después,
   cuando analicemos la información hacia el pasado, no va a andar bien.
   Que en cada momento te calcule las cosas como se calculaban en ese
   momento.»

   El caso: Mariano cobra 15%. Desde el 1/10 pasa a cobrar 10%. Belén
   pagó una cuota el 28/09 y otra el 01/10 (1.455 post pasarelas cada una).
   Septiembre tiene que seguir dando 15% y octubre 10%, en Finanzas y en
   la liquidación.
   ================================================================== */

let n = 0;
const ids = () => `con_nuevo_${++n}`;
const desde = (dia: string): DesdeCuando => ({ tipo: "desde", dia });
const SIEMPRE: DesdeCuando = { tipo: "siempre" };

const com15 = concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.15, base: "cash-neto", alcance: "closer" });

/** El estado de Yari con la regla de Mariano cambiada como lo haría la app (guardarEsquema escribe la historia en el equipo). */
function conMarianoAl10(cuando: DesdeCuando): EstadoApp {
  const base = estadoDeYari();
  const esq = base.honorarios.find((h) => h.miembroId === "mariano")!;
  const conceptos = conVersiones(esq.conceptos, [{ ...esq.conceptos[0], tasa: 0.10 }], cuando, ids);
  const nuevo = { ...esq, conceptos };
  const m = base.equipo.find((x) => x.id === "mariano")!;
  const fila: MiembroEquipo = {
    ...m, comisionRate: tasaParaFinanzas(m, nuevo) ?? m.comisionRate, comisionHistorial: historialParaFinanzas(m, nuevo),
  };
  return {
    ...base,
    honorarios: base.honorarios.map((h) => (h.miembroId === "mariano" ? nuevo : h)),
    equipo: base.equipo.map((x) => (x.id === "mariano" ? fila : x)),
  };
}

const comisionDeMariano = (e: EstadoApp, periodo: string) =>
  comisionesDelMes(e, rangoDePeriodo(periodo)).filter((c) => c.closerId === "mariano").reduce((a, c) => a + c.comisionCloser, 0);
const liquidadoA = (e: EstadoApp, periodo: string, id: string) =>
  calcularLiquidacion(e, periodo, undefined).personas.find((p) => p.miembroId === id)?.lineas.filter((l) => l.tipo !== "devolucion") ?? [];
const r2 = (x: number) => Math.round(x * 100) / 100;

/* ---------- Versionar ---------- */

test("cambiar el % desde un día deja la regla de antes con su fin y la nueva con su inicio, como versiones de la misma regla", () => {
  const out = conVersiones([com15], [{ ...com15, tasa: 0.10 }], desde("2026-10-01"), ids);
  assert.equal(out.length, 2);
  const [antes, nueva] = out;
  assert.equal(antes.id, "c_com");
  assert.equal(antes.tasa, 0.15);
  assert.equal(antes.hasta, "2026-09-30");
  assert.equal(antes.desde, undefined);
  assert.equal(nueva.tasa, 0.10);
  assert.equal(nueva.desde, "2026-10-01");
  assert.equal(nueva.hasta, undefined);
  assert.equal(nueva.versionDe, "c_com");
  assert.notEqual(nueva.id, "c_com");
});

test("«Siempre fue así» pisa la regla, como antes (para lo que estaba mal cargado)", () => {
  const out = conVersiones([com15], [{ ...com15, tasa: 0.10 }], SIEMPRE, ids);
  assert.deepEqual(out, [{ ...com15, tasa: 0.10 }]);
});

test("cambiar sólo el nombre o lo acordado no crea otra versión aunque se elija un día", () => {
  const out = conVersiones([com15], [{ ...com15, nombre: "Comisión", notas: "Lo dijo Yari" }], desde("2026-10-01"), ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].nombre, "Comisión");
  assert.equal(out[0].hasta, undefined);
});

test("mismoCalculo no mira el nombre, lo acordado, la confirmación, los false ni el orden de las listas", () => {
  const a = concepto({ id: "x", tipo: "porcentaje", nombre: "A", tasa: 0.1, base: "cash-neto", alcance: "closer", productoIds: ["p1", "p2"] });
  const b: ConceptoPago = { ...a, id: "y", nombre: "B", notas: "n", confirmadaPor: "Yari", confirmadaEl: "2026-10-26", productoIds: ["p2", "p1"], sinExcluidasMarketing: false };
  assert.ok(mismoCalculo(a, b));
  assert.ok(!mismoCalculo(a, { ...b, tasa: 0.12 }));
  assert.ok(!mismoCalculo(a, { ...b, productoIds: ["p1"] }));
});

test("sacar una regla desde un día no la borra: deja de valer el día anterior", () => {
  const out = conVersiones([com15], [], desde("2026-12-01"), ids);
  assert.equal(out.length, 1);
  assert.equal(out[0].hasta, "2026-11-30");
});

test("lo que se agrega desde un día empieza ese día", () => {
  const nueva = concepto({ id: "c_up", tipo: "porcentaje", nombre: "Comisión · Upsell", tasa: 0.05, base: "cash-neto", alcance: "closer", productoIds: ["p_up"] });
  const out = conVersiones([com15], [com15, nueva], desde("2026-11-01"), ids);
  assert.equal(out.find((c) => c.id === "c_up")?.desde, "2026-11-01");
  assert.equal(out.find((c) => c.id === "c_com")?.hasta, undefined);
});

test("una regla que todavía no empezaba se reemplaza entera (no queda historia de algo que nunca valió)", () => {
  const futura = { ...com15, id: "c_fut", desde: "2026-12-01" };
  const out = conVersiones([futura], [{ ...futura, tasa: 0.2 }], desde("2026-12-01"), ids);
  assert.deepEqual(out.map((c) => [c.id, c.tasa, c.desde, c.hasta]), [["c_fut", 0.2, "2026-12-01", undefined]]);
});

test("correr para atrás el inicio de la versión nueva acorta la de antes: nunca valen dos el mismo día", () => {
  const v = conVersiones([com15], [{ ...com15, tasa: 0.10 }], desde("2026-11-01"), ids);
  const nueva = v[1];
  const corrida = conVersiones(v, v.map((c) => (c.id === nueva.id ? { ...c, tasa: 0.12 } : c)), desde("2026-10-15"), ids);
  const antes = corrida.find((c) => c.id === "c_com")!;
  const ahora = corrida.find((c) => c.id === nueva.id)!;
  assert.equal(antes.hasta, "2026-10-14");
  assert.equal(ahora.desde, "2026-10-15");
  assert.equal(ahora.tasa, 0.12);
  assert.equal(corrida.length, 2);
});

test("«sólo ventas cerradas desde el inicio»: la versión nueva sigue contando desde el inicio de la regla, no desde el día del cambio", () => {
  const santi = concepto({ id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director", desde: "2026-07-01", soloVentasDesdeInicio: true });
  const [, nueva] = conVersiones([santi], [{ ...santi, tasa: 0.06 }], desde("2026-12-01"), ids);
  assert.equal(nueva.desde, "2026-12-01");
  assert.equal(nueva.inicioVentas, "2026-07-01");
});

test("sacar por mal cargada la versión nueva deshace el cambio: la de antes vuelve a valer", () => {
  const v = conVersiones([com15], [{ ...com15, tasa: 0.10 }], desde("2026-10-01"), ids);
  assert.equal(versionAnterior(v, v[1])?.id, "c_com");
  const deshecho = sinVersion(v, v[1]);
  assert.equal(deshecho.length, 1);
  assert.equal(deshecho[0].hasta, undefined);
  assert.equal(deshecho[0].tasa, 0.15);
});

test("la ficha muestra una regla por renglón: la de hoy, con las de antes debajo", () => {
  const v = conVersiones([com15], [{ ...com15, tasa: 0.10 }], desde("2026-10-01"), ids);
  const [r] = reglasConHistoria(v, "2026-11-20");
  assert.equal(r.actual.tasa, 0.10);
  assert.deepEqual(r.anteriores.map((c) => c.tasa), [0.15]);
  assert.equal(reglasConHistoria(v, "2026-09-15")[0].actual.tasa, 0.15);
});

/* ---------- Finanzas: cada cobro con el % de su día ---------- */

test("la historia de % para Finanzas: 15% hasta el 30/09 y 10% desde el 1/10", () => {
  const e = conMarianoAl10(desde("2026-10-01"));
  const m = e.equipo.find((x) => x.id === "mariano")!;
  assert.deepEqual(m.comisionHistorial, [
    { general: 0.15, servicios: {}, hasta: "2026-09-30" },
    { general: 0.10, servicios: {}, desde: "2026-10-01" },
  ]);
  assert.equal(m.comisionRate, 0.10);
  assert.equal(tasaDeComision(m, "p_ment", "2026-09-28"), 0.15);
  assert.equal(tasaDeComision(m, "p_ment", "2026-10-01"), 0.10);
  assert.equal(tasaDeComision(m, "p_ment"), 0.10);
});

test("Finanzas: septiembre sigue con el 15% y octubre va con el 10% (antes septiembre pasaba a 10%)", () => {
  const e = conMarianoAl10(desde("2026-10-01"));
  assert.equal(r2(comisionDeMariano(e, SEPTIEMBRE)), 218.25);
  assert.equal(r2(comisionDeMariano(e, OCTUBRE)), 145.5);
  /* Pisando («siempre»), los dos meses van al 10%: es lo que pasaba con cualquier cambio. */
  const pisado = conMarianoAl10(SIEMPRE);
  assert.equal(r2(comisionDeMariano(pisado, SEPTIEMBRE)), 145.5);
});

test("sin reglas con fecha, Finanzas da exactamente lo mismo que antes (no cambia ningún número al publicar)", () => {
  const e = estadoDeYari();
  const conHistoria: EstadoApp = {
    ...e,
    equipo: e.equipo.map((m) => {
      const esq = e.honorarios.find((h) => h.miembroId === m.id);
      const h = historialParaFinanzas(m, esq);
      return h ? { ...m, comisionHistorial: h } : m;
    }),
  };
  for (const p of [SEPTIEMBRE, OCTUBRE]) {
    assert.deepEqual(totalComisiones(comisionesDelMes(conHistoria, rangoDePeriodo(p))), totalComisiones(comisionesDelMes(e, rangoDePeriodo(p))));
  }
  const santi = conHistoria.equipo.find((m) => m.id === "santi")!;
  assert.deepEqual(santi.comisionHistorial, [{ general: 0.05, servicios: {} }]);
});

test("el reparto del profit (growth, socio) toma el % del mes que se mira", () => {
  const m: MiembroEquipo = {
    id: "g", nombre: "Growth", rol: "growth", comisionRate: 0.05, activo: true, sinComision: false,
    comisionHistorial: [{ general: 0.10, hasta: "2026-09-30" }, { general: 0.05, desde: "2026-10-01" }],
  };
  assert.equal(tasaDeComision(m, undefined, "2026-09-30"), 0.10);
  assert.equal(tasaDeComision(m, undefined, "2026-10-31"), 0.05);
});

test("el setter sin % fijado en la venta comisiona con el que valía el día de la venta", () => {
  const setter: MiembroEquipo = {
    id: "s", nombre: "Setter", rol: "setter", comisionRate: 0.02, activo: true, sinComision: false,
    comisionHistorial: [{ general: 0.05, hasta: "2026-11-17" }, { general: 0.02, desde: "2026-11-18" }],
  };
  assert.equal(tasaDeSetterEnVenta(setter, { fecha: "2026-06-10T15:00:00.000Z" }), 0.05);
  assert.equal(tasaDeSetterEnVenta(setter, { fecha: "2026-11-19T15:00:00.000Z" }), 0.02);
  /* El % fijado en la venta manda siempre. */
  assert.equal(tasaDeSetterEnVenta(setter, { fecha: "2026-06-10T15:00:00.000Z", comisionSetter: 0.03 }), 0.03);
});

/* ---------- La liquidación ---------- */

test("la liquidación de cada mes usa la versión que valía ese mes", () => {
  const e = conMarianoAl10(desde("2026-10-01"));
  const sep = liquidadoA(e, SEPTIEMBRE, "mariano");
  const oct = liquidadoA(e, OCTUBRE, "mariano");
  assert.equal(sep.length, 1);
  assert.equal(r2(sep[0].monto), 218.25);
  assert.equal(oct.length, 1);
  assert.equal(r2(oct[0].monto), 145.5);
  assert.match(oct[0].desglose?.regla ?? "", /10%.*desde el 1 oct 2026/);
});

test("un cambio a mitad de mes reparte el mes: cada cobro con la versión de su día", () => {
  const e = conMarianoAl10(desde("2026-09-29"));
  /* El cobro del 28/09 queda al 15%; el del 01/10, al 10%. */
  assert.equal(r2(comisionDeMariano(e, SEPTIEMBRE)), 218.25);
  const sep = liquidadoA(e, SEPTIEMBRE, "mariano");
  assert.equal(r2(sep.reduce((a, l) => a + l.monto, 0)), 218.25);
});

/* ---------- Devoluciones ---------- */

test("una devolución revierte lo que de verdad se comisionó: cada cobro con su %", () => {
  const e = { ...conMarianoAl10(desde("2026-10-01")), devoluciones: [devolucion({ id: "d1", monto: 3000, fecha: iso(OCTUBRE, 3) })] };
  const [r] = reversasDeComision(e);
  const mariano = r.partes.find((p) => p.rol === "closer")!;
  /* 218,25 (15% del 28/09) + 145,50 (10% del 01/10). */
  assert.equal(r2(mariano.comision), 363.75);
  assert.equal(r2(mariano.reversa), 363.75);
});

/* ---------- Confirmaciones y la solapa Reglas ---------- */

test("cortar una regla confirmada (porque desde un día vale otra) no le borra la confirmación; la nueva queda sin confirmar", () => {
  const confirmada = { ...com15, confirmadaPor: "Yari", confirmadaEl: "2026-10-26" };
  const v = conVersiones([confirmada], [{ ...confirmada, tasa: 0.10 }], desde("2026-12-01"), ids);
  const guardado = sinConfirmarSiCambio([confirmada], v);
  assert.equal(guardado[0].confirmadaPor, "Yari");
  assert.equal(guardado[1].confirmadaPor, undefined);
  /* Cambiar el % en el lugar sí la borra, como siempre. */
  assert.equal(sinConfirmarSiCambio([confirmada], [{ ...confirmada, tasa: 0.10 }])[0].confirmadaPor, undefined);
});

test("la solapa Reglas cuenta las de hoy; las versiones que ya terminaron son historia, salvo en el mes en que valían", () => {
  const base = conMarianoAl10(desde("2026-10-01"));
  const deMariano = (periodo?: string) => reglasAcordadas(base, periodo).filter((r) => r.miembro.id === "mariano").map((r) => r.concepto.tasa);
  assert.deepEqual(deMariano(), [0.10]);
  assert.deepEqual(deMariano(SEPTIEMBRE), [0.15]);
  const [cambio] = cambiosDeReglas(base);
  assert.equal(cambio.miembro.id, "mariano");
  assert.deepEqual(cambio.versiones.map((c) => c.tasa), [0.15, 0.10]);
});

/* ---------- El cuadro de comisiones ---------- */

test("cambiar un % en el cuadro desde un día también guarda el de antes", () => {
  const e = estadoDeYari();
  const m = e.equipo.find((x) => x.id === "dante")!;
  const esq = e.honorarios.find((h) => h.miembroId === "dante");
  const nuevo = conComisionGeneral(esq, m, 0.12);
  const conceptos = conVersiones(esquemaDelCuadro(esq, m).conceptos, nuevo.conceptos, desde("2026-12-01"), ids);
  assert.deepEqual(conceptos.map((c) => [c.tasa, c.desde, c.hasta]), [[0.10, undefined, "2026-11-30"], [0.12, "2026-12-01", undefined]]);
  const h = historialParaFinanzas(m, { ...esq!, conceptos });
  assert.ok(mismoHistorial(h, [{ general: 0.10, servicios: {}, hasta: "2026-11-30" }, { general: 0.12, servicios: {}, desde: "2026-12-01" }]));
});

test("diaAnterior cruza meses y años", () => {
  assert.equal(diaAnterior("2026-03-01"), "2026-02-28");
  assert.equal(diaAnterior("2027-01-01"), "2026-12-31");
});
