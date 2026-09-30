import type { Cuota, EstadoApp, ID, Venta } from "./types";
import { closerDeCuota } from "./finanzas";

/* ==================================================================
   Las cuotas que le quedan por cobrar a un closer, y las que heredó.

   Cuando un closer se va, sus cuotas se pasan a otro ("los closers que se
   fueron no siguen cobrando nada; lo que hacemos es pasarle las cuotas a
   otro closer y listo", Yari 29/09): desde ahí, lo que se cobre de esas
   cuotas comisiona para el que las heredó. Lo ya cobrado sigue siendo de
   quien cerró la venta. Se hace desde Equipo, en la ficha del closer.
   ================================================================== */

export interface CuotaPendiente {
  cuota: Cuota;
  venta: Venta;
  /* Lo que falta cobrar de la cuota. */
  falta: number;
}

/** Las cuotas por cobrar cuyos cobros van a comisionar para este closer. */
export function cuotasPorCobrarDe(e: Pick<EstadoApp, "cuotas" | "ventas" | "pagos">, closerId: ID): CuotaPendiente[] {
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const pagado = new Map<ID, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  const out: CuotaPendiente[] = [];
  for (const c of e.cuotas) {
    const v = ventas.get(c.ventaId);
    if (!v || v.estado === "cancelada" || c.estado === "cancelada") continue;
    if (closerDeCuota(v, c) !== closerId) continue;
    const falta = Math.round((c.monto - (pagado.get(c.id) ?? 0)) * 100) / 100;
    if (falta > 0.01) out.push({ cuota: c, venta: v, falta });
  }
  return out.sort((a, b) => (a.cuota.vence ?? "").localeCompare(b.cuota.vence ?? "") || a.venta.contactoNombre.localeCompare(b.venta.contactoNombre, "es"));
}

/** Las cuotas que este closer heredó, agrupadas por el closer de la venta. */
export function heredadasPor(e: Pick<EstadoApp, "cuotas" | "ventas">, closerId: ID): { de: ID | undefined; ids: ID[] }[] {
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const grupos = new Map<string, ID[]>();
  for (const c of e.cuotas) {
    if (c.closerId !== closerId) continue;
    const v = ventas.get(c.ventaId);
    if (!v || v.closerId === closerId) continue;
    const k = v.closerId ?? "";
    grupos.set(k, [...(grupos.get(k) ?? []), c.id]);
  }
  return [...grupos.entries()].map(([de, ids]) => ({ de: de || undefined, ids }));
}
