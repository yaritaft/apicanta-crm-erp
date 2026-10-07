import type { Ajustes, CampoOpcionesCrm, Contacto, EstadoApp, Lead, Sesion } from "./types";
import { filasCrm, opcionesDe, partir, sinTildes, type FilaCrm } from "./crm";
import { diaDeNegocio } from "./dia-negocio";
import { EVENTOS, leerUtm, NOMBRE_FUNNEL } from "./utm-estandar";
import { CANCELADA, CON_CIERRE, estadoDe, NO_SE_PRESENTO, POR_VENIR, SIN_CARGAR, SIN_CIERRE } from "./estados";
import { conCorrecciones, corregidoDe, respuestaPerfil, type CampoPerfil, type Corregido } from "./perfil";
import type { CambiosLlamada } from "./store";

/* ==================================================================
   El CRM como una tabla fácil, como un Excel (Yari, 29/09): "lo fácil le
   gana a todo". Cada llamada con todo lo que se sabe de la persona, sin
   cargar nada a mano, y cada columna se filtra con un clic desde su
   título: se tildan los valores que se quieren ver.

   Las filas salen de las mismas agendas que el CRM de antes (lib/crm.ts)
   y suman lo que carga el closer en su EOD (lib/eod.ts) y lo que se
   deduce solo: por qué vía y con qué ad llegó, el país (del prefijo del
   teléfono) y la edad (si el formulario la pregunta).

   Y se corrige ahí mismo, en la celda, como en un Excel (02/10): ver
   «Editar», más abajo.

   Los estados son los dos del Airtable, los mismos en toda la app
   (lib/estados.ts): Estado Pre-Call y Estado de Llamada.
   ================================================================== */

export interface FilaTabla {
  id: string;
  fila: FilaCrm;
  sesion: Sesion;
  personaId: string;
  nombre: string;
  llamada: string;       // ISO
  dia: string;           // aaaa-mm-dd, en Argentina
  closer: string;
  /* Los dos estados de la llamada (lib/estados.ts). El de Llamada, el
     cargado o el que pone la app sola; vacío si no hay ninguno. */
  estadoPreCall: string;
  estadoLlamada: string;
  /* El Estado de Llamada lo puso la app (no vino, canceló, segunda agenda). */
  estadoAuto: boolean;
  /* Sin Estado de Llamada: «Sin cargar» si ya pasó, «Por venir» si no. */
  aviso: string;
  /* Lo que hizo el setter antes: 1° Mje Enviado, 1° Llamada… */
  preCall: string;
  /* Cómo terminó, para el Informe: Con cierre, Sin cierre, No se presentó…
     Se deduce del Estado de Llamada; no se carga. */
  resultado: string;
  objecion: string;
  oferta: string;        // Sí · No · ""
  cierre: string;        // aaaa-mm-dd
  via: string;
  ad: string;
  /* El ad sin copias ni formato (anguloDe): las copias de un anuncio son el mismo ángulo. */
  angulo: string;
  campania: string;
  pais: string;
  /* El país cargado en la persona; vacío si sale del prefijo del teléfono. */
  paisCargado: string;
  edad: string;
  tecnologias: string[];
  ingles: string;
  experiencia: string;
  formacion: string[];
  ingreso: string;
  inversion: string;
  calificada: string;    // Sí · No
  grabacion: string;
  venta: string;
  email: string;
  telefono: string;
  agendo: string;
  notas: string;
  /* Ya pasó, no se canceló y nadie cargó cómo terminó. */
  sinCargar: boolean;
  /* Lo que el equipo le corrigió a mano a la persona (lib/perfil.ts). */
  corregido: Corregido;
}

const SIN_CORREGIR: Corregido = {};

/* ---------- El país, por el prefijo del teléfono ----------
   Los de Calendly llegan con el + y el código del país. Sin el +, no se
   adivina. El más largo primero: +1 809 es República Dominicana. */
const PREFIJOS: [string, string][] = ([
  ["1809", "República Dominicana"], ["1829", "República Dominicana"], ["1849", "República Dominicana"],
  ["1787", "Puerto Rico"], ["1939", "Puerto Rico"],
  ["598", "Uruguay"], ["595", "Paraguay"], ["593", "Ecuador"], ["591", "Bolivia"],
  ["507", "Panamá"], ["506", "Costa Rica"], ["505", "Nicaragua"], ["504", "Honduras"], ["503", "El Salvador"], ["502", "Guatemala"],
  ["58", "Venezuela"], ["57", "Colombia"], ["56", "Chile"], ["55", "Brasil"], ["54", "Argentina"], ["53", "Cuba"],
  ["52", "México"], ["51", "Perú"], ["49", "Alemania"], ["44", "Reino Unido"], ["39", "Italia"], ["34", "España"],
  ["33", "Francia"], ["1", "Estados Unidos"],
] as [string, string][]).sort((a, b) => b[0].length - a[0].length);

export const PAISES = [...new Set(PREFIJOS.map(([, pais]) => pais))].sort((a, b) => a.localeCompare(b, "es"));

