"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "@/lib/supabase";
import type { ReporteSinAlumno } from "@/lib/reporte-sin-codigo";

/* Los reportes semanales que llegaron sin alumno (supabase/reportes-sin-alumno.sql) desde el navegador: los ve quien ve
   alumnos y los ata (o descarta) quien los edita. Los crea el servidor, nunca la app. */

export async function leerSinAlumno(): Promise<ReporteSinAlumno[] | null> {
  if (!nube) return null;
  const r = await nube.from("reportes_sin_alumno").select("*").eq("estado", "pendiente").order("creadoEn", { ascending: false }).limit(500);
  return r.error ? null : ((r.data ?? []) as ReporteSinAlumno[]);
}

export async function marcarSinAlumno(id: string, cambios: Partial<ReporteSinAlumno> & { atadoPor?: string }): Promise<void> {
  if (!nube) throw new Error("Sin conexión a la base.");
  const r = await nube.from("reportes_sin_alumno").update({ ...cambios, actualizadoEn: new Date().toISOString() }).eq("id", id);
  if (r.error) throw new Error(r.error.message.includes("row-level security") ? "Tu cuenta no puede atar reportes." : "No se pudo guardar.");
}

/** Los pendientes, con «volver a leer» para después de atar o descartar. */
export function useSinAlumno(): { lista: ReporteSinAlumno[]; cargando: boolean; releer: () => void } {
  const [lista, setLista] = useState<ReporteSinAlumno[]>([]);
  const [cargando, setCargando] = useState(Boolean(nube));
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vivo = true;
    if (!nube) { setCargando(false); return; }
    void leerSinAlumno().then((l) => { if (vivo) { setLista(l ?? []); setCargando(false); } });
    return () => { vivo = false; };
  }, [vuelta]);
  const releer = useCallback(() => setVuelta((x) => x + 1), []);
  return { lista, cargando, releer };
}
