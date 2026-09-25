import { aniosDeTexto, ETIQUETA_CANAL, respuestaA } from "./calendly";
import { evaluarAgenda, pisoDeInversion } from "./calificacion";
import { claveDeFecha } from "./agendas-webinar";
import { claveEmail } from "./contactos";
import { EVENTOS, leerUtm, NOMBRE_FUNNEL, type Funnel } from "./utm-estandar";
import type {
  Ajustes, CampoOpcionesCrm, ColorCrm, ConfigCrm, Contacto, EstadoApp, MiembroEquipo, OpcionCrm, Sesion, TablaCrm,
} from "./types";

/* ==================================================================
   El CRM de ventas: las agendas de Calendly como en el Airtable del
   equipo ("Booking Calls").

   Cada fila es UNA agenda (una llamada de venta), no una persona: si
   alguien agenda dos veces son dos filas, y la segunda dice «2da Agenda
   (auto)». Casi todas las columnas salen solas de la agenda — el nombre,
   la fecha, el closer, los UTMs y lo que contestó en el formulario — y
   el equipo carga cinco: Pre-Call, Estado de Llamada, Notas de llamada,
   Grabación y Estado Pre-Call.

   Acá está todo lo que no es pantalla: las columnas, los colores, cómo
   se arma cada fila, las vistas, los filtros y el orden.
   ================================================================== */

/* ---------- Colores: la paleta de Airtable ----------
   Los tonos 1 y 2 son los pasteles con letra oscura; 3 a 5, los fuertes
   con letra blanca (salvo el amarillo, que en Airtable lleva letra
   oscura). Los valores son los de las capturas del Airtable del equipo. */

const PALETA: Record<ColorCrm, string> = {
  azul1: "#d1e3ff", azul2: "#a3c7ff", azul3: "#2d7ff9", azul4: "#2750ae", azul5: "#1c3a7a",
  cian1: "#c4ecfe", cian2: "#77d1f3", cian3: "#18bfff", cian4: "#0b76b7", cian5: "#0a5480",
  turquesa1: "#c2f5e9", turquesa2: "#72ddc3", turquesa3: "#20d9d2", turquesa4: "#06a09b", turquesa5: "#05706c",
  verde1: "#cdf5d1", verde2: "#9be094", verde3: "#20c933", verde4: "#068a0b", verde5: "#05600a",
  amarillo1: "#fdeab6", amarillo2: "#fed769", amarillo3: "#ffba07", amarillo4: "#b87503", amarillo5: "#7d5003",
  naranja1: "#fee2d5", naranja2: "#ffb68f", naranja3: "#ff6f2c", naranja4: "#d44401", naranja5: "#ac2d01",
  rojo1: "#ffd4e0", rojo2: "#ffa7c1", rojo3: "#dd053c", rojo4: "#b11042", rojo5: "#7d0b2f",
  rosa1: "#ffdaf6", rosa2: "#f99de2", rosa3: "#ff08c2", rosa4: "#b2158b", rosa5: "#7c0f61",
  violeta1: "#ede2fe", violeta2: "#cdb0ff", violeta3: "#8b46ff", violeta4: "#6b1cb0", violeta5: "#4a137a",
  gris1: "#e6e9f1", gris2: "#cfd3dc", gris3: "#7c8391", gris4: "#42454d", gris5: "#26282d",
};

export const COLORES: ColorCrm[] = Object.keys(PALETA) as ColorCrm[];

/* `suave`: los pasteles, que en el tema oscuro se apagan sobre el fondo.
   El amarillo fuerte se queda fuerte, pero con letra oscura (como Airtable). */
export function estiloColor(color: ColorCrm | undefined): { fondo: string; texto: string; suave: boolean } {
  const c = color && PALETA[color] ? color : "gris1";
  const suave = Number(c.slice(-1)) <= 2;
  return { fondo: PALETA[c], texto: suave || c === "amarillo3" ? "#1d1f25" : "#ffffff", suave };
}

/* ---------- Las opciones de lo que carga el equipo ----------
   Las del Airtable, con sus colores. Se cambian desde el encabezado de la
   columna (Editar campo) y quedan en ajustes.crm. */

export const OPCIONES_POR_DEFECTO: Record<CampoOpcionesCrm, OpcionCrm[]> = {
  preCall: [
    { nombre: "1° Mje Enviado", color: "amarillo1" },
    { nombre: "1° Llamada", color: "amarillo2" },
    { nombre: "2° Mje Enviado", color: "amarillo3" },
    { nombre: "2° Llamada", color: "naranja4" },
    { nombre: "COMPLETAR", color: "gris4" },
  ],
  estadoLlamada: [
    { nombre: "Compra Full", color: "verde4", llamada: "hecha" },
    { nombre: "Compra Cuotas", color: "verde2", llamada: "hecha" },
    { nombre: "Reserva", color: "verde1", llamada: "hecha" },
    { nombre: "Seguimiento de Pago", color: "verde1", llamada: "hecha" },
    { nombre: "Seguimiento Nutrición", color: "amarillo2", llamada: "hecha" },
    { nombre: "Califica Downsell", color: "naranja2", llamada: "hecha" },
    { nombre: "Compra Downsell", color: "naranja4", llamada: "hecha" },
    { nombre: "Llamada Interrumpida", color: "azul2", llamada: "hecha" },
    { nombre: "Dejó de Contestar", color: "rojo2", llamada: "no-show" },
    { nombre: "Inasistió", color: "rojo2", llamada: "no-show", auto: "no-show" },
    { nombre: "Lead descartado", color: "rojo3" },
    { nombre: "NO Calificado", color: "naranja5", llamada: "hecha" },
    { nombre: "Devolución", color: "rojo4" },
    { nombre: "2da Agenda (auto)", color: "gris1", auto: "segunda" },
    { nombre: "Canceló (auto)", color: "gris2", auto: "cancelada" },
  ],
  estadoPreCall: [
    { nombre: "Confirmado", color: "verde4" },
    { nombre: "Reagendar", color: "amarillo3" },
    { nombre: "Sin Respuesta", color: "rojo1" },
  ],
};