export function paisDeTelefono(tel?: string | null): string {
  const t = (tel ?? "").trim();
  if (!/^(\+|00)/.test(t)) return "";
  const n = t.replace(/^00/, "").replace(/\D/g, "");
  return PREFIJOS.find(([p]) => n.startsWith(p))?.[1] ?? "";
}

/* ---------- Por qué vía y con qué ad ---------- */

/* {utm_source} o {source}: los contactos guardan las dos formas. */
const utmDe = (u: Record<string, string> | undefined | null, k: string) => u?.[`utm_${k}`] ?? u?.[k] ?? "";
const esPauta = (u: Record<string, string> | undefined | null) =>
  /^(meta|facebook|fb|instagram|ig)$/i.test(utmDe(u, "source")) && /^(paid|cpc|ads?|pauta)$/i.test(utmDe(u, "medium"));

/** "Webinar · vivo", "Clase cero · replay", "VSL", "Setter"… */
export function viaDe(s: Pick<Sesion, "utm">, f: Pick<FilaCrm, "funnel">): string {
  const l = leerUtm(s.utm);
  if (l.funnel && EVENTOS.includes(l.funnel)) {
    const link = /^(vivo|replay|seguimiento)$/i.test(l.contenido ?? "") ? l.contenido!.toLowerCase()
      : l.momento === "vivo" ? "vivo" : l.momento === "despues" ? "después" : "";
    return link ? `${NOMBRE_FUNNEL[l.funnel]} · ${link}` : NOMBRE_FUNNEL[l.funnel];
  }
  if (utmDe(s.utm, "source") === "direct") return "Directo";
  return f.funnel || "Sin UTMs";
}

/** El ad: el de la agenda si vino de la pauta; si no, el de cómo llegó la
 *  persona la primera vez (el formulario del webinar, por ejemplo). */
export function adDe(s: Pick<Sesion, "utm">, c?: Pick<Contacto, "utm"> | null): { ad: string; campania: string } {
  if (esPauta(s.utm)) return { ad: utmDe(s.utm, "content"), campania: utmDe(s.utm, "campaign") };
  if (esPauta(c?.utm)) return { ad: utmDe(c?.utm, "content"), campania: utmDe(c?.utm, "campaign") };
  return { ad: "", campania: "" };
}

/** El ángulo de un ad: su nombre sin las copias ni el formato del archivo.
    En Meta los ads se llaman como su video y se duplican («MERCADO
    SATURADO.mp4 - Copia 2»): todas las copias son el mismo ángulo. */
export function anguloDe(ad: string): string {
  let s = ad.trim();
  for (let i = 0; i < 4; i++) {
    const antes = s;
    s = s.replace(/\s*-\s*copia(\s*\d+)?\s*$/i, "").replace(/\s*\.(mp4|mov|m4v|webm|jpe?g|png|gif|m)\s*$/i, "").trim();
    if (s === antes) break;
  }
  return s.replace(/\s+/g, " ");
}

/* ---------- Las filas ---------- */

export function filasTabla(
  e: Pick<EstadoApp, "sesiones" | "contactos" | "ajustes" | "webinars" | "ventas" | "productos" | "leads">,
  ahora = Date.now(),
): FilaTabla[] {
  const contactos = new Map(e.contactos.map((c) => [c.id, c]));
  const leads = new Map(e.leads.map((l) => [l.id, l]));
  const estados = opcionesDe(e.ajustes, "estadoLlamada");
  return filasCrm(e).map((f) => {
    const s = f.sesion;
    const c = contactos.get(s.contactoId ?? "") ?? contactos.get(s.leadId ?? "");
    const l = leads.get(s.leadId ?? "");
    const corregido = corregidoDe(c, l);
    const qa = conCorrecciones(s.respuestas, corregido);
    const { ad, campania } = adDe(s, c);
    /* El mismo estado que se ve en la grilla, la Agenda y la ficha. */
    const ver = estadoDe(s, { opciones: estados, auto: f.estadoAuto ? f.estadoLlamada : "", venta: Boolean(f.venta), ahora });
    return {
      id: f.id, fila: f, sesion: s, personaId: f.personaId,
      nombre: f.nombre, llamada: s.inicia, dia: diaDeNegocio(s.inicia), closer: f.closer,
      estadoPreCall: f.estadoPreCall,
      estadoLlamada: ver.vacio ? "" : ver.texto,
      estadoAuto: ver.auto && !ver.vacio,
      aviso: ver.vacio ? ver.texto : "",
      preCall: f.preCall,
      resultado: ver.desenlace,
      objecion: s.objecion ?? "",
      oferta: s.hizoOferta === true ? "Sí" : s.hizoOferta === false ? "No" : "",
      cierre: s.cierreEstimado ?? "",
      via: viaDe(s, f),
      ad, angulo: anguloDe(ad), campania,
      pais: c?.pais?.trim() || l?.pais?.trim() || paisDeTelefono(f.telefono),
      paisCargado: c?.pais?.trim() || l?.pais?.trim() || "",
      edad: respuestaPerfil(qa, "edad") ?? "",
      tecnologias: f.lenguajes,
      ingles: f.ingles,
      experiencia: f.anios,
      formacion: f.formacion,
      ingreso: f.ingreso,
      inversion: f.inversion,
      calificada: f.calificada,
      grabacion: f.grabacion,
      venta: f.venta?.texto ?? "",
      email: f.email,
      telefono: f.telefono,
      agendo: s.creadoEn,
      notas: f.notas,
      sinCargar: ver.sinCargar,
      corregido: corregido ?? SIN_CORREGIR,
    };
  });
}

