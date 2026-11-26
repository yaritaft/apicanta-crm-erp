import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, describirConcepto, historialParaFinanzas, mismoHistorial, tasaParaFinanzas, tasasPorServicio } from "@/lib/honorarios";
import { comisionesDelMes } from "@/lib/finanzas";
import { escalaDeComision, tasaDeComision } from "@/lib/comision";
import { rangoDePeriodo } from "@/lib/periodos";
import { reversasDeComision } from "@/lib/devoluciones";
import { conVersiones, mismoCalculo } from "@/lib/versiones-regla";
import {
  cierreDeResells, ESCALA_DE_RESELL, escalaDelMesDe, escalaNormal, escalonAlcanzado, proximoEscalon, rangoDeEscala, resolverDeCierre, tasaDeEscala, textoDeEscala,
} from "@/lib/escala-cierre";
import type { ConceptoPago, EstadoApp, MiembroEquipo, Resell, Venta } from "@/lib/types";
import { concepto, devolucion, estadoDeYari, iso, NOVIEMBRE, OCTUBRE, pago } from "./estado-devolucion";

/* ==================================================================
   Yari (25/11): «Tema resell. Menos de 25% de cierre cobrás el 5%. Entre
   25% y 30% de cierre cobrás el 10%. Más del 30% de cierre cobrás el 12%.»

   El caso: Dante cobra 10% de lo que cierra y 5% del resell. Desde el 1/11
   el resell pasa a la escala. En noviembre toma llamadas de resell y cobra
   US$ 1.000 (30 de pasarela) de una renovación: lo que le toca depende de
   cuántas de esas llamadas cerró. Tiene que dar lo mismo en la liquidación,
   en Finanzas y en Mi panel, y octubre tiene que seguir en 5%.
   ================================================================== */

const r2 = (x: number) => Math.round(x * 100) / 100;
let n = 0;
const ids = () => `con_esc_${++n}`;

const general = concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión", tasa: 0.10, base: "cash-neto", alcance: "closer" });
const resellFijo = concepto({ id: "com_p_resell", tipo: "porcentaje", nombre: "Comisión · Resell", tasa: 0.05, base: "cash-neto", alcance: "closer", productoIds: ["p_resell"] });

const llamada = (id: string, dia: number, extra: Partial<Resell> = {}, mes = NOVIEMBRE): Resell => ({
  id: `rs_${id}`, sesionId: `ses_${id}`, fechaHora: iso(mes, dia), nombre: `Alumno ${id}`, email: `${id}@x.com`, telefono: "", closer: "Dante Barbieri",
  estado: "", cashCollect: null, casoDeExito: false, notas: "", cancelada: false, origen: "calendly", contactoId: `per_${id}`,
  creadoEn: iso(mes, dia), actualizadoEn: iso(mes, dia), ...extra,
} as Resell);

const venta = (id: string, dia: number, extra: Partial<Venta> = {}, mes = NOVIEMBRE): Venta => ({
  id: `v_${id}`, contactoId: `per_${id}`, contactoNombre: `Alumno ${id}`, precioAcordado: 1000, fecha: iso(mes, dia), moneda: "USD",
  productoId: "p_resell", closerId: "dante", excluidoMarketing: false, estado: "activa", creadoEn: iso(mes, dia), extra: {}, ...extra,
});

/** El estado con Dante en la escala desde el 1/11 (como lo deja la app: versión nueva + historia para Finanzas), sus llamadas y sus ventas.
 *  Cada venta se cobra entera ese día: 1.000 con 30 de pasarela. */
