import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { construirSemilla } from "@/lib/seed";
import { CON_CIERRE, NO_SE_PRESENTO, SIN_CIERRE } from "@/lib/estados";
import { metricasDeWebinar } from "@/lib/webinar";
import { reporteDelWebinar, tasasDelReporte, textoDelReporte, type AgendaParaReporte } from "@/lib/reporte-webinar";
import { ventasParaAtar } from "@/lib/atar-webinars";
import { cobroDeCuota } from "@/lib/estado-cuota";
import type { Cuota, Devolucion, EstadoApp, Pago, Sesion, Venta, Webinar } from "@/lib/types";

/* Del mismo Taller 21/10 salieron dos números (04/11): Santi reportó facturación = cash = US$ 32.815 y Agustín, sumando el
   CSV, 40 y pico mil de cash y 60 y pico mil de facturación. Ahora el reporte lo arma la app, con la misma cuenta que la
   ficha del webinar, y avisa de las ventas que por su link son de otro embudo (cinco del VSL de YouTube estaban atadas). */

const base = construirSemilla();
const W: Webinar = { ...base.webinars[0], id: "w21", titulo: "Taller 21/10/2026 - Yari Taft", fecha: "2026-10-21T22:00:00.000Z", estado: "finalizado", inversion: 11410, inversionDmAds: 352, costoWhatsappApi: 0 } as Webinar;
const productos = [
  { id: "ai", nombre: "Hackear AI", precioLista: 3000, tipo: "principal", activo: true, orden: 0 },
  { id: "down", nombre: "Downsell", precioLista: 500, tipo: "downsell", activo: true, orden: 1 },
];
const embudos = [{ ...base.embudos[0], id: "emb_web", nombre: "Webinar", esWebinar: true }, { ...base.embudos[0], id: "emb_yt", nombre: "VSL YOUTUBE", esWebinar: false }];
const V = (id: string, dia: string, precio: number, producto = "ai", extra: Partial<Venta> = {}): Venta =>
  ({ ...base.ventas[0], id, contactoId: `c_${id}`, contactoNombre: id, fecha: `${dia}T15:00:00.000Z`, estado: "activa", precioAcordado: precio, productoId: producto, webinarId: "w21", embudoId: "emb_web", moneda: "USD", sesionId: undefined, ...extra } as Venta);
const C = (id: string, ventaId: string, numero: number, monto: number, esReserva = false): Cuota => ({ id, ventaId, numero, monto, vence: "2026-10-22T15:00:00.000Z", estado: "pendiente", esReserva } as Cuota);
const P = (id: string, cuotaId: string, monto: number, dia: string): Pago => ({ id, cuotaId, procesadorId: "pr", monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: `${dia}T15:00:00.000Z`, creadoEn: `${dia}T15:00:00.000Z` } as Pago);

