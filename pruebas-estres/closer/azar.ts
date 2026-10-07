/* ==================================================================
   Ayudas para las pruebas de propiedades del frente «el closer y el cierre
   del día»: un generador con semilla (mulberry32), un oráculo del día de
   negocio y de los strikes hecho aparte de lib/cierre-del-dia.ts (para que
   no se compare el código consigo mismo), y un armador de estados.

   Si una propiedad falla, `semilla` aparece en el mensaje: se vuelve a
   correr con esa semilla sola y sale lo mismo.
   ================================================================== */
import type { EstadoApp, MiembroEquipo, Sesion, Venta } from "@/lib/types";

export function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Azar = ReturnType<typeof crearAzar>;

export function crearAzar(semilla: number) {
  const sig = mulberry32(semilla);
  const a = {
    semilla,
    sig,
    entre: (min: number, max: number) => min + Math.floor(sig() * (max - min + 1)),
    elige: <T,>(xs: readonly T[]): T => xs[Math.floor(sig() * xs.length)],
    si: (p = 0.5) => sig() < p,
    plata: (min: number, max: number) => Math.round((min + sig() * (max - min)) * 100) / 100,
    /* Una copia mezclada (Fisher-Yates con esta misma semilla). */
    mezclar: <T,>(xs: readonly T[]): T[] => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(sig() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return a;
}

/* Corre `n` semillas; si algo falla, el mensaje dice cuál. */
export function porSemillas(n: number, desde: number, f: (azar: Azar, semilla: number) => void) {
  for (let s = desde; s < desde + n; s++) {
    try {
      f(crearAzar(s), s);
    } catch (err) {
      const e = err as Error;
      e.message = `[semilla ${s}] ${e.message}`;
      throw e;
    }
  }
}

/* ---------- El día de negocio, a mano ---------- */

/* Argentina es UTC-3 todo el año (sin horario de verano desde 2009). */
export const diaAR = (iso: string): string => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10);

export const sumarDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/* Un instante: el día dado, a esa hora de ARGENTINA (hora local 0-23.99). */
export function enAR(dia: string, hora: number, min = 0, seg = 0): string {
  const t = Date.parse(`${dia}T00:00:00Z`) + (hora * 3600 + min * 60 + seg) * 1000 + 3 * 3_600_000;
  return new Date(t).toISOString();
}

/* ---------- Equipo y llamadas ---------- */

export const TIPO_VENTA = "Llamada de Asesoramiento - Webinar - Team";
export const TIPO_RESELL = "Agenda de Auditoría Resell";
export const TIPO_NO_VENTA = "Sesión 1 a 1 - Testimonio";

export const miembro = (id: string, nombre: string, rol: MiembroEquipo["rol"], extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol, comisionRate: 0, activo: true, sinComision: false, ...extra });

export const llamada = (id: string, anfitrion: string | undefined, inicia: string, extra: Partial<Sesion> = {}): Sesion => ({
  id, titulo: TIPO_VENTA, tipo: TIPO_VENTA, invitado: `Invitado ${id}`, inicia, duracionMin: 45, estado: "hecha",
  origen: "calendly", creadoEn: inicia, extra: {}, ...(anfitrion !== undefined ? { anfitrion } : {}), ...extra,
}) as Sesion;

/* ---------- El oráculo de strikes ----------
   Escrito desde lo que dicen los comentarios de lib/cierre-del-dia.ts, sin
   usar sus funciones (ni diaDeNegocio): el día cuenta en UTC-3. */

export interface OraculoDia { dia: string; llamadas: number; tarde: number; sinCargar: number }

const reagendar = (t?: string) => /reagend|reprogram/.test((t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());

export function oraculoDeStrikes(
  e: { sesiones: Sesion[]; ventas: Venta[] }, closerDe: (s: Sesion) => string, esDeVenta: (s: Sesion) => boolean,
  cuentaDesde: string, hoy: string,
): Map<string, Map<string, OraculoDia>> {
  const ventaEn = new Map<string, string>();
  for (const v of e.ventas) {
    if (!v.sesionId || v.estado === "cancelada") continue;
    const ya = ventaEn.get(v.sesionId);
    if (!ya || Date.parse(v.creadoEn) < Date.parse(ya)) ventaEn.set(v.sesionId, v.creadoEn);
  }
  const out = new Map<string, Map<string, OraculoDia>>();
  for (const s of e.sesiones) {
    const d = diaAR(s.inicia);
    if (d < cuentaDesde || d > hoy) continue;
    if (s.estado === "cancelada") continue;
    if (!s.estadoLlamada && (s.estado === "no-show" || reagendar(s.estadoPreCall) || s.resultado)) continue;
    if (!esDeVenta(s)) continue;
    const closer = closerDe(s);
    if (!closer) continue;
    let dias = out.get(closer);
    if (!dias) { dias = new Map(); out.set(closer, dias); }
    let x = dias.get(d);
    if (!x) { x = { dia: d, llamadas: 0, tarde: 0, sinCargar: 0 }; dias.set(d, x); }
    x.llamadas++;
    if (s.estadoLlamadaEn) { if (diaAR(s.estadoLlamadaEn) > d) x.tarde++; }
    else if (!s.estadoLlamada) {
      const v = ventaEn.get(s.id);
      if (v) { if (diaAR(v) > d) x.tarde++; }
      else if (d < hoy) x.sinCargar++;
    }
  }
  return out;
}

export const conPeso = (x: OraculoDia) => x.tarde + x.sinCargar > 0;

/* ---------- Copias profundas (para romper las cachés por identidad) ---------- */
export const clonar = <T,>(x: T): T => structuredClone(x);

export type { EstadoApp };