export function opcionesDe(a: Ajustes, campo: CampoOpcionesCrm): OpcionCrm[] {
  const propias = a.crm?.opciones?.[campo];
  return propias && propias.length > 0 ? propias : OPCIONES_POR_DEFECTO[campo];
}

/* ---------- Las tablas ----------
   Como en el Airtable: «Booking Calls» son las llamadas de asesoramiento
   (webinar, VSL, setter) y «Agendas Resells», las de auditoría con
   alumnos. Qué tipos de evento entran en cada una se elige en la barra de
   vistas; sin elegir, la regla de siempre. */

const REGLA_TABLA: Record<string, RegExp> = {
  booking: /asesoramiento/i,
  resells: /auditor|resell/i,
};

export const TABLAS_POR_DEFECTO: TablaCrm[] = [
  { id: "booking", nombre: "Booking Calls" },
  { id: "resells", nombre: "Agendas Resells" },
];

export function tablasDe(a: Ajustes): TablaCrm[] {
  const propias = a.crm?.tablas;
  if (!propias?.length) return TABLAS_POR_DEFECTO;
  /* Las de siempre no se pierden aunque se guarde sólo una. */
  return TABLAS_POR_DEFECTO.map((t) => propias.find((p) => p.id === t.id) ?? t)
    .concat(propias.filter((p) => !TABLAS_POR_DEFECTO.some((t) => t.id === p.id)));
}

export function entraEnTabla(s: Pick<Sesion, "tipo">, t: TablaCrm): boolean {
  if (t.tipos) return t.tipos.includes(s.tipo);
  return REGLA_TABLA[t.id]?.test(s.tipo ?? "") ?? false;
}

export function conConfig(a: Ajustes, cambios: Partial<ConfigCrm>): ConfigCrm {
  return { ...(a.crm ?? {}), ...cambios };
}

/* ---------- Las columnas ---------- */

export type TipoCampo =
  | "texto" | "texto-largo" | "seleccion" | "multiple" | "url" | "fecha"
  | "email" | "telefono" | "formula";

/* agenda: se llena sola desde Calendly · equipo: la carga el equipo ·
   calculado: una fórmula sobre lo demás. */
export type OrigenCampo = "agenda" | "equipo" | "calculado";

export type ClaveCampo =
  | "nombre" | "llamada" | "closer" | "telefono" | "email"
  | "preCall" | "estadoLlamada" | "notas" | "funnel"
  | "utmSource" | "utmMedium" | "utmContent" | "grabacion"
  | "anios" | "ingles" | "lenguajes" | "inversion" | "mes" | "id" | "estadoPreCall"
  | "formacion" | "ingreso" | "instagram" | "agendo" | "tipo" | "utmCampaign" | "calificada"
  | "lanzamiento";

export interface CampoCrm {
  clave: ClaveCampo;
  titulo: string;
  tipo: TipoCampo;
  origen: OrigenCampo;
  /* De dónde sale, en castellano: va en el encabezado al pasar el mouse. */
  fuente: string;
  ancho: number;
  /* Los del equipo que se eligen de una lista. */
  opciones?: CampoOpcionesCrm;
  /* Una fórmula que se muestra como etiqueta (Funnel, Mes). */
  etiqueta?: boolean;
}

