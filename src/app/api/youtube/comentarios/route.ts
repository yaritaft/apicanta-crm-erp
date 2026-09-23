import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { ID_YOUTUBE, type ComentarioYoutube, type ComentariosYoutube } from "@/lib/youtube";
import { MEDIA_HORA, numero, pedirApi } from "@/lib/youtube-servidor";

/* ==================================================================
   Los comentarios de un video, con sus respuestas.

   Cada página de 100 cuesta 1 unidad de cuota; se traen hasta 1000
   comentarios (10 páginas), los más nuevos primero. Las respuestas vienen
   hasta 5 por comentario; si hay más, se piden aparte (1 unidad cada una,
   sólo para los que tienen más). Todo queda media hora en cache.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGINAS = 10;

interface SnippetComentario {
  authorDisplayName?: string; authorChannelId?: { value?: string }; authorProfileImageUrl?: string;
  textOriginal?: string; textDisplay?: string; likeCount?: number; publishedAt?: string; updatedAt?: string;
}
interface ComentarioApi { id?: string; snippet?: SnippetComentario }
interface HiloApi {
  id?: string;
  snippet?: { topLevelComment?: ComentarioApi; totalReplyCount?: number };
  replies?: { comments?: ComentarioApi[] };
}

function comentario(c: ComentarioApi | undefined, fallbackId: string): ComentarioYoutube {
  const s = c?.snippet ?? {};
  return {
    id: c?.id ?? fallbackId,
    autor: (s.authorDisplayName ?? "").replace(/^@/, "") || "Sin nombre",
    autorCanalId: s.authorChannelId?.value,
    foto: s.authorProfileImageUrl,
    texto: s.textOriginal ?? s.textDisplay ?? "",
    likes: numero(String(s.likeCount ?? 0)) ?? 0,
    t: s.publishedAt ?? "",
    editado: Boolean(s.updatedAt && s.publishedAt && s.updatedAt !== s.publishedAt) || undefined,
    respuestas: [],
  };
}

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver los comentarios." }, { status: 401 });
  }
  const id = new URL(peticion.url).searchParams.get("video")?.trim() ?? "";
  if (!ID_YOUTUBE.test(id)) return NextResponse.json({ error: "Eso no es el id de un video de YouTube." }, { status: 400 });

  const clave = process.env.YOUTUBE_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Para leer los comentarios falta conectar YouTube.", sinClave: true }, { status: 503 });
  }

  const comentarios: ComentarioYoutube[] = [];
  let token: string | undefined;
  let cortado = false;
  for (let p = 0; p < PAGINAS; p++) {
    const params: Record<string, string> = { part: "snippet,replies", videoId: id, maxResults: "100", order: "time", textFormat: "plainText" };
    if (token) params.pageToken = token;
    const r = await pedirApi<HiloApi>("commentThreads", params, clave, MEDIA_HORA);
    if (!r.ok) {
      if (/commentsdisabled/i.test(r.motivos)) {
        return NextResponse.json({ comentarios: [], cortado: false, cerrados: true } satisfies ComentariosYoutube);
      }
      if (p === 0) return NextResponse.json({ error: r.error }, { status: r.status });
      cortado = true;
      break;
    }
    for (const h of r.items) {
      const c = comentario(h.snippet?.topLevelComment, h.id ?? String(comentarios.length));
      c.totalRespuestas = h.snippet?.totalReplyCount ?? 0;
      c.respuestas = (h.replies?.comments ?? []).map((x, i) => comentario(x, `${c.id}_${i}`));
      comentarios.push(c);
    }
    token = typeof r.cuerpo.nextPageToken === "string" ? r.cuerpo.nextPageToken : undefined;
    if (!token) break;
    if (p === PAGINAS - 1) cortado = true;
  }

  /* Las respuestas que no vinieron en el hilo (más de 5): hasta 20 hilos. */
  const incompletos = comentarios.filter((c) => (c.totalRespuestas ?? 0) > c.respuestas.length).slice(0, 20);
  await Promise.all(incompletos.map(async (c) => {
    const r = await pedirApi<ComentarioApi>("comments", { part: "snippet", parentId: c.id, maxResults: "100", textFormat: "plainText" }, clave, MEDIA_HORA);
    if (r.ok) c.respuestas = r.items.map((x, i) => comentario(x, `${c.id}_${i}`));
  }));
  for (const c of comentarios) c.respuestas.sort((a, b) => +new Date(a.t) - +new Date(b.t));

  return NextResponse.json(
    { comentarios, cortado } satisfies ComentariosYoutube,
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
