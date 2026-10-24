import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { martesDeLaClase, problemaDeInscripcion } from "@/lib/simulacros";

/* ==================================================================
   POST /api/simulacros/inscripcion — la inscripción al simulacro de
   entrevista del martes (/simulacro, reemplaza al Google Form; Lili 23/10).
   Es pública: se cuida con un campo trampa para bots (`sitio`) y un límite
   por IP. Queda para el martes de la clase (hoy si es martes) y la base la
   ata sola al alumno por el teléfono (supabase/simulacros.sql). Anotarse de
   nuevo para el mismo martes con el mismo celular no duplica: actualiza.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const intentos = new Map<string, number[]>();
function demasiados(ip: string): boolean {
  const ahora = Date.now();
  const xs = (intentos.get(ip) ?? []).filter((t) => ahora - t < 60_000);
  xs.push(ahora);
  intentos.set(ip, xs);
  if (intentos.size > 5000) intentos.clear();
  return xs.length > 8;
}

const texto = (v: unknown, largo: number) => (typeof v === "string" ? v.trim().slice(0, largo) : "");
const ultimos8 = (t: string) => t.replace(/\D/g, "").slice(-8);

export async function POST(req: Request) {
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false, error: "Sin base configurada." }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  if (ip && demasiados(ip)) return NextResponse.json({ ok: false, error: "Demasiados intentos: probá de nuevo en un minuto." }, { status: 429 });

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  /* El campo trampa: una persona no lo ve ni lo llena. Al bot se le dice que salió bien. */
  if (texto(b.sitio, 200)) return NextResponse.json({ ok: true });
  const datos = {
    nombre: texto(b.nombre, 120), telefono: texto(b.telefono, 40), stack: texto(b.stack, 200),
    tipoPedido: texto(b.tipoPedido, 80), preparado: b.preparado === true,
  };
  const problema = problemaDeInscripcion(datos);
  if (problema) return NextResponse.json({ ok: false, error: problema }, { status: 400 });

  const fecha = martesDeLaClase(diaDeNegocio(new Date().toISOString()));
  const ya = await db.from("simulacros").select("id, telefono, estado").eq("fecha", fecha);
  if (ya.error) {
    console.error("[simulacros] inscripción", ya.error.message);
    return NextResponse.json({ ok: false, error: "No pudimos anotarte. Probá de nuevo en un momento." }, { status: 500 });
  }
  const mismo = ((ya.data ?? []) as { id: string; telefono: string; estado: string }[])
    .find((s) => ultimos8(s.telefono) === ultimos8(datos.telefono));
  const r = mismo
    ? await db.from("simulacros").update({ ...datos }).eq("id", mismo.id)
    : await db.from("simulacros").insert({ id: `sim_${randomBytes(8).toString("hex")}`, fecha, ...datos, origen: "formulario" });
  if (r.error) {
    console.error("[simulacros] inscripción", r.error.message);
    return NextResponse.json({ ok: false, error: "No pudimos anotarte. Probá de nuevo en un momento." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, fecha, otraVez: Boolean(mismo) });
}
