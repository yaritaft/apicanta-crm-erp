import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarItems, type BaseReportes, type ResultadoReportes } from "./reportes-servidor";
import type { AlumnoBasico } from "./reportes-webhook";
import type { EnvioDelAlumno } from "./reporte-enlace";
import { camposDelReporte, formularioDelAlumnoCon, type FormularioReporte } from "./reporte-formularios";
import { literalParaIlike } from "./links-alumno";
import { lunesDelDia } from "./reportes";
import { diaAInstante } from "./dia-negocio";
import { idSinAlumno, reporteParaAtar, type EnvioSinCodigo } from "./reporte-sin-codigo";

/* ==================================================================
   El reporte semanal con link único, del lado del SERVIDOR: usa la clave de
   servicio (saltea RLS) y nunca se importa desde un componente de cliente.

   - Los códigos viven en `reporte_codigos` (supabase/reporte-semanal.sql), una
     tabla sin políticas: ni siquiera quien inició sesión puede leerla; sólo
     las rutas de la app, que primero comprueban quién pide.
   - El reporte se guarda con lo mismo que el webhook (guardarItems): el de
     la misma semana se reemplaza, no se duplica.
   - Los avisos por mail salen por Resend, si están RESEND_API_KEY y
     RESEND_FROM (un remitente de un dominio verificado en Resend).
   ================================================================== */

export class ErrorSinTablaCodigos extends Error {
  constructor() { super("Falta correr supabase/reporte-semanal.sql: todavía no existe la tabla de códigos de reporte."); }
}

const faltaLaTabla = (e: { code?: string; message?: string }) =>
  e.code === "42P01" || e.code === "PGRST205" || (/reporte_codigos/.test(e.message ?? "") && /does not exist|schema cache/i.test(e.message ?? ""));

/** El código del alumno; si todavía no tiene, se le crea uno. Dos pedidos a la vez dan el mismo. null: no existe ese alumno. */
export async function codigoDeAlumno(db: SupabaseClient, alumnoId: string): Promise<string | null> {
  const leer = async () => {
    const r = await db.from("reporte_codigos").select("codigo").eq("alumnoId", alumnoId).maybeSingle();
    if (r.error) throw faltaLaTabla(r.error) ? new ErrorSinTablaCodigos() : new Error(`reporte_codigos: ${r.error.message}`);
    return (r.data as { codigo?: string } | null)?.codigo ?? null;
  };
  const ya = await leer();
  if (ya) return ya;
  /* El alumno tiene que existir: se comprueba acá (la clave foránea también lo frenaría, con un error menos claro). */
  const a = await db.from("alumnos").select("id").eq("id", alumnoId).maybeSingle();
  if (a.error) throw new Error(`alumnos: ${a.error.message}`);
  if (!a.data) return null;
  const nuevo = await db.from("reporte_codigos").upsert({ alumnoId }, { onConflict: "alumnoId", ignoreDuplicates: true });
  if (nuevo.error) throw faltaLaTabla(nuevo.error) ? new ErrorSinTablaCodigos() : new Error(`reporte_codigos: ${nuevo.error.message}`);
  /* Se vuelve a leer: si otro pedido lo creó primero, vale el suyo. */
  return leer();
}

/** Un alumno por su id (lo mínimo para armar el mensaje o el mail). null si no existe. */
export async function alumnoPorId(db: SupabaseClient, alumnoId: string): Promise<AlumnoBasico | null> {
  const a = await db.from("alumnos").select("id,nombre,email").eq("id", alumnoId).maybeSingle();
  if (a.error) throw new Error(`alumnos: ${a.error.message}`);
  return (a.data as AlumnoBasico | null) ?? null;
}

/** Cuándo salió el último aviso a cada alumno y lo último que le pasó. Sin la tabla, nada. */
export async function avisosDe(db: SupabaseClient, alumnoIds: string[]): Promise<Map<string, { en?: string; id?: string; estado?: string }>> {
  const out = new Map<string, { en?: string; id?: string; estado?: string }>();
  for (let i = 0; i < alumnoIds.length; i += 100) {
    const r = await db.from("reporte_codigos").select("alumnoId,ultimoAvisoEn,ultimoAvisoId,ultimoAvisoEstado").in("alumnoId", alumnoIds.slice(i, i + 100));
    if (r.error) { if (faltaLaTabla(r.error)) return out; throw new Error(`reporte_codigos: ${r.error.message}`); }
    for (const f of (r.data ?? []) as { alumnoId: string; ultimoAvisoEn?: string; ultimoAvisoId?: string; ultimoAvisoEstado?: string }[]) {
      out.set(f.alumnoId, { en: f.ultimoAvisoEn ?? undefined, id: f.ultimoAvisoId ?? undefined, estado: f.ultimoAvisoEstado ?? undefined });
    }
  }
  return out;
}

