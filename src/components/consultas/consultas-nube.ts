"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "@/lib/supabase";
import type { ConsultaClase } from "@/lib/consultas";

/* Las consultas de los jueves desde el navegador: la RLS de supabase/consultas-clase.sql deja ver y cargar a quien ve y edita alumnos. */

/** Las de una clase: las de ese jueves y las que se hicieron antes o ese día y pasaron a otra clase (para verlas en la lista). */
export async function leerConsultas(f: { fecha?: string; alumnoId?: string }): Promise<ConsultaClase[] | null> {
  if (!nube) return null;
  let q = nube.from("consultas_clase").select("*");
  if (f.fecha) q = q.or(`fecha.eq.${f.fecha},and(primeraFecha.lte.${f.fecha},fecha.gt.${f.fecha})`);
  if (f.alumnoId) q = q.eq("alumnoId", f.alumnoId);
  const r = await q.order("fecha", { ascending: false }).order("creadoEn", { ascending: true }).limit(500);
  return r.error ? null : ((r.data ?? []) as ConsultaClase[]);
}

/** El último jueves que ya pasó (o es hoy) con consultas sin cargar: la clase que se abre de entrada mientras quede algo. */
export async function claseSinCargar(hasta: string): Promise<string | null> {
  if (!nube) return null;
  const r = await nube.from("consultas_clase").select("fecha").eq("estado", "recibida").lte("fecha", hasta).order("fecha", { ascending: false }).limit(1);
  return r.error ? null : ((r.data ?? [])[0] as { fecha?: string } | undefined)?.fecha ?? null;
}

/** Guarda una consulta nueva (cargada desde el panel) o los cambios de una. */
export async function guardarConsulta(c: Partial<ConsultaClase> & { id: string }, nueva: boolean): Promise<void> {
  if (!nube) throw new Error("Sin conexión a la base.");
  const r = nueva ? await nube.from("consultas_clase").insert(c) : await nube.from("consultas_clase").update(c).eq("id", c.id);
  if (r.error) throw new Error(r.error.message.includes("row-level security") ? "Tu cuenta no puede cargar consultas." : "No se pudo guardar la consulta.");
}

/** Las consultas que pide una pantalla, con «volver a leer» para después de guardar. */
export function useConsultas(f: { fecha?: string; alumnoId?: string }): { lista: ConsultaClase[]; cargando: boolean; releer: () => void } {
  const [lista, setLista] = useState<ConsultaClase[]>([]);
  const [cargando, setCargando] = useState(Boolean(nube));
  const [vuelta, setVuelta] = useState(0);
  const { fecha, alumnoId } = f;
  useEffect(() => {
    let vivo = true;
    if (!nube || (!fecha && !alumnoId)) { setCargando(false); return; }
    setCargando(true);
    void leerConsultas({ fecha, alumnoId }).then((l) => { if (vivo) { setLista(l ?? []); setCargando(false); } });
    return () => { vivo = false; };
  }, [fecha, alumnoId, vuelta]);
  const releer = useCallback(() => setVuelta((x) => x + 1), []);
  return { lista, cargando, releer };
}
