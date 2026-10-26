import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDeLaApp } from "@/lib/contratos-servidor";
import { recordarReportes } from "@/lib/reporte-recordatorio";

/* ==================================================================
   El recordatorio del formulario semanal: los lunes a las 10 de Argentina
   (13 UTC, vercel.json), a cada alumno activo de un programa con recordatorio
   que todavía no lo completó le llega su link personal por mail
   (lib/reporte-recordatorio.ts; Lili, 26/10: el de Hackear Biz deja el
   Google Form).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base." }, { status: 503 });
  const origen = process.env.APP_URL?.trim() || baseDeLaApp(null);
  if (!origen) return NextResponse.json({ error: "Falta la dirección de la app (APP_URL)." }, { status: 503 });
  try {
    const pasada = await recordarReportes(db, origen);
    return NextResponse.json({ ok: true, ...pasada });
  } catch (e) {
    console.error("[cron reporte-semanal]", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "No se pudo mandar el recordatorio." }, { status: 500 });
  }
}
