import type { Ajustes, Contacto, EstadoApp, EstadoSesion, Lead, ResultadoLlamada, Sesion } from "./types";
import { filasCrm, opcionesDe, partir, sinTildes, type FilaCrm } from "./crm";
import { diaDeNegocio } from "./dia-negocio";
import { EVENTOS, leerUtm, NOMBRE_FUNNEL } from "./utm-estandar";
import { cambiosDelEod, respuestaDe, TEXTO_RESULTADO } from "./eod";
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
  estado: string;
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

const ESTADO: Record<EstadoSesion, string> = { agendada: "Agendada", hecha: "Hecha", "no-show": "No vino", cancelada: "Cancelada" };
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
  const deEstado = new Map(estados.map((o) => [o.nombre, o]));
  return filasCrm(e).map((f) => {
    const s = f.sesion;
    const c = contactos.get(s.contactoId ?? "") ?? contactos.get(s.leadId ?? "");
    const l = leads.get(s.leadId ?? "");
    const corregido = corregidoDe(c, l);
    const qa = conCorrecciones(s.respuestas, corregido);
    const { ad, campania } = adDe(s, c);
    const paso = Date.parse(s.inicia) <= ahora;
    /* Lo que cargó el closer manda; si no, lo que se sabe: la venta, que no
       vino, el Estado de Llamada del CRM de antes. */
    const op = deEstado.get(s.estadoLlamada ?? "");
    const resultado = s.resultado ? TEXTO_RESULTADO[s.resultado]
      : f.venta ? TEXTO_RESULTADO.compro
        : s.estado === "cancelada" ? "Cancelada"
          : s.estado === "no-show" || op?.llamada === "no-show" ? TEXTO_RESULTADO["no-vino"]
            : op?.oportunidad && op.oportunidad !== "perdida" && op.oportunidad !== "devolucion" ? TEXTO_RESULTADO.compro
              : op?.llamada === "hecha" || op?.oportunidad === "perdida" ? TEXTO_RESULTADO["no-compro"]
                : paso ? "Sin cargar" : "Por venir";
    return {
      id: f.id, fila: f, sesion: s, personaId: f.personaId,
      nombre: f.nombre, llamada: s.inicia, dia: diaDeNegocio(s.inicia), closer: f.closer,
      estado: ESTADO[s.estado] ?? s.estado,
      resultado,
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
      sinCargar: resultado === "Sin cargar",
      corregido: corregido ?? SIN_CORREGIR,
    };
  });
}

/* ---------- Las columnas ---------- */

export type ClaveColumna =
  | "llamada" | "nombre" | "closer" | "estado" | "resultado" | "objecion" | "oferta" | "cierre"
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
  /* El orden de los valores en el filtro, si no es el alfabético. */
  ordenValores?: string[];
  ancho?: number;
}

export const VACIAS = "(Vacías)";
const uno = (x: string) => [x || VACIAS];
const varios = (xs: string[]) => (xs.length ? xs : [VACIAS]);

export const ORDEN_RESULTADO = ["Con cierre", "Sin cierre", "No se presentó", "Reprogramó", "Sin cargar", "Por venir", "Cancelada"];

export const COLUMNAS: ColumnaTabla[] = [
  { clave: "llamada", titulo: "Llamada", grupo: "Llamada", valores: (f) => [f.dia], orden: (f) => f.llamada, ancho: 150 },
  { clave: "nombre", titulo: "Persona", grupo: "Llamada", valores: (f) => uno(f.nombre), ancho: 220 },
  { clave: "closer", titulo: "Closer", grupo: "Llamada", valores: (f) => uno(f.closer), ancho: 150 },
  { clave: "estado", titulo: "Estado", grupo: "Llamada", valores: (f) => [f.estado], ordenValores: ["Agendada", "Hecha", "No vino", "Cancelada"], ancho: 110 },
  { clave: "resultado", titulo: "Resultado", grupo: "Resultado", valores: (f) => [f.resultado], ordenValores: ORDEN_RESULTADO,
    orden: (f) => ORDEN_RESULTADO.indexOf(f.resultado), ancho: 140 },
  { clave: "objecion", titulo: "Objeción", grupo: "Resultado", valores: (f) => uno(f.objecion), ancho: 170 },
  { clave: "oferta", titulo: "¿Oferta?", grupo: "Resultado", valores: (f) => uno(f.oferta), ancho: 100 },
  { clave: "cierre", titulo: "Cierre estimado", grupo: "Resultado", valores: (f) => uno(f.cierre), ancho: 140 },
  { clave: "venta", titulo: "Venta", grupo: "Resultado", valores: (f) => [f.venta ? "Con venta" : "Sin venta"], orden: (f) => f.venta, ancho: 190 },
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
  { clave: "grabacion", titulo: "Grabación", grupo: "Resultado", valores: (f) => [f.grabacion ? "Con grabación" : "Sin grabación"], ancho: 120 },
  { clave: "email", titulo: "Email", grupo: "Contacto", valores: (f) => uno(f.email), ancho: 220 },
  { clave: "telefono", titulo: "Teléfono", grupo: "Contacto", valores: (f) => uno(f.telefono), ancho: 160 },
  { clave: "agendo", titulo: "Agendó el", grupo: "Llamada", valores: (f) => [diaDeNegocio(f.agendo)], orden: (f) => f.agendo, ancho: 150 },
  { clave: "notas", titulo: "Notas", grupo: "Resultado", valores: (f) => [f.notas ? "Con notas" : "Sin notas"], ancho: 260 },
];

