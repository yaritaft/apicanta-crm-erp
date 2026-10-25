"use client";

import { nube } from "@/lib/supabase";
import { literalParaIlike } from "@/lib/links-alumno";

/* ==================================================================
   ¿Ya existe este alumno EN LA BASE? (Lili, 24/10: Jorge Llamas quedó dos
   veces.) El closer cargó la venta (que crea el alumno solo) y siete
   minutos después Lili lo creó a mano: su pantalla estaba abierta desde
   antes y no lo tenía. Por eso «Nuevo alumno» no se fía de lo que muestra
   la pantalla: antes de crear, le pregunta a la base por la misma venta,
   la misma persona del CRM o el mismo mail.
   ================================================================== */

export interface AlumnoExistente { id: string; nombre: string }

export async function alumnoEnLaBase(b: { ventaId?: string; leadId?: string; email?: string }): Promise<AlumnoExistente | null> {
  if (!nube) return null;
  const filtros: string[] = [];
  if (b.ventaId) filtros.push(`ventaId.eq.${b.ventaId}`);
  if (b.leadId) filtros.push(`leadId.eq.${b.leadId}`);
  const mail = (b.email ?? "").trim().toLowerCase();
  if (/^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]{2,}$/.test(mail)) filtros.push(`email.ilike.${literalParaIlike(mail)}`);
  if (!filtros.length) return null;
  const r = await nube.from("alumnos").select("id, nombre").or(filtros.join(",")).limit(1);
  if (r.error) return null;
  return ((r.data ?? [])[0] as AlumnoExistente | undefined) ?? null;
}
