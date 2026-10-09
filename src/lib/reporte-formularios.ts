/* ==================================================================
   Los formularios del reporte semanal de los alumnos (reunión del 07/10).

   Hoy cada programa tiene su Google Form y las respuestas se pierden en una
   planilla aparte. Acá están las mismas preguntas, una por pantalla (como el
   cierre del día), y lo que contesta cada alumno se guarda en la ficha del
   cliente: una fila de `reportes` por semana, con sus respuestas.

   Cada programa tiene su definición: `hackear-biz` copia el formulario de
   seguimiento semanal de Hackear Biz tal cual; `hackear-it` conserva las
   preguntas con las que ya andaba la app (horas de estudio, entrevistas y
   postulaciones) hasta que llegue el formulario real.

   Es todo puro (sin red ni base): lo usan la página pública, la ruta que
   guarda y la ficha del cliente, que muestra las respuestas.
   ================================================================== */

export type TipoPregunta = "texto" | "texto-corto" | "opciones" | "numero" | "escala" | "si-no";

export interface PreguntaReporte {
  /* La clave con la que se guarda la respuesta: no cambia aunque cambie el texto. */
  id: string;
  /* Lo que ve el alumno. */
  titulo: string;
  /* Una aclaración debajo de la pregunta. */
  ayuda?: string;
  tipo: TipoPregunta;
  requerida: boolean;
  /* opciones: lo que se puede elegir (en este orden). */
  opciones?: string[];
  /* numero y escala: el rango. */
  min?: number;
  max?: number;
  /* Cómo se llama en la lista de la ficha (más corto que la pregunta). */
  etiqueta?: string;
}

export type IdFormulario = "hackear-biz" | "hackear-it";

export interface FormularioReporte {
  id: IdFormulario;
  /* El nombre del programa tal como figura en Customer Success (`programas`). */
  programa: string;
  nombre: string;
  saludo: string;
  preguntas: PreguntaReporte[];
}

const SI_NO = ["Sí", "No"];

export const FORMULARIO_BIZ: FormularioReporte = {
  id: "hackear-biz",
  programa: "Hackear Biz",
  nombre: "Seguimiento semanal de Hackear Biz",
  saludo: "Con este formulario hacemos un seguimiento semanal de tus avances durante el programa Hackear Biz, para acompañarte de manera más cercana, detectar en qué podemos ayudarte y conocer cómo venís progresando semana a semana.",
  preguntas: [
    { id: "trabajo", titulo: "¿En qué trabajaste esta semana dentro de Hackear Biz?", tipo: "texto", requerida: true, etiqueta: "En qué trabajó" },
    { id: "accion", titulo: "¿Qué acción concreta implementaste esta semana a partir de lo aprendido?", tipo: "texto", requerida: true, etiqueta: "Acción implementada" },
    {
      id: "marca", titulo: "¿Qué avance concreto tuviste esta semana con tu marca personal?",
      ayuda: "Contenido, alcance, seguidores, posicionamiento, networking, oportunidades, etc.", tipo: "texto", requerida: true, etiqueta: "Avance de marca personal",
    },
    {
      id: "publicaciones", titulo: "¿Cuántas publicaciones hiciste esta semana?", tipo: "opciones", requerida: true, etiqueta: "Publicaciones",
      opciones: ["Ninguna.", "Entre 1 y 2.", "Entre 3 y 5.", "Más de 5."],
    },
    { id: "conversaciones", titulo: "¿Cuántas conversaciones con potenciales clientes generaste esta semana?", tipo: "texto-corto", requerida: true, etiqueta: "Conversaciones" },
    { id: "ventas", titulo: "¿Cuántas ventas concretaste esta semana y por qué monto?", tipo: "texto-corto", requerida: true, etiqueta: "Ventas y monto" },
    { id: "logro", titulo: "¿Cuál fue tu principal logro de esta semana?", tipo: "texto", requerida: true, etiqueta: "Principal logro" },
    { id: "bloqueo", titulo: "¿Cuál es el principal bloqueo o dificultad que estás teniendo actualmente?", tipo: "texto", requerida: true, etiqueta: "Principal bloqueo" },
    {
      id: "compromiso", titulo: "Del 1 al 10, ¿qué tan comprometido/a estuviste esta semana con tus objetivos?", tipo: "escala", requerida: true,
      min: 1, max: 10, etiqueta: "Compromiso (1 a 10)",
    },
    { id: "objetivo", titulo: "¿Cuál es tu objetivo y acción principal para los próximos 7 días?", tipo: "texto", requerida: true, etiqueta: "Objetivo de los próximos 7 días" },
    { id: "ayuda", titulo: "¿Hay algo puntual en lo que necesitás que te acompañemos o ayudemos esta semana?", tipo: "texto", requerida: true, etiqueta: "En qué necesita ayuda" },
    { id: "clase", titulo: "¿Pudiste ver la clase de esta semana?", tipo: "si-no", requerida: true, opciones: SI_NO, etiqueta: "Vio la clase" },
  ],
};

