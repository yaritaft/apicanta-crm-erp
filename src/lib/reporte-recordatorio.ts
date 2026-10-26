import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { anotarAviso, avisosDe, codigoDeAlumno, configResend, enviarPorResend, type ConfigResend } from "./reporte-servidor";
import { armarMail, enlaceDeReporte } from "./reporte-enlace";
import { CON_RECORDATORIO, FORMULARIOS, formularioDelAlumnoCon, formularioQueSeLePide, type IdFormulario } from "./reporte-formularios";
import { lunesDelDia } from "./reportes";
import { diaAInstante, diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   El recordatorio del formulario semanal (Lili, 26/10: Manu pidió que el
   formulario de Hackear Biz, que iba por Google Forms, quede automático).

   Todos los lunes a las 10 (api/cron/reporte-semanal), a cada alumno activo de
   un programa con recordatorio (CON_RECORDATORIO, hoy Hackear Biz) que todavía
   no completó el de esa semana, le llega por mail su link personal: entra
   directo con su código y lo que contesta va a su ficha y a Formularios de
   alumnos. No se le escribe a quien ya terminó (Outboarding o caso de éxito),
   a quien no tiene un mail válido, ni a quien ya recibió un aviso en los
   últimos 5 días (si alguien se lo mandó a mano, o la pasada corre dos veces).
   Customer Success recibe un aviso con cuántos salieron.
   ================================================================== */

const DIAS_ENTRE_AVISOS = 5;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Enviar = typeof enviarPorResend;

export interface PasadaRecordatorio {
  /* Sin Resend no se manda nada. */
  habilitado: boolean;
  mandados: number;
  fallaron: number;
  salteados: { yaLoCompleto: number; avisadoHace: number; sinMail: number; termino: number };
  porPrograma: Partial<Record<IdFormulario, number>>;
}

export async function recordarReportes(
  db: SupabaseClient, origen: string, ahora = new Date(), enviar: Enviar = enviarPorResend, cfg: ConfigResend | null = configResend(),
): Promise<PasadaRecordatorio> {
  const salida: PasadaRecordatorio = { habilitado: Boolean(cfg), mandados: 0, fallaron: 0, salteados: { yaLoCompleto: 0, avisadoHace: 0, sinMail: 0, termino: 0 }, porPrograma: {} };
  if (!cfg) return salida;

  const al = await db.from("alumnos").select("id, nombre, email, plan, estado").eq("estado", "activo");
  if (al.error) throw new Error(`alumnos: ${al.error.message}`);
  const alumnos = (al.data ?? []) as { id: string; nombre: string; email: string | null; plan: string | null; estado: string }[];
  if (!alumnos.length) return salida;
  const ids = alumnos.map((a) => a.id);

  const segs = new Map<string, { programas?: unknown; followUp?: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from("seguimiento_alumnos").select("alumnoId, programas, followUp").in("alumnoId", ids.slice(i, i + 200));
    for (const s of (r.data ?? []) as { alumnoId: string; programas?: unknown; followUp?: string | null }[]) segs.set(s.alumnoId, s);
  }

  /* Los de un programa con recordatorio que todavía cursan (la misma regla que cuenta la pantalla de Formularios de alumnos). */
  const candidatos = alumnos.flatMap((a) => {
    const s = segs.get(a.id);
    const id = formularioQueSeLePide(a, s);
    if (!id) {
      const delPrograma = formularioDelAlumnoCon(s?.programas, a.plan);
      if (delPrograma && CON_RECORDATORIO.includes(delPrograma.id)) salida.salteados.termino++;
      return [];
    }
    return CON_RECORDATORIO.includes(id) ? [{ ...a, formulario: FORMULARIOS[id] }] : [];
  });
  if (!candidatos.length) return salida;

  /* Los que ya completaron el de esta semana. */
  const hoy = diaDeNegocio(ahora.toISOString());
  const lunes = lunesDelDia(hoy);
  const desde = new Date(new Date(diaAInstante(lunes)).getTime() - 86_400_000).toISOString();
  const rep = await db.from("reportes").select("alumnoId").in("alumnoId", candidatos.map((c) => c.id)).eq("estado", "completado").gte("semanaDel", desde);
  const completaron = new Set(((rep.data ?? []) as { alumnoId: string }[]).map((r) => r.alumnoId));
  const avisos = await avisosDe(db, candidatos.map((c) => c.id));
  /* El remitente no recibe respuestas: si el alumno contesta el mail, le llega a quien atiende (el mismo de la bienvenida). */
  const aj = await db.from("ajustes").select("bienvenida").eq("id", 1).maybeSingle();
  const responder = String(((aj.data as { bienvenida?: { responderA?: unknown } } | null)?.bienvenida?.responderA) ?? "").trim();
  const responderA = MAIL.test(responder) ? responder : undefined;

  for (const c of candidatos) {
    if (completaron.has(c.id)) { salida.salteados.yaLoCompleto++; continue; }
    const ultimo = avisos.get(c.id)?.en;
    if (ultimo && ahora.getTime() - new Date(ultimo).getTime() < DIAS_ENTRE_AVISOS * 86_400_000) { salida.salteados.avisadoHace++; continue; }
    const email = (c.email ?? "").trim();
    if (!MAIL.test(email)) { salida.salteados.sinMail++; continue; }
    try {
      const codigo = await codigoDeAlumno(db, c.id);
      if (!codigo) { salida.fallaron++; continue; }
      const mail = armarMail({ nombre: c.nombre, enlace: enlaceDeReporte(origen, codigo), programa: c.formulario.programa });
      const r = await enviar(cfg, { para: email, asunto: mail.asunto, texto: mail.texto, html: mail.html, responderA });
      if (!r.ok) { salida.fallaron++; console.error("[reporte-semanal]", c.id, r.error); continue; }
      await anotarAviso(db, c.id, { id: r.id, estado: "sent" });
      salida.mandados++;
      salida.porPrograma[c.formulario.id] = (salida.porPrograma[c.formulario.id] ?? 0) + 1;
    } catch (e) {
      salida.fallaron++;
      console.error("[reporte-semanal]", c.id, e instanceof Error ? e.message : String(e));
    }
  }
  if (salida.mandados + salida.fallaron > 0) await avisarAServicio(db, hoy, salida);
  return salida;
}

/* Un aviso por lunes a Customer Success: cuántos salieron y cuántos fallaron. */
async function avisarAServicio(db: SupabaseClient, hoy: string, s: PasadaRecordatorio): Promise<void> {
  try {
    const r = await db.from("equipo").select("email").eq("activo", true)
      .or("puesto.ilike.%customer success%,puesto.ilike.%servicio%,puesto.ilike.%csm%");
    const cuerpo = [
      `Le llegó por mail su link personal a ${s.mandados === 1 ? "1 alumno" : `${s.mandados} alumnos`} que todavía no lo completaron.`,
      s.salteados.yaLoCompleto ? `${s.salteados.yaLoCompleto} ya lo habían completado.` : "",
      s.salteados.sinMail ? `${s.salteados.sinMail} sin un mail válido: pasales el link a mano.` : "",
      s.fallaron ? `${s.fallaron} no salieron: revisalos en Formularios de alumnos → Por alumno.` : "",
    ].filter(Boolean).join(" ");
    const filas = ((r.data ?? []) as { email: string | null }[]).filter((x) => x.email?.trim()).map((x) => ({
      id: `av_reporte_semanal_${hoy}_${createHash("sha1").update(x.email!.trim().toLowerCase()).digest("hex").slice(0, 10)}`,
      para: x.email!.trim().toLowerCase(), tipo: "reporte-semanal", titulo: "Salió el formulario semanal",
      cuerpo, de: "Apicanta", contactoId: null, persona: null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[reporte-semanal] no se pudo avisar", err instanceof Error ? err.message : String(err)); }
}
