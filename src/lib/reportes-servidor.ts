import type { SupabaseClient } from "@supabase/supabase-js";
import {
  leerItems, planificarReportes, type AlumnoBasico, type PlanReportes, type ReporteExistente,
} from "./reportes-webhook";
import type { Reporte } from "./types";

/* ==================================================================
   Los reportes semanales que llegan por /api/reportes/webhook, del lado del
   SERVIDOR: usa la clave de servicio (saltea RLS), así que nunca se importa desde
   un componente de cliente. La ruta pone la base y esto pone el orden: leer lo
   que mandaron, buscar a los alumnos y a los reportes que ya había, y guardar.
   ================================================================== */

export interface BaseReportes {
  alumnos(): Promise<AlumnoBasico[]>;
  reportesDe(alumnoIds: string[]): Promise<ReporteExistente[]>;
  guardar(filas: Reporte[]): Promise<void>;
}

const PAGINA = 1000;

/* PostgREST corta en 1000 filas y no avisa: se pide de a páginas. */
async function paginado<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, tabla: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const r = await pedir(desde, desde + PAGINA - 1);
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
    filas.push(...((r.data ?? []) as T[]));
    if ((r.data?.length ?? 0) < PAGINA) return filas;
  }
}

export function baseSupabaseReportes(db: SupabaseClient): BaseReportes {
  return {
    alumnos: () => paginado<AlumnoBasico>((a, b) => db.from("alumnos").select("id,nombre,email").order("id").range(a, b), "alumnos"),
    async reportesDe(ids) {
      const out: ReporteExistente[] = [];
      /* Los ids van en la URL: de a 100. */
      for (let i = 0; i < ids.length; i += 100) {
        const lote = ids.slice(i, i + 100);
        out.push(...await paginado<ReporteExistente>((a, b) => db.from("reportes").select("id,alumnoId,semanaDel").in("alumnoId", lote).order("id").range(a, b), "reportes"));
      }
      return out;
    },
    async guardar(filas) {
      for (let i = 0; i < filas.length; i += 100) {
        const r = await db.from("reportes").upsert(filas.slice(i, i + 100), { defaultToNull: false });
        if (r.error) throw new Error(`reportes: ${r.error.message}`);
      }
    },
  };
}

export interface ResultadoReportes {
  ok: true;
  recibidos: number;
  guardados: number;
  nuevos: number;
  actualizados: number;
  rechazados: { posicion: number; motivo: string }[];
}

/** Recibe lo que mandó la herramienta de los reportes. Devuelve el resultado, o el error si el pedido no se entiende. */
export async function recibirReportes(
  base: BaseReportes, json: unknown, hoy: string, ahora: string,
): Promise<ResultadoReportes | { ok: false; status: number; error: string }> {
  const leido = leerItems(json);
  if (leido.error) return { ok: false, status: 400, error: leido.error };
  const recibidos = leido.items.length + leido.rechazados.length;
  if (leido.items.length === 0) return { ok: true, recibidos, guardados: 0, nuevos: 0, actualizados: 0, rechazados: leido.rechazados };

  const alumnos = await base.alumnos();
  /* Primero se ve a quiénes les toca, y después qué reportes tenían ya: así se reemplaza el de la semana en vez de duplicarlo. */
  const primera = planificarReportes(leido.items, alumnos, [], hoy, ahora);
  const existentes = primera.filas.length ? await base.reportesDe([...new Set(primera.filas.map((f) => f.alumnoId))]) : [];
  const plan: PlanReportes = planificarReportes(leido.items, alumnos, existentes, hoy, ahora);
  if (plan.filas.length) await base.guardar(plan.filas);
  return {
    ok: true, recibidos, guardados: plan.filas.length, nuevos: plan.nuevos, actualizados: plan.actualizados,
    rechazados: [...leido.rechazados, ...plan.rechazados].sort((a, b) => a.posicion - b.posicion),
  };
}
