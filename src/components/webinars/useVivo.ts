"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComentariosYoutube, DatosVivo, EstadoAnalytics } from "@/lib/youtube";
import { cabeceras } from "./useYoutube";

/* ==================================================================
   Lo del vivo, pedido a nuestras rutas:
   - /api/youtube/vivo: los minutos y el chat que guardó el cron.
   - /api/youtube/comentarios: los comentarios del video.
   - /api/youtube/analytics: YouTube Analytics, si el canal está conectado.

   Mientras el vivo está en el aire se vuelve a pedir cada minuto, que es
   lo que tarda el cron en guardar la muestra siguiente.
   ================================================================== */

type Estado<T> =
  | { estado: "cargando" }
  | { estado: "listo"; datos: T }
  | { estado: "error"; error: string; sinClave?: boolean };

async function pedirJson<T>(ruta: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, { headers: await cabeceras() });
  } catch {
    throw Object.assign(new Error("No hay conexión: no pude traer los datos de YouTube."), { sinClave: false });
  }
  const cuerpo = (await r.json().catch(() => null)) as (T & { error?: string; sinClave?: boolean }) | null;
  if (r.status === 401) throw new Error("Tu sesión venció. Volvé a entrar para ver los datos de YouTube.");
  if (!r.ok || !cuerpo || cuerpo.error) {
    throw Object.assign(new Error(cuerpo?.error ?? "No pude traer los datos de YouTube."), { sinClave: Boolean(cuerpo?.sinClave) });
  }
  return cuerpo;
}

function usePedido<T>(ruta: string | null, cadaMs?: number): Estado<T> & { recargar: () => void } {
  const [estado, setEstado] = useState<Estado<T>>({ estado: "cargando" });
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    pedirJson<T>(ruta)
      .then((datos) => { if (vivo) setEstado({ estado: "listo", datos }); })
      .catch((err: Error & { sinClave?: boolean }) => {
        if (!vivo) return;
        /* Un error en una recarga no borra lo que ya se estaba viendo. */
        setEstado((antes) => (antes.estado === "listo" ? antes : { estado: "error", error: err.message, sinClave: err.sinClave }));
      });
    return () => { vivo = false; };
  }, [ruta, vuelta]);

  useEffect(() => {
    if (!ruta || !cadaMs) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") setVuelta((v) => v + 1);
    }, cadaMs);
    return () => window.clearInterval(t);
  }, [ruta, cadaMs]);

  const recargar = useCallback(() => setVuelta((v) => v + 1), []);
  return { ...estado, recargar };
}

/* cadaMs: cada cuánto volver a pedir (en el aire, cada 20 s: el cron guarda
   una muestra por minuto y así aparece enseguida). */
export function useDatosVivo(videoId: string, cadaMs?: number) {
  return usePedido<DatosVivo>(`/api/youtube/vivo?video=${encodeURIComponent(videoId)}`, cadaMs);
}

export function useComentarios(videoId: string) {
  return usePedido<ComentariosYoutube>(`/api/youtube/comentarios?video=${encodeURIComponent(videoId)}`);
}

export function useAnalytics(videoId: string, desde: string) {
  const [fresco, setFresco] = useState(false);
  const r = usePedido<EstadoAnalytics>(
    `/api/youtube/analytics?video=${encodeURIComponent(videoId)}&desde=${desde}${fresco ? "&fresco=1" : ""}`,
  );
  return { ...r, actualizar: () => (fresco ? r.recargar() : setFresco(true)) };
}

/* Manda a Google a quien tenga acceso al canal. Vuelve a la misma pantalla. */
export async function conectarAnalytics(quien?: string): Promise<string | null> {
  try {
    const r = await fetch("/api/youtube/conectar", {
      method: "POST",
      headers: { ...(await cabeceras()), "Content-Type": "application/json" },
      /* Con la búsqueda: desde Ajustes vuelve a ?seccion=integraciones. */
      body: JSON.stringify({ volver: window.location.pathname + window.location.search, quien }),
    });
    const j = (await r.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!r.ok || !j?.url) return j?.error ?? "No pude arrancar la conexión con YouTube.";
    window.location.assign(j.url);
    return null;
  } catch {
    return "No hay conexión: no pude arrancar la conexión con YouTube.";
  }
}

/* ---------- Para Ajustes → Integraciones ---------- */

export interface EstadoConexionYoutube {
  hayClave: boolean;
  configurado: boolean;
  hayBase: boolean;
  conectado: boolean;
  canal: string | null;
  conectadoPor: string | null;
  conectadoEn: string | null;
}

export function useConexionYoutube() {
  return usePedido<EstadoConexionYoutube>("/api/youtube/conectar");
}

export async function desconectarAnalytics(): Promise<string | null> {
  try {
    const r = await fetch("/api/youtube/conectar", { method: "DELETE", headers: await cabeceras() });
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return r.ok ? null : j?.error ?? "No pude desconectar el canal.";
  } catch {
    return "No hay conexión: no pude desconectar el canal.";
  }
}

/* ---------- En vivo, ahora ---------- */

export interface Ahora {
  estado: "en-vivo" | "programado" | "terminado" | "video";
  espectadores?: number;
  vistas?: number;
  likes?: number;
  inicio?: string;
  fin?: string;
  t: string;
}

/* Cuántos miran ahora: cada 15 segundos mientras `activo`. */
export function useAhora(videoId: string, activo: boolean) {
  return usePedido<Ahora>(activo ? `/api/youtube/ahora?video=${encodeURIComponent(videoId)}` : null, 15_000);
}

export interface WebinarEnVivo { videoId: string; webinarId: string; inicio: string | null; espectadores?: number }

/* Qué webinars están en el aire (según el cron): cada 30 segundos. */
export function useEnVivo() {
  return usePedido<{ vivos: WebinarEnVivo[] }>("/api/youtube/en-vivo", 30_000);
}

/* ---------- Agendas de Calendly desde el pitch ---------- */

export interface AgendaCalendly {
  id: string; nombre: string; agendadaEn: string; llamada: string; estado: string; closer?: string; delWebinar: boolean;
}

/* Cada 10 segundos mientras haya `desde` (el pitch marcado y el vivo en el aire). */
export function useAgendasDesde(desde: string | null, activo: boolean) {
  return usePedido<{ agendas: AgendaCalendly[] }>(
    desde && activo ? `/api/calendly/agendas?desde=${encodeURIComponent(desde)}` : null, 10_000,
  );
}
