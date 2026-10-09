import type { SeccionKpi } from "./kpis";
import type { AreaId, AreasDeTipo, TipoCuenta } from "./types";

export type { AreaId, AreasDeTipo, NivelArea, TipoCuenta } from "./types";

/* ==================================================================
   Qué ve y qué edita cada tipo de cuenta (Yari 29/09: "falta el apartado
   de ajustes para ir asignando los distintos tipos de cuentas a la gente
   que usa el sistema").

   Un tipo dice, por área de la app, si la ve o la edita, y si en las
   llamadas, las ventas y la gente ve sólo lo suyo (el closer). Los tipos
   viven en la tabla `tipos_cuenta` y los dueños los cambian en Equipo →
   Tipos de cuenta. El de Dueño es fijo: todo.

   Lo que protege los datos es la base (supabase/tipos-cuenta.sql): LEEN y
   EDITAN son las mismas listas que areas_que_leen() y areas_que_editan(),
   y una prueba compara las dos. Acá se usan para el menú, las pantallas y
   para no mandar a la base algo que va a rechazar.
   ================================================================== */

export const AREAS: { id: AreaId; nombre: string; pantallas: string }[] = [
  { id: "panel", nombre: "Dashboard", pantallas: "Dashboard & KPIs: sólo las partes de las áreas que ve" },
  { id: "leads", nombre: "Leads", pantallas: "Leads" },
  { id: "crm", nombre: "CRM y Agenda", pantallas: "CRM, cierre del día y Agenda" },
  { id: "ventas", nombre: "Ventas", pantallas: "Ventas, cuotas y cobros. Quien ve Ventas ve también Clientes" },
  /* Clientes se puede dar solo (Customer Success: F2-06). Quien ya ve o edita
     Ventas lo sigue viendo igual: ver nivelDeAreas(). */
  { id: "clientes", nombre: "Clientes", pantallas: "Clientes: lo que compró cada uno, cuánto pagó y si está al día" },
  { id: "webinars", nombre: "Webinars", pantallas: "Webinars" },
  { id: "marketing", nombre: "Marketing", pantallas: "Marketing (Meta)" },
  { id: "alumnos", nombre: "Alumnos", pantallas: "Alumnos, Pipeline de servicio y Reportes" },
  { id: "finanzas", nombre: "Finanzas", pantallas: "Finanzas, Caja y Conciliación" },
  { id: "ajustes", nombre: "Ajustes", pantallas: "Ajustes" },
];

const TODO: AreasDeTipo = Object.fromEntries(AREAS.map((a) => [a.id, "editar"])) as AreasDeTipo;

/* Customer Success (Lili y las chicas): los alumnos —seguimiento, CV y
   LinkedIn, testimonios— y los clientes, y sólo eso. Lo siembra
   supabase/customer-success.sql y se puede crear con un clic en Equipo →
   Tipos de cuenta (F2-06). */
export const CUSTOMER_SUCCESS: TipoCuenta = {
  id: "customer_success", nombre: "Customer Success", orden: 7, soloLoSuyo: false,
  descripcion: "Alumnos (seguimiento, CV y LinkedIn, testimonios) y Clientes. Sólo eso.",
  areas: { alumnos: "editar", clientes: "ver" },
};

