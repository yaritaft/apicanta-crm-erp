import { claveEmail, completar, limpiarEmail } from "./contactos";
import { compararTelefonos, normalizarTelefono } from "./telefonos";
import type { Alumno, Comentario, Contacto, EstadoApp, ID, Lead, Sesion } from "./types";

/* ==================================================================
   La misma persona, dos veces.

   Lili (22/10): Juan Camilo López estaba dos veces, una con cada mail, y
   cada ficha tenía la mitad de su historia (el resell en una, la mentoría
   en la otra). Pasaba porque cada entrada —Calendly, la carga de una
   venta, el importador de la planilla, el formulario de Leads— buscaba a
   la persona SÓLO por mail: con otro mail, nacía otra. En la base había
   31 pares con el mismo teléfono.

   Un solo criterio para todas las entradas:
   - el mismo mail (sin mayúsculas, espacios ni invisibles) es la misma persona;
   - el mismo teléfono Y al menos dos palabras del nombre en común
     («Facundo Aguirre» y «Facundo Nahuel Aguirre») también: es lo que
     tienen en común dos fichas de la misma persona con otro mail;
   - el mismo teléfono con otro nombre puede ser un número compartido
     (la pareja, un trabajo): no se junta solo, se avisa para que alguien
     lo decida («Posibles duplicados» y el aviso en la ficha).

   Unificar no borra nada de la historia: las oportunidades, llamadas,
   mensajes del chat y servicios de la otra ficha pasan a esta, el otro
   mail queda guardado como «otro mail», y lo que se movió queda anotado
   en el contacto para poder separarlas (Deshacer).
   ================================================================== */

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/* Las palabras de un nombre que identifican: sin tildes, sin mayúsculas y de tres letras o más («de», «la» no cuentan). */
export function palabrasDelNombre(nombre: string | undefined | null): string[] {
  return [...new Set(sinTildes(nombre ?? "").toLowerCase().split(/[^a-zñ]+/).filter((p) => p.length >= 3))];
}

/* Cuántas palabras del nombre tienen en común. */
export function palabrasEnComun(a: string | undefined | null, b: string | undefined | null): number {
  const x = new Set(palabrasDelNombre(a));
  return palabrasDelNombre(b).filter((p) => x.has(p)).length;
}

/* El mismo teléfono: la misma línea, aunque uno venga con «+57» y el otro sin el «+». Un número corto no sirve para
   decidir nada. */
export function mismoTelefono(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return compararTelefonos(a, b) === "igual";
}

/* La regla para juntar sola, sin preguntar: el mismo teléfono y dos palabras del nombre en común (o el mismo nombre,
   si es de una sola palabra). */
export function esLaMismaPersona(a: { nombre?: string; telefono?: string }, b: { nombre?: string; telefono?: string }): boolean {
  if (!mismoTelefono(a.telefono, b.telefono)) return false;
  const comun = palabrasEnComun(a.nombre, b.nombre);
  if (comun >= 2) return true;
  const pa = palabrasDelNombre(a.nombre), pb = palabrasDelNombre(b.nombre);
  return comun === 1 && pa.length === 1 && pb.length === 1;
}

/* Los otros mails de la persona (los de las fichas que se unificaron con esta, o con los que volvió a agendar). */
export function otrosEmails(c: Pick<Contacto, "email" | "extra"> | undefined): string[] {
  const lista = c?.extra?.emails;
  if (!Array.isArray(lista)) return [];
  const propio = claveEmail(c?.email);
  return [...new Set(lista.map((x) => limpiarEmail(String(x))).filter((x) => x && claveEmail(x) !== propio))];
}

/* El contacto con un mail más, si no lo tenía (ni como principal ni entre los otros). */
export function conOtroEmail(c: Contacto, email: string | undefined | null): Contacto {
  /* En minúsculas: así la base lo encuentra entre los otros mails con un «contiene» exacto. */
  const nuevo = claveEmail(email);
  if (!nuevo || nuevo === claveEmail(c.email) || otrosEmails(c).some((x) => claveEmail(x) === nuevo)) return c;
  return { ...c, extra: { ...(c.extra ?? {}), emails: [...otrosEmails(c), nuevo] } };
}