export const FORMULARIO_IT: FormularioReporte = {
  id: "hackear-it",
  programa: "Hackear IT",
  nombre: "Seguimiento semanal de Hackear IT",
  saludo: "Contanos cómo te fue esta semana. Son menos de dos minutos.",
  preguntas: [
    { id: "horas", titulo: "¿Cuántas horas estudiaste esta semana?", tipo: "numero", requerida: true, min: 0, max: 168, etiqueta: "Horas de estudio", ayuda: "Si no estudiaste, poné 0." },
    { id: "entrevistas", titulo: "¿Cuántas entrevistas tuviste esta semana?", tipo: "numero", requerida: true, min: 0, max: 1000, etiqueta: "Entrevistas", ayuda: "Si no hubo, poné 0." },
    { id: "postulaciones", titulo: "¿A cuántos puestos te postulaste esta semana?", tipo: "numero", requerida: true, min: 0, max: 1000, etiqueta: "Postulaciones", ayuda: "Si no hubo, poné 0." },
    { id: "bloqueo", titulo: "¿Algo te trabó esta semana?", tipo: "texto", requerida: false, etiqueta: "Bloqueo", ayuda: "Una duda, un tema que no te sale, algo en lo que necesites ayuda." },
  ],
};

export const FORMULARIOS: Record<IdFormulario, FormularioReporte> = { "hackear-biz": FORMULARIO_BIZ, "hackear-it": FORMULARIO_IT };

export const esIdFormulario = (x: unknown): x is IdFormulario => x === "hackear-biz" || x === "hackear-it";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** El formulario que le toca a un alumno según su programa (los de Customer Success y, si no hay, el plan de su venta: «Mentoría»
 *  es Hackear IT). Si cursa los dos, o ninguno de los dos (Principals…), null: hay que preguntarle. */
export function formularioDe(textos: readonly (string | null | undefined)[] | null | undefined): FormularioReporte | null {
  const ts = (textos ?? []).map((t) => sinTildes(String(t ?? "")));
  const biz = ts.some((t) => /\bbiz\b|business/.test(t));
  const it = ts.some((t) => /\bit\b|mentoria/.test(t));
  if (biz && !it) return FORMULARIO_BIZ;
  if (it && !biz) return FORMULARIO_IT;
  return null;
}

export const LARGO_TEXTO = 2000;
export const LARGO_TEXTO_CORTO = 200;

export type Respuestas = Record<string, string | number>;

/** Lo que falta o está mal en la respuesta de UNA pregunta, dicho para el alumno; null si está bien. Es lo que mira la pantalla
 *  antes de dejarlo seguir: el servidor revisa todo de nuevo (validarRespuestas) y no se fía de esto. */
export function problemaDeRespuesta(p: PreguntaReporte, valor: string | number | undefined): string | null {
  const vacia = valor === undefined || String(valor).trim() === "";
  if (vacia) return p.requerida ? "Falta responder esta pregunta." : null;
  if (p.tipo === "numero" || p.tipo === "escala") {
    const n = typeof valor === "number" ? valor : Number(String(valor).trim().replace(",", "."));
    const min = p.min ?? 0, max = p.max ?? 1000;
    return Number.isFinite(n) && n >= min && n <= max ? null : `Poné un número entre ${min} y ${max}.`;
  }
  if ((p.tipo === "opciones" || p.tipo === "si-no") && !(p.opciones ?? []).includes(String(valor).trim())) return "Elegí una de las opciones.";
  return null;
}

