import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerJson, respuestaDeError, tokenValido } from "@/lib/whatsapp-servidor";
import { baseSupabaseReportes, recibirReportes } from "@/lib/reportes-servidor";
import { hoyParaReportes } from "@/lib/reportes-webhook";

/* ==================================================================
   Los reportes semanales de los alumnos, directo a la app.

   La herramienta donde los alumnos completan su reporte de la semana (un
   formulario, una automatización del Airtable) manda cada respuesta acá:

     POST /api/reportes/webhook
     Authorization: Bearer <REPORTES_WEBHOOK_TOKEN>
     { "email": "ana@mail.com", "semana": "2026-10-08", "horas": 10,
       "entrevistas": 2, "postulaciones": 5, "bloqueo": "…" }

   También sirve una lista de reportes (hasta 200) o { "reportes": [ … ] }.
   Sin «semana» se toma la de hoy. Mandar de nuevo el de la misma semana lo
   reemplaza. Los nombres de los datos se leen con algo de margen (mail, horas
   de estudio, comentarios…). Lo que no se pudo guardar vuelve en `rechazados`,
   con su posición y el motivo. (lib/reportes-webhook.ts)
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 400_000;

const tokenDelWebhook = (): string | null => process.env.REPORTES_WEBHOOK_TOKEN?.trim() || null;
const tokenDelPedido = (p: Request): string | null => /^Bearer\s+(\S+)\s*$/i.exec(p.headers.get("authorization") ?? "")?.[1] ?? null;

export async function POST(peticion: Request) {
  const esperado = tokenDelWebhook();
  if (!esperado) {
    return NextResponse.json(
      { error: "Los reportes semanales todavía no están habilitados: falta la variable REPORTES_WEBHOOK_TOKEN en el servidor de la app." },
      { status: 503 },
    );
  }
  if (!tokenValido(tokenDelPedido(peticion), esperado)) {
    return NextResponse.json({ error: "No autorizado: mandá «Authorization: Bearer <token>» con el token de los reportes." }, { status: 401 });
  }

  const leido = await leerJson(peticion, MAX_BYTES);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });

  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor de la app: no puede guardar los reportes." }, { status: 503 });
  try {
    const r = await recibirReportes(baseSupabaseReportes(db), leido.json, hoyParaReportes(), new Date().toISOString());
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respuestaDeError(e, "reportes/webhook");
  }
}
