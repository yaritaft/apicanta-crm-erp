import {
  LayoutDashboard, Users, Sheet, CalendarDays, Video, Megaphone,
  GraduationCap, ClipboardList, Wallet, Settings, HandCoins, ArrowDownUp, Banknote, Landmark, UserCheck,
  ClipboardCheck, PhoneCall, ListChecks, FileInput,
} from "lucide-react";
import { SquareKanban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { esCuentaDeCloser, nivelDeRuta, type MiAcceso } from "@/lib/permisos";

/* Quién ve cada item lo dice su ruta (lib/permisos: areaDeRuta): Equipo y
   honorarios, sólo los dueños; el resto, según el tipo de cuenta. */
export interface ItemNav {
  href: string; texto: string; icono: LucideIcon; ayuda: string;
}
export interface GrupoNav { titulo: string; items: ItemNav[] }

export const NAV: GrupoNav[] = [
  {
    titulo: "Negocio",
    items: [
      { href: "/panel", texto: "Dashboard & KPIs", icono: LayoutDashboard, ayuda: "Todas las métricas del negocio, en una tabla o en gráficos" },
    ],
  },
  {
    titulo: "Ventas",
    items: [
      { href: "/leads", texto: "Leads", icono: Users, ayuda: "Toda la gente interesada" },
      { href: "/crm", texto: "CRM", icono: Sheet, ayuda: "Cada llamada con todo lo de la persona: se filtra y se corrige como un Excel" },
      { href: "/agenda", texto: "Agenda", icono: CalendarDays, ayuda: "Las llamadas por día: entran solas desde Calendly" },
      { href: "/ventas", texto: "Ventas", icono: HandCoins, ayuda: "Cada venta con sus cuotas y cobros" },
      { href: "/clientes", texto: "Clientes", icono: UserCheck, ayuda: "La gente que compró: qué compró, cuánto pagó y si está al día" },
    ],
  },
  {
    titulo: "Crecimiento",
    items: [
      { href: "/webinars", texto: "Webinars", icono: Video, ayuda: "Registrados, asistencia y conversión" },
      { href: "/formularios", texto: "Formularios", icono: FileInput, ayuda: "Quién se anotó a cada webinar: unidos al grupo, contactados y teléfono para escribirles" },
      { href: "/marketing", texto: "Marketing", icono: Megaphone, ayuda: "Campañas de Meta y costo por lead" },
    ],
  },
  {
    titulo: "Programa",
    items: [
      { href: "/alumnos", texto: "Alumnos", icono: GraduationCap, ayuda: "Quién está cursando y cómo va" },
      /* Es una vista de Alumnos, no otra pantalla: el Shell marca el item más
         específico, así que acá se prende éste y no los dos. */
      { href: "/alumnos?seccion=pipeline", texto: "Pipeline de servicio", icono: SquareKanban, ayuda: "Arrastrá alumnos entre las etapas del servicio" },
      { href: "/reportes", texto: "Reportes", icono: ClipboardList, ayuda: "Dashboard y tabla de los reportes de alumnos" },
      /* Customer Success (F2-09): la lista de a quién contactar hoy y el
         seguimiento de todos. Son vistas de Alumnos. */
      { href: "/alumnos?seccion=hoy", texto: "A contactar hoy", icono: PhoneCall, ayuda: "Los alumnos a los que les toca el contacto de seguimiento, lo más vencido arriba" },
      { href: "/alumnos?seccion=seguimiento", texto: "Seguimiento", icono: ListChecks, ayuda: "Cada alumno con su cadencia, su CV y su LinkedIn" },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/finanzas", texto: "Finanzas", icono: Wallet, ayuda: "Ingresos, egresos y qué queda" },
      { href: "/finanzas/caja", texto: "Caja", icono: Landmark, ayuda: "Arqueos, meses de vida y retiros" },
      { href: "/conciliacion", texto: "Conciliación", icono: ArrowDownUp, ayuda: "Cobros de las pasarelas y a qué cuota van" },
      { href: "/equipo", texto: "Equipo y honorarios", icono: Banknote, ayuda: "Quién es quién, con qué entra a la app y cuánto cobra" },
      { href: "/ajustes", texto: "Ajustes", icono: Settings, ayuda: "Etapas, categorías, campos e integraciones" },
    ],
  },
];

/* El menú del closer (una cuenta que ve sólo lo suyo): tres entradas y nada
   más. «Mis llamadas» es el CRM de hoy, «Cerrar el día» es el cierre del día
   y «Cargar venta» abre el asistente de venta. Leads, Agenda, Clientes y el
   resto siguen abiertos por link, filtrados a lo suyo por la base: sólo se
   esconden del menú. */
export const NAV_CLOSER: GrupoNav[] = [
  {
    titulo: "Tu día",
    items: [
      { href: "/mis-llamadas", texto: "Mis llamadas", icono: PhoneCall, ayuda: "Tus llamadas de hoy: cargá cómo terminó cada una" },
      { href: "/cerrar-el-dia", texto: "Cerrar el día", icono: ClipboardCheck, ayuda: "Pasá por tus llamadas y contá cómo terminó cada una" },
      { href: "/cargar-venta", texto: "Cargar venta", icono: HandCoins, ayuda: "Cargá una venta nueva: pasa a cliente" },
    ],
  },
];

export const TODOS_LOS_ITEMS = [...NAV, ...NAV_CLOSER].flatMap((g) => g.items);

/* El menú de quien está usando la app: lo que su tipo de cuenta ve; el
   closer, el mínimo. */
export function navPara(a: MiAcceso | null): GrupoNav[] {
  return (esCuentaDeCloser(a) ? NAV_CLOSER : NAV)
    .map((g) => ({ ...g, items: g.items.filter((i) => nivelDeRuta(a, i.href) > 0) })).filter((g) => g.items.length > 0);
}

/* A dónde va el inicio: el Dashboard, o la primera pantalla que ve (el
   closer, al CRM). */
export function inicioPara(a: MiAcceso | null): string {
  /* Customer Success (Alumnos y Clientes, sin Dashboard, CRM ni Ventas)
     arranca en la lista de a quién contactar hoy, no en Clientes. */
  if (nivelDeRuta(a, "/alumnos") > 0 && ["/panel", "/crm", "/leads", "/ventas"].every((r) => nivelDeRuta(a, r) === 0)) return "/alumnos?seccion=hoy";
  return navPara(a)[0]?.items[0]?.href ?? "/panel";
}