/** Lo que mandó el alumno contra las preguntas del formulario. Devuelve las respuestas limpias, o la primera que falla
 *  (con su id, para volver a esa pantalla). Lo que no es una pregunta del formulario se ignora. */
export function validarRespuestas(f: FormularioReporte, crudas: unknown): { ok: true; valor: Respuestas } | { ok: false; error: string; campo: string } {
  if (!crudas || typeof crudas !== "object" || Array.isArray(crudas)) return { ok: false, error: "No se entendió lo que mandaste.", campo: "" };
  const d = crudas as Record<string, unknown>;
  const valor: Respuestas = {};
  for (const p of f.preguntas) {
    const x = d[p.id];
    const vacia = x === undefined || x === null || (typeof x === "string" && x.trim() === "");
    if (vacia) {
      if (p.requerida) return { ok: false, error: "Falta responder esta pregunta.", campo: p.id };
      continue;
    }
    switch (p.tipo) {
      case "texto": case "texto-corto": {
        if (typeof x !== "string" && typeof x !== "number") return { ok: false, error: "Esta respuesta tiene que ser un texto.", campo: p.id };
        valor[p.id] = String(x).trim().slice(0, p.tipo === "texto" ? LARGO_TEXTO : LARGO_TEXTO_CORTO);
        break;
      }
      case "opciones": case "si-no": {
        const t = typeof x === "string" ? x.trim() : "";
        if (!(p.opciones ?? []).includes(t)) return { ok: false, error: "Elegí una de las opciones.", campo: p.id };
        valor[p.id] = t;
        break;
      }
      case "numero": case "escala": {
        const n = typeof x === "number" ? x : Number(String(x).trim().replace(",", "."));
        const min = p.min ?? 0, max = p.max ?? 1000;
        if (!Number.isFinite(n) || n < min || n > max) return { ok: false, error: `Tiene que ser un número entre ${min} y ${max}.`, campo: p.id };
        /* Enteros: 7,5 horas se redondea a 8. */
        valor[p.id] = Math.round(n);
        break;
      }
    }
  }
  return { ok: true, valor };
}

/** Lo que se guarda en la fila del reporte además de las respuestas: el programa y, para que el tablero de reportes de siempre
 *  siga andando, las cifras de Hackear IT y el bloqueo. */
export function camposDelReporte(f: FormularioReporte, r: Respuestas): { programa: string; formulario: IdFormulario; respuestas: Respuestas; horas?: number; entrevistas?: number; postulaciones?: number; bloqueo?: string } {
  const num = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : undefined);
  const txt = (k: string) => (typeof r[k] === "string" && r[k] ? (r[k] as string) : undefined);
  return {
    programa: f.programa, formulario: f.id, respuestas: r,
    ...(f.id === "hackear-it" ? { horas: num("horas"), entrevistas: num("entrevistas"), postulaciones: num("postulaciones") } : {}),
    bloqueo: txt("bloqueo"),
  };
}

/** Las respuestas de un reporte con el texto de cada pregunta, para leerlas en la ficha. Lo que ya no está en el formulario
 *  (si cambia) se muestra igual, con su clave. */
export function respuestasLegibles(idFormulario: string | undefined, r: Respuestas | undefined): { id: string; etiqueta: string; pregunta: string; respuesta: string }[] {
  if (!r) return [];
  const f = esIdFormulario(idFormulario) ? FORMULARIOS[idFormulario] : undefined;
  const conocidas = new Set(f?.preguntas.map((p) => p.id));
  const lista = (f?.preguntas ?? []).filter((p) => r[p.id] !== undefined && r[p.id] !== "")
    .map((p) => ({ id: p.id, etiqueta: p.etiqueta ?? p.titulo, pregunta: p.titulo, respuesta: String(r[p.id]) }));
  for (const [k, v] of Object.entries(r)) if (!conocidas.has(k) && v !== "") lista.push({ id: k, etiqueta: k, pregunta: k, respuesta: String(v) });
  return lista;
}
