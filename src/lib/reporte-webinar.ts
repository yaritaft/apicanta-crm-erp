import type { Cuota, EstadoApp, Pago, Venta, Webinar } from "./types";
import { CON_CIERRE, SIN_CIERRE } from "./estados";
import type { ClaseAgenda } from "./agendas-descarga";
import { diaDeNegocio } from "./dia-negocio";
import { metricasDeWebinar, numerosDelWebinar, plataDeVentas, ventasDelWebinar } from "./webinar";
import { embudosDeWebinar } from "./atar-webinars";
import { normalizarUtm, origenDe } from "./utms";
import { money, num, pct } from "./format";

/* ==================================================================
   El reporte del equipo de un webinar: el mensaje «MÉTRICAS TALLER 21/10
   — EQUIPO (FINAL)» que Santi armaba a mano y mandaba al grupo, armado
   por la app con los datos de la app.

   Por qué existe (04/11): del mismo Taller 21/10 Santi reportó una
   facturación de US$ 32.815 (que era lo cobrado: puso facturación = cash)
   y Agustín, sumando el CSV, sacó 40 y pico mil de cash y 60 y pico mil de
   facturación. Los dos tenían razón a su manera: cada uno hacía la cuenta
   con otra regla, a mano. Además, cinco ventas de llamadas del VSL de
   YouTube habían quedado atadas al webinar. Ahora la cuenta es una sola:

   · Facturación: lo que valen las ventas del webinar (el valor total de
     cada una: una de 3 cuotas de 1.000 factura 3.000 aunque haya pagado
     una). Igual que «Facturado» en la ficha del webinar.
   · Cash collected: lo que entró de esas ventas hasta el día de corte,
     menos lo devuelto. Igual que «Cobrado» en la ficha.
   · Las agendas: una por persona (la última que hizo), como el CSV.

   Abajo avisa de las ventas atadas al webinar cuya llamada de cierre llegó
   por el link de otra estrategia: son las que inflaban el número.
   ================================================================== */

export interface AgendaParaReporte {
  /* De quién es (su contacto o, si no tiene, la agenda): la misma persona cuenta una vez. */
  persona: string;
  agendadaEn: string;
  /* Qué le pasó (lib/agendas-descarga.ts → clasesDe) y el desenlace de su Estado de Llamada. */
  clases: ClaseAgenda[];
  desenlace?: string;
}

export interface GrupoDeVentas { ventas: number; facturado: number; cobrado: number }

export interface ReporteWebinar {
  webinar: Webinar;
  /* Hasta qué día (aaaa-mm-dd, Argentina): ventas, cobros, devoluciones y agendas hasta ese día. */
  hasta: string;
  inversion: { total: number; pauta: number; dmAds: number; whatsapp: number };
  agendas: { total: number; asistieron: number; noVinieron: number; reagendaron: number; cancelaron: number; pendientes: number };
  /* Del programa (producto principal) con algo más que la reserva: «Full» si es de un solo pago, «Cuotas» si son varias. */
  cierres: GrupoDeVentas & { full: number; enCuotas: number };
  /* Del programa, con sólo la reserva cobrada. */
  reservas: GrupoDeVentas;
  downsell: GrupoDeVentas;
  /* Upsell, eventos y lo que no es programa ni downsell. */
  otras: GrupoDeVentas;
  devoluciones: { cantidad: number; monto: number };
  facturacion: number;
  /* Lo que entró menos lo devuelto (el Cash Collected). */
  cash: number;
  /* Lo que entró, sin restar lo devuelto. */
  entro: number;
  /* Ventas atadas al webinar que por su llamada de cierre (o su estrategia) son de otro embudo: para revisar. */
  deOtroOrigen: { venta: Venta; motivo: string }[];
}

/* Cómo se pagó: sólo la reserva, o el programa (en un pago o en cuotas). */
function comoSePago(cuotas: readonly Cuota[], pagos: readonly Pago[]): "reserva" | "full" | "cuotas" {
  const delPlan = cuotas.filter((c) => !c.esReserva && c.estado !== "cancelada");
  const cuotaDe = new Map(cuotas.map((c) => [c.id, c] as const));
  const pagoAlgoDelPlan = pagos.some((p) => !cuotaDe.get(p.cuotaId)?.esReserva);
  const pagoLaReserva = pagos.some((p) => cuotaDe.get(p.cuotaId)?.esReserva);
  if ((pagoLaReserva && !pagoAlgoDelPlan) || (delPlan.length === 0 && cuotas.length > 0)) return "reserva";
  return delPlan.length > 1 ? "cuotas" : "full";
}

