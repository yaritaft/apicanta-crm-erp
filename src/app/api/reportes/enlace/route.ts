import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import { alumnoPorId, codigoDeAlumno, ErrorSinTablaCodigos } from "@/lib/reporte-servidor";
import { enlaceDeReporte, mensajeParaAlumno, origenDeLaApp } from "@/lib/reporte-enlace";
import { enlaceDelAlumno, mensajeDelLink } from "@/lib/links-alumno";

/* ==================================================================
   El link del reporte de un alumno, para copiárselo por WhatsApp.

     POST /api/reportes/enlace   { "alumnoId": "alu_…", "para"?: "simulacro" | "consulta" }
     → { codigo, enlace, mensaje }   (el mensaje, listo para pegar)

   El código es uno solo por alumno y sirve para todo (Juan Cruz, 24/10): con
   «para» devuelve su link de ese formulario (el simulacro de los martes, la
   consulta de los jueves), con el mismo código adentro (lib/links-alumno.ts).

   Lo pide quien edita Alumnos (Customer Success, los dueños), con su sesión:
   el código es la llave con la que se completa el reporte de ese alumno, así que
   no se da a quien sólo ve. Si el alumno todavía no tenía código, se le crea.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["alumnos"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const leido = await leerJson(req, 2_000);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const cuerpo = (leido.json ?? {}) as { alumnoId?: unknown; para?: unknown };
  const alumnoId = typeof cuerpo.alumnoId === "string" ? cuerpo.alumnoId.trim() : "";
  const para = cuerpo.para === "simulacro" || cuerpo.para === "consulta" ? cuerpo.para : null;
  if (!alumnoId || alumnoId.length > 120) return NextResponse.json({ error: "Falta el alumno." }, { status: 400 });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor de la app." }, { status: 503 });
  try {
    const alumno = await alumnoPorId(db, alumnoId);
    if (!alumno) return NextResponse.json({ error: "No encontré a ese alumno." }, { status: 404 });
    const codigo = await codigoDeAlumno(db, alumnoId);
    if (!codigo) return NextResponse.json({ error: "No encontré a ese alumno." }, { status: 404 });
    if (para) {
      const enlace = enlaceDelAlumno(para, origenDeLaApp(req), codigo);
      return NextResponse.json({ ok: true, codigo, enlace, mensaje: mensajeDelLink(para, { nombre: alumno.nombre, enlace }) }, { headers: SIN_CACHE });
    }
    const enlace = enlaceDeReporte(origenDeLaApp(req), codigo);
    return NextResponse.json({ ok: true, codigo, enlace, mensaje: mensajeParaAlumno({ nombre: alumno.nombre, enlace, codigo }) }, { headers: SIN_CACHE });
  } catch (e) {
    if (e instanceof ErrorSinTablaCodigos) return NextResponse.json({ error: e.message, tabla: false }, { status: 503 });
    console.error("[reportes/enlace]", e instanceof Error ? e.message.slice(0, 300) : "error");
    return NextResponse.json({ error: "No se pudo armar el link. Revisá los registros de la app." }, { status: 500 });
  }
}
