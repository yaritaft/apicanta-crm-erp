import { nubeServidor } from "./servidor";
import { idDeYoutube } from "./youtube";
import { numero, pedirApi, type VideoApi } from "./youtube-servidor";

/* ==================================================================
   Seguir los vivos: lo que hace /api/cron/youtube cada minuto.

   YouTube dice cuántos están mirando un vivo sólo en ese momento, y el
   chat sólo mientras está en el aire. Lo que no se guarda en el minuto
   se pierde. Por eso, cada minuto:

   1. Se buscan los webinars con video de YouTube que están cerca de su
      hora (una hora antes hasta seis después) o que la última vez
      estaban en el aire.
   2. Se le pregunta a YouTube por todos juntos (1 unidad de cuota cada
      50 videos) y, de los que están en el aire, se guarda la muestra:
      espectadores, vistas, likes y comentarios.
   3. Se lee el chat nuevo desde donde quedó la vez anterior (5 unidades).

   Y una vez por hora, los webinars de los últimos 30 días guardan una
   muestra de vistas, likes y comentarios, para ver cómo sigue la
   grabación: cada hora la primera semana, después una por día.

   Un vivo de dos horas gasta unas 800 unidades de las 10.000 diarias.
   ================================================================== */

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

interface FilaWebinar {
  id: string;
  titulo?: string;
  estado?: string;
  fecha: string;
  youtubeUrl?: string | null;
  enlaceReplay?: string | null;
}

interface FilaEstado {
  videoId: string;
  estado?: string | null;
  inicio?: string | null;
  fin?: string | null;
  liveChatId?: string | null;
  paginaChat?: string | null;
  ultimaMuestra?: string | null;
}

interface MensajeApi {
  id?: string;
  snippet?: {
    type?: string;
    publishedAt?: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
    superChatDetails?: { amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountDisplayString?: string };
  };
  authorDetails?: {
    channelId?: string; displayName?: string; profileImageUrl?: string;
    isChatOwner?: boolean; isChatModerator?: boolean;
  };
}

export interface ResultadoSeguimiento {
  mirados: number;
  enVivo: number;
  muestras: number;
  mensajes: number;
  errores: string[];
}

/* El mismo criterio que la ficha: el link propio; si nunca se cargó, el
   del replay. Un "" guardado es "sin video" a propósito. */
function videoDe(w: FilaWebinar): string | null {
  return idDeYoutube(w.youtubeUrl) ?? (w.youtubeUrl == null ? idDeYoutube(w.enlaceReplay) : null);
}

const alMinuto = (d: Date) => new Date(Math.floor(d.getTime() / MIN) * MIN).toISOString();

