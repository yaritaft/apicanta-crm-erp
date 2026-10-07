import { claveEmail, completar } from "./contactos";
import { normalizarPais } from "./paises";
import { claveTelefono, codigoDePais } from "./telefonos";
import { diaArgentina } from "./reporteFinanciera";

/* ==================================================================
   Los registros de la landing del webinar.

   Una fila por persona y por webinar (supabase/registros-webinar.sql): lo
   que se anotó en el formulario (datos, UTMs, anuncio, respuestas) y las tres
   marcas del equipo (unido al grupo de WhatsApp, no unido, contactado) que
   hasta ahora vivían en las hojas del Excel.

   Todo lo puro (ids, normalización, lectura de las hojas del Excel, resumen
   previo a importar, filtros) está acá, sin React ni base: lo usan la landing
   (en el servidor), el importador, la pantalla Formularios y las pruebas.
   ================================================================== */

export type GrupoWpp = "unido" | "no-unido";
export type OrigenRegistro = "landing" | "excel" | "meta" | "whatsapp" | "otro";
export type MetodoCruce = "mail" | "telefono" | "nombre" | "manual";

export interface RegistroForm {
  /** `reg_` + hash del mail y la fecha del webinar: la misma persona en el mismo webinar es la misma fila. */
  id: string;
  webinarId?: string;
  /** El día del webinar, aaaa-mm-dd (Argentina). */
  fechaWebinar?: string;
  email: string;
  nombre?: string;
  /** Como lo escribió la persona. */
  telefono?: string;
  /** Código de país + número sin 0, 9 ni 15: para cruzar y para WhatsApp. */
  telefonoNorm?: string;
  pais?: string;
  utm?: Record<string, string>;
  /** `ads.id` del anuncio del que vino, de utm_content. */
  adId?: string;
  pagina?: string;
  respuestas: { pregunta: string; respuesta: string }[];
  fbp?: string;
  fbc?: string;
  ip?: string;
  userAgent?: string;
  eventoId?: string;
  /* Las tres marcas. */
  grupo?: GrupoWpp;
  grupoPor?: string;
  grupoEn?: string;
  contactado: boolean;
  contactadoPor?: string;
  contactadoEn?: string;
  notas?: string;
  /* El cruce con la agenda (lib/cruce-formularios.ts). */
  contactoId?: string;
  cruce?: MetodoCruce;
  cruceEn?: string;
  /** Las personas que se descartaron con «No es»: no se vuelven a proponer. */
  descartados: string[];
  origen: OrigenRegistro;
  /** El nombre de la hoja o del archivo de donde se importó. */
  origenDetalle?: string;
  /** Cuándo se anotó. */
  registradoEn: string;
  creadoEn: string;
}

export const UTMS_FORM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

/* ---------- id ---------- */

/* Un hash de 128 bits que anda igual en el navegador y en el servidor (el
   importador y la landing tienen que dar el mismo id para la misma persona).
   cyrb128: no es criptográfico, y no hace falta: sólo tiene que no repetirse. */
