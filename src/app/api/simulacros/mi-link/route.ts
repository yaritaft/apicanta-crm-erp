import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import { configBienvenida } from "@/lib/contratos-servidor";
import { htmlDeBienvenida } from "@/lib/bienvenida-alumno";
import { codigoDeAlumno, configResend, enviarPorResend, ErrorSinTablaCodigos } from "@/lib/reporte-servidor";
import { limitador, origenDeLaApp } from "@/lib/reporte-enlace";
import { enlaceDeSimulacro, esMailValido, literalParaIlike, mailDeSimulacro } from "@/lib/simulacros";

/* ==================================================================
   POST /api/simulacros/mi-link  { "email": "…" }

   «No tengo mi código» en /simulacro: si el mail es de un alumno, le llega
   por mail su link para anotarse (con su código adentro, el mismo del
   reporte). Contesta lo mismo exista o no ese mail, así no sirve para
   averiguar quién es alumno. Pública: campo trampa (`sitio`) y límites por
   IP y por mail (no se le llena la casilla a nadie).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const porIp = limitador(5, 10 * 60_000);
const porMail = limitador(3, 60 * 60_000);
const SIN_CACHE = { "Cache-Control": "no-store" };
const LISTO = "Si ese mail es de un alumno, en unos minutos te llega tu link. Revisá también la carpeta de spam.";

const ipDe = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "sin-ip";
const responder = (cuerpo: Record<string, unknown>, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE });

export async function POST(req: Request) {
  if (porIp.golpea(ipDe(req))) return responder({ ok: false, error: "Demasiados intentos. Probá de nuevo en unos minutos." }, 429);
  const leido = await leerJson(req, 2_000);
  if (!leido.ok) return responder({ ok: false, error: leido.error }, leido.status);
  const b = (leido.json && typeof leido.json === "object" ? leido.json : {}) as Record<string, unknown>;
  if (typeof b.sitio === "string" && b.sitio.trim()) return responder({ ok: true, mensaje: LISTO });
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase().slice(0, 200) : "";
  if (!esMailValido(email)) return responder({ ok: false, error: "Escribí el mail con el que compraste." }, 400);
  if (porMail.golpea(email)) return responder({ ok: true, mensaje: LISTO });

  const db = nubeServidor();
  const cfg = configResend();
  if (!db || !cfg) return responder({ ok: false, error: "Ahora no podemos mandarte el mail: pedile tu link a tu coordinadora." }, 503);
  try {
    const r = await db.from("alumnos").select("id, nombre, email, estado, inicio").ilike("email", literalParaIlike(email)).limit(10);
    if (r.error) throw new Error(r.error.message);
    /* Si el mail está en más de una ficha: la del alumno activo y, entre esas, la más nueva. */
    const alumno = ((r.data ?? []) as { id: string; nombre: string; email: string; estado: string | null; inicio: string | null }[])
      .sort((x, y) => Number(y.estado === "activo") - Number(x.estado === "activo") || (y.inicio ?? "").localeCompare(x.inicio ?? ""))[0];
    if (!alumno) return responder({ ok: true, mensaje: LISTO });
    const codigo = await codigoDeAlumno(db, alumno.id);
    if (!codigo) return responder({ ok: true, mensaje: LISTO });
    const { asunto, texto } = mailDeSimulacro({ nombre: alumno.nombre, enlace: enlaceDeSimulacro(origenDeLaApp(req), codigo), codigo });
    const responderA = (await configBienvenida(db).catch(() => null))?.responderA;
    const envio = await enviarPorResend(cfg, { para: alumno.email, asunto, texto, html: htmlDeBienvenida(texto), responderA: responderA && esMailValido(responderA) ? responderA : undefined });
    if (!envio.ok) {
      console.error("[simulacros/mi-link]", envio.error);
      return responder({ ok: false, error: "No pudimos mandarte el mail. Probá de nuevo en un rato o pedile tu link a tu coordinadora." }, 502);
    }
    return responder({ ok: true, mensaje: LISTO });
  } catch (e) {
    if (!(e instanceof ErrorSinTablaCodigos)) console.error("[simulacros/mi-link]", e instanceof Error ? e.message.slice(0, 300) : "error");
    return responder({ ok: false, error: "No pudimos mandarte el mail. Probá de nuevo en un rato o pedile tu link a tu coordinadora." }, 500);
  }
}
