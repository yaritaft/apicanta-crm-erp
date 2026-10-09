import type { EstadoApp } from "./types";
import { diaDeNegocio } from "./dia-negocio";
import { aMonedaBase } from "./gastos";

/* ==================================================================
   La salud de la carga (reunión del 07/10).

   «Ya no se está registrando más las ventas ni en el sistema viejo ni en el
   nuevo: estamos básicamente a ciegas» (reunión del 07/10). La carga se frenó
   días y nadie se enteró, porque ninguna pantalla avisaba. Esto lo dice solo,
   en el Panel, apenas pasan unos días.

   Dos señales, las dos del estado que ya tiene la app (nada nuevo que
   cargar):
   - cuántos días hace que se cargó la última venta (no cancelada);
   - cuántos cobros entraron a una pasarela y siguen sin asignar a una cuota
     pasados unos días (no cuentan como cobrado hasta que se asignan).

   Sin ninguna venta cargada (una instalación nueva, la demo) no hay nada que
   comparar y no avisa. Los días son los del negocio (Argentina), no los de UTC.
   ================================================================== */

/* Días sin una venta nueva para avisar y para alarmar. */
export const VENTA_ATENCION = 3;
export const VENTA_ALARMA = 5;
/* Días que puede esperar un cobro de pasarela antes de avisar y de alarmar. */
export const COBRO_ATENCION = 3;
export const COBRO_ALARMA = 7;

export type NivelSalud = "ok" | "atencion" | "alarma";

export interface SaludDeLaCarga {
  nivel: NivelSalud;
  /* El día del negocio con el que se contó, «2026-10-09». */
  hoy: string;
  /* La última venta cargada: su día y cuántos días pasaron. null: no hay ninguna. */
  ultimaVenta: { dia: string; dias: number } | null;
  /* Los cobros de pasarela sin asignar que ya esperan hace COBRO_ATENCION días o más. */
  sinAsignar: { n: number; monto: number; masViejoDia: string; masViejoDias: number } | null;
  /* Lo que hay que hacer, ordenado: [«cargar-ventas», «asignar-cobros»]. */
  pendientes: ("cargar-ventas" | "asignar-cobros")[];
}

/* Días de calendario entre dos días «aaaa-mm-dd» (b menos a). */
export function diasEntre(a: string, b: string): number {
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function saludDeLaCarga(e: EstadoApp, ahora: Date = new Date()): SaludDeLaCarga {
  const hoy = diaDeNegocio(ahora.toISOString());

  let ultimo = "";
  for (const v of e.ventas) {
    if (v.estado === "cancelada" || !v.fecha) continue;
    const d = diaDeNegocio(v.fecha);
    if (d > ultimo) ultimo = d;
  }
  const ultimaVenta = ultimo ? { dia: ultimo, dias: Math.max(0, diasEntre(ultimo, hoy)) } : null;

  /* Sin ventas no hay con qué comparar: ni la falta de ventas ni los cobros
     sueltos son una alarma en una app recién empezada. */
  if (!ultimaVenta) return { nivel: "ok", hoy, ultimaVenta, sinAsignar: null, pendientes: [] };

  const base = e.ajustes.monedaBase;
  const tc = e.ajustes.tipoCambio ?? 0;
  let n = 0, monto = 0, masViejoDia = "", masViejoDias = 0;
  for (const m of e.movimientos) {
    if (m.estado !== "pendiente" || !(m.monto > 0)) continue;
    const d = diaDeNegocio(m.fecha);
    const dias = diasEntre(d, hoy);
    if (dias < COBRO_ATENCION) continue;
    n++;
    monto += aMonedaBase(m.monto, m.moneda, base, tc);
    if (dias > masViejoDias) { masViejoDias = dias; masViejoDia = d; }
  }
  const sinAsignar = n > 0 ? { n, monto: Math.round(monto * 100) / 100, masViejoDia, masViejoDias } : null;

  const pendientes: SaludDeLaCarga["pendientes"] = [];
  if (ultimaVenta.dias >= VENTA_ATENCION) pendientes.push("cargar-ventas");
  if (sinAsignar) pendientes.push("asignar-cobros");

  const alarma = ultimaVenta.dias >= VENTA_ALARMA || (sinAsignar?.masViejoDias ?? 0) >= COBRO_ALARMA;
  return { nivel: alarma ? "alarma" : pendientes.length ? "atencion" : "ok", hoy, ultimaVenta, sinAsignar, pendientes };
}
