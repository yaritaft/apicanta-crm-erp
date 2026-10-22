import type { EstadoApp, ID, Pago } from "./types";
import { controlDeCobro } from "./control-cobros";
import { haceCuanto } from "./hace-cuanto";
import { closerDeCuota } from "./comision";

/* ==================================================================
   Un cobro rechazado, contado igual en las dos puntas.

   Aldana (22/10): rechazó un cobro del 18/10 porque lo tenía que corregir el closer,
   se lo pidió tres veces y «no sabía cuándo iba a tener tiempo». El cobro ya le
   aparecía al closer en su panel, pero sin decir quién lo rechazó, por qué ni hace
   cuánto: era un aviso más, igual a todos. Ahora lo dice todo, y Finanzas ve en el paso
   del mes que está en el panel de ese closer y desde cuándo.
   ================================================================== */

export interface RechazoDeCobro {
  /* Quién lo rechazó (el nombre si está en el equipo; si no, lo que viene antes de la @). */
  quien: string;
  /* Lo que escribió: por qué. «Sin motivo escrito» si no dijo nada. */
  nota: string;
  /* Cuándo, en la voz de la pantalla: «hace 2 días». */
  cuando: string;
  /* Cuánto lleva esperando, en horas. */
  horas: number;
}

const largo = (t: string, max = 180) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** Lo que hay que saber del rechazo de un cobro (el primero, si lo rechazaron dos casilleros). */
export function rechazoDeCobro(e: Pick<EstadoApp, "equipo">, pago: Pago, ahora: number): RechazoDeCobro {
  const r = controlDeCobro(pago).rechazos[0];
  const correo = r?.por?.trim().toLowerCase();
  const miembro = correo ? e.equipo.find((m) => m.email?.trim().toLowerCase() === correo) : undefined;
  const t = r?.en ? Date.parse(r.en) : NaN;
  const horas = Number.isFinite(t) ? Math.max(0, (ahora - t) / 3_600_000) : 0;
  return {
    quien: miembro?.nombre ?? (correo ? correo.split("@")[0].replace(/^./, (c) => c.toUpperCase()) : "Finanzas"),
    nota: largo(r?.nota?.trim() || "Sin motivo escrito"),
    cuando: haceCuanto(horas),
    horas,
  };
}

/** El renglón del paso «Arreglar los cobros rechazados»: el motivo y en el panel de qué closer está, desde cuándo. */
export function subDelRechazo(
  e: Pick<EstadoApp, "equipo" | "cuotas">, pago: Pago, ventaDeCuota: Map<ID, ID>, ventas: Map<ID, { closerId?: ID }>, ahora: number,
): string {
  const r = rechazoDeCobro(e, pago, ahora);
  const venta = ventas.get(ventaDeCuota.get(pago.cuotaId) ?? "");
  const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
  const closerId = venta ? closerDeCuota(venta, cuota) : undefined;
  const closer = closerId ? e.equipo.find((m) => m.id === closerId)?.nombre : undefined;
  return `«${r.nota}» · ${closer ? `en el panel de ${closer}, ${r.cuando}` : `no tiene closer a quien avisarle`}`;
}

/** En el panel de quién está cada cobro rechazado, para el detalle del paso: «Mariano Arias (desde hace 2 días)». Vacío si ninguno tiene closer. */
export function closersDeRechazos(
  e: Pick<EstadoApp, "equipo" | "cuotas">, pagos: Pago[], ventaDeCuota: Map<ID, ID>, ventas: Map<ID, { closerId?: ID }>, ahora: number,
): string {
  const porCloser = new Map<ID, { nombre: string; horas: number; n: number }>();
  for (const p of pagos) {
    const venta = ventas.get(ventaDeCuota.get(p.cuotaId) ?? "");
    const closerId = venta ? closerDeCuota(venta, e.cuotas.find((c) => c.id === p.cuotaId)) : undefined;
    const nombre = closerId ? e.equipo.find((m) => m.id === closerId)?.nombre : undefined;
    if (!closerId || !nombre) continue;
    const x = porCloser.get(closerId) ?? { nombre, horas: 0, n: 0 };
    x.horas = Math.max(x.horas, rechazoDeCobro(e, p, ahora).horas);
    x.n++;
    porCloser.set(closerId, x);
  }
  return [...porCloser.values()].sort((a, b) => b.horas - a.horas).map((x) => `${x.nombre} (${haceCuanto(x.horas) === "recién" ? "desde recién" : `desde ${haceCuanto(x.horas)}`})`).join(", ");
}
