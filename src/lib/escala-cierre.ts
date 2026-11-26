import type { EscalaCierre, EscalonDeCierre, EstadoApp, ID, MiembroEquipo, Resell, Venta } from "./types";
import { miembroDeCloser } from "./crm";

/* ==================================================================
   Una comisión que sube según el % de cierre del mes (Yari, 25/11):

     «Tema resell. Menos de 25% de cierre cobrás el 5%. Entre 25% y 30%
      de cierre cobrás el 10%. Más del 30% de cierre cobrás el 12%.»

   Hasta acá una comisión era un % fijo: el resell pagaba la mitad del
   general y punto. Ahora el % de un servicio puede depender de cómo le fue
   al closer ese mes en sus llamadas de resell. La regla se carga como
   cualquier otra (Equipo y honorarios → la comisión → «El % sube según su
   cierre»), tiene historia como las demás, y la usan IGUAL la liquidación,
   Finanzas, el resultado de cada webinar y Mi panel: todos llaman a
   `cierreDeResells` y a `tasaDeEscala`, así no puede dar un % en un lado y
   otro en el otro.

   El % de cierre de resell de un mes:

     cierres  = personas a las que les vendió ese mes y que venían de una
                llamada de resell (la venta está atada a la llamada, o esa
                persona tuvo una llamada de resell con él en los 60 días
                anteriores, o es una venta de un servicio de resell)
     llamadas = sus llamadas de resell de ese mes que se hicieron (sin las
                canceladas, sin «No se presentó» y sin las de testimonio que
                se reagendaron)
     %        = cierres ÷ llamadas

   Es la cuenta de siempre de un closer (ventas ÷ show ups) aplicada a los
   resells. Sin llamadas en el mes no hay % de cierre: vale el % de base.

   Sin React ni red.
   ================================================================== */

/** La escala que pasó Yari el 25/11, para proponerla al cargar la regla. */
export const ESCALA_DE_RESELL: EscalaCierre = {
  de: "resell",
  escalones: [{ desde: 0.25, tasa: 0.1 }, { desde: 0.3, estricto: true, tasa: 0.12 }],
};

/** Cuántos días para atrás se busca la llamada de resell de alguien que compró sin que la venta diga de qué llamada salió. */
export const DIAS_DE_LA_LLAMADA_A_LA_VENTA = 60;

const DIA = 86400000;
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Una escala bien armada: escalones válidos, de menor a mayor. undefined si no queda ninguno (no hay escala). */
export function escalaNormal(x: EscalaCierre | null | undefined): EscalaCierre | undefined {
  if (!x || !Array.isArray(x.escalones)) return undefined;
  const escalones = x.escalones
    .filter((t) => t && Number.isFinite(t.desde) && Number.isFinite(t.tasa) && t.desde >= 0 && t.tasa >= 0)
    .map((t): EscalonDeCierre => ({ desde: t.desde, tasa: t.tasa, ...(t.estricto ? { estricto: true } : {}) }))
    .sort((a, b) => a.desde - b.desde || Number(Boolean(a.estricto)) - Number(Boolean(b.estricto)));
  return escalones.length ? { de: "resell", escalones } : undefined;
}

/* Un cierre de 3 de 12 es 25% justo: la cuenta en coma flotante no puede dejarlo en 24,999…%. */
const EPS = 1e-9;
const alcanza = (t: EscalonDeCierre, pct: number) => (t.estricto ? pct > t.desde + EPS : pct >= t.desde - EPS);

/** El escalón más alto que se alcanza con ese % de cierre (undefined: ninguno, vale el % de base). */
export function escalonAlcanzado(escala: EscalaCierre | undefined, pct: number | null): EscalonDeCierre | undefined {
  if (!escala || pct === null) return undefined;
  let out: EscalonDeCierre | undefined;
  for (const t of escala.escalones) if (alcanza(t, pct)) out = t;
  return out;
}

