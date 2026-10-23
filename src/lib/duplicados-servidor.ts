import type { SupabaseClient } from "@supabase/supabase-js";
import { claveEmail } from "./contactos";
import {
  buscarMismaPersona, conOtroEmail, noSonDuplicados, planSeparar, planUnificar, type PlanSeparar, type PlanUnificar,
} from "./duplicados";
import { normalizarTelefono } from "./telefonos";
import type { Contacto, ID } from "./types";

/* ==================================================================
   Unificar dos fichas de la misma persona, del lado del SERVIDOR.

   Lo hace la clave de servicio porque quien unifica (Lili, desde Servicio)
   no edita oportunidades ni llamadas, y la base le rechazaría mover la
   mitad: la ruta ya comprobó que su cuenta edita Alumnos o Ventas y que ve
   las dos fichas. La regla de qué se mueve es la de lib/duplicados.ts, la
   misma que usa la app sin nube.
   ================================================================== */

/* ilike con el email tal cual: sin comodines, así "a_b@x.com" no matchea "aXb@x.com". */
const exacto = (x: string) => x.replace(/[\\%_]/g, (c) => `\\${c}`);

/** La persona en la base con la regla de lib/duplicados.ts: su mail (también entre sus otros mails) o, con otro mail, el
    mismo teléfono y nombre; en ese caso viene con el mail nuevo sumado como «otro mail». Es la búsqueda de TODAS las
    entradas del servidor (Calendly, el formulario de los webinars y los formularios de Meta): con la clave de servicio
    ve a todos, así que no crea a nadie dos veces (la base además lo traba por mail: supabase/personas-unicas.sql). */
export async function buscarContactoEnLaBase(
  db: SupabaseClient, datos: { email?: string | null; nombre?: string | null; telefono?: string | null },
): Promise<Contacto | null> {
  const email = claveEmail(datos.email);
  if (email) {
    const r = await db.from("contactos").select("*").ilike("email", exacto(email)).limit(1);
    if (r.error) throw new Error(`contactos: ${r.error.message}`);
    if (r.data?.[0]) return r.data[0] as Contacto;
    try {
      const otro = await db.from("contactos").select("*").contains("extra", { emails: [email] }).limit(1);
      if (!otro.error && otro.data?.[0]) return otro.data[0] as Contacto;
    } catch { /* sin el filtro, sigue por el teléfono */ }
  }
  const ultimos = normalizarTelefono(datos.telefono).local;
  if (!datos.telefono || ultimos.length !== 8) return null;
  try {
    const r = await db.rpc("contactos_por_telefono", { ultimos });
    if (r.error) return null;
    const hallado = buscarMismaPersona((r.data ?? []) as Contacto[], { nombre: datos.nombre, telefono: datos.telefono })?.contacto;
    return hallado ? conOtroEmail(hallado, datos.email) : null;
  } catch {
    return null;
  }
}

const idActividad = () => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function contacto(db: SupabaseClient, id: ID): Promise<Contacto | null> {
  const r = await db.from("contactos").select("*").eq("id", id).maybeSingle();
  if (r.error) throw new Error(`contactos: ${r.error.message}`);
  return (r.data as Contacto | null) ?? null;
}

/* Mueve una columna de varias filas al mismo valor. */
async function mover(db: SupabaseClient, tabla: string, columna: string, ids: ID[], valor: ID | null): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const r = await db.from(tabla).update({ [columna]: valor } as never).in("id", ids.slice(i, i + 100));
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

