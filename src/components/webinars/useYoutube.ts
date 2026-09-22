"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "@/lib/supabase";
import type { DatosYoutube, VivosDelCanal } from "@/lib/youtube";

/* ==================================================================
   Los datos de un video, pedidos a NUESTRA ruta /api/youtube (nunca a
   Google desde el navegador: la clave vive en el servidor).

   La ruta sólo le contesta al equipo, así que se manda la sesión de
   Supabase. Lo que ya se trajo queda en memoria mientras la pestaña
   esté abierta: volver a la ficha no vuelve a pedir nada.
   ================================================================== */

export type EstadoYoutube =
  | { estado: "sin-video" }
  | { estado: "cargando" }
  | { estado: "listo"; datos: DatosYoutube }
  | { estado: "error"; error: string; noExiste?: boolean };

const memoria = new Map<string, DatosYoutube>();

class ErrorYoutube extends Error {
  noExiste: boolean;
  constructor(mensaje: string, noExiste = false) {
    super(mensaje);
    this.noExiste = noExiste;
  }
}

/* La sesión de Supabase: las rutas de YouTube sólo le contestan al equipo. */
async function cabeceras(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (nube) {
    const { data } = await nube.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function pedir(id: string): Promise<DatosYoutube> {
  const headers = await cabeceras();
  let r: Response;
  try {
    r = await fetch(`/api/youtube?id=${encodeURIComponent(id)}`, { headers });
  } catch {
    throw new ErrorYoutube("No hay conexión: no pude traer los datos de YouTube.");
  }
  const cuerpo = (await r.json().catch(() => null)) as (DatosYoutube & { error?: string }) | null;
  if (r.status === 401) throw new ErrorYoutube("Tu sesión venció. Volvé a entrar para ver los datos de YouTube.");
  if (!r.ok || !cuerpo || cuerpo.error) {
    throw new ErrorYoutube(cuerpo?.error ?? "No pude traer los datos de YouTube.", r.status === 404);
  }
  return cuerpo;
}

export function useYoutube(id: string | null): EstadoYoutube & { recargar: () => void } {
  const [estado, setEstado] = useState<EstadoYoutube>(() => {
    if (!id) return { estado: "sin-video" };
    const ya = memoria.get(id);
    return ya ? { estado: "listo", datos: ya } : { estado: "cargando" };
  });
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!id) { setEstado({ estado: "sin-video" }); return; }
    const ya = memoria.get(id);
    if (ya) { setEstado({ estado: "listo", datos: ya }); return; }
    let vivo = true;
    setEstado({ estado: "cargando" });
    pedir(id)
      .then((datos) => {
        memoria.set(id, datos);
        if (vivo) setEstado({ estado: "listo", datos });
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        setEstado({
          estado: "error",
          error: err instanceof Error ? err.message : "No pude traer los datos de YouTube.",
          noExiste: err instanceof ErrorYoutube && err.noExiste,
        });
      });
    return () => { vivo = false; };
  }, [id, vuelta]);

  /* Volver a preguntar, salteando la memoria: las vistas de un vivo cambian. */
  const recargar = useCallback(() => {
    if (id) memoria.delete(id);
    setVuelta((v) => v + 1);
  }, [id]);

  return { ...estado, recargar };
}

/* Para el asistente: los datos del video sin estado, para confirmar que el
   link es el que se quería pegar y completar solo el título (y la fecha del
   vivo, cuando está la clave). null = no se pudo. */
export async function datosDeYoutube(id: string): Promise<DatosYoutube | null> {
  const ya = memoria.get(id);
  if (ya) return ya;
  try {
    const datos = await pedir(id);
    memoria.set(id, datos);
    return datos;
  } catch {
    return null;
  }
}

export async function tituloDeYoutube(id: string): Promise<string | null> {
  return (await datosDeYoutube(id))?.titulo ?? null;
}

/* ---------- Los vivos del canal ----------
   Para proponerle a un webinar sin link el vivo de su día. El canal sale
   de los videos que ya tienen otros webinars (`conocidos`). Queda en
   memoria mientras la pestaña esté abierta: pasar de un webinar a otro no
   vuelve a gastar cuota de YouTube. */

export type EstadoVivos =
  | { estado: "sin-videos" }
  | { estado: "cargando" }
  | { estado: "listo"; datos: VivosDelCanal }
  | { estado: "sin-clave" }
  | { estado: "error"; error: string };

const memoriaVivos = new Map<string, VivosDelCanal>();

export function useVivosDelCanal(conocidos: string[]): EstadoVivos {
  const clave = conocidos.slice(0, 10).join(",");
  const [estado, setEstado] = useState<EstadoVivos>(() => {
    if (!clave) return { estado: "sin-videos" };
    const ya = memoriaVivos.get(clave);
    return ya ? { estado: "listo", datos: ya } : { estado: "cargando" };
  });

  useEffect(() => {
    if (!clave) { setEstado({ estado: "sin-videos" }); return; }
    const ya = memoriaVivos.get(clave);
    if (ya) { setEstado({ estado: "listo", datos: ya }); return; }
    let vivo = true;
    setEstado({ estado: "cargando" });
    (async () => {
      try {
        const r = await fetch(`/api/youtube/vivos?videos=${encodeURIComponent(clave)}`, { headers: await cabeceras() });
        const cuerpo = (await r.json().catch(() => null)) as (VivosDelCanal & { error?: string; sinClave?: boolean }) | null;
        if (!vivo) return;
        if (cuerpo?.sinClave) { setEstado({ estado: "sin-clave" }); return; }
        if (!r.ok || !cuerpo || cuerpo.error) {
          setEstado({ estado: "error", error: cuerpo?.error ?? "No pude buscar los vivos del canal." });
          return;
        }
        memoriaVivos.set(clave, cuerpo);
        setEstado({ estado: "listo", datos: cuerpo });
      } catch {
        if (vivo) setEstado({ estado: "error", error: "No hay conexión: no pude buscar los vivos del canal." });
      }
    })();
    return () => { vivo = false; };
  }, [clave]);

  return estado;
}
