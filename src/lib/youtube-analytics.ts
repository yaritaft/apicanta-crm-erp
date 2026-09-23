import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { nubeServidor } from "./servidor";
import type { AnalyticsVideo, FilaReparto } from "./youtube";

/* ==================================================================
   YouTube Analytics, del lado del servidor.

   La clave de la API sólo ve lo público. La retención (en qué minuto se
   va la gente), el tiempo de reproducción, de dónde llegaron, países,
   edades y dispositivos los ve sólo el dueño del canal. Por eso alguien
   con acceso al canal de Hackear IT entra una vez con Google y le da
   permiso de SÓLO LECTURA a la app; el permiso (un refresh token) queda
   en yt_conexion, que no se lee desde el navegador.

   Hace falta un cliente OAuth de Google (GOOGLE_CLIENT_ID y
   GOOGLE_CLIENT_SECRET) con la YouTube Analytics API y la YouTube Data
   API activadas, y esta URL de redirección autorizada:
     https://<dominio>/api/youtube/callback
   ================================================================== */

export const PERMISOS = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const TOKEN = "https://oauth2.googleapis.com/token";
const REPORTES = "https://youtubeanalytics.googleapis.com/v2/reports";
const ESPERA_MS = 10_000;

export const analyticsConfigurado = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

export const urlRedireccion = (origen: string) => `${origen}/api/youtube/callback`;

/* ---------- El state del OAuth ----------
   Firmado con el secreto del cliente: el callback sólo acepta un state que
   salió de /api/youtube/conectar (que sólo le contesta al equipo) en los
   últimos 10 minutos. Lleva adónde volver después. */

function firma(texto: string): string {
  return createHmac("sha256", process.env.GOOGLE_CLIENT_SECRET ?? "").update(texto).digest("base64url");
}

export function crearEstado(volver: string, quien?: string): string {
  const cuerpo = Buffer.from(JSON.stringify({ n: randomUUID(), exp: Date.now() + 10 * 60_000, v: volver, q: quien })).toString("base64url");
  return `${cuerpo}.${firma(cuerpo)}`;
}

export function leerEstado(estado: string | null): { volver: string; quien?: string } | null {
  if (!estado) return null;
  const [cuerpo, f] = estado.split(".");
  if (!cuerpo || !f) return null;
  const esperada = Buffer.from(firma(cuerpo));
  const recibida = Buffer.from(f);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    const d = JSON.parse(Buffer.from(cuerpo, "base64url").toString()) as { exp: number; v: string; q?: string };
    if (Date.now() > d.exp) return null;
    /* Sólo rutas de la app: nada de volver a otro dominio. */
    const volver = typeof d.v === "string" && d.v.startsWith("/") && !d.v.startsWith("//") ? d.v : "/webinars";
    return { volver, quien: d.q };
  } catch {
    return null;
  }
}

/* ---------- Tokens ---------- */

export async function canjearCodigo(code: string, origen: string): Promise<{ refresh?: string; acceso?: string; error?: string }> {
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: urlRedireccion(origen),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_MS),
  }).catch(() => null);
  if (!r) return { error: "Google no contestó a tiempo." };
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; error?: string };
  if (!r.ok) return { error: j.error ?? `Google respondió ${r.status}` };
  return { refresh: j.refresh_token, acceso: j.access_token };
}

let enMemoria: { token: string; vence: number; refresh: string } | null = null;

async function tokenDeAcceso(refresh: string): Promise<string | { error: string }> {
  if (enMemoria && enMemoria.refresh === refresh && enMemoria.vence > Date.now() + 60_000) return enMemoria.token;
  const r = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(ESPERA_MS),
  }).catch(() => null);
  if (!r) return { error: "Google no contestó a tiempo." };
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) {
    return {
      error: j.error === "invalid_grant"
        ? "El permiso de YouTube se venció o lo sacaron. Hay que volver a conectar el canal."
        : "No pude renovar el permiso de YouTube.",
    };
  }
  enMemoria = { token: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000, refresh };
  return j.access_token;
}

