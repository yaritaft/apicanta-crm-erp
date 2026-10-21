import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import type { Acceso } from "@/lib/accesos-servidor";

/* Los accesos de un alumno, desde el navegador (como los lee la ficha → Servicio → Accesos: con la sesión de quien mira). */
export async function leerAccesosDeAlumno(alumnoId: string): Promise<Acceso[]> {
  if (!nube) return [];
  const r = await nube.from("accesos_alumno").select("*").eq("alumnoId", alumnoId);
  return r.error ? [] : ((r.data ?? []) as Acceso[]);
}

/** «Quitar todo» de la ficha: el servidor saca los accesos del alumno de Wisboo, Telegram y Zoom y los deja anotados. */
export async function quitarTodosLosAccesos(alumnoId: string): Promise<{ quitados: number; fallaron: number }> {
  const r = await fetch("/api/accesos-alumnos", {
    method: "POST", cache: "no-store", headers: { ...(await cabeceras()), "Content-Type": "application/json" },
    body: JSON.stringify({ accion: "quitar", alumnoId }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return { quitados: Number(j.quitados ?? 0), fallaron: Number(j.fallaron ?? 0) };
}