export const CAMPOS: CampoCrm[] = [
  { clave: "nombre", titulo: "Nombre Completo", tipo: "texto", origen: "agenda", ancho: 225,
    fuente: "El nombre con el que agendó en Calendly." },
  { clave: "llamada", titulo: "Fecha de llamada", tipo: "fecha", origen: "agenda", ancho: 188,
    fuente: "El día y la hora de la llamada en Calendly, en hora de Argentina." },
  { clave: "closer", titulo: "Closer", tipo: "seleccion", origen: "agenda", ancho: 170,
    fuente: "Quién la atiende: el anfitrión del evento en Calendly." },
  { clave: "telefono", titulo: "WhatsApp", tipo: "telefono", origen: "agenda", ancho: 170,
    fuente: "El número que dejó en el formulario de Calendly." },
  { clave: "email", titulo: "Email", tipo: "email", origen: "agenda", ancho: 230,
    fuente: "El email con el que agendó." },
  { clave: "preCall", titulo: "Pre-Call", tipo: "seleccion", origen: "equipo", ancho: 180, opciones: "preCall",
    fuente: "El seguimiento antes de la llamada: los mensajes y llamados para que se presente." },
  { clave: "estadoLlamada", titulo: "Estado de Llamada", tipo: "seleccion", origen: "equipo", ancho: 180, opciones: "estadoLlamada",
    fuente: "Cómo salió la llamada. «Inasistió», «Canceló (auto)» y «2da Agenda (auto)» se ponen solos hasta que alguien cargue otro. Lo que se elige acá marca la llamada como hecha o como que no vino en la Agenda." },
  { clave: "notas", titulo: "Notas de llamada", tipo: "texto-largo", origen: "equipo", ancho: 360,
    fuente: "Lo que anota el closer de la llamada." },
  { clave: "funnel", titulo: "Funnel", tipo: "formula", origen: "calculado", ancho: 180, etiqueta: true,
    fuente: "Sale del tipo de evento de Calendly y del utm_source: Webinar, VSL, Setter, Resell." },
  { clave: "utmSource", titulo: "UTM Source", tipo: "seleccion", origen: "agenda", ancho: 180,
    fuente: "El utm_source del link con el que agendó (direct si llegó sin UTMs)." },
  { clave: "utmMedium", titulo: "UTM Medium", tipo: "seleccion", origen: "agenda", ancho: 180,
    fuente: "El utm_medium: paid, organic, email, outbound o referral (en los links viejos del webinar, la fecha: 23-09)." },
  { clave: "utmCampaign", titulo: "UTM Campaign", tipo: "seleccion", origen: "agenda", ancho: 200,
    fuente: "El utm_campaign: en el estándar arranca con el funnel (webinar_20260924, vsl_organica, setter_daniel)." },
  { clave: "utmContent", titulo: "UTM Content", tipo: "seleccion", origen: "agenda", ancho: 180,
    fuente: "El utm_content: vivo, replay o seguimiento en los eventos (EnVivo o PostWebinar en los links viejos)." },
  { clave: "grabacion", titulo: "Grabación", tipo: "url", origen: "equipo", ancho: 284,
    fuente: "El link a la grabación de la llamada (Fathom)." },
  { clave: "anios", titulo: "Años de trabajo", tipo: "seleccion", origen: "agenda", ancho: 172,
    fuente: "«¿Hace cuántos años trabajás en programación?», del formulario de Calendly." },
  { clave: "ingles", titulo: "Nivel de inglés", tipo: "seleccion", origen: "agenda", ancho: 232,
    fuente: "«¿Cuál es tu nivel de inglés?», del formulario de Calendly." },
  { clave: "lenguajes", titulo: "Lenguajes", tipo: "multiple", origen: "agenda", ancho: 259,
    fuente: "«¿Con qué lenguajes y frameworks trabajás o trabajaste?», del formulario de Calendly." },
  { clave: "inversion", titulo: "Capacidad de Inversión", tipo: "seleccion", origen: "agenda", ancho: 347,
    fuente: "Lo que contestó sobre cuánto puede invertir, en el formulario de Calendly." },
  { clave: "mes", titulo: "Mes", tipo: "formula", origen: "calculado", ancho: 180, etiqueta: true,
    fuente: "El mes de la llamada." },
  { clave: "id", titulo: "Record ID", tipo: "formula", origen: "calculado", ancho: 180,
    fuente: "El id de la agenda en el ERP." },
  { clave: "estadoPreCall", titulo: "Estado Pre-Call", tipo: "seleccion", origen: "equipo", ancho: 180, opciones: "estadoPreCall",
    fuente: "Si confirmó que se presenta a la llamada." },
  /* Ocultas de entrada: se prenden en «Ocultar campos». */
  { clave: "calificada", titulo: "Agenda calificada", tipo: "formula", origen: "calculado", ancho: 170, etiqueta: true,
    fuente: "Invierte 1000 USD o más, tiene inglés conversacional y carrera (la estrellita de la Agenda)." },
  { clave: "formacion", titulo: "Formación", tipo: "multiple", origen: "agenda", ancho: 260,
    fuente: "«¿Cuál es tu nivel de formación?», del formulario de Calendly." },
  { clave: "ingreso", titulo: "Gana por mes", tipo: "seleccion", origen: "agenda", ancho: 190,
    fuente: "«¿Cuánto ganás mensualmente en dólares?», del formulario de Calendly." },
  { clave: "instagram", titulo: "Instagram", tipo: "texto", origen: "agenda", ancho: 170,
    fuente: "El usuario de Instagram que dejó en el formulario." },
  { clave: "agendo", titulo: "Agendó el", tipo: "fecha", origen: "agenda", ancho: 180,
    fuente: "Cuándo agendó en Calendly." },
  { clave: "tipo", titulo: "Tipo de llamada", tipo: "seleccion", origen: "agenda", ancho: 290,
    fuente: "El tipo de evento de Calendly." },
];

export const CAMPO: Record<string, CampoCrm> = Object.fromEntries(CAMPOS.map((c) => [c.clave, c]));

/* Lo que se ve de entrada: las columnas del Airtable, en su orden. */
export const OCULTOS_POR_DEFECTO: ClaveCampo[] = ["calificada", "formacion", "ingreso", "instagram", "agendo", "tipo"];

/* Las agendas de auditoría de los resells no hacen las preguntas de
   calificación (son alumnos): esas columnas arrancan ocultas ahí. */
export const OCULTOS_DE_TABLA: Record<string, ClaveCampo[]> = {
  resells: [...OCULTOS_POR_DEFECTO, "anios", "ingles", "lenguajes", "inversion", "utmMedium", "utmCampaign", "utmContent"],
};
export const ocultosDeTabla = (tabla: string) => OCULTOS_DE_TABLA[tabla] ?? OCULTOS_POR_DEFECTO;

/* ---------- La fila ---------- */

export interface FilaCrm {
  id: string;
  sesion: Sesion;
  tabla: string;
  /* La persona: para contar segundas agendas y abrir su ficha. */
  personaId: string;
  nombre: string;
  llamada: string;
  closer: string;
  telefono: string;
  email: string;
  preCall: string;
  estadoLlamada: string;
  /* El estado lo puso el CRM (no-show, cancelada, segunda agenda). */
  estadoAuto: boolean;
  notas: string;
  funnel: string;
  utmSource: string;
  utmMedium: string;
  utmContent: string;
  utmCampaign: string;
  grabacion: string;
  anios: string;
  ingles: string;
  lenguajes: string[];
  inversion: string;
  mes: string;
  estadoPreCall: string;
  calificada: string;
  formacion: string[];
  ingreso: string;
  instagram: string;
  agendo: string;
  tipo: string;
  /* "23-09" si vino de un webinar: arma las vistas de Lanzamientos. */
  lanzamiento: string;
}

export type ValorCampo = string | string[];

export function valorDe(f: FilaCrm, clave: ClaveCampo): ValorCampo {
  return (f as unknown as Record<string, ValorCampo>)[clave] ?? "";
}

export const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* Las respuestas con varias opciones vienen una por renglón. */
const partir = (s?: string) => (s ?? "").split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);

const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
});
const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false,
});

/* El día en Argentina, "2026-09-25": el mismo con el que se arman los períodos. */
export function diaAR(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : FORMATO_DIA.format(d);
}