function estado(resells: Resell[], ventas: Venta[], extra: Partial<EstadoApp> = {}): EstadoApp {
  const base = estadoDeYari();
  const conEscala: ConceptoPago = { ...resellFijo, escala: ESCALA_DE_RESELL };
  const conceptos = conVersiones([general, resellFijo], [general, conEscala], { tipo: "desde", dia: "2026-11-01" }, ids);
  const esq = { ...base.honorarios.find((h) => h.miembroId === "dante")!, conceptos };
  const m = base.equipo.find((x) => x.id === "dante")!;
  const fila: MiembroEquipo = {
    ...m, comisionRate: tasaParaFinanzas(m, esq) ?? m.comisionRate, comisionServicios: tasasPorServicio(m, esq), comisionHistorial: historialParaFinanzas(m, esq),
  };
  return {
    ...base,
    productos: [...base.productos, { id: "p_resell", nombre: "Resell Mentoría" }, { id: "p_upgrade", nombre: "Upgrade AI" }],
    honorarios: base.honorarios.map((h) => (h.miembroId === "dante" ? esq : h)),
    equipo: base.equipo.map((x) => (x.id === "dante" ? fila : x)),
    resells,
    ventas: [...base.ventas, ...ventas],
    cuotas: [...base.cuotas, ...ventas.map((v) => ({ id: `cu_${v.id}`, ventaId: v.id, numero: 1, monto: v.precioAcordado, estado: "pagada", esReserva: false }))],
    pagos: [...base.pagos, ...ventas.map((v) => pago(`pg_${v.id}`, `cu_${v.id}`, v.precioAcordado, 30, v.fecha))],
    ...extra,
  } as unknown as EstadoApp;
}

const lineasDe = (e: EstadoApp, periodo: string, id = "dante") =>
  calcularLiquidacion(e, periodo, undefined).personas.find((p) => p.miembroId === id)?.lineas.filter((l) => l.tipo !== "devolucion") ?? [];
const liquidado = (e: EstadoApp, periodo: string) => r2(lineasDe(e, periodo).reduce((a, l) => a + l.monto, 0));
const enFinanzas = (e: EstadoApp, periodo: string) =>
  r2(comisionesDelMes(e, rangoDePeriodo(periodo)).filter((c) => c.closerId === "dante").reduce((a, c) => a + c.comisionCloser, 0));
const NOV = rangoDePeriodo(NOVIEMBRE);
const cierreDeNov = (e: EstadoApp) => cierreDeResells(e, { id: "dante" }, NOV.desde.getTime(), NOV.hasta.getTime(), { productoIds: ["p_resell"] });

/* ---------- La escala ---------- */

test("la escala de Yari: menos de 25% paga la base, de 25% a 30% (incluidos) el 10% y recién al pasar el 30% el 12%", () => {
  const t = (pct: number | null) => tasaDeEscala(ESCALA_DE_RESELL, 0.05, pct);
  assert.equal(t(0), 0.05);
  assert.equal(t(0.2499), 0.05);
  assert.equal(t(0.25), 0.10);
  assert.equal(t(0.2727), 0.10);
  assert.equal(t(0.30), 0.10);
  assert.equal(t(0.3001), 0.12);
  assert.equal(t(1), 0.12);
});

test("3 de 12 es 25% justo y 3 de 10 es 30% justo: la cuenta con decimales no los deja de un lado equivocado", () => {
  assert.equal(tasaDeEscala(ESCALA_DE_RESELL, 0.05, 3 / 12), 0.10);
  assert.equal(tasaDeEscala(ESCALA_DE_RESELL, 0.05, 3 / 10), 0.10);
  assert.equal(tasaDeEscala(ESCALA_DE_RESELL, 0.05, 0.1 + 0.2), 0.10);
  assert.equal(tasaDeEscala(ESCALA_DE_RESELL, 0.05, 4 / 13), 0.12);
});

test("sin llamadas en el mes no hay % de cierre: vale el % de base", () => {
  assert.equal(tasaDeEscala(ESCALA_DE_RESELL, 0.05, null), 0.05);
  assert.equal(escalonAlcanzado(ESCALA_DE_RESELL, null), undefined);
});