/* ---------- Las columnas ---------- */

export type ClaveColumna =
  | "llamada" | "nombre" | "closer" | "estadoPreCall" | "estadoLlamada" | "preCall" | "objecion" | "oferta" | "cierre"
  | "via" | "ad" | "angulo" | "campania" | "pais" | "edad" | "tecnologias" | "ingles" | "experiencia" | "formacion"
  | "ingreso" | "inversion" | "calificada" | "grabacion" | "venta" | "email" | "telefono" | "agendo" | "notas";

export interface ColumnaTabla {
  clave: ClaveColumna;
  titulo: string;
  grupo: "Llamada" | "Resultado" | "Origen" | "Perfil" | "Contacto";
  /* Los valores por los que se filtra (una lista: una fila con varios
     lenguajes aparece tildando cualquiera de ellos). */
  valores: (f: FilaTabla) => string[];
  /* Cómo se ordena; si falta, por el primer valor. */
  orden?: (f: FilaTabla) => string | number;
  /* El texto que mira «contiene», si no son los valores del filtro (las
     notas se filtran por «Con notas», pero se busca en lo que dicen). */
  texto?: (f: FilaTabla) => string;
  /* Los valores son días (aaaa-mm-dd): se filtra desde y hasta. */
  fecha?: boolean;
  ancho?: number;
}

export const VACIAS = "(Vacías)";
const uno = (x: string) => [x || VACIAS];
const varios = (xs: string[]) => (xs.length ? xs : [VACIAS]);

