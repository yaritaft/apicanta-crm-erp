import type { EstadoApp, Gasto, ID, Liquidacion, PagoLiquidacion, PersonaLiquidada, ResultadoLiquidacion } from "./types";
import { gastosDelMes, esPagoDeEquipo } from "./finanzas";
import { rangoDePeriodo } from "./periodos";
import { fechaDePago, normalizar } from "./gastos";
import { coincideConNombre } from "./pagos-equipo";
import { candidatosDePago, candidatosElegidos } from "./pagos-liquidacion";

/* ==================================================================
   Los meses que se pagaron por fuera de la app.

   Julio, agosto y septiembre de 2026 se liquidaron y pagaron con la planilla de Angelo (Finance CFO: hojas Payroll y Transacciones). La
   app los recalculaba con las reglas y los datos de hoy —reglas que cambiaron después, comisiones de procesador reales en vez de las de su
   planilla, cuotas que pasaron de un closer a otro— y mostraba eso como si fuera lo que había que pagar: a alguien le daba la cuarta parte
   de lo que se le pagó, y septiembre se cerró con esos números (Aldana, 23/11).

   Lo pagado se carga en la liquidación (Liquidacion.porFuera, lib/honorarios.ts) y manda sobre la cuenta. Acá vive lo que pasa al cerrar
   un mes así:
   - quien tiene lo pagado cargado queda marcado como pagado («por fuera»: la caja no tiene nada que registrar);
   - los gastos ya cargados que eran esos mismos pagos se enlazan y se marcan como pago al equipo, si no al cerrar el mismo sueldo entra
     dos veces a los costos: los resúmenes del mes (el renglón «Equipo / Salarios» de la planilla vieja, el del setter y el del director,
     o un gasto fijo de sueldos sin nombre) y la transferencia de cada uno cargada como gasto cerca del día que se le pagó (los editores
     de agosto se cargaron en septiembre, el día que salió la plata). Los resúmenes de edición y filmmaker de la planilla vieja no: los
     cargó en el mes en que se pagaron, que es el trabajo del mes anterior, y no son estos pagos.
   ================================================================== */

/* El origen que puso el importador de la hoja Gastos_vieja (2026-09-27). */
export const ORIGEN_PLANILLA_VIEJA = "planilla-angelo";

/* Lo que la planilla vieja resumía por mes y la liquidación ahora tiene persona por persona. */
export const CATEGORIAS_RESUMIDAS = new Set(["Equipo / Salarios", "Setters", "Comisiones Director de Ventas"]);

/** Si la liquidación tiene cargado lo que se le pagó a alguien por fuera de la app. */
export function tienePagadoPorFuera(liq: Pick<Liquidacion, "porFuera"> | null | undefined): boolean {
  return Object.keys(liq?.porFuera?.personas ?? {}).length > 0;
}

export interface PagoYaCargado {
  gasto: Gasto;
  /* «resumen»: el renglón del mes de la planilla vieja o un gasto fijo de sueldos («Equipo / Salarios (No comercial)»), que la
     liquidación ahora tiene persona por persona. «pago»: la transferencia a una persona, cargada como gasto (casi siempre en el mes
     siguiente, el día que salió la plata). */
  motivo: "resumen" | "pago";
  miembroId?: ID;
  nombre?: string;
  /* Ya estaba marcado como pago al equipo: se enlaza pero no se toca (reabrir no lo desmarca). */
  yaMarcado: boolean;
}

/* Hasta cuántos días del día que se pagó se busca la transferencia cargada como gasto. */
const VENTANA_DEL_PAGO = 7 * 86400000;

/** Los gastos ya cargados que son los mismos pagos que esta liquidación con lo pagado por fuera: al cerrar se enlazan y se marcan
 *  como pago al equipo, para que el mismo sueldo no cuente dos veces (sólo en una liquidación con lo pagado cargado). */