/** De quién es un código. null si no existe. */
export async function alumnoDeCodigo(db: SupabaseClient, codigo: string): Promise<AlumnoBasico | null> {
  const c = await db.from("reporte_codigos").select("alumnoId").eq("codigo", codigo).maybeSingle();
  if (c.error) throw faltaLaTabla(c.error) ? new ErrorSinTablaCodigos() : new Error(`reporte_codigos: ${c.error.message}`);
  const alumnoId = (c.data as { alumnoId?: string } | null)?.alumnoId;
  if (!alumnoId) return null;
  const a = await db.from("alumnos").select("id,nombre,email").eq("id", alumnoId).maybeSingle();
  if (a.error) throw new Error(`alumnos: ${a.error.message}`);
  return (a.data as AlumnoBasico | null) ?? null;
}

/** El formulario que le toca a un alumno: el de su programa en Customer Success; si todavía no lo tiene cargado, el del plan de
 *  su venta. null si no se sabe (cursa los dos, o ninguno de los dos): el formulario público se lo pregunta. */
export async function formularioDelAlumno(db: SupabaseClient, alumnoId: string): Promise<FormularioReporte | null> {
  const seg = await db.from("seguimiento_alumnos").select("programas").eq("alumnoId", alumnoId).maybeSingle();
  /* Sin la tabla o sin fila: se sigue con el plan, no se corta el reporte. */
  const programas = !seg.error ? (seg.data as { programas?: unknown } | null)?.programas : null;
  if (Array.isArray(programas) && programas.some((x) => typeof x === "string")) return formularioDelAlumnoCon(programas, null);
  const a = await db.from("alumnos").select("plan").eq("id", alumnoId).maybeSingle();
  return formularioDelAlumnoCon(null, !a.error ? (a.data as { plan?: unknown } | null)?.plan : null);
}

/** Guarda el reporte que completó el alumno con su código: el de esta semana, reemplazando el que ya hubiera. */
export async function recibirDelAlumno(
  base: BaseReportes, alumno: AlumnoBasico, envio: Omit<EnvioDelAlumno, "codigo">, hoy: string, ahora: string,
): Promise<ResultadoReportes | { ok: false; status: number; error: string }> {
  /* Sólo este alumno: ninguna coincidencia de mail o de nombre con otro lo puede desviar. */
  const soloEste: BaseReportes = { ...base, alumnos: async () => [alumno] };
  const c = camposDelReporte(envio.formulario, envio.respuestas);
  return guardarItems(soloEste, [{
    posicion: 1,
    item: {
      email: alumno.email, alumno: alumno.nombre,
      horas: c.horas, entrevistas: c.entrevistas, postulaciones: c.postulaciones, ...(c.bloqueo ? { bloqueo: c.bloqueo } : {}),
      detalle: { programa: c.programa, formulario: c.formulario, respuestas: c.respuestas },
    },
  }], [], hoy, ahora);
}

/** El alumno de un mail. Si el mail está en más de una ficha: la del alumno activo y, entre esas, la más nueva. */
export async function alumnoPorMail(db: SupabaseClient, email: string): Promise<AlumnoBasico | null> {
  const r = await db.from("alumnos").select("id, nombre, email, estado, inicio").ilike("email", literalParaIlike(email)).limit(10);
  if (r.error) throw new Error(`alumnos: ${r.error.message}`);
  const a = ((r.data ?? []) as (AlumnoBasico & { estado: string | null; inicio: string | null })[])
    .sort((x, y) => Number(y.estado === "activo") - Number(x.estado === "activo") || (y.inicio ?? "").localeCompare(x.inicio ?? ""))[0];
  return a ? { id: a.id, nombre: a.nombre, email: a.email } : null;
}

/**
 * El reporte de alguien sin código (lib/reporte-sin-codigo.ts). Si el mail es de un alumno, o es un mail que Lili ya ató a un
 * alumno antes, va a ese alumno como cualquier reporte. Si no, queda en `reportes_sin_alumno` (supabase/reportes-sin-alumno.sql)
 * para que lo ate ella; el de la misma semana y el mismo mail se reemplaza.
 */
