import { personaDeVenta, personasDeAgendaYVentas } from "./cruce-auto";
import { cruzarRegistros, type Candidato, type PersonaAgenda } from "./cruce-formularios";
import { claveEmail } from "./contactos";
import { diaDeNegocio } from "./dia-negocio";
import type { RegistroForm } from "./registros-webinar";
import type { CanalOrigen, Contacto, Lead, Moneda, Sesion, Venta } from "./types";

/* ==================================================================
   Pendientes de conciliar: las personas que agendaron o compraron en un mes y
   todavía no tienen el formulario que llenaron atado a su ficha.

   El cruce automático (lib/cruce-auto.ts) une solo lo seguro —mismo mail o
   mismo teléfono—. Lo que queda es lo que alguien tiene que mirar: o el
   formulario existe con otro mail y otro teléfono (se une a mano), o esa
   persona nunca llenó el formulario de la landing y vino por otro camino
   (Setter, un referido, un mensaje directo…): se marca y deja de figurar.

   Una persona figura en cada mes en que tuvo una compra o una llamada; en
   cuanto se resuelve, desaparece de todos.

   Lógica pura: sin React ni base. La pantalla (components/conciliacion) le
   pasa lo que ya tiene cargado y el conjunto de contactos con formulario.
   ================================================================== */

/** Cómo llegó una persona que no pasó por el formulario de la landing. */
export const CAMINOS = [
  { id: "setter", texto: "Setter (mensaje directo)" },
  { id: "referido", texto: "Referido" },
  { id: "organico", texto: "Orgánico (redes, YouTube…)" },
  { id: "meta-instantaneo", texto: "Formulario de Meta (sin landing)" },
  { id: "vsl", texto: "VSL" },
  { id: "otro", texto: "Otro" },
] as const;
export type CaminoId = (typeof CAMINOS)[number]["id"];
export const textoDeCamino = (id: string) => CAMINOS.find((c) => c.id === id)?.texto ?? id;

/** Lo que se guarda en `contacto.extra.conciliacion` cuando alguien marca que esa persona no pasó por el formulario. */
export interface OtroCamino { camino: CaminoId; nota?: string; por?: string; en: string }

/** El camino con el que se marcó a esta persona, o undefined si no se marcó. */
export function otroCaminoDe(c: Pick<Contacto, "extra"> | undefined): OtroCamino | undefined {
  const x = c?.extra?.conciliacion;
  if (!x || typeof x !== "object") return undefined;
  const o = x as Partial<OtroCamino>;
  return o.camino ? { camino: o.camino, nota: o.nota, por: o.por, en: o.en ?? "" } : undefined;
}

/** Qué camino proponer según el canal de su llamada: quien agendó por Setter casi seguro nunca llenó el formulario. */
export const caminoSugerido = (canal: CanalOrigen | undefined): CaminoId | undefined =>
  canal === "setter" ? "setter" : canal === "vsl" ? "vsl" : undefined;

export interface EventoPendiente {
  tipo: "venta" | "agenda";
  id: string;
  /** El día del negocio (aaaa-mm-dd). */
  dia: string;
  titulo: string;
  monto?: number;
  moneda?: Moneda;
  canal?: CanalOrigen;
}

export interface Pendiente {
  /** El id de la persona del cruce: su contacto, o `lead:`/`venta:` si no tiene ficha. */
  id: string;
  persona: PersonaAgenda;
  contacto?: Contacto;
  /** Lo que hizo en el mes, lo más reciente primero. */
  eventos: EventoPendiente[];
  /** El día del evento más reciente del mes. */
  dia: string;
  tipo: "venta" | "agenda" | "ambas";
  canal?: CanalOrigen;
  /** Sin ficha de contacto no se puede atar nada: se muestra, pero no se puede unir ni marcar. */
  sinFicha: boolean;
}

export interface DatosPendientes {
  contactos: Contacto[];
  sesiones: Pick<Sesion, "id" | "contactoId" | "email" | "invitado" | "inicia" | "estado" | "titulo" | "tipo" | "canal">[];
  leads: Pick<Lead, "id" | "contactoId" | "nombre" | "email" | "telefono" | "pais">[];
  ventas: Pick<Venta, "id" | "contactoId" | "contactoNombre" | "fecha" | "estado" | "excluidoMarketing" | "precioAcordado" | "moneda" | "notas">[];
}

export const mesDeDia = (dia: string) => dia.slice(0, 7);

/** Las llamadas y las compras del mes que cuentan: una cancelada no pasó, y una venta excluida de Marketing no se atribuye a ningún anuncio. */
function delMes(d: DatosPendientes, mes: string) {
  return {
    sesiones: d.sesiones.filter((s) => s.estado !== "cancelada" && mesDeDia(diaDeNegocio(s.inicia)) === mes),
    ventas: d.ventas.filter((v) => v.estado !== "cancelada" && !v.excluidoMarketing && mesDeDia(diaDeNegocio(v.fecha)) === mes),
  };
}