export async function unificarEnLaBase(db: SupabaseClient, principalId: ID, otroId: ID, quien: string): Promise<PlanUnificar> {
  const [principal, otro] = await Promise.all([contacto(db, principalId), contacto(db, otroId)]);
  if (!principal || !otro) throw new Error("No encuentro una de las dos fichas (quizás ya se unificaron).");

  const [leads, sesiones, comentarios, alumnos] = await Promise.all([
    db.from("leads").select('id, "contactoId"').or(`contactoId.eq.${otro.id},id.eq.${otro.id}`),
    db.from("sesiones").select('id, "contactoId"').eq("contactoId", otro.id),
    db.from("comentarios").select('id, "contactoId"').eq("contactoId", otro.id),
    claveEmail(otro.email)
      ? db.from("alumnos").select('id, "leadId", email').is("leadId", null).ilike("email", claveEmail(otro.email).replace(/[\\%_]/g, (c) => `\\${c}`))
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [leads, sesiones, comentarios, alumnos]) if (r.error) throw new Error(r.error.message);

  const plan = planUnificar(principal, otro, {
    leads: (leads.data ?? []) as PlanUnificar["leads"],
    sesiones: (sesiones.data ?? []) as PlanUnificar["sesiones"],
    comentarios: (comentarios.data ?? []) as PlanUnificar["comentarios"],
    alumnosSinLead: (alumnos.data ?? []) as { id: ID; leadId?: ID }[],
  }, quien, new Date().toISOString());

  /* Primero el contacto que queda (con lo que se mueve anotado), después lo que cuelga, y al final se borra el otro: si
     algo falla en el medio, el otro sigue existiendo y no queda nada colgando de un contacto borrado. */
  const rc = await db.from("contactos").upsert(plan.contacto, { defaultToNull: false });
  if (rc.error) throw new Error(`contactos: ${rc.error.message}`);
  await mover(db, "leads", "contactoId", plan.leads.map((x) => x.id), principal.id);
  await mover(db, "sesiones", "contactoId", plan.sesiones.map((x) => x.id), principal.id);
  await mover(db, "comentarios", "contactoId", plan.comentarios.map((x) => x.id), principal.id);
  if (plan.alumnos.length) await mover(db, "alumnos", "leadId", plan.alumnos.map((x) => x.id), plan.alumnos[0].leadId);
  /* Los formularios de los webinars que se ataron a la otra ficha (sin deshacer: son de la misma persona). */
  await db.from("registros_webinar").update({ contactoId: principal.id } as never).eq("contactoId", otro.id);
  const rb = await db.from("contactos").delete().eq("id", otro.id);
  if (rb.error) throw new Error(`contactos: ${rb.error.message}`);

  await db.from("actividad").insert({
    id: idActividad(), accion: "actualizo", actor: quien, entidad: "contacto", entidadId: principal.id,
    titulo: principal.nombre, fecha: new Date().toISOString(), detalle: plan.resumen,
  });
  return plan;
}

export async function separarEnLaBase(db: SupabaseClient, principalId: ID, otroId: ID, quien: string): Promise<PlanSeparar> {
  const principal = await contacto(db, principalId);
  if (!principal) throw new Error("No encuentro la ficha.");
  const plan = planSeparar(principal, otroId);
  if (!plan) throw new Error("Esa ficha no estaba unificada con esta.");

  const rr = await db.from("contactos").upsert(plan.recrear, { defaultToNull: false });
  if (rr.error) throw new Error(`contactos: ${rr.error.message}`);
  await mover(db, "leads", "contactoId", plan.leads.map((x) => x.id), otroId);
  await mover(db, "sesiones", "contactoId", plan.sesiones.map((x) => x.id), otroId);
  await mover(db, "comentarios", "contactoId", plan.comentarios.map((x) => x.id), otroId);
  if (plan.alumnos.length) await mover(db, "alumnos", "leadId", plan.alumnos.map((x) => x.id), null);
  const rc = await db.from("contactos").upsert(plan.contacto, { defaultToNull: false });
  if (rc.error) throw new Error(`contactos: ${rc.error.message}`);

  await db.from("actividad").insert({
    id: idActividad(), accion: "actualizo", actor: quien, entidad: "contacto", entidadId: principal.id,
    titulo: principal.nombre, fecha: new Date().toISOString(), detalle: plan.resumen,
  });
  return plan;
}

/* «No son la misma persona»: queda anotado en los dos contactos y el par no se vuelve a proponer. */
export async function noSonLaMismaPersona(db: SupabaseClient, aId: ID, bId: ID, quien: string): Promise<Contacto[]> {
  const [a, b] = await Promise.all([contacto(db, aId), contacto(db, bId)]);
  if (!a || !b) throw new Error("No encuentro una de las dos fichas.");
  const marcar = (x: Contacto, otro: ID): Contacto =>
    ({ ...x, extra: { ...(x.extra ?? {}), noEsLaMismaPersona: [...new Set([...noSonDuplicados(x), otro])] } });
  const filas = [marcar(a, b.id), marcar(b, a.id)];
  const r = await db.from("contactos").upsert(filas, { defaultToNull: false });
  if (r.error) throw new Error(`contactos: ${r.error.message}`);
  await db.from("actividad").insert({
    id: idActividad(), accion: "actualizo", actor: quien, entidad: "contacto", entidadId: a.id,
    titulo: a.nombre, fecha: new Date().toISOString(), detalle: `Tiene el mismo teléfono que «${b.nombre}», pero no son la misma persona.`,
  });
  return filas;
}