function hash128(texto: string): string {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < texto.length; i++) {
    const k = texto.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

/** El id de la fila: el mismo mail en el mismo webinar (por su fecha) es siempre el mismo. */
export const idRegistro = (email: string, fechaWebinar?: string | null): string =>
  `reg_${hash128(`${claveEmail(email)}|${(fechaWebinar ?? "").slice(0, 10) || "sin"}`)}`;

/* ---------- datos del formulario ---------- */

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const emailValido = (email: string | null | undefined): boolean => MAIL.test(claveEmail(email));

/** El anuncio de un UTM: `ad_<id>` si utm_content es el id de Meta (15 a 20
 *  dígitos), o el anuncio con ese nombre (o ese id de Meta) si se pasa la
 *  lista de anuncios. */
export function adIdDeUtm(
  utm: Record<string, string> | null | undefined,
  ads: { id: string; metaId?: string; nombre: string }[] = [],
): string | undefined {
  const c = (utm?.utm_content ?? utm?.content ?? "").trim();
  if (!c) return undefined;
  if (/^\d{12,20}$/.test(c)) return ads.find((a) => a.metaId === c)?.id ?? `ad_${c}`;
  const k = c.toLowerCase();
  return ads.find((a) => a.id === c || a.metaId === c || a.nombre.trim().toLowerCase() === k)?.id;
}

/** El teléfono normalizado de un registro, con el país de la persona para
 *  los números sin código de país. */
export const telefonoNormDe = (telefono: string | undefined, pais: string | undefined): string | undefined => {
  const iso = normalizarPais(pais);
  return claveTelefono(telefono, iso.length === 2 ? iso : undefined);
};

/** Un registro con lo mínimo; lo demás, vacío. */
export function nuevoRegistro(base: Partial<RegistroForm> & { email: string }, ahora = new Date().toISOString()): RegistroForm {
  const email = claveEmail(base.email);
  const fechaWebinar = base.fechaWebinar?.slice(0, 10) || undefined;
  return {
    respuestas: [], contactado: false, descartados: [], origen: "landing", registradoEn: ahora, creadoEn: ahora,
    ...base, email, fechaWebinar, id: base.id ?? idRegistro(email, fechaWebinar),
    telefonoNorm: base.telefonoNorm ?? telefonoNormDe(base.telefono, base.pais),
  };
}

/* ---------- la fila para la base ---------- */

const sinVacios = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;

/** La fila tal cual va a `registros_webinar`: sin undefined (así la base completa lo que falte con su default). */
export const filaParaBase = (r: RegistroForm): Record<string, unknown> =>
  ({ ...sinVacios(r), respuestas: r.respuestas, descartados: r.descartados, contactado: r.contactado });

/** Lo que ya estaba más lo nuevo: se completan los huecos, y las marcas del
 *  equipo (unido, contactado, notas) no se pisan nunca con lo importado. */
export function fusionarRegistro(ya: RegistroForm, nuevo: RegistroForm): RegistroForm {
  return {
    ...ya,
    webinarId: completar(ya.webinarId, nuevo.webinarId),
    fechaWebinar: completar(ya.fechaWebinar, nuevo.fechaWebinar),
    nombre: completar(ya.nombre, nuevo.nombre),
    telefono: completar(ya.telefono, nuevo.telefono),
    telefonoNorm: completar(ya.telefonoNorm, nuevo.telefonoNorm),
    pais: completar(ya.pais, nuevo.pais),
    utm: ya.utm && Object.keys(ya.utm).length ? ya.utm : nuevo.utm,
    adId: completar(ya.adId, nuevo.adId),
    pagina: completar(ya.pagina, nuevo.pagina),
    respuestas: ya.respuestas.length ? ya.respuestas : nuevo.respuestas,
    grupo: ya.grupo ?? nuevo.grupo,
    grupoPor: ya.grupo ? ya.grupoPor : nuevo.grupoPor,
    grupoEn: ya.grupo ? ya.grupoEn : nuevo.grupoEn,
    contactado: ya.contactado || nuevo.contactado,
    contactadoPor: ya.contactado ? ya.contactadoPor : nuevo.contactadoPor,
    contactadoEn: ya.contactado ? ya.contactadoEn : nuevo.contactadoEn,
    notas: completar(ya.notas, nuevo.notas),
  };
}

/* ==================================================================
   Importar las hojas del Excel (una por webinar).
   ================================================================== */

/* Los datos que se pueden traer de una hoja. */
export type CampoImport =
  | "email" | "nombre" | "telefono" | "pais" | "codigoPais" | "fecha" | "fechaWebinar" | "adId"
  | "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term"
  | "unido" | "noUnido" | "contactado" | "contactadoPor" | "notas";

export const CAMPOS_IMPORT: { campo: CampoImport; titulo: string; ayuda?: string; alias: string[] }[] = [
  { campo: "email", titulo: "Email", ayuda: "Obligatorio: sin mail válido la fila no entra.", alias: ["email", "e-mail", "mail", "correo", "correo electronico", "email address"] },
  { campo: "nombre", titulo: "Nombre", alias: ["nombre", "nombre completo", "name", "full name", "nombre y apellido", "apellido y nombre", "first name"] },
  { campo: "telefono", titulo: "Teléfono", alias: ["telefono", "celular", "whatsapp", "phone", "tel", "numero", "numero de telefono", "movil", "cel"] },
  { campo: "pais", titulo: "País", alias: ["pais", "country"] },
  { campo: "codigoPais", titulo: "Código de país", ayuda: "«+54», «54» o «AR»: sirve para ordenar el teléfono.", alias: ["codigo", "codigo pais", "codigo de pais", "cod pais", "country code", "prefijo", "lada"] },
  { campo: "fecha", titulo: "Fecha de registro", ayuda: "Cuándo se anotó la persona.", alias: ["fecha", "fecha de registro", "fecha registro", "registro", "timestamp", "marca temporal", "fecha y hora", "created", "created at"] },
  { campo: "fechaWebinar", titulo: "Fecha del webinar", ayuda: "Si la hoja la trae por fila; si no, sale del nombre de la hoja.", alias: ["fecha webinar", "fecha del webinar", "webinar", "fecha taller", "taller"] },
  { campo: "adId", titulo: "ID del anuncio", alias: ["id anuncio", "id del anuncio", "ad id", "ad_id", "id ad", "anuncio", "ad"] },
  { campo: "utm_source", titulo: "utm_source", alias: ["utm source", "utm_source", "source", "fuente"] },
  { campo: "utm_medium", titulo: "utm_medium", alias: ["utm medium", "utm_medium", "medium", "medio"] },
  { campo: "utm_campaign", titulo: "utm_campaign", alias: ["utm campaign", "utm_campaign", "campaign", "campana"] },
  { campo: "utm_content", titulo: "utm_content", alias: ["utm content", "utm_content", "content", "contenido"] },
  { campo: "utm_term", titulo: "utm_term", alias: ["utm term", "utm_term", "term", "termino"] },
  { campo: "unido", titulo: "Unido al grupo", alias: ["unido", "unido al grupo", "se unio", "en el grupo", "grupo"] },
  { campo: "noUnido", titulo: "No unido", alias: ["no unido", "no unidos", "no se unio", "sin unir"] },
  { campo: "contactado", titulo: "Contactado", alias: ["contactado", "contactados", "se le escribio", "mensaje enviado"] },
  { campo: "contactadoPor", titulo: "Contactado por", alias: ["contactado por", "quien contacto", "responsable"] },
  { campo: "notas", titulo: "Notas", alias: ["notas", "nota", "comentarios", "observaciones"] },
];

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_ ]+/g, " ").replace(/\s+/g, " ").trim();