export const COLUMNAS: ColumnaTabla[] = [
  { clave: "llamada", titulo: "Llamada", grupo: "Llamada", valores: (f) => [f.dia], orden: (f) => f.llamada, fecha: true, ancho: 150 },
  { clave: "nombre", titulo: "Persona", grupo: "Llamada", valores: (f) => uno(f.nombre), ancho: 220 },
  { clave: "closer", titulo: "Closer", grupo: "Llamada", valores: (f) => uno(f.closer), ancho: 150 },
  { clave: "estadoPreCall", titulo: "Estado Pre-Call", grupo: "Llamada", valores: (f) => uno(f.estadoPreCall), ancho: 150 },
  /* Sin estado se filtra por el aviso: «Sin cargar» o «Por venir». */
  { clave: "estadoLlamada", titulo: "Estado de Llamada", grupo: "Llamada", valores: (f) => uno(f.estadoLlamada || f.aviso), ancho: 190 },
  { clave: "preCall", titulo: "Pre-Call", grupo: "Llamada", valores: (f) => uno(f.preCall), ancho: 150 },
  { clave: "objecion", titulo: "Objeción", grupo: "Resultado", valores: (f) => uno(f.objecion), ancho: 170 },
  { clave: "oferta", titulo: "¿Oferta?", grupo: "Resultado", valores: (f) => uno(f.oferta), ancho: 100 },
  { clave: "cierre", titulo: "Cierre estimado", grupo: "Resultado", valores: (f) => uno(f.cierre), fecha: true, ancho: 140 },
  /* «La carga otra persona»: el closer avisó, en la puerta del cierre del día, que la venta de esta compra la carga otra persona. */
  { clave: "venta", titulo: "Venta", grupo: "Resultado", valores: (f) => [f.venta ? "Con venta" : f.sesion.ventaPorOtro ? "La carga otra persona" : "Sin venta"], orden: (f) => f.venta, texto: (f) => f.venta, ancho: 190 },
  { clave: "via", titulo: "Vía", grupo: "Origen", valores: (f) => uno(f.via), ancho: 170 },
  { clave: "ad", titulo: "Ad", grupo: "Origen", valores: (f) => uno(f.ad), ancho: 200 },
  { clave: "angulo", titulo: "Ángulo", grupo: "Origen", valores: (f) => uno(f.angulo), ancho: 190 },
  { clave: "campania", titulo: "Campaña", grupo: "Origen", valores: (f) => uno(f.campania), ancho: 200 },
  { clave: "pais", titulo: "País", grupo: "Perfil", valores: (f) => uno(f.pais), ancho: 130 },
  { clave: "edad", titulo: "Edad", grupo: "Perfil", valores: (f) => uno(f.edad), ancho: 90 },
  { clave: "tecnologias", titulo: "Tecnologías", grupo: "Perfil", valores: (f) => varios(f.tecnologias), orden: (f) => f.tecnologias.join(", "), ancho: 220 },
  { clave: "ingles", titulo: "Inglés", grupo: "Perfil", valores: (f) => uno(f.ingles), ancho: 200 },
  { clave: "experiencia", titulo: "Experiencia", grupo: "Perfil", valores: (f) => uno(f.experiencia), ancho: 130 },
  { clave: "formacion", titulo: "Formación", grupo: "Perfil", valores: (f) => varios(f.formacion), orden: (f) => f.formacion.join(", "), ancho: 200 },
  { clave: "ingreso", titulo: "Gana por mes", grupo: "Perfil", valores: (f) => uno(f.ingreso), ancho: 170 },
  { clave: "inversion", titulo: "Puede invertir", grupo: "Perfil", valores: (f) => uno(f.inversion), ancho: 240 },
  { clave: "calificada", titulo: "Calificada", grupo: "Perfil", valores: (f) => [f.calificada], ancho: 110 },
  { clave: "grabacion", titulo: "Grabación", grupo: "Resultado", valores: (f) => [f.grabacion ? "Con grabación" : "Sin grabación"], texto: (f) => f.grabacion, ancho: 120 },
  { clave: "email", titulo: "Email", grupo: "Contacto", valores: (f) => uno(f.email), ancho: 220 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Contacto", valores: (f) => uno(f.telefono), ancho: 160 },
  { clave: "agendo", titulo: "Agendó el", grupo: "Llamada", valores: (f) => [diaDeNegocio(f.agendo)], orden: (f) => f.agendo, fecha: true, ancho: 150 },
  { clave: "notas", titulo: "Notas", grupo: "Resultado", valores: (f) => [f.notas ? "Con notas" : "Sin notas"], texto: (f) => f.notas, ancho: 260 },
];

export const COLUMNA: Record<ClaveColumna, ColumnaTabla> = Object.fromEntries(COLUMNAS.map((c) => [c.clave, c])) as Record<ClaveColumna, ColumnaTabla>;

export const VISIBLES_POR_DEFECTO: ClaveColumna[] = [
  "llamada", "nombre", "closer", "estadoPreCall", "estadoLlamada", "objecion", "oferta", "cierre", "via", "ad", "pais",
  "tecnologias", "ingles", "ingreso", "inversion", "calificada", "grabacion", "venta",
];

/* Las columnas de antes de que los estados fueran uno solo: quien tenía
   elegida «Resultado» ve en su lugar los dos estados de ahora (el «Estado»
   de antes, agendada / hecha / no vino, lo dice el Estado de Llamada). */
export const COLUMNAS_DE_ANTES: Record<string, ClaveColumna[]> = { resultado: ["estadoPreCall", "estadoLlamada"], estado: ["estadoLlamada"] };

/* Las columnas que guardan una opción del Airtable (Ajustes → crm.opciones). */
export const CAMPO_DE_OPCIONES: Partial<Record<ClaveColumna, CampoOpcionesCrm>> = {
  estadoPreCall: "estadoPreCall", estadoLlamada: "estadoLlamada", preCall: "preCall",
};

/* ---------- Editar ----------
   Como en un Excel: se corrige en la celda. Lo que es de la llamada (el
   closer, sus dos estados, la objeción, la oferta, el cierre estimado, la
   grabación y las notas) se guarda en la llamada. Lo que es
   de la persona (el nombre, el mail, el teléfono, el país y lo que
   contestó al agendar) se guarda en la persona y cambia en todas sus
   llamadas. Lo que sale solo no se edita: cuándo es la llamada y cuándo
   agendó (Calendly), por dónde llegó y con qué ad (el link), si califica
   (una cuenta) y la venta (se carga en Ventas). */

export type EditorColumna = "texto" | "largo" | "fecha" | "opciones" | "sugerencias" | "lista";

export const EDITOR: Partial<Record<ClaveColumna, EditorColumna>> = {
  nombre: "texto", email: "texto", telefono: "texto",
  closer: "opciones", estadoPreCall: "opciones", estadoLlamada: "opciones", preCall: "opciones", objecion: "opciones", oferta: "opciones",
  cierre: "fecha", grabacion: "texto", notas: "largo",
  pais: "sugerencias", edad: "texto", ingles: "sugerencias", experiencia: "sugerencias", ingreso: "sugerencias", inversion: "sugerencias",
  tecnologias: "lista", formacion: "lista",
};

/* Por qué no se edita cada columna que sale sola. */
export const POR_QUE_NO: Partial<Record<ClaveColumna, string>> = {
  llamada: "El día y la hora los pone Calendly: se cambian reprogramando.",
  agendo: "Cuándo agendó, según Calendly.",
  via: "Sale del link con el que agendó.",
  ad: "Sale del link del anuncio con el que llegó.",
  angulo: "Sale del nombre del anuncio.",
  campania: "Sale del link del anuncio con el que llegó.",
  calificada: "Se calcula sola: puede invertir 1000 USD o más, inglés conversacional y carrera. Cambia si corregís esos datos.",
  venta: "La venta se carga en Ventas o en el cierre del día.",
};

const PERFIL_DE: Partial<Record<ClaveColumna, CampoPerfil | "pais">> = {
  pais: "pais", edad: "edad", tecnologias: "tecnologias", ingles: "ingles", experiencia: "experiencia",
  formacion: "formacion", ingreso: "ingreso", inversion: "inversion",
};

/** Lo que hay en la celda, como texto para editar. */
export function valorEditable(f: FilaTabla, clave: ClaveColumna): string {
  switch (clave) {
    /* El que alguien cargó: el automático y los avisos no son un valor. */
    case "estadoLlamada": return f.sesion.estadoLlamada ?? "";
    case "tecnologias": return f.tecnologias.join(", ");
    case "formacion": return f.formacion.join(", ");
    case "grabacion": return f.grabacion;
    case "notas": return f.notas;
    default: return String((f as unknown as Record<string, unknown>)[clave] ?? "");
  }
}

/* Lo que hay que escribir para dejar una celda con un valor. */
export type Escritura =
  | { tipo: "llamada"; id: string; cambios: CambiosLlamada; detalle: string }
  | { tipo: "persona"; id: string; cambios: { nombre?: string; email?: string; telefono?: string }; detalle: string }
  | { tipo: "perfil"; id: string; campo: CampoPerfil | "pais"; valor: string; detalle: string };

/** Qué se guarda al dejar `valor` en esa celda; null si la columna no se
    edita o ya decía eso. Vaciar un dato de la persona que contestó en
    Calendly vuelve a lo que contestó. */
export function escrituraDe(
  f: FilaTabla, clave: ClaveColumna, valor: string,
  ctx: { ajustes: Ajustes; quien: string; cuando: string },
): Escritura | null {
  const editor = EDITOR[clave];
  if (!editor) return null;
  const titulo = COLUMNA[clave].titulo;
  const lista = editor === "lista";
  /* Las listas (tecnologías, formación) se escriben con comas y se guardan una por renglón. */
  const limpio = lista ? valor.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).join(", ") : valor.trim();
  if (limpio === valorEditable(f, clave).trim()) return null;
  const quien = f.nombre || "Sin nombre";
  const detalle = limpio ? `${quien}: ${titulo} → ${limpio.length > 60 ? `${limpio.slice(0, 60)}…` : limpio}.` : `${quien}: se vació ${titulo}.`;
  const s = f.sesion;

  if (clave === "nombre" || clave === "email" || clave === "telefono") {
    /* Vacío no es un dato: no borra el nombre, el mail ni el teléfono. */
    return limpio ? { tipo: "persona", id: f.personaId, cambios: { [clave]: limpio }, detalle } : null;
  }
  const perfil = PERFIL_DE[clave];
  if (perfil) return { tipo: "perfil", id: f.personaId, campo: perfil, valor: lista ? limpio.split(", ").join("\n") : limpio, detalle };

  const llamada = (cambios: CambiosLlamada): Escritura => ({ tipo: "llamada", id: s.id, cambios, detalle });
  switch (clave) {
    case "closer": return limpio ? llamada({ anfitrion: limpio }) : null;
    /* Una opción del Airtable, o vacío. El Estado de Llamada además deja
       la agenda como hecha, que no vino o cancelada (lo hace el store). */
    case "estadoLlamada": case "estadoPreCall": case "preCall":
      return !limpio || opcionesDe(ctx.ajustes, clave).some((o) => o.nombre === limpio) ? llamada({ [clave]: limpio }) : null;
    case "objecion": return llamada({ objecion: limpio || undefined });
    case "oferta": return llamada({ hizoOferta: limpio === "Sí" ? true : limpio === "No" ? false : undefined });
    case "cierre": return llamada({ cierreEstimado: /^\d{4}-\d{2}-\d{2}$/.test(limpio) ? limpio : undefined });
    case "grabacion": return llamada({ grabacion: limpio });
    case "notas": return llamada({ notas: valor.trim() });
    default: return null;
  }
}