function estado(): EstadoApp {
  const ventas = [
    V("full", "2026-10-22", 3000),                    // pago único, cobrado entero
    V("cuotas", "2026-10-23", 3000),                  // 3 de 1.000, pagó una
    V("reserva", "2026-10-25", 3000),                 // sólo la seña
    V("down", "2026-10-24", 500, "down"),
    V("devuelta", "2026-10-24", 500, "down", { estado: "reembolsada" }),
    V("noviembre", "2026-11-02", 3000),               // después del corte
    V("youtube", "2026-10-27", 2800, "ai", { sesionId: "ses_yt" }),
  ];
  const cuotas = [
    C("full1", "full", 1, 3000),
    C("cu1", "cuotas", 1, 1000), C("cu2", "cuotas", 2, 1000), C("cu3", "cuotas", 3, 1000),
    C("re0", "reserva", 0, 50, true), C("re1", "reserva", 1, 2950),
    C("do1", "down", 1, 500), C("dv1", "devuelta", 1, 500), C("no1", "noviembre", 1, 3000),
    C("yt1", "youtube", 1, 1400), C("yt2", "youtube", 2, 1400),
  ];
  const pagos = [
    P("p1", "full1", 3000, "2026-10-22"), P("p2", "cu1", 1000, "2026-10-23"), P("p2b", "cu2", 1000, "2026-11-23"),
    P("p3", "re0", 50, "2026-10-25"), P("p4", "do1", 500, "2026-10-24"), P("p5", "dv1", 500, "2026-10-24"),
    P("p6", "no1", 3000, "2026-11-02"), P("p7", "yt1", 1400, "2026-10-27"),
  ];
  const devoluciones = [{ id: "d1", ventaId: "devuelta", monto: 500, moneda: "USD", fecha: "2026-10-28T15:00:00.000Z", estado: "confirmada" } as Devolucion];
  const sesiones = [{ ...base.sesiones[0], id: "ses_yt", contactoId: "c_youtube", creadoEn: "2026-10-26T12:00:00.000Z", utm: { utm_source: "Landing-Organic", utm_medium: "YT" } } as Sesion];
  return { ...base, webinars: [W], productos, embudos, ventas, cuotas, pagos, devoluciones, sesiones, contactos: [], leads: [], gastos: [], adInsights: [] } as unknown as EstadoApp;
}

const A = (persona: string, dia: string, desenlace?: string, clases: AgendaParaReporte["clases"] = []): AgendaParaReporte =>
  ({ persona, agendadaEn: `${dia}T12:00:00.000Z`, desenlace, clases });

test("la facturación es lo que valen las ventas y el cash lo que entró menos lo devuelto: lo mismo que la ficha del webinar", () => {
  const e = estado();
  const hoy = reporteDelWebinar(e, W, [], "2026-12-31");
  const m = metricasDeWebinar(e, W);
  assert.equal(hoy.facturacion, m.facturado, "la facturación del reporte es la de la ficha");
  assert.equal(hoy.cash, m.cobrado, "y el cash también");
  assert.notEqual(hoy.facturacion, hoy.cash, "facturación no es cash (el error del reporte a mano)");
});

test("al corte: sólo las ventas, cobros y devoluciones hasta ese día", () => {
  const r = reporteDelWebinar(estado(), W, [], "2026-10-31");
  /* full 3000 + cuotas 3000 + reserva 3000 + down 500 + devuelta 500 + youtube 2800 (la de noviembre no) */
  assert.equal(r.facturacion, 12800);
  /* 3000 + 1000 + 50 + 500 + 500 + 1400 = 6450 entró; 500 devuelto. La 2.ª cuota del 23/11 no. */
  assert.equal(r.entro, 6450);
  assert.equal(r.cash, 5950);
  assert.deepEqual(r.devoluciones, { cantidad: 1, monto: 500 });
});

test("cierres full y en cuotas, reservas y downsell, como los cuenta Santi", () => {
  const r = reporteDelWebinar(estado(), W, [], "2026-10-31");
  assert.equal(r.cierres.ventas, 3, "full, en cuotas y la de YouTube (sigue atada: se avisa aparte)");
  assert.equal(r.cierres.full, 1);
  assert.equal(r.cierres.enCuotas, 2);
  assert.deepEqual(r.reservas, { ventas: 1, facturado: 3000, cobrado: 50 });
  assert.deepEqual(r.downsell, { ventas: 2, facturado: 1000, cobrado: 500 }, "la reembolsada se vendió, pero su cash vuelve a cero");
  assert.equal(tasasDelReporte(r).aov, (3000 + 3000 + 2800) / 3, "ticket promedio de los cierres = su facturación ÷ cierres");
});

test("avisa de la venta atada al webinar cuya llamada de cierre llegó por el VSL de YouTube", () => {
  const r = reporteDelWebinar(estado(), W, [], "2026-10-31");
  assert.deepEqual(r.deOtroOrigen.map((x) => x.venta.id), ["youtube"]);
  assert.match(r.deOtroOrigen[0].motivo, /VSL YOUTUBE/);
});

