import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { nubeServidor } from "@/lib/servidor";

/* Qué webinars están en el aire ahora, según el cron (que revisa cada
   minuto). Para la lista de webinars: el aviso con el punto rojo aparece
   solo, sin que nadie cambie el estado a mano. Si el cron no pasó en los
   últimos 3 minutos, no se da por en vivo: mejor no mentir. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ vivos: [] });
  const r = await db.from("yt_estado")
    .select("videoId, webinarId, inicio, actualizadoEn")
    .eq("estado", "en-vivo")
    .gte("actualizadoEn", new Date(Date.now() - 3 * 60_000).toISOString());
  if (r.error) return NextResponse.json({ vivos: [] });
  const vivos = (r.data ?? []).map((x) => ({ videoId: x.videoId as string, webinarId: x.webinarId as string, inicio: x.inicio as string | null }));
  if (vivos.length === 0) return NextResponse.json({ vivos });
  /* El último número guardado de cada uno. */
  const m = await db.from("yt_muestras").select("videoId, minuto, espectadores")
    .in("videoId", vivos.map((v) => v.videoId)).eq("enVivo", true)
    .order("minuto", { ascending: false }).limit(vivos.length * 3);
  const ultimo = new Map<string, number>();
  for (const x of m.data ?? []) if (!ultimo.has(x.videoId as string) && x.espectadores != null) ultimo.set(x.videoId as string, x.espectadores as number);
  return NextResponse.json({ vivos: vivos.map((v) => ({ ...v, espectadores: ultimo.get(v.videoId) })) });
}
