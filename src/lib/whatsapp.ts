import { esCuentaDeCloser, nivelEn, type MiAcceso } from "./permisos";
import { claveInternacional, clavesDeTelefono, digitosDe, numeroParaWhatsapp } from "./telefonos-wpp";

/* ==================================================================
   WhatsApp de lectura: quién se unió al grupo de cada webinar.

   Un servicio aparte (servicios/whatsapp-lector/), prendido en un servidor
   con un número dedicado conectado por QR, LEE los grupos y le avisa a la
   app. Nunca manda un mensaje ni marca nada como leído. Acá vive todo lo
   que no depende de la red ni de React, así lo usan las rutas de /api, la
   pantalla y las pruebas:

   - Qué le puede llegar a la app (validar el cuerpo, normalizar teléfonos).
   - Cómo se actualizan los miembros de un grupo con una foto (la lista
     completa) o con un aviso (entró / salió), sin pisar lo más nuevo.
   - Si el lector está vivo, y cuándo hay que avisarle al equipo.
   - Qué grupo es de qué webinar (por la fecha que trae su nombre).
   - Quién de las personas de un webinar está en el grupo.
   ================================================================== */

/* ---------- Lo que se guarda ---------- */

/** Cómo está el lector con WhatsApp:
    - conectado: mirando los grupos;
    - esperando_qr: hay que vincular el número, y espera que escaneen el código;
    - reconectando: se cortó o está arrancando, y vuelve a conectarse solo;
    - cerrado: WhatsApp cerró la sesión y no pudo empezar otra (hay que mirar el servidor). */
export type EstadoConexion = "conectado" | "esperando_qr" | "reconectando" | "cerrado";
export const ESTADOS_DE_CONEXION: readonly EstadoConexion[] = ["conectado", "esperando_qr", "reconectando", "cerrado"];

export interface LatidoLector {
  /** Cuándo llegó el último latido, según el servidor de la app. */
  ultimoLatido: string;
  /** La hora que dijo el lector. */
  enLector?: string | null;
  /** ¿Está conectado a WhatsApp? Puede estar vivo y desconectado (se cerró la sesión). */
  conectado: boolean;
  /** Cómo está con WhatsApp. Un lector de antes no lo manda: se deduce de `conectado`. */
  estado?: EstadoConexion | null;
  /** Cuántos grupos vigila. */
  grupos: number;
  /** La última vez que dijo estar conectado. */
  ultimaConexion?: string | null;
  /** El primer latido que se recibió. */
  desde?: string | null;
}

export interface GrupoWhatsapp {
  /** El id de WhatsApp: 1203…@g.us */
  id: string;
  nombre: string;
  /** A qué webinar corresponde (varios grupos pueden ser del mismo). */
  webinarId: string | null;
  /** Cuántos tienen teléfono y están adentro. */
  miembros: number;
  /** Cuántos más hay que WhatsApp no deja ver por teléfono. */
  sinTelefono: number;
  ultimaFoto: string | null;
  creadoEn?: string;
}

export interface MiembroWhatsapp {
  grupoId: string;
  /** La clave del teléfono (lib/telefonos.ts). */
  telefono: string;
  dentro: boolean;
  /** Cuándo lo vimos entrar. Vacío si ya estaba cuando empezamos a mirar. */
  entro: string | null;
  salio: string | null;
  creadoEn?: string;
}

/* ---------- Cada cuánto, y cuándo se avisa ---------- */

/** El lector manda un latido cada tanto: acá van los minutos. */
export const LATIDO_CADA_MIN = 2;
/** Pasados tres latidos perdidos se muestra «sin señal» (todavía no es alarma). */
export const SIN_SENAL_DESDE_MIN = 6;
/** Pasado esto sin señal, o sin conexión a WhatsApp, salta el aviso al equipo. */
export const ALARMA_DESDE_MIN = 15;

/** Qué tan cargado puede venir un pedido del lector. */
export const MAX_BYTES_CUERPO = 1_000_000;
export const MAX_PARTICIPANTES_FOTO = 20_000;
export const MAX_PARTICIPANTES_AVISO = 5_000;
/** El código QR llega como imagen (data URL): un SVG o un PNG de pocos KB. */
export const MAX_BYTES_QR = 80_000;
/** Un código QR dura unos segundos (WhatsApp cambia el código cada ~20): pasado esto no se muestra más. */
export const QR_VIGENTE_SEG = 60;

/** La respuesta de la pantalla sin el código si ya venció: pasado `QR_VIGENTE_SEG` desde la última respuesta buena, el
    código se saca aunque no llegue nada nuevo (la red se cortó, la app contestó 500). Lo mismo que mide el servidor, pero
    en la pantalla: no tiene que quedar a la vista un código que WhatsApp ya dio por muerto. */
