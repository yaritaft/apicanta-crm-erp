import { claveEmail } from "./contactos";
import { cruzarRegistros, herenciaDeFormulario, personasDeAgenda, type PersonaAgenda } from "./cruce-formularios";
import type { MetodoCruce, RegistroForm } from "./registros-webinar";
import type { Contacto, Lead, Sesion, Venta } from "./types";

/* ==================================================================
   El cruce automático de los registros de Formularios.

   Yari (02/10): «cuando el lead completa un formulario hay un lead generado;
   después otro que agenda por Calendly o compra, y tenemos que darnos cuenta
   de que es el mismo». La cascada ya existe (lib/cruce-formularios.ts) y la
   pantalla Formularios une «con un clic»; esto lo hace solo:

   - las personas contra las que se cruza son las que AGENDARON en Calendly y
     las que COMPRARON (la venta apunta a un lead y el lead a su contacto);
   - se unen sólo las coincidencias SEGURAS (mismo mail, o mismo teléfono): las
     dudosas (un nombre parecido) las sigue viendo una persona en la pantalla;
   - el contacto hereda del formulario sus huecos (teléfono, país, anuncio y
     webinar) para que las ventas se atribuyan al anuncio que vio la persona,
     empezando por el primer formulario que llenó;
   - un registro que ya está unido (solo o a mano) no se toca.

   Lógica pura: la usan el proceso automático (lib/cruce-nube.ts), el ensayo
   contra datos reales y las pruebas.
   ================================================================== */

export interface DatosCruce {
  registros: RegistroForm[];
  contactos: Contacto[];
  sesiones: Pick<Sesion, "id" | "contactoId" | "email" | "invitado" | "inicia" | "estado">[];
  leads: Pick<Lead, "id" | "contactoId" | "nombre" | "email" | "telefono" | "pais">[];
  ventas: Pick<Venta, "id" | "contactoId" | "contactoNombre" | "fecha">[];
}

/** Las personas que agendaron más las que compraron, una por contacto. */
export function personasDeAgendaYVentas(d: Omit<DatosCruce, "registros">): PersonaAgenda[] {
  const personas = new Map<string, PersonaAgenda>(personasDeAgenda(d.contactos, d.sesiones as Sesion[]).map((p) => [p.id, p]));
  const lead = new Map(d.leads.map((l) => [l.id, l]));
  const contacto = new Map(d.contactos.map((c) => [c.id, c]));
  for (const v of d.ventas) {
    const l = v.contactoId ? lead.get(v.contactoId) : undefined;
    const c = (v.contactoId ? contacto.get(v.contactoId) : undefined) ?? (l?.contactoId ? contacto.get(l.contactoId) : undefined);
    const id = c?.id ?? (l ? `lead:${l.id}` : `venta:${v.id}`);
    const emails = [...new Set([claveEmail(c?.email), claveEmail(l?.email)].filter((m): m is string => Boolean(m)))];
    const ya = personas.get(id);
    if (ya) { for (const m of emails) if (!ya.emails.includes(m)) ya.emails.push(m); continue; }
    personas.set(id, {
      id, contactoId: c?.id, nombre: c?.nombre || l?.nombre || v.contactoNombre || "", emails,
      telefono: c?.telefono || l?.telefono, pais: c?.pais || l?.pais, inicia: v.fecha, sesionIds: [],
    });
  }
  return [...personas.values()];
}

export interface UnionAutomatica { registroId: string; contactoId: string; metodo: Exclude<MetodoCruce, "manual"> }
export interface HerenciaAutomatica { contactoId: string; cambios: Partial<Pick<Contacto, "telefono" | "pais" | "origenAdId" | "origenWebinarId">> }
export interface ResultadoCruceAuto { uniones: UnionAutomatica[]; herencias: HerenciaAutomatica[]; dudosas: number; personas: number }

/** Qué registros se unen solos y qué heredan sus contactos. No escribe nada. */
export function cruceAutomatico(d: DatosCruce): ResultadoCruceAuto {
  const personas = personasDeAgendaYVentas(d);
  /* Los ya unidos (solos o a mano) no se tocan. */
  const sinUnir = d.registros.filter((r) => !r.contactoId).map((r) => ({ ...r, descartados: Array.isArray(r.descartados) ? r.descartados : [] }));
  const cruces = cruzarRegistros(sinUnir, personas);
  const seguras = cruces.filter((c) => c.segura && c.segura.persona.contactoId);
  const uniones: UnionAutomatica[] = seguras.map((c) => ({ registroId: c.registro.id, contactoId: c.segura!.persona.contactoId!, metodo: c.segura!.metodo }));

  /* Lo que cada contacto hereda: en orden de llegada, el primer formulario llena primero los huecos. */
  const porContacto = new Map<string, RegistroForm[]>();
  for (const c of [...seguras].sort((a, b) => String(a.registro.registradoEn).localeCompare(String(b.registro.registradoEn)))) {
    const cid = c.segura!.persona.contactoId!;
    (porContacto.get(cid) ?? porContacto.set(cid, []).get(cid)!).push(c.registro);
  }
  const contactos = new Map(d.contactos.map((c) => [c.id, c]));
  const herencias: HerenciaAutomatica[] = [];
  for (const [cid, regs] of porContacto) {
    const original = contactos.get(cid);
    if (!original) continue;
    let trabajo: Contacto = { ...original };
    const cambios: HerenciaAutomatica["cambios"] = {};
    for (const r of regs) {
      const h = herenciaDeFormulario(trabajo, r);
      if (!h) continue;
      for (const k of ["telefono", "pais", "origenAdId", "origenWebinarId"] as const) if (h[k] !== undefined) cambios[k] = h[k] as never;
      trabajo = { ...trabajo, ...h };
    }
    if (Object.keys(cambios).length) herencias.push({ contactoId: cid, cambios });
  }
  return { uniones, herencias, dudosas: cruces.filter((c) => !c.segura).length, personas: personas.length };
}