/* Los mismos que siembra supabase/tipos-cuenta.sql. */
export const TIPOS_POR_DEFECTO: TipoCuenta[] = [
  { id: "dueno", nombre: "Dueño", descripcion: "Todo, incluido lo que cobra cada uno y los accesos a la app.", areas: TODO, soloLoSuyo: false, orden: 0 },
  { id: "equipo", nombre: "Todo menos honorarios", descripcion: "Toda la app menos Equipo y honorarios.", areas: TODO, soloLoSuyo: false, orden: 1 },
  {
    id: "director", nombre: "Director comercial", orden: 2, soloLoSuyo: false,
    descripcion: "Leads, CRM, Agenda, Ventas y Clientes de todos los closers. Ve los webinars y el Dashboard, sin Finanzas.",
    areas: { panel: "ver", leads: "editar", crm: "editar", ventas: "editar", webinars: "ver" },
  },
  {
    id: "closer", nombre: "Closer", orden: 3, soloLoSuyo: true,
    descripcion: "Sus llamadas en el CRM y la Agenda, su cierre del día, sus ventas y sus clientes.",
    areas: { crm: "editar", ventas: "editar" },
  },
  {
    id: "setter", nombre: "Setter", orden: 4, soloLoSuyo: false,
    descripcion: "Los leads y la Agenda, sin montos de venta.",
    areas: { leads: "editar", crm: "ver" },
  },
  {
    id: "admin", nombre: "Administración", orden: 5, soloLoSuyo: false,
    descripcion: "Finanzas, Caja, Conciliación, Ventas y Clientes. En el Dashboard, cobranza y rentabilidad.",
    areas: { panel: "ver", ventas: "editar", finanzas: "editar" },
  },
  {
    id: "marketing", nombre: "Marketing", orden: 6, soloLoSuyo: false,
    descripcion: "Webinars y Marketing; ve los leads. En el Dashboard, adquisición y el webinar.",
    areas: { panel: "ver", leads: "ver", webinars: "editar", marketing: "editar" },
  },
  CUSTOMER_SUCCESS,
];

/* ---------- quién está usando la app ---------- */

export interface MiAcceso {
  tipo: string;
  nombre: string;
  areas: AreasDeTipo;
  soloLoSuyo: boolean;
  /* Quién es en Equipo (por su correo): con eso se sabe qué es "lo suyo". */
  miembroId?: string;
}

export const ACCESO_DUENO: MiAcceso = { tipo: "dueno", nombre: "Dueño", areas: TODO, soloLoSuyo: false };

export const esDueno = (a: MiAcceso | null | undefined) => a?.tipo === "dueno";

/** Una cuenta que ve sólo lo suyo (el closer): su menú es el mínimo, «Mis
 *  llamadas», «Cerrar el día» y «Cargar venta», cada una si su tipo la puede
 *  usar (components/shell/nav.ts). Un tipo de «sólo lo suyo» sin CRM ni Ventas
 *  no se queda sin menú: usa el de siempre. Lo demás sigue abierto por link:
 *  lo que ve ya lo recorta la base, así que no hay nada de otros que esconder
 *  (Yari, 02/10: «tan simple que no se pueda equivocar»). */
export const esCuentaDeCloser = (a: MiAcceso | null | undefined) => Boolean(a?.soloLoSuyo) && !esDueno(a);
/** El nivel de un área según lo que dice un tipo: 0 no la ve, 1 la ve, 2 la edita.
    Clientes cuelga de Ventas desde siempre: lo que da Ventas, lo da también
    Clientes (un tipo de antes no pierde la pantalla), y Clientes se puede dar
    solo, más alto o más bajo, para Customer Success. */
export function nivelDeAreas(areas: AreasDeTipo | undefined, area: AreaId): 0 | 1 | 2 {
  const de = (x: AreaId) => (areas?.[x] === "editar" ? 2 : areas?.[x] === "ver" ? 1 : 0);
  return area === "clientes" ? (Math.max(de("clientes"), de("ventas")) as 0 | 1 | 2) : de(area);
}

/** 0: no la ve · 1: la ve · 2: la edita. */
export function nivelEn(a: MiAcceso | null | undefined, area: AreaId): 0 | 1 | 2 {
  if (!a) return 0;
  if (esDueno(a)) return 2;
  return nivelDeAreas(a.areas, area);
}

/* ---------- qué tablas lee y edita cada área ----------
   Iguales a areas_que_leen() y areas_que_editan() de la base. Lo que no
   está en LEEN lo lee cualquiera (configuración, catálogos, webinars); lo
   que no está en EDITAN, sólo un dueño (equipo, tipos_cuenta, accesos,
   honorarios, liquidaciones). */

const PERSONAS: AreaId[] = ["leads", "crm", "ventas", "clientes", "webinars", "alumnos", "finanzas", "marketing"];
const VENTAS: AreaId[] = ["ventas", "clientes", "finanzas", "webinars", "marketing", "alumnos"];
const YOUTUBE: AreaId[] = ["webinars", "marketing"];