export function sinCodigoVencido(datos: RespuestaEstado | null, recibidoMs: number, ahoraMs: number): RespuestaEstado | null {
  if (!datos?.qr || ahoraMs - recibidoMs < QR_VIGENTE_SEG * 1000) return datos;
  return { ...datos, qr: null };
}

/** Cada cuánto vuelve a preguntar Ajustes → WhatsApp mientras está abierta: cada 3 o 4 segundos si no está conectado (el código
    cambia cada ~20) y cada 20 conectado. Tras un 401 o 403 (null) no vuelve a preguntar por su cuenta: no se insiste con algo
    que la app ya dijo que no. */
export function proximaPregunta(sinAcceso: boolean, conectado: boolean): number | null {
  if (sinAcceso) return null;
  return conectado ? 20_000 : 3_500;
}

/** Quién ve el estado del lector con sus grupos: ve los Webinars y no está limitado a lo suyo (la ruta lo
    rechaza con 403 a quien ve sólo lo suyo). */
export const puedeVerWhatsapp = (a: MiAcceso | null | undefined) => nivelEn(a, "webinars") >= 1 && !esCuentaDeCloser(a);

/** Quién puede vincular el número (escanear el código): edita Ajustes. Es a quien mandan los avisos. */
export const puedeVincularWhatsapp = (a: MiAcceso | null | undefined) => nivelEn(a, "ajustes") >= 2;

const MIN = 60_000;
const aIso = (ms: number) => new Date(ms).toISOString();

/* ---------- Validar lo que manda el lector ---------- */

export type Validacion<T> = { ok: true; valor: T } | { ok: false; error: string };
export type EventoGrupo = "foto" | "entro" | "salio";

