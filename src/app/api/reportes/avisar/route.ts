import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import {
  alumnoPorId, anotarAviso, avisosDe, codigoDeAlumno, configResend, enviarPorResend, ErrorSinTablaCodigos, estadoEnResend,
} from "@/lib/reporte-servidor";
import { armarMail, enlaceDeReporte, origenDeLaApp } from "@/lib/reporte-enlace";

/* ==================================================================
   El aviso del reporte semanal por mail (Resend).

     POST /api/reportes/avisar   { "alumnoIds": ["alu_…"], "accion": "enviar" }
     POST /api/reportes/avisar   { "alumnoIds": ["alu_…"], "accion": "estado" }

   «enviar» le manda a cada alumno el link con su código y anota cuándo salió;
   «estado» le pregunta a Resend cómo le fue a cada mail (entregado, rebotó…).
   Hasta 50 por vez. Para volver a mandarlo basta con volver a pedirlo.
   Hace falta RESEND_API_KEY y RESEND_FROM (un remitente de un dominio verificado
   en Resend); sin ellos contesta 503 y no manda nada. Lo pide quien edita Alumnos.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_POR_VEZ = 50;

interface Resultado { alumnoId: string; ok: boolean; estado?: string; error?: string }

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["alumnos"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const cfg = configResend();
  if (!cfg) {
    return NextResponse.json(
      { error: "Los avisos por mail todavía no están habilitados: faltan RESEND_API_KEY y RESEND_FROM en el servidor de la app.", habilitado: false },
      { status: 503 },
    );
  }
  const leido = await leerJson(req, 20_000);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const cuerpo = (leido.json ?? {}) as { alumnoIds?: unknown; accion?: unknown };
  const ids = Array.isArray(cuerpo.alumnoIds) ? [...new Set(cuerpo.alumnoIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 120))] : [];
  if (ids.length === 0) return NextResponse.json({ error: "Falta elegir a quién avisar." }, { status: 400 });
  if (ids.length > MAX_POR_VEZ) return NextResponse.json({ error: `Se puede avisar a ${MAX_POR_VEZ} alumnos por vez.` }, { status: 400 });
  const accion = cuerpo.accion === "estado" ? "estado" : "enviar";

  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor de la app." }, { status: 503 });
  const resultados: Resultado[] = [];
  try {
    if (accion === "estado") {
      const avisos = await avisosDe(db, ids);
      for (const id of ids) {
        const a = avisos.get(id);
        if (!a?.id) { resultados.push({ alumnoId: id, ok: false, error: "Todavía no se le mandó ningún aviso." }); continue; }
        const r = await estadoEnResend(cfg, a.id);
        if (!r.ok) { resultados.push({ alumnoId: id, ok: false, error: r.error }); continue; }
        await anotarAviso(db, id, { id: a.id, estado: r.estado });
        resultados.push({ alumnoId: id, ok: true, estado: r.estado });
      }
    } else {
      const origen = origenDeLaApp(req);
      for (const id of ids) {
        const alumno = await alumnoPorId(db, id);
        if (!alumno) { resultados.push({ alumnoId: id, ok: false, error: "No encontré a ese alumno." }); continue; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(alumno.email ?? "")) { resultados.push({ alumnoId: id, ok: false, error: "No tiene un mail válido cargado." }); continue; }
        const codigo = await codigoDeAlumno(db, id);
        if (!codigo) { resultados.push({ alumnoId: id, ok: false, error: "No encontré a ese alumno." }); continue; }
        const mail = armarMail({ nombre: alumno.nombre, enlace: enlaceDeReporte(origen, codigo) });
        const r = await enviarPorResend(cfg, { para: alumno.email, asunto: mail.asunto, texto: mail.texto, html: mail.html });
        if (!r.ok) { resultados.push({ alumnoId: id, ok: false, error: r.error }); continue; }
        await anotarAviso(db, id, { id: r.id, estado: "sent" });
        resultados.push({ alumnoId: id, ok: true, estado: "sent" });
      }
    }
    return NextResponse.json({ ok: true, resultados, enviados: resultados.filter((r) => r.ok).length, fallaron: resultados.filter((r) => !r.ok).length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ErrorSinTablaCodigos) return NextResponse.json({ error: e.message, tabla: false }, { status: 503 });
    console.error("[reportes/avisar]", e instanceof Error ? e.message.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "…").slice(0, 300) : "error");
    return NextResponse.json({ error: "No se pudo mandar el aviso. Revisá los registros de la app." }, { status: 500 });
  }
}
