import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { leerJson } from "@/lib/whatsapp-servidor";
import { alumnoDeCodigo, ErrorSinTablaCodigos } from "@/lib/reporte-servidor";
import { esCodigoValido, limitador, primerNombre } from "@/lib/reporte-enlace";
import { martesDeLaClase, MSJ_CODIGO_MALO, problemaDeInscripcion } from "@/lib/simulacros";

/* ==================================================================
   La inscripción al simulacro de entrevista del martes (/simulacro,
   reemplaza al Google Form; Lili 23/10).

     GET  /api/simulacros/inscripcion?c=<código>  → { nombre, fecha, ya, stack }
     POST /api/simulacros/inscripcion  { codigo, stack, tipoPedido, preparado }

   Cada alumno entra con SU código, el mismo del reporte semanal (Juan Cruz,
   24/10): así se sabe seguro quién es y sólo se anotan alumnos. El código es
   un UUID al azar; un código malo y uno que no existe dan el mismo mensaje.
   Pública: se cuida con un campo trampa (`sitio`) y límites por IP y por
   código. Queda para el martes de la clase (hoy si es martes); anotarse de
   nuevo para el mismo martes actualiza, no duplica.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const porIp = limitador(20, 60_000);
const porCodigo = limitador(8, 5 * 60_000);
const SIN_CACHE = { "Cache-Control": "no-store" };

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "sin-ip";
const texto = (v: unknown, largo: number) => (typeof v === "string" ? v.trim().slice(0, largo) : "");
const responder = (cuerpo: Record<string, unknown>, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE });
const claseDeHoy = () => martesDeLaClase(diaDeNegocio(new Date().toISOString()));

export async function GET(req: Request) {
  if (porIp.golpea(ipDe(req))) return responder({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, 429);
  const c = new URL(req.url).searchParams.get("c")?.trim() ?? "";
  if (!esCodigoValido(c)) return responder({ ok: false, error: MSJ_CODIGO_MALO }, 404);
  const db = nubeServidor();
  if (!db) return responder({ ok: false, error: "La inscripción todavía no está habilitada." }, 503);
  try {
    const alumno = await alumnoDeCodigo(db, c);
    if (!alumno) return responder({ ok: false, error: MSJ_CODIGO_MALO }, 404);
    const fecha = claseDeHoy();
    /* Para saludarlo y no hacerle escribir de nuevo su stack: lo último que puso. */
    const previos = await db.from("simulacros").select("fecha, stack").eq("alumnoId", alumno.id).order("fecha", { ascending: false }).limit(5);
    const lista = (previos.data ?? []) as { fecha: string; stack: string }[];
    return responder({ ok: true, nombre: primerNombre(alumno.nombre), fecha, ya: lista.some((s) => s.fecha === fecha), stack: lista.find((s) => s.stack)?.stack ?? "" });
  } catch (e) {
    return errorInesperado(e);
  }
}

export async function POST(req: Request) {
  if (porIp.golpea(ipDe(req))) return responder({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, 429);
  const leido = await leerJson(req, 4_000);
  if (!leido.ok) return responder({ ok: false, error: leido.error }, leido.status);
  const b = (leido.json && typeof leido.json === "object" ? leido.json : {}) as Record<string, unknown>;
  /* El campo trampa: una persona no lo ve ni lo llena. Al bot se le dice que salió bien. */
  if (texto(b.sitio, 200)) return responder({ ok: true });

  const codigo = texto(b.codigo, 60);
  if (!esCodigoValido(codigo)) return responder({ ok: false, error: MSJ_CODIGO_MALO, campo: "codigo" }, 400);
  const datos = { stack: texto(b.stack, 200), tipoPedido: texto(b.tipoPedido, 80), preparado: b.preparado === true };
  const problema = problemaDeInscripcion(datos);
  if (problema) return responder({ ok: false, error: problema }, 400);
  if (porCodigo.golpea(codigo)) return responder({ ok: false, error: "Ya te anotaste varias veces seguidas. Esperá unos minutos." }, 429);

  const db = nubeServidor();
  if (!db) return responder({ ok: false, error: "La inscripción todavía no está habilitada." }, 503);
  try {
    const alumno = await alumnoDeCodigo(db, codigo);
    if (!alumno) return responder({ ok: false, error: MSJ_CODIGO_MALO, campo: "codigo" }, 404);
    const fecha = claseDeHoy();
    const seg = await db.from("seguimiento_alumnos").select("telefono").eq("alumnoId", alumno.id).maybeSingle();
    const telefono = texto((seg.data as { telefono?: string } | null)?.telefono, 40);
    const ya = await db.from("simulacros").select("id").eq("fecha", fecha).eq("alumnoId", alumno.id).limit(1);
    if (ya.error) throw new Error(ya.error.message);
    const mismo = (ya.data ?? [])[0] as { id: string } | undefined;
    const fila = { ...datos, nombre: alumno.nombre, telefono, alumnoId: alumno.id };
    const r = mismo
      ? await db.from("simulacros").update(fila).eq("id", mismo.id)
      : await db.from("simulacros").insert({ id: `sim_${randomBytes(8).toString("hex")}`, fecha, ...fila, origen: "formulario" });
    if (r.error) throw new Error(r.error.message);
    return responder({ ok: true, fecha, otraVez: Boolean(mismo), nombre: primerNombre(alumno.nombre) });
  } catch (e) {
    return errorInesperado(e);
  }
}

function errorInesperado(e: unknown) {
  if (e instanceof ErrorSinTablaCodigos) return responder({ ok: false, error: "La inscripción todavía no está habilitada." }, 503);
  console.error("[simulacros/inscripcion]", e instanceof Error ? e.message.slice(0, 300) : "error");
  return responder({ ok: false, error: "No pudimos anotarte. Probá de nuevo en un momento." }, 500);
}