/* ---------- El perfil, para la ficha ----------
   Lo que se sabe de la persona, cada dato una sola vez: el de su llamada
   más nueva que lo tenga y, si nunca agendó, lo que hay en su contacto. */

export interface DatoPerfil { clave: ClaveColumna; campo: CampoPerfil | "pais"; titulo: string; valor: string; corregido: boolean }

const COLUMNAS_PERFIL: ClaveColumna[] = ["pais", "edad", "tecnologias", "ingles", "experiencia", "formacion", "ingreso", "inversion"];
const NIVEL_INGLES: Record<string, string> = { ninguno: "Ninguno", basico: "Básico", intermedio: "Intermedio", conversacional: "Conversacional", nativo: "Nativo" };

/** Las llamadas de una persona, de la más nueva a la más vieja. */
export function filasDePersona(filas: FilaTabla[], sesionIds: Iterable<string>): FilaTabla[] {
  const ids = new Set(sesionIds);
  return filas.filter((f) => ids.has(f.id)).sort((a, b) => b.llamada.localeCompare(a.llamada));
}

/** `filas`: las llamadas de la persona, de la más nueva a la más vieja. */
export function perfilDe(filas: FilaTabla[], c?: Contacto | null, l?: Lead | null): DatoPerfil[] {
  const corregido = filas[0]?.corregido ?? corregidoDe(c, l) ?? {};
  const anios = c?.aniosExperiencia ?? l?.aniosExperiencia;
  const deLaPersona: Partial<Record<ClaveColumna, string>> = {
    pais: c?.pais ?? l?.pais ?? "",
    tecnologias: partir(c?.tecnologias).join(", "),
    ingles: NIVEL_INGLES[c?.inglesNivel ?? l?.inglesNivel ?? ""] ?? "",
    experiencia: anios === undefined || anios === null ? "" : `${anios} ${anios === 1 ? "año" : "años"}`,
    formacion: partir(c?.formacion).join(", "),
    ingreso: c?.sueldoUsd ?? "",
  };
  return COLUMNAS_PERFIL.map((clave) => {
    const campo = PERFIL_DE[clave]!;
    const propio = campo === "pais" ? undefined : corregido[campo];
    const deLlamada = filas.map((f) => valorEditable(f, clave)).find((v) => v) ?? "";
    return {
      clave, campo, titulo: COLUMNA[clave].titulo, corregido: Boolean(propio),
      valor: deLlamada || (propio ? partir(propio).join(", ") : "") || deLaPersona[clave] || "",
    };
  });
}