export type Mapeo = Partial<Record<CampoImport, number>>;

/** Qué columna de la hoja es cada dato, por el nombre del encabezado. Editable
 *  después: acá sólo es la sugerencia. Cada columna se usa para un solo dato. */
export function adivinarMapeo(encabezados: string[]): Mapeo {
  const heads = encabezados.map(sinAcentos);
  const usadas = new Set<number>();
  const mapeo: Mapeo = {};
  /* Primero los nombres exactos; después los que contienen el alias. */
  for (const exacto of [true, false]) {
    for (const { campo, alias } of CAMPOS_IMPORT) {
      if (mapeo[campo] !== undefined) continue;
      for (const a of alias) {
        const i = heads.findIndex((h, j) => !usadas.has(j) && h !== "" && (exacto ? h === a : h.includes(a) && a.length >= 5));
        if (i >= 0) { mapeo[campo] = i; usadas.add(i); break; }
      }
    }
  }
  return mapeo;
}

/* ---------- fechas ---------- */

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

const iso = (a: number, m: number, d: number): string | undefined => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCMonth() === m - 1 ? f.toISOString().slice(0, 10) : undefined;
};

/** Una fecha escrita de las formas que trae un Excel: 23/09/2026, 23-09-26,
 *  2026-09-23, 23 de septiembre, 20260923, o el número de serie de Excel.
 *  Sin año (23/09) usa `anio`. */
export function leerFecha(texto: string | null | undefined, anio = new Date().getFullYear()): string | undefined {
  const t = (texto ?? "").trim();
  if (!t) return undefined;
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/.exec(t);
  if (m) {
    const a = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : anio;
    return iso(a, +m[2], +m[1]);
  }
  m = /(\d{1,2})\s*(?:de\s+)?([a-záéíóú]+)\.?(?:\s*(?:de\s+)?(\d{4}))?/i.exec(sinAcentosMes(t));
  if (m && MESES[m[2].toLowerCase()]) return iso(m[3] ? +m[3] : anio, MESES[m[2].toLowerCase()], +m[1]);
  /* El número de serie de Excel (días desde 1899-12-30), con hora o sin ella. */
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86400000);
    return f.toISOString().slice(0, 10);
  }
  return undefined;
}
const sinAcentosMes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Cuándo se anotó, para guardar: la fecha de la celda (con hora si la trae). */
export function instanteDe(texto: string | null | undefined, anio?: number): string | undefined {
  const t = (texto ?? "").trim();
  if (!t) return undefined;
  const dia = leerFecha(t, anio);
  if (!dia) return undefined;
  const h = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
  /* La hora del Excel es de Argentina (UTC−3). */
  const hora = h ? `${h[1].padStart(2, "0")}:${h[2]}:${h[3] ?? "00"}` : "12:00:00";
  const d = new Date(`${dia}T${hora}-03:00`);
  return Number.isNaN(+d) ? undefined : d.toISOString();
}