export function pagosYaCargados(
  e: Pick<EstadoApp, "gastos" | "liquidaciones">, liq: Pick<Liquidacion, "id" | "periodo" | "porFuera">, r: Pick<ResultadoLiquidacion, "personas">,
): PagoYaCargado[] {
  if (!tienePagadoPorFuera(liq)) return [];
  const out: PagoYaCargado[] = [];
  const usados = new Set<ID>();
  /* Los resúmenes del mes: la planilla vieja (sueldos, setter, director) y los gastos fijos de sueldos sin nombre de nadie. */
  for (const g of gastosDelMes(e as EstadoApp, rangoDePeriodo(liq.periodo))) {
    if (g.grupo === "dueno" || g.extra?.liquidacionId === liq.id || !CATEGORIAS_RESUMIDAS.has(g.categoria)) continue;
    const dePlanilla = g.extra?.origen === ORIGEN_PLANILLA_VIEJA;
    const fijoDeSueldos = g.categoria === "Equipo / Salarios" && typeof g.extra?.recurrenteId === "string"
      && !r.personas.some((p) => coincideConNombre(`${g.proveedor ?? ""} ${g.concepto}`, p.nombre));
    if (!dePlanilla && !fijoDeSueldos) continue;
    if (esPagoDeEquipo(g)) continue;
    out.push({ gasto: g, motivo: "resumen", yaMarcado: false });
    usados.add(g.id);
  }
  /* La transferencia de cada uno, cerca del día que se le pagó: la misma búsqueda que «Marcar como pagado» (por nombre o monto). */
  const pagados = liq.porFuera?.personas ?? {};
  for (const p of r.personas) {
    const x = pagados[p.miembroId];
    if (!x || !(p.total > 0) || !x.fecha || !/^\d{4}-\d{2}-\d{2}/.test(x.fecha)) continue;
    const dia = Date.parse(mediodia(x.fecha));
    const cerca = candidatosDePago(e, liq, p).filter((c) => !usados.has(c.gasto.id) && Math.abs(Date.parse(fechaDePago(c.gasto)) - dia) <= VENTANA_DEL_PAGO);
    for (const id of candidatosElegidos(cerca, p.total)) {
      const c = cerca.find((y) => y.gasto.id === id)!;
      out.push({ gasto: c.gasto, motivo: "pago", miembroId: p.miembroId, nombre: p.nombre, yaMarcado: c.yaMarcado });
      usados.add(id);
    }
  }
  return out;
}

/* El día que salió la plata, a mediodía de Argentina (así cae en ese día con cualquier huso). */
const mediodia = (dia: string) => `${dia.slice(0, 10)}T15:00:00.000Z`;

/** Al cerrar: a quién se marca pagado (por fuera, con sus transferencias ya cargadas enlazadas) y qué gastos se marcan como pago al
 *  equipo (los que todavía no lo estaban: son los que reabrir desmarca). */
export function cierrePorFuera(
  e: Pick<EstadoApp, "gastos" | "liquidaciones">, liq: Liquidacion, r: Pick<ResultadoLiquidacion, "personas">, cuando: string,
): { pagos: Record<ID, PagoLiquidacion>; marcar: ID[] } {
  const pagados = liq.porFuera?.personas ?? {};
  const ya = pagosYaCargados(e, liq, r);
  const pagos: Record<ID, PagoLiquidacion> = { ...(liq.pagos ?? {}) };
  for (const p of r.personas) {
    const x = pagados[p.miembroId];
    if (!x || !(p.total > 0) || pagos[p.miembroId]) continue;
    const suyos = ya.filter((y) => y.motivo === "pago" && y.miembroId === p.miembroId);
    pagos[p.miembroId] = {
      pagadoEn: x.fecha && /^\d{4}-\d{2}-\d{2}/.test(x.fecha) ? mediodia(x.fecha) : cuando, por: "Por fuera de la app", fuera: true,
      ...(suyos.length ? { gastoIds: suyos.map((y) => y.gasto.id), marcados: suyos.filter((y) => !y.yaMarcado).map((y) => y.gasto.id) } : {}),
    };
  }
  return { pagos, marcar: ya.filter((y) => !y.yaMarcado).map((y) => y.gasto.id) };
}

/* ---------- Pegar lo pagado de una planilla ----------
   Para cargar un mes entero de una vez: se copian de la planilla (el Payroll de Angelo, un Excel) las columnas nombre y monto —y, si
   está, la fecha— y se pegan. Cada renglón se busca en el equipo por el nombre. */

export interface FilaPegada {
  texto: string;
  miembroId?: ID;
  nombre?: string;
  monto?: number;
  fecha?: string;
  /* Por qué no se puede usar el renglón. */
  problema?: string;
}