/** Un valor escrito en una celda, como se guarda: las listas (tecnologías,
    formación), una por renglón. */
export function valorParaGuardar(clave: ClaveColumna, valor: string): string {
  return EDITOR[clave] === "lista" ? valor.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).join("\n") : valor.trim();
}

/* ---------- Filtrar ----------
   Como en Excel, en la misma columna: en su lista se destilda lo que no
   se quiere ver ("sin") o, con un clic, se deja sólo un valor ("solo").
   Y lo que en Excel son los «filtros de texto» y «de fecha»: que el texto
   contenga (o no) algo, y un desde / hasta en las columnas de fecha. Todo
   va en el link:
     ?solo-pais=Argentina|México   ?sin-estadoLlamada=Por venir
     ?con-notas=cuotas   ?nocon-ad=copia   ?desde-agendo=2026-09-01 */

export interface FiltroColumna {
  modo: "solo" | "sin";
  valores: string[];
  contiene?: string;
  noContiene?: string;
  /* aaaa-mm-dd, en las columnas de fecha. */
  desde?: string;
  hasta?: string;
}
export type FiltrosTabla = Partial<Record<ClaveColumna, FiltroColumna>>;

/** Si el filtro de una columna recorta algo. */
export const hayFiltro = (fc?: FiltroColumna | null): fc is FiltroColumna =>
  Boolean(fc && (fc.valores.length || fc.contiene || fc.noContiene || fc.desde || fc.hasta));

/** Si un valor se ve con la lista de su columna. */
export const seVe = (valor: string, fc?: FiltroColumna) =>
  !fc || !fc.valores.length || (fc.modo === "solo" ? fc.valores.includes(valor) : !fc.valores.includes(valor));

/** Lo que dice la celda, para «contiene». */
export const textoDeColumna = (f: FilaTabla, col: ColumnaTabla) =>
  col.texto ? col.texto(f) : col.valores(f).filter((v) => v !== VACIAS).join(", ");

const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

export function pasaFiltros(f: FilaTabla, filtros: FiltrosTabla, salvo?: ClaveColumna): boolean {
  for (const [k, fc] of Object.entries(filtros) as [ClaveColumna, FiltroColumna][]) {
    if (k === salvo || !hayFiltro(fc)) continue;
    const col = COLUMNA[k];
    if (!col) continue;
    const valores = col.valores(f);
    /* Una fila con varios valores (lenguajes) se ve si alguno se ve. */
    if (!valores.some((v) => seVe(v, fc))) return false;
    if (fc.contiene || fc.noContiene) {
      const t = sinTildes(textoDeColumna(f, col));
      if (fc.contiene && !t.includes(sinTildes(fc.contiene))) return false;
      if (fc.noContiene && t.includes(sinTildes(fc.noContiene))) return false;
    }
    if (fc.desde || fc.hasta) {
      /* Sin fecha no entra en ningún período. */
      const d = valores[0];
      if (!ES_DIA.test(d) || (fc.desde && d < fc.desde) || (fc.hasta && d > fc.hasta)) return false;
    }
  }
  return true;
}

const SEP = "|";
export const PREFIJOS_FILTRO = ["solo-", "sin-", "con-", "nocon-", "desde-", "hasta-"] as const;

