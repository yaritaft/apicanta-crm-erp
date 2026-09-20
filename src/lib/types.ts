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
  /* Pauta de captación. DM Ads y WhatsApp API van aparte. */
  inversion: number;
  /* El tracker de Yari */
  formularios: number;
  grupoWpp: number;
  llamadasVivo: number;
  llamadasPosterior: number;
  llamadasCanceladas: number;
  llamadasInasistidas: number;
  llamadasNoCalificadas: number;
  llamadasCalificadas: number;
  inversionDmAds: number;
  costoWhatsappApi: number;
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
  metas: Meta[];
  campos: CampoPersonalizado[];
  actividad: Actividad[];
  /* Modelo financiero */
  productos: Producto[];
  procesadores: Procesador[];
  embudos: Embudo[];
  equipo: MiembroEquipo[];
  ventas: Venta[];
  cuotas: Cuota[];
  pagos: Pago[];
  gastos: Gasto[];
  movimientos: Movimiento[];
}

/* ==================================================================
   Modelo financiero real de Apicanta
   Una venta tiene cuotas; cada cuota puede cobrarse con varios
   métodos de pago. Todo se atribuye a un webinar, un embudo, un
   closer y un director para poder calcular comisiones y profit.
   ================================================================== */

export interface Producto {
  id: ID;
  nombre: string;
  precioLista: number;
  tipo: "principal" | "downsell" | "upsell" | "evento" | "suscripcion";
  activo: boolean;
  orden: number;
}

export interface Procesador {
  id: ID;
  nombre: string;
  /* Fracción: 0.029 = 2,9% */
  feeRate: number;
  activo: boolean;
  /* Trust y la Financiera se concilian a mano */
  automatico: boolean;
  /* Contra qué pasarela se concilian sus cobros. Sin proveedor, el
     procesador existe igual pero nunca recibe movimientos solo. */
  proveedor?: ProveedorPasarela;
}

/* ---------- Pasarelas de cobro ----------
   Un movimiento es plata que entró de verdad a una pasarela. Vive suelto
   hasta que alguien lo concilia contra una cuota: recién ahí nace el Pago.
   La referencia es la clave de deduplicación: el mismo cobro importado dos
   veces es un solo movimiento.                                            */

export type ProveedorPasarela =
  | "stripe"
  | "paypal"
  | "hotmart"
  | "whop"
  | "mercadopago"
  | "manual";

export type EstadoMovimiento2 = "pendiente" | "conciliado" | "ignorado";

export interface Movimiento {
  id: ID;
  proveedor: ProveedorPasarela;
  /* Procesador de Apicanta con el que se registra el pago */
  procesadorId?: ID;
  /* El id del cobro en la pasarela: pi_3Q…, 8XJ…, etc. */
  referencia: string;
  /* Bruto, lo que pagó el cliente */
  monto: number;
  moneda: Moneda;
  /* Lo que se quedó la pasarela, tal como vino. No es una estimación. */
  fee: number;
  neto: number;
  fecha: string;
  clienteNombre?: string;
  clienteEmail?: string;
  descripcion?: string;
  estado: EstadoMovimiento2;
  /* Resultado de la conciliación */
  pagoId?: ID;
  cuotaId?: ID;
  ventaId?: ID;
  conciliadoEn?: string;
  conciliadoPor?: string;
  /* De dónde salió: "csv", "api", "webhook", "demo" */
  origen: string;
  creadoEn: string;
}

export interface Embudo {
  id: ID;
  nombre: string;
  activo: boolean;
  orden: number;
}

export type RolEquipo = "closer" | "director" | "growth" | "socio" | "ceo" | "setter";

export interface MiembroEquipo {
  id: ID;
  nombre: string;
  rol: RolEquipo;
  comisionRate: number;
  activo: boolean;
  desde?: string;
  /* Yari: si figura como closer, no comisiona nadie */
  sinComision: boolean;
  notas?: string;
}

export type EstadoVenta = "activa" | "cancelada" | "reembolsada";

export interface Venta {
  id: ID;
  contactoId?: ID;
  contactoNombre: string;
  productoId?: ID;
  webinarId?: ID;
  embudoId?: ID;
  precioAcordado: number;
  moneda: Moneda;
  closerId?: ID;
  directorId?: ID;
  /* Eventos y conocidos: el growth partner no comisiona */
  excluidoMarketing: boolean;
  estado: EstadoVenta;
  fecha: string;
  notas?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

export type EstadoCuota = "pendiente" | "pagada" | "cancelada";

export interface Cuota {
  id: ID;
  ventaId: ID;
  numero: number;
  monto: number;
  vence?: string;
  estado: EstadoCuota;
  esReserva: boolean;
  notas?: string;
}

export interface Pago {
  id: ID;
  cuotaId: ID;
  procesadorId?: ID;
  /* Si el pago salió de conciliar un cobro de pasarela */
  movimientoId?: ID;
  monto: number;
  moneda: Moneda;
  feeRate: number;
  feeMonto: number;
  fecha: string;
  referencia?: string;
  notas?: string;
  creadoEn: string;
}

export type GrupoGasto = "directo" | "operativo" | "dueno";

export interface Gasto {
  id: ID;
  categoria: string;
  grupo: GrupoGasto;
  concepto: string;
  monto: number;
  moneda: Moneda;
  fecha: string;
  webinarId?: ID;
  recurrente: boolean;
  proveedor?: string;
  notas?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}
