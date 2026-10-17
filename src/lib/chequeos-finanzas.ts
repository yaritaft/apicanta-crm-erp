"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nube } from "./supabase";
import { useUsuarioActual } from "./usuario";
import type { Chequeos } from "./finanzas-pasos";
import type { Chequeo } from "./cierre-mes";

/* ==================================================================
   Lo que se tilda en los pasos de Finanzas (la weekly, revisar Slack, la
   auditoría de softwares…): quién lo hizo y cuándo, para cada día, semana y
   mes. Lo ve y lo cambia todo el equipo de Finanzas, así que vive en la base
   (`chequeos_finanzas`, supabase/chequeos-finanzas.sql) y no en el navegador.

   Sin esa tabla (todavía no se corrió el SQL) o sin nube, queda en el
   navegador de quien lo tilda: la app anda igual y nada se rompe.
   ================================================================== */

const LOCAL = "apicanta:chequeos-finanzas";
/* Quien tilda avisa a las otras copias de la pantalla (el menú cuenta los días sin cerrar) para que no queden atrasadas. */
const EVENTO = "apicanta:chequeos-finanzas:cambio";
const DIAS_ATRAS = 120;

const leerLocal = (): Chequeos => {
  try { return JSON.parse(localStorage.getItem(LOCAL) ?? "{}") as Chequeos; } catch { return {}; }
};
const escribirLocal = (c: Chequeos) => { try { localStorage.setItem(LOCAL, JSON.stringify(c)); } catch { /* modo privado */ } };

/* Si la tabla no está (o es la de antes, sin la columna del cierre del día), no se insiste en esta visita. */
let sinTabla = false;
let sinEstado = false;
const faltaTabla = (error: { code?: string } | null) => error?.code === "PGRST205" || error?.code === "42P01";
const faltaColumna = (error: { code?: string } | null) => error?.code === "42703" || error?.code === "PGRST204";

export function useChequeos(): {
  chequeos: Chequeos; cargando: boolean;
  marcar: (clave: string, nota?: string, estado?: string) => void; desmarcar: (clave: string) => void;
} {
  const yo = useUsuarioActual();
  const [local, setLocal] = useState<Chequeos>({});
  const [remoto, setRemoto] = useState<Chequeos>({});
  const [cargando, setCargando] = useState(true);

  const traer = useCallback(async () => {
    const base = nube;
    if (!base || sinTabla) { setCargando(false); return; }
    const desde = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString();
    const pedir = async (columnas: string): Promise<{ data: unknown[] | null; error: { code?: string } | null }> =>
      base.from("chequeos_finanzas").select(columnas).gte("en", desde);
    let r = await pedir(sinEstado ? "clave,por,en,nota" : "clave,por,en,nota,estado");
    if (r.error && faltaColumna(r.error) && !sinEstado) {
      sinEstado = true;
      r = await pedir("clave,por,en,nota");
    }
    if (r.error) { if (faltaTabla(r.error)) sinTabla = true; setCargando(false); return; }
    const m: Chequeos = {};
    for (const f of (r.data ?? []) as unknown as { clave: string; por?: string | null; en: string; nota?: string | null; estado?: string | null }[]) {
      m[String(f.clave)] = { por: f.por ?? undefined, en: String(f.en), nota: f.nota ?? undefined, ...(f.estado ? { estado: f.estado } : {}) };
    }
    setRemoto(m);
    setCargando(false);
  }, []);

  useEffect(() => {
    setLocal(leerLocal());
    void traer();
    /* Lo que tildó otra persona aparece al volver a esta pestaña. */
    const alVolver = () => { if (document.visibilityState === "visible") void traer(); };
    const alCambiar = () => { setLocal(leerLocal()); void traer(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener(EVENTO, alCambiar);
    return () => { document.removeEventListener("visibilitychange", alVolver); window.removeEventListener(EVENTO, alCambiar); };
  }, [traer]);

  const marcar = useCallback((clave: string, nota?: string, estado?: string) => {
    const c: Chequeo = { por: yo.nombre, en: new Date().toISOString(), ...(nota ? { nota } : {}), ...(estado ? { estado } : {}) };
    setLocal((x) => { const n = { ...x, [clave]: c }; escribirLocal(n); return n; });
    window.dispatchEvent(new Event(EVENTO));
    if (nube && !sinTabla) {
      const fila = { clave, por: c.por, en: c.en, nota: c.nota ?? null, ...(sinEstado ? {} : { estado: c.estado ?? null }) };
      void nube.from("chequeos_finanzas").upsert(fila, { onConflict: "clave" })
        .then(({ error }) => { if (faltaTabla(error)) sinTabla = true; else if (faltaColumna(error)) sinEstado = true; else if (!error) { setRemoto((x) => ({ ...x, [clave]: c })); window.dispatchEvent(new Event(EVENTO)); } });
    }
  }, [yo.nombre]);

  const desmarcar = useCallback((clave: string) => {
    setLocal((x) => { const n = { ...x }; delete n[clave]; escribirLocal(n); return n; });
    setRemoto((x) => { const n = { ...x }; delete n[clave]; return n; });
    window.dispatchEvent(new Event(EVENTO));
    if (nube && !sinTabla) void nube.from("chequeos_finanzas").delete().eq("clave", clave).then(({ error }) => { if (faltaTabla(error)) sinTabla = true; });
  }, []);

  /* Lo de la base manda sobre lo local; lo local cubre lo que todavía no llegó (o no hay tabla). */
  const chequeos = useMemo(() => ({ ...local, ...remoto }), [local, remoto]);
  return { chequeos, cargando, marcar, desmarcar };
}
