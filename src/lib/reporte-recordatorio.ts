import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { anotarAviso, avisosDe, codigoDeAlumno, configResend, enviarPorResend, type ConfigResend } from "./reporte-servidor";
import { armarMailConFormularios, enlaceDeReporte } from "./reporte-enlace";
import { alumnosConProgramaSinReconocer, CON_RECORDATORIO, FORMULARIOS, formulariosDelAlumnoCon, formulariosQueSeLePiden, type IdFormulario } from "./reporte-formularios";
import { lunesDelDia } from "./reportes";
import { diaAInstante, diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   El recordatorio del formulario semanal (Lili, 26/10: Manu pidió que el
   formulario de Hackear Biz, que iba por Google Forms, quede automático).

   Todos los lunes a las 10 (api/cron/reporte-semanal), a cada alumno activo de
   un programa con recordatorio (CON_RECORDATORIO, hoy Hackear Biz) que todavía
   no completó el de esa semana, le llega por mail su link personal (uno por
   formulario que le falte: quien cursa Biz e IA completa los dos): entra
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
  /* Alumnos activos con un programa que la app no reconoce: no reciben ningún formulario (se avisa a Customer Success). */
  sinReconocer: { id: string; nombre: string; programas: string[] }[];
}

export async function recordarReportes(
  db: SupabaseClient, origen: string, ahora = new Date(), enviar: Enviar = enviarPorResend, cfg: ConfigResend | null = configResend(),
): Promise<PasadaRecordatorio> {
  const salida: PasadaRecordatorio = { habilitado: Boolean(cfg), mandados: 0, fallaron: 0, salteados: { yaLoCompleto: 0, avisadoHace: 0, sinMail: 0, termino: 0 }, porPrograma: {}, sinReconocer: [] };
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

  /* El programa es un texto libre de la ficha: uno que la app no reconoce deja al alumno sin formulario y sin error. Se avisa. */
  salida.sinReconocer = alumnosConProgramaSinReconocer(alumnos, segs as ReadonlyMap<string, { programas?: unknown; followUp?: string | null }>);

  /* Los de un programa con recordatorio que todavía cursan (la misma regla que cuenta la pantalla de Formularios de alumnos). Quien
     cursa Hackear Biz e IA completa los dos formularios (Lili, 29/10): le llega el link de cada uno que le falte. */
  const candidatos = alumnos.flatMap((a) => {
    const s = segs.get(a.id);
    const ids = formulariosQueSeLePiden(a, s);
    if (!ids.length) {
      if (formulariosDelAlumnoCon(s?.programas, a.plan).some((f) => CON_RECORDATORIO.includes(f.id))) salida.salteados.termino++;
      return [];
    }
    return ids.some((id) => CON_RECORDATORIO.includes(id)) ? [{ ...a, formularios: ids.map((id) => FORMULARIOS[id]) }] : [];
  });
  if (!candidatos.length) { if (salida.sinReconocer.length) await avisarSinReconocer(db, diaDeNegocio(ahora.toISOString()), salida.sinReconocer); return salida; }

  /* Los que ya completaron el de esta semana. */
  const hoy = diaDeNegocio(ahora.toISOString());
  const lunes = lunesDelDia(hoy);
  const desde = new Date(new Date(diaAInstante(lunes)).getTime() - 86_400_000).toISOString();
  const rep = await db.from("reportes").select("alumnoId, formulario").in("alumnoId", candidatos.map((c) => c.id)).eq("estado", "completado").gte("semanaDel", desde);
  /* Qué formularios completó cada uno (uno viejo sin formulario cuenta como todos). */
  const completaron = new Map<string, Set<string>>();
  for (const r of (rep.data ?? []) as { alumnoId: string; formulario?: string | null }[]) {
    const set = completaron.get(r.alumnoId) ?? new Set<string>();
    set.add(r.formulario ?? "*");
    completaron.set(r.alumnoId, set);
  }
  const avisos = await avisosDe(db, candidatos.map((c) => c.id));
  /* El remitente no recibe respuestas: si el alumno contesta el mail, le llega a quien atiende (el mismo de la bienvenida). */
  const aj = await db.from("ajustes").select("bienvenida").eq("id", 1).maybeSingle();
  const responder = String(((aj.data as { bienvenida?: { responderA?: unknown } } | null)?.bienvenida?.responderA) ?? "").trim();
  const responderA = MAIL.test(responder) ? responder : undefined;

  for (const c of candidatos) {
    const hechos = completaron.get(c.id);
    const faltan = c.formularios.filter((f) => !hechos?.has(f.id) && !hechos?.has("*"));
    if (faltan.length === 0) { salida.salteados.yaLoCompleto++; continue; }
    const ultimo = avisos.get(c.id)?.en;
    if (ultimo && ahora.getTime() - new Date(ultimo).getTime() < DIAS_ENTRE_AVISOS * 86_400_000) { salida.salteados.avisadoHace++; continue; }
    const email = (c.email ?? "").trim();
    if (!MAIL.test(email)) { salida.salteados.sinMail++; continue; }
    try {
      const codigo = await codigoDeAlumno(db, c.id);
      if (!codigo) { salida.fallaron++; continue; }
      const mail = armarMailConFormularios({ nombre: c.nombre, formularios: faltan.map((f) => ({ programa: f.programa, enlace: enlaceDeReporte(origen, codigo, f.id) })) });
      const r = await enviar(cfg, { para: email, asunto: mail.asunto, texto: mail.texto, html: mail.html, responderA });
      if (!r.ok) { salida.fallaron++; console.error("[reporte-semanal]", c.id, r.error); continue; }
      await anotarAviso(db, c.id, { id: r.id, estado: "sent" });
      salida.mandados++;
      for (const f of faltan) salida.porPrograma[f.id] = (salida.porPrograma[f.id] ?? 0) + 1;
    } catch (e) {
      salida.fallaron++;
      console.error("[reporte-semanal]", c.id, e instanceof Error ? e.message : String(e));
    }
  }
  if (salida.mandados + salida.fallaron > 0) await avisarAServicio(db, hoy, salida);
  if (salida.sinReconocer.length) await avisarSinReconocer(db, hoy, salida.sinReconocer);
  return salida;
}

