import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { traerAsistenciaZoom } from "@/lib/zoom-asistencia-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Cada hora a los 15 minutos: trae de Zoom quién asistió a las clases que ya terminaron (lib/zoom-asistencia-servidor.ts). Una clase se
   trae una sola vez; las recién terminadas, hasta un día después, por si la lista estaba incompleta. Casi siempre no hay nada nuevo. */

export async function GET(req: Request) {
  /* Igual que los otros crons: se exige que el secreto EXISTA. Sin la variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });
  try {
    const r = await traerAsistenciaZoom(db);
    if (r.clases > 0 || r.errores.length) console.log("[cron/zoom-asistencia]", JSON.stringify(r));
    return NextResponse.json(r, { status: r.errores.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo traer la asistencia de Zoom.";
    console.error("[cron/zoom-asistencia] fallo entero:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
