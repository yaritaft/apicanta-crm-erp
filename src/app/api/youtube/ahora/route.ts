import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { ID_YOUTUBE } from "@/lib/youtube";
import { numero, pedirApi, type VideoApi } from "@/lib/youtube-servidor";

/* Cuántos están mirando un vivo AHORA, para la barra "En vivo" de la
   ficha, que pregunta cada 15 segundos. Es 1 unidad de cuota y queda 15
   segundos en cache: aunque haya diez personas mirando la ficha, a Google
   se le pregunta una vez. La curva sigue saliendo de lo que guarda el cron. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const id = new URL(peticion.url).searchParams.get("video")?.trim() ?? "";
  if (!ID_YOUTUBE.test(id)) return NextResponse.json({ error: "Eso no es el id de un video de YouTube." }, { status: 400 });
  const clave = process.env.YOUTUBE_API_KEY?.trim();
  if (!clave) return NextResponse.json({ error: "Falta conectar YouTube.", sinClave: true }, { status: 503 });

  const r = await pedirApi<VideoApi>("videos", { part: "snippet,statistics,liveStreamingDetails", id }, clave, 15);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const v = r.items[0];
  if (!v) return NextResponse.json({ error: "No encontré ese video." }, { status: 404 });
  const bc = v.snippet?.liveBroadcastContent;
  const d = v.liveStreamingDetails;
  return NextResponse.json({
    estado: bc === "live" ? "en-vivo" : bc === "upcoming" ? "programado" : d ? "terminado" : "video",
    espectadores: numero(d?.concurrentViewers),
    vistas: numero(v.statistics?.viewCount),
    likes: numero(v.statistics?.likeCount),
    inicio: d?.actualStartTime,
    fin: d?.actualEndTime,
    t: new Date().toISOString(),
  }, { headers: { "Cache-Control": "private, max-age=10" } });
}
