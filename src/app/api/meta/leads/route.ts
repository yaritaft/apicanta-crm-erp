import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { sincronizarLeadsMeta } from "@/lib/meta-leads-sync";

/* ==================================================================
   "Traer los formularios ahora", desde Ajustes → Integraciones.

   Lo mismo que hace solo el cron de Meta cada 15 minutos, pero mirando
   los últimos 90 días (todo lo que guarda Meta): sirve para la primera
   vez y para ver enseguida si a Meta le falta algún permiso. Sólo para
   el equipo: escribe en la base con la clave de servicio.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const cuerpo = (await peticion.json().catch(() => ({}))) as { dias?: number };
  const dias = Number.isFinite(cuerpo.dias) ? Number(cuerpo.dias) : 90;
  const r = await sincronizarLeadsMeta({ dias, limite: 400 });
  return NextResponse.json(r, { status: r.errores.length && !r.paginas.length ? 502 : 200 });
}