/** El % que se cobra con ese cierre: el del escalón alcanzado o, si no llega a ninguno (o no hay llamadas), el de base. */
export const tasaDeEscala = (escala: EscalaCierre | undefined, base: number, pct: number | null): number =>
  escalonAlcanzado(escala, pct)?.tasa ?? base;

/** El escalón que sigue al alcanzado, y cuántos cierres más hacen falta con las llamadas que lleva (null: ya está en el más alto). */
export function proximoEscalon(escala: EscalaCierre | undefined, c: Pick<CierreDeResells, "llamadas" | "cierres" | "pct">): { escalon: EscalonDeCierre; faltan: number } | null {
  if (!escala) return null;
  const sig = escala.escalones.find((t) => c.pct === null || !alcanza(t, c.pct));
  if (!sig) return null;
  if (c.llamadas === 0) return { escalon: sig, faltan: 1 };
  let n = c.cierres;
  while (n <= c.llamadas && !alcanza(sig, n / c.llamadas)) n++;
  return { escalon: sig, faltan: Math.max(1, n - c.cierres) };
}

const pctTexto = (f: number) => {
  const n = Math.round(f * 1000) / 10;
  return `${Number.isInteger(n) ? n : n.toFixed(1).replace(".", ",")}%`;
};

/** La escala dicha en una línea: «5% con menos de 25% de cierre · 10% desde 25% · 12% con más de 30%». */
export function textoDeEscala(escala: EscalaCierre, base: number): string {
  const [primero] = escala.escalones;
  const partes = primero ? [`${pctTexto(base)} con ${primero.estricto ? "hasta" : "menos de"} ${pctTexto(primero.desde)} de cierre`] : [pctTexto(base)];
  for (const t of escala.escalones) partes.push(`${pctTexto(t.tasa)} ${t.estricto ? "con más de" : "desde"} ${pctTexto(t.desde)}`);
  return partes.join(" · ");
}

/** «5% a 12%»: el rango de la escala, para donde no entra el detalle. */
export function rangoDeEscala(escala: EscalaCierre, base: number): string {
  const tasas = [base, ...escala.escalones.map((t) => t.tasa)];
  return `${pctTexto(Math.min(...tasas))} a ${pctTexto(Math.max(...tasas))}`;
}

/* ---------- El % de cierre ---------- */

export interface LlamadaDeResell {
  id: ID;
  nombre: string;
  fechaHora: string;
  estado: string;
  /* Si entra en la cuenta y, si no, por qué. */
  cuenta: boolean;
  motivo?: string;
}

export interface VentaDeResell {
  ventaId: ID;
  nombre: string;
  fecha: string;
  productoId?: ID;
  /* Por qué es un cierre de resell. */
  por: "llamada" | "persona" | "servicio";
  /* La misma persona ya cuenta con otra venta del mes: es un solo cierre. */
  repetida: boolean;
}

export interface CierreDeResells {
  llamadas: number;
  cierres: number;
  /* cierres ÷ llamadas; null sin llamadas. */
  pct: number | null;
  detalle: { llamadas: LlamadaDeResell[]; ventas: VentaDeResell[] };
}

type EstadoDeCierre = Pick<EstadoApp, "ventas" | "equipo"> & { resells?: Resell[] };

const noSePresento = (estado: string | null | undefined) =>
  String(estado ?? "").split(",").some((x) => sinTildes(x) === "no se presento");

/** Si una llamada de resell es de esa persona: el closer de la fila (puede traer más de uno, «Mariano,Dante») es ella. */
function esSuLlamada(r: Pick<Resell, "closer">, m: Pick<MiembroEquipo, "id">, equipo: EstadoApp["equipo"]): boolean {
  return String(r.closer ?? "").split(",").some((x) => x.trim() !== "" && miembroDeCloser(x, equipo)?.id === m.id);
}