/* «3.200», «3,200.00», «US$ 7.450,25», «7450.25» → número. */
export function leerMontoPegado(s: string): number | undefined {
  let t = s.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return undefined;
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  if (coma > -1 && punto > -1) {
    /* El último separador es el decimal. */
    t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (coma > -1) {
    /* «7450,25» decimal; «3,200» miles. */
    t = /,\d{3}$/.test(t) && t.split(",").length === 2 && t.length > 4 ? t.replace(",", "") : t.replace(",", ".");
  } else if (punto > -1 && /\.\d{3}$/.test(t) && t.split(".").length === 2) {
    /* «3.200» es miles (nadie paga 3 dólares con 200 milésimos). */
    t = t.replace(".", "");
  } else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/* «4/9/2026», «04/09/2026», «2026-09-04» → «2026-09-04». */
export function leerFechaPegada(s: string): string | undefined {
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (dmy) {
    const a = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${a}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return undefined;
}

const palabras = (s: string) => normalizar(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

/** A quién del equipo se refiere un nombre de la planilla: el que comparte más palabras (todas las del nombre corto, o dos). */
export function quienEs(nombre: string, equipo: readonly { id: ID; nombre: string }[]): { id: ID; nombre: string } | undefined {
  const suyas = new Set(palabras(nombre));
  let mejor: { id: ID; nombre: string; n: number } | undefined;
  let empate = false;
  for (const m of equipo) {
    const del = palabras(m.nombre);
    if (!del.length) continue;
    const n = del.filter((t) => suyas.has(t)).length;
    /* Un nombre de una palabra tiene que estar entero; «Ana Gómez» alcanza con las dos en «Ana María Gómez Ruiz». */
    const alcanza = n === del.length || n >= 2;
    if (!alcanza) continue;
    if (!mejor || n > mejor.n) { mejor = { ...m, n }; empate = false; }
    else if (n === mejor.n) empate = true;
  }
  return mejor && !empate ? { id: mejor.id, nombre: mejor.nombre } : undefined;
}

/** Lee lo pegado: un renglón por persona, con el nombre, el monto y (si está) la fecha, separados por tabulaciones o «;». */
export function leerPagosPegados(texto: string, equipo: readonly { id: ID; nombre: string }[]): FilaPegada[] {
  const filas: FilaPegada[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t) continue;
    const celdas = t.split(/\t|;/).map((c) => c.trim()).filter(Boolean);
    const nombre = celdas.find((c) => /[a-záéíóúñ]{3,}/i.test(c) && !leerFechaPegada(c)) ?? "";
    const fecha = celdas.map(leerFechaPegada).find(Boolean);
    /* El monto: la última celda que es sólo un número (la del total, si se copian varias columnas). */
    const montos = celdas.filter((c) => c !== nombre && !leerFechaPegada(c) && /^[\sUS$€]*-?[\d.,]+\s*$/.test(c)).map(leerMontoPegado).filter((n): n is number => n !== undefined);
    const monto = montos.length ? montos[montos.length - 1] : undefined;
    const m = nombre ? quienEs(nombre, equipo) : undefined;
    filas.push({
      texto: t, ...(m ? { miembroId: m.id, nombre: m.nombre } : {}), ...(monto !== undefined ? { monto } : {}), ...(fecha ? { fecha } : {}),
      ...(!nombre ? { problema: "No tiene un nombre." } : !m ? { problema: `No encontré a «${nombre}» en el equipo.` } : monto === undefined ? { problema: "No tiene un monto." } : {}),
    });
  }
  /* La misma persona dos veces (sueldo y bono en renglones distintos): se suman. */
  const porPersona = new Map<ID, FilaPegada>();
  const out: FilaPegada[] = [];
  for (const f of filas) {
    if (f.problema || !f.miembroId) { out.push(f); continue; }
    const antes = porPersona.get(f.miembroId);
    if (antes) {
      antes.monto = Math.round(((antes.monto ?? 0) + (f.monto ?? 0)) * 100) / 100;
      antes.texto = `${antes.texto}\n${f.texto}`;
      if (!antes.fecha && f.fecha) antes.fecha = f.fecha;
      continue;
    }
    const copia = { ...f };
    porPersona.set(f.miembroId, copia);
    out.push(copia);
  }
  return out;
}

/** Cuánto más (o menos) se pagó que lo que da la cuenta, sumado entre quienes tienen lo pagado cargado. */
export function diferenciaConLaCuenta(personas: readonly PersonaLiquidada[]): number {
  return Math.round(personas.reduce((a, p) => a + (p.pagadoPorFuera ? p.pagadoPorFuera.monto - p.pagadoPorFuera.cuentaDaba : 0), 0) * 100) / 100;
}

/* ---------- Desde qué mes paga la app ----------
   Octubre de 2026 es el primer mes que se liquidó y se pagó desde la app (se cerró el 03/11 y los pagos se marcaron ahí). Los anteriores
   se pagaron con la planilla de Angelo: su liquidación en la app es la cuenta con las reglas de hoy, no lo que se pagó. Para esos meses la
   app avisa que hay que cargar lo pagado antes de cerrar. */
export const PRIMER_MES_PAGADO_DESDE_LA_APP = "2026-10";

/** Si ese mes («2026-08») se pagó con la planilla de Angelo, antes de que la app liquidara. */
export const sePagoConLaPlanilla = (periodo: string): boolean => periodo < PRIMER_MES_PAGADO_DESDE_LA_APP;