export async function seguirVivos(ahora = new Date()): Promise<ResultadoSeguimiento> {
  const res: ResultadoSeguimiento = { mirados: 0, enVivo: 0, muestras: 0, mensajes: 0, errores: [] };
  const db = nubeServidor();
  const clave = process.env.YOUTUBE_API_KEY?.trim();
  if (!db) { res.errores.push("Falta SUPABASE_SERVICE_ROLE_KEY."); return res; }
  if (!clave) { res.errores.push("Falta YOUTUBE_API_KEY."); return res; }

  const t = ahora.getTime();
  const rw = await db
    .from("webinars")
    .select("id, titulo, estado, fecha, youtubeUrl, enlaceReplay")
    .gte("fecha", new Date(t - 30 * DIA).toISOString())
    .lte("fecha", new Date(t + 6 * HORA).toISOString());
  if (rw.error) { res.errores.push(`webinars: ${rw.error.message}`); return res; }

  /* Un video puede estar en dos webinars (se pegó el mismo link): manda el
     más cercano a su hora. */
  const porVideo = new Map<string, FilaWebinar>();
  for (const w of (rw.data ?? []) as FilaWebinar[]) {
    const v = videoDe(w);
    if (!v) continue;
    const otro = porVideo.get(v);
    if (!otro || Math.abs(+new Date(w.fecha) - t) < Math.abs(+new Date(otro.fecha) - t)) porVideo.set(v, w);
  }
  if (porVideo.size === 0) return res;

  const re = await db.from("yt_estado").select("*").in("videoId", [...porVideo.keys()]);
  if (re.error) { res.errores.push(`yt_estado: ${re.error.message}`); return res; }
  const estados = new Map(((re.data ?? []) as FilaEstado[]).map((e) => [e.videoId, e]));

  /* Quiénes se miran en esta vuelta. */
  const cercaDeSuHora = (w: FilaWebinar) => {
    const f = +new Date(w.fecha);
    return t >= f - HORA && t <= f + 6 * HORA;
  };
  /* La grabación: cada hora la primera semana, una por día hasta los 30. */
  const tocaFoto = (w: FilaWebinar, e?: FilaEstado) => {
    const ultima = e?.ultimaMuestra ? +new Date(e.ultimaMuestra) : 0;
    const edad = t - +new Date(w.fecha);
    if (edad < 0) return false;
    return t - ultima >= (edad <= 7 * DIA ? HORA : DIA) - MIN;
  };
  const aMirar = [...porVideo.entries()].filter(([v, w]) => {
    const e = estados.get(v);
    return e?.estado === "en-vivo" || cercaDeSuHora(w) || tocaFoto(w, e);
  });
  res.mirados = aMirar.length;
  if (aMirar.length === 0) return res;

  const minuto = alMinuto(ahora);
  for (let i = 0; i < aMirar.length; i += 50) {
    const lote = aMirar.slice(i, i + 50);
    const rv = await pedirApi<VideoApi & { id?: string }>(
      "videos", { part: "snippet,statistics,liveStreamingDetails", id: lote.map(([v]) => v).join(",") }, clave, 0,
    );
    if (!rv.ok) { res.errores.push(`videos: ${rv.error}`); continue; }

    const muestras: Record<string, unknown>[] = [];
    const nuevosEstados: Record<string, unknown>[] = [];
    /* El estado del webinar sigue al vivo: "En vivo" mientras está en el
       aire y "Finalizado" cuando termina. Sólo se toca si hace falta, así
       no pisa lo que alguien haya puesto a mano en otro momento. */
    const cambiosEstado: { id: string; titulo: string; estado: "en-vivo" | "finalizado" }[] = [];
    for (const v of rv.items) {
      if (!v.id) continue;
      const w = porVideo.get(v.id);
      const anterior = estados.get(v.id);
      if (!w) continue;
      const d = v.liveStreamingDetails;
      const bc = v.snippet?.liveBroadcastContent;
      const estado = bc === "live" ? "en-vivo" : bc === "upcoming" ? "programado" : d ? "terminado" : "video";
      const enVivo = estado === "en-vivo";

      /* En el aire: una muestra por minuto. Fuera del aire: sólo si toca la
         foto de la grabación. */
      const guardar = enVivo || tocaFoto(w, anterior);
      if (guardar) {
        muestras.push({
          videoId: v.id,
          minuto: enVivo ? minuto : new Date(Math.floor(t / HORA) * HORA).toISOString(),
          webinarId: w.id,
          enVivo,
          espectadores: enVivo ? numero(d?.concurrentViewers) ?? null : null,
          vistas: numero(v.statistics?.viewCount) ?? null,
          likes: numero(v.statistics?.likeCount) ?? null,
          comentarios: numero(v.statistics?.commentCount) ?? null,
        });
      }

      const fila: Record<string, unknown> = {
        videoId: v.id,
        webinarId: w.id,
        estado,
        programado: d?.scheduledStartTime ?? null,
        inicio: d?.actualStartTime ?? null,
        fin: d?.actualEndTime ?? null,
        actualizadoEn: ahora.toISOString(),
        ultimaMuestra: guardar ? ahora.toISOString() : anterior?.ultimaMuestra ?? null,
      };
      if (enVivo) res.enVivo++;
      if (enVivo && (w.estado === "programado" || w.estado === "borrador")) {
        cambiosEstado.push({ id: w.id, titulo: w.titulo ?? "", estado: "en-vivo" });
      } else if (estado === "terminado" && w.estado === "en-vivo") {
        cambiosEstado.push({ id: w.id, titulo: w.titulo ?? "", estado: "finalizado" });
      }
      /* El chat: en el aire y también en la sala de espera (programado y
         cerca de su hora), donde la gente ya saluda. Así además se sabe
         antes de que arranque si YouTube deja leerlo. Si cambió el chat
         (otro vivo en el mismo link), se empieza de cero. */
      if (enVivo || (estado === "programado" && cercaDeSuHora(w))) {
        const liveChatId = d?.activeLiveChatId ?? anterior?.liveChatId ?? null;
        const pagina = liveChatId && liveChatId === anterior?.liveChatId ? anterior?.paginaChat ?? null : null;
        if (liveChatId) {
          const c = await leerChat(db, v.id, w.id, liveChatId, pagina, clave);
          res.mensajes += c.guardados;
          fila.liveChatId = liveChatId;
          fila.paginaChat = c.pagina ?? pagina;
          fila.errorChat = c.error ?? null;
          if (c.error) res.errores.push(`chat ${v.id}: ${c.error}`);
        }
      }
      nuevosEstados.push(fila);
    }

    if (muestras.length) {
      const r = await db.from("yt_muestras").upsert(muestras, { onConflict: "videoId,minuto" });
      if (r.error) res.errores.push(`yt_muestras: ${r.error.message}`);
      else res.muestras += muestras.length;
    }
    for (const c of cambiosEstado) {
      const r = await db.from("webinars").update({ estado: c.estado }).eq("id", c.id);
      if (r.error) { res.errores.push(`webinars ${c.id}: ${r.error.message}`); continue; }
      const ahoraIso = new Date().toISOString();
      await db.from("actividad").insert({
        id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        accion: "actualizo", actor: "YouTube", entidad: "webinar", entidadId: c.id, titulo: c.titulo, fecha: ahoraIso,
        detalle: c.estado === "en-vivo"
          ? `«${c.titulo}» salió al aire en YouTube: pasó a en vivo.`
          : `«${c.titulo}» terminó en YouTube: pasó a finalizado.`,
      });
    }
    if (nuevosEstados.length) {
      const r = await db.from("yt_estado").upsert(nuevosEstados, { onConflict: "videoId", defaultToNull: false });
      if (r.error) res.errores.push(`yt_estado: ${r.error.message}`);
    }
  }
  return res;
}

