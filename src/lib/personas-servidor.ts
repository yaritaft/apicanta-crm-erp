import type { SupabaseClient } from "@supabase/supabase-js";
import { limpiarEmail } from "./contactos";
import type { ID } from "./types";

/* ==================================================================
   Corregir el nombre, el mail o el teléfono de una persona del lado del
   SERVIDOR (Lili, 23/10: «no me modifica el teléfono»).

   La ficha corrige el dato en la persona y en todo lo que cuelga de ella
   (store.ts → corregirPersona), pero sólo en lo que la cuenta edita: la de
   Servicio no edita contactos ni oportunidades, así que el teléfono que Lili
   corregía no se escribía en ningún lado. Esto escribe lo mismo con la clave
   de servicio; la ruta ya comprobó que su cuenta edita Alumnos y que ve a
   la persona.
   ================================================================== */

const idActividad = () => `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class MailRepetido extends Error {
  constructor() { super("Ese mail ya es de otra persona en Apicanta: unificá las dos fichas en vez de cambiarlo."); }
}

export async function corregirPersonaEnLaBase(
  db: SupabaseClient, contactoId: ID, cambios: { nombre?: string; email?: string; telefono?: string }, quien: string,
): Promise<{ registros: number }> {
  const nombre = cambios.nombre?.trim() || undefined;
  const email = cambios.email ? limpiarEmail(cambios.email) || undefined : undefined;
  const telefono = cambios.telefono?.trim() || undefined;
  if (!nombre && !email && !telefono) return { registros: 0 };
  const quitarVacios = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

  const c = await db.from("contactos").update(quitarVacios({ nombre, email, telefono }) as never).eq("id", contactoId).select("id, nombre");
  if (c.error) {
    if (c.error.code === "23505") throw new MailRepetido();
    throw new Error(`contactos: ${c.error.message}`);
  }
  const leads = await db.from("leads").update(quitarVacios({ nombre, email, telefono }) as never).or(`contactoId.eq.${contactoId},id.eq.${contactoId}`).select("id");
  if (leads.error) throw new Error(`leads: ${leads.error.message}`);
  const idsLeads = (leads.data ?? []).map((l) => (l as { id: string }).id);
  let registros = (c.data?.length ?? 0) + idsLeads.length;
  if (nombre || email) {
    const s = await db.from("sesiones").update(quitarVacios({ invitado: nombre, email }) as never).eq("contactoId", contactoId).select("id");
    registros += s.data?.length ?? 0;
  }
  if (idsLeads.length && nombre) {
    const v = await db.from("ventas").update({ contactoNombre: nombre } as never).in("contactoId", idsLeads).select("id");
    registros += v.data?.length ?? 0;
  }
  if (idsLeads.length && (nombre || email)) {
    const a = await db.from("alumnos").update(quitarVacios({ nombre, email }) as never).in("leadId", idsLeads).select("id");
    registros += a.data?.length ?? 0;
  }
  const que = [nombre && `el nombre (${nombre})`, email && `el mail (${email})`, telefono && `el teléfono (${telefono})`].filter(Boolean).join(", ");
  await db.from("actividad").insert({
    id: idActividad(), accion: "actualizo", actor: quien, entidad: "contacto", entidadId: contactoId,
    titulo: nombre ?? ((c.data?.[0] as { nombre?: string } | undefined)?.nombre ?? "Persona"), fecha: new Date().toISOString(),
    detalle: `Se corrigió ${que} en todos lados desde Servicio: ${registros} ${registros === 1 ? "registro" : "registros"}.`,
  });
  return { registros };
}