export interface OpcionesDeCierre {
  /* Los servicios que son de resell por sí solos (los que llevan la escala): una venta suya cuenta aunque no se la pueda atar a una llamada. */
  productoIds?: readonly ID[];
  /* Hasta cuándo se mira (lo que todavía no pasó no cuenta). Por defecto, ahora. */
  ahora?: number;
}

/**
 * El % de cierre de resell de una persona entre dos instantes (un mes, o un mes hasta el corte de la liquidación).
 * Es LA cuenta: la usan la liquidación, Finanzas y Mi panel.
 */
export function cierreDeResells(e: EstadoDeCierre, m: Pick<MiembroEquipo, "id">, desdeMs: number, hastaMs: number, o: OpcionesDeCierre = {}): CierreDeResells {
  const tope = Math.min(hastaMs, o.ahora ?? Date.now());
  const enRango = (iso: string | undefined | null) => { const t = iso ? Date.parse(iso) : NaN; return t >= desdeMs && t <= tope; };

  /* Sus llamadas de resell (todas, también las de otros meses: de ahí sale de qué llamada vino una venta). */
  const suyas: Resell[] = [];
  const vistas = new Set<ID>();
  const sesionesDeResell = new Set<ID>();
  for (const r of e.resells ?? []) {
    if (r.sesionId) sesionesDeResell.add(r.sesionId);
    if (vistas.has(r.id) || !esSuLlamada(r, m, e.equipo)) continue;
    vistas.add(r.id);
    suyas.push(r);
  }

  const llamadas: LlamadaDeResell[] = [];
  for (const r of suyas) {
    if (!enRango(r.fechaHora)) continue;
    const motivo = r.cancelada ? "Se canceló" : noSePresento(r.estado) ? "No se presentó" : r.testimonio === "Se reagenda" ? "Se reagendó" : undefined;
    llamadas.push({ id: r.id, nombre: r.nombre, fechaHora: r.fechaHora, estado: r.estado ?? "", cuenta: !motivo, ...(motivo ? { motivo } : {}) });
  }
  llamadas.sort((a, b) => a.fechaHora.localeCompare(b.fechaHora) || a.id.localeCompare(b.id));

  const servicios = new Set(o.productoIds ?? []);
  const ventas: VentaDeResell[] = [];
  const personas = new Set<string>();
  const delMes = e.ventas
    .filter((v) => v.closerId === m.id && v.estado !== "cancelada" && enRango(v.fecha))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  for (const v of delMes) {
    const por = porQueEsDeResell(v, suyas, sesionesDeResell, servicios);
    if (!por) continue;
    const persona = v.contactoId || v.id;
    ventas.push({ ventaId: v.id, nombre: v.contactoNombre ?? "", fecha: v.fecha, productoId: v.productoId, por, repetida: personas.has(persona) });
    personas.add(persona);
  }

  const n = llamadas.filter((x) => x.cuenta).length;
  const cierres = personas.size;
  return { llamadas: n, cierres, pct: n > 0 ? cierres / n : null, detalle: { llamadas, ventas } };
}

function porQueEsDeResell(v: Venta, suyas: readonly Resell[], sesionesDeResell: ReadonlySet<ID>, servicios: ReadonlySet<ID>): VentaDeResell["por"] | null {
  if (v.sesionId && sesionesDeResell.has(v.sesionId)) return "llamada";
  if (v.contactoId) {
    const t = Date.parse(v.fecha);
    const cerca = suyas.some((r) => {
      if (r.cancelada || r.contactoId !== v.contactoId) return false;
      const tr = Date.parse(r.fechaHora);
      return tr <= t + DIA && tr >= t - DIAS_DE_LA_LLAMADA_A_LA_VENTA * DIA;
    });
    if (cerca) return "persona";
  }
  return v.productoId && servicios.has(v.productoId) ? "servicio" : null;
}

