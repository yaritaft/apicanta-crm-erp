import type { EstadoApp, Gasto, GastoRecurrente, ID } from "./types";
import { normalizar } from "./gastos";

/* ==================================================================
   Gastos que se repiten todos los meses (software, abonos).

   «Fathom pagamos más o menos lo mismo todos los meses: ¿este mes fue 140?
   … que se recargue con aprobación» (Yari, reunión del 02/10). Cada gasto
   fijo tiene una plantilla; cada mes se propone con el monto del mes
   anterior y alguien lo aprueba (carga el gasto), lo corrige (aprueba con
   otro monto) o lo saltea. NADA se carga sin aprobación.

   Sin React ni base: lo usan la pantalla, el aviso del menú y las pruebas.
   Los meses van como «2026-10» y se cuentan en hora argentina.
   ================================================================== */

/* Hasta cuántos meses para atrás se sigue proponiendo lo que nadie aprobó
   ni salteó: pasado eso, se da por salteado (y no se acumula una lista eterna). */
export const MESES_ATRAS = 2;
/* Un gasto fijo que no se cargó hace más de esto ya no se repite: se dejó de pagar. */
const MESES_VIGENCIA = 6;

const HORA_AR = 3 * 3600000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const mesDe = (iso: string): string => new Date(Date.parse(iso) - HORA_AR).toISOString().slice(0, 7);
export const diaDe = (iso: string): number => Number(new Date(Date.parse(iso) - HORA_AR).toISOString().slice(8, 10));

export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const diasDelMes = (mes: string): number => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};

/** El día del gasto en ese mes (a las 12 de Argentina, como el resto de los gastos). */
export function fechaDelGastoFijo(mes: string, dia: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = Math.min(Math.max(1, Math.round(dia) || 1), diasDelMes(mes));
  return new Date(Date.UTC(a, m - 1, d, 15)).toISOString();
}

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreDelMes = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

/* ---------- Qué gasto ya es de esa plantilla ---------- */

const mismoConcepto = (g: Pick<Gasto, "concepto">, t: Pick<GastoRecurrente, "concepto">) => normalizar(g.concepto) === normalizar(t.concepto);

/** Los gastos que son de esa plantilla: los que ella cargó y los que alguien
    cargó a mano con el mismo concepto. */
export function gastosDeLaPlantilla(e: Pick<EstadoApp, "gastos">, t: GastoRecurrente): Gasto[] {
  return e.gastos.filter((g) => g.extra?.recurrenteId === t.id || mismoConcepto(g, t));
}

/** El gasto de ese mes, si ya está cargado (por la plantilla o a mano). */
export function cargadoEnElMes(e: Pick<EstadoApp, "gastos">, t: GastoRecurrente, mes: string): Gasto | undefined {
  return gastosDeLaPlantilla(e, t).find((g) => (g.extra?.recurrenteId === t.id && g.extra?.recurrenteMes === mes) || mesDe(g.fecha) === mes);
}

/** Lo del mes anterior: el último gasto de esa plantilla antes de ese mes (o
    lo habitual, si todavía no hay ninguno). */
export function montoDelMesAnterior(e: Pick<EstadoApp, "gastos">, t: GastoRecurrente, mes: string): { monto: number; mes?: string } {
  const previos = gastosDeLaPlantilla(e, t).filter((g) => mesDe(g.fecha) < mes)
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  return previos[0] ? { monto: previos[0].monto, mes: mesDe(previos[0].fecha) } : { monto: t.monto };
}

/* ---------- Lo que hay para aprobar ---------- */

export interface Propuesta {
  plantilla: GastoRecurrente;
  mes: string;
  /* El día en que se paga ese mes. */
  fecha: string;
  /* El monto del mes anterior, que es el que se propone. */
  monto: number;
  /* De qué mes sale ese monto, si salió de un gasto cargado. */
  deMes?: string;
  /* Ya le tocó pagarlo (pasó el día del mes): cuenta en el aviso. */
  leToca: boolean;
  /* De un mes anterior al actual: se quedó sin aprobar. */
  atrasada: boolean;
}

/** Lo que falta aprobar de todos los gastos fijos: este mes y los que se
    quedaron sin aprobar de los últimos meses. Del más viejo al más nuevo y,
    en el mismo mes, por día. */