/* Lee el chat desde la página donde quedó. YouTube devuelve hasta 2000
   mensajes por vuelta; si vino lleno, se pide la siguiente (hasta 5). */
async function leerChat(
  db: NonNullable<ReturnType<typeof nubeServidor>>, videoId: string, webinarId: string,
  liveChatId: string, pagina: string | null, clave: string,
): Promise<{ guardados: number; pagina?: string; error?: string }> {
  let guardados = 0;
  let token = pagina;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const params: Record<string, string> = { liveChatId, part: "snippet,authorDetails", maxResults: "2000" };
    if (token) params.pageToken = token;
    const r = await pedirApi<MensajeApi>("liveChat/messages", params, clave, 0);
    if (!r.ok) return { guardados, pagina: token ?? undefined, error: r.error };

    const filas = r.items.filter((m) => m.id && m.snippet?.publishedAt).map((m) => {
      const s = m.snippet!;
      const a = m.authorDetails ?? {};
      return {
        id: m.id!,
        videoId,
        webinarId,
        publicadoEn: s.publishedAt!,
        autorCanalId: a.channelId ?? null,
        autorNombre: a.displayName ?? null,
        autorFoto: a.profileImageUrl ?? null,
        esDueno: Boolean(a.isChatOwner),
        esModerador: Boolean(a.isChatModerator),
        tipo: s.type ?? null,
        texto: s.textMessageDetails?.messageText ?? s.superChatDetails?.userComment ?? s.displayMessage ?? "",
        monto: s.superChatDetails?.amountDisplayString ?? s.superStickerDetails?.amountDisplayString ?? null,
      };
    });
    if (filas.length) {
      const w = await db.from("yt_chat").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
      if (w.error) return { guardados, pagina: token ?? undefined, error: `yt_chat: ${w.error.message}` };
      guardados += filas.length;
    }
    const siguiente = typeof r.cuerpo.nextPageToken === "string" ? r.cuerpo.nextPageToken : undefined;
    if (siguiente) token = siguiente;
    if (!siguiente || r.items.length < 2000) break;
  }
  return { guardados, pagina: token ?? undefined };
}
