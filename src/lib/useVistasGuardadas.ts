"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nube } from "./supabase";
import { usePreferencia } from "./preferencias";
import { porNombre, validarVistas, vistaDeEquipo, type VistaGuardada } from "./vistas-guardadas";

/* ==================================================================
   Las vistas guardadas de una pantalla (lib/vistas-guardadas.ts): las
   propias, con las preferencias del usuario; las del equipo, de la tabla
   `vistas`. Sin nube (la app local), las del equipo quedan en este
   navegador. Si la tabla todavía no existe (falta correr
   supabase/vistas.sql), `conEquipo` es false y sólo se ofrecen las
   propias.
   ================================================================== */

const enNavegador = (pantalla: string) => `apicanta:vistas-equipo:${pantalla}`;
const faltaTabla = (error: { code?: string } | null) => error?.code === "PGRST205" || error?.code === "42P01";
const nuevoId = () => `vis_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function leerLocal(pantalla: string): VistaGuardada[] {
  try {
    const x = JSON.parse(localStorage.getItem(enNavegador(pantalla)) ?? "[]") as Record<string, unknown>[];
    return Array.isArray(x) ? x.map(vistaDeEquipo).filter((v): v is VistaGuardada => v !== null) : [];
  } catch { return []; }
}

function escribirLocal(pantalla: string, vistas: VistaGuardada[]) {
  try { localStorage.setItem(enNavegador(pantalla), JSON.stringify(vistas)); } catch { /* modo privado */ }
}

export interface VistasGuardadas {
  propias: VistaGuardada[];
  equipo: VistaGuardada[];
  /* La tabla del equipo existe (o no hay nube): se puede guardar para todos. */
  conEquipo: boolean;
  guardar: (v: { nombre: string; consulta: string; deEquipo: boolean }) => Promise<{ id?: string; error?: string }>;
  actualizar: (v: VistaGuardada, cambios: { nombre?: string; consulta?: string }) => Promise<{ error?: string }>;
  borrar: (v: VistaGuardada) => Promise<{ error?: string }>;
}

export function useVistasGuardadas(pantalla: string): VistasGuardadas {
  const pref = usePreferencia<VistaGuardada[]>(`vistas:${pantalla}`, validarVistas);
  const propias = useMemo(() => [...(pref.valor ?? [])].sort(porNombre), [pref.valor]);
  const [equipo, setEquipo] = useState<VistaGuardada[]>([]);
  const [conEquipo, setConEquipo] = useState(true);

  const traer = useCallback(async () => {
    if (!nube) { setEquipo(leerLocal(pantalla).sort(porNombre)); return; }
    const { data, error } = await nube.from("vistas").select("*").eq("pantalla", pantalla);
    if (error) { if (faltaTabla(error)) setConEquipo(false); return; }
    setEquipo((data ?? []).map(vistaDeEquipo).filter((v): v is VistaGuardada => v !== null).sort(porNombre));
  }, [pantalla]);
  useEffect(() => { void traer(); }, [traer]);

  const guardar = useCallback<VistasGuardadas["guardar"]>(async ({ nombre, consulta, deEquipo }) => {
    const v: VistaGuardada = { id: nuevoId(), nombre, consulta, deEquipo, creadoEn: new Date().toISOString() };
    if (!deEquipo) { pref.guardar([...(pref.valor ?? []), v]); return { id: v.id }; }
    if (!nube) { escribirLocal(pantalla, [...leerLocal(pantalla), v]); await traer(); return { id: v.id }; }
    const { error } = await nube.from("vistas").insert({ id: v.id, pantalla, nombre, consulta });
    if (error) return { error: faltaTabla(error) ? "Todavía no se puede guardar para el equipo: falta preparar la base." : "No se pudo guardar para el equipo: tu tipo de cuenta no lo permite." };
    await traer();
    return { id: v.id };
  }, [pantalla, pref, traer]);

  const actualizar = useCallback<VistasGuardadas["actualizar"]>(async (v, cambios) => {
    if (!v.deEquipo) { pref.guardar((pref.valor ?? []).map((x) => (x.id === v.id ? { ...x, ...cambios } : x))); return {}; }
    if (!nube) { escribirLocal(pantalla, leerLocal(pantalla).map((x) => (x.id === v.id ? { ...x, ...cambios } : x))); await traer(); return {}; }
    const { data, error } = await nube.from("vistas").update({ ...cambios, actualizadoEn: new Date().toISOString() }).eq("id", v.id).select("id");
    /* Lo que la base no deja tocar no da error: no cambia ninguna fila. */
    if (error || !data?.length) return { error: "No se pudo cambiar la vista del equipo: tu tipo de cuenta no lo permite." };
    await traer();
    return {};
  }, [pantalla, pref, traer]);

  const borrar = useCallback<VistasGuardadas["borrar"]>(async (v) => {
    if (!v.deEquipo) { pref.guardar((pref.valor ?? []).filter((x) => x.id !== v.id)); return {}; }
    if (!nube) { escribirLocal(pantalla, leerLocal(pantalla).filter((x) => x.id !== v.id)); await traer(); return {}; }
    const { data, error } = await nube.from("vistas").delete().eq("id", v.id).select("id");
    if (error || !data?.length) return { error: "No se pudo borrar la vista del equipo: tu tipo de cuenta no lo permite." };
    await traer();
    return {};
  }, [pantalla, pref, traer]);

  return { propias, equipo, conEquipo, guardar, actualizar, borrar };
}
