import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { atarGruposSolos, ErrorSinTablas, leerWebinarsParaAtar, RepoSupabase } from "@/lib/whatsapp-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Ata solos los grupos de WhatsApp a su webinar, una vez por día.

   Los grupos se llaman «Taller Online 21/10/26 #1», «… #2»: la fecha completa dice de qué webinar son. Cada grupo que el lector
   detectó y todavía no es de ningún webinar se ata al webinar de esa fecha (lib/whatsapp.ts, gruposParaAtarSolos). Sólo lo seguro:
   fecha con año y un único webinar ese día; lo atado a mano no se toca, y lo que no se puede decidir queda con el aviso de Webinars.
   Cuando se crea un webinar también se corre en el momento (el asistente pide «atar-solos» a /api/whatsapp/webinar).

   Cada corrida deja asentado en `cron_estado` (supabase/cron-estado.sql) cuándo fue y qué ató.
   Corre a las 12:40 UTC (9:40 de Argentina), después de que el equipo suele armar los grupos de la mañana. */

const CLAVE = "whatsapp-atar-grupos";

async function dejarConstancia(db: NonNullable<ReturnType<typeof nubeServidor>>, fila: Record<string, unknown>) {
  const ahora = new Date().toISOString();
  try {
    const x = await db.from("cron_estado").upsert({ clave: CLAVE, ejecutadoEn: ahora, ...fila }, { onConflict: "clave" });
    if (x.error) console.error(`[cron/${CLAVE}] no pude guardar el estado:`, x.error.message);
  } catch (e) {
    console.error(`[cron/${CLAVE}] no pude guardar el estado:`, e instanceof Error ? e.message : e);
  }
}

export async function GET(req: Request) {
  /* Igual que los otros crons: se exige que el secreto EXISTA. Sin la variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });

  try {
    const r = await atarGruposSolos(new RepoSupabase(db), await leerWebinarsParaAtar(db));
    const resumen = { webinars: r.webinarsVistos.length, atados: r.atados.map((a) => ({ grupo: a.nombre, webinarId: a.webinarId })), fallidos: r.fallidos };
    console.log(`[cron/${CLAVE}]`, JSON.stringify({ ...resumen, atados: r.atados.length }));
    await dejarConstancia(db, { ok: r.fallidos.length === 0, resultado: resumen, ...(r.atados.length ? { ultimaUnionEn: new Date().toISOString() } : {}) });
    return NextResponse.json(resumen, { status: r.fallidos.length ? 207 : 200 });
  } catch (e) {
    /* Sin las tablas de WhatsApp (falta correr supabase/whatsapp-lector.sql) no hay nada que atar: no es una falla del cron. */
    if (e instanceof ErrorSinTablas) return NextResponse.json({ webinars: 0, atados: [], fallidos: [], sinTablas: true });
    const error = e instanceof Error ? e.message : "No se pudieron atar los grupos.";
    console.error(`[cron/${CLAVE}] fallo entero:`, error);
    await dejarConstancia(db, { ok: false, resultado: { error } });
    return NextResponse.json({ error }, { status: 502 });
  }
}