test("una escala mal cargada se ordena y pierde los escalones inválidos; sin ninguno válido no hay escala", () => {
  const e = escalaNormal({ de: "resell", escalones: [{ desde: 0.3, estricto: true, tasa: 0.12 }, { desde: NaN, tasa: 0.5 }, { desde: 0.25, tasa: 0.1 }, { desde: -1, tasa: 0.2 }] });
  assert.deepEqual(e, ESCALA_DE_RESELL);
  assert.equal(escalaNormal({ de: "resell", escalones: [] }), undefined);
  assert.equal(escalaNormal(undefined), undefined);
});

test("la escala se dice en palabras, con el rango para donde no entra el detalle", () => {
  assert.equal(textoDeEscala(ESCALA_DE_RESELL, 0.05), "5% con menos de 25% de cierre · 10% desde 25% · 12% con más de 30%");
  assert.equal(rangoDeEscala(ESCALA_DE_RESELL, 0.05), "5% a 12%");
});

/* ---------- El % de cierre ---------- */

test("llamadas: cuentan las que se hicieron en el mes; no las canceladas, las de «No se presentó», las reagendadas, las de otro closer ni las de otro mes", () => {
  const e = estado([
    llamada("a", 3), llamada("b", 5), llamada("c", 9), llamada("d", 10),
    llamada("can", 6, { cancelada: true }),
    llamada("ns", 7, { estado: "No se presentó" }),
    llamada("re", 8, { testimonio: "Se reagenda" }),
    llamada("otro", 8, { closer: "Mariano Arias" }),
    llamada("oct", 20, {}, OCTUBRE),
  ], []);
  const c = cierreDeNov(e);
  assert.equal(c.llamadas, 4);
  assert.equal(c.cierres, 0);
  assert.equal(c.pct, 0);
  assert.deepEqual(c.detalle.llamadas.filter((x) => !x.cuenta).map((x) => [x.id, x.motivo]), [["rs_can", "Se canceló"], ["rs_ns", "No se presentó"], ["rs_re", "Se reagendó"]]);
});

test("una llamada con dos closers («Mariano,Dante») cuenta para los dos, y «Dante» a secas es Dante Barbieri", () => {
  const e = estado([llamada("a", 3, { closer: "Mariano,Dante" }), llamada("b", 4, { closer: "Dante" })], []);
  assert.equal(cierreDeNov(e).llamadas, 2);
  assert.equal(cierreDeResells(e, { id: "mariano" }, NOV.desde.getTime(), NOV.hasta.getTime()).llamadas, 1);
});

test("lo que todavía no pasó no cuenta: ni la llamada de más adelante ni la venta", () => {
  const e = estado([llamada("a", 3), llamada("b", 20)], [venta("b", 20, { sesionId: "ses_b" })]);
  const hasta10 = cierreDeResells(e, { id: "dante" }, NOV.desde.getTime(), NOV.hasta.getTime(), { ahora: Date.parse(iso(NOVIEMBRE, 10)) });
  assert.equal(hasta10.llamadas, 1);
  assert.equal(hasta10.cierres, 0);
});

test("cierres: la venta atada a la llamada, la de quien tuvo una llamada de resell con él en los 60 días previos y la de un servicio de resell", () => {
  const e = estado(
    [llamada("a", 3), llamada("b", 5), llamada("c", 9), llamada("vieja", 20, {}, OCTUBRE)],
    [
      /* Atada a su llamada, aunque sea de otro servicio. */
      venta("a", 3, { sesionId: "ses_a", productoId: "p_upgrade" }),
      /* Sin llamada anotada, pero es alguien que tuvo su llamada de resell con Dante en octubre. */
      venta("vieja", 12, { productoId: "p_upgrade" }),
      /* Un Resell Mentoría suelto: nadie lo ató a nada. */
      venta("suelta", 14, { contactoId: "per_nadie" }),
      /* De otro servicio y de alguien que no pasó por resell: no es un cierre de resell. */
      venta("nueva", 15, { contactoId: "per_lead", productoId: "p_ment" }),
    ],
  );
  const c = cierreDeNov(e);
  assert.equal(c.llamadas, 3);
  assert.equal(c.cierres, 3);
  assert.deepEqual(c.detalle.ventas.map((v) => [v.ventaId, v.por]), [["v_a", "llamada"], ["v_vieja", "persona"], ["v_suelta", "servicio"]]);
});

