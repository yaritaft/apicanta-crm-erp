"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { acciones } from "@/lib/store";
import { nube } from "@/lib/supabase";
import type { Webinar } from "@/lib/types";
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

/* ---------- Realtime ----------
   En vez de preguntar cada tantos segundos, la pantalla se suscribe a los
   cambios de la base (supabase/realtime-webinars.sql): cuando entra una
   agenda de Calendly, el cron guarda un minuto del vivo o actualiza un
   webinar, Supabase avisa y se vuelve a pedir en el momento. Varios avisos
   juntos (el chat llega de a tandas) se juntan en uno. */

export interface Escucha { tabla: string; filtro?: string }

export function useAlCambiar(escuchas: Escucha[], alCambiar: (fila?: Record<string, unknown>) => void) {
  const clave = escuchas.map((x) => `${x.tabla}:${x.filtro ?? ""}`).join("|");
  const ref = useRef(alCambiar);
  ref.current = alCambiar;
  useEffect(() => {
    if (!nube || !clave) return;
    const db = nube;
    let espera: number | undefined;
    const canal = db.channel(`apicanta:${clave}:${Math.random().toString(36).slice(2, 8)}`);
    for (const e of clave.split("|")) {
      const [tabla, filtro] = e.split(":");
      canal.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: tabla, ...(filtro ? { filter: filtro } : {}) },
        (p: { new?: Record<string, unknown> }) => {
          window.clearTimeout(espera);
          espera = window.setTimeout(() => ref.current(p.new), 400);
        },
      );
    }
    /* El estado de la suscripción queda en la consola: si Realtime no
       conecta, se ve acá (y el respaldo de cada dos minutos sigue andando). */
    canal.subscribe((estado, err) => {
      if (estado !== "SUBSCRIBED") console.warn("[realtime]", clave, estado, err?.message ?? "");
      else console.info("[realtime] escuchando", clave);
    });
    return () => { window.clearTimeout(espera); void db.removeChannel(canal); };
  }, [clave]);
}

/* Por si Realtime se corta (una red que bloquea websockets): igual se
   vuelve a pedir, pero una vez por hora, para no llenar de pedidos a
   Supabase ni a Vercel. */
const RESPALDO_MS = 3_600_000;

function usePedido<T>(ruta: string | null, cadaMs?: number, escuchas: Escucha[] = []): Estado<T> & { recargar: () => void } {
  const [estado, setEstado] = useState<Estado<T>>({ estado: "cargando" });
  const [vuelta, setVuelta] = useState(0);
  useAlCambiar(ruta ? escuchas : [], () => setVuelta((v) => v + 1));

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
  const f = `videoId=eq.${videoId}`;
  return usePedido<DatosVivo>(
    `/api/youtube/vivo?video=${encodeURIComponent(videoId)}`,
    cadaMs && nube ? RESPALDO_MS : cadaMs,
    [{ tabla: "yt_muestras", filtro: f }, { tabla: "yt_chat", filtro: f }, { tabla: "yt_estado", filtro: f }],
  );
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

/* Cuántos miran ahora: cada 15 segundos mientras `activo` (sólo con el
   vivo en el aire: YouTube no avisa, hay que preguntarle). */
export function useAhora(videoId: string, activo: boolean) {
  return usePedido<Ahora>(activo ? `/api/youtube/ahora?video=${encodeURIComponent(videoId)}` : null, 15_000);
}

export interface WebinarEnVivo { videoId: string; webinarId: string; inicio: string | null; espectadores?: number }

/* Qué webinars están en el aire (según el cron): al instante. */
export function useEnVivo() {
  return usePedido<{ vivos: WebinarEnVivo[] }>("/api/youtube/en-vivo", nube ? RESPALDO_MS : 30_000, [{ tabla: "yt_estado" }]);
}

/* ---------- Agendas de Calendly desde el pitch ---------- */

export interface AgendaCalendly {
  id: string; nombre: string; agendadaEn: string; llamada: string; estado: string; closer?: string; delWebinar: boolean;
}

/* Al instante, mientras haya `desde` (el pitch marcado y el vivo en el aire). */
export function useAgendasDesde(desde: string | null, activo: boolean) {
  return usePedido<{ agendas: AgendaCalendly[] }>(
    desde && activo ? `/api/calendly/agendas?desde=${encodeURIComponent(desde)}` : null,
    nube ? RESPALDO_MS : 10_000, [{ tabla: "sesiones" }],
  );
}

/* Las agendas de un webinar, en el vivo o después: al instante, cuando
   entra o cambia una agenda. */
export function useAgendasWebinar(webinarId: string) {
  return usePedido<import("@/lib/agendas-webinar").ResumenAgendas>(
    `/api/calendly/agendas?webinar=${encodeURIComponent(webinarId)}`,
    nube ? RESPALDO_MS : 15_000, [{ tabla: "sesiones" }],
  );
}

export async function atribuirAgenda(id: string, momento: "vivo" | "despues" | "fuera" | "auto", webinarId: string, quien?: string): Promise<string | null> {
  try {
    const r = await fetch("/api/calendly/agendas", {
      method: "PATCH",
      headers: { ...(await cabeceras()), "Content-Type": "application/json" },
      body: JSON.stringify({ id, momento, webinarId, quien }),
    });
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return r.ok ? null : j?.error ?? "No pude cambiar la atribución.";
  } catch {
    return "No hay conexión: no pude cambiar la atribución.";
  }
}

/* ---------- Lo que el cron completa solo, al día ----------
   La app carga los datos una vez al abrir. Las llamadas (Calendly), los
   asistentes, el estado y las vistas de la grabación los escriben el cron
   o el webhook en la base mientras la pantalla está abierta: Realtime avisa
   al instante y se aplican en memoria (sin volver a escribirlos), así el
   embudo, la planilla y las tarjetas dicen lo mismo que las agendas. */

const CAMPOS_DEL_CRON = ["estado", "asistentes", "llamadasVivo", "llamadasPosterior", "llamadasCanceladas", "extra"] as const;

function aplicar(filas: Record<string, unknown>[]) {
  acciones.aplicarDeLaNube<Webinar>("webinars", Object.fromEntries(
    filas.filter((f) => typeof f.id === "string").map((f) => [
      f.id as string,
      Object.fromEntries(CAMPOS_DEL_CRON.filter((k) => k in f).map((k) => [k, f[k]])) as Partial<Webinar>,
    ]),
  ));
}

export function useWebinarsAlDia(ids: string[]) {
  const clave = [...ids].sort().join(",");
  const traer = useCallback(async () => {
    if (!nube || !clave) return;
    const r = await nube.from("webinars").select(`id, ${CAMPOS_DEL_CRON.join(", ")}`).in("id", clave.split(","));
    if (!r.error && r.data) aplicar(r.data as unknown as Record<string, unknown>[]);
  }, [clave]);

  /* Al entrar, una vez; después, cada cambio que avise Realtime (y de
     respaldo, una vez por hora). */
  useEffect(() => {
    void traer();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void traer(); }, RESPALDO_MS);
    return () => window.clearInterval(t);
  }, [traer]);

  /* El aviso es sólo el gatillo: con RLS puede llegar sin la fila, así que
     se vuelve a pedir lo que cambió (una consulta chiquita). */
  useAlCambiar(clave ? [{ tabla: "webinars" }] : [], (fila) => {
    if (fila && typeof fila.id === "string" && !clave.split(",").includes(fila.id)) return;
    void traer();
  });
}
