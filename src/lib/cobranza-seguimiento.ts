import type { Cuota, EstadoApp, EstadoSeguimientoCobro, ID, Venta } from "./types";
import { cuotasVencidas, type CuotaVencida } from "./finanzas";
import { diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   El seguimiento de las cuotas vencidas (Aldana, 28/10): «necesito que los
   closers también vean el panel de cuotas vencidas, con el teléfono del
   cliente a mano, y un estado de contactado / no responde / dar de baja por
   falta de pago que lo pueda ver yo, así sé que les están haciendo
   seguimiento. Y una vez que pague, que me aparezca como "pagó" por un día
   al menos».

   El estado vive en la cuota (`seguimientoCobro`): una cuota que se cobra
   deja de estar vencida y sale de la lista, pero durante un día más aparece
   como «Pagó» para quien la seguía.
   ================================================================== */

export const ESTADOS_SEGUIMIENTO: { id: EstadoSeguimientoCobro; texto: string; corto: string; tono: "info" | "warning" | "danger" }[] = [
  { id: "contactado", texto: "Contactado", corto: "Contactado", tono: "info" },
  { id: "no-responde", texto: "No responde", corto: "No responde", tono: "warning" },
  { id: "baja", texto: "Pido la baja por falta de pago", corto: "Pide la baja", tono: "danger" },
];
export const textoDeSeguimiento = (id: EstadoSeguimientoCobro) => ESTADOS_SEGUIMIENTO.find((x) => x.id === id)?.corto ?? id;
export const tonoDeSeguimiento = (id: EstadoSeguimientoCobro) => ESTADOS_SEGUIMIENTO.find((x) => x.id === id)?.tono ?? "info";

/* Cuánto después de cobrarse sigue apareciendo la cuota como «Pagó». */
export const HORAS_DE_PAGO_A_LA_VISTA = 36;

/** El teléfono y el país de la persona de una venta (el contacto, o el lead que todavía lo guarda). */
export function contactoDeVenta(e: Pick<EstadoApp, "leads" | "contactos">, venta: Pick<Venta, "contactoId">): { telefono?: string; pais?: string } {
  const id = venta.contactoId;
  if (!id) return {};
  const lead = e.leads.find((l) => l.id === id);
  const contacto = (e.contactos ?? []).find((c) => c.id === id || c.id === lead?.contactoId);
  const telefono = (contacto?.telefono || lead?.telefono || "").trim() || undefined;
  const pais = (contacto?.pais || lead?.pais || "").trim() || undefined;
  return { telefono, pais };
}

export interface FilaDeCobranza {
  cuota: Cuota;
  venta: Venta;
  vencida: CuotaVencida;
  telefono?: string;
  pais?: string;
}

/** Las cuotas vencidas de un closer (o de todos, sin `closerId`), las más atrasadas primero, con el teléfono de cada cliente. */
export function vencidasConSeguimiento(e: EstadoApp, closerId: ID | null, ahora = Date.now()): FilaDeCobranza[] {
  const cuotas = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const out: FilaDeCobranza[] = [];
  for (const v of cuotasVencidas(e, ahora)) {
    if (closerId && v.closerId !== closerId) continue;
    const cuota = cuotas.get(v.cuotaId), venta = ventas.get(v.ventaId);
    if (!cuota || !venta) continue;
    out.push({ cuota, venta, vencida: v, ...contactoDeVenta(e, venta) });
  }
  return out;
}

export interface FilaQuePago {
  cuota: Cuota;
  venta: Venta;
  /* Cuándo entró el último cobro (ISO) y cuántos días tarde: lo que se vio vencido y ya se cobró. */
  cobradoEn: string;
  diasTarde: number;
  telefono?: string;
  pais?: string;
}

/** Las cuotas que estaban vencidas y se cobraron hace poco (un día y medio): quien las seguía las ve como «Pagó» antes de que
 *  desaparezcan. Una cuota que se pagó en fecha no cuenta: nunca estuvo vencida. */
export function cuotasQuePagaronVencidas(e: EstadoApp, closerId: ID | null, ahora = Date.now(), horas = HORAS_DE_PAGO_A_LA_VISTA): FilaQuePago[] {
  const desde = ahora - horas * 3_600_000;
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const ultimo = new Map<ID, string>();
  const pagado = new Map<ID, number>();
  for (const p of e.pagos) {
    pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
    if (!ultimo.has(p.cuotaId) || p.fecha > ultimo.get(p.cuotaId)!) ultimo.set(p.cuotaId, p.fecha);
  }
  const out: FilaQuePago[] = [];
  for (const c of e.cuotas) {
    const cobradoEn = ultimo.get(c.id);
    if (!cobradoEn || !c.vence || c.estado === "cancelada" || Date.parse(cobradoEn) < desde || Date.parse(cobradoEn) > ahora) continue;
    if ((pagado.get(c.id) ?? 0) < c.monto - 0.01) continue;
    const dia = diaDeNegocio(cobradoEn), vence = diaDeNegocio(c.vence);
    if (dia <= vence) continue;
    const venta = ventas.get(c.ventaId);
    if (!venta || venta.estado === "cancelada") continue;
    if (closerId && (c.closerId ?? venta.closerId) !== closerId) continue;
    const diasTarde = Math.round((Date.parse(`${dia}T12:00:00Z`) - Date.parse(`${vence}T12:00:00Z`)) / 86_400_000);
    out.push({ cuota: c, venta, cobradoEn, diasTarde, ...contactoDeVenta(e, venta) });
  }
  return out.sort((a, b) => b.cobradoEn.localeCompare(a.cobradoEn));
}