test("dos ventas a la misma persona son un solo cierre; una venta cancelada o de otro closer no cuenta", () => {
  const e = estado(
    [llamada("a", 3), llamada("b", 5)],
    [
      venta("a", 3, { sesionId: "ses_a" }),
      venta("a2", 4, { contactoId: "per_a", productoId: "p_upgrade" }),
      venta("b", 5, { sesionId: "ses_b", estado: "cancelada" }),
      venta("x", 6, { closerId: "mariano", sesionId: "ses_b" }),
    ],
  );
  const c = cierreDeNov(e);
  assert.equal(c.cierres, 1);
  assert.equal(c.pct, 0.5);
  assert.equal(c.detalle.ventas.find((v) => v.ventaId === "v_a2")?.repetida, true);
});

test("una llamada de resell de hace más de 60 días ya no hace que una venta de otro servicio sea de resell", () => {
  const e = estado([llamada("lejos", 1, {}, "2026-08")], [venta("lejos", 15, { productoId: "p_upgrade" })]);
  assert.equal(cierreDeNov(e).cierres, 0);
});

/* ---------- La liquidación ---------- */

const CUATRO = [llamada("a", 3), llamada("b", 5), llamada("c", 9), llamada("d", 10)];

test("con 1 de 4 (25%) el resell se paga al 10%: 970 post pasarelas → 97, y lo demás sigue con su 10% general", () => {
  const e = estado(CUATRO, [venta("a", 3, { sesionId: "ses_a" })]);
  const lineas = lineasDe(e, NOVIEMBRE);
  const resell = lineas.find((l) => l.nombre === "Comisión · Resell")!;
  assert.equal(resell.monto, 97);
  assert.match(resell.detalle, /^10% de /);
  assert.match(resell.detalle, /cerró 1 de 4 llamadas de resell \(25%\)/);
  /* La general no cuenta el cobro de resell: un cobro entra en una sola comisión. */
  assert.equal(lineas.find((l) => l.nombre === "Comisión")!.monto, 0);
});

test("sin cierres (0 de 4) sigue en 5%; con 2 de 4 (50%) pasa a 12%", () => {
  /* Un Resell Mentoría de alguien sin llamada es un cierre igual: para que quede en 0 de 4, la venta es de quien no comisiona ahí. */
  const sin = estado(CUATRO, []);
  assert.equal(lineasDe(sin, NOVIEMBRE).find((l) => l.nombre === "Comisión · Resell")?.monto ?? 0, 0);
  const dos = estado(CUATRO, [venta("a", 3, { sesionId: "ses_a" }), venta("b", 5, { sesionId: "ses_b" })]);
  const l = lineasDe(dos, NOVIEMBRE).find((x) => x.nombre === "Comisión · Resell")!;
  assert.equal(l.monto, r2(1940 * 0.12));
  assert.match(l.detalle, /^12% de /);
});

test("con 1 de 5 (20%) no llega: el cobro de resell se paga al 5%", () => {
  const e = estado([...CUATRO, llamada("e", 12)], [venta("a", 3, { sesionId: "ses_a" })]);
  const l = lineasDe(e, NOVIEMBRE).find((x) => x.nombre === "Comisión · Resell")!;
  assert.equal(l.monto, 48.5);
  assert.match(l.detalle, /cerró 1 de 5 llamadas de resell \(20%\)/);
});