/** Los filtros de la URL. */
export function filtrosDeURL(params: URLSearchParams): FiltrosTabla {
  const out: FiltrosTabla = {};
  const de = (clave: ClaveColumna) => (out[clave] ??= { modo: "solo", valores: [] });
  for (const [k, v] of params.entries()) {
    const m = /^(solo|sin|con|nocon|desde|hasta)-(.+)$/.exec(k);
    if (!m || !(m[2] in COLUMNA) || !v) continue;
    const clave = m[2] as ClaveColumna;
    if (m[1] === "solo" || m[1] === "sin") {
      const valores = v.split(SEP).filter(Boolean);
      if (valores.length) Object.assign(de(clave), { modo: m[1], valores });
    } else if (m[1] === "con") de(clave).contiene = v;
    else if (m[1] === "nocon") de(clave).noContiene = v;
    else if (ES_DIA.test(v) && COLUMNA[clave].fecha) de(clave)[m[1] as "desde" | "hasta"] = v;
  }
  for (const k of Object.keys(out) as ClaveColumna[]) if (!hayFiltro(out[k])) delete out[k];
  return out;
}

/** Lo que hay que escribir en la URL para dejar una columna con este filtro. */
export function filtroAURL(clave: ClaveColumna, fc: FiltroColumna | null): Record<string, string | null> {
  return {
    [`solo-${clave}`]: fc?.modo === "solo" && fc.valores.length ? fc.valores.join(SEP) : null,
    [`sin-${clave}`]: fc?.modo === "sin" && fc.valores.length ? fc.valores.join(SEP) : null,
    [`con-${clave}`]: fc?.contiene?.trim() || null,
    [`nocon-${clave}`]: fc?.noContiene?.trim() || null,
    [`desde-${clave}`]: fc?.desde || null,
    [`hasta-${clave}`]: fc?.hasta || null,
  };
}

/** Lo que recorta un filtro, en palabras, para su pastilla. */
export function textoDeFiltro(fc: FiltroColumna, valor: (v: string) => string = (v) => v): string {
  const partes: string[] = [];
  if (fc.valores.length) partes.push(`${fc.modo === "sin" ? "sin " : ""}${fc.valores.map(valor).join(", ")}`);
  if (fc.contiene) partes.push(`contiene «${fc.contiene}»`);
  if (fc.noContiene) partes.push(`no contiene «${fc.noContiene}»`);
  if (fc.desde && fc.hasta) partes.push(`del ${valor(fc.desde)} al ${valor(fc.hasta)}`);
  else if (fc.desde) partes.push(`desde el ${valor(fc.desde)}`);
  else if (fc.hasta) partes.push(`hasta el ${valor(fc.hasta)}`);
  return partes.join(" · ");
}

export function coincideBusqueda(f: FilaTabla, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.nombre, f.email, f.telefono, f.closer, f.notas].some((x) => sinTildes(x ?? "").includes(t));
}

/** Los valores de una columna para su filtro, con cuántas filas tiene cada
 *  uno según los DEMÁS filtros (como en Excel: lo que ya está filtrado en
 *  otra columna no aparece). `orden`: el de los valores, si no es el
 *  alfabético (las opciones de un estado van como en el Airtable). */
export function opcionesDeColumna(filas: FilaTabla[], filtros: FiltrosTabla, clave: ClaveColumna, orden?: string[]): { valor: string; cuenta: number }[] {
  const col = COLUMNA[clave];
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (!pasaFiltros(f, filtros, clave)) continue;
    for (const v of new Set(col.valores(f))) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  /* Lo elegido sigue en la lista aunque no quede ninguna fila con eso. */
  for (const v of filtros[clave]?.valores ?? []) if (!cuenta.has(v)) cuenta.set(v, 0);
  return [...cuenta.entries()]
    .map(([valor, n]) => ({ valor, cuenta: n }))
    .sort((a, b) => {
      if (a.valor === VACIAS) return 1;
      if (b.valor === VACIAS) return -1;
      if (orden) {
        const ia = orden.indexOf(a.valor), ib = orden.indexOf(b.valor);
        if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      }
      /* Las fechas, de la más nueva a la más vieja. */
      if (col.fecha) return b.valor.localeCompare(a.valor);
      return a.valor.localeCompare(b.valor, "es", { numeric: true });
    });
}

/* ---------- Ordenar ----------
   Por una columna, desde su título. Y por más de una (el closer y, dentro
   de cada uno, la fecha): «después por ésta» suma un criterio. En el link
   van en orden, con un guión para "de mayor a menor":
     ?orden=closer,-llamada */

export interface OrdenColumna { clave: ClaveColumna; desc: boolean }

export const ORDEN_POR_DEFECTO: OrdenColumna[] = [{ clave: "llamada", desc: true }];
export const MAX_ORDENES = 3;

export function ordenesDeURL(valor: string | null | undefined): OrdenColumna[] {
  const out: OrdenColumna[] = [];
  for (const x of (valor ?? "").split(",")) {
    const desc = x.startsWith("-");
    const clave = (desc ? x.slice(1) : x) as ClaveColumna;
    if (clave in COLUMNA && !out.some((o) => o.clave === clave)) out.push({ clave, desc });
  }
  return out.length ? out.slice(0, MAX_ORDENES) : ORDEN_POR_DEFECTO;
}

const enTexto = (os: OrdenColumna[]) => os.map((o) => `${o.desc ? "-" : ""}${o.clave}`).join(",");