/* "25/9/2026 12:00", como una fecha con hora de Airtable. */
export function fechaCrm(iso?: string | null): string {
  const dia = diaAR(iso);
  if (!dia) return "";
  const [a, m, d] = dia.split("-").map(Number);
  return `${d}/${m}/${a} ${FORMATO_HORA.format(new Date(iso!))}`;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/* "9. Septiembre": el número adelante para que ordene bien, como la
   fórmula del Airtable. */
export function mesDe(iso?: string | null): string {
  const dia = diaAR(iso);
  if (!dia) return "";
  const m = Number(dia.slice(5, 7));
  return `${m}. ${MESES[m - 1]}`;
}

/* ---------- Lanzamientos ----------
   De qué evento (webinar, clase cero, Q&A) es una agenda: "webinar_2026-09-24".
   En el estándar de UTMs (lib/utm-estandar.ts) la fecha viene entera en
   utm_campaign; en el formato viejo sólo el día y el mes (utm_medium=23-09),
   y el año sale del webinar cargado más cercano a cuando agendó. Así las
   agendas de un mismo webinar caen juntas, lleguen en el formato que
   lleguen. */
export function lanzamientoDe(
  utm: Record<string, string> | null | undefined,
  webinars: { fecha: string }[] = [],
  agendo?: string,
): string {
  const l = leerUtm(utm);
  if (!l.funnel || !EVENTOS.includes(l.funnel)) return "";
  if (l.fecha) return `${l.funnel}_${l.fecha}`;
  if (!l.diaMes) return "";
  const ref = agendo ? Date.parse(agendo) : Date.now();
  const w = webinars.filter((x) => claveDeFecha(x.fecha) === l.diaMes)
    .sort((a, b) => Math.abs(Date.parse(a.fecha) - ref) - Math.abs(Date.parse(b.fecha) - ref))[0];
  return `${l.funnel}_${w ? diaAR(w.fecha) : l.diaMes}`;
}

/* "Webinar 24-09-26", como las vistas de Lanzamientos del Airtable. */
export function nombreLanzamiento(clave: string): string {
  const [funnel, fecha] = clave.split("_");
  const nombre = NOMBRE_FUNNEL[funnel as Funnel] ?? funnel;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha ?? "");
  return `${nombre} ${m ? `${m[3]}-${m[2]}-${m[1].slice(2)}` : fecha ?? ""}`.trim();
}

/* El Funnel del Airtable: Webinar, VSL, Setter, Resell… En el estándar sale
   del prefijo de utm_campaign; en los links viejos, del utm_source y, si no
   alcanza, del tipo de evento de Calendly. */
export function funnelDe(s: Pick<Sesion, "utm" | "canal">): string {
  const l = leerUtm(s.utm);
  if (l.funnel) return l.funnel === "vsl-yt" ? "VSL" : NOMBRE_FUNNEL[l.funnel];
  const src = sinTildes(s.utm?.utm_source ?? "");
  if (/resell/.test(src)) return "Resell";
  if (/setter/.test(src) || s.canal === "setter") return "Setter";
  if (s.canal === "vsl" || /landing|vsl|youtube|^yt$/.test(src)) return "VSL";
  if (s.canal === "webinar") return "Webinar";
  if (/organic|instagram|^ig$/.test(src)) return "Orgánico";
  if (s.canal) return ETIQUETA_CANAL[s.canal];
  return src && src !== "direct" ? s.utm?.utm_source ?? "" : "";
}

const personaDe = (s: Sesion) => s.contactoId || s.leadId || claveEmail(s.email) || s.id;

/* Una agenda cancelada porque se reprogramó no es una fila: la reemplaza
   la agenda nueva, que sigue la historia. */
function reprogramada(s: Sesion, reemplazadas: Set<string>): boolean {
  return s.estado === "cancelada" && (s.motivoCancelacion === "Reprogramada" || reemplazadas.has(s.id));
}

export function estadoAutomatico(
  s: Pick<Sesion, "estado">, opciones: OpcionCrm[], segunda: boolean,
): string {
  const por = (a: NonNullable<OpcionCrm["auto"]>) => opciones.find((o) => o.auto === a)?.nombre ?? "";
  if (s.estado === "no-show") return por("no-show");
  if (s.estado === "cancelada") return por("cancelada");
  if (segunda) return por("segunda");
  return "";
}