/* Entre los contactos, el que es la misma persona por mail o, si no, por teléfono y nombre. Lo usan todas las entradas
   (el formulario de Leads, la carga de una venta, el importador y Calendly en el servidor). */
export function buscarMismaPersona(
  contactos: readonly Contacto[],
  datos: { email?: string | null; nombre?: string | null; telefono?: string | null },
): { contacto: Contacto; por: "email" | "telefono" } | null {
  const k = claveEmail(datos.email);
  if (k) {
    const porMail = contactos.find((c) => claveEmail(c.email) === k || otrosEmails(c).some((x) => claveEmail(x) === k));
    if (porMail) return { contacto: porMail, por: "email" };
  }
  if (!datos.telefono) return null;
  const local = normalizarTelefono(datos.telefono).local;
  if (local.length < 8) return null;
  const porTel = (indicePorTelefono(contactos).get(local) ?? [])
    .find((c) => esLaMismaPersona({ nombre: datos.nombre ?? "", telefono: datos.telefono ?? "" }, c));
  return porTel ? { contacto: porTel, por: "telefono" } : null;
}

/* Los contactos por los últimos 8 dígitos de su teléfono: un importador pregunta por cientos de filas y no puede
   recorrer todos los contactos en cada una. */
const INDICE = new WeakMap<readonly Contacto[], Map<string, Contacto[]>>();
function indicePorTelefono(contactos: readonly Contacto[]): Map<string, Contacto[]> {
  const ya = INDICE.get(contactos);
  if (ya) return ya;
  const m = new Map<string, Contacto[]>();
  for (const c of contactos) {
    const n = normalizarTelefono(c.telefono);
    if (n.valido && n.local.length === 8) m.set(n.local, [...(m.get(n.local) ?? []), c]);
  }
  INDICE.set(contactos, m);
  return m;
}

/* ---------- Posibles duplicados ---------- */

/* Los que alguien ya dijo que NO son la misma persona (mismo teléfono, otra gente): no se vuelven a proponer. */
export function noSonDuplicados(c: Pick<Contacto, "extra"> | undefined): string[] {
  const lista = c?.extra?.noEsLaMismaPersona;
  return Array.isArray(lista) ? lista.map(String) : [];
}

export interface ParDuplicado {
  a: Contacto;
  b: Contacto;
  /* Pasa la regla para juntar sola (mismo teléfono y nombre): casi seguro la misma persona. */
  seguro: boolean;
}

/* La clave del teléfono para agrupar: la línea completa si se sabe el país; si no, el número nacional (9 dígitos o más). */
function claveDeGrupo(tel: string | undefined): string | undefined {
  const n = normalizarTelefono(tel);
  if (!n.valido) return undefined;
  if (n.clave) return n.clave;
  return n.nacional.length >= 9 ? `?${n.nacional}` : undefined;
}

let CACHE: { contactos: readonly Contacto[]; pares: ParDuplicado[] } | null = null;

/* Los pares de contactos con el mismo teléfono, sin los que alguien descartó. Los «seguros» primero. */
export function posiblesDuplicados(contactos: readonly Contacto[]): ParDuplicado[] {
  if (CACHE?.contactos === contactos) return CACHE.pares;
  const grupos = new Map<string, Contacto[]>();
  for (const c of contactos) {
    const k = claveDeGrupo(c.telefono);
    if (k) grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  /* Un número sin país («311 3652301») y el mismo con país («+57 311…») caen en grupos distintos: se juntan por el final. */
  const sueltos = [...grupos.entries()].filter(([k]) => k.startsWith("?"));
  for (const [k, lista] of sueltos) {
    const otro = [...grupos.keys()].find((x) => !x.startsWith("?") && x.endsWith(k.slice(1)));
    if (otro) { grupos.set(otro, [...grupos.get(otro)!, ...lista]); grupos.delete(k); }
  }
  const pares: ParDuplicado[] = [];
  for (const lista of grupos.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        if (noSonDuplicados(a).includes(b.id) || noSonDuplicados(b).includes(a.id)) continue;
        pares.push({ a, b, seguro: esLaMismaPersona(a, b) });
      }
    }
  }
  pares.sort((x, y) => Number(y.seguro) - Number(x.seguro) || x.a.nombre.localeCompare(y.a.nombre));
  CACHE = { contactos, pares };
  return pares;
}

