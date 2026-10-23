import type { SupabaseClient } from "@supabase/supabase-js";
import { tokenZoom } from "./accesos-alumnos-servidor";
import { programasDe } from "./programas";
import {
  agruparParticipantes, avisoDePermisoZoom, clasesParaTraer, uuidEnLaDireccion, type ParticipanteZoom,
} from "./zoom-asistencia";

/* ==================================================================
   Trae de Zoom quién asistió a cada clase (Yari, 22/10) y lo guarda en
   `asistencias_zoom` (una fila por persona y clase) y `asistencias_zoom_clases`
   (una por clase traída, para decir «asistió a 3 de 8»).

   Las reuniones son las que cada programa tiene en Ajustes → Integraciones
   (`programas[].zoom`). De cada una se piden sus clases ya terminadas
   (`/past_meetings/{id}/instances`) y, de cada clase, sus participantes
   (`/past_meetings/{uuid}/participants`). Sólo lee de Zoom.

   La app Server-to-Server de Zoom necesita los permisos de lectura de
   reuniones pasadas; si le faltan, Zoom lo dice y acá se traduce en qué
   agregar (avisoDePermisoZoom). Lo corre /api/cron/zoom-asistencia cada hora
   y el botón «Traer la asistencia» de la ficha.
   ================================================================== */

const ESPERA_MS = 15_000;
const BASE = "https://api.zoom.us/v2";

async function pedir(url: string, token: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS) });
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null };
}

export interface ResultadoAsistenciaZoom {
  reuniones: number; clases: number; personas: number;
  errores: string[];
  /* Falta el permiso en la app de Zoom (con qué agregar). */
  permiso?: string;
}

/** Los ids de las reuniones de Zoom de todos los programas, sin repetir. */
export function reunionesDeZoom(programas: ReturnType<typeof programasDe>): string[] {
  return [...new Set(programas.filter((p) => p.activo).flatMap((p) => p.zoom).map((z) => String(z).trim()).filter(Boolean))];
}

export async function traerAsistenciaZoom(db: SupabaseClient, opciones: { ahora?: number; dias?: number } = {}): Promise<ResultadoAsistenciaZoom> {
  const res: ResultadoAsistenciaZoom = { reuniones: 0, clases: 0, personas: 0, errores: [] };
  const ahora = opciones.ahora ?? Date.now();

  const aj = await db.from("ajustes").select("programas").eq("id", 1).maybeSingle();
  if (aj.error) { res.errores.push(`ajustes: ${aj.error.message}`); return res; }
  const reuniones = reunionesDeZoom(programasDe({ programas: (aj.data as { programas?: unknown } | null)?.programas as never }));
  res.reuniones = reuniones.length;
  if (reuniones.length === 0) return res;

  if (!(process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET)) {
    res.errores.push("Falta conectar Zoom (la app Server-to-Server OAuth).");
    return res;
  }
  const t = await tokenZoom().catch(() => ({ error: "Zoom no contestó." }));
  if ("error" in t) { res.errores.push(t.error); return res; }

  const previas = await db.from("asistencias_zoom_clases").select("instancia, traidoEn");
  if (previas.error) { res.errores.push(`asistencias_zoom_clases: ${previas.error.message} (¿se corrió supabase/asistencias-zoom.sql?)`); return res; }
  const yaTraidas = new Map(((previas.data ?? []) as { instancia: string; traidoEn: string }[]).map((x) => [x.instancia, x] as const));

  for (const reunion of reuniones) {
    try {
      const lista = await pedir(`${BASE}/past_meetings/${encodeURIComponent(reunion)}/instances`, t.token);
      const permiso = avisoDePermisoZoom(lista.status, lista.json);
      if (permiso) { res.permiso = permiso; res.errores.push(permiso); return res; }
      if (lista.status === 404) continue;                       /* una reunión que todavía no tuvo clases */
      if (lista.status >= 400) { res.errores.push(`Zoom contestó ${lista.status} con las clases de la reunión ${reunion}.`); continue; }
      const instancias = ((lista.json?.meetings ?? []) as { uuid?: string; start_time?: string }[])
        .filter((i): i is { uuid: string; start_time: string } => Boolean(i.uuid && i.start_time));

      for (const inst of clasesParaTraer(instancias, yaTraidas, ahora, { dias: opciones.dias })) {
        const detalle = await pedir(`${BASE}/past_meetings/${uuidEnLaDireccion(inst.uuid)}`, t.token).catch(() => null);
        const tema = typeof detalle?.json?.topic === "string" ? detalle.json.topic : "";

        const participantes: ParticipanteZoom[] = [];
        let pagina = "";
        for (let vuelta = 0; vuelta < 20; vuelta++) {
          const r = await pedir(`${BASE}/past_meetings/${uuidEnLaDireccion(inst.uuid)}/participants?page_size=300${pagina ? `&next_page_token=${encodeURIComponent(pagina)}` : ""}`, t.token);
          const avisoPermiso = avisoDePermisoZoom(r.status, r.json);
          if (avisoPermiso) { res.permiso = avisoPermiso; res.errores.push(avisoPermiso); return res; }
          if (r.status >= 400) { res.errores.push(`Zoom contestó ${r.status} con los participantes de «${tema || inst.uuid}».`); break; }
          participantes.push(...((r.json?.participants ?? []) as ParticipanteZoom[]));
          pagina = typeof r.json?.next_page_token === "string" ? r.json.next_page_token : "";
          if (!pagina) break;
        }

        const filas = agruparParticipantes({ reunion, instancia: inst.uuid, tema, inicio: inst.start_time }, participantes);
        if (filas.length) {
          const g = await db.from("asistencias_zoom").upsert(filas.map((f) => ({ ...f, traidoEn: new Date(ahora).toISOString() })), { onConflict: "id" });
          if (g.error) { res.errores.push(`asistencias_zoom: ${g.error.message}`); continue; }
        }
        const c = await db.from("asistencias_zoom_clases").upsert({
          instancia: inst.uuid, reunion, tema, inicio: inst.start_time, participantes: participantes.length, traidoEn: new Date(ahora).toISOString(),
        }, { onConflict: "instancia" });
        if (c.error) { res.errores.push(`asistencias_zoom_clases: ${c.error.message}`); continue; }
        res.clases++; res.personas += filas.length;
      }
    } catch (e) {
      res.errores.push(e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "Zoom no contestó a tiempo." : `No se pudo hablar con Zoom (reunión ${reunion}).`);
    }
  }
  return res;
}
