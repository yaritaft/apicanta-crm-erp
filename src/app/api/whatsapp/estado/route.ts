import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { ErrorSinTablas, estadoParaPantalla, repositorio, respuestaDeError, SIN_BASE, tokenDelLector } from "@/lib/whatsapp-servidor";

/* ==================================================================
   Cómo está el lector de WhatsApp y qué grupos detectó: Ajustes →
   WhatsApp, y el aviso de Webinars y del Dashboard.

   GET. Lo ve quien ve los Webinars. Sin las tablas (falta correr
   supabase/whatsapp-lector.sql) contesta igual, con `tablas: false`.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["webinars"], 1);
  if (noPuede) return noPuede;

  const donde = repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await estadoParaPantalla(donde.repo, donde.modo), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErrorSinTablas) {
      return NextResponse.json({ configurado: Boolean(tokenDelLector()), tablas: false, modo: donde.modo, lector: null, grupos: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    return respuestaDeError(e, "whatsapp/estado");
  }
}