/* Los posibles duplicados de una persona (por el id de su contacto). */
export function duplicadosDe(contactos: readonly Contacto[], contactoId: ID | undefined): { otro: Contacto; seguro: boolean }[] {
  if (!contactoId) return [];
  return posiblesDuplicados(contactos)
    .filter((p) => p.a.id === contactoId || p.b.id === contactoId)
    .map((p) => ({ otro: p.a.id === contactoId ? p.b : p.a, seguro: p.seguro }));
}

/* ---------- Unificar ---------- */

/* Lo que se movió, guardado en el contacto que queda: con esto se separan de nuevo. */
export interface Unificacion {
  contacto: Contacto;
  leads: ID[];
  sesiones: ID[];
  comentarios: ID[];
  /* Los servicios que sólo se ataban a la otra ficha por el mail: el lead que tenían antes (vacío). */
  alumnos: { id: ID; leadId: ID | null }[];
  /* El mail de la otra ficha se agregó a «otros mails» (si ya estaba, no se saca al separar). */
  emailAgregado?: string;
  en: string;
  por: string;
}

export function unificacionesDe(c: Pick<Contacto, "extra"> | undefined): Unificacion[] {
  const lista = c?.extra?.unificados;
  return Array.isArray(lista) ? (lista as Unificacion[]) : [];
}

/* Lo de la otra persona que hay que mover. Sale del estado de la app o de la base: el servidor arma lo mismo. */
export interface LoDelOtro {
  leads: Pick<Lead, "id" | "contactoId">[];
  sesiones: Pick<Sesion, "id" | "contactoId">[];
  comentarios: Pick<Comentario, "id" | "contactoId">[];
  /* Sus servicios sin lead (se ataban por el mail): pasan a colgar de una de sus oportunidades. */
  alumnosSinLead: Pick<Alumno, "id" | "leadId">[];
}

