import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import {
  ESPERA_MS, MEDIA_HORA, mejor, numero, pedirApi, type CanalApi, type VideoApi,
} from "@/lib/youtube-servidor";
import {
  ID_YOUTUBE, idDeYoutube, segundosDeDuracion, videoDe,
  type CanalYoutube, type DatosYoutube, type VivoYoutube,
} from "@/lib/youtube";

/* ==================================================================
   Los datos de un video de YouTube para la ficha del webinar.

   Con YOUTUBE_API_KEY en el entorno se piden a la YouTube Data API v3:
   título, descripción, vistas, likes, comentarios y el canal con sus
   suscriptores. Sin clave, se cae a oEmbed, que es público: trae título
   y canal, y la pantalla avisa que para los números falta conectar
   YouTube. La clave se usa sólo acá y nunca viaja al navegador.

   Cada respuesta de Google queda en cache media hora por video: las
   vistas no cambian tanto como para gastar cuota en cada visita.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


const NO_EXISTE = "No encontré ese video: puede ser privado o haber sido borrado.";
const SIN_CLAVE = "Para ver vistas, comentarios y suscriptores falta conectar YouTube.";

type Resultado = { ok: true; datos: DatosYoutube } | { ok: false; status: number; error: string };

export async function GET(peticion: Request) {
  /* Sólo el equipo. Sin Supabase configurado (la app corriendo local, sin
     login) no hay a quién preguntarle y se contesta igual. */
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver los datos de YouTube." }, { status: 401 });
  }

  const url = new URL(peticion.url);
  const crudo = url.searchParams.get("id");
  const id = crudo !== null
    ? (ID_YOUTUBE.test(crudo.trim()) ? crudo.trim() : null)
    : idDeYoutube(url.searchParams.get("url"));
  if (!id) {
    return NextResponse.json({ error: "Eso no es el link de un video de YouTube." }, { status: 400 });
  }

  const clave = process.env.YOUTUBE_API_KEY?.trim();
  let r: Resultado;
  if (clave) {
    r = await conLaApi(id, clave);
    /* Si la API falla por la clave o por la cuota, se muestra lo básico
       igual, con el motivo a la vista. Un video que no existe no se salva
       con oEmbed. */
    if (!r.ok && r.status !== 404) {
      const basico = await conOembed(id);
      if (basico.ok) r = { ok: true, datos: { ...basico.datos, aviso: `${r.error} Por ahora muestro lo básico.` } };
    }
  } else {
    r = await conOembed(id);
  }

  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.datos, { headers: { "Cache-Control": "private, max-age=300" } });
}

async function conLaApi(id: string, clave: string): Promise<Resultado> {
  const rv = await pedirApi<VideoApi>(
    "videos", { part: "snippet,statistics,liveStreamingDetails,contentDetails", id }, clave,
  );
  if (!rv.ok) return rv;
  const v = rv.items[0];
  if (!v?.snippet) return { ok: false, status: 404, error: NO_EXISTE };
  const s = v.snippet;

  let canal: CanalYoutube = {
    id: s.channelId,
    nombre: s.channelTitle ?? "",
    url: s.channelId ? `https://www.youtube.com/channel/${s.channelId}` : undefined,
  };
  let aviso: string | undefined;
  if (s.channelId) {
    const rc = await pedirApi<CanalApi>("channels", { part: "snippet,statistics", id: s.channelId }, clave);
    const c = rc.ok ? rc.items[0] : undefined;
    if (c) {
      const ocultos = Boolean(c.statistics?.hiddenSubscriberCount);
      canal = {
        ...canal,
        nombre: c.snippet?.title ?? canal.nombre,
        url: c.snippet?.customUrl ? `https://www.youtube.com/${c.snippet.customUrl}` : canal.url,
        avatar: mejor(c.snippet?.thumbnails, ["default", "medium", "high"]),
        suscriptores: ocultos ? undefined : numero(c.statistics?.subscriberCount),
        suscriptoresOcultos: ocultos,
      };
    } else if (!rc.ok) {
      aviso = "No pude traer los datos del canal.";
    }
  }

  const detalles = v.liveStreamingDetails;
  const enVivo = s.liveBroadcastContent;
  const vivo: VivoYoutube | undefined = detalles || enVivo === "live" || enVivo === "upcoming"
    ? {
        estado: enVivo === "live" ? "en-vivo" : enVivo === "upcoming" ? "programado" : "terminado",
        programado: detalles?.scheduledStartTime,
        inicio: detalles?.actualStartTime,
        fin: detalles?.actualEndTime,
        espectadores: numero(detalles?.concurrentViewers),
      }
    : undefined;

  return {
    ok: true,
    datos: {
      id,
      completo: true,
      titulo: s.title ?? "",
      descripcion: s.description || undefined,
      publicado: s.publishedAt,
      miniatura: mejor(s.thumbnails, ["maxres", "standard", "high", "medium", "default"]),
      duracionSeg: segundosDeDuracion(v.contentDetails?.duration) || undefined,
      vistas: numero(v.statistics?.viewCount),
      likes: numero(v.statistics?.likeCount),
      comentarios: numero(v.statistics?.commentCount),
      vivo,
      canal,
      aviso,
    },
  };
}

/* ---------- oEmbed: sin clave, lo público ---------- */

async function conOembed(id: string): Promise<Resultado> {
  const q = new URLSearchParams({ url: videoDe(id), format: "json" });
  let r: Response;
  try {
    r = await fetch(`https://www.youtube.com/oembed?${q}`, {
      next: { revalidate: MEDIA_HORA },
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    return { ok: false, status: 504, error: "YouTube no contestó a tiempo." };
  }
  if (r.status === 400 || r.status === 404) return { ok: false, status: 404, error: NO_EXISTE };
  if (r.status === 401 || r.status === 403) {
    return { ok: false, status: 404, error: "Ese video es privado o no deja que lo vean fuera de YouTube." };
  }
  if (!r.ok) return { ok: false, status: 502, error: `YouTube respondió con un error (${r.status}).` };

  const j = (await r.json().catch(() => null)) as
    { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string } | null;
  if (!j) return { ok: false, status: 502, error: "YouTube respondió algo que no se pudo leer." };

  return {
    ok: true,
    datos: {
      id,
      completo: false,
      titulo: j.title ?? "",
      miniatura: j.thumbnail_url,
      canal: { nombre: j.author_name ?? "", url: j.author_url },
      aviso: SIN_CLAVE,
    },
  };
}
