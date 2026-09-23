import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { nubeServidor } from "@/lib/servidor";

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
  const desde = new URL(peticion.url).searchParams.get("desde") ?? "";
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
