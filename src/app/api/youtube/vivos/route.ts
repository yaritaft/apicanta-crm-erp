import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { ID_YOUTUBE, type VivoDelCanal } from "@/lib/youtube";
import { MEDIA_HORA, mejor, pedirApi, type VideoApi } from "@/lib/youtube-servidor";

/* ==================================================================
   Los vivos del canal de YouTube de Hackear IT, para proponerle a cada
   webinar sin link el vivo de su día.

   El canal no se configura: sale de los videos que ya tienen pegados
   otros webinars (?videos=id1,id2…). Se toma el que más se repite, por
   si alguno era de un invitado.

   Qué se le pide a Google, y lo que cuesta de la cuota diaria (10.000):
   - el canal de esos videos (1 unidad);
   - su lista de subidas y los últimos 50 videos (2 unidades);
   - los vivos programados, que no siempre están en las subidas: la
     búsqueda cuesta 100, por eso queda en cache tres horas;
   - el detalle de esos videos, para saber cuándo es cada vivo (1 o 2).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRES_HORAS = 10_800;

type Subida = { contentDetails?: { videoId?: string } };
type Encontrado = { id?: { videoId?: string } };
type CanalConSubidas = { contentDetails?: { relatedPlaylists?: { uploads?: string } }; snippet?: { title?: string } };

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para buscar en YouTube." }, { status: 401 });
  }

  const url = new URL(peticion.url);
  const conocidos = [...new Set((url.searchParams.get("videos") ?? "").split(",").map((s) => s.trim()))]
    .filter((x) => ID_YOUTUBE.test(x))
    .slice(0, 10);
  if (conocidos.length === 0) {
    return NextResponse.json({ error: "Hace falta al menos un webinar con su link para saber cuál es el canal." }, { status: 400 });
  }

  const clave = process.env.YOUTUBE_API_KEY?.trim();
  if (!clave) {
    return NextResponse.json({ error: "Para buscar los vivos del canal falta conectar YouTube.", sinClave: true }, { status: 503 });
  }

  /* 1. El canal: el que más se repite entre los videos conocidos. */
  const rv = await pedirApi<VideoApi>("videos", { part: "snippet", id: conocidos.join(",") }, clave, TRES_HORAS);
  if (!rv.ok) return NextResponse.json({ error: rv.error }, { status: rv.status });
  const votos = new Map<string, number>();
  for (const v of rv.items) {
    const c = v.snippet?.channelId;
    if (c) votos.set(c, (votos.get(c) ?? 0) + 1);
  }
  const canalId = [...votos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!canalId) return NextResponse.json({ error: "No encontré el canal de esos videos." }, { status: 404 });

  /* 2. Su lista de subidas. */
  const rc = await pedirApi<CanalConSubidas>("channels", { part: "contentDetails,snippet", id: canalId }, clave, TRES_HORAS);
  if (!rc.ok) return NextResponse.json({ error: rc.error }, { status: rc.status });
  const canal = rc.items[0];
  const subidas = canal?.contentDetails?.relatedPlaylists?.uploads;

  /* 3. Los últimos 50 subidos y 4. los vivos programados. Si la búsqueda
     falla (por cuota, por ejemplo), alcanza con las subidas. */
  const ids = new Set<string>();
  if (subidas) {
    const rp = await pedirApi<Subida>("playlistItems", { part: "contentDetails", playlistId: subidas, maxResults: "50" }, clave, MEDIA_HORA);
    if (rp.ok) for (const it of rp.items) if (it.contentDetails?.videoId) ids.add(it.contentDetails.videoId);
  }
  const rs = await pedirApi<Encontrado>(
    "search", { part: "id", channelId: canalId, eventType: "upcoming", type: "video", maxResults: "25" }, clave, TRES_HORAS,
  );
  if (rs.ok) for (const it of rs.items) if (it.id?.videoId) ids.add(it.id.videoId);

  /* 5. Cuándo es (o fue) cada uno. Sólo quedan los que son vivos. */
  const todos = [...ids];
  const vivos: VivoDelCanal[] = [];
  for (let i = 0; i < todos.length; i += 50) {
    const rd = await pedirApi<VideoApi>(
      "videos", { part: "snippet,liveStreamingDetails", id: todos.slice(i, i + 50).join(",") }, clave, MEDIA_HORA,
    );
    if (!rd.ok) return NextResponse.json({ error: rd.error }, { status: rd.status });
    for (const v of rd.items as (VideoApi & { id?: string })[]) {
      const s = v.snippet;
      const d = v.liveStreamingDetails;
      const enVivo = s?.liveBroadcastContent;
      if (!v.id || !s || (!d && enVivo !== "live" && enVivo !== "upcoming")) continue;
      const cuando = d?.actualStartTime ?? d?.scheduledStartTime ?? s.publishedAt;
      if (!cuando) continue;
      vivos.push({
        id: v.id,
        titulo: s.title ?? "",
        miniatura: mejor(s.thumbnails, ["medium", "high", "default"]),
        cuando,
        estado: enVivo === "live" ? "en-vivo" : enVivo === "upcoming" ? "programado" : "terminado",
      });
    }
  }
  vivos.sort((a, b) => +new Date(b.cuando) - +new Date(a.cuando));

  return NextResponse.json(
    { canal: { id: canalId, nombre: canal?.snippet?.title ?? "" }, vivos },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
