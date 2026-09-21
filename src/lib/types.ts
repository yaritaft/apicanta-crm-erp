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

/* Conversacional es el corte que importa: abajo de eso no puede dar una
   entrevista en USA, y esa es toda la propuesta del programa. */
export type NivelIngles = "ninguno" | "basico" | "intermedio" | "conversacional" | "nativo";

export interface Lead {
  id: ID;
  nombre: string;
  email: string;
  telefono?: string;
  pais?: string;
  fuente: string;
  campania?: string;
  /* Lo que Yari mira para calificar a alguien de Hackear IT: si puede
     sostener una entrevista en ingles y cuanto lleva programando. El backend
     real ya los tiene como `english_level` y `years_experience`; se usan los
     mismos conceptos para no divergir el dia que se unifiquen. */
  inglesNivel?: NivelIngles;
  aniosExperiencia?: number;
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
  /* Todos los clicks: incluye likes, comentarios y "ver más". */
  clicks: number;
  leads: number;
  /* Las que calcula Meta. Se guardan en vez de derivarlas para que la tabla
     cierre contra el Ads Manager fila por fila. */
  ctr?: number;
  cpm?: number;
  cpc?: number;
  /* Los clicks que se fueron a la landing, que es lo que importa para el
     embudo. Meta los separa de los clicks totales a proposito. */
  clicksEnlace?: number;
  ctrEnlace?: number;
  costoPorClickEnlace?: number;
  /* Personas distintas, y cuantas veces vio el anuncio cada una. Frecuencia
     alta con CTR cayendo es fatiga de creativo. */
  alcance?: number;
  frecuencia?: number;
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

/* ---------- Jerarquía de Meta ----------

   campaigns → adsets → ads → ad_insights, igual que el Ads Manager.

   Reemplaza a `Campania`, que era plana y guardaba UN número de inversión por
   campaña. Ese era el techo del filtro de fechas: se podía elegir qué campañas
   ver, pero no recortar el gasto a los días elegidos, porque el gasto no tenía
   días. */

export interface Campaign {
  id: ID;
  /* El id del lado de Meta. Separado del nuestro porque una campaña cargada a
     mano no tiene, y porque el nuestro no puede depender de un tercero. */
  metaId?: string;
  nombre: string;
  objetivo: string;
  estado: string;
  cuentaId?: string;
  desde?: string;
  hasta?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

export interface Adset {
  id: ID;
  metaId?: string;
  campaignId: ID;
  nombre: string;
  estado: string;
  desde?: string;
  hasta?: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

export interface Ad {
  id: ID;
  metaId?: string;
  adsetId: ID;
  /* Repetido a propósito aunque se llegue por el adset: la pantalla agrupa por
     campaña, y sin esto la pregunta más común de la app pide un join de más. */
  campaignId: ID;
  nombre: string;
  estado: string;
  creadoEn: string;
  extra: Record<string, unknown>;
}

/* Una fila por anuncio y por DÍA. Es lo que hace que el selector de fechas
   diga la verdad: sumando estas filas sale el gasto de cualquier rango, y
   hacia arriba, el de cualquier adset o campaña.

   Lo opcional es opcional de verdad: Meta omite la métrica cuando no hubo ese
   evento, y un 0 mentiría — "gastó y no convirtió" no es "no corrió". */
export interface AdInsight {
  /* `<adId>_<dia>`: así volver a sincronizar un día ya traído lo pisa en vez
     de duplicarlo, sin lógica extra en el store. */
  id: ID;
  adId: ID;
  dia: string;
  inversion: number;
  impresiones: number;
  clicks: number;
  leads: number;
  alcance?: number;
  frecuencia?: number;
  ctr?: number;
  cpm?: number;
  cpc?: number;
  clicksEnlace?: number;
  ctrEnlace?: number;
  costoPorClickEnlace?: number;
  /* Qué conversiones reportó Meta ese día y cuál se contó como lead. Sirve
     para entender de dónde sale el número sin adivinar. */
  acciones: Record<string, number>;
  tipoDeLead?: string;
  creadoEn: string;
}

export interface EstadoApp {
  version: number;
  ajustes: Ajustes;
  etapas: Etapa[];
  leads: Lead[];
  sesiones: Sesion[];
  webinars: Webinar[];
  alumnos: Alumno[];
  reportes: Reporte[];
  /* `campanias` sigue viva hasta que Marketing lea de las tablas nuevas y los
     datos esten migrados. Tirarla antes deja la pantalla en blanco. */
  campanias: Campania[];
  campaigns: Campaign[];
  adsets: Adset[];
  ads: Ad[];
  adInsights: AdInsight[];
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
  /* Cobran online y avisan al instante */
  | "stripe"
  | "mercadopago"
  | "hotmart"
  | "whop"
  | "dlocal"
  /* Se consultan cada tanto: no avisan, hay que preguntarles */
  | "mercury"
  | "binance"
  | "trust"
  /* Lo que sólo entra a mano o por planilla */
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