test("«Ver cómo se calculó» dice la escala, el cierre, quién compró y qué llamadas contaron", () => {
  const e = estado([...CUATRO, llamada("ns", 7, { estado: "No se presentó" })], [venta("a", 3, { sesionId: "ses_a" })]);
  const d = lineasDe(e, NOVIEMBRE).find((x) => x.nombre === "Comisión · Resell")!.desglose!;
  const avisos = (d.avisos ?? []).join("\n");
  assert.match(avisos, /5% con menos de 25% de cierre · 10% desde 25% · 12% con más de 30%/);
  assert.match(avisos, /cerró 1 de 4 llamadas de resell \(25%\)/);
  assert.match(avisos, /Compraron: Alumno a \(3\/11, Resell Mentoría\)/);
  assert.match(avisos, /No cuentan: Alumno ns \(7\/11, no se presentó\)/);
  assert.equal(d.pasos.find((p) => p.texto === "Porcentaje")?.valor, 0.10);
});

/* ---------- Finanzas dice lo mismo ---------- */

test("Finanzas y la liquidación dan lo mismo con la escala, en cada escalón", () => {
  for (const ventas of [
    [venta("a", 3, { sesionId: "ses_a" })],
    [venta("a", 3, { sesionId: "ses_a" }), venta("b", 5, { sesionId: "ses_b" })],
    [venta("a", 3, { sesionId: "ses_a" }), venta("lead", 6, { contactoId: "per_lead", productoId: "p_ment" })],
  ]) {
    const e = estado(CUATRO, ventas);
    assert.equal(enFinanzas(e, NOVIEMBRE), liquidado(e, NOVIEMBRE));
    assert.ok(enFinanzas(e, NOVIEMBRE) > 0);
  }
  const cinco = estado([...CUATRO, llamada("e", 12)], [venta("a", 3, { sesionId: "ses_a" })]);
  assert.equal(enFinanzas(cinco, NOVIEMBRE), 48.5);
  assert.equal(liquidado(cinco, NOVIEMBRE), 48.5);
});

test("lo de antes no cambia: un resell cobrado en octubre sigue al 5% aunque ese mes haya cerrado todo", () => {
  const e = estado([llamada("o", 10, {}, OCTUBRE)], [venta("o", 10, { sesionId: "ses_o" }, OCTUBRE)]);
  assert.equal(liquidado(e, OCTUBRE), 48.5);
  assert.equal(enFinanzas(e, OCTUBRE), 48.5);
  const m = e.equipo.find((x) => x.id === "dante")!;
  const cierre = resolverDeCierre(e, rangoDePeriodo);
  assert.equal(tasaDeComision(m, "p_resell", "2026-10-10", cierre), 0.05);
});

test("la historia para Finanzas lleva la escala desde el día que vale, y dos historias con y sin escala no son la misma", () => {
  const e = estado([], []);
  const m = e.equipo.find((x) => x.id === "dante")!;
  assert.deepEqual(m.comisionHistorial, [
    { general: 0.10, servicios: { p_resell: 0.05 }, hasta: "2026-10-31" },
    { general: 0.10, servicios: { p_resell: 0.05 }, desde: "2026-11-01", escalas: { p_resell: ESCALA_DE_RESELL } },
  ]);
  const sinEscala = m.comisionHistorial!.map((t) => ({ general: t.general, servicios: t.servicios, desde: t.desde, hasta: t.hasta }));
  assert.equal(mismoHistorial(m.comisionHistorial, sinEscala), false);
  assert.equal(mismoHistorial(m.comisionHistorial, structuredClone(m.comisionHistorial)), true);
  assert.equal(escalaDeComision(m, "p_resell", "2026-11-15")?.base, 0.05);
  assert.equal(escalaDeComision(m, "p_resell", "2026-10-15"), undefined);
  assert.equal(escalaDeComision(m, "p_ment", "2026-11-15"), undefined);
});

test("sin saber el cierre (quien pide el % sin el mes), el resell se dice con su % de base", () => {
  const m = estado([], []).equipo.find((x) => x.id === "dante")!;
  assert.equal(tasaDeComision(m, "p_resell", "2026-11-15"), 0.05);
  assert.equal(tasaDeComision(m, "p_resell"), 0.05);
  assert.equal(tasaDeComision(m, "p_ment", "2026-11-15"), 0.10);
});

