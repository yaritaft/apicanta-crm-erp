import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import { baseSupabaseReportes } from "@/lib/reportes-servidor";
import { hoyParaReportes } from "@/lib/reportes-webhook";
import { alumnoDeCodigo, ErrorSinTablaCodigos, recibirDelAlumno } from "@/lib/reporte-servidor";
import { esCodigoValido, leerEnvio, limitador, MAX_BYTES_ENVIO, primerNombre } from "@/lib/reporte-enlace";

/* ==================================================================
   El formulario público del reporte semanal (/reporte).

     POST /api/reportes/enviar
     { "codigo": "<uuid del alumno>", "horas": 10, "entrevistas": 2,
       "postulaciones": 5, "bloqueo": "…" }

   Es público: lo llama el navegador del alumno, sin sesión. Lo que lo cuida:
   - el código es un UUID al azar (122 bits): no se adivina ni se recorre;
   - un límite por IP y otro por código (frenan a un bot y a un doble clic);
   - un campo trampa (`sitio`) que una persona no ve: al bot se le dice que salió bien;
   - nada de lo que contesta dice si un código existe más que para quien lo tiene
     (un código malo y uno que no existe dan el mismo mensaje).

   GET /api/reportes/enviar?c=<código> devuelve el primer nombre del alumno y si
   ya completó esta semana, para saludarlo en el formulario.
   El reporte de la misma semana se reemplaza: completarlo dos veces no lo duplica.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const porIp = limitador(20, 60_000);
const porCodigo = limitador(8, 5 * 60_000);
const SIN_CACHE = { "Cache-Control": "no-store" };
const CODIGO_MALO = "No encontramos ese código. Copialo de nuevo del mensaje que te mandamos, o pedile a tu coordinadora que te lo pase.";

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "sin-ip";

export async function GET(req: Request) {
  if (porIp.golpea(ipDe(req))) return NextResponse.json({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, { status: 429, headers: SIN_CACHE });
  const c = new URL(req.url).searchParams.get("c")?.trim() ?? "";
  if (!esCodigoValido(c)) return NextResponse.json({ ok: false, error: CODIGO_MALO }, { status: 404, headers: SIN_CACHE });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false, error: "El reporte todavía no está habilitado." }, { status: 503, headers: SIN_CACHE });
  try {
    const alumno = await alumnoDeCodigo(db, c);
    if (!alumno) return NextResponse.json({ ok: false, error: CODIGO_MALO }, { status: 404, headers: SIN_CACHE });
    return NextResponse.json({ ok: true, nombre: primerNombre(alumno.nombre) }, { headers: SIN_CACHE });
  } catch (e) {
    return errorInesperado(e);
  }
}

export async function POST(req: Request) {
  if (porIp.golpea(ipDe(req))) return NextResponse.json({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, { status: 429, headers: SIN_CACHE });
  const leido = await leerJson(req, MAX_BYTES_ENVIO);
  if (!leido.ok) return NextResponse.json({ ok: false, error: leido.error }, { status: leido.status, headers: SIN_CACHE });

  /* El campo trampa: al bot se le dice que salió bien, así no insiste. */
  const crudo = leido.json as Record<string, unknown> | null;
  if (crudo && typeof crudo === "object" && String(crudo.sitio ?? "").trim()) return NextResponse.json({ ok: true }, { headers: SIN_CACHE });

  const v = leerEnvio(leido.json);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error, campo: v.campo }, { status: 400, headers: SIN_CACHE });
  if (porCodigo.golpea(v.valor.codigo)) return NextResponse.json({ ok: false, error: "Ya mandaste varios reportes seguidos. Esperá unos minutos." }, { status: 429, headers: SIN_CACHE });

  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false, error: "El reporte todavía no está habilitado." }, { status: 503, headers: SIN_CACHE });
  try {
    const alumno = await alumnoDeCodigo(db, v.valor.codigo);
    if (!alumno) return NextResponse.json({ ok: false, error: CODIGO_MALO, campo: "codigo" }, { status: 404, headers: SIN_CACHE });
    const { codigo: _codigo, ...datos } = v.valor;
    void _codigo;
    const r = await recibirDelAlumno(baseSupabaseReportes(db), alumno, datos, hoyParaReportes(), new Date().toISOString());
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: SIN_CACHE });
    if (r.guardados === 0) {
      /* Lo que no se pudo guardar se dice sin datos de nadie. */
      return NextResponse.json({ ok: false, error: "No pudimos guardar tu reporte. Avisale a tu coordinadora." }, { status: 422, headers: SIN_CACHE });
    }
    return NextResponse.json({ ok: true, nombre: primerNombre(alumno.nombre), reemplazo: r.actualizados > 0 }, { headers: SIN_CACHE });
  } catch (e) {
    return errorInesperado(e);
  }
}

function errorInesperado(e: unknown) {
  if (e instanceof ErrorSinTablaCodigos) return NextResponse.json({ ok: false, error: "El reporte todavía no está habilitado." }, { status: 503, headers: SIN_CACHE });
  console.error("[reportes/enviar]", e instanceof Error ? e.message.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "…").slice(0, 300) : "error");
  return NextResponse.json({ ok: false, error: "No pudimos guardar tu reporte. Probá de nuevo en un rato." }, { status: 500, headers: SIN_CACHE });
}
