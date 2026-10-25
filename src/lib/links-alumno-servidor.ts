import type { SupabaseClient } from "@supabase/supabase-js";
import { configBienvenida } from "./contratos-servidor";
import { htmlDeBienvenida } from "./bienvenida-alumno";
import { codigoDeAlumno, configResend, enviarPorResend } from "./reporte-servidor";
import type { AlumnoBasico } from "./reportes-webhook";
import { enlaceDelAlumno, esMailValido, mailDelLink, type LinkDelAlumno } from "./links-alumno";

/* Del lado del SERVIDOR (clave de servicio): le manda a un alumno, a SU mail, el link de un formulario con su código adentro
   (lib/links-alumno.ts). Lo usan «No tengo mi código» (/api/simulacros/mi-link) y el reporte que se completó sin código. */

export type ResultadoLink = { ok: true } | { ok: false; motivo: "sin-resend" | "sin-codigo" | "error"; error?: string };

export async function mandarLinkDelAlumno(db: SupabaseClient, origen: string, alumno: AlumnoBasico, para: LinkDelAlumno): Promise<ResultadoLink> {
  const cfg = configResend();
  if (!cfg) return { ok: false, motivo: "sin-resend" };
  if (!esMailValido(alumno.email.trim().toLowerCase())) return { ok: false, motivo: "sin-codigo" };
  const codigo = await codigoDeAlumno(db, alumno.id);
  if (!codigo) return { ok: false, motivo: "sin-codigo" };
  const { asunto, texto } = mailDelLink(para, { nombre: alumno.nombre, enlace: enlaceDelAlumno(para, origen, codigo), codigo });
  const responderA = (await configBienvenida(db).catch(() => null))?.responderA;
  const envio = await enviarPorResend(cfg, { para: alumno.email, asunto, texto, html: htmlDeBienvenida(texto), responderA: responderA && esMailValido(responderA) ? responderA : undefined });
  return envio.ok ? { ok: true } : { ok: false, motivo: "error", error: envio.error };
}