export interface CuerpoGrupo {
  grupo: { id: string; nombre: string };
  evento: EventoGrupo;
  /** Cuándo pasó, ya corregida (ni en el futuro ni absurda). */
  en: string;
  /** Las claves de los teléfonos, sin repetir. */
  telefonos: string[];
  recibidos: number;
  /** Los que no se entendieron como teléfono. */
  descartados: number;
  /** Cuántos participantes hay en total (con y sin teléfono), si el lector lo informa. */
  total: number | null;
  /** Cuántos no traen teléfono (WhatsApp los muestra por un id interno). */
  sinTelefono: number;
  /** La hora del lector difiere de la nuestra en más de diez minutos. */
  relojDesfasadoMin?: number;
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const entero = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000;
const ID_DE_GRUPO = /^[A-Za-z0-9._:@-]{3,120}$/;

/** La fecha que manda el lector, puesta en hora: sin fecha, ahora; el lector
    no puede contar algo del futuro (su reloj adelanta): ahora también, y lo
    mismo con una de hace más de un año (un reloj mal puesto). */
function horaDelAviso(en: unknown, ahora: Date): Validacion<{ en: string; desfaseMin: number }> {
  if (en === undefined || en === null || en === "") return { ok: true, valor: { en: ahora.toISOString(), desfaseMin: 0 } };
  const t = typeof en === "string" ? Date.parse(en) : NaN;
  if (!Number.isFinite(t)) return { ok: false, error: "«en» tiene que ser una fecha con hora, como 2026-10-07T18:30:00Z." };
  const desfase = Math.round((t - ahora.getTime()) / MIN);
  const absurda = t > ahora.getTime() || t < ahora.getTime() - 400 * 24 * 60 * MIN;
  return { ok: true, valor: { en: absurda ? ahora.toISOString() : aIso(t), desfaseMin: absurda ? desfase : 0 } };
}

/** El cuerpo de POST /api/whatsapp/grupos. */
export function validarCuerpoGrupo(json: unknown, ahora: Date = new Date()): Validacion<CuerpoGrupo> {
  if (!esObjeto(json)) return { ok: false, error: "El cuerpo tiene que ser un objeto JSON: { grupo, participantes, evento, en }." };

  const g = json.grupo;
  if (!esObjeto(g)) return { ok: false, error: "Falta «grupo»: { id, nombre }." };
  const id = typeof g.id === "string" ? g.id.trim() : "";
  if (!ID_DE_GRUPO.test(id)) return { ok: false, error: "«grupo.id» tiene que ser el id del grupo de WhatsApp (algo como 1203…@g.us)." };
  if (g.nombre !== undefined && g.nombre !== null && typeof g.nombre !== "string") return { ok: false, error: "«grupo.nombre» tiene que ser un texto." };
  /* Sin caracteres de control, y de un largo razonable. */
  const nombre = String(g.nombre ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

  const evento = json.evento;
  if (evento !== "foto" && evento !== "entro" && evento !== "salio") {
    return { ok: false, error: "«evento» tiene que ser «foto» (la lista completa), «entro» o «salio»." };
  }

  const lista = json.participantes;
  if (!Array.isArray(lista)) return { ok: false, error: "«participantes» tiene que ser una lista de teléfonos." };
  const tope = evento === "foto" ? MAX_PARTICIPANTES_FOTO : MAX_PARTICIPANTES_AVISO;
  if (lista.length > tope) return { ok: false, error: `«participantes» trae demasiados (el máximo es ${tope}).` };

  for (const [nombreCampo, valor] of [["total", json.total], ["sinTelefono", json.sinTelefono]] as const) {
    if (valor !== undefined && valor !== null && !entero(valor)) return { ok: false, error: `«${nombreCampo}» tiene que ser un número entero, cero o más.` };
  }

  const hora = horaDelAviso(json.en, ahora);
  if (!hora.ok) return hora;

  const claves = new Set<string>();
  let descartados = 0;
  for (const x of lista) {
    const clave = (typeof x === "string" && x.length <= 64) || typeof x === "number" ? claveInternacional(String(x)) : null;
    if (clave) claves.add(clave); else descartados++;
  }

  return {
    ok: true,
    valor: {
      grupo: { id, nombre }, evento, en: hora.valor.en,
      telefonos: [...claves], recibidos: lista.length, descartados,
      total: entero(json.total) ? (json.total as number) : null,
      sinTelefono: entero(json.sinTelefono) ? (json.sinTelefono as number) : 0,
      relojDesfasadoMin: Math.abs(hora.valor.desfaseMin) > 10 ? hora.valor.desfaseMin : undefined,
    },
  };
}

export interface CuerpoLatido {
  en: string;
  conectado: boolean;
  grupos: number;
  /** Cómo está con WhatsApp (siempre viene: si el lector no lo mandó, se deduce de `conectado`). */
  estado: EstadoConexion;
  /** El código QR para vincular, como imagen (data URL), sólo cuando el estado es «esperando_qr». */
  qr?: string;
  relojDesfasadoMin?: number;
}

const IMAGEN_QR = /^data:image\/(?:svg\+xml|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** El cuerpo de POST /api/whatsapp/latido. */
export function validarCuerpoLatido(json: unknown, ahora: Date = new Date()): Validacion<CuerpoLatido> {
  if (!esObjeto(json)) return { ok: false, error: "El cuerpo tiene que ser un objeto JSON: { en, conectado, grupos, estado, qr }." };
  if (json.conectado !== undefined && typeof json.conectado !== "boolean") return { ok: false, error: "«conectado» tiene que ser true o false." };
  if (json.estado !== undefined && !ESTADOS_DE_CONEXION.includes(json.estado as EstadoConexion)) {
    return { ok: false, error: "«estado» tiene que ser «conectado», «esperando_qr», «reconectando» o «cerrado»." };
  }
  if (json.conectado === undefined && json.estado === undefined) return { ok: false, error: "Falta «conectado» (true o false) o «estado»." };
  const estado = (json.estado as EstadoConexion | undefined) ?? (json.conectado ? "conectado" : "reconectando");
  const conectado = json.conectado === undefined ? estado === "conectado" : (json.conectado as boolean);
  if (conectado !== (estado === "conectado")) return { ok: false, error: "«conectado» no coincide con «estado»." };
  if (json.grupos !== undefined && json.grupos !== null && !entero(json.grupos)) return { ok: false, error: "«grupos» tiene que ser un número entero, cero o más." };

  let qr: string | undefined;
  if (json.qr !== undefined && json.qr !== null) {
    if (estado !== "esperando_qr") return { ok: false, error: "«qr» sólo va cuando el estado es «esperando_qr»." };
    if (typeof json.qr !== "string" || json.qr.length > MAX_BYTES_QR) return { ok: false, error: `«qr» tiene que ser una imagen de hasta ${MAX_BYTES_QR / 1000} KB.` };
    if (!IMAGEN_QR.test(json.qr)) return { ok: false, error: "«qr» tiene que ser una imagen en formato data URL (data:image/svg+xml;base64,… o data:image/png;base64,…)." };
    qr = json.qr;
  }

  const hora = horaDelAviso(json.en, ahora);
  if (!hora.ok) return hora;
  return {
    ok: true,
    valor: {
      en: hora.valor.en, conectado, estado, grupos: entero(json.grupos) ? (json.grupos as number) : 0, qr,
      relojDesfasadoMin: Math.abs(hora.valor.desfaseMin) > 10 ? hora.valor.desfaseMin : undefined,
    },
  };
}

/* ---------- Actualizar los miembros de un grupo ---------- */

export interface CambiosDeMiembros {
  crear: MiembroWhatsapp[];
  actualizar: MiembroWhatsapp[];
  /** Los que aparecen por primera vez. */
  nuevos: number;
  /** Los que estaban afuera y volvieron. */
  volvieron: number;
  salieron: number;
}

/* Lo último que se supo de un miembro: no se aplica nada más viejo. */
function ultimoCambio(m: MiembroWhatsapp): number {
  return Math.max(Date.parse(m.entro ?? "") || 0, Date.parse(m.salio ?? "") || 0);
}

/** Una foto es la lista completa de quienes están en el grupo en ese momento.
    - Los que no estaban en la base, entran. Si ya había una foto antes, entraron
      entre las dos (se anota la hora de ésta); si es la primera, ya estaban.
    - Los que estaban afuera y ahora aparecen, volvieron.
    - Los que estaban adentro y ya no aparecen, salieron… salvo que haya
      participantes sin teléfono visible: no se sabe cuáles son, y marcar a
      alguien como «salió» porque WhatsApp lo muestra por un id interno sería
      mentir. Con eso, sólo los avisos de «salió» marcan salidas.
    Nada más viejo que lo último que se supo de cada uno pisa lo más nuevo. */
export function aplicarFoto(
  existentes: readonly MiembroWhatsapp[], telefonos: readonly string[], en: string,
  op: { grupoId: string; primeraFoto: boolean; sinTelefono: number },
): CambiosDeMiembros {
  const t = Date.parse(en);
  const mapa = new Map(existentes.map((m) => [m.telefono, m] as const));
  const presentes = new Set(telefonos);
  const r: CambiosDeMiembros = { crear: [], actualizar: [], nuevos: 0, volvieron: 0, salieron: 0 };

  for (const tel of presentes) {
    const m = mapa.get(tel);
    if (!m) {
      r.crear.push({ grupoId: op.grupoId, telefono: tel, dentro: true, entro: op.primeraFoto ? null : en, salio: null, creadoEn: en });
      r.nuevos++;
    } else if (!m.dentro && ultimoCambio(m) <= t) {
      r.actualizar.push({ ...m, dentro: true, entro: en });
      r.volvieron++;
    }
  }
  if (op.sinTelefono === 0) {
    for (const m of existentes) {
      if (m.dentro && !presentes.has(m.telefono) && ultimoCambio(m) <= t) {
        r.actualizar.push({ ...m, dentro: false, salio: en });
        r.salieron++;
      }
    }
  }
  return r;
}

/** Un aviso de que alguien entró o salió. Si entra alguien que nunca vimos, se
    anota; si sale alguien que nunca vimos, se anota también (afuera), así un «entró»
    más viejo que llega después no lo da por adentro. Un aviso que no cambia nada igual
    deja su hora (sube `entro` o `salio`, nunca las baja): los avisos pueden llegar
    desordenados, y el que llega tarde no tiene que ganarle al más nuevo. */
export function aplicarAviso(
  existentes: readonly MiembroWhatsapp[], evento: "entro" | "salio", telefonos: readonly string[], en: string, grupoId: string,
): CambiosDeMiembros {
  const t = Date.parse(en);
  const mapa = new Map(existentes.map((m) => [m.telefono, m] as const));
  const r: CambiosDeMiembros = { crear: [], actualizar: [], nuevos: 0, volvieron: 0, salieron: 0 };
  /* ¿Esta hora es más nueva que la que ya tenía anotada? */
  const masNueva = (anotada: string | null) => !anotada || !(Date.parse(anotada) >= t);
  for (const tel of new Set(telefonos)) {
    const m = mapa.get(tel);
    if (evento === "entro") {
      if (!m) { r.crear.push({ grupoId, telefono: tel, dentro: true, entro: en, salio: null, creadoEn: en }); r.nuevos++; }
      else if (!m.dentro && ultimoCambio(m) <= t) { r.actualizar.push({ ...m, dentro: true, entro: en }); r.volvieron++; }
      else if (masNueva(m.entro)) r.actualizar.push({ ...m, entro: en });
    } else if (!m) {
      r.crear.push({ grupoId, telefono: tel, dentro: false, entro: null, salio: en, creadoEn: en });
    } else if (m.dentro && ultimoCambio(m) <= t) {
      r.actualizar.push({ ...m, dentro: false, salio: en });
      r.salieron++;
    } else if (masNueva(m.salio)) {
      r.actualizar.push({ ...m, salio: en });
    }
  }
  return r;
}

/** Cuántos quedan adentro después de aplicar los cambios. */
export function contarDentro(existentes: readonly MiembroWhatsapp[], cambios: CambiosDeMiembros): number {
  const mapa = new Map(existentes.map((m) => [m.telefono, m.dentro] as const));
  for (const m of [...cambios.crear, ...cambios.actualizar]) mapa.set(m.telefono, m.dentro);
  let n = 0;
  for (const dentro of mapa.values()) if (dentro) n++;
  return n;
}

/* ---------- ¿Está vivo el lector? ---------- */

export type TipoEstadoLector = "nunca" | "conectado" | "esperando-qr" | "reconectando" | "cerrado" | "sin-senal" | "caido";

export interface EstadoLector {
  tipo: TipoEstadoLector;
  /** Minutos desde el último latido (null si nunca hubo). */
  minutos: number | null;
  /** Hay que avisarle al equipo. */
  alarma: boolean;
  tono: "success" | "warning" | "danger" | "neutral";
  titulo: string;
  detalle: string;
}

/** «8 minutos», «3 horas», «2 días». */
export function duracionTexto(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 1) return "menos de un minuto";
  if (m < 60) return m === 1 ? "1 minuto" : `${m} minutos`;
  const h = Math.round(m / 60);
  if (h < 48) return h === 1 ? "1 hora" : `${h} horas`;
  return `${Math.round(h / 24)} días`;
}

/** Cómo está el lector, a partir de su último latido. */
export function estadoDelLector(l: LatidoLector | null | undefined, ahora: number = Date.now()): EstadoLector {
  if (!l) {
    return {
      tipo: "nunca", minutos: null, alarma: false, tono: "neutral", titulo: "Nunca se conectó",
      detalle: "Todavía no llegó ningún latido del lector. Cuando lo prendas en el servidor, aparece acá el código QR para vincular el número.",
    };
  }
  const ultimo = Date.parse(l.ultimoLatido);
  const min = Number.isFinite(ultimo) ? Math.max(0, Math.floor((ahora - ultimo) / MIN)) : 0;
  if (min > ALARMA_DESDE_MIN) {
    return {
      tipo: "caido", minutos: min, alarma: true, tono: "danger", titulo: `Sin señal hace ${duracionTexto(min)}`,
      detalle: "El servidor del lector no avisa. Mientras tanto no se actualiza quién entró a los grupos. Hay que revisar el servidor (Hostinger).",
    };
  }
  if (min > SIN_SENAL_DESDE_MIN) {
    return {
      tipo: "sin-senal", minutos: min, alarma: false, tono: "warning", titulo: `Sin señal hace ${duracionTexto(min)}`,
      detalle: `Falta algún latido (llega uno cada ${LATIDO_CADA_MIN} minutos). Puede ser un corte corto: si sigue, salta el aviso.`,
    };
  }
  /* Un lector de antes no manda «estado»: se deduce de «conectado». */
  const conexion: EstadoConexion = l.estado ?? (l.conectado ? "conectado" : "reconectando");
  if (conexion === "conectado") {
    return {
      tipo: "conectado", minutos: min, alarma: false, tono: "success", titulo: "Conectado",
      detalle: `Último latido ${min < 1 ? "recién" : `hace ${duracionTexto(min)}`}.`,
    };
  }
  /* Vivo, pero sin WhatsApp: hay que vincular el número, se cortó la conexión o se cerró la
     sesión. Si hace poco que pasó, puede arreglarse solo. */
  const referencia = Date.parse(l.ultimaConexion ?? "") || Date.parse(l.desde ?? "") || ultimo;
  const sinWhatsapp = Number.isFinite(referencia) ? Math.max(0, Math.floor((ahora - referencia) / MIN)) : 0;
  const alarma = sinWhatsapp > ALARMA_DESDE_MIN;
  const tono = alarma ? "danger" : "warning";
  if (conexion === "esperando_qr") {
    return {
      tipo: "esperando-qr", minutos: min, alarma, tono, titulo: "Esperando que lo escaneen",
      detalle: "Hay que vincular el número del lector: se escanea un código QR con el teléfono de ese número, como al abrir WhatsApp Web.",
    };
  }
  if (conexion === "cerrado") {
    return {
      tipo: "cerrado", minutos: min, alarma, tono, titulo: "Sesión cerrada",
      detalle: "WhatsApp cerró la sesión del lector y no pudo empezar otra sola. Hay que revisar el servidor: puede haber otra copia del lector usando el mismo número.",
    };
  }
  return {
    tipo: "reconectando", minutos: min, alarma, tono, titulo: "Reconectando",
    detalle: l.ultimaConexion
      ? `El servidor está prendido pero WhatsApp se cortó hace ${duracionTexto(sinWhatsapp)}. Vuelve a conectarse solo; si no puede, pide escanear el código de nuevo.`
      : "El servidor está prendido y todavía no se conectó a WhatsApp.",
  };
}

/* ---------- Qué grupo es de qué webinar ---------- */

export interface WebinarMinimo { id: string; titulo: string; fecha: string }

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

export interface FechaSuelta { dia: number; mes: number; anio?: number }

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const diasDelMes = (mes: number, anio: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/** Las fechas que dice un texto: «24/09», «24-09-2026», «2026-09-24», «20260924»,
    «24 de septiembre», «24 sep», «sept 24». Sin año, queda sin año. */
export function fechasEnTexto(texto: string): FechaSuelta[] {
  const salida: FechaSuelta[] = [];
  const poner = (dia: number, mes: number, anio?: number) => {
    if (mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(mes, anio ?? 2024)) return;
    if (!salida.some((f) => f.dia === dia && f.mes === mes && f.anio === anio)) salida.push({ dia, mes, anio });
  };
  let t = sinTildes(texto).toLowerCase();
  /* Cada expresión empieza con (^|[^\w.]): lo que va antes no puede ser parte de
     otra palabra o número («v1.5» no es el 1 de mayo). Sin lookbehind, que los
     Safari viejos no entienden. El primer grupo se devuelve tal cual. */
  const sacar = (re: RegExp, f: (m: string[]) => void) => {
    t = t.replace(re, (...args) => {
      const m = args.slice(0, -2) as string[];
      f(m);
      return `${m[1]} `;
    });
  };
  /* aaaa-mm-dd y aaaammdd */
  sacar(/(^|[^\w.])(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\w)/g, (m) => poner(+m[4], +m[3], +m[2]));
  sacar(/(^|[^\w.])(20\d{2})(\d{2})(\d{2})(?!\w)/g, (m) => poner(+m[4], +m[3], +m[2]));
  /* dd/mm/aaaa, dd/mm/aa y dd/mm */
  sacar(/(^|[^\w.])(\d{1,2})(?:\s*\/\s*|[-.])(\d{1,2})(?:(?:\s*\/\s*|[-.])(\d{4}|\d{2}))?(?!\w)/g, (m) => {
    poner(+m[2], +m[3], m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : undefined);
  });
  /* 24 de septiembre (de 2026), 24 sep, y sept 24 */
  const meses = Object.keys(MESES).sort((a, b) => b.length - a.length).join("|");
  sacar(new RegExp(`(^|[^\\w.])(\\d{1,2})\\s*(?:de\\s+)?(${meses})\\.?(?:\\s*(?:de\\s+)?(20\\d{2}))?(?![a-z])`, "g"), (m) => {
    poner(+m[2], MESES[m[3]], m[4] ? +m[4] : undefined);
  });
  sacar(new RegExp(`(^|[^\\w.])(${meses})\\.?\\s+(\\d{1,2})(?!\\d)`, "g"), (m) => poner(+m[3], MESES[m[2]]));
  return salida;
}

/** El número de un grupo en su nombre: «Taller Online 08/10/26 #2» es el 2. Los
    talleres tienen varios grupos (WhatsApp deja 1.024 por grupo): #1, #2, #3… y todos
    son del mismo webinar. Sin «#N», null. */
export function numeroDeGrupo(nombre: string | null | undefined): number | null {
  const m = /#\s*(\d{1,3})(?!\d)/.exec(nombre ?? "");
  return m ? Number(m[1]) : null;
}

/** «Grupo #2», o vacío si el nombre no trae el número. */
export const rotuloDeGrupo = (nombre: string | null | undefined): string => {
  const n = numeroDeGrupo(nombre);
  return n === null ? "" : `Grupo #${n}`;
};

/** Los grupos ordenados por su número (#1, #2…) y, si no lo traen, por nombre. */
export function ordenarGrupos<T extends { nombre: string }>(grupos: readonly T[]): T[] {
  return [...grupos].sort((a, b) => (numeroDeGrupo(a.nombre) ?? 1e9) - (numeroDeGrupo(b.nombre) ?? 1e9) || a.nombre.localeCompare(b.nombre, "es"));
}

/** El día de un webinar, en hora de Argentina (UTC−3): [año, mes, día]. */
function diaArgentino(iso: string): [number, number, number] | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const [a, m, d] = new Date(t - 3 * 60 * MIN).toISOString().slice(0, 10).split("-").map(Number);
  return [a, m, d];
}

const clave = (s: string) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** El webinar al que parece corresponder un grupo, por lo que dice su nombre:
    el título entero, o el día y el mes (con el año, si lo trae; si no, el que
    cae más cerca de ahora). Los grupos se llaman «Taller Online 08/10/26 #1»: se
    mira la fecha (dd/mm/aa o dd/mm/aaaa) y el «#N» no cuenta, así todos los grupos
    de un mismo taller dan el mismo webinar. Es una sugerencia: el equipo la confirma. */
export function sugerirWebinar(
  nombreGrupo: string, webinars: readonly WebinarMinimo[], ahora: number = Date.now(),
): { webinarId: string; motivo: string } | null {
  const nombre = clave(nombreGrupo);
  if (!nombre) return null;

  /* La fecha manda: es lo que distingue un taller de otro, aunque todos se llamen «Taller Online». */
  const candidatos: { w: WebinarMinimo; exacto: boolean; cerca: number; fecha: FechaSuelta }[] = [];
  for (const f of fechasEnTexto(nombreGrupo)) {
    for (const w of webinars) {
      const d = diaArgentino(w.fecha);
      if (!d || d[1] !== f.mes || d[2] !== f.dia || (f.anio !== undefined && f.anio !== d[0])) continue;
      candidatos.push({ w, exacto: f.anio !== undefined, cerca: Math.abs(Date.parse(w.fecha) - ahora), fecha: f });
    }
  }
  candidatos.sort((a, b) => Number(b.exacto) - Number(a.exacto) || a.cerca - b.cerca);
  const mejor = candidatos[0];
  if (mejor) {
    const dd = String(mejor.fecha.dia).padStart(2, "0");
    const mm = String(mejor.fecha.mes).padStart(2, "0");
    return { webinarId: mejor.w.id, motivo: `El nombre del grupo dice ${dd}/${mm}, el día de este webinar.` };
  }

  /* Sin fecha, el título entero, si es de un solo webinar. */
  const porTitulo = webinars.filter((w) => {
    const t = clave(w.titulo);
    return t.length >= 12 && nombre.includes(t);
  });
  if (porTitulo.length === 1) return { webinarId: porTitulo[0].id, motivo: "El nombre del grupo es el título del webinar." };
  return null;
}

/* ---------- Quién de un webinar está en el grupo ---------- */

export type EstadoUnion = "unida" | "no-unida" | "sin-telefono";

export interface UnionDePersona {
  estado: EstadoUnion;
  /** La clave con la que se la encontró en el grupo, o la más probable. */
  clave: string | null;
  /** Los dígitos para abrir un chat o copiar el número; vacío si no hay. */
  numero: string;
  /** El número trae el código de país (se copia con el +). Si no, son los dígitos
      tal cual se escribieron: no se inventa el país. */
  completo: boolean;
  /** Si no está pero estuvo: cuándo salió. */
  salio?: string;
  /** Hay un teléfono escrito pero no se entiende como tal. */
  ilegible?: boolean;
}

export const ETIQUETA_UNION: Record<EstadoUnion, string> = {
  "unida": "Unida", "no-unida": "No unida", "sin-telefono": "Sin teléfono",
};

/** El estado de una persona respecto de los grupos de su webinar. `dentro` son
    las claves de quienes están adentro de alguno; `salieron`, cuándo salió cada
    uno de los que estuvieron. */
export function unionDePersona(
  telefono: string | null | undefined, pais: string | null | undefined,
  dentro: ReadonlySet<string>, salieron: ReadonlyMap<string, string> = new Map(),
): UnionDePersona {
  const escrito = (telefono ?? "").trim();
  if (!escrito) return { estado: "sin-telefono", clave: null, numero: "", completo: false };
  const claves = clavesDeTelefono(escrito, pais);
  if (claves.length === 0) return { estado: "sin-telefono", clave: null, numero: "", completo: false, ilegible: true };
  const hallada = claves.find((c) => dentro.has(c));
  if (hallada) return { estado: "unida", clave: hallada, numero: hallada, completo: true };
  const numero = numeroParaWhatsapp(escrito, pais) || digitosDe(escrito);
  return {
    estado: "no-unida", clave: claves[0], numero, completo: claves.includes(numero),
    salio: claves.map((c) => salieron.get(c)).find(Boolean),
  };
}

export interface ResumenDeUnion { conTelefono: number; unidas: number; noUnidas: number; sinTelefono: number }

/** «N de M se unieron»: M son las que dejaron un teléfono (las únicas que se pueden revisar). */
export function resumirUnion(estados: readonly EstadoUnion[]): ResumenDeUnion {
  const r = { conTelefono: 0, unidas: 0, noUnidas: 0, sinTelefono: 0 };
  for (const e of estados) {
    if (e === "sin-telefono") { r.sinTelefono++; continue; }
    r.conTelefono++;
    if (e === "unida") r.unidas++; else r.noUnidas++;
  }
  return r;
}

/* ---------- Los registros de Formularios contra el grupo ---------- */

export interface RegistroParaCruzar { id: string; telefono?: string; pais?: string; grupo?: string }

/** Lo que dice el lector de cada registro: está en el grupo, no está o no tiene teléfono. */
export function unionesDeRegistros(
  registros: readonly RegistroParaCruzar[], dentro: Iterable<string>, salieron: Readonly<Record<string, string>> = {},
): Map<string, UnionDePersona> {
  const adentro = new Set(dentro);
  const afuera = new Map(Object.entries(salieron));
  return new Map(registros.map((r) => [r.id, unionDePersona(r.telefono, r.pais, adentro, afuera)] as const));
}

export interface ResumenDeRegistros { total: number; conTelefono: number; dentro: number; fuera: number; sinTelefono: number; porMarcar: number }

/** Los números de arriba de Formularios. `porMarcar` son los que el lector ve adentro y la hoja todavía no marca «Unido». */
export function resumenDeRegistros(registros: readonly RegistroParaCruzar[], uniones: ReadonlyMap<string, UnionDePersona>): ResumenDeRegistros {
  const x = { total: registros.length, conTelefono: 0, dentro: 0, fuera: 0, sinTelefono: 0, porMarcar: 0 };
  for (const r of registros) {
    const u = uniones.get(r.id);
    if (!u) continue;
    if (u.estado === "sin-telefono") { x.sinTelefono++; continue; }
    x.conTelefono++;
    if (u.estado === "unida") { x.dentro++; if (r.grupo !== "unido") x.porMarcar++; } else x.fuera++;
  }
  return x;
}

export type FiltroDeLector = "" | "dentro" | "fuera" | "sin-telefono";

/** Los registros que cumplen un filtro por lo que dice el lector. Sin filtro, todos. */
export function filtrarPorLector<T extends { id: string }>(registros: readonly T[], filtro: FiltroDeLector, uniones: ReadonlyMap<string, UnionDePersona>): T[] {
  if (!filtro) return [...registros];
  return registros.filter((r) => {
    const u = uniones.get(r.id);
    if (!u) return false;
    return filtro === "dentro" ? u.estado === "unida" : filtro === "fuera" ? u.estado === "no-unida" : u.estado === "sin-telefono";
  });
}

/** El teléfono para pegar: con el + si trae el código de país; si no, tal cual se escribió. */
export const telefonoParaCopiar = (f: { numero: string; completo?: boolean }) => (f.completo === false ? f.numero : `+${f.numero}`);

/** Una celda de texto para pegar en una planilla: si empieza con = + - @ (o tabulador o retorno de carro) la
    planilla la toma por una fórmula. Con IMPORTXML o WEBSERVICE alcanza para mandar lo demás pegado a un
    servidor ajeno. El apóstrofo la deja como texto. */
export const celdaSegura = (texto: string) => (/^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto);

/** El nombre que escribe cualquiera en la página pública, sin lo que lo haría fórmula en una planilla: se
    sacan del principio los = + - @ (y los espacios y controles que los preceden). «Jean-Paul» y «María» quedan
    igual: sólo importa el principio. */
export function nombreSinFormula(nombre: string | undefined): string | undefined {
  if (nombre === undefined) return undefined;
  return nombre.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/^[\s=+\-@]+/, "").replace(/\s+$/, "") || undefined;
}

/** La lista para pegar en otro lado: un teléfono por renglón (con el +), o
    «nombre ⇥ teléfono» para pegarla en una planilla. */
export function listaParaCopiar(filas: readonly { nombre: string; numero: string; completo?: boolean }[], conNombres: boolean): string {
  return filas
    .filter((f) => f.numero)
    .map((f) => (conNombres ? `${celdaSegura(f.nombre.replace(/[\t\r\n]+/g, " ").trim())}\t${telefonoParaCopiar(f)}` : telefonoParaCopiar(f)))
    .join("\n");
}

/* ---------- Lo que se intercambian la app y la pantalla ---------- */

export interface RespuestaEstado {
  /** El servidor de la app tiene WHATSAPP_LECTOR_TOKEN: el lector puede mandar datos. */
  configurado: boolean;
  /** Las tablas existen (se corrió supabase/whatsapp-lector.sql). */
  tablas: boolean;
  /** «prueba-local»: sin base, en un archivo de la máquina (sólo para probar). */
  modo: "nube" | "prueba-local";
  lector: LatidoLector | null;
  grupos: GrupoWhatsapp[];
  /** Sólo si se pidió el código (?qr=1) y el lector lo está esperando: quien pide es dueño o edita Ajustes. */
  puedeVerQr?: boolean;
  /** El código QR vigente (menos de un minuto), como imagen. Una credencial: sólo para quien puede verlo. */
  qr?: string | null;
  /** Falta correr supabase/whatsapp-lector-qr.sql: no hay dónde guardar el código. */
  qrSinTabla?: boolean;
  /** Quien pidió sólo edita Ajustes (vincula el número) y no ve los Webinars: viene el estado del lector y el código,
      sin los grupos. */
  sinGrupos?: boolean;
}

export interface RespuestaWebinar {
  configurado: boolean;
  tablas: boolean;
  modo: "nube" | "prueba-local";
  lector: LatidoLector | null;
  /** Los grupos atados a este webinar. */
  grupos: GrupoWhatsapp[];
  /** Las claves de quienes están adentro de alguno. */
  dentro: string[];
  /** Quién salió y cuándo (los que no están adentro de ninguno). */
  salieron: Record<string, string>;
  generado: string;
}
