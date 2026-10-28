import type { EstadoApp, Gasto, ID, ResultadoLiquidacion } from "./types";
import type { RangoMes } from "./metricas";
import { gastosDelMes, esPagoDeEquipo } from "./finanzas";
import { normalizar } from "./gastos";

/* ==================================================================
   Pagos al equipo cargados como gasto: el mismo sueldo contado dos veces.

   Un sueldo o una comisión tiene dos caminos a los costos del mes: la liquidación (o las comisiones que Finanzas calcula de las ventas)
   y el pago que alguien carga a mano como gasto cuando sale la plata del banco. Si los dos suman, el costo está duplicado, el profit
   baja de más y también lo que cobran Agus y Nahue (27/10/2026: ~US$ 10.000 de diferencia con la cuenta que Aldana hizo a mano).

   Acá se reconoce qué gastos parecen el pago de alguien de la liquidación, para mostrarlos y que se marquen (esPagoDeEquipo). No se
   marca nada solo: un pago de septiembre cargado en octubre es una decisión de Finanzas, no de la app.
   ================================================================== */

/* Palabras que aparecen en los gastos de equipo y no son parte del nombre de nadie. */
const SUELTAS = new Set([
  "pago", "pagos", "sueldo", "sueldos", "editor", "editores", "filmmaker", "equipo", "salarios", "salario", "comercial", "comision",
  "comisiones", "honorarios", "servicio", "servicios", "youtube", "pendiente", "revision", "llc", "inc", "del", "los", "las",
]);
const palabras = (s: string): string[] => normalizar(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !SUELTAS.has(t));

/** «Manuel Pérez» está en «Manuel Federico Perez»; «Nacho» tiene que estar entero. */
export function coincideConNombre(texto: string, nombre: string): boolean {
  const en = new Set(palabras(texto));
  const suyas = palabras(nombre);
  if (suyas.length === 0) return false;
  return suyas.every((t) => en.has(t));
}

/* Categorías que nunca son un pago de equipo: aunque el monto coincida, es otra cosa. */
const NUNCA = new Set(["Meta Ads", "Google Ads", "TikTok Ads", "Software", "Cashback", "Mantenimiento LLC"]);

export interface PagoSospechoso {
  gasto: Gasto;
  miembroId: ID;
  nombre: string;
  /* Por qué se lo reconoce: el nombre de la persona está en el gasto, o el monto es lo que se le paga en la liquidación. */
  motivo: "nombre" | "monto";
}

/** Los gastos del período que parecen el pago de alguien de esta liquidación y todavía no están marcados. No mira los honorarios del CEO. */
export function pagosSospechosos(e: EstadoApp, r: Pick<ResultadoLiquidacion, "personas">, rango: RangoMes): PagoSospechoso[] {
  const out: PagoSospechoso[] = [];
  for (const g of gastosDelMes(e, rango)) {
    if (g.grupo === "dueno" || g.grupo === "retiro" || esPagoDeEquipo(g) || g.extra?.liquidacionId || NUNCA.has(g.categoria)) continue;
    const texto = `${g.proveedor ?? ""} ${g.concepto}`;
    const porNombre = r.personas.find((p) => coincideConNombre(texto, p.nombre));
    if (porNombre) { out.push({ gasto: g, miembroId: porNombre.miembroId, nombre: porNombre.nombre, motivo: "nombre" }); continue; }
    /* El monto es exactamente lo que se le paga a alguien: los pagos a una sociedad («Emperador Financiero LLC») no llevan su nombre. */
    const porMonto = g.monto >= 50 ? r.personas.find((p) => p.total > 0 && Math.abs(p.total - g.monto) <= 0.05) : undefined;
    if (porMonto) out.push({ gasto: g, miembroId: porMonto.miembroId, nombre: porMonto.nombre, motivo: "monto" });
  }
  return out;
}

/** La suma de los pagos de equipo ya marcados en el período (sin los honorarios del CEO). */
export function totalMarcados(e: EstadoApp, rango: RangoMes): number {
  return Math.round(gastosDelMes(e, rango).filter((g) => esPagoDeEquipo(g) && g.grupo !== "dueno").reduce((a, g) => a + g.monto, 0) * 100) / 100;
}