export async function canalPropio(acceso: string): Promise<{ id?: string; nombre?: string }> {
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${acceso}` }, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
  }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { items?: { id?: string; snippet?: { title?: string } }[] } | null;
  const c = j?.items?.[0];
  return { id: c?.id, nombre: c?.snippet?.title };
}

export interface Conexion {
  refreshToken: string; canalId?: string; canalNombre?: string; conectadoPor?: string; conectadoEn?: string;
}

export async function conexion(): Promise<Conexion | null> {
  const db = nubeServidor();
  if (!db) return null;
  const r = await db.from("yt_conexion")
    .select("refreshToken, canalId, canalNombre, conectadoPor, conectadoEn").eq("id", "canal").maybeSingle();
  if (r.error || !r.data) return null;
  return r.data as Conexion;
}

/* ---------- Reportes ---------- */

type Filas = { cabeceras: string[]; filas: (string | number)[][] };

async function reporte(acceso: string, params: Record<string, string>): Promise<Filas | { error: string }> {
  const q = new URLSearchParams({ ids: "channel==MINE", ...params });
  const r = await fetch(`${REPORTES}?${q}`, {
    headers: { Authorization: `Bearer ${acceso}` }, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
  }).catch(() => null);
  if (!r) return { error: "timeout" };
  const j = (await r.json().catch(() => null)) as
    { columnHeaders?: { name: string }[]; rows?: (string | number)[][]; error?: { message?: string } } | null;
  if (!r.ok) {
    /* Al log va el motivo, no el token. */
    console.error(`[youtube/analytics] ${params.metrics} ${params.dimensions ?? ""} → ${r.status} ${j?.error?.message ?? ""}`);
    return { error: j?.error?.message ?? String(r.status) };
  }
  return { cabeceras: (j?.columnHeaders ?? []).map((c) => c.name), filas: j?.rows ?? [] };
}

const valor = (f: Filas, fila: (string | number)[], col: string): number | undefined => {
  const i = f.cabeceras.indexOf(col);
  const v = i >= 0 ? Number(fila[i]) : NaN;
  return Number.isFinite(v) ? v : undefined;
};

function reparto(f: Filas | { error: string }, dim: string, met: string, met2?: string): FilaReparto[] | null {
  if ("error" in f) return null;
  const i = f.cabeceras.indexOf(dim);
  return f.filas.map((fila) => ({
    clave: String(fila[i] ?? ""),
    valor: valor(f, fila, met) ?? 0,
    valor2: met2 ? valor(f, fila, met2) : undefined,
  })).filter((x) => x.valor > 0);
}

export async function analyticsDeVideo(videoId: string, desde: string): Promise<AnalyticsVideo | { error: string }> {
  const c = await conexion();
  if (!c) return { error: "El canal no está conectado." };
  const acceso = await tokenDeAcceso(c.refreshToken);
  if (typeof acceso !== "string") return acceso;

  const hasta = new Date().toISOString().slice(0, 10);
  const base = { startDate: desde, endDate: hasta, filters: `video==${videoId}` };
  const [resumen, concurrentes, porMinuto, retencion, vivo, fuentes, paises, demografia, dispositivos] = await Promise.all([
    reporte(acceso, { ...base, metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares" }),
    reporte(acceso, { ...base, metrics: "averageConcurrentViewers,peakConcurrentViewers" }),
    reporte(acceso, { ...base, dimensions: "livestreamPosition", metrics: "averageConcurrentViewers,peakConcurrentViewers", sort: "livestreamPosition" }),
    reporte(acceso, { ...base, dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio,relativeRetentionPerformance" }),
    reporte(acceso, { ...base, dimensions: "liveOrOnDemand", metrics: "views,estimatedMinutesWatched" }),
    reporte(acceso, { ...base, dimensions: "insightTrafficSourceType", metrics: "views,estimatedMinutesWatched", sort: "-views" }),
    reporte(acceso, { ...base, dimensions: "country", metrics: "views,estimatedMinutesWatched", sort: "-views", maxResults: "12" }),
    reporte(acceso, { ...base, dimensions: "ageGroup,gender", metrics: "viewerPercentage" }),
    reporte(acceso, { ...base, dimensions: "deviceType", metrics: "views,estimatedMinutesWatched", sort: "-views" }),
  ]);

  /* Si falla el resumen, falla todo: el permiso no alcanza o el video no es del canal. */
  if ("error" in resumen) {
    return { error: /forbidden|permission|not.*owner/i.test(resumen.error)
      ? "Ese video no es del canal conectado, o el permiso no alcanza para verlo."
      : `YouTube Analytics no quiso dar los números (${resumen.error}).` };
  }

  const faltan: string[] = [];
  const f0 = resumen.filas[0] ?? [];
  const c0 = "error" in concurrentes ? null : concurrentes.filas[0];
  const pm = "error" in porMinuto ? null : porMinuto;

  /* Un video subido (no un vivo) no tiene espectadores concurrentes: YouTube
     contesta con error y eso no es "algo que falta". Sólo se avisa si el
     video tuvo vistas en vivo. */
  const repVivo = reparto(vivo, "liveOrOnDemand", "views", "estimatedMinutesWatched");
  const fueVivo = (repVivo ?? []).some((f) => f.clave === "LIVE" && f.valor > 0);
  if (fueVivo && "error" in concurrentes) faltan.push("espectadores concurrentes");
  if (fueVivo && !pm) faltan.push("espectadores minuto a minuto");

  const ret = "error" in retencion ? null : retencion;
  if (!ret) faltan.push("retención");

  /* Edades y géneros llegan cruzados (18-24 mujer, 18-24 hombre…): se suman por separado. */
  const edades = new Map<string, number>();
  const generos = new Map<string, number>();
  if (!("error" in demografia)) {
    const ia = demografia.cabeceras.indexOf("ageGroup");
    const ig = demografia.cabeceras.indexOf("gender");
    for (const fila of demografia.filas) {
      const p = valor(demografia, fila, "viewerPercentage") ?? 0;
      edades.set(String(fila[ia]), (edades.get(String(fila[ia])) ?? 0) + p);
      generos.set(String(fila[ig]), (generos.get(String(fila[ig])) ?? 0) + p);
    }
  } else faltan.push("edades y géneros");

  const lista = (m: Map<string, number>) => [...m.entries()].map(([clave, v]) => ({ clave, valor: v })).sort((a, b) => b.valor - a.valor);
  const o = (x: FilaReparto[] | null, nombre: string) => { if (!x) faltan.push(nombre); return x ?? []; };

  return {
    traidoEn: new Date().toISOString(),
    desde,
    hasta,
    resumen: {
      vistas: valor(resumen, f0, "views"),
      minutosVistos: valor(resumen, f0, "estimatedMinutesWatched"),
      duracionMediaSeg: valor(resumen, f0, "averageViewDuration"),
      porcentajeMedio: valor(resumen, f0, "averageViewPercentage"),
      suscriptoresGanados: valor(resumen, f0, "subscribersGained"),
      suscriptoresPerdidos: valor(resumen, f0, "subscribersLost"),
      compartidos: valor(resumen, f0, "shares"),
      picoConcurrentes: c0 && !("error" in concurrentes) ? valor(concurrentes, c0, "peakConcurrentViewers") : undefined,
      promedioConcurrentes: c0 && !("error" in concurrentes) ? valor(concurrentes, c0, "averageConcurrentViewers") : undefined,
    },
    retencion: ret
      ? ret.filas.map((fila) => ({
          ratio: valor(ret, fila, "elapsedVideoTimeRatio") ?? 0,
          mirando: valor(ret, fila, "audienceWatchRatio") ?? 0,
          relativa: valor(ret, fila, "relativeRetentionPerformance"),
        })).sort((a, b) => a.ratio - b.ratio)
      : [],
    porMinuto: pm
      ? pm.filas.map((fila) => ({
          min: valor(pm, fila, "livestreamPosition") ?? 0,
          promedio: valor(pm, fila, "averageConcurrentViewers"),
          pico: valor(pm, fila, "peakConcurrentViewers"),
        })).sort((a, b) => a.min - b.min)
      : [],
    vivoVsGrabacion: o(repVivo, "vivo contra grabación"),
    fuentes: o(reparto(fuentes, "insightTrafficSourceType", "views", "estimatedMinutesWatched"), "fuentes de tráfico"),
    paises: o(reparto(paises, "country", "views", "estimatedMinutesWatched"), "países"),
    edades: lista(edades),
    generos: lista(generos),
    dispositivos: o(reparto(dispositivos, "deviceType", "views", "estimatedMinutesWatched"), "dispositivos"),
    faltan,
  };
}