/* Un aviso por lunes a Customer Success: quiénes tienen un programa que la app no reconoce (no reciben ningún formulario). */
async function avisarSinReconocer(db: SupabaseClient, hoy: string, lista: PasadaRecordatorio["sinReconocer"]): Promise<void> {
  try {
    const r = await db.from("equipo").select("email").eq("activo", true)
      .or("puesto.ilike.%customer success%,puesto.ilike.%servicio%,puesto.ilike.%csm%");
    const ejemplos = lista.slice(0, 8).map((a) => `${a.nombre} («${a.programas.join("», «")}»)`).join("; ");
    const cuerpo = `${lista.length === 1 ? "1 alumno activo tiene" : `${lista.length} alumnos activos tienen`} un programa que la app no reconoce y por eso no ${lista.length === 1 ? "recibe" : "reciben"} ningún formulario semanal: ${ejemplos}${lista.length > 8 ? "…" : ""}. Corregí su Programa en la ficha (Servicio → Programa) o avisá para sumar el nombre nuevo a la app.`;
    const filas = ((r.data ?? []) as { email: string | null }[]).filter((x) => x.email?.trim()).map((x) => ({
      id: `av_reporte_sinprograma_${hoy}_${createHash("sha1").update(x.email!.trim().toLowerCase()).digest("hex").slice(0, 10)}`,
      para: x.email!.trim().toLowerCase(), tipo: "reporte-semanal", titulo: "Alumnos sin formulario semanal: programa sin reconocer",
      cuerpo, de: "Apicanta", contactoId: null, persona: null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[reporte-semanal] no se pudo avisar de los programas sin reconocer", err instanceof Error ? err.message : String(err)); }
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
