import { claveEmail, lleno } from "./contactos";
import { compararTelefonos } from "./telefonos";
import { isoDePais, type MetodoCruce, type RegistroForm } from "./registros-webinar";
import type { Contacto, Sesion } from "./types";

/* ==================================================================
   El cruce formulario ↔ agenda de Calendly.

   Yari (02/10): «cuando el lead completa un formulario hay un lead generado;
   después otro que agenda por Calendly, y tenemos que darnos cuenta de que es
   el mismo. Muchas veces en el formulario ponen un mail y un nombre, y en la
   agenda otro nombre y otro mail. Primero trato de machearlos por mail; si no,
   por teléfono —con código de área, sin código, con el más, sin el más—; y si
   no, por nombre, o teléfono y nombre. Casi automático.»

   La cascada, de lo más firme a lo más flojo:
     1. mail igual                                  → segura
     2. mismo teléfono (con o sin +54, 9, 0 y 15)   → segura
     3. teléfono sin código de área + mismo nombre  → segura
     4. teléfono sin código de área, solo           → dudosa
     5. nombre (todas las palabras de uno están en el otro; dos o más) → dudosa

   Las seguras se unen con un clic para todas; las dudosas se muestran para
   revisar («¿es la misma persona?») y no se unen solas. Lo que se descartó
   con «No es» no se vuelve a proponer.

   Lógica pura: sin React ni base.
   ================================================================== */

/* Una persona que agendó: su contacto y sus llamadas. */
export interface PersonaAgenda {
  /** Es el contacto, o `ses:<id de la agenda>` si la agenda no tiene contacto. */
  id: string;
  contactoId?: string;
  nombre: string;
  /** Los mails con los que aparece: el del contacto y los de sus agendas. */
  emails: string[];
  telefono?: string;
  pais?: string;
  /** La última agenda. */
  inicia: string;
  sesionIds: string[];
}

/** Las personas que agendaron, una por contacto (o por mail si la llamada no tiene contacto). */
export function personasDeAgenda(contactos: Contacto[], sesiones: Sesion[]): PersonaAgenda[] {
  const porContacto = new Map(contactos.map((c) => [c.id, c]));
  const personas = new Map<string, PersonaAgenda>();
  for (const s of sesiones) {
    if (s.estado === "cancelada" && !s.contactoId) continue;
    const c = s.contactoId ? porContacto.get(s.contactoId) : undefined;
    const mail = claveEmail(s.email);
    const id = c ? c.id : mail ? `mail:${mail}` : `ses:${s.id}`;
    const p = personas.get(id) ?? {
      id, contactoId: c?.id, nombre: c?.nombre || s.invitado || "", emails: [], telefono: c?.telefono, pais: c?.pais,
      inicia: s.inicia, sesionIds: [],
    };
    for (const m of [claveEmail(c?.email), mail]) if (m && !p.emails.includes(m)) p.emails.push(m);
    p.sesionIds.push(s.id);
    if (+new Date(s.inicia) > +new Date(p.inicia)) p.inicia = s.inicia;
    personas.set(id, p);
  }
  return [...personas.values()];
}

/* ---------- nombres ---------- */

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ARTICULOS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "van", "von", "san"]);

/** Las palabras de un nombre, sin tildes ni mayúsculas ni «de», «la»… */
export function palabrasDeNombre(nombre: string | null | undefined): string[] {
  return [...new Set(sinAcentos(nombre ?? "").split(/[^a-z0-9ñ]+/).filter((p) => p.length >= 2 && !ARTICULOS.has(p)))];
}

/** ¿Es el mismo nombre? Con al menos dos palabras: «Juan Pérez» y «Pérez, Juan
 *  Carlos» sí; «Juan» solo no (hay mil). */
export function mismoNombre(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = palabrasDeNombre(a), y = palabrasDeNombre(b);
  if (x.length < 2 || y.length < 2) return false;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  return corto.every((p) => largo.includes(p));
}

/* ---------- la cascada ---------- */

export interface Candidato {
  persona: PersonaAgenda;
  metodo: Exclude<MetodoCruce, "manual">;
  /** Segura: se puede unir sin mirar. Dudosa: la tiene que ver una persona. */
  segura: boolean;
  /** Por qué se propone, en una frase. */
  motivo: string;
}

const RANGO: Record<Candidato["metodo"], number> = { mail: 0, telefono: 1, nombre: 2 };