/** El día del webinar que dice el nombre de una hoja («Webinar 23-09», «23/09/2026», «Taller 14 de octubre»). */
export const fechaDeHoja = (nombre: string, anio?: number): string | undefined => leerFecha(nombre, anio);

/** El webinar de la app de un día (aaaa-mm-dd), si hay uno cargado. */
export const webinarDelDia = <W extends { id: string; fecha: string }>(webinars: W[], dia: string | undefined): W | undefined =>
  dia ? webinars.find((w) => diaArgentina(w.fecha) === dia) : undefined;

/* ---------- las filas de una hoja ---------- */

const SI = /^(si|sí|x|✓|✔|1|true|verdadero|yes|ok|unido|contactado|listo)$/i;
export const esSi = (v: string | undefined): boolean => SI.test((v ?? "").trim());

export interface HojaAImportar {
  /** El nombre de la hoja del Excel (o del archivo). */
  nombre: string;
  /** La tabla tal cual: la primera fila son los encabezados. */
  tabla: string[][];
  mapeo: Mapeo;
  /** El día del webinar de la hoja. */
  fechaWebinar?: string;
  incluir: boolean;
}

export interface FilaDescartada { fila: number; motivo: string }

export interface HojaLeida {
  nombre: string;
  fechaWebinar?: string;
  webinarId?: string;
  registros: RegistroForm[];
  /** Filas que no entran: sin mail válido, o repetidas dentro de la hoja. */
  descartadas: FilaDescartada[];
  repetidas: number;
}

/** Lee una hoja con su mapeo y arma los registros. Cada fila es una persona;
 *  el mismo mail dos veces en la hoja entra una sola (la primera). Lo que no
 *  está mapeado y tiene encabezado va a las respuestas del formulario. */
