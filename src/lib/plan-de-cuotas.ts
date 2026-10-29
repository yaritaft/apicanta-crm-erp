import type { Cuota, EstadoApp, ID } from "./types";
import { esIncobrable } from "./cuota-incobrable";

/* ==================================================================
   Cambiar el plan de pagos de una venta (Aldana, 28/10): «un closer avisó
   que un cliente que había dicho que pagaba en dos cuotas va a pagar en
   tres». Lo que falta cobrar se vuelve a repartir en las cuotas que se
   quieran, con sus fechas; lo ya cobrado no se toca.

   Se vuelven a repartir las cuotas pendientes SIN ningún cobro: una cuota
   cobrada en parte sigue como está (se cierra con «Dar por saldada» o con lo
   que falte). El total no cambia: el precio de la venta queda igual.
   ================================================================== */

export type Frecuencia = "mensual" | "quincenal" | "semanal";
export const FRECUENCIAS: { valor: Frecuencia; texto: string }[] = [
  { valor: "mensual", texto: "Cada mes" }, { valor: "quincenal", texto: "Cada 15 días" }, { valor: "semanal", texto: "Cada semana" },
];
/* Hasta cuántas cuotas se puede repartir lo que falta. */
export const MAX_CUOTAS = 24;

export interface CuotaDePlan { monto: number; /* aaaa-mm-dd */ vence: string }

const r2 = (n: number) => Math.round(n * 100) / 100;
const aDia = (iso?: string) => (iso ? iso.slice(0, 10) : "");

/** Las cuotas de la venta que se pueden volver a repartir: pendientes, sin cobros y que no se dieron por incobrables. */
export function cuotasARepartir(e: Pick<EstadoApp, "cuotas" | "pagos">, ventaId: ID): Cuota[] {
  const conCobro = new Set(e.pagos.map((p) => p.cuotaId));
  return e.cuotas
    .filter((c) => c.ventaId === ventaId && c.estado === "pendiente" && !esIncobrable(c) && !conCobro.has(c.id))
    .sort((a, b) => aDia(a.vence).localeCompare(aDia(b.vence)) || a.numero - b.numero);
}

/** Lo que suman esas cuotas: lo que hay que repartir. */
export const totalARepartir = (cuotas: Pick<Cuota, "monto">[]) => r2(cuotas.reduce((t, c) => t + c.monto, 0));

/** Un día más adelante: el mismo día del mes que viene (si no existe, el último), o 15 / 7 días después. */
export function sumarDias(dia: string, frecuencia: Frecuencia, pasos: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  if (frecuencia !== "mensual") {
    const f = new Date(Date.UTC(a, m - 1, d + pasos * (frecuencia === "quincenal" ? 15 : 7)));
    return f.toISOString().slice(0, 10);
  }
  const mes = m - 1 + pasos;
  const ultimo = new Date(Date.UTC(a, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, mes, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** El plan parejo: `n` cuotas que suman `total`; la última se lleva lo que sobra de redondear. */
export function repartirParejo(total: number, n: number, primera: string, frecuencia: Frecuencia): CuotaDePlan[] {
  const cuantas = Math.max(1, Math.min(MAX_CUOTAS, Math.floor(n)));
  const parte = Math.floor((total / cuantas) * 100) / 100;
  return Array.from({ length: cuantas }, (_, k) => ({
    monto: k === cuantas - 1 ? r2(total - parte * (cuantas - 1)) : parte,
    vence: sumarDias(primera, frecuencia, k),
  }));
}

/** Por qué un plan no se puede guardar, o null si está bien. */
export function problemaDelPlan(total: number, plan: CuotaDePlan[]): string | null {
  if (plan.length === 0) return "Falta al menos una cuota";
  if (plan.length > MAX_CUOTAS) return `Como mucho ${MAX_CUOTAS} cuotas`;
  if (plan.some((c) => !(c.monto > 0))) return "Todas las cuotas tienen que ser de más de cero";
  if (plan.some((c) => !/^\d{4}-\d{2}-\d{2}$/.test(c.vence))) return "Falta la fecha de alguna cuota";
  const suma = r2(plan.reduce((t, c) => t + c.monto, 0));
  if (Math.abs(suma - total) > 0.005) return `Las cuotas suman ${suma} y hay que repartir ${total}`;
  return null;
}