export const LEEN: Record<string, AreaId[]> = {
  leads: PERSONAS,
  contactos: PERSONAS,
  comentarios: ["leads", "crm", "ventas", "clientes", "alumnos", "finanzas"],
  sesiones: ["crm", "leads", "webinars", "marketing", "ventas"],
  ventas: VENTAS,
  cuotas: VENTAS,
  pagos: VENTAS,
  alumnos: ["alumnos"],
  reportes: ["alumnos"],
  /* Customer Success (supabase/customer-success.sql). */
  seguimiento_alumnos: ["alumnos"],
  testimonios: ["alumnos"],
  resells: ["alumnos"],
  revisiones_cv: ["alumnos"],
  gastos: ["finanzas"],
  movimientos: ["finanzas"],
  arqueos: ["finanzas"],
  traspasos: ["finanzas"],
  /* Las devoluciones las ve quien ve las ventas (el closer, sólo las de sus
     ventas): sin ellas, los números de cada área no darían igual. */
  devoluciones: VENTAS,
  gastos_recurrentes: ["finanzas"],
  transacciones: ["finanzas"],
  ad_insights: ["marketing", "webinars", "finanzas"],
  campanias: ["marketing", "webinars"],
  yt_analytics: YOUTUBE,
  yt_chat: YOUTUBE,
  yt_estado: YOUTUBE,
  yt_muestras: YOUTUBE,
  /* El lector de WhatsApp (supabase/whatsapp-lector.sql y whatsapp-lector-permisos.sql): lo ve quien ve los
     Webinars y no está limitado a lo suyo (traen los teléfonos de todos); el código QR no lo lee nadie desde acá,
     lo entrega el servidor. Las políticas son propias, no pasan por areas_que_leen(). */
  whatsapp_lector: ["webinars"],
  whatsapp_grupos: ["webinars"],
  whatsapp_miembros: ["webinars"],
  whatsapp_qr: [],
  /* Sólo los dueños. */
  honorarios: [],
  liquidaciones: [],
  usuarios_permitidos: [],
};

export const EDITAN: Record<string, AreaId[]> = {
  leads: ["leads", "crm", "ventas"],
  contactos: ["leads", "crm", "ventas", "clientes"],
  comentarios: ["leads", "crm", "ventas", "clientes", "alumnos", "finanzas"],
  sesiones: ["crm", "leads"],
  ventas: ["ventas", "finanzas"],
  cuotas: ["ventas", "finanzas"],
  pagos: ["ventas", "finanzas"],
  alumnos: ["alumnos"],
  reportes: ["alumnos"],
  etapas_servicio: ["alumnos"],
  seguimiento_alumnos: ["alumnos"],
  testimonios: ["alumnos"],
  resells: ["alumnos"],
  revisiones_cv: ["alumnos"],
  webinars: ["webinars"],
  campaigns: ["marketing"],
  adsets: ["marketing"],
  ads: ["marketing"],
  ad_insights: ["marketing"],
  campanias: ["marketing"],
  gastos: ["finanzas"],
  movimientos: ["finanzas"],
  arqueos: ["finanzas"],
  traspasos: ["finanzas"],
  /* Las devoluciones se cargan con Finanzas editable o con Ventas editable
     SIN «sólo lo suyo» (el director): el closer no las carga. Ver
     puedeCargarDevolucion; la base lo dice igual (supabase/devoluciones.sql). */
  devoluciones: ["finanzas", "ventas"],
  gastos_recurrentes: ["finanzas"],
  transacciones: ["finanzas"],
  /* Las tablas del lector las escribe sólo el servidor, con la clave de servicio: nadie desde la app. */
  whatsapp_lector: [],
  whatsapp_grupos: [],
  whatsapp_miembros: [],
  whatsapp_qr: [],
  ajustes: ["ajustes"],
  campos: ["ajustes"],
  etapas: ["ajustes"],
  embudos: ["ajustes"],
  productos: ["ajustes"],
  procesadores: ["ajustes"],
  metas: ["ajustes"],
};

/* Lo que cualquiera que entra escribe: lo que hizo (actividad) y sus
   preferencias. Y el servicio que nace de una venta lo crea quien la carga
   (la base lo deja con Ventas editable, aunque no vea Alumnos). */
