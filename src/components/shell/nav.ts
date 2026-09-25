import {
  LayoutDashboard, Users, Sheet, CalendarDays, Video, Megaphone,
  GraduationCap, ClipboardList, Wallet, Settings, HandCoins, ArrowDownUp, Banknote,
} from "lucide-react";
import { SquareKanban } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface ItemNav {
  href: string; texto: string; icono: LucideIcon; ayuda: string;
  /* Sólo aparece para los dueños (usuarios_permitidos.rol = 'dueno'). */
  soloDuenos?: boolean;
}
export interface GrupoNav { titulo: string; items: ItemNav[] }

export const NAV: GrupoNav[] = [
  {
    titulo: "Negocio",
    items: [
      { href: "/panel", texto: "Dashboard & KPIs", icono: LayoutDashboard, ayuda: "Todas las métricas del negocio en una tabla" },
    ],
  },
  {
    titulo: "Ventas",
    items: [
      { href: "/leads", texto: "Leads", icono: Users, ayuda: "Toda la gente interesada" },
      { href: "/crm", texto: "CRM", icono: Sheet, ayuda: "Cada agenda de Calendly con su seguimiento, como el Airtable de ventas" },
      { href: "/agenda", texto: "Agenda", icono: CalendarDays, ayuda: "Las sesiones agendadas" },
      { href: "/ventas", texto: "Ventas", icono: HandCoins, ayuda: "Cada venta con sus cuotas y cobros" },
    ],
  },
  {
    titulo: "Crecimiento",
    items: [
      { href: "/webinars", texto: "Webinars", icono: Video, ayuda: "Registrados, asistencia y conversión" },
      { href: "/marketing", texto: "Marketing", icono: Megaphone, ayuda: "Campañas de Meta y costo por lead" },
    ],
  },
  {
    titulo: "Programa",
    items: [
      { href: "/alumnos", texto: "Alumnos", icono: GraduationCap, ayuda: "Quién está cursando y cómo va" },
      /* Es una vista de Alumnos, no otra pantalla: el Shell marca el item más
         específico, así que acá se prende éste y no los dos. */
      { href: "/alumnos?vista=pipeline", texto: "Pipeline de servicio", icono: SquareKanban, ayuda: "Arrastrá alumnos entre las etapas del servicio" },
      { href: "/reportes", texto: "Reportes", icono: ClipboardList, ayuda: "Dashboard y tabla de los reportes de alumnos" },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/finanzas", texto: "Finanzas", icono: Wallet, ayuda: "Ingresos, egresos y qué queda" },
      { href: "/conciliacion", texto: "Conciliación", icono: ArrowDownUp, ayuda: "Cobros de las pasarelas y a qué cuota van" },
      { href: "/equipo", texto: "Equipo y honorarios", icono: Banknote, ayuda: "Quién es quién, con qué entra a la app y cuánto cobra", soloDuenos: true },
      { href: "/ajustes", texto: "Ajustes", icono: Settings, ayuda: "Etapas, categorías, campos e integraciones" },
    ],
  },
];

export const TODOS_LOS_ITEMS = NAV.flatMap((g) => g.items);

/* El menú de quien está usando la app: sin lo que es sólo de los dueños. */
export function navPara(esDueno: boolean): GrupoNav[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => esDueno || !i.soloDuenos) })).filter((g) => g.items.length > 0);
}
