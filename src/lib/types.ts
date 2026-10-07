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
  | "contacto"
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

/* El pipeline de SERVICIO: por dónde pasa un alumno desde que compra hasta
   que termina (venta nueva, onboarding, en servicio...). Es otro tablero que
   el de ventas: acá no hay probabilidad de cierre, la venta ya se cerró.
   Tabla `etapas_servicio`. */
export interface EtapaServicio {
  id: ID;
  nombre: string;
  /* La misma paleta de variantes que el Badge, para pintar igual que las
     etapas de ventas. */
  color: Etapa["variante"];
  orden: number;
  creadoEn: string;
}

/* ---------- Leads ---------- */

/* Conversacional es el corte que importa: abajo de eso no puede dar una
   entrevista en USA, y esa es toda la propuesta del programa. */
export type NivelIngles = "ninguno" | "basico" | "intermedio" | "conversacional" | "nativo";

export interface Lead {
  id: ID;
  /* La persona. Por ahora el lead conserva ademas su copia de nombre, email,
     telefono, pais e ingles: sacarlos de una rompe ocho pantallas. El contacto
     es la fuente de verdad desde ahora; la copia se limpia despues. */
  contactoId?: ID;
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

/* ---------- Contactos ----------

   La PERSONA. Un lead es una oportunidad sobre un contacto: "un contacto
   pudo no haber sido lead, pero un lead es contacto".

   Separarlos permite lo que hoy no se puede: saber de que anuncio vino
   alguien. El origen es de la persona, no de la oportunidad — si vuelve seis
   meses despues y se abre un lead nuevo, sigue habiendo venido de aquel
   anuncio.

   Los canales son los cuatro que ya existen en el backend real
   (`contacts.origin_channel`, lleno al 100%): webinar, vsl, setter y otro. No
   se inventa una taxonomia nueva ni se deduce de los UTMs — el dato ya viene
   clasificado. */

export type CanalOrigen = "webinar" | "vsl" | "setter" | "otro";

export interface Contacto {
  id: ID;
  nombre: string;
  email: string;
  telefono?: string;
  pais?: string;
  /* La calificacion es de la persona, no de la oportunidad. */
  inglesNivel?: NivelIngles;
  aniosExperiencia?: number;
  /* De donde vino. `origenAdId` apunta al anuncio de la jerarquia de Meta y
     es el vinculo fuerte: un id real, no un texto que alguien escribio. Los
     UTMs son el respaldo y el detalle — de las agendas de Calendly llegan
     `utm_source`, `utm_medium` y `utm_content` al 100%, pero `utm_campaign`
     solo en la mitad. */
  origenCanal?: CanalOrigen;
  origenAdId?: ID;
  origenWebinarId?: ID;
  utm?: Record<string, string>;
  /* Del formulario de Calendly, tal cual lo escribió la persona: son texto
     libre ("React y Node", "Universitario", "1200"), no categorías. */
  tecnologias?: string;
  formacion?: string;
  sueldoUsd?: string;
  instagram?: string;
  notas?: string;
  creadoEn: string;
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
  /* Lo que trae Calendly. `contactoId` es la persona: una llamada es de un
     contacto aunque todavía no tenga una oportunidad abierta. */
  contactoId?: ID;
  canal?: CanalOrigen;
  /* Los UTMs con los que agendó: identifican el embudo (Webinar + fecha,
     Resell, setter, orgánico), no el anuncio. */
  utm?: Record<string, string>;
  /* Las preguntas del formulario de Calendly, tal cual se contestaron. */
  respuestas?: { pregunta: string; respuesta: string }[];
  /* Quién la atiende: el anfitrión del evento en Calendly (el closer). */
  anfitrion?: string;
  calendlyEventoUri?: string;
  calendlyInvitadoUri?: string;
  /* Si la reprogramaron, la llamada de antes. */
  reprogramadaDe?: ID;
  canceladaEn?: string;
  motivoCancelacion?: string;
  /* Lo que carga el equipo en el CRM (Booking Calls), como en el Airtable
     de ventas. El resto de la fila sale de la agenda misma. Se guardan con
     el nombre de la opción, igual que un campo de selección de Airtable. */
  preCall?: string;          // 1° Mje Enviado, 1° Llamada, 2° Mje Enviado…
  estadoPreCall?: string;    // Confirmado, Reagendar, Sin Respuesta
  estadoLlamada?: string;    // Compra Full, Seguimiento Nutrición, Inasistió…
  grabacion?: string;        // El link de Fathom
  /* El cierre del día del closer (EOD, lib/eod.ts): si no cerró, por qué,
     si hizo la oferta y para cuándo estima cerrarlo. Cómo terminó lo dice
     el Estado de Llamada (lib/estados.ts). `resultado` es lo que cargaba
     el cierre del día antes de que los estados fueran uno solo: ya no se
     escribe, y se borra cuando la llamada recibe su Estado de Llamada. */
  resultado?: ResultadoLlamada;
  objecion?: string;
  hizoOferta?: boolean;
  cierreEstimado?: string;   // aaaa-mm-dd
  eodEn?: string;            // cuándo se guardó por última vez desde el cierre del día
  eodPor?: string;           // quién
  /* La primera vez que se cargó cada estado, venga de donde venga (el cierre
     del día, la tabla del CRM, la Agenda, la ficha o una venta): es la marca
     confiable con la que se cuentan los strikes (lib/cierre-del-dia.ts). Se
     escribe sola al pasar el estado de vacío a cargado y después no se corre
     ni se borra: cambiar el estado, vaciarlo o borrar la opción no la tocan
     (sólo deshacer la primera carga la saca). Sin la columna
     (supabase/cierre-del-dia.sql) sólo dura lo que la pantalla esté abierta. */
  estadoLlamadaEn?: string;
  estadoPreCallEn?: string;
  /* La puerta del cierre del día: si el estado es de compra, la venta tiene
     que estar cargada para terminar el día; la única salida es avisar que la
     carga otra persona, y eso queda anotado acá (quién lo dijo y cuándo). */
  ventaPorOtro?: { por: string; en: string };
}

/* Cómo terminó una llamada según el cierre del día de antes: con cierre
   (compró), sin cierre, no se presentó o se reprogramó. */
export type ResultadoLlamada = "compro" | "no-compro" | "no-vino" | "reprogramo";

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
  /* El vivo o la grabación en YouTube: la ficha del webinar lo embebe y trae
     sus vistas, comentarios y los suscriptores del canal. */
  youtubeUrl?: string;
  /* Cuándo arrancó el pitch de ventas en el vivo: la curva de espectadores
     marca ahí la línea, y se mide cuánta gente se fue desde ese minuto. */
  pitchEn?: string | null;
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
  /* En qué columna del pipeline de servicio está. Sin etapa, o con una que
     ya se borró, se dibuja en la primera: nunca queda fuera del tablero. */
  etapaServicioId?: ID;
  /* La venta que lo trajo. Se enlaza sola al registrar la venta. */
  ventaId?: ID;
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

/* ---------- Customer Success: seguimiento de alumnos y testimonios ----------
   Lo que lleva el equipo de Customer Success (lib/seguimiento.ts): a quién
   le toca el próximo contacto, si dejó de contestar y si ya se le corrigió
   el CV y el LinkedIn. Una fila por alumno en `seguimiento_alumnos` y, en
   `testimonios`, lo que se le pidió y se publicó. Van en tablas aparte (no
   en `alumnos`) para que un cambio de etapa del pipeline, que guarda la fila
   entera del alumno, no pise lo que cargó Customer Success. */

export interface SeguimientoAlumno {
  /* "seg_<alumnoId>": un solo seguimiento por alumno, con un id que sale del
     alumno, así dos personas que lo abren a la vez escriben la misma fila. */
  id: ID;
  alumnoId: ID;
  /* Cada cuántos días se lo contacta: 7, 15 o 20 (configurable en Ajustes). */
  cadenciaDias: number;
  /* Los días se guardan como «2026-10-07» (el día del negocio). */
  ultimoContacto: string | null;
  /* Cuándo toca el próximo. Sin dato, es el último contacto (o el ingreso)
     más la cadencia. */
  proximoContacto: string | null;
  /* Cuántas veces seguidas no contestó desde el último contacto logrado. */
  intentosSinRespuesta: number;
  ultimoIntento: string | null;
  dejoDeContestar: boolean;
  cvCorregido: boolean;
  cvCorregidoEn: string | null;
  linkedinCorregido: boolean;
  linkedinCorregidoEn: string | null;
  notas: string;
  actualizadoEn: string;
  actualizadoPor: string;
}

export type EstadoTestimonio = "pedido" | "grabado" | "publicado";

export interface Testimonio {
  id: ID;
  alumnoId: ID;
  estado: EstadoTestimonio;
  /* Dónde está: el video, el posteo, la carpeta. */
  link: string;
  /* El día en que se pidió, grabó o publicó (según el estado). */
  fecha: string | null;
  notas: string;
  creadoEn: string;
}

/* Lo que se ajusta del seguimiento (Alumnos → Seguimiento → Ajustar). Sin
   esto, los valores de siempre (lib/seguimiento.ts). */
export interface ConfigSeguimiento {
  /* Las cadencias que se pueden elegir por alumno, en días. */
  cadencias: number[];
  cadenciaPorDefecto: number;
  /* Si no contestó, se vuelve a intentar a los tantos días. */
  reintentoDias: number;
  /* Con tantos intentos seguidos sin respuesta, se sugiere marcarlo como «dejó de contestar». */
  intentosHastaDejar: number;
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
  /* Los "Proyectos" de la planilla de Angelo: MENT, DOWN, WEB-13/04/26… */
  proyectos: string[];
  /* Lo que cobra quien refiere una venta, sobre lo que entra post pasarelas (0,1 = 10%). */
  comisionReferidor: number;
  /* De qué estrategia, proyecto y webinar es cada UTM. La venta toma su
     origen de acá, con los UTMs de quien compró. */
  reglasUtm: ReglaUtm[];
  /* El CRM: las opciones de los campos que carga el equipo y qué agendas
     entran en cada tabla. Sin esto, los valores de siempre (lib/crm.ts). */
  crm?: ConfigCrm;
  /* Customer Success: cadencias y reintentos del seguimiento de alumnos. */
  seguimiento?: ConfigSeguimiento;
}

/* ---------- CRM (Booking Calls) ---------- */

/* La paleta de las etiquetas, la de Airtable: cada color en cinco tonos,
   del más claro (1) al más oscuro (5). */
export type ColorCrm = `${"azul" | "cian" | "turquesa" | "verde" | "amarillo" | "naranja" | "rojo" | "rosa" | "violeta" | "gris"}${1 | 2 | 3 | 4 | 5}`;

export interface OpcionCrm {
  nombre: string;
  color: ColorCrm;
  /* Qué dice de la llamada: "hecha" la cuenta como hecha en la Agenda y el
     Dashboard; "no-show", como que no vino. Sin esto no la toca. */
  llamada?: "hecha" | "no-show";
  /* La pone el CRM solo, mientras nadie cargue otra: "no-show" cuando la
     llamada quedó como que no vino, "cancelada" si canceló y no volvió a
     agendar, "segunda" si ya había agendado antes. */
  auto?: "no-show" | "cancelada" | "segunda";
  /* Qué dice de la oportunidad. Una compra ofrece cargar la venta (y una
     venta cargada elige sola la que corresponde: al contado, en cuotas, con
     reserva o de downsell); "perdida" pasa el lead a Perdido, salvo que ya
     haya comprado; "devolucion", aunque haya comprado. */
  oportunidad?: OportunidadCrm;
  /* Oculta: ya no se ofrece al cargar un estado, pero las llamadas que la
     tienen la siguen mostrando y no se borra nada (hay historia). Se revisa
     antes qué mueve (lib/estados.ts: revisarOcultar). */
  oculta?: boolean;
}

export type OportunidadCrm = "compra-full" | "compra-cuotas" | "reserva" | "downsell" | "perdida" | "devolucion";

export type CampoOpcionesCrm = "preCall" | "estadoLlamada" | "estadoPreCall";

/* Una tabla del CRM (Booking Calls, Agendas Resells): qué tipos de evento
   de Calendly entran. Cada tabla tiene su regla (asesoramiento, auditoría) y
   se le suman o se le sacan tipos a mano: así un tipo de evento nuevo de
   Calendly sigue cayendo solo en la tabla que le corresponde. */
export interface TablaCrm {
  id: string;
  nombre: string;
  incluir?: string[];
  excluir?: string[];
}

export interface ConfigCrm {
  opciones?: Partial<Record<CampoOpcionesCrm, OpcionCrm[]>>;
  tablas?: TablaCrm[];
  /* Las objeciones que elige el closer en el EOD (lib/eod.ts). */
  objeciones?: string[];
  /* El cierre del día: desde cuándo se cuentan los strikes y el interruptor
     que, prendido, descuenta la comisión (lib/cierre-del-dia.ts). */
  cierreDelDia?: ConfigCierreDelDia;
}

export interface ConfigCierreDelDia {
  /* Desde qué día de llamada (aaaa-mm-dd) se cuentan los strikes: la fecha
     de arranque del CRM para los closers. Sin fecha, todavía no se cuentan. */
  cuentaDesde?: string;
  /* Apagado (de entrada): los strikes sólo se cuentan y se muestran. Prendido:
     no se comisiona lo de un día cuyo cierre no se cargó el mismo día. */
  descuenta?: boolean;
  /* Desde qué día de llamada rige el descuento: el día en que se prendió, así
     prender el interruptor no cambia lo que ya se liquidó. */
  descuentaDesde?: string;
}

/* Una UTM armada para un lanzamiento o una campaña: los valores que tienen
   que coincidir (vacío = cualquiera) y a qué se asigna lo que llega con
   ella. La del webinar del 23/09 es source "Webinar" + medium "23-09". */
export interface ReglaUtm {
  id: ID;
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  embudoId?: ID;             // Estrategia utilizada
  proyecto?: string;         // WEB-23/09/26
  webinarId?: ID;
  creadoEn: string;
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

/* ---------- Chat del equipo ----------
   Lo que el equipo habla de una persona, dentro de su ficha. Va por
   contacto, no por venta ni por alumno: la conversación sigue a la
   persona aunque compre dos veces o pase a servicio. */
export interface Comentario {
  id: ID;
  contactoId: ID;
  autor: string;
  autorEmail?: string;
  texto: string;
  creadoEn: string;
}

/* ---------- Tipos de cuenta ----------
   Qué áreas de la app ve y edita cada tipo, y si ve sólo lo suyo (el
   closer). Tabla `tipos_cuenta`; las reglas, en lib/permisos.ts y en la
   base (supabase/tipos-cuenta.sql). */

export type AreaId = "panel" | "leads" | "crm" | "ventas" | "clientes" | "webinars" | "marketing" | "alumnos" | "finanzas" | "ajustes";
export type NivelArea = "ver" | "editar";
export type AreasDeTipo = Partial<Record<AreaId, NivelArea>>;

export interface TipoCuenta {
  id: ID;
  nombre: string;
  descripcion: string;
  areas: AreasDeTipo;
  /* Llamadas, ventas y personas: sólo las suyas. */
  soloLoSuyo: boolean;
  orden: number;
  actualizadoEn?: string;
}

export interface EstadoApp {
  version: number;
  ajustes: Ajustes;
  etapas: Etapa[];
  etapasServicio: EtapaServicio[];
  /* Los tipos de cuenta (Equipo → Tipos de cuenta). */
  tiposCuenta: TipoCuenta[];
  leads: Lead[];
  sesiones: Sesion[];
  webinars: Webinar[];
  alumnos: Alumno[];
  reportes: Reporte[];
  /* `campanias` sigue viva hasta que Marketing lea de las tablas nuevas y los
     datos esten migrados. Tirarla antes deja la pantalla en blanco. */
  contactos: Contacto[];
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
  comentarios: Comentario[];
  /* Lo que cobra cada uno y las liquidaciones. Sólo las leen los dueños:
     para el resto del equipo llegan vacías. */
  honorarios: EsquemaPago[];
  liquidaciones: Liquidacion[];
  /* Los arqueos de caja: cuánto había de verdad en cada cuenta. */
  arqueos: Arqueo[];
  /* Los movimientos entre cuentas propias (lib/traspasos.ts). */
  traspasos: Traspaso[];
  /* Customer Success (lib/seguimiento.ts). Opcionales: sin
     supabase/customer-success.sql, ninguno. */
  seguimientos?: SeguimientoAlumno[];
  testimonios?: Testimonio[];
  /* Los gastos que se repiten todos los meses (software, abonos): cada mes se
     proponen con el monto del anterior y alguien los aprueba (lib/gastos-recurrentes.ts).
     Opcional: sin supabase/gastos-recurrentes.sql, ninguno. */
  gastosRecurrentes?: GastoRecurrente[];
}

/* Un gasto que se paga todos los meses: la plantilla de la que salen las
   propuestas «Para aprobar». Nunca carga un gasto sola. */
export interface GastoRecurrente {
  id: ID;
  concepto: string;
  categoria: string;
  grupo: GrupoGasto;
  proveedor?: string;
  /* Lo que se paga habitualmente, en la moneda base. */
  monto: number;
  moneda: Moneda;
  /* Qué día del mes se paga (1 a 28). */
  diaDelMes: number;
  /* De qué cuenta recaudadora sale, si se sabe (procesadores). */
  cuentaId?: ID;
  webinarId?: ID;
  notas?: string;
  activo: boolean;
  /* El primer mes ("2026-10") para el que se propone. */
  desde: string;
  /* Los meses que se decidió saltear ("2026-10"). */
  salteados: string[];
  creadoEn: string;
}

/* ==================================================================
   Arqueo de caja: lo que hay de verdad en cada cuenta en un momento
   ("¿cuánta plata tenés en Trust?"). Contra lo que la app esperaba,
   dice si las cuentas dan (lib/caja.ts).
   ================================================================== */

export interface SaldoCuenta {
  procesadorId: ID;
  /* En la moneda de la cuenta. */
  monto: number;
  moneda: Moneda;
  /* Lo mismo en la moneda base, con el tipo de cambio del arqueo. */
  montoBase: number;
  nota?: string;
}

export interface Arqueo {
  id: ID;
  /* Cuándo se contó. */
  fecha: string;
  saldos: SaldoCuenta[];
  /* Pesos por dólar para las cuentas en ARS. */
  tipoCambio?: number;
  /* Todo junto en la moneda base. */
  total: number;
  /* Lo que la app esperaba al guardarlo y la diferencia: la foto de ese día. */
  esperado?: number | null;
  diferencia?: number | null;
  notas?: string;
  por?: string;
  creadoEn: string;
}

/* ==================================================================
   Movimiento entre cuentas propias: plata que pasa de una cuenta a otra
   (Stripe deposita en Mercury, de Mercury a la Financiera). No es un
   ingreso ni un gasto. Se carga a mano o lo detecta la sincronización de
   las cuentas (lib/traspasos.ts).
   ================================================================== */

/* "propuesto": lo detectó la sincronización pero no está segura de que sea
   un pase, hay que confirmarlo. "ignorado": alguien dijo que no lo es. */
export type EstadoTraspaso = "confirmado" | "propuesto" | "ignorado";

export interface Traspaso {
  id: ID;
  /* Cuándo salió (o cuándo llegó, si sólo se sabe eso). */
  fecha: string;
  /* De qué cuenta salió y a cuál llegó (procesadores). */
  origenId?: ID;
  destinoId?: ID;
  /* Lo que salió, en la moneda de la cuenta de origen, y lo que llegó, en
     la de destino. En la misma moneda, la diferencia es lo que costó. */
  montoSale: number;
  monedaSale: Moneda;
  montoLlega: number;
  monedaLlega: Moneda;
  /* Cuándo llegó, si fue otro día. */
  fechaLlega?: string;
  estado: EstadoTraspaso;
  /* Las dos puntas, como las vio la sincronización: la salida
     ("stripe:po_1Q…") y la llegada ("mercury:6f1c…"). Con las dos, el pase
     está conciliado; con una sola, falta ver la otra. */
  salidaRef?: string;
  llegadaRef?: string;
  /* Lo que dice el banco de la otra parte: "STRIPE", "Hotmart BV". */
  contraparte?: string;
  /* El gasto con lo que costó el pase (Comisiones bancarias). */
  gastoId?: ID;
  notas?: string;
  /* "manual" o "api". */
  origen: string;
  por?: string;
  creadoEn: string;
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
  /* En qué moneda recibe. Las de pesos piden el tipo de cambio del cobro. */
  moneda?: Moneda;
  /* Las cuentas a las que transfiere el cliente (las de la Financiera):
     salen en la tabla de la derecha del reporte para la Financiera. */
  cuentasBancarias?: CuentaBancaria[];
  /* Si va en «Otros», al final del arqueo de la Caja: las cuentas que no se
     usan seguido. Sin decirlo, lo deciden los nombres (lib/caja: enOtros). */
  cajaOtros?: boolean;
}

export interface CuentaBancaria {
  titular: string;
  banco: string;
  numero: string;            // N° de cuenta
  alias: string;
  cbu: string;               // CBU/CVU
  cuit: string;
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
  /* Quién pagó, según la pasarela. Si no lo manda (una billetera de USDT,
     una transferencia), la conciliación lo busca entre los contactos. */
  clienteNombre?: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  /* Cómo pagó dentro de la pasarela: "Tarjeta Visa ···4242", "Wire",
     "USDT (TRC20)". La cuenta sola ("Stripe") no dice de dónde vino. */
  metodo?: string;
  descripcion?: string;
  estado: EstadoMovimiento2;
  /* Resultado de la conciliación */
  pagoId?: ID;
  cuotaId?: ID;
  ventaId?: ID;
  conciliadoEn?: string;
  conciliadoPor?: string;
  /* Se concilió atándolo a un pago que ya estaba cargado (de la planilla o
     a mano), no creando uno: deshacer lo desata, no borra el pago. */
  vinculado?: boolean;
  /* De dónde salió: "csv", "api", "webhook", "demo" */
  origen: string;
  creadoEn: string;
}

/* Las "Estrategias utilizadas" de la planilla de Angelo. */
export interface Embudo {
  id: ID;
  nombre: string;
  activo: boolean;
  orden: number;
  /* El embudo de los webinars. En la planilla se llamaba "Lanzamiento", así
     que no se puede deducir del nombre: con esto el Dashboard sabe a qué
     embudo pertenecen los números de la planilla de webinars, y la
     importación de la planilla le sigue mandando lo que dice
     "Lanzamiento". */
  esWebinar?: boolean;
}

/* El rol en las ventas: dice en qué lista aparece cada uno (vendedor,
   setter, director) y quién entra al reparto del profit. "otro" es el que
   no vende: operaciones, contenido, edición. */
export type RolEquipo = "closer" | "director" | "growth" | "socio" | "ceo" | "setter" | "otro";

export interface MiembroEquipo {
  id: ID;
  nombre: string;
  rol: RolEquipo;
  comisionRate: number;
  /* El % de los servicios que comisionan distinto (servicio → fracción):
     en esas ventas vale éste en vez de `comisionRate`. Como `comisionRate`,
     se escribe solo desde lo que cobra la persona (lib/honorarios.ts). */
  comisionServicios?: Record<ID, number>;
  activo: boolean;
  desde?: string;
  /* Yari: si figura como closer, no comisiona nadie */
  sinComision: boolean;
  notas?: string;
  /* El email con el que entra a la app: así se sabe quién está usándola
     (el closer que carga una venta queda elegido solo). */
  email?: string;
  /* Lo que hace, como se dice en el equipo: COO, Trafficker, Customer
     Success Manager. El rol de arriba es sólo para las ventas. */
  puesto?: string;
  /* Hasta cuándo estuvo (YYYY-MM-DD). Un director cobra sólo lo que entra
     hasta ese día: "si el director de la venta no es el que está ahora, no
     comisiona" (Yari). Las cuotas que entran después no le dejan nada. */
  hasta?: string;
}

export type EstadoVenta = "activa" | "cancelada" | "reembolsada";

/* "Ingreso a la comunidad" de la planilla de Angelo. */
export type IngresoComunidad = "Si" | "No" | "En espera" | "N/A";

/* Una venta. Los nombres de la planilla de Angelo van al lado de cada
   campo: "Servicio adquirido" es el producto, "Estrategia utilizada" el
   embudo, "Vendedor" el closer y "Valor total de la venta" el precio. */
export interface Venta {
  id: ID;
  contactoId?: ID;
  contactoNombre: string;
  productoId?: ID;           // Servicio adquirido
  webinarId?: ID;
  embudoId?: ID;             // Estrategia utilizada
  precioAcordado: number;    // Valor total de la venta
  moneda: Moneda;
  closerId?: ID;             // Vendedor
  directorId?: ID;
  /* Eventos y conocidos: el growth partner no comisiona */
  excluidoMarketing: boolean;
  estado: EstadoVenta;
  fecha: string;
  notas?: string;            // Observaciones / Plan de pagos
  creadoEn: string;
  extra: Record<string, unknown>;
  /* Proyecto: MENT, DOWN, WEB-13/04/26… (lista en Ajustes → Ventas). */
  proyecto?: string;
  /* Nombre del setter: un miembro del equipo con rol setter. */
  setterId?: ID;
  /* Nombre del referidor y su número de teléfono: quien refiere no es del
     equipo, por eso va escrito y no elegido. */
  referidorNombre?: string;
  referidorTelefono?: string;
  ingresoComunidad?: IngresoComunidad;
  /* La llamada (sesión) de la que salió la venta: se guarda al cargarla, desde
     el cierre del día, la tabla del CRM o Ventas. Antes se inferían por
     persona y una ventana de -1/+60 días, y daba falsos «sin venta». Sin ella
     (las ventas de antes), se sigue infiriendo para mostrarla, pero no entra en
     el descuento por cierre del día. */
  sesionId?: ID;
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
  /* Quién comisiona los cobros de esta cuota, si no es el closer de la
     venta: el que la heredó cuando el suyo se fue ("lo que hacemos es
     pasarle las cuotas a otro closer", Yari 29/09). */
  closerId?: ID;
}

/* El archivo que prueba un pago: foto de la transferencia, PDF del recibo.
   Vive en el bucket privado `comprobantes` de Supabase; acá sólo la ruta.
   Sin nube (modo local) la ruta es el archivo mismo como data URL. */
export interface Comprobante {
  ruta: string;
  nombre: string;
  tipo: string;
  tamanio: number;
  subidoEn: string;
}

/* "Característica de pago" y "Ventas Nuevas vs Cuotas" de la planilla. */
export type TipoVentaPago = "Venta Nueva" | "Cuota" | "Solo Reserva";

/* El control cruzado de un cobro: quién lo mira y qué dice (lib/control-cobros.ts). */
export type CasilleroChequeo = "director" | "finanzas";
export type VeredictoChequeo = "chequeado" | "rechazado";

/* Un cobro: una fila de la hoja "Ventas" de la planilla de Angelo. "Fecha
   del pago", "Cuenta recaudadora" (el procesador), "Monto abonado USD" y
   "Costo total de procesamiento" (feeMonto) son los campos de siempre. */
export interface Pago {
  id: ID;
  cuotaId: ID;
  procesadorId?: ID;         // Cuenta recaudadora
  /* Si el pago salió de conciliar un cobro de pasarela */
  movimientoId?: ID;
  /* Obligatorio si el pago NO se concilió: es la única prueba de que entró. */
  comprobante?: Comprobante;
  monto: number;             // Monto abonado USD
  moneda: Moneda;
  feeRate: number;
  feeMonto: number;          // Costo total de procesamiento
  fecha: string;             // Fecha del pago
  referencia?: string;
  notas?: string;
  creadoEn: string;
  /* Reserva, Cuota #1…#6, Paid in full, Pago completado o Reembolso. */
  caracteristica?: string;
  tipoVenta?: TipoVentaPago;
  /* Si se pagó en pesos: el tipo de cambio y lo que entró en ARS. */
  tipoCambio?: number;
  montoArs?: number;
  pagador?: string;          // Nombre de quien transfirió
  cuit?: string;             // Cuit (Si pagó a financiera)
  /* El CBU/CVU desde el que transfirió el cliente. Ya no se pide (Angelo,
     02/10: la Financiera encuentra la transferencia con el nombre y el CUIT);
     sólo lo tienen los cobros cargados antes. */
  cvu?: string;
  /* El tipo de cambio que propuso la app cuando se cargó el cobro (el promedio
     del blue venta y el cripto venta) y de dónde salió ("Promedio blue … y
     cripto … · DolarHoy …"). Si el closer lo cambió, acá queda el original para
     compararlo. Antes era el blue venta solo. */
  tipoCambioBlue?: number;
  tipoCambioFuente?: string;
  /* El sí/no de antes: «Pasado Financiera / Chequeado en plataforma» de la
     planilla, y lo que tilda solo un cobro conciliado con la pasarela. Sigue
     valiendo (lo marcado no se pierde) pero ya no lo pone el closer al cargar:
     el control de ahora son los dos casilleros de abajo. Ver lib/control-cobros.ts. */
  chequeado?: boolean;
  /* Control cruzado (reunión del 02/10): el closer carga el cobro y después otra
     persona mira el comprobante y confirma que coincide con lo cargado. Hay dos
     casilleros separados, el del director comercial y el de finanzas, y con uno
     alcanza para que el cobro no quede pendiente. Cada uno guarda quién lo hizo
     (el correo de su sesión), cuándo y, si lo rechazó, por qué. Los completa la
     base y el closer no los toca: supabase/control-cruzado.sql. */
  chequeoDirector?: VeredictoChequeo;
  chequeoDirectorPor?: string;
  chequeoDirectorEn?: string;
  chequeoDirectorNota?: string;
  chequeoFinanzas?: VeredictoChequeo;
  chequeoFinanzasPor?: string;
  chequeoFinanzasEn?: string;
  chequeoFinanzasNota?: string;
  /* Quién cargó el cobro (el correo de su sesión: lo completa la base). */
  cargadoPor?: string;
  /* El "Comprobante" de la planilla: un link o lo que se escribió. Los
     cobros nuevos suben el archivo (comprobante). */
  comprobanteLink?: string;
  /* La comisión del procesador la puso alguien a mano en Finanzas: no se
     recalcula con la tasa de la cuenta. */
  feeManual?: boolean;
}

/* "retiro": plata que el dueño saca de la caja (el retiro de fin de año).
   No es un gasto del negocio: no resta del profit, sí de la caja. */
export type GrupoGasto = "directo" | "operativo" | "dueno" | "retiro";

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

/* ==================================================================
   Honorarios del equipo: lo que cobra cada persona y la liquidación de
   cada mes. Viven en `honorarios` y `liquidaciones`, dos tablas que sólo
   leen y escriben los dueños (RLS con es_dueno()): el resto del equipo
   no las ve ni pidiéndolas por la API.
   ================================================================== */

/* Cómo se arma una parte de lo que cobra alguien. */
export type TipoConcepto =
  | "fijo"        // un monto por mes: sueldo, abono, honorario
  | "bono"        // un monto que se decide al liquidar: se ganó o no
  | "porcentaje"  // un % de algo que se mide
  | "tramo"       // un monto por cada X de algo que se mide
  | "unidad";     // una tarifa por pieza; cuántas, se carga al liquidar

/* Sobre qué se mide un variable. */
export type BaseMedicion =
  | "cash"             // Cash collected: todo lo que entró
  | "cash-neto"        // Cash collected post pasarelas: menos la comisión del procesador
  | "facturado"        // El valor total de las ventas cerradas en el mes
  | "profit"           // El resultado operativo sobre lo cobrado
  | "ventas"           // Cuántas ventas se cerraron
  | "llamadas"         // Llamadas agendadas (Agenda)
  | "llamadas-hechas"  // Llamadas que se hicieron
  | "manual";          // Una cantidad que se carga al liquidar

/* De qué ventas sale lo medido, cuando sale de las ventas. */
export type AlcanceVentas = "todas" | "closer" | "setter" | "director";

export interface ConceptoPago {
  id: ID;
  tipo: TipoConcepto;
  nombre: string;
  moneda: Moneda;
  /* fijo, bono y tramo: el monto. unidad: la tarifa por pieza. */
  monto?: number;
  /* porcentaje: fracción, 0.15 = 15%. */
  tasa?: number;
  /* porcentaje y tramo: qué se mide. */
  base?: BaseMedicion;
  /* tramo: cada cuánto de la base se paga el monto (100.000 USD, 15 llamadas). */
  cada?: number;
  /* Cuando la base sale de las ventas: de cuáles. */
  alcance?: AlcanceVentas;
  /* Sólo las ventas de estos servicios (Hackear AI). Vacío: todos. En la
     comisión de las ventas que alguien cerró, agendó o dirige, la que
     nombra servicios vale para ésos EN VEZ de la general, no además. */
  productoIds?: ID[];
  /* Sin las ventas que cerró alguien que no comisiona (Yari). */
  sinVentasSinComision?: boolean;
  /* Sin las ventas marcadas "Excluida de marketing". En el profit se
     descuenta la parte de esas ventas, como el reparto de Finanzas. */
  sinExcluidasMarketing?: boolean;
  /* llamadas: sólo las que llegaron con este utm_source ("Resell"). */
  utmSource?: string;
  /* unidad: cómo se llama la pieza, en singular ("reel complejo"). */
  unidad?: string;
  /* bono: qué tiene que pasar para ganarlo. Se lee al liquidar. */
  condicion?: string;
  /* Vigencia, YYYY-MM-DD. Un fijo que empieza o termina a mitad de mes
     se prorratea por días; un variable mide sólo esos días. */
  desde?: string;
  hasta?: string;
  notas?: string;
}

/* Lo que cobra una persona: uno por persona, id `hon_<miembroId>`. */
export interface EsquemaPago {
  id: ID;
  miembroId: ID;
  conceptos: ConceptoPago[];
  /* En qué renglón de Finanzas cae lo que se le paga (una categoría de gasto). */
  categoriaGasto: string;
  /* Lo que todavía no se sabe ("consultar con Yari"): la liquidación lo avisa. */
  pendiente?: string;
  notas?: string;
  actualizadoEn: string;
  actualizadoPor?: string;
}

export type EstadoLiquidacion = "abierta" | "cerrada";

/* Lo que se carga a mano al liquidar, por persona y concepto
   (clave `miembroId:conceptoId`). */
export interface EntradaLiquidacion {
  /* unidad: cuántas piezas. porcentaje y tramo: lo medido, corregido a mano. */
  cantidad?: number;
  /* bono: si lo ganó. Sin dato, lo ganó. */
  cumplido?: boolean;
  /* El monto del renglón corregido a mano: pisa la cuenta. */
  monto?: number;
  nota?: string;
}

/* Un monto que no sale de ningún concepto: un adelanto, un reintegro,
   una diferencia del mes anterior. Negativo, descuenta.

   Vive en la liquidación del mes al que corresponde (`liquidaciones.extras`,
   jsonb): se puede cargar mirando otro mes, y queda ahí esperando a que se
   abra esa liquidación. */
export interface ExtraLiquidacion {
  id: ID;
  miembroId: ID;
  concepto: string;
  monto: number;
  moneda: Moneda;
  /* Una nota para quien ejecuta el pago: "cobró US$ 500 en su cuenta
     personal: descontárselos". Sale en la persona, en «Copiar para
     mandarle» y en el resumen al cerrar. */
  nota?: string;
  /* Cuándo y quién lo cargó. */
  creadoEn?: string;
  creadoPor?: string;
  /* Si se cargó mirando la liquidación de otro mes: cuál ("2026-09"). */
  desdePeriodo?: string;
}

/* ---------- Cómo se llegó al monto de un renglón ----------
   Al calcular cada renglón, el motor (lib/honorarios.ts) deja escrita la
   cuenta con los números del mes. Al cerrar la liquidación queda en la foto
   (`resultado`), así un mes cerrado muestra lo que se calculó entonces y no
   lo que daría hoy. */

/* Un paso de la cuenta, de arriba hacia abajo: "base" arranca, "mas" y
   "menos" suman y restan, "por" multiplica, "tramos" divide en tramos
   completos y "igual" es un subtotal que lo anterior tiene que dar. */
export interface PasoDesglose {
  op: "base" | "mas" | "menos" | "por" | "tramos" | "igual";
  texto: string;
  valor: number;
  /* Cómo se escribe el valor: plata (en `moneda`), una cantidad, un % (el
     valor es la fracción: 0.05) o una fracción de `de` (15 días de 30). */
  formato: "plata" | "cantidad" | "tasa" | "fraccion";
  moneda?: Moneda;
  de?: number;
  /* Una aclaración corta. */
  nota?: string;
}

/* Un cobro o una venta de los que entraron en lo medido. */
export interface ItemDesglose {
  fecha: string;
  cliente: string;
  servicio?: string;
  /* Cobros: la cuenta por la que entró (Stripe, Hotmart…). */
  procesador?: string;
  /* Lo cobrado, o el precio de la venta. */
  monto: number;
  /* Cobros: lo que se quedó el procesador y lo que quedó neto. */
  fee?: number;
  neto?: number;
}

/* La lista corta: los más grandes, y cuántos faltan ver y cuánto suman. */
export interface ListaDesglose {
  tipo: "cobros" | "ventas";
  titulo: string;
  /* La moneda de los montos de la lista: la del negocio. */
  moneda: Moneda;
  /* Cuántos entraron en total (los de `items` más los de `resto`). */
  total: number;
  items: ItemDesglose[];
  resto?: { cantidad: number; monto: number; fee?: number; neto?: number };
}

export interface DesgloseLinea {
  /* La regla, dicha en castellano: "5% del cash collected post pasarelas de las ventas que dirige". */
  regla: string;
  /* La cuenta, paso a paso: el último "igual" es el monto del renglón. */
  pasos: PasoDesglose[];
  moneda: Moneda;
  lista?: ListaDesglose;
  /* Lo que conviene saber: se cargó a mano, se prorrateó, no hay profit. */
  avisos?: string[];
  /* Si se corrigió a mano: lo que daba la cuenta. El monto del renglón es el corregido. */
  correccion?: { cuentaDaba: number; nota?: string };
}

export interface LineaLiquidada {
  /* conceptoId, o `extra:<id>` */
  clave: string;
  conceptoId?: ID;
  extraId?: ID;
  tipo: TipoConcepto | "extra" | "descuento";
  nombre: string;
  /* Cómo se llegó al monto, dicho en castellano. */
  detalle: string;
  moneda: Moneda;
  monto: number;
  /* El monto en la moneda base, con el tipo de cambio de la liquidación. */
  montoBase: number;
  variable: boolean;
  /* Sobre qué se midió y la pieza que se cuenta: con esto la pantalla sabe
     qué se carga en el renglón (cuántas piezas, cuántas llamadas). */
  base?: BaseMedicion;
  unidad?: string;
  /* Lo medido (cash, llamadas, piezas), si hay. */
  medido?: number;
  /* Las comisiones de closers y del director y el reparto del profit:
     Finanzas ya las calcula de las ventas, así que al cerrar no se cargan
     como gasto (se contarían dos veces). */
  enFinanzas: boolean;
  /* Lo que falta cargar para que el renglón esté completo. */
  falta?: string;
  corregido?: boolean;
  /* Cómo se llegó al monto, con los números del mes. Las liquidaciones que
     se cerraron antes de que se guardara no lo tienen. */
  desglose?: DesgloseLinea;
  /* Sólo en los montos a mano: la nota para quien paga, y quién lo cargó
     y cuándo. */
  nota?: string;
  cargado?: string;
}

export interface PersonaLiquidada {
  miembroId: ID;
  nombre: string;
  puesto?: string;
  categoriaGasto: string;
  lineas: LineaLiquidada[];
  /* Lo que se le transfiere en cada moneda. */
  aPagar: Partial<Record<Moneda, number>>;
  /* Todo junto en la moneda base: el total, y cuánto es fijo y cuánto variable. */
  total: number;
  fijo: number;
  variable: number;
  /* Lo que falta definir de su arreglo (el aviso del esquema). */
  pendiente?: string;
  /* No tiene nada cargado en lo que cobra: no se le liquida nada (salvo la
     comisión que Finanzas le calcula con su tasa, si vende). */
  sinCargar?: boolean;
  /* Ya no está en el equipo, pero Finanzas le calcula comisión por cuotas de
     ventas suyas que entraron en el mes. */
  inactivo?: boolean;
}

export interface ResultadoLiquidacion {
  personas: PersonaLiquidada[];
  total: number;
  fijo: number;
  variable: number;
  aPagar: Partial<Record<Moneda, number>>;
  tipoCambio: number;
  /* El profit del mes con esta liquidación adentro: la base de los % del profit. */
  profit: number;
  calculadoEn: string;
}

export interface PagoLiquidacion {
  pagadoEn: string;
  por?: string;
}

export interface Liquidacion {
  /* `liq_<periodo>` */
  id: ID;
  /* El mes: "2026-09". */
  periodo: string;
  estado: EstadoLiquidacion;
  entradas: Record<string, EntradaLiquidacion>;
  extras: ExtraLiquidacion[];
  /* Pesos por dólar para lo que se paga en ARS. */
  tipoCambio?: number;
  /* Al cerrar, la foto de lo que se paga: cerrada no se recalcula aunque
     después entre un cobro atrasado. */
  resultado?: ResultadoLiquidacion | null;
  /* A quién ya se le pagó, por miembroId. */
  pagos: Record<ID, PagoLiquidacion>;
  /* Los gastos que se cargaron en Finanzas al cerrar. */
  gastoIds: ID[];
  cerradaEn?: string | null;
  cerradaPor?: string | null;
  creadoEn: string;
  actualizadoEn?: string;
}