const LIBRES = new Set(["actividad", "preferencias"]);

/* Lo del lector de WhatsApp: el servidor lo escribe (nadie desde la app), el código QR tampoco lo lee nadie
   (ni un dueño: lo entrega el servidor), y los teléfonos de los grupos no los ve quien está limitado a lo suyo. */
const SOLO_EL_SERVIDOR = new Set(["whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros", "whatsapp_qr"]);
const SIN_SOLO_LO_SUYO = new Set(["whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros"]);

export function puedeLeer(a: MiAcceso | null | undefined, tabla: string): boolean {
  if (!a) return false;
  if (tabla === "whatsapp_qr") return false;
  if (esDueno(a)) return true;
  if (a.soloLoSuyo && SIN_SOLO_LO_SUYO.has(tabla)) return false;
  const areas = LEEN[tabla];
  return !areas || areas.some((x) => nivelEn(a, x) >= 1);
}

/** Quién carga, corrige y borra una devolución: el dueño, quien edita
 *  Finanzas (el asistente de finanzas) y quien edita Ventas y no ve sólo lo
 *  suyo (el director comercial). El closer sólo la ve (Yari y Angelo, 02/10:
 *  «que no se pueda equivocar»). */
export function puedeCargarDevolucion(a: MiAcceso | null | undefined): boolean {
  if (!a) return false;
  if (esDueno(a)) return true;
  return nivelEn(a, "finanzas") === 2 || (nivelEn(a, "ventas") === 2 && !a.soloLoSuyo);
}

/** Quién puede cancelar una venta, darla de baja o reactivarla: lo mismo que
 *  edita Ventas, menos quien ve sólo lo suyo (el closer no cancela ni marca
 *  una venta como reembolsada). */
export function puedeDarDeBaja(a: MiAcceso | null | undefined): boolean {
  if (!a) return false;
  if (esDueno(a)) return true;
  return nivelEn(a, "ventas") === 2 && !a.soloLoSuyo;
}

export function puedeEditar(a: MiAcceso | null | undefined, tabla: string): boolean {
  if (!a) return false;
  if (SOLO_EL_SERVIDOR.has(tabla)) return false;
  if (esDueno(a) || LIBRES.has(tabla)) return true;
  if (tabla === "devoluciones") return puedeCargarDevolucion(a);
  if (tabla === "alumnos" && nivelEn(a, "ventas") === 2) return true;
  return (EDITAN[tabla] ?? []).some((x) => nivelEn(a, x) === 2);
}

/* ---------- las pantallas ---------- */

/* De qué área es cada pantalla, por el comienzo de la ruta. "equipo" es
   Equipo y honorarios: sólo los dueños, no se reparte. */
const RUTAS: [string, AreaId | "equipo"][] = [
  ["/panel", "panel"],
  ["/leads", "leads"],
  ["/crm", "crm"],
  /* La cuenta del closer: sus llamadas, el cierre del día y cargar una venta. */
  ["/mis-llamadas", "crm"],
  ["/cerrar-el-dia", "crm"],
  ["/cargar-venta", "ventas"],
  ["/agenda", "crm"],
  ["/pipeline", "crm"],
  ["/ventas", "ventas"],
  ["/clientes", "clientes"],
  ["/webinars", "webinars"],
  ["/formularios", "webinars"],
  ["/marketing", "marketing"],
  ["/alumnos", "alumnos"],
  ["/reportes", "alumnos"],
  ["/finanzas", "finanzas"],
  ["/conciliacion", "finanzas"],
  ["/equipo", "equipo"],
  ["/ajustes", "ajustes"],
];

export function areaDeRuta(ruta: string): AreaId | "equipo" | null {
  const r = ruta.split("?")[0];
  return RUTAS.find(([p]) => r === p || r.startsWith(`${p}/`))?.[1] ?? null;
}

/** 0: no la ve · 1: sólo mirar · 2: la usa entera. */
export function nivelDeRuta(a: MiAcceso | null | undefined, ruta: string): 0 | 1 | 2 {
  const area = areaDeRuta(ruta);
  if (area === null) return 2;
  if (area === "equipo") return esDueno(a) ? 2 : 0;
  return nivelEn(a, area);
}