export const COLUMNA: Record<ClaveColumna, ColumnaTabla> = Object.fromEntries(COLUMNAS.map((c) => [c.clave, c])) as Record<ClaveColumna, ColumnaTabla>;

export const VISIBLES_POR_DEFECTO: ClaveColumna[] = [
  "llamada", "nombre", "closer", "resultado", "objecion", "oferta", "cierre", "via", "ad", "pais",
  "tecnologias", "ingles", "ingreso", "inversion", "calificada", "grabacion", "venta",
];

/* ---------- Editar ----------
   Como en un Excel: se corrige en la celda. Lo que es de la llamada (el
   closer, el estado, el resultado, la objeción, la oferta, el cierre
   estimado, la grabación y las notas) se guarda en la llamada. Lo que es
   de la persona (el nombre, el mail, el teléfono, el país y lo que
   contestó al agendar) se guarda en la persona y cambia en todas sus
   llamadas. Lo que sale solo no se edita: cuándo es la llamada y cuándo
   agendó (Calendly), por dónde llegó y con qué ad (el link), si califica
   (una cuenta) y la venta (se carga en Ventas). */

export type EditorColumna = "texto" | "largo" | "fecha" | "opciones" | "sugerencias" | "lista";

export const EDITOR: Partial<Record<ClaveColumna, EditorColumna>> = {
  nombre: "texto", email: "texto", telefono: "texto",
  closer: "opciones", estado: "opciones", resultado: "opciones", objecion: "opciones", oferta: "opciones",
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
const ESTADO_DE = Object.fromEntries(Object.entries(ESTADO).map(([k, v]) => [v, k])) as Record<string, EstadoSesion>;
const RESULTADO_DE = Object.fromEntries(Object.entries(TEXTO_RESULTADO).map(([k, v]) => [v, k])) as Record<string, ResultadoLlamada>;

export const OPCIONES_ESTADO = Object.values(ESTADO);
export const OPCIONES_RESULTADO = Object.values(TEXTO_RESULTADO);

/** Lo que hay en la celda, como texto para editar. */
export function valorEditable(f: FilaTabla, clave: ClaveColumna): string {
  switch (clave) {
    /* «Sin cargar», «Por venir» y «Cancelada» no son algo que se cargó. */
    case "resultado": return f.sesion.resultado ? TEXTO_RESULTADO[f.sesion.resultado] : "";
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
    case "estado": return ESTADO_DE[limpio] ? llamada({ estado: ESTADO_DE[limpio] }) : null;
    case "resultado": {
      const r = RESULTADO_DE[limpio];
      /* Vaciarlo deja la llamada sin cargar otra vez. */
      if (!r) return limpio ? null : llamada({ resultado: undefined, objecion: undefined, hizoOferta: undefined, cierreEstimado: undefined, eodEn: undefined, eodPor: undefined });
      const previa = respuestaDe(s);
      return llamada(cambiosDelEod(
        { resultado: r, objecion: s.objecion, hizoOferta: s.hizoOferta, cierreEstimado: previa?.resultado === "no-compro" ? previa.cierreEstimado : s.cierreEstimado },
        s, ctx.ajustes, ctx.quien, ctx.cuando));
    }
    case "objecion": {
      /* Una objeción dice que no cerró: si la llamada no tenía resultado
         (ni venta), queda «Sin cierre», como en el cierre del día. */
      if (!limpio || f.venta || s.resultado === "compro") return llamada({ objecion: limpio || undefined });
      const previa = respuestaDe(s);
      return llamada(cambiosDelEod(
        { resultado: "no-compro", objecion: limpio, hizoOferta: s.hizoOferta, cierreEstimado: previa?.resultado === "no-compro" ? previa.cierreEstimado : s.cierreEstimado },
        s, ctx.ajustes, ctx.quien, ctx.cuando));
    }
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
   Como en Excel: en la lista de cada columna se destilda lo que no se
   quiere ver ("sin") o, con un clic, se deja sólo un valor ("solo"). Van
   en el link: ?solo-pais=Argentina|México, ?sin-resultado=Por venir. */

export interface FiltroColumna { modo: "solo" | "sin"; valores: string[] }
export type FiltrosTabla = Partial<Record<ClaveColumna, FiltroColumna>>;

/** Si un valor se ve con el filtro de su columna. */
export const seVe = (valor: string, fc?: FiltroColumna) =>
  !fc || !fc.valores.length || (fc.modo === "solo" ? fc.valores.includes(valor) : !fc.valores.includes(valor));

export function pasaFiltros(f: FilaTabla, filtros: FiltrosTabla, salvo?: ClaveColumna): boolean {
  for (const [k, fc] of Object.entries(filtros) as [ClaveColumna, FiltroColumna][]) {
    if (k === salvo || !fc?.valores.length) continue;
    const col = COLUMNA[k];
    if (!col) continue;
    /* Una fila con varios valores (lenguajes) se ve si alguno se ve. */
    if (!col.valores(f).some((v) => seVe(v, fc))) return false;
  }
  return true;
}

const SEP = "|";
export const PREFIJOS_FILTRO = ["solo-", "sin-"] as const;

/** Los filtros de la URL. */
export function filtrosDeURL(params: URLSearchParams): FiltrosTabla {
  const out: FiltrosTabla = {};
  for (const [k, v] of params.entries()) {
    const m = /^(solo|sin)-(.+)$/.exec(k);
    if (!m || !(m[2] in COLUMNA)) continue;
    const valores = v.split(SEP).filter(Boolean);
    if (valores.length) out[m[2] as ClaveColumna] = { modo: m[1] as "solo" | "sin", valores };
  }
  return out;
}

/** Lo que hay que escribir en la URL para dejar una columna con este filtro. */
export function filtroAURL(clave: ClaveColumna, fc: FiltroColumna | null): Record<string, string | null> {
  return {
    [`solo-${clave}`]: fc?.modo === "solo" && fc.valores.length ? fc.valores.join(SEP) : null,
    [`sin-${clave}`]: fc?.modo === "sin" && fc.valores.length ? fc.valores.join(SEP) : null,
  };
}

export function coincideBusqueda(f: FilaTabla, q: string): boolean {
  const t = sinTildes(q.trim());
  if (!t) return true;
  return [f.nombre, f.email, f.telefono, f.closer, f.notas].some((x) => sinTildes(x ?? "").includes(t));
}

/** Los valores de una columna para su filtro, con cuántas filas tiene cada
 *  uno según los DEMÁS filtros (como en Excel: lo que ya está filtrado en
 *  otra columna no aparece). */
export function opcionesDeColumna(filas: FilaTabla[], filtros: FiltrosTabla, clave: ClaveColumna): { valor: string; cuenta: number }[] {
  const col = COLUMNA[clave];
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    if (!pasaFiltros(f, filtros, clave)) continue;
    for (const v of new Set(col.valores(f))) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  /* Lo elegido sigue en la lista aunque no quede ninguna fila con eso. */
  for (const v of filtros[clave]?.valores ?? []) if (!cuenta.has(v)) cuenta.set(v, 0);
  const orden = col.ordenValores;
  return [...cuenta.entries()]
    .map(([valor, n]) => ({ valor, cuenta: n }))
    .sort((a, b) => {
      if (a.valor === VACIAS) return 1;
      if (b.valor === VACIAS) return -1;
      if (orden) {
        const ia = orden.indexOf(a.valor), ib = orden.indexOf(b.valor);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      /* Las fechas, de la más nueva a la más vieja. */
      if (clave === "llamada" || clave === "agendo" || clave === "cierre") return b.valor.localeCompare(a.valor);
      return a.valor.localeCompare(b.valor, "es", { numeric: true });
    });
}

/* ---------- Por qué no se cierra ---------- */

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

const SE_PRESENTO = new Set([TEXTO_RESULTADO.compro, TEXTO_RESULTADO["no-compro"]]);

export function resumenDe(filas: FilaTabla[]): NumerosResumen {
  const r: NumerosResumen = { llamadas: filas.length, pasaron: 0, presentaron: 0, cierres: 0, sinCierre: 0, noVino: 0, sinCargar: 0, pctCierre: null, objeciones: [] };
  const obj = new Map<string, number>();
  for (const f of filas) {
    if (f.resultado !== "Cancelada" && f.resultado !== "Por venir") r.pasaron++;
    if (SE_PRESENTO.has(f.resultado)) r.presentaron++;
    if (f.resultado === TEXTO_RESULTADO.compro) r.cierres++;
    if (f.resultado === TEXTO_RESULTADO["no-compro"]) {
      r.sinCierre++;
      obj.set(f.objecion || "Sin objeción cargada", (obj.get(f.objecion || "Sin objeción cargada") ?? 0) + 1);
    }
    if (f.resultado === TEXTO_RESULTADO["no-vino"]) r.noVino++;
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
export const DIMENSIONES: ClaveColumna[] = ["objecion", "pais", "edad", "tecnologias", "ingreso", "inversion", "ingles", "experiencia", "angulo", "ad", "via", "closer", "calificada"];
