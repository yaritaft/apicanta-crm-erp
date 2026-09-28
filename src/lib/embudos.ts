import type { EstadoApp, ID, Venta } from "./types";
import type { RangoMes } from "./metricas";
import { comisionesDelMes, pagosDelMes, ventasContablesDelMes, ventasDelMes } from "./finanzas";
import { metricasDeWebinar } from "./webinar";
import { slugUtm } from "./utm-estandar";

/* ==================================================================
   El resultado de cada embudo: CAC, ROAS y profit por embudo.

   "Me interesa saber el CAC general y el CAC por embudo" (Yari). La plata
   de un embudo es la de sus ventas (su "Estrategia utilizada"); lo que se
   invirtió en él sale de:

   - El embudo de webinar: la inversión de los webinars del período (pauta,
     DM Ads y WhatsApp API, cargada o de Meta), como en la planilla.
   - Los demás: las campañas de Meta cuyo nombre dice el embudo ("VSL
     Martin", "Setter"), día por día.
   - En todos, los gastos de Finanzas que se etiquetaron con ese embudo.

   Los gastos fijos no se reparten entre embudos: son de la empresa.
   ================================================================== */

const enRango = (iso: string, m: RangoMes) => {
  const t = new Date(iso).getTime();
  return t >= m.desde.getTime() && t <= m.hasta.getTime();
};

/** El embudo de un gasto (se elige al cargarlo; vive en `extra`). */
export const embudoDeGasto = (g: { extra?: Record<string, unknown> }): ID | undefined =>
  (typeof g.extra?.embudoId === "string" && g.extra.embudoId) || undefined;

export function esEmbudoWebinar(e: EstadoApp, embudoId: ID): boolean {
  const x = e.embudos.find((b) => b.id === embudoId);
  if (!x) return false;
  return e.embudos.some((b) => b.esWebinar) ? Boolean(x.esWebinar) : /webinar|lanzamiento/i.test(x.nombre);
}

/** El embudo (que no es el de webinar) de una campaña de Meta, por su nombre:
 *  el embudo cuyo nombre aparece en el de la campaña; si calzan dos, el más largo. */
export function embudoDeCampania(e: EstadoApp, nombre: string): ID | undefined {
  const n = slugUtm(nombre);
  if (/webinar/.test(n) || /(^|-)dm(-|$)/.test(n)) return undefined;
  let mejor: { id: ID; largo: number } | undefined;
  for (const b of e.embudos) {
    const s = slugUtm(b.nombre);
    if (s.length < 3 || esEmbudoWebinar(e, b.id)) continue;
    if (n.includes(s) && (!mejor || s.length > mejor.largo)) mejor = { id: b.id, largo: s.length };
  }
  return mejor?.id;
}

/** Lo que se invirtió en un embudo en el período. */
export function inversionDelEmbudo(e: EstadoApp, embudoId: ID, m: RangoMes): number {
  let total = 0;
  if (esEmbudoWebinar(e, embudoId)) {
    for (const w of e.webinars) if (enRango(w.fecha, m)) total += metricasDeWebinar(e, w).inversionTotal;
  } else if (e.adInsights?.length) {
    const campania = new Map((e.campaigns ?? []).map((c) => [c.id, c.nombre] as const));
    const deEmbudo = new Map<ID, boolean>();
    for (const a of e.ads ?? []) deEmbudo.set(a.id, embudoDeCampania(e, campania.get(a.campaignId) ?? "") === embudoId);
    const desde = isoDia(m.desde), hasta = isoDia(m.hasta);
    for (const i of e.adInsights) if (deEmbudo.get(i.adId) && i.dia >= desde && i.dia <= hasta) total += i.inversion;
  }
  for (const g of e.gastos) if (embudoDeGasto(g) === embudoId && enRango(g.fecha, m)) total += g.monto;
  return Math.round(total * 100) / 100;
}

const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ResultadoEmbudo {
  embudoId?: ID;
  nombre: string;
  ventas: number;
  facturado: number;
  cobrado: number;
  procesador: number;
  comisiones: number;
  inversion: number;
  cac: number | null;
  roasCC: number | null;
  roasRev: number | null;
  /* Lo cobrado (o facturado) menos procesador, comisiones e inversión. */
  profitCC: number;
  profitRev: number;
}

/** Una fila por embudo con ventas, cobros o inversión en el período. */
export function resultadoPorEmbudo(e: EstadoApp, m: RangoMes): ResultadoEmbudo[] {
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const ventaPorId = new Map(e.ventas.map((v) => [v.id, v] as const));
  const filas = new Map<string, ResultadoEmbudo>();
  const fila = (embudoId: ID | undefined): ResultadoEmbudo => {
    const clave = embudoId ?? "";
    let f = filas.get(clave);
    if (!f) {
      f = {
        embudoId, nombre: e.embudos.find((b) => b.id === embudoId)?.nombre ?? "Sin estrategia",
        ventas: 0, facturado: 0, cobrado: 0, procesador: 0, comisiones: 0, inversion: 0,
        cac: null, roasCC: null, roasRev: null, profitCC: 0, profitRev: 0,
      };
      filas.set(clave, f);
    }
    return f;
  };
  const embudoDe = (v?: Venta) => (v?.embudoId && e.embudos.some((b) => b.id === v.embudoId) ? v.embudoId : undefined);

  /* Una reserva sola no es una venta (ventasContablesDelMes): no suma al
     conteo ni baja el CAC, pero su plata sí entra en lo facturado. */
  const contables = new Set(ventasContablesDelMes(e, m).map((v) => v.id));
  for (const v of ventasDelMes(e, m)) {
    const f = fila(embudoDe(v));
    if (contables.has(v.id)) f.ventas++;
    f.facturado += v.precioAcordado;
  }
  for (const p of pagosDelMes(e, m)) {
    const f = fila(embudoDe(ventaPorId.get(ventaDeCuota.get(p.cuotaId) ?? "")));
    f.cobrado += p.monto; f.procesador += p.feeMonto;
  }
  for (const c of comisionesDelMes(e, m)) fila(embudoDe(ventaPorId.get(c.ventaId))).comisiones += c.comisionCloser + c.comisionDirector;
  for (const b of e.embudos) {
    const inv = inversionDelEmbudo(e, b.id, m);
    if (inv > 0) fila(b.id).inversion = inv;
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...filas.values()].map((f) => {
    const costos = f.procesador + f.comisiones + f.inversion;
    return {
      ...f,
      facturado: r2(f.facturado), cobrado: r2(f.cobrado), procesador: r2(f.procesador), comisiones: r2(f.comisiones),
      cac: f.inversion > 0 && f.ventas > 0 ? f.inversion / f.ventas : null,
      roasCC: f.inversion > 0 ? f.cobrado / f.inversion : null,
      roasRev: f.inversion > 0 ? f.facturado / f.inversion : null,
      profitCC: r2(f.cobrado - costos),
      profitRev: r2(f.facturado - costos),
    };
  }).sort((a, b) => b.cobrado - a.cobrado || b.facturado - a.facturado);
}
