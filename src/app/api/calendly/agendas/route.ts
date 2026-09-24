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

/* PATCH { id, momento: "vivo" | "despues" | "fuera" | "auto", quien }:
   corregir a mano la atribución de una agenda. Se guarda en
   sesiones.extra.atribucion, sin tocar nada más de la sesión (el webhook de
   Calendly la puede estar actualizando al mismo tiempo). El cron recalcula
   la planilla en el minuto siguiente. */
export async function PATCH(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const b = (await peticion.json().catch(() => ({}))) as { id?: string; momento?: string; quien?: string; webinarId?: string };
  if (!b.id || !["vivo", "despues", "fuera", "auto"].includes(b.momento ?? "")) {
    return NextResponse.json({ error: "Falta la agenda o a dónde atribuirla." }, { status: 400 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "No hay base configurada." }, { status: 503 });

  const r = await db.from("sesiones").select("extra, invitado").eq("id", b.id).maybeSingle();
  if (r.error || !r.data) return NextResponse.json({ error: "No encontré esa agenda." }, { status: 404 });
  const extra = { ...((r.data.extra ?? {}) as Record<string, unknown>) };
  const quien = b.quien?.slice(0, 120) || "Alguien del equipo";
  if (b.momento === "auto") delete extra.atribucion;
  else {
    extra.atribucion = {
      ...(b.momento === "fuera" ? { fuera: true } : { momento: b.momento }),
      por: quien, en: new Date().toISOString(),
    };
  }
  const u = await db.from("sesiones").update({ extra }).eq("id", b.id);
  if (u.error) return NextResponse.json({ error: "No pude guardar el cambio." }, { status: 502 });

  const texto = { vivo: "en el vivo", despues: "después del vivo", fuera: "fuera de este webinar", auto: "automática (por el link o la hora)" }[b.momento as string];
  await db.from("actividad").insert({
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    accion: "actualizo", actor: quien, entidad: b.webinarId ? "webinar" : "sesion", entidadId: b.webinarId ?? b.id,
    titulo: (r.data.invitado as string | null) ?? "Agenda", fecha: new Date().toISOString(),
    detalle: `La agenda de ${(r.data.invitado as string | null) ?? "alguien"} quedó atribuida ${texto}.`,
  });
  return NextResponse.json({ ok: true });
}