export async function recibirSinCodigo(
  db: SupabaseClient, base: BaseReportes, envio: EnvioSinCodigo, hoy: string, ahora: string,
): Promise<{ ok: true; alumno: AlumnoBasico | null; reemplazo: boolean } | { ok: false; status: number; error: string }> {
  const { datos, formulario, respuestas } = envio;
  let alumno = await alumnoPorMail(db, datos.email);
  if (!alumno) {
    const atado = await db.from("reportes_sin_alumno").select("alumnoId").ilike("email", literalParaIlike(datos.email))
      .eq("estado", "atado").not("alumnoId", "is", null).order("actualizadoEn", { ascending: false }).limit(1);
    if (atado.error) throw new Error(`reportes_sin_alumno: ${atado.error.message}`);
    const id = ((atado.data ?? [])[0] as { alumnoId?: string } | undefined)?.alumnoId;
    if (id) alumno = await alumnoPorId(db, id);
  }
  if (alumno) {
    const r = await recibirDelAlumno(base, alumno, { formulario, respuestas }, hoy, ahora);
    if (!r.ok) return r;
    if (r.guardados === 0) return { ok: false, status: 422, error: "No pudimos guardar tu reporte. Avisale a tu coordinadora." };
    return { ok: true, alumno, reemplazo: r.actualizados > 0 };
  }

  const semana = lunesDelDia(hoy);
  const id = idSinAlumno(datos.email, semana);
  const ya = await db.from("reportes_sin_alumno").select("id").eq("id", id).limit(1);
  if (ya.error) throw new Error(`reportes_sin_alumno: ${ya.error.message}`);
  const g = await db.from("reportes_sin_alumno").upsert({
    id, email: datos.email, nombre: datos.nombre, apellido: datos.apellido, telefono: datos.telefono,
    semanaDel: diaAInstante(semana), formulario: formulario.id, programa: formulario.programa, reporte: reporteParaAtar(formulario, respuestas),
    estado: "pendiente", alumnoId: null, reporteId: null, actualizadoEn: ahora,
  }, { onConflict: "id" });
  if (g.error) throw new Error(`reportes_sin_alumno: ${g.error.message}`);
  return { ok: true, alumno: null, reemplazo: (ya.data ?? []).length > 0 };
}

/* ---------- Resend ---------- */

export interface ConfigResend { clave: string; desde: string }

/** La clave y el remitente, o null si falta alguno (los avisos por mail quedan apagados). */
export const configResend = (): ConfigResend | null => {
  const clave = process.env.RESEND_API_KEY?.trim();
  const desde = process.env.RESEND_FROM?.trim();
  return clave && desde ? { clave, desde } : null;
};

export type Pedir = typeof fetch;

/** Un mail por Resend. Devuelve el id del envío, o por qué falló (sin la dirección ni la clave). */
export async function enviarPorResend(
  cfg: ConfigResend, mail: { para: string; asunto: string; texto: string; html: string; responderA?: string }, pedir: Pedir = fetch,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let r: Response;
  try {
    r = await pedir("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.clave}`, "Content-Type": "application/json" },
      /* «Responder a»: el remitente puede ser una dirección que no recibe (hackearit.com no tiene casilla) y la respuesta va a quien atiende. */
      body: JSON.stringify({ from: cfg.desde, to: [mail.para], subject: mail.asunto, text: mail.texto, html: mail.html, ...(mail.responderA ? { reply_to: mail.responderA } : {}) }),
    });
  } catch {
    return { ok: false, error: "No se pudo conectar con Resend." };
  }
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string; error?: string };
  if (!r.ok) return { ok: false, error: (j.message ?? j.error ?? `Resend respondió ${r.status}.`).toString().replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "…").slice(0, 200) };
  return j.id ? { ok: true, id: j.id } : { ok: false, error: "Resend no devolvió el id del envío." };
}

/** Cómo va un mail ya enviado: lo último que le pasó según Resend («delivered», «bounced», «sent»…). */
export async function estadoEnResend(
  cfg: ConfigResend, id: string, pedir: Pedir = fetch,
): Promise<{ ok: true; estado: string } | { ok: false; error: string }> {
  let r: Response;
  try {
    r = await pedir(`https://api.resend.com/emails/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${cfg.clave}` } });
  } catch {
    return { ok: false, error: "No se pudo conectar con Resend." };
  }
  const j = (await r.json().catch(() => ({}))) as { last_event?: string; message?: string };
  if (!r.ok) return { ok: false, error: (j.message ?? `Resend respondió ${r.status}.`).toString().slice(0, 200) };
  return { ok: true, estado: j.last_event ?? "sent" };
}

/** Anota el último aviso mandado a un alumno (para ver cuándo y si le llegó). */
export async function anotarAviso(db: SupabaseClient, alumnoId: string, aviso: { id?: string; estado: string }): Promise<void> {
  const r = await db.from("reporte_codigos").update({
    ultimoAvisoEn: new Date().toISOString(), ultimoAvisoId: aviso.id ?? null, ultimoAvisoEstado: aviso.estado,
  }).eq("alumnoId", alumnoId);
  if (r.error && !faltaLaTabla(r.error)) throw new Error(`reporte_codigos: ${r.error.message}`);
}
