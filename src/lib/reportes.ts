import type { Alumno, EstadoApp, EstadoReporte, ID, Reporte } from "./types";
import { diaDeNegocio } from "@/components/ui/DateRangePicker";

/* ------------------------------------------------------------------
   Reportes por semana.

   Un reporte es de una SEMANA, no de un día: se identifica por su lunes,
   como "aaaa-mm-dd" del calendario del negocio (hora de Argentina). La
   tabla, los números y los gráficos de Reportes salen todos de
   `filasDeReportes`, así nunca dicen cosas distintas.
------------------------------------------------------------------- */

const aDia = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* Un "aaaa-mm-dd" como fecha local, sin pasar por UTC. */
export function deDia(dia: string): Date {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function sumarDias(dia: string, n: number): string {
  const d = deDia(dia);
  d.setDate(d.getDate() + n);
  return aDia(d);
}

/* El lunes de la semana de un día. */
export function lunesDelDia(dia: string): string {
  const d = deDia(dia);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return aDia(d);
}

/* El lunes de la semana de un reporte.

   `semanaDel` guarda la medianoche del lunes de quien lo cargó. Abierto desde
   un huso adelantado (Europa, por ejemplo) ese instante cae el DOMINGO en
   Argentina, y cortar por el día lo mandaba a la semana anterior. Por eso un
   domingo se redondea al lunes siguiente. */
export function lunesDe(fecha: string): string {
  const dia = diaDeNegocio(fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return "";
  return deDia(dia).getDay() === 0 ? sumarDias(dia, 1) : lunesDelDia(dia);
}

export function hoyDelNegocio(): string {
  return diaDeNegocio(new Date().toISOString());
}

/* Las semanas que TOCAN el rango, aunque sea en parte. Si contara sólo las
   que arrancan adentro, "Este mes" el día 1 no tendría ninguna, y la semana
   en curso desaparecería cada vez que el mes empieza un jueves. */
export function semanasQueTocan(desde: string, hasta: string): string[] {
  if (!desde || !hasta || desde > hasta) return [];
  const out: string[] = [];
  for (let s = lunesDelDia(desde); s <= hasta; s = sumarDias(s, 7)) out.push(s);
  return out;
}

/* Quién debe reporte: los activos y los pausados, como hasta ahora. */
export const debeReporte = (a: Alumno) => a.estado === "activo" || a.estado === "pausado";

/* Desde qué semana se le pide reporte a la gente: la primera que tiene algún
   reporte cargado (o ésta, si todavía no hay ninguno). Para atrás de eso los
   reportes no se llevaban, y contar esas semanas como "no enviado" hundiría la
   tasa con una falta que nunca existió. */
export function primeraSemanaEsperada(e: EstadoApp): string {
  let min = lunesDelDia(hoyDelNegocio());
  for (const r of e.reportes) {
    const s = lunesDe(r.semanaDel);
    if (s && s < min) min = s;
  }
  return min;
}

export interface FilaReporte {
  /* El id del reporte, o `sin:<alumno>|<semana>` si todavía no existe. */
  id: string;
  alumno: Alumno;
  reporte: Reporte | null;
  semana: string;
  estado: EstadoReporte;
}

/* Todos los reportes de las semanas que tocan el rango, más uno "No enviado"
   por cada alumno que lo debía y no tiene: una falta también es un dato, y es
   justo la fila que hay que poder marcar. */
export function filasDeReportes(e: EstadoApp, desde: string, hasta: string): FilaReporte[] {
  const semanas = semanasQueTocan(desde, hasta);
  if (semanas.length === 0) return [];
  const enRango = new Set(semanas);
  const alumnos = new Map(e.alumnos.map((a) => [a.id, a] as const));
  const vistos = new Set<string>();
  const out: FilaReporte[] = [];

  for (const r of e.reportes) {
    const s = lunesDe(r.semanaDel);
    if (!enRango.has(s)) continue;
    const a = alumnos.get(r.alumnoId);
    /* El reporte de un alumno borrado no tiene a quién mostrarse. */
    if (!a) continue;
    const k = `${a.id}|${s}`;
    /* Dos reportes para la misma semana (un doble clic viejo): cuenta uno. */
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push({ id: r.id, alumno: a, reporte: r, semana: s, estado: r.estado });
  }

  const desdeCuando = primeraSemanaEsperada(e);
  for (const a of e.alumnos) {
    if (!debeReporte(a)) continue;
    const inicio = diaDeNegocio(a.inicio);
    for (const s of semanas) {
      /* Se le pide desde la semana en la que ya había empezado el lunes. */
      if (s < desdeCuando || (inicio && inicio > s)) continue;
      const k = `${a.id}|${s}`;
      if (vistos.has(k)) continue;
      out.push({ id: `sin:${k}`, alumno: a, reporte: null, semana: s, estado: "no-enviado" });
    }
  }
  return out;
}

/* Semanas seguidas sin reporte completado, contando para atrás desde `hasta`
   (un lunes). Una semana que se debía y no tiene reporte cuenta como sin
   reportar, igual que en la tabla. Se corta en la primera completada o en la
   semana en que el alumno todavía no había empezado.

   Es la cuenta de Alumnos y de Reportes. La de `semanasSinReportar`
   (metricas.ts) sólo mira los reportes cargados: un alumno recién llegado,
   sin ninguno, le daba "al día" aunque ya debiera la semana. */
export function rachasHasta(e: EstadoApp, hasta: string): Map<ID, number> {
  const completados = new Set<string>();
  for (const r of e.reportes) if (r.estado === "completado") completados.add(`${r.alumnoId}|${lunesDe(r.semanaDel)}`);
  const desdeCuando = primeraSemanaEsperada(e);
  const out = new Map<ID, number>();
  for (const a of e.alumnos) {
    if (!debeReporte(a)) continue;
    const inicio = diaDeNegocio(a.inicio);
    let n = 0;
    for (let s = hasta; s >= desdeCuando && n < 104; s = sumarDias(s, -7)) {
      if (inicio && inicio > s) break;
      if (completados.has(`${a.id}|${s}`)) break;
      n++;
    }
    out.set(a.id, n);
  }
  return out;
}

/* Las rachas a hoy, con la semana en curso incluida. */
export const rachasAHoy = (e: EstadoApp): Map<ID, number> => rachasHasta(e, lunesDelDia(hoyDelNegocio()));