export function filasCrm(e: Pick<EstadoApp, "sesiones" | "contactos" | "ajustes" | "webinars">): FilaCrm[] {
  const tablas = tablasDe(e.ajustes);
  const estados = opcionesDe(e.ajustes, "estadoLlamada");
  const contactos = new Map<string, Contacto>(e.contactos.map((c) => [c.id, c]));
  const reemplazadas = new Set(e.sesiones.map((s) => s.reprogramadaDe).filter((x): x is string => Boolean(x)));

  const entran: { s: Sesion; tabla: string }[] = [];
  for (const s of e.sesiones) {
    const t = tablas.find((x) => entraEnTabla(s, x));
    if (!t || reprogramada(s, reemplazadas)) continue;
    entran.push({ s, tabla: t.id });
  }

  /* La segunda agenda de la misma persona en la misma tabla. */
  const porPersona = new Map<string, Sesion[]>();
  for (const { s, tabla } of entran) {
    const k = `${tabla}|${personaDe(s)}`;
    porPersona.set(k, [...(porPersona.get(k) ?? []), s]);
  }
  const segundas = new Set<string>();
  for (const xs of porPersona.values()) {
    if (xs.length < 2) continue;
    xs.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)).slice(1).forEach((s) => segundas.add(s.id));
  }

  return entran.map(({ s, tabla }) => {
    const qa = s.respuestas ?? [];
    const c = contactos.get(s.contactoId ?? "") ?? contactos.get(s.leadId ?? "");
    const auto = s.estadoLlamada ? "" : estadoAutomatico(s, estados, segundas.has(s.id));
    const u = s.utm ?? {};
    return {
      id: s.id, sesion: s, tabla, personaId: personaDe(s),
      nombre: s.invitado?.trim() || c?.nombre || "",
      llamada: s.inicia,
      closer: s.anfitrion?.trim() ?? "",
      telefono: respuestaA(qa, /(whatsapp|telefono|celular|numero)/) ?? c?.telefono ?? "",
      email: s.email ?? c?.email ?? "",
      preCall: s.preCall ?? "",
      estadoLlamada: s.estadoLlamada || auto,
      estadoAuto: !s.estadoLlamada && Boolean(auto),
      notas: s.notas ?? "",
      funnel: funnelDe(s),
      utmSource: u.utm_source ?? "",
      utmMedium: u.utm_medium ?? "",
      utmContent: u.utm_content ?? "",
      utmCampaign: u.utm_campaign ?? "",
      grabacion: s.grabacion ?? "",
      anios: respuestaA(qa, /(anos.*program|program.*anos)/) ?? "",
      ingles: respuestaA(qa, /ingles/) ?? "",
      lenguajes: partir(respuestaA(qa, /(lenguaje|framework|tecnolog)/) ?? c?.tecnologias),
      inversion: respuestaA(qa, /(invertir|inversion|te define mejor|claridad en la llamada)/) ?? "",
      mes: mesDe(s.inicia),
      estadoPreCall: s.estadoPreCall ?? "",
      calificada: evaluarAgenda(s, c).calificada ? "Sí" : "No",
      formacion: partir(respuestaA(qa, /(formacion|estudio)/) ?? c?.formacion),
      ingreso: respuestaA(qa, /(ganas|sueldo|salario)/) ?? c?.sueldoUsd ?? "",
      instagram: respuestaA(qa, /instagram/) ?? c?.instagram ?? "",
      agendo: s.creadoEn,
      tipo: s.tipo ?? "",
      lanzamiento: lanzamientoDe(u, e.webinars, s.creadoEn),
    };
  });
}

/* ---------- El color de cada valor ----------
   Las columnas del equipo usan el color de su opción. Las que llegan de
   la agenda se pintan por lo que dicen, como en el Airtable: verde oscuro
   lo mejor, rosa lo que no alcanza. */

function colorAnios(v: string): ColorCrm {
  const n = aniosDeTexto(v);
  if (n === undefined) return /mes/.test(sinTildes(v)) ? "rojo1" : "gris1";
  if (n >= 5) return "verde4";
  if (n >= 2) return "verde2";
  if (n >= 1) return "verde1";
  return "rojo1";
}

/* El orden importa: «Conversacional aunque cometo errores y no soy super
   fluido» es conversacional (no fluido), y «Muy bueno, ningún problema» no
   puede caer en «ninguno» por decir «ningún». */
function colorIngles(v: string): ColorCrm {
  const t = sinTildes(v);
  if (/no conversacional|basico|bajo|poco|principiante/.test(t)) return "verde1";
  if (/muy bueno|nativ|bilingu|avanzado|excelente/.test(t)) return "verde4";
  if (/conversacional|intermedio/.test(t)) return "verde2";
  if (/fluido|fluent/.test(t)) return "verde4";
  if (/nada|cero|\b0\b|ningun/.test(t)) return "rojo1";
  return "gris1";
}

/* 690 es lo mínimo que sale el programa ("parte desde los $690"). */
function colorInversion(v: string): ColorCrm {
  const p = pisoDeInversion(v);
  if (p === undefined) return "gris1";
  if (p >= 2000) return "verde4";
  if (p >= 690) return "verde2";
  if (p > 0) return "verde1";
  return "rojo1";
}

function colorFormacion(v: string): ColorCrm {
  const t = sinTildes(v);
  if (/universitaria completa|universitario completo|posgrado|master|ingenier/.test(t)) return "verde2";
  if (/universitari|terciari|tecnicatura|tecnico/.test(t)) return "verde1";
  return "gris1";
}

const COLOR_FUNNEL: Record<string, ColorCrm> = {
  Webinar: "cian1", VSL: "violeta1", Setter: "amarillo1", Resell: "verde1", "Orgánico": "turquesa1", Otro: "gris1",
  "Clase cero": "turquesa1", "Q&A": "rosa1", Referido: "naranja1",
};

/* Los closers, cada uno con su color: el mismo en la columna y en el
   puntito de sus vistas. Por orden alfabético, así no cambia de un día
   para el otro (Dante amarillo y Valentín rojo, como en el Airtable).

   Tiene sección en la barra de vistas quien está en el equipo o atiende
   seguido: un anfitrión de prueba con una agenda suelta no la llena (sus
   agendas siguen en Todas) ni le corre el color a los demás. */
const COLORES_CLOSER = ["amarillo", "azul", "rojo", "verde", "violeta", "naranja", "cian", "rosa", "turquesa"] as const;
type ColorCloser = (typeof COLORES_CLOSER)[number];

const nombreCorto = (n: string) => sinTildes(n).split(/\s+/).slice(0, 2).join(" ");

export function closersConSeccion(filas: FilaCrm[], equipo: Pick<MiembroEquipo, "nombre">[]): string[] {
  const delEquipo = equipo.map((m) => nombreCorto(m.nombre));
  const cuantas = new Map<string, number>();
  for (const f of filas) if (f.closer) cuantas.set(f.closer, (cuantas.get(f.closer) ?? 0) + 1);
  return [...cuantas.keys()]
    .filter((c) => {
      const n = nombreCorto(c);
      return (cuantas.get(c) ?? 0) >= 3 || delEquipo.some((m) => m === n || (m.includes(" ") && n.startsWith(m)));
    })
    .sort((a, b) => sinTildes(a).localeCompare(sinTildes(b)));
}