export function leerHoja(
  hoja: HojaAImportar,
  opciones: { webinars?: { id: string; fecha: string }[]; ads?: { id: string; metaId?: string; nombre: string }[]; anio?: number; ahora?: string } = {},
): HojaLeida {
  const { tabla, mapeo } = hoja;
  const encabezados = tabla[0] ?? [];
  const mapeadas = new Set(Object.values(mapeo).filter((i): i is number => typeof i === "number"));
  const celda = (fila: string[], c: CampoImport) => {
    const i = mapeo[c];
    return i === undefined || i < 0 ? "" : (fila[i] ?? "").trim();
  };
  const ahora = opciones.ahora ?? new Date().toISOString();
  const registros: RegistroForm[] = [];
  const descartadas: FilaDescartada[] = [];
  const vistos = new Set<string>();
  let repetidas = 0;

  for (let n = 1; n < tabla.length; n++) {
    const fila = tabla[n];
    if (!fila || fila.every((x) => !x?.trim())) continue;
    const email = claveEmail(celda(fila, "email"));
    if (!emailValido(email)) { descartadas.push({ fila: n + 1, motivo: email ? `«${email}» no es un mail válido` : "sin mail" }); continue; }
    const fechaWebinar = leerFecha(celda(fila, "fechaWebinar"), opciones.anio) ?? hoja.fechaWebinar;
    const id = idRegistro(email, fechaWebinar);
    if (vistos.has(id)) { repetidas++; continue; }
    vistos.add(id);

    const pais = celda(fila, "pais") || undefined;
    const codigo = celda(fila, "codigoPais");
    /* El código de país («+54», «54», «AR») ayuda a ordenar el teléfono. */
    const isoCodigo = /^[A-Za-z]{2}$/.test(codigo) ? codigo.toUpperCase() : undefined;
    const cc = codigo.replace(/\D/g, "");
    const crudoTel = celda(fila, "telefono");
    const telefono = crudoTel ? (cc && !/^(\+|00)/.test(crudoTel) && !crudoTel.replace(/\D/g, "").startsWith(cc) ? `+${cc}${crudoTel.replace(/^0+/, "")}` : crudoTel) : undefined;
    const utm = Object.fromEntries(UTMS_FORM.map((k) => [k, celda(fila, k)]).filter(([, v]) => v)) as Record<string, string>;
    const unido = esSi(celda(fila, "unido")), noUnido = esSi(celda(fila, "noUnido"));
    const contactado = esSi(celda(fila, "contactado")) || Boolean(celda(fila, "contactadoPor"));
    const respuestas = encabezados
      .map((h, i) => ({ pregunta: (h ?? "").trim(), respuesta: (fila[i] ?? "").trim(), i }))
      .filter((x) => x.pregunta && x.respuesta && !mapeadas.has(x.i))
      .map(({ pregunta, respuesta }) => ({ pregunta, respuesta: respuesta.slice(0, 500) }))
      .slice(0, 20);
    const webinarId = webinarDelDia(opciones.webinars ?? [], fechaWebinar)?.id;
    const adCrudo = celda(fila, "adId");
    const adId = adCrudo ? adIdDeUtm({ utm_content: adCrudo }, opciones.ads) ?? (/^\d{12,20}$/.test(adCrudo) ? `ad_${adCrudo}` : undefined) : adIdDeUtm(utm, opciones.ads);

    registros.push(nuevoRegistro({
      id, email, webinarId, fechaWebinar,
      nombre: celda(fila, "nombre") || undefined,
      telefono, pais: pais ?? isoCodigo,
      utm: Object.keys(utm).length ? utm : undefined, adId, respuestas,
      grupo: unido ? "unido" : noUnido ? "no-unido" : undefined,
      contactado, contactadoPor: celda(fila, "contactadoPor") || undefined,
      notas: celda(fila, "notas") || undefined,
      origen: "excel", origenDetalle: hoja.nombre,
      registradoEn: instanteDe(celda(fila, "fecha"), opciones.anio) ?? ahora,
    }, ahora));
  }
  return { nombre: hoja.nombre, fechaWebinar: hoja.fechaWebinar, webinarId: webinarDelDia(opciones.webinars ?? [], hoja.fechaWebinar)?.id, registros, descartadas, repetidas };
}

/* ---------- el resumen antes de confirmar ---------- */

export interface ResumenHoja {
  nombre: string;
  fechaWebinar?: string;
  webinarId?: string;
  /** Filas con datos (sin los encabezados). */
  filas: number;
  nuevos: number;
  /** Ya estaban en la tabla: se completan los huecos, no se duplican ni se pisan las marcas. */
  yaEstaban: number;
  sinMail: number;
  repetidos: number;
  conTelefono: number;
  conUtm: number;
  unidos: number;
  contactados: number;
}

export interface PlanImportacion {
  hojas: ResumenHoja[];
  /** Lo que se escribe: los nuevos y los ya existentes con huecos completados. */
  aEscribir: RegistroForm[];
  totales: { filas: number; nuevos: number; yaEstaban: number; sinMail: number; repetidos: number };
  avisos: string[];
}

/** Lo que va a pasar al importar, sin escribir nada: por hoja cuántos entran,
 *  cuántos ya estaban (por mail y fecha del webinar) y cuántos se descartan. */