/** Todas las personas que agendaron o compraron en el mes, con lo que hicieron. Primero las que compraron (es plata sin origen), después las que sólo agendaron; dentro de cada grupo, lo más nuevo primero. */
function personasDelMes(d: DatosPendientes, mes: string): Pendiente[] {
  const { sesiones, ventas } = delMes(d, mes);
  const personas = personasDeAgendaYVentas({ contactos: d.contactos, sesiones, leads: d.leads, ventas });
  const contactos = new Map(d.contactos.map((c) => [c.id, c]));
  const lead = new Map(d.leads.map((l) => [l.id, l]));

  const eventos = new Map<string, EventoPendiente[]>();
  const poner = (id: string, e: EventoPendiente) => (eventos.get(id) ?? eventos.set(id, []).get(id)!).push(e);
  for (const s of sesiones) {
    const mail = claveEmail(s.email);
    const id = (s.contactoId && contactos.has(s.contactoId) ? s.contactoId : undefined) ?? (mail ? `mail:${mail}` : `ses:${s.id}`);
    poner(id, { tipo: "agenda", id: s.id, dia: diaDeNegocio(s.inicia), titulo: s.tipo || s.titulo, canal: s.canal });
  }
  for (const v of ventas) {
    const { id } = personaDeVenta(v, lead, contactos);
    poner(id, { tipo: "venta", id: v.id, dia: diaDeNegocio(v.fecha), titulo: v.notas?.trim() ? v.notas.trim().split("\n")[0].slice(0, 80) : "Venta", monto: v.precioAcordado, moneda: v.moneda });
  }

  const salida: Pendiente[] = [];
  for (const persona of personas) {
    const contacto = persona.contactoId ? contactos.get(persona.contactoId) : undefined;
    const evs = (eventos.get(persona.id) ?? []).sort((a, b) => b.dia.localeCompare(a.dia));
    if (evs.length === 0) continue;
    const hayVenta = evs.some((x) => x.tipo === "venta"), hayAgenda = evs.some((x) => x.tipo === "agenda");
    salida.push({
      id: persona.id, persona, contacto, eventos: evs, dia: evs[0].dia,
      tipo: hayVenta && hayAgenda ? "ambas" : hayVenta ? "venta" : "agenda",
      canal: evs.find((x) => x.canal)?.canal, sinFicha: !contacto,
    });
  }
  return salida.sort((a, b) => Number(b.tipo !== "agenda") - Number(a.tipo !== "agenda") || b.dia.localeCompare(a.dia) || a.persona.nombre.localeCompare(b.persona.nombre));
}

/** Los ids de los contactos que agendaron o compraron en el mes: de ésos hay que saber cuáles ya tienen un formulario unido. */
export const contactosDelMes = (d: DatosPendientes, mes: string): string[] =>
  personasDelMes(d, mes).map((p) => p.contacto?.id).filter((id): id is string => Boolean(id));

/**
 * Las personas del mes sin formulario atado ni marcadas como «vino por otro camino».
 * `conFormulario` son los ids de los contactos que ya tienen algún registro unido.
 */
export function pendientesDelMes(d: DatosPendientes, mes: string, conFormulario: ReadonlySet<string>): Pendiente[] {
  return personasDelMes(d, mes).filter((p) => !(p.contacto && (conFormulario.has(p.contacto.id) || otroCaminoDe(p.contacto))));
}

/** Las del mes que alguien marcó como «vino por otro camino» (y sin formulario unido): para verlas y poder deshacer. */
export function marcadosDelMes(d: DatosPendientes, mes: string): Pendiente[] {
  return personasDelMes(d, mes).filter((p) => p.contacto && otroCaminoDe(p.contacto));
}

export interface ResumenPendientes {
  total: number;
  conVenta: number;
  soloAgenda: number;
  /** Lo vendido sin origen, por moneda. */
  montos: Partial<Record<Moneda, number>>;
}

export function resumirPendientes(lista: Pendiente[]): ResumenPendientes {
  const montos: ResumenPendientes["montos"] = {};
  for (const p of lista) for (const e of p.eventos) if (e.tipo === "venta" && e.monto && e.moneda) montos[e.moneda] = (montos[e.moneda] ?? 0) + e.monto;
  const conVenta = lista.filter((p) => p.tipo !== "agenda").length;
  return { total: lista.length, conVenta, soloAgenda: lista.length - conVenta, montos };
}

export interface Propuesta { registro: RegistroForm; candidato: Candidato }

/**
 * Los registros sin atar que se parecen a esta persona, del más firme al más flojo.
 * `registros` son los candidatos que ya se bajaron (los que comparten mail o teléfono con ella);
 * respeta los «No es» que alguien ya marcó en cada registro.
 */
export function propuestasPara(p: Pendiente, registros: RegistroForm[]): Propuesta[] {
  const sinAtar = registros
    .filter((r) => !r.contactoId)
    .map((r) => ({ ...r, descartados: Array.isArray(r.descartados) ? r.descartados : [] }));
  const salida: Propuesta[] = [];
  for (const c of cruzarRegistros(sinAtar, [p.persona])) {
    const cand = c.segura ?? c.dudosas[0];
    if (cand) salida.push({ registro: c.registro, candidato: cand });
  }
  const rango = { mail: 0, telefono: 1, nombre: 2 };
  return salida.sort((a, b) =>
    Number(b.candidato.segura) - Number(a.candidato.segura) || rango[a.candidato.metodo] - rango[b.candidato.metodo]
    || String(b.registro.registradoEn).localeCompare(String(a.registro.registradoEn)));
}