export function coloresDeCloser(filas: FilaCrm[], equipo: Pick<MiembroEquipo, "nombre">[]): Map<string, ColorCloser> {
  const primeros = closersConSeccion(filas, equipo);
  const resto = [...new Set(filas.map((f) => f.closer).filter((c) => c && !primeros.includes(c)))]
    .sort((a, b) => sinTildes(a).localeCompare(sinTildes(b)));
  return new Map([...primeros, ...resto].map((n, i) => [n, COLORES_CLOSER[i % COLORES_CLOSER.length]]));
}

export interface Pintor {
  (clave: ClaveCampo, valor: string): ColorCrm;
}

export function pintor(a: Ajustes, filas: FilaCrm[], equipo: Pick<MiembroEquipo, "nombre">[] = []): Pintor {
  const opciones = {
    preCall: new Map(opcionesDe(a, "preCall").map((o) => [o.nombre, o.color])),
    estadoLlamada: new Map(opcionesDe(a, "estadoLlamada").map((o) => [o.nombre, o.color])),
    estadoPreCall: new Map(opcionesDe(a, "estadoPreCall").map((o) => [o.nombre, o.color])),
  };
  const closers = coloresDeCloser(filas, equipo);
  return (clave, valor) => {
    switch (clave) {
      case "preCall": case "estadoLlamada": case "estadoPreCall":
        return opciones[clave].get(valor) ?? "gris1";
      case "anios": return colorAnios(valor);
      case "ingles": return colorIngles(valor);
      case "inversion": return colorInversion(valor);
      case "formacion": return colorFormacion(valor);
      case "funnel": return COLOR_FUNNEL[valor] ?? "gris1";
      case "closer": return `${closers.get(valor) ?? "gris"}1` as ColorCrm;
      case "calificada": return valor === "Sí" ? "verde4" : "gris1";
      case "tipo": return "violeta1";
      case "ingreso": return "cian1";
      default: return "azul1";
    }
  };
}

/* ---------- Filtros ---------- */

export type Periodo =
  | "hoy" | "ayer" | "manana" | "semana" | "semana-pasada" | "mes" | "mes-pasado"
  | "proximos-7" | "ultimos-7" | "pasado" | "proximo";

export const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: "hoy", texto: "hoy" },
  { valor: "ayer", texto: "ayer" },
  { valor: "manana", texto: "mañana" },
  { valor: "semana", texto: "esta semana" },
  { valor: "semana-pasada", texto: "la semana pasada" },
  { valor: "mes", texto: "este mes" },
  { valor: "mes-pasado", texto: "el mes pasado" },
  { valor: "proximos-7", texto: "los próximos 7 días" },
  { valor: "ultimos-7", texto: "los últimos 7 días" },
  { valor: "proximo", texto: "desde ahora" },
  { valor: "pasado", texto: "antes de ahora" },
];

export type Operador =
  | "contiene" | "no-contiene" | "es" | "no-es"
  | "alguno" | "ninguno" | "todos"
  | "vacio" | "no-vacio" | "periodo";

export interface Condicion {
  id: string;
  campo: ClaveCampo;
  op: Operador;
  valor?: string | string[];
}

/* Cómo se filtra un campo: las fórmulas que se ven como etiqueta (Funnel,
   Mes, Agenda calificada) se eligen de una lista, como un select. */
export function tipoDeFiltro(c: CampoCrm | undefined): TipoCampo {
  if (!c) return "texto";
  return c.tipo === "formula" && c.etiqueta ? "seleccion" : c.tipo;
}

export function operadoresDe(tipo: TipoCampo | "lanzamiento"): { valor: Operador; texto: string }[] {
  const vacios = [{ valor: "vacio" as const, texto: "está vacío" }, { valor: "no-vacio" as const, texto: "no está vacío" }];
  if (tipo === "fecha") return [{ valor: "periodo", texto: "es" }, ...vacios];
  if (tipo === "seleccion" || tipo === "lanzamiento") {
    return [{ valor: "alguno", texto: "es cualquiera de" }, { valor: "ninguno", texto: "no es ninguno de" }, ...vacios];
  }
  if (tipo === "multiple") {
    return [{ valor: "alguno", texto: "tiene alguno de" }, { valor: "todos", texto: "tiene todos" }, { valor: "ninguno", texto: "no tiene ninguno de" }, ...vacios];
  }
  return [
    { valor: "contiene", texto: "contiene" }, { valor: "no-contiene", texto: "no contiene" },
    { valor: "es", texto: "es" }, { valor: "no-es", texto: "no es" }, ...vacios,
  ];
}

