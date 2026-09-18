/* Apicanta ERP — modelo de dominio.
   Todo lo que el negocio necesita seguir: leads, pipeline, agenda, webinars,
   alumnos, marketing, finanzas y metas. Cada entidad es editable y extensible. */

export type ID = string;

export type Moneda = "USD" | "ARS";

/* ---------- Config editable ---------- */

export type TipoCampo =
  | "texto"
  | "texto-largo"
  | "numero"
  | "moneda"
  | "fecha"
  | "seleccion"
  | "booleano"
  | "email"
  | "telefono"
  | "url";

export interface CampoPersonalizado {
  id: ID;
  entidad: EntidadNombre;
  nombre: string;
  clave: string;
  tipo: TipoCampo;
  opciones?: string[];
  requerido: boolean;
  ayuda?: string;
}

export type EntidadNombre =
  | "lead"
  | "alumno"
  | "sesion"
  | "webinar"
  | "campania"
  | "transaccion";

export interface Etapa {
  id: ID;
  nombre: string;
  /* Variante visual del Badge del design system */
  variante: "info" | "brand" | "accent" | "warning" | "success" | "danger" | "neutral";
  /* Probabilidad de cierre, para el forecast ponderado */
  probabilidad: number;
  esGanada?: boolean;
  esPerdida?: boolean;
  orden: number;
}

/* ---------- Leads ---------- */

export interface Lead {
  id: ID;
  nombre: string;
  email: string;
  telefono?: string;
  pais?: string;
  fuente: string;
  campania?: string;
  etapaId: ID;
  monto: number;
  moneda: Moneda;
  responsable: string;
  notas?: string;
  etiquetas: string[];
  webinarId?: ID;
  creadoEn: string;
  actualizadoEn: string;
  extra: Record<string, unknown>;
}

/* ---------- Agenda ---------- */

export type EstadoSesion = "agendada" | "hecha" | "no-show" | "cancelada";

export interface Sesion {
  id: ID;
  titulo: string;
  leadId?: ID;
  alumnoId?: ID;
  invitado: string;
  email?: string;
  inicia: string;
  duracionMin: number;
  estado: EstadoSesion;
  tipo: string;
  enlace?: string;
  origen: "manual" | "calendly";
  notas?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

/* ---------- Webinars ---------- */

export type EstadoWebinar = "borrador" | "programado" | "en-vivo" | "finalizado";

export interface Webinar {
  id: ID;
  titulo: string;
  fecha: string;
  duracionMin: number;
  estado: EstadoWebinar;
  registrados: number;
  asistentes: number;
  inversion: number;
  enlaceRegistro?: string;
  enlaceReplay?: string;
  notas?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

/* ---------- Alumnos ---------- */

export type EstadoAlumno = "activo" | "pausado" | "graduado" | "baja";

export interface Alumno {
  id: ID;
  nombre: string;
  email: string;
  pais?: string;
  cohorte: string;
  plan: string;
  cuotaMensual: number;
  moneda: Moneda;
  estado: EstadoAlumno;
  inicio: string;
  progreso: number;
  leadId?: ID;
  notas?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

export type EstadoReporte = "completado" | "pendiente" | "vencido" | "no-enviado";

export interface Reporte {
  id: ID;
  alumnoId: ID;
  semanaDel: string;
  estado: EstadoReporte;
  completadoEn?: string;
  horasEstudio?: number;
  entrevistas?: number;
  postulaciones?: number;
  bloqueo?: string;
}

/* ---------- Marketing (Meta) ---------- */

export type EstadoCampania = "activa" | "pausada" | "finalizada";

export interface Campania {
  id: ID;
  nombre: string;
  plataforma: string;
  objetivo: string;
  estado: EstadoCampania;
  inversion: number;
  impresiones: number;
  clicks: number;
  leads: number;
  desde: string;
  hasta?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

/* ---------- Finanzas ---------- */

export type TipoMovimiento = "ingreso" | "egreso";
export type EstadoMovimiento = "pagado" | "pendiente" | "vencido";

export interface Transaccion {
  id: ID;
  tipo: TipoMovimiento;
  categoria: string;
  concepto: string;
  monto: number;
  moneda: Moneda;
  fecha: string;
  estado: EstadoMovimiento;
  metodo: string;
  alumnoId?: ID;
  leadId?: ID;
  recurrente: boolean;
  creadoEn: string;
  extra: Record<string, unknown>;
}

/* ---------- Metas ---------- */

export type UnidadMeta = "moneda" | "cantidad" | "porcentaje";

export interface Meta {
  id: ID;
  nombre: string;
  metrica: MetricaClave;
  objetivo: number;
  unidad: UnidadMeta;
  periodo: string;
  creadoEn: string;
}

export type MetricaClave =
  | "ingresos"
  | "leads-nuevos"
  | "inscriptos"
  | "sesiones-hechas"
  | "alumnos-activos"
  | "margen"
  | "registrados-webinar";

/* ---------- Trazabilidad ---------- */

export type AccionActividad = "creo" | "actualizo" | "elimino" | "movio" | "importo";

export interface Actividad {
  id: ID;
  entidad: EntidadNombre | "meta" | "config";
  entidadId: ID;
  titulo: string;
  accion: AccionActividad;
  detalle: string;
  actor: string;
  fecha: string;
}

/* ---------- Ajustes ---------- */

export interface Ajustes {
  negocio: string;
  responsable: string;
  monedaBase: Moneda;
  tipoCambio: number;
  fuentes: string[];
  categoriasIngreso: string[];
  categoriasEgreso: string[];
  planes: string[];
  tiposSesion: string[];
  metodosPago: string[];
  metaAccountId: string;
  metaToken: string;
  calendlyUser: string;
  calendlyToken: string;
  tema: "dark" | "light";
  tourVisto: boolean;
}

/* ---------- Estado completo ---------- */

export interface EstadoApp {
  version: number;
  ajustes: Ajustes;
  etapas: Etapa[];
  leads: Lead[];
  sesiones: Sesion[];
  webinars: Webinar[];
  alumnos: Alumno[];
  reportes: Reporte[];
  campanias: Campania[];
  transacciones: Transaccion[];
  metas: Meta[];
  campos: CampoPersonalizado[];
  actividad: Actividad[];
}
