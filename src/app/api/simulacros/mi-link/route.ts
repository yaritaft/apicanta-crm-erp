import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerJson } from "@/lib/whatsapp-servidor";
import { alumnoPorMail, configResend, ErrorSinTablaCodigos } from "@/lib/reporte-servidor";
import { mandarLinkDelAlumno } from "@/lib/links-alumno-servidor";
import { limitador, origenDeLaApp } from "@/lib/reporte-enlace";
import { esLinkDelAlumno, esMailValido } from "@/lib/links-alumno";

/* ==================================================================
   POST /api/simulacros/mi-link  { "email": "…", "para"?: "simulacro" | "consulta" | "reporte" }

   «No tengo mi código» en /simulacro y /consulta: si el mail es de un
   alumno, le llega por mail su link de ese formulario (con su código
   adentro, el mismo del reporte; lib/links-alumno.ts). Contesta lo mismo exista o no ese mail, así no sirve para
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
  const para = esLinkDelAlumno(b.para) ? b.para : "simulacro";
  if (!esMailValido(email)) return responder({ ok: false, error: "Escribí el mail con el que compraste." }, 400);
  if (porMail.golpea(email)) return responder({ ok: true, mensaje: LISTO });

  const db = nubeServidor();
  const cfg = configResend();
  if (!db || !cfg) return responder({ ok: false, error: "Ahora no podemos mandarte el mail: pedile tu link a tu coordinadora." }, 503);
  try {
    const alumno = await alumnoPorMail(db, email);
    if (!alumno) return responder({ ok: true, mensaje: LISTO });
    const envio = await mandarLinkDelAlumno(db, origenDeLaApp(req), alumno, para);
    if (!envio.ok && envio.motivo !== "sin-codigo") {
      console.error("[simulacros/mi-link]", envio.error ?? envio.motivo);
      return responder({ ok: false, error: "No pudimos mandarte el mail. Probá de nuevo en un rato o pedile tu link a tu coordinadora." }, 502);
    }
    return responder({ ok: true, mensaje: LISTO });
  } catch (e) {
    if (!(e instanceof ErrorSinTablaCodigos)) console.error("[simulacros/mi-link]", e instanceof Error ? e.message.slice(0, 300) : "error");
    return responder({ ok: false, error: "No pudimos mandarte el mail. Probá de nuevo en un rato o pedile tu link a tu coordinadora." }, 500);
  }
}