export interface PlanUnificar {
  contacto: Contacto;
  borrar: ID;
  leads: { id: ID; contactoId: ID }[];
  sesiones: { id: ID; contactoId: ID }[];
  comentarios: { id: ID; contactoId: ID }[];
  alumnos: { id: ID; leadId: ID }[];
  resumen: string;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/* Junta `otro` en `principal`: todo lo del otro pasa a colgar del principal, que completa sus huecos con los datos del
   otro y se queda con su mail como «otro mail». No toca la base: devuelve qué escribir. */
export function planUnificar(principal: Contacto, otro: Contacto, del: LoDelOtro, quien: string, en: string): PlanUnificar {
  if (principal.id === otro.id) throw new Error("Es la misma ficha.");
  const leads = del.leads.filter((l) => l.contactoId === otro.id || l.id === otro.id).map((l) => ({ id: l.id, contactoId: principal.id }));
  const sesiones = del.sesiones.filter((s) => s.contactoId === otro.id).map((s) => ({ id: s.id, contactoId: principal.id }));
  const comentarios = del.comentarios.filter((c) => c.contactoId === otro.id).map((c) => ({ id: c.id, contactoId: principal.id }));
  const leadDeLosServicios = leads[0]?.id;
  const alumnos = leadDeLosServicios ? del.alumnosSinLead.filter((a) => !a.leadId).map((a) => ({ id: a.id, leadId: leadDeLosServicios })) : [];

  let contacto = conOtroEmail({
    ...principal,
    telefono: completar(principal.telefono, otro.telefono),
    pais: completar(principal.pais, otro.pais),
    inglesNivel: completar(principal.inglesNivel, otro.inglesNivel),
    aniosExperiencia: completar(principal.aniosExperiencia, otro.aniosExperiencia),
    tecnologias: completar(principal.tecnologias, otro.tecnologias),
    formacion: completar(principal.formacion, otro.formacion),
    sueldoUsd: completar(principal.sueldoUsd, otro.sueldoUsd),
    instagram: completar(principal.instagram, otro.instagram),
    origenCanal: completar(principal.origenCanal, otro.origenCanal),
    origenAdId: completar(principal.origenAdId, otro.origenAdId),
    origenWebinarId: completar(principal.origenWebinarId, otro.origenWebinarId),
  }, otro.email);
  for (const x of otrosEmails(otro)) contacto = conOtroEmail(contacto, x);
  const yaLoTenia = [principal.email, ...otrosEmails(principal)].some((x) => claveEmail(x) === claveEmail(otro.email));
  const emailAgregado = claveEmail(otro.email) && !yaLoTenia ? claveEmail(otro.email) : undefined;

  const registro: Unificacion = {
    contacto: otro,
    leads: leads.map((l) => l.id), sesiones: sesiones.map((s) => s.id), comentarios: comentarios.map((c) => c.id),
    alumnos: alumnos.map((a) => ({ id: a.id, leadId: null })),
    emailAgregado, en, por: quien,
  };
  contacto = { ...contacto, extra: { ...(contacto.extra ?? {}), unificados: [...unificacionesDe(principal), registro] } };

  const partes = [
    leads.length && plural(leads.length, "oportunidad", "oportunidades"),
    sesiones.length && plural(sesiones.length, "llamada", "llamadas"),
    comentarios.length && plural(comentarios.length, "mensaje del chat", "mensajes del chat"),
    alumnos.length && plural(alumnos.length, "servicio", "servicios"),
  ].filter(Boolean);
  const resumen = `Se unificó con «${otro.nombre}»${otro.email ? ` (${limpiarEmail(otro.email)})` : ""}: ${partes.length ? `pasaron ${partes.join(", ")}` : "no tenía nada más"}${emailAgregado ? ` y su mail quedó como otro mail` : ""}.`;
  return { contacto, borrar: otro.id, leads, sesiones, comentarios, alumnos, resumen };
}

export interface PlanSeparar {
  contacto: Contacto;
  recrear: Contacto;
  leads: { id: ID; contactoId: ID }[];
  sesiones: { id: ID; contactoId: ID }[];
  comentarios: { id: ID; contactoId: ID }[];
  alumnos: { id: ID; leadId: ID | null }[];
  resumen: string;
}

/* Deshace una unificación: la otra ficha vuelve con lo suyo. */
export function planSeparar(principal: Contacto, otroId: ID): PlanSeparar | null {
  const lista = unificacionesDe(principal);
  const u = lista.find((x) => x.contacto.id === otroId);
  if (!u) return null;
  const emails = otrosEmails(principal).filter((x) => !u.emailAgregado || claveEmail(x) !== claveEmail(u.emailAgregado));
  const contacto: Contacto = { ...principal, extra: { ...(principal.extra ?? {}), emails, unificados: lista.filter((x) => x !== u) } };
  return {
    contacto,
    recrear: u.contacto,
    leads: u.leads.map((id) => ({ id, contactoId: u.contacto.id })),
    sesiones: u.sesiones.map((id) => ({ id, contactoId: u.contacto.id })),
    comentarios: u.comentarios.map((id) => ({ id, contactoId: u.contacto.id })),
    alumnos: u.alumnos,
    resumen: `Se separó de «${u.contacto.nombre}»: vuelve a tener su propia ficha.`,
  };
}

/* Lo de la otra persona, leído del estado de la app (sin nube, o para mostrar antes de unificar). */
export function loDelOtroEnLaApp(e: Pick<EstadoApp, "leads" | "sesiones" | "comentarios" | "alumnos">, otro: Contacto): LoDelOtro {
  const leads = e.leads.filter((l) => l.contactoId === otro.id || l.id === otro.id);
  const ids = new Set<ID>([otro.id, ...leads.map((l) => l.id)]);
  const mail = claveEmail(otro.email);
  return {
    leads,
    sesiones: e.sesiones.filter((s) => s.contactoId === otro.id),
    comentarios: (e.comentarios ?? []).filter((c) => c.contactoId === otro.id),
    alumnosSinLead: e.alumnos.filter((a) => !a.leadId && mail && claveEmail(a.email) === mail && !ids.has(a.id)),
  };
}

/* El principal entre dos: el que tiene más historia (ventas, servicios, oportunidades) y, a igualdad, el más viejo. */
export function cualQueda(a: Contacto, b: Contacto, peso: (c: Contacto) => number): [Contacto, Contacto] {
  const pa = peso(a), pb = peso(b);
  if (pa !== pb) return pa > pb ? [a, b] : [b, a];
  return (a.creadoEn ?? "") <= (b.creadoEn ?? "") ? [a, b] : [b, a];
}