/** Por qué una venta del webinar parece de otro embudo, o undefined si es del webinar. */
function otroOrigen(e: EstadoApp, v: Venta, deWebinar: Set<string>, sesiones: Map<string, EstadoApp["sesiones"][number]>): string | undefined {
  if (v.embudoId && !deWebinar.has(v.embudoId)) {
    return `su estrategia es ${e.embudos.find((x) => x.id === v.embudoId)?.nombre ?? "otra"}`;
  }
  const s = v.sesionId ? sesiones.get(v.sesionId) : undefined;
  if (!s?.utm) return undefined;
  const o = origenDe(e, normalizarUtm(s.utm), s.creadoEn);
  if (o?.embudoId && !deWebinar.has(o.embudoId)) {
    return `la llamada de cierre llegó por el link de ${e.embudos.find((x) => x.id === o.embudoId)?.nombre ?? "otra estrategia"}`;
  }
  return undefined;
}

export function reporteDelWebinar(e: EstadoApp, w: Webinar, agendas: readonly AgendaParaReporte[], hasta = diaDeNegocio(new Date().toISOString())): ReporteWebinar {
  const n = numerosDelWebinar(e, w);
  const inversion = { total: metricasDeWebinar(e, w).inversionTotal, pauta: n.inversion, dmAds: n.inversionDmAds, whatsapp: n.costoWhatsappApi };

  /* ---------- Las agendas: una por persona, la última hasta el corte ---------- */
  const ultima = new Map<string, AgendaParaReporte>();
  for (const a of agendas) {
    if (diaDeNegocio(a.agendadaEn) > hasta) continue;
    const antes = ultima.get(a.persona);
    if (!antes || a.agendadaEn >= antes.agendadaEn) ultima.set(a.persona, a);
  }
  const ag = { total: 0, asistieron: 0, noVinieron: 0, reagendaron: 0, cancelaron: 0, pendientes: 0 };
  for (const a of ultima.values()) {
    ag.total++;
    if (a.desenlace === CON_CIERRE || a.desenlace === SIN_CIERRE) ag.asistieron++;
    else if (a.clases.includes("no-vino")) ag.noVinieron++;
    else if (a.clases.includes("cancelo")) ag.cancelaron++;
    else if (a.clases.includes("reagendo")) ag.reagendaron++;
    else ag.pendientes++;
  }

  /* ---------- La plata: la misma cuenta que la ficha del webinar ---------- */
  const ventas = ventasDelWebinar(e, w.id, hasta);
  const plata = plataDeVentas(e, ventas, hasta);
  const tipoDe = new Map(e.productos.map((p) => [p.id, p.tipo] as const));
  const cuotasDe = new Map<string, Cuota[]>();
  for (const c of plata.cuotaDe.values()) cuotasDe.set(c.ventaId, [...(cuotasDe.get(c.ventaId) ?? []), c]);
  const pagosDe = new Map<string, Pago[]>();
  for (const p of plata.pagos) {
    const vId = plata.cuotaDe.get(p.cuotaId)?.ventaId;
    if (vId) pagosDe.set(vId, [...(pagosDe.get(vId) ?? []), p]);
  }
  const devueltoDe = new Map<string, number>();
  for (const d of plata.devoluciones) if (d.ventaId) devueltoDe.set(d.ventaId, (devueltoDe.get(d.ventaId) ?? 0) + d.monto);

  const vacio = (): GrupoDeVentas => ({ ventas: 0, facturado: 0, cobrado: 0 });
  const cierres = { ...vacio(), full: 0, enCuotas: 0 };
  const reservas = vacio(), downsell = vacio(), otras = vacio();
  for (const v of ventas) {
    const pagos = pagosDe.get(v.id) ?? [];
    const cobrado = pagos.reduce((a, p) => a + p.monto, 0) - (devueltoDe.get(v.id) ?? 0);
    const tipo = v.productoId ? tipoDe.get(v.productoId) : undefined;
    let g: GrupoDeVentas;
    if (tipo === "downsell") g = downsell;
    else if (tipo !== "principal") g = otras;
    else {
      const como = comoSePago(cuotasDe.get(v.id) ?? [], pagos);
      if (como === "reserva") g = reservas;
      else { g = cierres; if (como === "full") cierres.full++; else cierres.enCuotas++; }
    }
    g.ventas++;
    g.facturado += v.precioAcordado;
    g.cobrado += cobrado;
  }

  const deWebinar = embudosDeWebinar(e);
  const sesiones = new Map(e.sesiones.map((s) => [s.id, s] as const));
  const deOtroOrigen = e.ventas
    .filter((v) => v.webinarId === w.id && v.estado !== "cancelada")
    .flatMap((v) => { const motivo = otroOrigen(e, v, deWebinar, sesiones); return motivo ? [{ venta: v, motivo }] : []; });

  return {
    webinar: w, hasta, inversion, agendas: ag, cierres, reservas, downsell, otras,
    devoluciones: { cantidad: plata.devoluciones.length, monto: plata.devuelto },
    facturacion: plata.facturado, cash: plata.cobrado, entro: plata.entro, deOtroOrigen,
  };
}

