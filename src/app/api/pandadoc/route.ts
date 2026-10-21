import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { borrarSuscripcion, clavePandadoc, crearSuscripcion, ErrorPandadoc } from "@/lib/pandadoc-servidor";
import type { ModoContrato } from "@/lib/contratos";

/* ==================================================================
   El aviso de PandaDoc, desde Ajustes → Integraciones.
   GET: qué suscripciones hay (producción y prueba) y si hay clave para cada una.
   POST { accion: "conectar" | "desconectar", modo }: crea (o borra) la
   suscripción en PandaDoc apuntando a /api/pandadoc/webhook y guarda su
   clave en `pandadoc_conexion` (no pasa por el navegador). Sólo dueños.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODOS: ModoContrato[] = ["produccion", "prueba"];

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const r = await db.from("pandadoc_conexion").select('modo, "conectadoEn", "conectadoPor", url');
  if (r.error) return NextResponse.json({ error: /pandadoc_conexion|PGRST205|42P01/.test(`${r.error.code} ${r.error.message}`) ? "Falta correr supabase/contratos-y-accesos.sql." : r.error.message }, { status: 503 });
  const filas = (r.data ?? []) as { modo: ModoContrato; conectadoEn: string | null; conectadoPor: string; url: string | null }[];
  return NextResponse.json({
    modos: MODOS.map((modo) => {
      const f = filas.find((x) => x.modo === modo);
      return { modo, clave: Boolean(clavePandadoc(modo)), conectado: Boolean(f?.conectadoEn), conectadoEn: f?.conectadoEn ?? null, conectadoPor: f?.conectadoPor ?? "" };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  if (!(await esDuenoDelPedido(peticion))) return NextResponse.json({ error: "Conectar PandaDoc es de los dueños." }, { status: 403 });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; modo?: ModoContrato };
  const modo = b.modo === "prueba" ? "prueba" : "produccion";
  try {
    const previa = (await db.from("pandadoc_conexion").select('"suscripcionId"').eq("modo", modo).maybeSingle()).data as { suscripcionId?: string } | null;
    if (b.accion === "desconectar") {
      if (previa?.suscripcionId) await borrarSuscripcion(modo, previa.suscripcionId);
      await db.from("pandadoc_conexion").delete().eq("modo", modo);
      return NextResponse.json({ ok: true });
    }
    if (b.accion !== "conectar") return NextResponse.json({ error: "No sé hacer eso." }, { status: 400 });
    /* Una sola suscripción por modo: la vieja se borra antes (si no, cada aviso llegaría dos veces). */
    if (previa?.suscripcionId) await borrarSuscripcion(modo, previa.suscripcionId);
    const url = `${new URL(peticion.url).origin}/api/pandadoc/webhook`;
    const s = await crearSuscripcion(modo, url);
    const up = await db.from("pandadoc_conexion").upsert({
      modo, suscripcionId: s.id, clave: s.clave, url, conectadoEn: new Date().toISOString(), conectadoPor: correoDelPedido(peticion),
    }, { onConflict: "modo" });
    if (up.error) throw new Error(`Se creó en PandaDoc pero no se guardó la clave: ${up.error.message}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ErrorPandadoc) console.error("[pandadoc] conexión", modo, e.status, e.detalle);
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: e instanceof ErrorPandadoc ? 502 : 500 });
  }
}
