import { claveEmail } from "./contactos";
import type { Alumno, EstadoApp, ID, Resell } from "./types";

/* ==================================================================
   De qué alumno es una llamada de resell.

   Nicolás González agendó el resell con un mail de Gmail y es alumno con uno de Hotmail: la misma persona, dos mails. La app unía la
   llamada con el alumno SÓLO por mail igual, y Lili (19/11) veía «No encontramos a esta persona» al abrir su ficha y, en la ficha
   del alumno, ninguna llamada de resell. Ahora hay UNA regla, y es la misma que usa la base (supabase/resells-vinculo-alumno.sql,
   alumno_de_resell), en este orden:

     1. el vínculo guardado en la fila (resells.alumnoId), si ese alumno sigue existiendo;
     2. el mail de la ficha del alumno;
     3. la persona con ese mail (su contacto o sus leads) y el alumno que cuelga de ella.

   La base además mira los otros mails del alumno y la persona de la llamada: eso sólo lo puede leer la base (la cuenta de Customer
   Success no lee las llamadas), así que llega por el vínculo guardado. Si el alumno hay que elegirlo entre varios de la misma
   persona, el activo y el más reciente.
   ================================================================== */

type Datos = Pick<EstadoApp, "alumnos"> & Partial<Pick<EstadoApp, "contactos" | "leads">>;

export interface IndiceDeAlumnos {
  porId: Map<ID, Alumno>;
  porMail: Map<string, Alumno>;
  /* Por el mail de la PERSONA (contacto o lead), que puede ser otro que el de su ficha de alumno. */
  porMailDePersona: Map<string, Alumno>;
}

/* El activo, y entre dos del mismo estado, el que empezó último: la misma elección que hace la base. */
const mejorAlumno = (a: Alumno | undefined, b: Alumno): Alumno => {
  if (!a) return b;
  if ((a.estado === "activo") !== (b.estado === "activo")) return a.estado === "activo" ? a : b;
  return (b.inicio ?? "") > (a.inicio ?? "") ? b : a;
};

export function indiceDeAlumnos(e: Datos): IndiceDeAlumnos {
  const porId = new Map<ID, Alumno>();
  const porMail = new Map<string, Alumno>();
  const porLead = new Map<ID, Alumno>();
  for (const a of e.alumnos ?? []) {
    porId.set(a.id, a);
    const k = claveEmail(a.email);
    if (k) porMail.set(k, mejorAlumno(porMail.get(k), a));
    if (a.leadId) porLead.set(a.leadId, mejorAlumno(porLead.get(a.leadId), a));
  }

  const leadsDeContacto = new Map<ID, ID[]>();
  for (const l of e.leads ?? []) if (l.contactoId) leadsDeContacto.set(l.contactoId, [...(leadsDeContacto.get(l.contactoId) ?? []), l.id]);
  const idsDeLaPersona = new Map<string, Set<ID>>();
  const sumar = (mail: string, ids: (ID | undefined)[]) => {
    if (!mail) return;
    const set = idsDeLaPersona.get(mail) ?? new Set<ID>();
    for (const id of ids) if (id) set.add(id);
    idsDeLaPersona.set(mail, set);
  };
  for (const c of e.contactos ?? []) sumar(claveEmail(c.email), [c.id, ...(leadsDeContacto.get(c.id) ?? [])]);
  for (const l of e.leads ?? []) sumar(claveEmail(l.email), [l.id, l.contactoId, ...(l.contactoId ? leadsDeContacto.get(l.contactoId) ?? [] : [])]);

  const porMailDePersona = new Map<string, Alumno>();
  for (const [mail, ids] of idsDeLaPersona) {
    let mejor: Alumno | undefined;
    for (const id of ids) { const a = porLead.get(id); if (a) mejor = mejorAlumno(mejor, a); }
    if (mejor) porMailDePersona.set(mail, mejor);
  }
  return { porId, porMail, porMailDePersona };
}

/** El alumno de una llamada de resell, o undefined si no se puede saber con lo que esta cuenta puede leer. */
export function alumnoDeResell(ix: IndiceDeAlumnos, r: Pick<Resell, "email"> & Partial<Pick<Resell, "alumnoId">>): Alumno | undefined {
  if (r.alumnoId) {
    const guardado = ix.porId.get(r.alumnoId);
    if (guardado) return guardado;
  }
  const k = claveEmail(r.email);
  if (!k) return undefined;
  return ix.porMail.get(k) ?? ix.porMailDePersona.get(k);
}