test("una devolución de un resell revierte con el % que de verdad se pagó ese mes", () => {
  const e = estado(CUATRO, [venta("a", 3, { sesionId: "ses_a" })], {
    devoluciones: [devolucion({ id: "dev1", ventaId: "v_a", monto: 1000, fecha: iso(NOVIEMBRE, 20) })],
  } as Partial<EstadoApp>);
  const r = reversasDeComision(e).find((x) => x.devolucion.id === "dev1")!;
  const parte = r.partes.find((p) => p.rol === "closer")!;
  assert.equal(parte.tasa, 0.10);
});

/* ---------- La regla, como regla ---------- */

test("la regla se describe con su escala, y cambiar un escalón es cambiar cómo se calcula (pide «¿desde cuándo?»)", () => {
  const e = estado([], []);
  const c: ConceptoPago = { ...resellFijo, escala: ESCALA_DE_RESELL };
  assert.match(describirConcepto(c, e), /^5% a 12% .*según su % de cierre de resell del mes \(5% con menos de 25% de cierre · 10% desde 25% · 12% con más de 30%\)/);
  assert.equal(mismoCalculo(resellFijo, c), false);
  assert.equal(mismoCalculo(c, { ...c, escala: { de: "resell", escalones: [{ desde: 0.25, tasa: 0.1 }, { desde: 0.3, estricto: true, tasa: 0.15 }] } }), false);
  assert.equal(mismoCalculo(c, { ...c, nombre: "Otro nombre", notas: "Lo dijo Yari" }), true);
});

test("la escala sólo vale en la comisión de las ventas que cierra: en la de un setter o un director se ignora", () => {
  const base = estadoDeYari();
  const dir = concepto({ id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director", escala: ESCALA_DE_RESELL });
  assert.doesNotMatch(describirConcepto(dir, base), /cierre/);
});

/* ---------- Mi panel ---------- */

test("Mi panel: cómo viene el mes y cuántos cierres faltan para el escalón que sigue", () => {
  const e = estado([...CUATRO, llamada("e", 12)], [venta("a", 3, { sesionId: "ses_a" })]);
  const m = e.equipo.find((x) => x.id === "dante")!;
  const x = escalaDelMesDe(e, m, NOVIEMBRE, rangoDePeriodo, Date.parse(iso(NOVIEMBRE, 20)))!;
  assert.equal(x.cierre.llamadas, 5);
  assert.equal(x.cierre.cierres, 1);
  assert.equal(x.tasa, 0.05);
  /* Con 2 de 5 (40%) pasa de largo el 25%: el escalón que sigue es el de 10%, a 1 cierre. */
  assert.deepEqual(x.proximo, { escalon: { desde: 0.25, tasa: 0.1 }, faltan: 1 });
  /* Quien no tiene escala no ve nada. */
  assert.equal(escalaDelMesDe(e, e.equipo.find((y) => y.id === "mariano")!, NOVIEMBRE, rangoDePeriodo), null);
  /* Y en octubre, antes de la regla, tampoco. */
  assert.equal(escalaDelMesDe(e, m, OCTUBRE, rangoDePeriodo), null);
});

test("el escalón que sigue: de 25% a «más de 30%» y, ya en el más alto, ninguno", () => {
  assert.deepEqual(proximoEscalon(ESCALA_DE_RESELL, { llamadas: 4, cierres: 1, pct: 0.25 }), { escalon: { desde: 0.3, estricto: true, tasa: 0.12 }, faltan: 1 });
  assert.deepEqual(proximoEscalon(ESCALA_DE_RESELL, { llamadas: 10, cierres: 1, pct: 0.1 }), { escalon: { desde: 0.25, tasa: 0.1 }, faltan: 2 });
  assert.deepEqual(proximoEscalon(ESCALA_DE_RESELL, { llamadas: 10, cierres: 3, pct: 0.3 }), { escalon: { desde: 0.3, estricto: true, tasa: 0.12 }, faltan: 1 });
  assert.equal(proximoEscalon(ESCALA_DE_RESELL, { llamadas: 4, cierres: 2, pct: 0.5 }), null);
});
