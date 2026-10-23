import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { traerAsistenciaZoom } from "@/lib/zoom-asistencia-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* POST: trae ahora la asistencia a las clases de Zoom (lo mismo que el cron de cada hora), para ver el resultado en la ficha sin esperar.
   Sólo lo piden quienes ven Alumnos. Sólo lee de Zoom y escribe las dos tablas de asistencia. */
export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });
  try {
    const r = await traerAsistenciaZoom(db);
    return NextResponse.json(r, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo traer la asistencia." }, { status: 502 });
  }
}