export function propuestas(e: Pick<EstadoApp, "gastos" | "gastosRecurrentes">, hoyIso: string): Propuesta[] {
  const hoy = mesDe(hoyIso);
  const out: Propuesta[] = [];
  for (const t of e.gastosRecurrentes ?? []) {
    if (!t.activo) continue;
    let mes = t.desde > sumarMeses(hoy, -MESES_ATRAS) ? t.desde : sumarMeses(hoy, -MESES_ATRAS);
    for (; mes <= hoy; mes = sumarMeses(mes, 1)) {
      if (t.salteados.includes(mes) || cargadoEnElMes(e, t, mes)) continue;
      const fecha = fechaDelGastoFijo(mes, t.diaDelMes);
      const antes = montoDelMesAnterior(e, t, mes);
      out.push({ plantilla: t, mes, fecha, monto: antes.monto, deMes: antes.mes, leToca: Date.parse(fecha) <= Date.parse(hoyIso), atrasada: mes < hoy });
    }
  }
  return out.sort((a, b) => a.mes.localeCompare(b.mes) || a.plantilla.diaDelMes - b.plantilla.diaDelMes
    || a.plantilla.concepto.localeCompare(b.plantilla.concepto, "es"));
}

/** Cuántos gastos fijos ya le tocaba pagar y nadie aprobó ni salteó: el
    número del aviso en el menú. */
export const cuantosFaltan = (e: Pick<EstadoApp, "gastos" | "gastosRecurrentes">, hoyIso: string): number =>
  propuestas(e, hoyIso).filter((p) => p.leToca).length;

/* ---------- Aprobar ---------- */

/** El gasto que sale de aprobar una propuesta, con el monto que se decidió
    (el propuesto o el corregido). El id es el mismo para esa plantilla y ese
    mes: aprobarlo dos veces no lo carga dos veces. */
export function gastoAprobado(t: GastoRecurrente, mes: string, monto: number, ahora: string, por?: string): Gasto {
  return {
    id: `gas_rec_${t.id}_${mes}`.slice(0, 120),
    categoria: t.categoria,
    grupo: t.grupo,
    concepto: t.concepto,
    monto: r2(monto),
    moneda: t.moneda,
    fecha: fechaDelGastoFijo(mes, t.diaDelMes),
    webinarId: t.webinarId,
    recurrente: true,
    proveedor: t.proveedor,
    notas: undefined,
    creadoEn: ahora,
    extra: {
      recurrenteId: t.id, recurrenteMes: mes,
      ...(t.cuentaId ? { cuentaId: t.cuentaId } : {}),
      ...(por ? { aprobadoPor: por } : {}),
    },
  };
}

/* ---------- Armar las plantillas con lo que ya se cargó ---------- */

/** Las plantillas que se pueden armar con los gastos marcados «Fijo» de los
    últimos meses: una por concepto, con el monto y el día del último. Las que
    ya tienen plantilla no se repiten. Empiezan a proponerse desde el mes que
    sigue al último gasto cargado. */
export function plantillasDesdeGastos(
  e: Pick<EstadoApp, "gastos" | "gastosRecurrentes" | "ajustes">, hoyIso: string, nuevoId: () => ID,
): GastoRecurrente[] {
  const hoy = mesDe(hoyIso);
  const ya = new Set((e.gastosRecurrentes ?? []).map((t) => normalizar(t.concepto)));
  const porConcepto = new Map<string, Gasto>();
  for (const g of e.gastos) {
    if (!g.recurrente || g.extra?.traspasoId || g.extra?.liquidacionId || g.grupo === "dueno" || g.grupo === "retiro") continue;
    if (!g.concepto.trim() || !(g.monto > 0) || mesDe(g.fecha) < sumarMeses(hoy, -MESES_VIGENCIA)) continue;
    const k = normalizar(g.concepto);
    if (ya.has(k)) continue;
    const previo = porConcepto.get(k);
    if (!previo || Date.parse(g.fecha) > Date.parse(previo.fecha)) porConcepto.set(k, g);
  }
  return [...porConcepto.values()]
    .sort((a, b) => a.concepto.localeCompare(b.concepto, "es"))
    .map((g) => ({
      id: nuevoId(),
      concepto: g.concepto.trim(),
      categoria: g.categoria,
      grupo: g.grupo,
      proveedor: g.proveedor,
      monto: g.monto,
      moneda: g.moneda,
      diaDelMes: Math.min(28, Math.max(1, diaDe(g.fecha))),
      cuentaId: typeof g.extra?.cuentaId === "string" ? g.extra.cuentaId : undefined,
      webinarId: g.webinarId,
      activo: true,
      desde: sumarMeses(mesDe(g.fecha), 1),
      salteados: [],
      creadoEn: hoyIso,
    }));
}