/** «3 de 11 llamadas de resell (27,3%)», o que no tuvo llamadas. */
export function textoDelCierre(c: Pick<CierreDeResells, "llamadas" | "cierres" | "pct">): string {
  if (c.pct === null) return c.cierres ? `${c.cierres} ${c.cierres === 1 ? "cierre" : "cierres"} sin llamadas de resell en el mes` : "sin llamadas de resell en el mes";
  return `cerró ${c.cierres} de ${c.llamadas} ${c.llamadas === 1 ? "llamada" : "llamadas"} de resell (${pctTexto(c.pct)})`;
}

export const porcentajeDeCierre = pctTexto;

/* ---------- Para Finanzas: el cierre de cada persona en cada mes ---------- */

/** Quién cerró cuánto en un mes («2026-11»): lo piden Finanzas y el resultado de cada webinar, cobro por cobro. */
export type CierreDelMes = (miembroId: ID, mes: string, productoIds: readonly ID[]) => number | null;

/** Una sola cuenta por persona y mes, por más cobros que la pidan. Los meses son los de la hora de acá, como los de la liquidación
 *  (`rangoDe` es `rangoDePeriodo`: se pasa para no importar a quien importa a este archivo). */
export function resolverDeCierre(e: EstadoDeCierre, rangoDe: (mes: string) => { desde: Date; hasta: Date }, ahora = Date.now()): CierreDelMes {
  const memo = new Map<string, number | null>();
  const porId = new Map(e.equipo.map((m) => [m.id, m] as const));
  return (miembroId, mes, productoIds) => {
    const clave = `${miembroId}|${mes}|${[...productoIds].sort().join(",")}`;
    const ya = memo.get(clave);
    if (ya !== undefined) return ya;
    const m = porId.get(miembroId);
    const r = rangoDe(mes);
    const pct = m ? cierreDeResells(e, m, r.desde.getTime(), r.hasta.getTime(), { productoIds, ahora }).pct : null;
    memo.set(clave, pct);
    return pct;
  };
}

/* ---------- Para Mi panel: cómo viene este mes ---------- */

export interface EscalaDelMes {
  mes: string;
  escala: EscalaCierre;
  /* El % de base y el que le toca hoy con lo que lleva cerrado. */
  base: number;
  tasa: number;
  cierre: CierreDeResells;
  /* El escalón que sigue y cuántos cierres le faltan (null: ya está en el más alto). */
  proximo: { escalon: EscalonDeCierre; faltan: number } | null;
}

/** La escala de resell de una persona en el mes de `ahora` y cómo viene: null si hoy no cobra nada con escala. Sale de
 *  `comisionHistorial` (lo que usa Finanzas), así cualquiera que vea su panel ve el mismo % que la liquidación. */
export function escalaDelMesDe(
  e: EstadoDeCierre, m: Pick<MiembroEquipo, "id" | "comisionHistorial">, mes: string, rangoDe: (mes: string) => { desde: Date; hasta: Date }, ahora = Date.now(),
): EscalaDelMes | null {
  const r = rangoDe(mes);
  /* El tramo que vale el último día que se mira del mes (hoy, si es el mes en curso). */
  const dia = new Date(Math.min(ahora, r.hasta.getTime()) - 3 * 3600000).toISOString().slice(0, 10);
  const t = m.comisionHistorial?.find((x) => (!x.desde || x.desde <= dia) && (!x.hasta || x.hasta >= dia));
  const servicios = Object.keys(t?.escalas ?? {}).sort();
  if (!t || servicios.length === 0) return null;
  const escala = escalaNormal(t.escalas![servicios[0]]);
  if (!escala) return null;
  const base = t.servicios?.[servicios[0]] ?? t.general ?? 0;
  const cierre = cierreDeResells(e, m, r.desde.getTime(), r.hasta.getTime(), { productoIds: servicios, ahora });
  return { mes, escala, base, tasa: tasaDeEscala(escala, base, cierre.pct), cierre, proximo: proximoEscalon(escala, cierre) };
}