const DIA_MS = 86_400_000;
const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const lunesDe = (dia: string) => sumarDias(dia, -((new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7));

export function enPeriodo(iso: string, p: Periodo, ahora = Date.now()): boolean {
  const dia = diaAR(iso);
  if (!dia) return false;
  const hoy = diaAR(new Date(ahora).toISOString());
  switch (p) {
    case "hoy": return dia === hoy;
    case "ayer": return dia === sumarDias(hoy, -1);
    case "manana": return dia === sumarDias(hoy, 1);
    case "semana": { const l = lunesDe(hoy); return dia >= l && dia <= sumarDias(l, 6); }
    case "semana-pasada": { const l = sumarDias(lunesDe(hoy), -7); return dia >= l && dia <= sumarDias(l, 6); }
    case "mes": return dia.slice(0, 7) === hoy.slice(0, 7);
    case "mes-pasado": return dia.slice(0, 7) === sumarDias(`${hoy.slice(0, 7)}-01`, -1).slice(0, 7);
    case "proximos-7": return dia >= hoy && dia <= sumarDias(hoy, 6);
    case "ultimos-7": return dia <= hoy && dia >= sumarDias(hoy, -6);
    /* La llamada que está empezando sigue en «desde ahora» una hora. */
    case "proximo": return Date.parse(iso) >= ahora - 3_600_000;
    case "pasado": return Date.parse(iso) < ahora;
  }
}

const lista = (v: ValorCampo | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const vacio = (v: ValorCampo) => (Array.isArray(v) ? v.length === 0 : !v);

export function cumple(f: FilaCrm, c: Condicion, ahora = Date.now()): boolean {
  const v = valorDe(f, c.campo);
  const buscado = lista(c.valor).map(sinTildes);
  const valores = lista(v).map(sinTildes);
  switch (c.op) {
    case "vacio": return vacio(v);
    case "no-vacio": return !vacio(v);
    case "contiene": return !buscado[0] || valores.join(" ").includes(buscado[0]);
    case "no-contiene": return !buscado[0] || !valores.join(" ").includes(buscado[0]);
    case "es": return !buscado[0] || valores.includes(buscado[0]);
    case "no-es": return !buscado[0] || !valores.includes(buscado[0]);
    case "alguno": return buscado.length === 0 || buscado.some((b) => valores.includes(b));
    case "ninguno": return !buscado.some((b) => valores.includes(b));
    case "todos": return buscado.every((b) => valores.includes(b));
    case "periodo": return !c.valor || enPeriodo(String(v), c.valor as Periodo, ahora);
  }
}

/* Una condición a medio armar (sin valor) no filtra: así no se vacía la
   grilla mientras se elige. */
export function completa(c: Condicion): boolean {
  if (c.op === "vacio" || c.op === "no-vacio") return true;
  return lista(c.valor).some((x) => x.trim() !== "");
}

export function pasa(f: FilaCrm, filtros: Condicion[], conjuncion: "y" | "o", ahora = Date.now()): boolean {
  const activas = filtros.filter(completa);
  if (activas.length === 0) return true;
  return conjuncion === "o" ? activas.some((c) => cumple(f, c, ahora)) : activas.every((c) => cumple(f, c, ahora));
}

/* Lo que busca la lupa: en cualquier columna que se vea. */
export function coincideBusqueda(f: FilaCrm, texto: string, claves: ClaveCampo[]): boolean {
  const t = sinTildes(texto.trim());
  if (!t) return true;
  return claves.some((k) => {
    const v = valorDe(f, k);
    const s = k === "llamada" || k === "agendo" ? fechaCrm(String(v)) : lista(v).join(" ");
    return sinTildes(s).includes(t);
  });
}

/* ---------- Orden ---------- */

export interface Orden { campo: ClaveCampo; desc: boolean }

export function ordenar(filas: FilaCrm[], orden: Orden[], a: Ajustes): FilaCrm[] {
  if (orden.length === 0) return filas;
  const posicion = (campo: CampoOpcionesCrm) => new Map(opcionesDe(a, campo).map((o, i) => [o.nombre, i]));
  const pos = { preCall: posicion("preCall"), estadoLlamada: posicion("estadoLlamada"), estadoPreCall: posicion("estadoPreCall") };
  return [...filas].sort((x, y) => {
    for (const o of orden) {
      const vx = valorDe(x, o.campo), vy = valorDe(y, o.campo);
      const ex = vacio(vx), ey = vacio(vy);
      /* Lo vacío va siempre al final, se ordene para donde se ordene. */
      if (ex !== ey) return ex ? 1 : -1;
      if (ex) continue;
      let cmp: number;
      const opciones = CAMPO[o.campo]?.opciones;
      if (opciones) {
        const p = pos[opciones];
        cmp = (p.get(String(vx)) ?? 999) - (p.get(String(vy)) ?? 999);
      } else if (o.campo === "mes") {
        cmp = parseInt(String(vx), 10) - parseInt(String(vy), 10);
      } else {
        cmp = lista(vx).join(", ").localeCompare(lista(vy).join(", "), "es", { sensitivity: "base", numeric: true });
      }
      if (cmp !== 0) return o.desc ? -cmp : cmp;
    }
    return 0;
  });
}

/* ---------- Vistas ----------
   Las de la barra del Airtable, armadas con los datos: Todas; cada closer
   con Ayer, Hoy, Semana, Mes y Todas; el setter; y un Lanzamiento por
   webinar. Cada persona puede además crear las suyas. */

export interface VistaCrm {
  id: string;
  nombre: string;
  filtros: Condicion[];
  conjuncion: "y" | "o";
  orden: Orden[];
  ocultos: ClaveCampo[];
  /* El puntito o cuadradito de color que va antes del nombre. */
  marca?: { color: string; forma: "punto" | "cuadrado" };
  /* De quién es («Hoy» de qué closer): va al lado del nombre en la barra. */
  de?: string;
  /* Creada por la persona: se renombra y se borra. */
  propia?: boolean;
}

export interface SeccionVistas {
  id: string;
  titulo?: string;
  marca?: { color: string; forma: "punto" | "cuadrado" };
  vistas: VistaCrm[];
}

const slug = (s: string) => sinTildes(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let nCond = 0;
export const nuevaCondicion = (c: Omit<Condicion, "id">): Condicion => ({ ...c, id: `c${Date.now().toString(36)}${(nCond++).toString(36)}` });

type CondicionSinId = Omit<Condicion, "id">;

/* Las condiciones de una vista armada llevan ids fijos: la vista se vuelve
   a armar con cada agenda nueva, y el filtro abierto no puede perderlas. */
const vistaBase = (
  v: Omit<VistaCrm, "conjuncion" | "ocultos" | "orden" | "filtros"> & Partial<Omit<VistaCrm, "filtros">> & { filtros: CondicionSinId[] },
): VistaCrm => ({
  conjuncion: "y", ocultos: OCULTOS_POR_DEFECTO, orden: [{ campo: "agendo", desc: true }], ...v,
  filtros: v.filtros.map((c, i) => ({ ...c, id: `${v.id}:${i}` })),
});

/* El color fuerte de cada nombre de la paleta, para los puntitos. */
export const colorMarca = (nombre: string) => PALETA[`${nombre}3` as ColorCrm] ?? PALETA.gris3;

export function vistasDe(
  filas: FilaCrm[],
  e: Pick<EstadoApp, "equipo" | "webinars" | "ajustes">,
  tabla = "booking",
): SeccionVistas[] {
  const ocultos = ocultosDeTabla(tabla);
  const vista = (v: Parameters<typeof vistaBase>[0]) => vistaBase({ ocultos, ...v });
  const secciones: SeccionVistas[] = [
    { id: "general", vistas: [vista({ id: "todas", nombre: "Todas", marca: { color: PALETA.azul3, forma: "punto" }, filtros: [] })] },
  ];

  /* Un closer por sección, con su color. Los períodos van por el día de la
     llamada, en orden de la primera a la última. Tiene sección quien está en
     el equipo o atiende seguido: un anfitrión de prueba con una agenda suelta
     no llena la barra (sus agendas siguen en Todas). */
  const colores = coloresDeCloser(filas, e.equipo);
  for (const closer of closersConSeccion(filas, e.equipo)) {
    const color = colores.get(closer) ?? "gris";
    const marca = { color: colorMarca(color), forma: "punto" as const };
    const base: CondicionSinId[] = [{ campo: "closer", op: "alguno", valor: [closer] }];
    const porDia = (id: string, nombre: string, periodo: Periodo) => vista({
      id: `closer-${slug(closer)}-${id}`, nombre, marca, de: closer,
      filtros: [...base, { campo: "llamada", op: "periodo", valor: periodo }],
      orden: [{ campo: "llamada", desc: false }],
    });
    secciones.push({
      id: `closer-${slug(closer)}`, titulo: closer, marca,
      vistas: [
        porDia("ayer", "Ayer", "ayer"),
        porDia("hoy", "Hoy", "hoy"),
        porDia("semana", "Semana", "semana"),
        porDia("mes", "Mes", "mes"),
        vista({ id: `closer-${slug(closer)}-todas`, nombre: "Todas", marca, de: closer, filtros: base, orden: [{ campo: "llamada", desc: true }] }),
      ],
    });
  }

  /* El setter: lo que agendó él y lo que tiene que perseguir. */
  const estadosPre = opcionesDe(e.ajustes, "estadoPreCall");
  const estados = opcionesDe(e.ajustes, "estadoLlamada");
  const opcion = (xs: OpcionCrm[], patron: RegExp) => xs.find((o) => patron.test(sinTildes(o.nombre)))?.nombre;
  const sinRespuesta = opcion(estadosPre, /sin respuesta/);
  const reagendar = opcion(estadosPre, /reagendar/);
  const inasistio = estados.find((o) => o.auto === "no-show")?.nombre;
  for (const m of e.equipo.filter((x) => x.rol === "setter" && x.activo)) {
    const pila = m.nombre.split(/\s+/)[0];
    const marca = { color: PALETA.amarillo3, forma: "cuadrado" as const };
    const id = `setter-${slug(m.nombre)}`;
    const de = `Setter ${pila}`;
    const vistas = [
      vista({ id: `${id}-agendas`, nombre: "Agendas Setter", marca, de, filtros: [{ campo: "funnel", op: "alguno", valor: ["Setter"] }] }),
    ];
    if (sinRespuesta) vistas.push(vista({ id: `${id}-sin-respuesta`, nombre: "Sin Respuesta", marca, de, filtros: [{ campo: "estadoPreCall", op: "alguno", valor: [sinRespuesta] }], orden: [{ campo: "llamada", desc: false }] }));
    if (reagendar) vistas.push(vista({ id: `${id}-reagendar`, nombre: "Reagendar", marca, de, filtros: [{ campo: "estadoPreCall", op: "alguno", valor: [reagendar] }], orden: [{ campo: "llamada", desc: false }] }));
    if (inasistio) vistas.push(vista({ id: `${id}-no-asistio`, nombre: "No asistió", marca, de, filtros: [{ campo: "estadoLlamada", op: "alguno", valor: [inasistio] }], orden: [{ campo: "llamada", desc: true }] }));
    secciones.push({ id, titulo: de, marca, vistas });
  }

  /* Un lanzamiento por evento (webinar, clase cero, Q&A) que trajo
     agendas, el último primero. Los que sólo tienen día y mes (links
     viejos de un webinar que no está cargado) van al final. */
  const fechaDe = (k: string) => k.split("_")[1] ?? "";
  const lanzamientos = [...new Set(filas.map((f) => f.lanzamiento).filter(Boolean))]
    .sort((a, b) => {
      const fa = fechaDe(a), fb = fechaDe(b);
      const la = fa.length === 10, lb = fb.length === 10;
      if (la !== lb) return la ? -1 : 1;
      return fb.localeCompare(fa) || a.localeCompare(b);
    });
  if (lanzamientos.length > 0) {
    secciones.push({
      id: "lanzamientos", titulo: "Lanzamientos",
      vistas: lanzamientos.map((clave) => vista({
        id: `lanz-${clave}`,
        nombre: nombreLanzamiento(clave),
        filtros: [{ campo: "lanzamiento", op: "alguno", valor: [clave] }],
      })),
    });
  }
  return secciones;
}

/* El texto de un valor para copiar o para el aviso de guardado. */
export function textoDe(f: FilaCrm, clave: ClaveCampo): string {
  const v = valorDe(f, clave);
  if (clave === "llamada" || clave === "agendo") return fechaCrm(String(v));
  return lista(v).join(", ");
}

/* Todos los valores distintos de una columna, para elegir en un filtro. */
export function valoresDe(filas: FilaCrm[], clave: ClaveCampo): string[] {
  const vistos = new Set<string>();
  for (const f of filas) for (const x of lista(valorDe(f, clave))) if (x) vistos.add(x);
  return [...vistos].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
}
