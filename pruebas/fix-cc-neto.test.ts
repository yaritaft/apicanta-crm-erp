import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { cashCollected } from "@/lib/finanzas";
import {
  cobrosDeCelda, devolucionesDeCelda, DEVOLUCIONES, ingresosPorCuentaYServicio, SIN_CUENTA, SIN_SERVICIO,
  type IngresosPorCuentaYServicio,
} from "@/lib/ingresos-semanales";
import { rangoDeFechas, type RangoMes } from "@/lib/metricas";
import { metricasDeWebinar, personasDeWebinar } from "@/lib/webinar";
import { numerosDe, plataDeVentas, rendimientoPorVia } from "@/lib/vias-webinar";
import { hojasDelInforme, informeDelWebinar } from "@/lib/informe-webinar";
import { escribirXlsx } from "@/lib/xlsxEscribir";
import type { Devolucion, EstadoApp, Pago, Webinar } from "@/lib/types";

/* ==================================================================
   Cash Collected neto de devoluciones en tres pantallas que lo llamaban
   «Cash Collected» o «cobrado» al bruto (hallazgo de estrés «plata #2»):

   - Ingresos de la semana (lib/ingresos-semanales.ts): el total tiene que ser
     cashCollected(e, rango) = cobrado − devuelto;
   - el rendimiento por vía de un webinar (lib/vias-webinar.ts) y
   - el informe del webinar (lib/informe-webinar.ts): lo cobrado de cada venta
     resta sus devoluciones confirmadas, como metricasDeWebinar.

   Sin devoluciones cargadas, todos los números son los de siempre.
   ================================================================== */

const cent = (n: number) => Math.round(n * 100);

