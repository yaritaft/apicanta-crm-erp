import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import { alumnoDeCodigo, ErrorSinTablaCodigos } from "@/lib/reporte-servidor";
import { esCodigoValido, limitador, primerNombre } from "@/lib/reporte-enlace";
import { MSJ_CODIGO_MALO } from "@/lib/links-alumno";
import { juevesDeLaConsulta, problemaDeConsulta } from "@/lib/consultas";

/* ==================================================================
   La consulta de los jueves (/consulta, reemplaza al Google Form; Lili 24/10).

     GET  /api/consultas/enviar?c=<código>  → { nombre, fecha, cuantas }
     POST /api/consultas/enviar  { codigo, consulta }

   Cada alumno entra con SU código, el mismo del reporte semanal: se sabe
   quién es y sólo dejan consultas los alumnos. Un código malo y uno que no
   existe dan el mismo mensaje. Pública: campo trampa (`sitio`) y límites por
   IP y por código. La consulta es del jueves de la clase (el de hoy hasta
   las 18 h); puede dejar más de una.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const porIp = limitador(20, 60_000);
const porCodigo = limitador(6, 10 * 60_000);
const SIN_CACHE = { "Cache-Control": "no-store" };

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "sin-ip";
const texto = (v: unknown, largo: number) => (typeof v === "string" ? v.trim().slice(0, largo) : "");
const responder = (cuerpo: Record<string, unknown>, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE });

export async function GET(req: Request) {
  if (porIp.golpea(ipDe(req))) return responder({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, 429);
  const c = new URL(req.url).searchParams.get("c")?.trim() ?? "";
  if (!esCodigoValido(c)) return responder({ ok: false, error: MSJ_CODIGO_MALO }, 404);
  const db = nubeServidor();
  if (!db) return responder({ ok: false, error: "Las consultas todavía no están habilitadas." }, 503);
  try {
    const alumno = await alumnoDeCodigo(db, c);
    if (!alumno) return responder({ ok: false, error: MSJ_CODIGO_MALO }, 404);
    const fecha = juevesDeLaConsulta(new Date().toISOString());
    const ya = await db.from("consultas_clase").select("id", { count: "exact", head: true }).eq("alumnoId", alumno.id).eq("fecha", fecha);
    return responder({ ok: true, nombre: primerNombre(alumno.nombre), fecha, cuantas: ya.count ?? 0 });
  } catch (e) {
    return errorInesperado(e);
  }
}

export async function POST(req: Request) {
  if (porIp.golpea(ipDe(req))) return responder({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, 429);
  const leido = await leerJson(req, 8_000);
  if (!leido.ok) return responder({ ok: false, error: leido.error }, leido.status);
  const b = (leido.json && typeof leido.json === "object" ? leido.json : {}) as Record<string, unknown>;
  /* El campo trampa: una persona no lo ve ni lo llena. Al bot se le dice que salió bien. */
  if (texto(b.sitio, 200)) return responder({ ok: true });

  const codigo = texto(b.codigo, 60);
  if (!esCodigoValido(codigo)) return responder({ ok: false, error: MSJ_CODIGO_MALO, campo: "codigo" }, 400);
  const consulta = texto(b.consulta, 3100);
  const problema = problemaDeConsulta(consulta);
  if (problema) return responder({ ok: false, error: problema }, 400);
  if (porCodigo.golpea(codigo)) return responder({ ok: false, error: "Ya mandaste varias consultas seguidas. Esperá unos minutos." }, 429);

  const db = nubeServidor();
  if (!db) return responder({ ok: false, error: "Las consultas todavía no están habilitadas." }, 503);
  try {
    const alumno = await alumnoDeCodigo(db, codigo);
    if (!alumno) return responder({ ok: false, error: MSJ_CODIGO_MALO, campo: "codigo" }, 404);
    const fecha = juevesDeLaConsulta(new Date().toISOString());
    const seg = await db.from("seguimiento_alumnos").select("telefono").eq("alumnoId", alumno.id).maybeSingle();
    const r = await db.from("consultas_clase").insert({
      id: `cq_${randomBytes(8).toString("hex")}`, fecha, primeraFecha: fecha, alumnoId: alumno.id,
      nombre: alumno.nombre, email: alumno.email ?? "", telefono: texto((seg.data as { telefono?: string } | null)?.telefono, 40),
      consulta, origen: "formulario",
    });
    if (r.error) throw new Error(r.error.message);
    return responder({ ok: true, fecha, nombre: primerNombre(alumno.nombre) });
  } catch (e) {
    return errorInesperado(e);
  }
}

function errorInesperado(e: unknown) {
  if (e instanceof ErrorSinTablaCodigos) return responder({ ok: false, error: "Las consultas todavía no están habilitadas." }, 503);
  console.error("[consultas/enviar]", e instanceof Error ? e.message.slice(0, 300) : "error");
  return responder({ ok: false, error: "No pudimos guardar tu consulta. Probá de nuevo en un momento." }, 500);
}
