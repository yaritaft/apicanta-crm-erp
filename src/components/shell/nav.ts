import {
  LayoutDashboard, Users, Columns3, CalendarDays, Video, Megaphone,
  GraduationCap, ClipboardList, Wallet, Settings, HandCoins, ArrowDownUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface ItemNav { href: string; texto: string; icono: LucideIcon; ayuda: string }
export interface GrupoNav { titulo: string; items: ItemNav[] }

export const NAV: GrupoNav[] = [
  {
    titulo: "Negocio",
    items: [
      { href: "/panel", texto: "Panel", icono: LayoutDashboard, ayuda: "Cómo viene el mes de un vistazo" },
    ],
  },
  {
    titulo: "Ventas",
    items: [
      { href: "/leads", texto: "Leads", icono: Users, ayuda: "Toda la gente interesada" },
      { href: "/pipeline", texto: "Pipeline", icono: Columns3, ayuda: "Arrastrá leads entre etapas" },
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
      { href: "/reportes", texto: "Reportes", icono: ClipboardList, ayuda: "El reporte semanal de cada alumno" },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/finanzas", texto: "Finanzas", icono: Wallet, ayuda: "Ingresos, egresos y qué queda" },
      { href: "/conciliacion", texto: "Conciliación", icono: ArrowDownUp, ayuda: "Cobros de las pasarelas y a qué cuota van" },
      { href: "/ajustes", texto: "Ajustes", icono: Settings, ayuda: "Etapas, categorías, campos e integraciones" },
    ],
  },
];

export const TODOS_LOS_ITEMS = NAV.flatMap((g) => g.items);