export function planificarImportacion(hojas: HojaLeida[], existentes: Map<string, RegistroForm>): PlanImportacion {
  const resumenes: ResumenHoja[] = [];
  const aEscribir: RegistroForm[] = [];
  const avisos: string[] = [];
  const escritos = new Set<string>();
  for (const h of hojas) {
    const filas = h.registros.length + h.descartadas.length + h.repetidas;
    const r: ResumenHoja = {
      nombre: h.nombre, fechaWebinar: h.fechaWebinar, webinarId: h.webinarId, filas,
      nuevos: 0, yaEstaban: 0, sinMail: h.descartadas.length, repetidos: h.repetidas,
      conTelefono: 0, conUtm: 0, unidos: 0, contactados: 0,
    };
    if (!h.fechaWebinar && h.registros.length) avisos.push(`La hoja «${h.nombre}» no tiene fecha del webinar: sus filas quedan «sin fecha». Poné la fecha en la hoja para atarlas a un webinar.`);
    else if (h.fechaWebinar && !h.webinarId && h.registros.length) avisos.push(`La hoja «${h.nombre}» es del ${h.fechaWebinar.split("-").reverse().join("/")}, pero la app no tiene un webinar de ese día: se guarda con la fecha y se ata solo cuando se cree el webinar.`);
    for (const reg of h.registros) {
      /* El mismo mail y fecha en dos hojas (un nombre de hoja repetido): entra una vez. */
      if (escritos.has(reg.id)) { r.repetidos++; continue; }
      escritos.add(reg.id);
      if (reg.telefono) r.conTelefono++;
      if (reg.utm) r.conUtm++;
      if (reg.grupo === "unido") r.unidos++;
      if (reg.contactado) r.contactados++;
      const ya = existentes.get(reg.id);
      if (ya) r.yaEstaban++; else r.nuevos++;
      aEscribir.push(ya ? fusionarRegistro(ya, reg) : reg);
    }
    resumenes.push(r);
  }
  const suma = (k: "filas" | "nuevos" | "yaEstaban" | "sinMail" | "repetidos") => resumenes.reduce((a, r) => a + r[k], 0);
  return {
    hojas: resumenes, aEscribir, avisos,
    totales: { filas: suma("filas"), nuevos: suma("nuevos"), yaEstaban: suma("yaEstaban"), sinMail: suma("sinMail"), repetidos: suma("repetidos") },
  };
}

/* ==================================================================
   La vista Formularios: filtros y cuentas.
   ================================================================== */

export type FiltroMarca = "" | "unido" | "no-unido" | "sin-revisar" | "contactado" | "sin-contactar";

export interface FiltrosRegistros {
  /** La fecha del webinar (aaaa-mm-dd) o su id. Vacío: todos. */
  webinar: string;
  marca: FiltroMarca;
  q: string;
}

export function pasaMarca(r: RegistroForm, marca: FiltroMarca): boolean {
  switch (marca) {
    case "unido": return r.grupo === "unido";
    case "no-unido": return r.grupo === "no-unido";
    case "sin-revisar": return !r.grupo;
    case "contactado": return r.contactado;
    case "sin-contactar": return !r.contactado;
    default: return true;
  }
}

export const esDelWebinar = (r: RegistroForm, webinar: string): boolean =>
  !webinar || r.fechaWebinar === webinar || r.webinarId === webinar || (webinar === "sin" && !r.fechaWebinar && !r.webinarId);

export function filtrarRegistros(rs: RegistroForm[], f: FiltrosRegistros): RegistroForm[] {
  const t = sinAcentos(f.q);
  return rs.filter((r) => {
    if (!esDelWebinar(r, f.webinar) || !pasaMarca(r, f.marca)) return false;
    if (!t) return true;
    return [r.nombre, r.email, r.telefono, r.pais, r.notas, ...Object.values(r.utm ?? {}), ...r.respuestas.map((x) => x.respuesta)]
      .some((x) => x && sinAcentos(x).includes(t));
  });
}

export interface CuentaRegistros {
  total: number;
  unidos: number;
  noUnidos: number;
  sinRevisar: number;
  contactados: number;
  /** De los que no se unieron, a cuántos ya se les escribió. */
  noUnidosContactados: number;
  conTelefono: number;
}

export function contarRegistros(rs: RegistroForm[]): CuentaRegistros {
  const c: CuentaRegistros = { total: rs.length, unidos: 0, noUnidos: 0, sinRevisar: 0, contactados: 0, noUnidosContactados: 0, conTelefono: 0 };
  for (const r of rs) {
    if (r.grupo === "unido") c.unidos++;
    else if (r.grupo === "no-unido") c.noUnidos++;
    else c.sinRevisar++;
    if (r.contactado) c.contactados++;
    if (r.contactado && r.grupo !== "unido") c.noUnidosContactados++;
    if (r.telefonoNorm || r.telefono) c.conTelefono++;
  }
  return c;
}

/** El país en ISO de un registro, para el código de llamada y el link de WhatsApp. */
export const isoDePais = (pais?: string): string | undefined => {
  const p = normalizarPais(pais);
  return p.length === 2 && codigoDePais(p) ? p : undefined;
};
