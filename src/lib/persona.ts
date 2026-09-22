import { claveEmail } from "./contactos";
import type {
  Actividad, Alumno, Comentario, Contacto, EstadoApp, ID, Lead, Sesion, Venta,
} from "./types";

/* ==================================================================
   Una persona, con todo lo suyo.

   La ficha se abre igual desde Leads, el Pipeline, Ventas, Alumnos o la
   Agenda: cualquiera de esos ids lleva a la MISMA persona. La clave es el
   contacto (la persona); de ahí cuelgan sus oportunidades (leads), sus
   llamadas, sus ventas y, por cada venta, su servicio (el alumno).

   Los datos viejos no siempre están bien atados (una venta del CRM viejo
   apunta al lead y no al contacto; un alumno sólo tiene el email), así
   que se junta por todos los caminos: ids y, como último recurso, email.
   ================================================================== */

export interface Persona {
  /* El id con el que se abre la ficha: el del contacto si existe. */
  clave: ID;
  contacto?: Contacto;
  nombre: string;
  email: string;
  telefono?: string;
  pais?: string;
  leads: Lead[];
  sesiones: Sesion[];
  ventas: Venta[];
  alumnos: Alumno[];
  comentarios: Comentario[];
}

/* El contacto que corresponde a cualquier id de la app. */
function contactoDe(e: EstadoApp, id: ID): { contacto?: Contacto; lead?: Lead } {
  const directo = e.contactos.find((c) => c.id === id);
  if (directo) return { contacto: directo };

  const lead = e.leads.find((l) => l.id === id);
  if (lead) return { contacto: e.contactos.find((c) => c.id === (lead.contactoId ?? lead.id)), lead };

  const venta = e.ventas.find((v) => v.id === id);
  if (venta?.contactoId) return contactoDe(e, venta.contactoId);

  const alumno = e.alumnos.find((a) => a.id === id);
  if (alumno) {
    if (alumno.leadId) return contactoDe(e, alumno.leadId);
    const porMail = alumno.email ? e.contactos.find((c) => claveEmail(c.email) === claveEmail(alumno.email)) : undefined;
    if (porMail) return { contacto: porMail };
  }

  const sesion = e.sesiones.find((s) => s.id === id);
  if (sesion?.contactoId) return contactoDe(e, sesion.contactoId);
  if (sesion?.leadId) return contactoDe(e, sesion.leadId);
  return {};
}

export function personaDe(e: EstadoApp, id: ID): Persona | null {
  const { contacto, lead: leadSuelto } = contactoDe(e, id);
  const alumnoSuelto = !contacto && !leadSuelto ? e.alumnos.find((a) => a.id === id) : undefined;
  if (!contacto && !leadSuelto && !alumnoSuelto) return null;

  const email = claveEmail(contacto?.email ?? leadSuelto?.email ?? alumnoSuelto?.email);
  const mismoMail = (x?: string) => Boolean(email) && claveEmail(x) === email;

  const leads = e.leads.filter((l) =>
    (contacto && (l.contactoId === contacto.id || l.id === contacto.id))
    || (leadSuelto && l.id === leadSuelto.id));
  const idsPersona = new Set<ID>([
    ...(contacto ? [contacto.id] : []),
    ...leads.map((l) => l.id),
  ]);

  const ventas = e.ventas
    .filter((v) => v.contactoId && idsPersona.has(v.contactoId))
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
  const idsVentas = new Set(ventas.map((v) => v.id));

  const alumnos = e.alumnos.filter((a) =>
    (a.leadId && idsPersona.has(a.leadId))
    || (a.ventaId && idsVentas.has(a.ventaId))
    || a.id === alumnoSuelto?.id
    || mismoMail(a.email));

  const sesiones = e.sesiones
    .filter((s) =>
      (s.contactoId && idsPersona.has(s.contactoId))
      || (s.leadId && idsPersona.has(s.leadId))
      || (s.alumnoId && alumnos.some((a) => a.id === s.alumnoId)))
    .sort((a, b) => +new Date(b.inicia) - +new Date(a.inicia));

  const clave = contacto?.id ?? leadSuelto?.id ?? alumnoSuelto!.id;
  const comentarios = (e.comentarios ?? []).filter((c) => c.contactoId === clave);

  const principal = leads[0];
  return {
    clave, contacto,
    nombre: contacto?.nombre || principal?.nombre || alumnoSuelto?.nombre || "Sin nombre",
    email: contacto?.email || principal?.email || alumnoSuelto?.email || "",
    telefono: contacto?.telefono || principal?.telefono,
    pais: contacto?.pais || principal?.pais || alumnoSuelto?.pais,
    leads, sesiones, ventas, alumnos, comentarios,
  };
}

/* Lo que se registró en la actividad sobre cualquier cosa de la persona. */
export function actividadDe(e: EstadoApp, p: Persona): Actividad[] {
  const ids = new Set<ID>([
    p.clave,
    ...p.leads.map((l) => l.id),
    ...p.ventas.map((v) => v.id),
    ...p.alumnos.map((a) => a.id),
    ...p.sesiones.map((s) => s.id),
  ]);
  return e.actividad.filter((a) => ids.has(a.entidadId));
}