/** A quién del lado de la agenda se parece este registro, de lo más firme a lo más flojo. */
export function candidatosDe(r: RegistroForm, personas: PersonaAgenda[]): Candidato[] {
  const mail = claveEmail(r.email);
  const isoR = isoDePais(r.pais);
  const salida: Candidato[] = [];
  for (const p of personas) {
    if (r.descartados.includes(p.id) || (p.contactoId && r.descartados.includes(p.contactoId))) continue;
    if (mail && p.emails.includes(mail)) {
      salida.push({ persona: p, metodo: "mail", segura: true, motivo: "El mismo mail" });
      continue;
    }
    const tel = r.telefono ? compararTelefonos(r.telefono, p.telefono, isoR, isoDePais(p.pais)) : "no";
    const nombre = mismoNombre(r.nombre, p.nombre);
    if (tel === "igual") {
      salida.push({ persona: p, metodo: "telefono", segura: true, motivo: nombre ? "El mismo teléfono y el mismo nombre" : "El mismo teléfono (con otro nombre y otro mail)" });
    } else if (tel === "parcial") {
      salida.push({
        persona: p, metodo: "telefono", segura: nombre,
        motivo: nombre ? "Mismos últimos 8 dígitos del teléfono y mismo nombre" : "Mismos últimos 8 dígitos del teléfono (sin código de área: puede ser otra zona)",
      });
    } else if (nombre) {
      salida.push({ persona: p, metodo: "nombre", segura: false, motivo: "Se llama igual (con otro mail y otro teléfono)" });
    }
  }
  return salida.sort((a, b) =>
    Number(b.segura) - Number(a.segura) || RANGO[a.metodo] - RANGO[b.metodo] || +new Date(b.persona.inicia) - +new Date(a.persona.inicia));
}

/* El cruce, indexado: con miles de registros y de agendas, comparar cada
   par es una cuenta que se nota. Se cruza sólo contra las personas que
   comparten algo (mail, teléfono o una palabra del nombre). */
export interface Cruce {
  registro: RegistroForm;
  /** Con la que se puede unir sin mirar (la primera segura). */
  segura?: Candidato;
  /** Las que hay que revisar. */
  dudosas: Candidato[];
}

export function cruzarRegistros(registros: RegistroForm[], personas: PersonaAgenda[]): Cruce[] {
  const porMail = new Map<string, PersonaAgenda[]>();
  const porTel = new Map<string, PersonaAgenda[]>();
  const porPalabra = new Map<string, PersonaAgenda[]>();
  const meter = (m: Map<string, PersonaAgenda[]>, k: string, p: PersonaAgenda) => {
    const l = m.get(k);
    if (l) { if (!l.includes(p)) l.push(p); } else m.set(k, [p]);
  };
  const ultimos8 = (t?: string) => (t ?? "").replace(/\D/g, "").slice(-8);
  for (const p of personas) {
    for (const m of p.emails) meter(porMail, m, p);
    const t = ultimos8(p.telefono);
    if (t.length === 8) meter(porTel, t, p);
    for (const w of palabrasDeNombre(p.nombre)) meter(porPalabra, w, p);
  }

  const salida: Cruce[] = [];
  for (const r of registros) {
    const posibles = new Set<PersonaAgenda>(porMail.get(claveEmail(r.email)) ?? []);
    const t = ultimos8(r.telefono);
    if (t.length === 8) for (const p of porTel.get(t) ?? []) posibles.add(p);
    const palabras = palabrasDeNombre(r.nombre);
    if (palabras.length >= 2) for (const w of palabras) for (const p of porPalabra.get(w) ?? []) posibles.add(p);
    if (posibles.size === 0) continue;
    const cs = candidatosDe(r, [...posibles]);
    if (cs.length === 0) continue;
    salida.push({ registro: r, segura: cs.find((c) => c.segura), dudosas: cs.filter((c) => !c.segura) });
  }
  return salida;
}

/* ---------- qué hereda la agenda del formulario ---------- */

const esPauta = (u: Record<string, string> | undefined) =>
  /^(meta|facebook|fb|instagram|ig)$/i.test(u?.utm_source ?? u?.source ?? "") && /^(paid|cpc|ads?|pauta)$/i.test(u?.utm_medium ?? u?.medium ?? "");

/** Lo que el contacto de la agenda toma del formulario al unirse: los huecos
 *  (teléfono, país, anuncio, webinar) y los UTMs de la pauta, para que las
 *  ventas se atribuyan al anuncio que vio. Nunca pisa lo que ya tiene, salvo
 *  los UTMs de la agenda cuando no son de pauta y los del formulario sí: ahí
 *  el de la agenda queda guardado en `extra.utmAgenda`. Devuelve null si no
 *  hay nada que cambiar. */
export function herenciaDeFormulario(c: Contacto, r: RegistroForm): Partial<Contacto> | null {
  const cambios: Partial<Contacto> = {};
  if (!lleno(c.telefono) && r.telefono) cambios.telefono = r.telefono;
  if (!lleno(c.pais) && r.pais) cambios.pais = r.pais;
  if (!lleno(c.origenAdId) && r.adId) cambios.origenAdId = r.adId;
  if (!lleno(c.origenWebinarId) && r.webinarId) cambios.origenWebinarId = r.webinarId;
  const utmForm = r.utm && Object.keys(r.utm).length ? r.utm : undefined;
  if (utmForm) {
    const tiene = c.utm && Object.keys(c.utm).length > 0;
    if (!tiene) cambios.utm = utmForm;
    else if (esPauta(utmForm) && !esPauta(c.utm)) {
      cambios.utm = utmForm;
      cambios.extra = { ...(c.extra ?? {}), utmAgenda: c.utm };
    }
  }
  return Object.keys(cambios).length ? cambios : null;
}
