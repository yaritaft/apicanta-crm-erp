/* ==================================================================
   Hablar con la YouTube Data API v3, del lado del servidor.

   Lo usan /api/youtube (los datos de un video) y /api/youtube/vivos
   (los vivos del canal). La clave viaja sólo en la URL que se le pide a
   Google, que nunca se loguea ni llega al navegador.
   ================================================================== */

export const MEDIA_HORA = 1800;
export const API = "https://www.googleapis.com/youtube/v3";
export const ESPERA_MS = 8000;

export type Miniaturas = Record<string, { url?: string } | undefined>;

export interface VideoApi {
  snippet?: {
    title?: string; description?: string; publishedAt?: string;
    channelId?: string; channelTitle?: string;
    liveBroadcastContent?: "live" | "upcoming" | "none";
    thumbnails?: Miniaturas;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  liveStreamingDetails?: {
    actualStartTime?: string; actualEndTime?: string;
    scheduledStartTime?: string; concurrentViewers?: string;
  };
  contentDetails?: { duration?: string };
}

export interface CanalApi {
  snippet?: { title?: string; customUrl?: string; thumbnails?: Miniaturas };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
}

export interface ErrorApi {
  error?: {
    message?: string;
    errors?: { reason?: string }[];
    details?: { reason?: string }[];
  };
}

/* Google manda los números como texto. Lo que no viene (likes ocultos,
   comentarios cerrados) queda undefined: no es un cero. */
export const numero = (s?: string) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

export const mejor = (m: Miniaturas | undefined, orden: string[]) =>
  orden.map((k) => m?.[k]?.url).find(Boolean);

export async function pedirApi<T>(
  recurso: "videos" | "channels" | "playlistItems" | "search", params: Record<string, string>, clave: string,
  cacheSeg: number = MEDIA_HORA,
): Promise<{ ok: true; items: T[] } | { ok: false; status: number; error: string }> {
  const q = new URLSearchParams({ ...params, key: clave });
  let r: Response;
  try {
    r = await fetch(`${API}/${recurso}?${q}`, {
      next: { revalidate: cacheSeg },
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    return { ok: false, status: 504, error: "YouTube no contestó a tiempo." };
  }
  const cuerpo = (await r.json().catch(() => null)) as ({ items?: T[] } & ErrorApi) | null;
  if (!r.ok) {
    const motivos = [
      ...(cuerpo?.error?.errors ?? []).map((x) => x.reason),
      ...(cuerpo?.error?.details ?? []).map((x) => x.reason),
    ].filter(Boolean).join(",");
    /* Al log va el motivo, nunca la URL: la URL lleva la clave. */
    console.error(`[youtube] ${recurso} respondió ${r.status} (${motivos || "sin motivo"})`);
    return { ok: false, status: 502, error: explicar(r.status, motivos, cuerpo?.error?.message ?? "") };
  }
  return { ok: true, items: cuerpo?.items ?? [] };
}

/* Los errores de Google, dichos para quien los tiene que arreglar. */
export function explicar(status: number, motivos: string, mensaje: string): string {
  const m = `${motivos} ${mensaje}`.toLowerCase();
  if (/quota|ratelimit|dailylimit/.test(m)) return "Se terminó la cuota diaria de YouTube: mañana vuelve a andar.";
  if (/keyinvalid|api key not valid|api_key_invalid/.test(m)) return "La clave de YouTube no es válida.";
  if (/accessnotconfigured|service_disabled|has not been used|is disabled/.test(m)) {
    return "La clave es de un proyecto de Google que no tiene activada la YouTube Data API v3.";
  }
  if (/referer|referrer/.test(m)) {
    return "La clave está limitada a sitios web y el servidor no es uno: limitala sólo a la YouTube Data API v3.";
  }
  if (/api_key_service_blocked|blocked/.test(m)) return "La clave no tiene permiso para la YouTube Data API v3.";
  return `YouTube respondió con un error (${status}).`;
}
