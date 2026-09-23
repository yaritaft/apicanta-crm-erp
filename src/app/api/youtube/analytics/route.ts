import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { nubeServidor } from "@/lib/servidor";
import { ID_YOUTUBE, type AnalyticsVideo, type EstadoAnalytics } from "@/lib/youtube";
import { analyticsConfigurado, analyticsDeVideo, conexion } from "@/lib/youtube-analytics";

/* Lo que dice YouTube Analytics de un video. Queda guardado seis horas en
   yt_analytics: YouTube actualiza estos números una vez por día y cada
   visita a la ficha gastaría ocho reportes. ?fresco=1 lo vuelve a pedir. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEIS_HORAS = 6 * 3600_000;

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver YouTube Analytics." }, { status: 401 });
  }
  const url = new URL(peticion.url);
  const id = url.searchParams.get("video")?.trim() ?? "";
  if (!ID_YOUTUBE.test(id)) return NextResponse.json({ error: "Eso no es el id de un video de YouTube." }, { status: 400 });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("desde") ?? "")
    ? (url.searchParams.get("desde") as string)
    : new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  if (!analyticsConfigurado()) return NextResponse.json({ conectado: false, configurado: false } satisfies EstadoAnalytics);
  const db = nubeServidor();
  const c = await conexion();
  if (!db || !c) return NextResponse.json({ conectado: false, configurado: true } satisfies EstadoAnalytics);

  if (url.searchParams.get("fresco") !== "1") {
    const g = await db.from("yt_analytics").select("datos, traidoEn").eq("videoId", id).maybeSingle();
    if (g.data && Date.now() - +new Date(g.data.traidoEn as string) < SEIS_HORAS) {
      return NextResponse.json({ conectado: true, canal: c.canalNombre, datos: g.data.datos as AnalyticsVideo } satisfies EstadoAnalytics);
    }
  }

  const r = await analyticsDeVideo(id, desde);
  if ("error" in r) {
    return NextResponse.json({ conectado: true, canal: c.canalNombre, error: r.error } satisfies EstadoAnalytics);
  }
  await db.from("yt_analytics").upsert({ videoId: id, datos: r, traidoEn: r.traidoEn });
  return NextResponse.json({ conectado: true, canal: c.canalNombre, datos: r } satisfies EstadoAnalytics);
}
