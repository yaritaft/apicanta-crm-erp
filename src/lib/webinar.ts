import type { EstadoApp, Webinar } from "./types";

/* ==================================================================
   Las métricas que Yari viene trackeando webinar a webinar desde 2023.
   Los nombres son los suyos: así puede comparar con su planilla.
   ================================================================== */

export interface MetricasWebinar {
  /* Inversión */
  inversionTotal: number;      // pauta + DM Ads + WhatsApp API
  /* Embudo */
  formularios: number;
  grupoWpp: number;
  asistentes: number;
  llamadas: number;
  llamadasCalificadas: number;
  ventas: number;
  /* Costos unitarios */
  cplFormulario: number;
  cplGrupo: number;
  cpLlamada: number;
  cpLlamadaCalificada: number;
  cpa: number;                 // costo por adquisición
  /* Conversiones */
  asistenciaFormulario: number; // grupo / formularios
  asistenciaTaller: number;     // asistentes / grupo
  porcentajeAgenda: number;     // llamadas / grupo
  agendaSobreAsisten: number;   // llamadas / asistentes
  convLeadVenta: number;        // ventas / grupo
  tasaCierre: number;           // ventas / llamadas calificadas
  /* Plata */
  facturado: number;
  cobrado: number;
  comisiones: number;
  roasRev: number;
  roasCC: number;
  beneficioRev: number;
  beneficioCC: number;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const pctDiv = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export function metricasDeWebinar(e: EstadoApp, w: Webinar): MetricasWebinar {
  const inversionTotal = w.inversion + w.inversionDmAds + w.costoWhatsappApi;
  const llamadas = w.llamadasVivo + w.llamadasPosterior;

  const ventas = e.ventas.filter((v) => v.webinarId === w.id && v.estado !== "cancelada");
  const facturado = ventas.reduce((a, v) => a + v.precioAcordado, 0);

  const cuotaIds = e.cuotas.filter((c) => ventas.some((v) => v.id === c.ventaId)).map((c) => c.id);
  const pagos = e.pagos.filter((p) => cuotaIds.includes(p.cuotaId));
  const cobrado = pagos.reduce((a, p) => a + p.monto, 0);
  const fees = pagos.reduce((a, p) => a + p.feeMonto, 0);

  /* Comisiones: closer + director sobre el neto de procesador,
     salvo que la venta la haya cerrado Yari. */
  let comisiones = 0;
  for (const v of ventas) {
    const closer = e.equipo.find((x) => x.id === v.closerId);
    if (closer?.sinComision) continue;
    const ids = e.cuotas.filter((c) => c.ventaId === v.id).map((c) => c.id);
    const neto = e.pagos.filter((p) => ids.includes(p.cuotaId)).reduce((a, p) => a + (p.monto - p.feeMonto), 0);
    const director = e.equipo.find((x) => x.id === v.directorId);
    comisiones += neto * ((closer?.comisionRate ?? 0) + (director?.comisionRate ?? 0));
  }

  /* Profit del webinar = plata − (pauta + DM + WAPI) − comisiones − procesador */
  const descuentos = inversionTotal + comisiones + fees;

  return {
    inversionTotal,
    formularios: w.formularios,
    grupoWpp: w.grupoWpp,
    asistentes: w.asistentes,
    llamadas,
    llamadasCalificadas: w.llamadasCalificadas,
    ventas: ventas.length,

    cplFormulario: div(inversionTotal, w.formularios),
    cplGrupo: div(inversionTotal, w.grupoWpp),
    cpLlamada: div(inversionTotal, llamadas),
    cpLlamadaCalificada: div(inversionTotal, w.llamadasCalificadas),
    cpa: div(inversionTotal, ventas.length),

    asistenciaFormulario: pctDiv(w.grupoWpp, w.formularios),
    asistenciaTaller: pctDiv(w.asistentes, w.grupoWpp),
    porcentajeAgenda: pctDiv(llamadas, w.grupoWpp),
    agendaSobreAsisten: pctDiv(llamadas, w.asistentes),
    convLeadVenta: pctDiv(ventas.length, w.grupoWpp),
    tasaCierre: pctDiv(ventas.length, w.llamadasCalificadas),

    facturado,
    cobrado,
    comisiones,
    roasRev: div(facturado, inversionTotal),
    roasCC: div(cobrado, inversionTotal),
    beneficioRev: facturado - descuentos,
    beneficioCC: cobrado - descuentos,
  };
}

/** Todos los webinars ya pasados, del más viejo al más nuevo, con sus métricas. */
export function serieDeWebinars(e: EstadoApp) {
  return e.webinars
    .filter((w) => w.estado === "finalizado")
    .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))
    .map((w) => ({ webinar: w, m: metricasDeWebinar(e, w) }));
}