test("las agendas cuentan una vez por persona (la última) y se reparten en asistió / no vino / reagendó / canceló / pendiente", () => {
  const ag = [
    A("ana", "2026-10-21", CON_CIERRE),
    A("beto", "2026-10-21", SIN_CIERRE),
    A("caro", "2026-10-21", NO_SE_PRESENTO, ["no-vino"]),
    A("dani", "2026-10-21", undefined, ["reagendo"]), A("dani", "2026-10-25", SIN_CIERRE, ["reagendo"]),
    A("eli", "2026-10-22", undefined, ["cancelo"]),
    A("fede", "2026-10-30", undefined, ["reagendo"]),
    A("gabi", "2026-10-31"),
    A("hugo", "2026-11-03", CON_CIERRE),
  ];
  const r = reporteDelWebinar(estado(), W, ag, "2026-10-31");
  assert.deepEqual(r.agendas, { total: 7, asistieron: 3, noVinieron: 1, reagendaron: 1, cancelaron: 1, pendientes: 1 });
  const t = tasasDelReporte(r);
  assert.equal(t.showRate, (3 / 7) * 100);
  assert.equal(t.cierreSobreAsistido, (3 / 3) * 100);
});

test("el mensaje para el grupo dice facturación y cash por separado, con el corte", () => {
  const txt = textoDelReporte(reporteDelWebinar(estado(), W, [], "2026-10-31"));
  assert.match(txt, /al 31\/10/);
  assert.match(txt, /Facturación: US\$ 12\.800/);
  assert.match(txt, /Cash collected: US\$ 5\.950/);
  assert.match(txt, /Inversión total: US\$ 11\.762 \(Pauta US\$ 11\.410 \+ DM Ads US\$ 352\)/);
});

test("la ficha del webinar muestra el reporte", () => {
  assert.match(readFileSync("src/app/(app)/webinars/[id]/page.tsx", "utf8"), /<ReporteWebinar w=\{w\} \/>/);
});

test("una venta que el closer marcó «Webinar» no se ata por fecha si su último link es del VSL de YouTube", () => {
  const e = estado();
  const sinAtar = { ...e, ventas: e.ventas.map((v) => ({ ...v, webinarId: undefined })) } as EstadoApp;
  const atadas = new Set(ventasParaAtar(sinAtar).map((x) => x.venta.id));
  assert.ok(!atadas.has("youtube"), "la de YouTube queda sin webinar");
  assert.ok(atadas.has("full"), "las del webinar sí");
});

test("el estado de una cuota es uno solo para Ventas y para el Servicio", () => {
  const ahora = Date.parse("2026-11-05T12:00:00.000Z");
  const c = (monto: number, vence: string, estado: Cuota["estado"] = "pendiente") => ({ id: "x", ventaId: "v", numero: 1, monto, vence, estado, esReserva: false } as Cuota);
  const pago = (monto: number) => [{ id: "p", cuotaId: "x", monto } as Pago];
  assert.equal(cobroDeCuota(c(839, "2026-10-29T00:00:00Z"), [], ahora).estado, "vencida");
  assert.equal(cobroDeCuota(c(1000, "2026-10-29T00:00:00Z"), pago(1000), ahora).estado, "cobrada");
  assert.equal(cobroDeCuota(c(1000, "2026-12-29T00:00:00Z"), pago(400), ahora).estado, "en-parte");
  assert.equal(cobroDeCuota(c(1000, "2026-12-29T00:00:00Z"), [], ahora).estado, "pendiente");
  assert.equal(cobroDeCuota(c(1000, "2026-10-29T00:00:00Z", "cancelada"), [], ahora).estado, "cancelada");
  const tarjeta = readFileSync("src/components/ficha/TarjetaVenta.tsx", "utf8");
  assert.match(tarjeta, /cobroDeCuota\(/, "la tarjeta de la venta usa la misma regla");
});
