"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "@/lib/supabase";
import type { Simulacro } from "@/lib/simulacros";

/* Los simulacros desde el navegador: la RLS de supabase/simulacros.sql deja ver y cargar a quien ve y edita alumnos. */

export async function leerSimulacros(f: { fecha?: string; alumnoId?: string; desde?: string }): Promise<Simulacro[] | null> {
  if (!nube) return null;
  let q = nube.from("simulacros").select("*");
  if (f.fecha) q = q.eq("fecha", f.fecha);
  if (f.desde) q = q.gte("fecha", f.desde);
  if (f.alumnoId) q = q.eq("alumnoId", f.alumnoId);
  const r = await q.order("fecha", { ascending: false }).order("creadoEn", { ascending: true }).limit(500);
  return r.error ? null : ((r.data ?? []) as Simulacro[]);
}

/** Cómo fue (o un alumno que no se había anotado y se cargó desde el panel). */
export async function guardarSimulacro(s: Partial<Simulacro> & { id: string }, nuevo: boolean): Promise<void> {
  if (!nube) throw new Error("Sin conexión a la base.");
  const r = nuevo ? await nube.from("simulacros").insert(s) : await nube.from("simulacros").update(s).eq("id", s.id);
  if (r.error) throw new Error(r.error.message.includes("row-level security") ? "Tu cuenta no puede cargar simulacros." : "No se pudo guardar el simulacro.");
}

/** Los simulacros que pide una pantalla, con «volver a leer» para después de guardar. */
export function useSimulacros(f: { fecha?: string; alumnoId?: string; desde?: string }): { lista: Simulacro[]; cargando: boolean; releer: () => void } {
  const [lista, setLista] = useState<Simulacro[]>([]);
  const [cargando, setCargando] = useState(Boolean(nube));
  const [vuelta, setVuelta] = useState(0);
  const { fecha, alumnoId, desde } = f;
  useEffect(() => {
    let vivo = true;
    if (!nube || (!fecha && !alumnoId && !desde)) { setCargando(false); return; }
    setCargando(true);
    void leerSimulacros({ fecha, alumnoId, desde }).then((l) => { if (vivo) { setLista(l ?? []); setCargando(false); } });
    return () => { vivo = false; };
  }, [fecha, alumnoId, desde, vuelta]);
  const releer = useCallback(() => setVuelta((x) => x + 1), []);
  return { lista, cargando, releer };
}
