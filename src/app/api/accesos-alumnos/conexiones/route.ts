import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { probarPandadoc, probarTelegram, probarWisboo, probarZoom } from "@/lib/accesos-alumnos-servidor";

/* ==================================================================
   GET: prueba las cuatro conexiones de los accesos de alumnos (Telegram,
   Wisboo, PandaDoc y Zoom) con las claves de Vercel y devuelve lo que ve
   cada una. Sólo lee: no conecta el bot, no da accesos, no manda nada.
   Lo ve quien ve los Ajustes. Cerrado aunque falte Supabase: lo que
   devuelve sale de credenciales.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const base = new URL(peticion.url).origin;
  const [telegram, wisboo, pandadoc, zoom] = await Promise.all([
    probarTelegram(base), probarWisboo(), probarPandadoc(), probarZoom(),
  ]);
  return NextResponse.json({ telegram, wisboo, pandadoc, zoom }, { headers: { "Cache-Control": "no-store" } });
}
