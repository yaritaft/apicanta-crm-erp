import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { resumirAgendas } from "@/lib/agendas-webinar";
import { sesionesCalendly } from "@/lib/agendas-sync";
import { nubeServidor } from "@/lib/servidor";
import { videoDelWebinar } from "@/lib/youtube";

/* ==================================================================
   Las agendas de Calendly desde un momento (?desde=ISO), para la ficha
   del webinar en vivo: cuántas llamadas se agendaron desde que arrancó el
   pitch. Las trae el webhook de Calendly en segundos; la ficha pregunta
   cada 10 segundos. Cuenta por cuándo se agendó (creadoEn), no por cuándo
   es la llamada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const url = new URL(peticion.url);

  /* ?webinar=ID: las agendas de ese webinar, en el vivo o después (lo mismo
     que el cron pasa a la planilla), con cada persona. */
  const webinarId = url.searchParams.get("webinar");
  if (webinarId) {
    const db = nubeServidor();
    if (!db) return NextResponse.json({ vivo: 0, despues: 0, canceladas: 0, noVino: 0, agendas: [] });
    const rw = await db.from("webinars").select("id, fecha, duracionMin, youtubeUrl, enlaceReplay").eq("id", webinarId).maybeSingle();
    if (rw.error || !rw.data) return NextResponse.json({ error: "No encontré ese webinar." }, { status: 404 });
    const w = rw.data as { fecha: string; duracionMin: number; youtubeUrl?: string | null; enlaceReplay?: string | null };
    const v = videoDelWebinar(w);
    const re = v ? await db.from("yt_estado").select("inicio, fin").eq("videoId", v).maybeSingle() : null;
    try {
      const sesiones = await sesionesCalendly(db, new Date(+new Date(w.fecha) - 2 * 86_400_000).toISOString());
      const r = resumirAgendas(sesiones, w, (re?.data ?? {}) as { inicio?: string | null; fin?: string | null });
      return NextResponse.json(r, { headers: { "Cache-Control": "private, max-age=10" } });
    } catch {
      return NextResponse.json({ error: "No pude leer las agendas." }, { status: 502 });
    }
  }

  const desde = url.searchParams.get("desde") ?? "";
  if (Number.isNaN(Date.parse(desde))) return NextResponse.json({ error: "Falta desde cuándo contar." }, { status: 400 });

  const db = nubeServidor();
  if (!db) return NextResponse.json({ agendas: [] });
  const r = await db.from("sesiones")
    .select("id, invitado, creadoEn, inicia, estado, canal, anfitrion, utm")
    .not("calendlyInvitadoUri", "is", null)
    .gte("creadoEn", new Date(desde).toISOString())
    .order("creadoEn", { ascending: false })
    .limit(200);
  if (r.error) return NextResponse.json({ error: "No pude leer las agendas." }, { status: 502 });

  const agendas = (r.data ?? []).map((s) => {
    const utm = (s.utm ?? {}) as Record<string, string>;
    return {
      id: s.id as string,
      nombre: (s.invitado as string | null) ?? "Sin nombre",
      agendadaEn: s.creadoEn as string,
      llamada: s.inicia as string,
      estado: s.estado as string,
      closer: (s.anfitrion as string | null) ?? undefined,
      /* Del webinar: el tipo de evento de webinar o los UTMs del webinar. */
      delWebinar: s.canal === "webinar" || /webinar/i.test(utm.utm_source ?? ""),
    };
  });
  return NextResponse.json({ agendas }, { headers: { "Cache-Control": "private, max-age=5" } });
}