/* ---------- Las tasas: cada una con su cuenta, para el mensaje y para la pantalla ---------- */

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function tasasDelReporte(r: ReporteWebinar) {
  const a = r.agendas;
  return {
    showRate: div(a.asistieron, a.total) * 100,
    noShow: div(a.noVinieron, a.total) * 100,
    reagenda: div(a.reagendaron, a.total) * 100,
    cancelacion: div(a.cancelaron, a.total) * 100,
    cierreSobreAgenda: div(r.cierres.ventas, a.total) * 100,
    cierreSobreAsistido: div(r.cierres.ventas, a.asistieron) * 100,
    cashPorAgenda: div(r.cash, a.total),
    cashPorLlamada: div(r.cash, a.asistieron),
    /* Ticket promedio de los cierres: lo que vale, en promedio, una venta del programa. */
    aov: div(r.cierres.facturado, r.cierres.ventas),
    roasCash: div(r.cash, r.inversion.total),
  };
}

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** El mensaje para el grupo, con el formato del que mandaba Santi. */
export function textoDelReporte(r: ReporteWebinar): string {
  const t = tasasDelReporte(r);
  const M = (x: number, d = 0) => money(x, "USD", d);
  const a = r.agendas;
  const partes = [
    `Pauta ${M(r.inversion.pauta)}`,
    r.inversion.dmAds ? `DM Ads ${M(r.inversion.dmAds)}` : "",
    r.inversion.whatsapp ? `WhatsApp API ${M(r.inversion.whatsapp)}` : "",
  ].filter(Boolean).join(" + ");
  const lineas = [
    `MÉTRICAS ${r.webinar.titulo.toUpperCase()} — al ${dm(r.hasta)} (sale de la app)`,
    "",
    `Inversión total: ${M(r.inversion.total)} (${partes})`,
    "",
    `Agendas: ${num(a.total)}${a.pendientes ? ` (${num(a.pendientes)} todavía sin hacer o sin cargar)` : ""}`,
    `Asistieron: ${num(a.asistieron)}`,
    `% Show rate: ${pct(t.showRate)}`,
    `% No show: ${pct(t.noShow)} (${num(a.noVinieron)})`,
    `% Reagendaron: ${pct(t.reagenda)} (${num(a.reagendaron)})`,
    `% Cancelaron: ${pct(t.cancelacion)} (${num(a.cancelaron)})`,
    "",
    `Cierres: ${num(r.cierres.ventas)} (${num(r.cierres.full)} full + ${num(r.cierres.enCuotas)} en cuotas)`,
    `Reservas: ${num(r.reservas.ventas)} (${M(r.reservas.cobrado)} cobrado)`,
    `Downsell: ${num(r.downsell.ventas)} (${M(r.downsell.cobrado)} cobrado)`,
    ...(r.otras.ventas ? [`Otras ventas: ${num(r.otras.ventas)} (${M(r.otras.cobrado)} cobrado)`] : []),
    `Devoluciones: ${num(r.devoluciones.cantidad)}${r.devoluciones.cantidad ? ` (${M(r.devoluciones.monto)})` : ""}`,
    `% Cierre sobre agenda: ${pct(t.cierreSobreAgenda)}`,
    `% Cierre sobre asistido: ${pct(t.cierreSobreAsistido)}`,
    "",
    `Facturación: ${M(r.facturacion)} (lo que valen todas las ventas)`,
    `Cash collected: ${M(r.cash)} (lo que ya entró${r.devoluciones.monto ? ", menos devoluciones" : ""})`,
    `· de los cierres: ${M(r.cierres.cobrado)}`,
    `Cash por agenda: ${M(t.cashPorAgenda, 2)}`,
    `Cash por llamada tomada: ${M(t.cashPorLlamada, 2)}`,
    `Ticket promedio de los cierres (AOV): ${M(t.aov, 2)}`,
    ...(r.inversion.total ? [`ROAS sobre cash: ${num(t.roasCash, 2)}x`] : []),
  ];
  return lineas.join("\n");
}