/* Las secciones del Dashboard y las áreas que necesita cada una: se ve la
   sección si el tipo ve alguna (y el Dashboard). Adquisición sale de Meta;
   el webinar y la agenda, de los webinars o del CRM; lo demás, de ventas,
   finanzas o alumnos. */
export const AREAS_DE_SECCION: Record<SeccionKpi, AreaId[]> = {
  adquisicion: ["marketing"],
  agenda: ["webinars", "crm"],
  ventas: ["ventas"],
  cobranza: ["ventas", "finanzas"],
  rentabilidad: ["finanzas"],
  servicio: ["alumnos"],
};

export function veSeccion(a: MiAcceso | null | undefined, s: SeccionKpi): boolean {
  if (esDueno(a)) return true;
  return nivelEn(a, "panel") >= 1 && AREAS_DE_SECCION[s].some((x) => nivelEn(a, x) >= 1);
}

/* ---------- los tipos que se editan ---------- */

/** Un tipo válido para guardar: nombre, y áreas con 'ver' o 'editar'. */
export function tipoLimpio(t: TipoCuenta): TipoCuenta {
  const areas: AreasDeTipo = {};
  for (const a of AREAS) {
    const n = t.areas[a.id];
    if (n === "ver" || n === "editar") areas[a.id] = n;
  }
  return { ...t, nombre: t.nombre.trim() || "Sin nombre", descripcion: t.descripcion.trim(), areas };
}

/** Lo que ve un tipo, en una línea: «Edita CRM y Agenda, Ventas y Clientes; ve Webinars». */
export function resumenDeTipo(t: Pick<TipoCuenta, "id" | "areas" | "soloLoSuyo">): string {
  if (t.id === "dueno") return "Todo, incluidos Equipo y honorarios.";
  const edita = AREAS.filter((a) => nivelDeAreas(t.areas, a.id) === 2).map((a) => a.nombre);
  const ve = AREAS.filter((a) => nivelDeAreas(t.areas, a.id) === 1).map((a) => a.nombre);
  /* «CRM y Agenda, Ventas y Clientes»: si algún nombre ya lleva «y», con comas. */
  const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("")
    : xs.some((x) => x.includes(" y ")) ? xs.join(", ") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
  const partes = [edita.length ? `Edita ${lista(edita)}` : "", ve.length ? `${edita.length ? "ve" : "Ve"} ${lista(ve)}` : ""].filter(Boolean);
  if (partes.length === 0) return "No ve nada todavía.";
  return `${partes.join("; ")}.${t.soloLoSuyo ? " Sólo lo suyo." : ""}`;
}

/* Para el aviso cuando la base no deja guardar algo: «no puede cambiar las ventas». */
const QUE_ES: Record<string, string> = {
  ventas: "las ventas", cuotas: "las cuotas", pagos: "los cobros", leads: "los leads", contactos: "las personas",
  sesiones: "las llamadas", comentarios: "los comentarios", alumnos: "los alumnos", reportes: "los reportes",
  etapas_servicio: "las etapas del servicio", seguimiento_alumnos: "el seguimiento de alumnos", testimonios: "los testimonios", resells: "la agenda de resells", revisiones_cv: "las revisiones de CV", webinars: "los webinars", gastos: "los gastos",
  movimientos: "la conciliación", arqueos: "la caja", traspasos: "los movimientos entre cuentas", gastos_recurrentes: "los gastos fijos",
  devoluciones: "las devoluciones",
  transacciones: "las transacciones", ajustes: "los Ajustes",
  etapas: "las etapas", embudos: "las estrategias", productos: "los servicios", procesadores: "las cuentas recaudadoras",
  campos: "los campos", metas: "las metas", equipo: "el equipo", tipos_cuenta: "los tipos de cuenta",
  campaigns: "Marketing", adsets: "Marketing", ads: "Marketing", ad_insights: "Marketing", campanias: "Marketing",
  honorarios: "los honorarios", liquidaciones: "la liquidación",
};
export const queEsTabla = (tabla: string) => QUE_ES[tabla] ?? "esto";
