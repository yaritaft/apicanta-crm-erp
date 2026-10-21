import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { datosDeIntegrantes, ErrorSinTablas, repositorio, respuestaDeError, SIN_BASE, tokenDelLector } from "@/lib/whatsapp-servidor";

/* ==================================================================
   Grupos de WhatsApp (Crecimiento): los grupos que detectó el lector y quién
   está adentro de cada uno.

   GET → { grupos, miembros: [{ grupoId, telefono, dentro, entro, salio }] }
   La pantalla saca de ahí cuántos hay, cuántos entraron, cuántos salieron y la
   retención de cada grupo, y la lista de todos los integrantes.

   Trae los teléfonos de todos: lo ve sólo quien ve los Webinars y no está
   limitado a lo suyo (como /api/whatsapp/webinar). Nunca escribe nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const donde = repositorio();
  const noPuede = await exigirArea(peticion, ["webinars"], 1, { sinSoloLoSuyo: true, cerrado: donde?.modo === "nube" });
  if (noPuede) return noPuede;
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await datosDeIntegrantes(donde.repo, donde.modo), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErrorSinTablas) {
      return NextResponse.json({
        configurado: Boolean(tokenDelLector()), tablas: false, modo: donde.modo, lector: null, grupos: [], miembros: [], generado: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return respuestaDeError(e, "whatsapp/integrantes");
  }
}
