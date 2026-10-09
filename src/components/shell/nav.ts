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
  /* Abre un asistente que guarda (cargar una venta, cerrar el día): sólo se
     ofrece a quien EDITA el área de esa pantalla. Quien sólo la ve la
     abriría para que la base le rechace lo que cargue. */
  edita?: boolean;
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
      /* Customer Success (F2-09): la lista de a quién contactar hoy y la de Clientes del programa, con todo lo que lleva
         Lili. Son vistas de Alumnos; el nombre es «del programa» para no confundirla con Clientes, la de lo que pagaron. */
      { href: "/alumnos?seccion=hoy", texto: "A contactar hoy", icono: PhoneCall, ayuda: "Los alumnos a los que les toca el contacto de seguimiento, lo más vencido arriba" },
      { href: "/alumnos?seccion=clientes", texto: "Clientes del programa", icono: ListChecks, ayuda: "Cada alumno con todo lo de Customer Success: seguimiento, CV y LinkedIn, accesos y contrato" },
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
   esconden del menú. «Cerrar el día» y «Cargar venta» guardan, así que piden
   editar el CRM y Ventas (`edita`); «Mis llamadas» alcanza con verla. */
export const NAV_CLOSER: GrupoNav[] = [
  {
    titulo: "Tu día",
    items: [
      { href: "/mis-llamadas", texto: "Mis llamadas", icono: PhoneCall, ayuda: "Tus llamadas de hoy: cargá cómo terminó cada una" },
      { href: "/cerrar-el-dia", texto: "Cerrar el día", icono: ClipboardCheck, ayuda: "Pasá por tus llamadas y contá cómo terminó cada una", edita: true },
      { href: "/cargar-venta", texto: "Cargar venta", icono: HandCoins, ayuda: "Cargá una venta nueva: pasa a cliente", edita: true },
    ],
  },
];

export const TODOS_LOS_ITEMS = [...NAV, ...NAV_CLOSER].flatMap((g) => g.items);

/* De un menú, lo que esa cuenta puede usar: lo que ve y, si el item guarda
   algo (`edita`), sólo si edita su área. */
function alAlcance(menu: GrupoNav[], a: MiAcceso | null): GrupoNav[] {
  return menu
    .map((g) => ({ ...g, items: g.items.filter((i) => nivelDeRuta(a, i.href) >= (i.edita ? 2 : 1)) }))
    .filter((g) => g.items.length > 0);
}

/* El menú de quien está usando la app: lo que su tipo de cuenta ve; el
   closer, el mínimo. Un tipo de «sólo lo suyo» que no tiene CRM ni Ventas
   (Customer Success, Marketing…, porque el interruptor se puede marcar en
   cualquier tipo) se quedaría sin ninguna de las tres entradas y sin forma de
   moverse: ése usa el menú de siempre, con lo que ve. */
export function navPara(a: MiAcceso | null): GrupoNav[] {
  const delCloser = esCuentaDeCloser(a) ? alAlcance(NAV_CLOSER, a) : [];
  return delCloser.length > 0 ? delCloser : alAlcance(NAV, a);
}

/* A dónde va el inicio: el Dashboard, o la primera pantalla que ve (el
   closer, al CRM). Siempre una ruta de su menú; sólo un tipo que no ve nada
   cae en el Dashboard, que tampoco ve. */
export function inicioPara(a: MiAcceso | null): string {
  /* Customer Success (Alumnos y Clientes, sin Dashboard, CRM ni Ventas)
     arranca en la lista de a quién contactar hoy, no en Clientes. */
  if (nivelDeRuta(a, "/alumnos") > 0 && ["/panel", "/crm", "/leads", "/ventas"].every((r) => nivelDeRuta(a, r) === 0)) return "/alumnos?seccion=hoy";
  return navPara(a)[0]?.items[0]?.href ?? "/panel";
}
