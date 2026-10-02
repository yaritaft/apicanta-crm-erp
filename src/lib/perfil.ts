/* ==================================================================
   El perfil de la persona: lo que contestó al agendar en Calendly (edad,
   tecnologías, inglés, experiencia, formación, cuánto gana y cuánto
   puede invertir), y lo que el equipo corrige a mano.

   Las respuestas son de cada agenda; la corrección es de la persona:
   queda en `extra.corregido` del contacto (o de su lead, si no tiene
   contacto) y pisa lo que contestó en todas sus agendas. Vaciarla vuelve
   a lo que contestó. Como se aplica sobre las respuestas mismas
   (conCorrecciones), todo lo que las lee —el CRM, la ficha, la estrella de
   calificada, el Dashboard— ve lo corregido sin enterarse.
   ================================================================== */

export type CampoPerfil = "edad" | "tecnologias" | "ingles" | "experiencia" | "formacion" | "ingreso" | "inversion";

export interface Respuesta { pregunta: string; respuesta: string }

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ES_INVERSION = /(invertir|inversion|te define mejor|claridad en la llamada)/;

/* Qué pregunta del formulario es cada dato (sobre el texto sin tildes y en
   minúscula). La de cuánto gana no puede ser la de la inversión: «…para
   duplicar tu salario, la inversión mínima parte desde los $690» habla de
   sueldo y es la de inversión. */
const PREGUNTAS: Record<CampoPerfil, { titulo: string; es: (pregunta: string) => boolean; canonica: string }> = {
  edad: { titulo: "Edad", es: (p) => /(\bedad\b|cuantos anos tenes|que edad)/.test(p), canonica: "¿Qué edad tenés?" },
  tecnologias: { titulo: "Tecnologías", es: (p) => /(lenguaje|framework|tecnolog)/.test(p), canonica: "¿Con qué lenguajes y frameworks trabajás o trabajaste?" },
  ingles: { titulo: "Inglés", es: (p) => /ingles/.test(p), canonica: "¿Cuál es tu nivel de inglés?" },
  experiencia: { titulo: "Experiencia", es: (p) => /(anos.*program|program.*anos)/.test(p), canonica: "¿Hace cuántos años trabajás en programación?" },
  formacion: { titulo: "Formación", es: (p) => /(formacion|estudio)/.test(p), canonica: "¿Cuál es tu nivel de formación?" },
  ingreso: { titulo: "Gana por mes", es: (p) => /(ganas|sueldo|salario)/.test(p) && !ES_INVERSION.test(p), canonica: "¿Cuánto ganás mensualmente en dólares?" },
  inversion: { titulo: "Puede invertir", es: (p) => ES_INVERSION.test(p), canonica: "¿Cuánto podés invertir en vos?" },
};

export const CAMPOS_PERFIL = Object.keys(PREGUNTAS) as CampoPerfil[];
export const tituloPerfil = (campo: CampoPerfil) => PREGUNTAS[campo].titulo;

/** Lo que contestó (o lo corregido) para ese dato; undefined si el
    formulario no lo preguntó. */
export function respuestaPerfil(qa: readonly Respuesta[] | null | undefined, campo: CampoPerfil): string | undefined {
  const es = PREGUNTAS[campo].es;
  return (qa ?? []).find((q) => es(sinTildes(q.pregunta)))?.respuesta;
}

export type Corregido = Partial<Record<CampoPerfil, string>>;
/* El contacto o el lead: alcanza con su `extra`. */
type ConExtra = { extra?: Record<string, unknown> | null };

/** Lo que el equipo corrigió a mano de esta persona. */
export function corregidoDe(c?: ConExtra | null, l?: ConExtra | null): Corregido | undefined {
  const crudo = (c?.extra?.corregido ?? l?.extra?.corregido) as Record<string, unknown> | undefined;
  if (!crudo || typeof crudo !== "object") return undefined;
  const out: Corregido = {};
  for (const campo of CAMPOS_PERFIL) {
    const v = crudo[campo];
    if (typeof v === "string" && v.trim()) out[campo] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/** Las respuestas de una agenda con las correcciones encima: la que
    corresponde cambia su respuesta y, si el formulario no la preguntó, se
    suma. Sin correcciones devuelve la misma lista. */
export function conCorrecciones(qa: readonly Respuesta[] | null | undefined, corregido?: Corregido | null): Respuesta[] {
  const lista = (qa ?? []) as Respuesta[];
  if (!corregido) return lista;
  let out = lista;
  for (const campo of CAMPOS_PERFIL) {
    const valor = corregido[campo];
    if (!valor) continue;
    const { es, canonica } = PREGUNTAS[campo];
    const i = out.findIndex((q) => es(sinTildes(q.pregunta)));
    out = i >= 0 ? out.map((q, k) => (k === i ? { ...q, respuesta: valor } : q)) : [...out, { pregunta: canonica, respuesta: valor }];
  }
  return out;
}

/** El `extra` de la persona con una corrección puesta o sacada (vacío la
    saca: vuelve a lo que contestó). */
export function extraConCorreccion(extra: Record<string, unknown> | null | undefined, campo: CampoPerfil, valor: string): Record<string, unknown> {
  const { corregido: previo, ...resto } = { ...(extra ?? {}) } as Record<string, unknown> & { corregido?: Record<string, unknown> };
  const corregido = { ...(previo && typeof previo === "object" ? previo : {}) } as Record<string, unknown>;
  const limpio = valor.trim();
  if (limpio) corregido[campo] = limpio; else delete corregido[campo];
  return Object.keys(corregido).length ? { ...resto, corregido } : resto;
}