/** null si es el orden de siempre: no se escribe en el link. */
export function ordenesAURL(os: OrdenColumna[]): string | null {
  const t = enTexto(os);
  return !t || t === enTexto(ORDEN_POR_DEFECTO) ? null : t;
}

/** `ordenValores`: el orden propio de los valores de una columna (las
    opciones de un estado, como en el Airtable). Lo vacío va siempre al
    final, se ordene para donde se ordene. */
export function ordenarFilas(
  filas: FilaTabla[], ordenes: OrdenColumna[], ordenValores: Partial<Record<ClaveColumna, string[]>> = {},
): FilaTabla[] {
  const criterios = ordenes.map((o) => {
    const col = COLUMNA[o.clave];
    const lista = ordenValores[o.clave];
    const valor = (f: FilaTabla): string | number => {
      if (lista) {
        const v = col.valores(f)[0];
        const i = lista.indexOf(v);
        return v === VACIAS ? "" : i >= 0 ? i : lista.length + (v === SIN_CARGAR ? 0 : 1);
      }
      const v = col.orden ? col.orden(f) : col.valores(f)[0];
      return v === VACIAS ? "" : v;
    };
    return { valor, signo: o.desc ? -1 : 1 };
  });
  if (!criterios.length) return filas;
  /* Los valores se calculan una vez por fila, no en cada comparación. */
  const claves = new Map(filas.map((f) => [f, criterios.map((c) => c.valor(f))]));
  return [...filas].sort((a, b) => {
    const va = claves.get(a)!, vb = claves.get(b)!;
    for (let i = 0; i < criterios.length; i++) {
      const x = va[i], y = vb[i];
      if (x === y) continue;
      if (x === "") return 1;
      if (y === "") return -1;
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
      if (cmp !== 0) return cmp * criterios[i].signo;
    }
    return 0;
  });
}

/* ---------- El informe: cuánto se cierra y por qué no ----------
   Con cierre, sin cierre y no se presentó salen del Estado de Llamada de
   cada una (lib/estados.ts: desenlaceDe). */

export interface NumerosResumen {
  llamadas: number;
  /* Las que ya pasaron y no se cancelaron. */
  pasaron: number;
  presentaron: number;
  cierres: number;
  sinCierre: number;
  noVino: number;
  sinCargar: number;
  /* Cierres sobre los que se presentaron. */
  pctCierre: number | null;
  objeciones: { objecion: string; n: number }[];
}

const SE_PRESENTO = new Set<string>([CON_CIERRE, SIN_CIERRE]);

export function resumenDe(filas: FilaTabla[]): NumerosResumen {
  const r: NumerosResumen = { llamadas: filas.length, pasaron: 0, presentaron: 0, cierres: 0, sinCierre: 0, noVino: 0, sinCargar: 0, pctCierre: null, objeciones: [] };
  const obj = new Map<string, number>();
  for (const f of filas) {
    if (f.resultado !== CANCELADA && f.resultado !== POR_VENIR) r.pasaron++;
    if (SE_PRESENTO.has(f.resultado)) r.presentaron++;
    if (f.resultado === CON_CIERRE) r.cierres++;
    if (f.resultado === SIN_CIERRE) {
      r.sinCierre++;
      obj.set(f.objecion || "Sin objeción cargada", (obj.get(f.objecion || "Sin objeción cargada") ?? 0) + 1);
    }
    if (f.resultado === NO_SE_PRESENTO) r.noVino++;
    if (f.sinCargar) r.sinCargar++;
  }
  r.pctCierre = r.presentaron > 0 ? (r.cierres / r.presentaron) * 100 : null;
  r.objeciones = [...obj.entries()].map(([objecion, n]) => ({ objecion, n })).sort((a, b) => b.n - a.n || a.objecion.localeCompare(b.objecion));
  return r;
}

export interface FilaDimension extends NumerosResumen { valor: string }

/** Los mismos números abiertos por una columna: por país, por tecnología,
 *  por ad… Una fila con varios lenguajes cuenta en cada uno. */
export function porDimension(filas: FilaTabla[], clave: ClaveColumna): FilaDimension[] {
  const col = COLUMNA[clave];
  const grupos = new Map<string, FilaTabla[]>();
  for (const f of filas) for (const v of new Set(col.valores(f))) grupos.set(v, [...(grupos.get(v) ?? []), f]);
  return [...grupos.entries()]
    .map(([valor, fs]) => ({ valor, ...resumenDe(fs) }))
    .sort((a, b) => (a.valor === VACIAS ? 1 : b.valor === VACIAS ? -1 : b.presentaron - a.presentaron || b.llamadas - a.llamadas));
}

/* Las columnas que tienen sentido para abrir el análisis. */
export const DIMENSIONES: ClaveColumna[] = ["objecion", "estadoLlamada", "estadoPreCall", "pais", "edad", "tecnologias", "ingreso", "inversion", "ingles", "experiencia", "angulo", "ad", "via", "closer", "calificada"];