/* Un instante de octubre de 2026 en hora local, sin zona (las semanas de ingresos-semanales se cortan con la hora local). */
const oct = (d: number, h = 12) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000`;
const sep = (d: number, h = 12) => `2026-09-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000`;
const semana = (desde: string, hasta: string) => rangoDeFechas(desde, hasta, `${desde} al ${hasta}`);

const pago = (id: string, cuotaId: string, procesadorId: string | undefined, monto: number, fecha: string): Pago =>
  ({ id, cuotaId, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha, creadoEn: fecha });
const devolucion = (id: string, ventaId: string | undefined, monto: number, fecha: string, extra: Partial<Devolucion> = {}): Devolucion =>
  ({ id, ventaId, monto, moneda: "USD", fecha, procesadorId: "stripe", noDescontarAlCloser: false, estado: "confirmada", creadoEn: fecha, extra: {}, ...extra });

/* ---------- Ingresos de la semana ---------- */

/* El caso del hallazgo: una venta de 1.000 cobrada entera el 06/10 y una devolución de 300 el 08/10, en la misma semana. */
function conUnaDevolucion(): EstadoApp {
  return {
    procesadores: [{ id: "stripe", nombre: "Stripe" }, { id: "mercury", nombre: "Mercury" }],
    productos: [{ id: "mentoria", nombre: "Mentoría" }, { id: "downsell", nombre: "Downsell" }],
    ventas: [{ id: "v1", productoId: "mentoria" }, { id: "v2", productoId: "downsell" }],
    cuotas: [{ id: "q1", ventaId: "v1" }, { id: "q2", ventaId: "v2" }],
    pagos: [pago("p1", "q1", "stripe", 1000, oct(6, 10)), pago("p2", "q2", "mercury", 50.5, oct(7))],
    devoluciones: [devolucion("d1", "v1", 300, oct(8))],
  } as unknown as EstadoApp;
}

const suma = (xs: { total: { centavos: number } }[]) => xs.reduce((a, x) => a + x.total.centavos, 0);

test("Ingresos de la semana: el total es el Cash Collected (cobrado − devuelto), igual que el Dashboard y el estado de resultados", () => {
  const e = conUnaDevolucion();
  const m = semana("2026-10-05", "2026-10-11");
  const r = ingresosPorCuentaYServicio(e, m);

  assert.equal(cashCollected(e, m), 750.5);
  assert.equal(r.total.monto, 750.5, "antes decía 1.050,50: el bruto");
  assert.equal(r.total.centavos, cent(cashCollected(e, m)));
  assert.equal(r.total.cobros, 2, "los cobros siguen siendo 2");
  assert.equal(r.total.devoluciones, 1);
  assert.equal(r.cobrado.monto, 1050.5, "lo cobrado, antes de devolver, se sigue viendo");
  assert.equal(r.devuelto.monto, -300);
  assert.equal(r.total.centavos, r.cobrado.centavos + r.devuelto.centavos);
});

test("Ingresos de la semana: lo devuelto va en su propia fila, en negativo y en la columna del servicio de la venta; las cuentas no cambian", () => {
  const r = ingresosPorCuentaYServicio(conUnaDevolucion(), semana("2026-10-05", "2026-10-11"));

  /* Stripe sigue en 1.000 (lo que entró por Stripe) y la fila de devoluciones va al final. */
  assert.deepEqual(r.cuentas.map((c) => c.id), ["stripe", "mercury", DEVOLUCIONES]);
  assert.equal(r.cuentas[0].total.monto, 1000);
  const dev = r.cuentas[2];
  assert.equal(dev.nombre, "Devoluciones");
  assert.equal(dev.total.monto, -300);
  assert.equal(dev.porServicio.mentoria.monto, -300, "en la columna del servicio de la venta devuelta");
  assert.equal(dev.porServicio.mentoria.devoluciones, 1);
  assert.equal(dev.porServicio.mentoria.cobros, 0);
  assert.equal(r.cuentas[0].porServicio.mentoria.devoluciones, 0, "las cuentas no tienen devoluciones");

  /* Las columnas son netas (cobrado − devuelto de ese servicio) y guardan lo cobrado aparte. */
  const col = (id: string) => r.servicios.find((s) => s.id === id)!;
  assert.deepEqual([col("mentoria").total.monto, col("mentoria").cobrado.monto], [700, 1000]);
  assert.deepEqual([col("downsell").total.monto, col("downsell").cobrado.monto], [50.5, 50.5]);

  /* Filas, columnas y total son la misma plata. */
  assert.equal(suma(r.cuentas), r.total.centavos);
  assert.equal(suma(r.servicios), r.total.centavos);
  for (const c of r.cuentas) assert.equal(Object.values(c.porServicio).reduce((a, x) => a + x.centavos, 0), c.total.centavos, c.nombre);
});

test("Ingresos de la semana: la devolución resta el día que se devolvió la plata, no el del cobro (semana sólo con una devolución)", () => {
  const e = conUnaDevolucion();
  /* La semana anterior no cobró ni devolvió nada de esa venta; la siguiente sólo devuelve. */
  const soloDevolucion = { ...e, pagos: [pago("p0", "q1", "stripe", 1000, sep(30)), ...e.pagos.slice(1)] } as EstadoApp;
  const antes = ingresosPorCuentaYServicio(soloDevolucion, semana("2026-09-28", "2026-10-04"));
  assert.equal(antes.total.monto, 1000);
  assert.deepEqual(antes.cuentas.map((c) => c.id), ["stripe"], "sin devoluciones esa semana no hay fila de devoluciones");
  assert.equal(antes.devuelto.devoluciones, 0);

  const despues = ingresosPorCuentaYServicio({ ...e, pagos: [] } as unknown as EstadoApp, semana("2026-10-05", "2026-10-11"));
  assert.equal(despues.total.monto, -300, "una semana de sólo devoluciones da Cash Collected negativo, como Finanzas");
  assert.equal(cashCollected({ ...e, pagos: [] } as unknown as EstadoApp, semana("2026-10-05", "2026-10-11")), -300);
  assert.deepEqual(despues.cuentas.map((c) => c.id), [DEVOLUCIONES]);
  assert.deepEqual(despues.servicios.map((s) => [s.id, s.total.monto, s.cobrado.monto]), [["mentoria", -300, 0]]);
  assert.equal(despues.pagos.length, 0);
});

test("Ingresos de la semana: sólo restan las devoluciones confirmadas (la propuesta y la ignorada no), con o sin estado", () => {
  const e = conUnaDevolucion();
  const con = {
    ...e,
    devoluciones: [
      devolucion("d1", "v1", 300, oct(8)),
      devolucion("d2", "v1", 100, oct(8), { estado: "propuesta" }),
      devolucion("d3", "v1", 200, oct(9), { estado: "ignorada" }),
      /* Una de antes del estado: sin el campo cuenta como confirmada (esDevolucionConfirmada). */
      { ...devolucion("d4", "v2", 20, oct(9)), estado: undefined } as unknown as Devolucion,
    ],
  } as EstadoApp;
  const m = semana("2026-10-05", "2026-10-11");
  const r = ingresosPorCuentaYServicio(con, m);
  assert.deepEqual(r.devoluciones.map((d) => d.id), ["d1", "d4"]);
  assert.equal(r.total.monto, 1050.5 - 320);
  assert.equal(r.total.centavos, cent(cashCollected(con, m)));
});

test("Ingresos de la semana: una devolución sin venta, o de una venta sin servicio o con el servicio borrado, no se pierde", () => {
  const e = {
    ...conUnaDevolucion(),
    ventas: [{ id: "v1", productoId: "mentoria" }, { id: "v2", productoId: "downsell" }, { id: "v3" }, { id: "v4", productoId: "borrado" }],
    cuotas: [{ id: "q1", ventaId: "v1" }, { id: "q2", ventaId: "v2" }],
    devoluciones: [
      devolucion("a", undefined, 10, oct(8)), devolucion("b", "v3", 20, oct(8)), devolucion("c", "v4", 30, oct(8)), devolucion("d", "no-existe", 40, oct(9)),
    ],
  } as unknown as EstadoApp;
  const m = semana("2026-10-05", "2026-10-11");
  const r = ingresosPorCuentaYServicio(e, m);
  assert.equal(r.total.centavos, cent(cashCollected(e, m)));
  const col = (id: string) => r.servicios.find((s) => s.id === id)!;
  assert.equal(col(SIN_SERVICIO).total.monto, -70, "sin venta, venta sin servicio y venta que no existe: «sin servicio»");
  assert.equal(col("borrado").nombre, "Servicio borrado");
  assert.equal(col("borrado").total.monto, -30);
  assert.deepEqual(r.servicios.map((s) => s.id), ["mentoria", "downsell", "borrado", SIN_SERVICIO], "«sin servicio» al final, y los que sólo tienen devoluciones después de los que cobraron");
  assert.equal(suma(r.cuentas), r.total.centavos);
  assert.equal(suma(r.servicios), r.total.centavos);
});

test("Ingresos de la semana: cada número abre exactamente lo que lo forma —cobros y devoluciones— y suma lo que él", () => {
  const e = {
    ...conUnaDevolucion(),
    devoluciones: [devolucion("d1", "v1", 300, oct(8)), devolucion("d2", "v2", 5.25, oct(9)), devolucion("d3", "v1", 100, oct(10), { procesadorId: "mercury" })],
  } as unknown as EstadoApp;
  const r = ingresosPorCuentaYServicio(e, semana("2026-10-05", "2026-10-11"));
  const plata = (cuentaId?: string, servicioId?: string) => {
    const cobros = cobrosDeCelda(e, r, cuentaId, servicioId);
    const devueltas = devolucionesDeCelda(e, r, cuentaId, servicioId);
    return {
      cobros: cobros.length, devoluciones: devueltas.length,
      centavos: cobros.reduce((a, p) => a + cent(p.monto), 0) - devueltas.reduce((a, d) => a + cent(d.monto), 0),
    };
  };
  const igual = (celda: { centavos: number; cobros: number; devoluciones: number }, que: ReturnType<typeof plata>, donde: string) =>
    assert.deepEqual({ cobros: celda.cobros, devoluciones: celda.devoluciones, centavos: celda.centavos }, que, donde);

  for (const c of r.cuentas) {
    for (const [servicioId, celda] of Object.entries(c.porServicio)) igual(celda, plata(c.id, servicioId), `${c.nombre} × ${servicioId}`);
    igual(c.total, plata(c.id), `fila ${c.nombre}`);
  }
  for (const s of r.servicios) igual(s.total, plata(undefined, s.id), `columna ${s.nombre}`);
  igual(r.total, plata(), "el total general");
  /* Una cuenta no abre devoluciones, y la fila de devoluciones no abre cobros. */
  assert.equal(devolucionesDeCelda(e, r, "stripe").length, 0);
  assert.equal(cobrosDeCelda(e, r, DEVOLUCIONES).length, 0);
  assert.equal(devolucionesDeCelda(e, r, DEVOLUCIONES).length, 3);
});

/* Una semana sin devoluciones tiene que dar exactamente lo de antes de este arreglo: acá se repite la cuenta vieja. */
function agrupadoComoAntes(e: EstadoApp, m: RangoMes) {
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const productoDeVenta = new Map(e.ventas.map((v) => [v.id, v.productoId] as const));
  const celdas = new Map<string, { centavos: number; cobros: number }>();
  for (const p of e.pagos) {
    const t = new Date(p.fecha).getTime();
    if (t < m.desde.getTime() || t > m.hasta.getTime()) continue;
    const ventaId = ventaDeCuota.get(p.cuotaId);
    const productoId = ventaId ? productoDeVenta.get(ventaId) : undefined;
    const k = `${p.procesadorId ?? SIN_CUENTA}|${productoId ?? SIN_SERVICIO}`;
    const c = celdas.get(k) ?? { centavos: 0, cobros: 0 };
    c.centavos += cent(p.monto); c.cobros += 1;
    celdas.set(k, c);
  }
  return celdas;
}

function azar(semilla: number) {
  let a = semilla >>> 0;
  const n = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  return { n, entre: (min: number, max: number) => min + Math.floor(n() * (max - min + 1)), elige: <T,>(xs: readonly T[]): T => xs[Math.floor(n() * xs.length)] };
}

/* Cobros y devoluciones al azar en tres semanas, con cuentas y servicios borrados o inexistentes y cobros huérfanos. */
function mundoAlAzar(semilla: number, conDevoluciones: boolean): EstadoApp {
  const r = azar(semilla);
  const ventas = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, productoId: r.elige([undefined, "mentoria", "downsell", "viejo"]) }));
  const cuotas = ventas.flatMap((v) => [{ id: `${v.id}a`, ventaId: v.id }, { id: `${v.id}b`, ventaId: v.id }]);
  const fecha = () => (r.n() < 0.5 ? sep(r.entre(28, 30), r.entre(0, 23)) : oct(r.entre(1, 18), r.entre(0, 23)));
  const centavos = () => r.entre(100, 250099) / 100;
  const pagos = Array.from({ length: 24 }, (_, i) =>
    pago(`p${i}`, r.n() < 0.1 ? "huerfana" : r.elige(cuotas).id, r.elige(["stripe", "mercury", "fin", undefined, "borrada"]), centavos(), fecha()));
  const devoluciones = !conDevoluciones ? [] : Array.from({ length: r.entre(0, 7) }, (_, i) =>
    devolucion(`d${i}`, r.n() < 0.15 ? undefined : r.elige(["no-existe", ...ventas.map((v) => v.id)]), r.entre(100, 25009) / 100, fecha(), {
      estado: r.elige(["confirmada", "confirmada", "confirmada", "propuesta", "ignorada"]),
    }));
  return {
    procesadores: [{ id: "stripe", nombre: "Stripe" }, { id: "mercury", nombre: "Mercury" }, { id: "fin", nombre: "Financiera" }],
    productos: [{ id: "mentoria", nombre: "Mentoría" }, { id: "downsell", nombre: "Downsell" }],
    ventas, cuotas, pagos, devoluciones,
  } as unknown as EstadoApp;
}

const RANGOS = [semana("2026-09-28", "2026-10-04"), semana("2026-10-05", "2026-10-11"), semana("2026-10-12", "2026-10-18"), semana("2026-09-30", "2026-10-09")];

test("Ingresos de la semana, al azar: el total es el Cash Collected al centavo, filas y columnas lo suman y cada celda es su lista", () => {
  let conDevolucion = 0, semanas = 0;
  for (let semilla = 1; semilla <= 60; semilla++) {
    const e = mundoAlAzar(semilla, true);
    for (const m of RANGOS) {
      const r: IngresosPorCuentaYServicio = ingresosPorCuentaYServicio(e, m);
      const donde = `semilla ${semilla}, ${m.etiqueta}`;
      assert.equal(r.total.centavos, cent(cashCollected(e, m)), `${donde}: total`);
      assert.equal(r.total.centavos, r.cobrado.centavos + r.devuelto.centavos, `${donde}: cobrado + devuelto`);
      assert.equal(suma(r.cuentas), r.total.centavos, `${donde}: filas`);
      assert.equal(suma(r.servicios), r.total.centavos, `${donde}: columnas`);
      assert.equal(r.cuentas.at(-1)?.id === DEVOLUCIONES, r.devuelto.devoluciones > 0, `${donde}: la fila de devoluciones, si hay, va última`);
      assert.equal(r.total.cobros, r.pagos.length, `${donde}: cobros`);
      assert.equal(r.devuelto.devoluciones, r.devoluciones.length, `${donde}: devoluciones`);
      for (const s of r.servicios) {
        const lista = { c: cobrosDeCelda(e, r, undefined, s.id), d: devolucionesDeCelda(e, r, undefined, s.id) };
        assert.equal(lista.c.reduce((a, p) => a + cent(p.monto), 0), s.cobrado.centavos, `${donde}: cobrado de ${s.id}`);
        assert.equal(lista.c.reduce((a, p) => a + cent(p.monto), 0) - lista.d.reduce((a, d) => a + cent(d.monto), 0), s.total.centavos, `${donde}: columna ${s.id}`);
      }
      const dev = r.cuentas.find((c) => c.id === DEVOLUCIONES);
      if (dev) {
        const lista = devolucionesDeCelda(e, r, DEVOLUCIONES);
        assert.equal(lista.length, dev.total.devoluciones, `${donde}: devoluciones de la fila`);
        assert.equal(-lista.reduce((a, d) => a + cent(d.monto), 0), dev.total.centavos, `${donde}: monto de la fila`);
        conDevolucion++;
      }
      semanas++;
    }
  }
  assert.ok(conDevolucion > 40 && conDevolucion < semanas, `cobertura: ${conDevolucion} de ${semanas} semanas con devolución`);
});

test("Ingresos de la semana, sin devoluciones: cada celda, fila y total es exactamente el de antes (sin fila de devoluciones)", () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const e = mundoAlAzar(semilla, false);
    for (const m of RANGOS) {
      const r = ingresosPorCuentaYServicio(e, m);
      const antes = agrupadoComoAntes(e, m);
      const ahora = new Map<string, { centavos: number; cobros: number }>();
      for (const c of r.cuentas) for (const [servicioId, celda] of Object.entries(c.porServicio)) {
        assert.equal(celda.devoluciones, 0);
        ahora.set(`${c.id}|${servicioId}`, { centavos: celda.centavos, cobros: celda.cobros });
      }
      assert.deepEqual(ahora, antes, `semilla ${semilla}, ${m.etiqueta}`);
      assert.ok(!r.cuentas.some((c) => c.id === DEVOLUCIONES), "sin devoluciones no hay fila de devoluciones");
      assert.equal(r.devuelto.centavos, 0);
      assert.equal(r.total.centavos, r.cobrado.centavos);
      for (const s of r.servicios) assert.equal(s.total.centavos, s.cobrado.centavos);
    }
  }
});

/* ---------- Vías del webinar, informe del webinar y personas ---------- */

/* Un webinar del 07/10 a las 19 (Argentina) con tres ventas y una devolución en cada una:
   - Ana agendó en el vivo: venta de 3.000, cobró 1.234,56 y se le devolvieron 300,10 → 934,46;
   - Beto agendó con el replay: venta de 2.000, cobró 2.000, sin devolución (y una propuesta de la pasarela sin confirmar);
   - Cris no agendó: venta de 1.000, cobró 1.000 y se le devolvieron 250 → 750.
   Y lo que no cuenta: una venta cancelada con su devolución y una venta de otro webinar con la suya. */
const calif = [
  { pregunta: "inversion", respuesta: "Puedo invertir en mí de 1000 a 2000 USD" },
  { pregunta: "ingles", respuesta: "Conversacional aunque cometo errores" },
  { pregunta: "formacion", respuesta: "Universitaria completa" },
];
const utmAd = { utm_source: "meta", utm_medium: "paid", utm_campaign: "webinar_20261007", utm_content: "angulo-uno" };
const link = (contenido: string) => ({ utm_source: "whatsapp", utm_medium: "organic", utm_campaign: "webinar_20261007", utm_content: contenido });

function webinarConDevoluciones(conDevoluciones = true): { e: EstadoApp; w1: Webinar; w2: Webinar } {
  const base = construirSemilla();
  const contacto = (id: string, nombre: string) => ({
    id, nombre, email: `${nombre.toLowerCase()}@mail.com`, telefono: "+5491155550000", pais: "Argentina",
    origenCanal: "webinar", origenWebinarId: "w1", utm: utmAd, creadoEn: "2026-10-02T15:00:00.000Z",
    extra: { registrosWebinar: [{ id: `reg_${id}`, webinarId: "w1", creado: "2026-10-02T15:00:00.000Z", utm: utmAd, respuestas: calif }] },
  });
  const sesion = (id: string, contactoId: string, nombre: string, contenido: string) => ({
    id, titulo: "Llamada", invitado: nombre, email: `${nombre.toLowerCase()}@mail.com`, contactoId, leadId: contactoId,
    inicia: "2026-10-09T15:00:00.000Z", duracionMin: 30, estado: "agendada", tipo: "Llamada de Asesoramiento - Webinar - Team", origen: "calendly",
    creadoEn: "2026-10-07T23:00:00.000Z", extra: {}, utm: link(contenido), respuestas: calif, anfitrion: "Dante", calendlyInvitadoUri: `uri_${id}`,
  });
  const venta = (id: string, contactoId: string, nombre: string, precio: number, extra: object = {}) => ({
    id, contactoId, contactoNombre: nombre, webinarId: "w1", precioAcordado: precio, estado: "activa", fecha: "2026-10-10T15:00:00.000Z",
    productoId: base.productos[0].id, moneda: "USD", ...extra,
  });
  const w = { ...base.webinars[0], titulo: "Webinar de prueba", fecha: "2026-10-07T22:00:00.000Z", estado: "finalizado", inversion: 0, formularios: 0, inversionDmAds: 0, costoWhatsappApi: 0 };
  const w1 = { ...w, id: "w1" } as Webinar;
  const w2 = { ...w, id: "w2", titulo: "Otro webinar", fecha: "2026-09-23T22:00:00.000Z" } as Webinar;
  const cuota = (id: string, ventaId: string) => ({ id, ventaId, numero: 1, monto: 1, estado: "pagada", esReserva: false });
  const cobro = (id: string, cuotaId: string, monto: number) => ({ id, cuotaId, monto, feeMonto: 0, fecha: "2026-10-10T15:00:00.000Z", creadoEn: "2026-10-10T15:00:00.000Z" });
  const dev = (id: string, ventaId: string, monto: number, extra: Partial<Devolucion> = {}) =>
    devolucion(id, ventaId, monto, "2026-10-12T15:00:00.000Z", extra);

  const e = {
    ...base,
    webinars: [w1, w2],
    contactos: [contacto("c1", "Ana"), contacto("c2", "Beto"), contacto("c3", "Cris")],
    leads: [],
    sesiones: [sesion("s1", "c1", "Ana", "vivo"), sesion("s2", "c2", "Beto", "replay")],
    campaigns: [{ id: "camp1", nombre: "[WEBINAR 07/10] Captación", objetivo: "leads", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    adsets: [{ id: "set1", campaignId: "camp1", nombre: "Conjunto", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    ads: [{ id: "ad_a", adsetId: "set1", campaignId: "camp1", nombre: "ANGULO UNO.mp4", estado: "active", creadoEn: "2026-10-01T00:00:00Z", extra: {} }],
    adInsights: [{ id: "ad_a_1", adId: "ad_a", dia: "2026-10-02", inversion: 100, impresiones: 1000, clicks: 50, leads: 6, acciones: {}, creadoEn: "" }],
    ventas: [
      venta("v1", "c1", "Ana", 3000), venta("v2", "c2", "Beto", 2000), venta("v3", "c3", "Cris", 1000),
      venta("v4", "c1", "Ana", 500, { estado: "cancelada" }),
      venta("v5", "c9", "Dora", 800, { webinarId: "w2" }),
    ],
    cuotas: ["v1", "v2", "v3", "v4", "v5"].map((v) => cuota(`q_${v}`, v)),
    pagos: [cobro("p1", "q_v1", 1234.56), cobro("p2", "q_v2", 2000), cobro("p3", "q_v3", 1000), cobro("p4", "q_v4", 100), cobro("p5", "q_v5", 800)],
    devoluciones: conDevoluciones
      ? [
        dev("d1", "v1", 300.1), dev("d3", "v3", 250),
        dev("d2", "v2", 400, { estado: "propuesta" }),
        dev("d4", "v4", 100), dev("d5", "v5", 800),
      ]
      : [],
    gastos: [],
  } as unknown as EstadoApp;
  return { e, w1, w2 };
}

test("Vías del webinar: lo cobrado de cada venta resta lo que se le devolvió y la suma por vía es el cobrado del resultado del webinar", () => {
  const { e, w1 } = webinarConDevoluciones();
  const m = metricasDeWebinar(e, w1);
  const vias = rendimientoPorVia(e, w1);

  assert.equal(cent(m.cobrado), cent(934.46 + 2000 + 750), "el resultado del webinar: 4.234,56 cobrados − 550,10 devueltos");
  assert.equal(vias.total.ventas, 3, "la cancelada y la de otro webinar no cuentan");
  assert.equal(vias.total.facturado, 6000);
  assert.equal(cent(vias.total.cobrado), cent(m.cobrado), "antes sumaba 4.234,56");
  assert.equal(cent(vias.total.devuelto), cent(m.devoluciones), "y lo devuelto es lo que resta el resultado");
  assert.equal(cent(vias.total.devuelto), 55010);

  /* Cada vía con lo suyo: Ana en el vivo, Beto en el replay, Cris sin agenda. */
  const vivo = numerosDe(vias, "webinar", "vivo"), replay = numerosDe(vias, "webinar", "replay");
  assert.deepEqual([cent(vivo.cobrado), cent(vivo.devuelto), vivo.ventas], [93446, 30010, 1]);
  assert.deepEqual([cent(replay.cobrado), cent(replay.devuelto), replay.ventas], [200000, 0, 1], "la devolución propuesta no resta");
  assert.deepEqual([cent(vias.sinAgenda.cobrado), cent(vias.sinAgenda.devuelto), vias.sinAgenda.ventas], [75000, 25000, 1]);
  assert.equal(cent(vivo.cobrado + replay.cobrado + vias.sinAgenda.cobrado), cent(m.cobrado));
});

test("Vías del webinar: varios webinars juntos suman lo mismo que sus resultados, y el otro webinar trae su propia devolución", () => {
  const { e, w1, w2 } = webinarConDevoluciones();
  const juntos = rendimientoPorVia(e, [w1, w2]);
  assert.equal(cent(juntos.total.cobrado), cent(metricasDeWebinar(e, w1).cobrado + metricasDeWebinar(e, w2).cobrado));
  assert.equal(cent(metricasDeWebinar(e, w2).cobrado), 0, "el otro webinar cobró 800 y los devolvió");
  assert.equal(cent(rendimientoPorVia(e, w2).total.cobrado), 0);
});

test("Vías del webinar, sin devoluciones: lo cobrado es la suma de los cobros, tal cual (sin redondear nada)", () => {
  const { e, w1 } = webinarConDevoluciones(false);
  const vias = rendimientoPorVia(e, w1);
  assert.equal(vias.total.cobrado, 1234.56 + 2000 + 1000);
  assert.equal(vias.total.devuelto, 0);
  assert.equal(vias.total.cobrado, metricasDeWebinar(e, w1).cobrado);
  assert.equal(plataDeVentas(e).get("v1")?.cobrado, 1234.56);
  assert.deepEqual(plataDeVentas(e, new Set(["v2"])).get("v2"), { cobrado: 2000, devuelto: 0 });
  assert.equal(plataDeVentas(e, new Set(["v2"])).has("v1"), false, "con ids, sólo esas ventas");
});

test("Personas del webinar: el cobrado de cada persona resta lo devuelto y entre todas suman el cobrado del resultado", () => {
  const { e, w1 } = webinarConDevoluciones();
  const personas = personasDeWebinar(e, "w1");
  const por = (n: string) => personas.find((p) => p.nombre === n)!;
  assert.equal(cent(por("Ana").cobrado), 93446, "la venta cancelada de Ana no cuenta");
  assert.equal(cent(por("Beto").cobrado), 200000);
  assert.equal(cent(por("Cris").cobrado), 75000);
  assert.equal(cent(personas.reduce((a, p) => a + p.cobrado, 0)), cent(metricasDeWebinar(e, w1).cobrado));
  assert.equal(por("Ana").facturado, 3000, "lo facturado no cambia con una devolución");
});

test("Informe del webinar: las tres hojas dicen el mismo cobrado que el resumen y el ROAS on CC de un anuncio es el del resumen", () => {
  const { e, w1 } = webinarConDevoluciones();
  const i = informeDelWebinar(e, w1);
  const m = metricasDeWebinar(e, w1);
  const resumen = i.personas.bloques!.flatMap((b) => b.filas);
  const dato = (etiqueta: string) => resumen.find((f) => f.etiqueta.trim() === etiqueta)!;
  assert.equal(cent(dato("Cobrado (Cash Collected)").valor as number), cent(m.cobrado));
  assert.match(dato("Cobrado (Cash Collected)").nota!, /menos lo que se devolvió/);
  assert.equal(cent(dato("Devuelto").valor as number), 55010, "la fila de lo devuelto aparece y dice que ya está restado");
  assert.match(dato("Devuelto").nota!, /ya está restado/);

  const col = <T,>(cols: { titulo: string; valor: (f: T) => unknown; total?: (fs: T[]) => unknown }[], t: string) => cols.find((c) => c.titulo === t)!;
  const personas = col(i.personas.columnas as never, "Cobrado") as { total: (fs: unknown[]) => unknown };
  assert.equal(personas.total(i.personas.filas as never), 3684.46, "la hoja «Personas» suma lo del resumen");
  const agendas = col(i.agendas.columnas as never, "Cobrado") as { valor: (f: unknown) => unknown; total: (fs: unknown[]) => unknown };
  const ana = i.agendas.filas.find((f) => f.a.nombre === "Ana")!;
  assert.equal(cent(agendas.valor(ana as never) as number), 93446, "la hoja «Agendas»: lo cobrado de Ana ya sin lo devuelto");
  assert.equal(agendas.total(i.agendas.filas as never), 2934.46, "las dos ventas con agenda: 934,46 + 2.000");

  const uno = i.anuncios.filas.find((f) => f.anuncio.toLowerCase().includes("uno"))!;
  assert.equal(uno.cobrado, 2934.46, "el anuncio trae las dos ventas que vinieron por agenda, netas");
  const roas = col(i.anuncios.columnas as never, "ROAS on CC") as { valor: (f: unknown) => unknown };
  assert.equal(roas.valor(uno as never), 29.34, "2.934,46 / 100: ya no se infla con lo devuelto");
});

test("Informe del webinar: el rendimiento por vía dice lo cobrado ya sin lo devuelto, redondeado a centavos", () => {
  const { e, w1 } = webinarConDevoluciones();
  const filas = informeDelWebinar(e, w1).personas.bloques!.flatMap((b) => b.filas);
  const vivo = filas.find((f) => f.etiqueta === "Webinar · En el vivo")!;
  assert.match(vivo.nota!, /1 ventas \(facturado 3000, cobrado 934\.46, tras devolver 300\.1\)\./, "sin colas de punto flotante");
  const sinAgenda = filas.find((f) => f.etiqueta.startsWith("Ventas de gente que no agendó"))!;
  assert.match(sinAgenda.nota!, /facturado 1000, cobrado 750, tras devolver 250\./);
  const replay = filas.find((f) => f.etiqueta === "Webinar · Replay")!;
  assert.match(replay.nota!, /\(facturado 2000, cobrado 2000\)\./, "sin devolución la nota no dice nada de más");
});

test("Informe del webinar: con devoluciones el Excel se arma igual (la fila de «Devuelto» entra en la hoja del resumen)", async () => {
  const { e, w1 } = webinarConDevoluciones();
  const hojas = hojasDelInforme(informeDelWebinar(e, w1));
  assert.ok(hojas[0].celdas.some((c) => c.valor === "   Devuelto"), "la fila está en la primera hoja");
  const datos = await escribirXlsx({ hojas });
  assert.equal(datos[0], 0x50); assert.equal(datos[1], 0x4b); // «PK»
});

test("Informe del webinar, sin devoluciones: igual que antes (sin fila de «Devuelto» y con las notas de siempre)", () => {
  const { e, w1 } = webinarConDevoluciones(false);
  const filas = informeDelWebinar(e, w1).personas.bloques!.flatMap((b) => b.filas);
  assert.ok(!filas.some((f) => f.etiqueta.trim() === "Devuelto"));
  assert.equal(filas.find((f) => f.etiqueta === "Webinar · En el vivo")!.nota, "agendas; 1 calificadas, 0 canceladas, 1 ventas (facturado 3000, cobrado 1234.56).");
  assert.equal(filas.find((f) => f.etiqueta.trim() === "Cobrado (Cash Collected)")!.valor, 1234.56 + 2000 + 1000);
});
