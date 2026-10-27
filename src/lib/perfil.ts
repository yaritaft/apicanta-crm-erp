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

export type CampoPerfil = "edad" | "nacimiento" | "tecnologias" | "ingles" | "experiencia" | "formacion" | "ingreso" | "inversion";

export interface Respuesta { pregunta: string; respuesta: string }

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const ES_INVERSION = /(invertir|inversion|te define mejor|claridad en la llamada)/;

/* Qué pregunta del formulario es cada dato (sobre el texto sin tildes y en
   minúscula). La de cuánto gana no puede ser la de la inversión: «…para
   duplicar tu salario, la inversión mínima parte desde los $690» habla de
   sueldo y es la de inversión. */
const PREGUNTAS: Record<CampoPerfil, { titulo: string; es: (pregunta: string) => boolean; canonica: string }> = {
  edad: { titulo: "Edad", es: (p) => /(\bedad\b|cuantos anos tenes|que edad)/.test(p), canonica: "¿Qué edad tenés?" },
  /* 27/10: el formulario de Calendly sumó «¿Cuál es tu fecha de nacimiento?» y, como nadie la conocía, la respuesta quedaba
     guardada en la llamada pero no llegaba a ninguna ficha (los closers preguntaron si se podía completar sola). */
  nacimiento: { titulo: "Fecha de nacimiento", es: (p) => /(nacimiento|cumpleanos|\bnaciste\b)/.test(p), canonica: "¿Cuál es tu fecha de nacimiento?" },
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

/* ---------- Preguntas que el formulario hace y no son del perfil ----------
   El teléfono y el Instagram se leen al guardar la agenda (lib/calendly-sync.ts). Con éstas y las del perfil, toda pregunta
   del formulario de Calendly tiene un destino: la que no está acá es una pregunta nueva (`preguntasNuevas`). */
const OTRAS_CONOCIDAS: ((pregunta: string) => boolean)[] = [
  (p) => /(whatsapp|telefono|celular|\bnumero\b)/.test(p),
  (p) => /instagram/.test(p),
];

/** Las preguntas de estas respuestas que ningún dato del sistema reconoce: se guardan en la llamada, pero no llegan a la ficha. */
export function preguntasNuevas(qa: readonly Respuesta[] | null | undefined): string[] {
  const vistas = new Set<string>();
  for (const q of qa ?? []) {
    const t = sinTildes(q.pregunta);
    if (!t.trim()) continue;
    if (CAMPOS_PERFIL.some((c) => PREGUNTAS[c].es(t)) || OTRAS_CONOCIDAS.some((es) => es(t))) continue;
    vistas.add(q.pregunta.trim());
  }
  return [...vistas];
}

/* ---------- La fecha de nacimiento ---------- */

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6,
  julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/* Un día que existe: «1998-02-30» tiene la forma pero no es un día. */
function diaReal(a: number, m: number, d: number): string | null {
  if (!(a >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const f = new Date(Date.UTC(a, m - 1, d, 12));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${dosDigitos(m)}-${dosDigitos(d)}` : null;
}

/** «26/03/1998», «26-3-98», «1998-03-26», «26 de marzo de 1998» → «1998-03-26». null si no se entiende o el día no existe.
    El orden es día/mes (como se escribe acá); si el «mes» pasa de 12 y el «día» no, está al revés (03/26/1998). */
export function diaDeNacimiento(texto: string | null | undefined, anioActual: number = new Date().getFullYear()): string | null {
  const t = sinTildes(texto ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  let m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(t);
  if (m) return diaReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2}|\d{4})$/.exec(t);
  if (m) {
    let [d, mes] = [Number(m[1]), Number(m[2])];
    if (mes > 12 && d <= 12) [d, mes] = [mes, d];
    let a = Number(m[3]);
    /* Con dos cifras: «98» es 1998; «05» sería 2005 (nadie de 21 años agenda, y la edad fuera de rango se descarta después). */
    if (m[3].length === 2) a += a > anioActual % 100 ? 1900 : 2000;
    return diaReal(a, mes, d);
  }
  m = /^(\d{1,2})(?: de | )([a-z]+)\.?(?: de | )(\d{4})$/.exec(t);
  if (m && MESES[m[2]]) return diaReal(Number(m[3]), MESES[m[2]], Number(m[1]));
  return null;
}

/** De 10 a 99 años: fuera de eso es un error de carga (la fecha de nacimiento y la edad). */
export const RANGO_EDAD = [10, 99] as const;

/** La edad hoy (aaaa-mm-dd) de quien nació en `dia` (aaaa-mm-dd). null si falta alguna o la edad no es creíble. */
export function edadDeDia(dia: string | null | undefined, hoy: string): number | null {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia ?? "");
  const h = /^(\d{4})-(\d{2})-(\d{2})/.exec(hoy);
  if (!n || !h) return null;
  const anios = Number(h[1]) - Number(n[1]) - (`${h[2]}-${h[3]}` < `${n[2]}-${n[3]}` ? 1 : 0);
  return anios >= RANGO_EDAD[0] && anios <= RANGO_EDAD[1] ? anios : null;
}

/** «1998-03-26» → «26/03/1998». */
export function textoDeDia(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
}

/** La fecha de nacimiento (aaaa-mm-dd) que contestó o que se corrigió; null si el formulario no la preguntó o no se entiende. */
export function nacimientoDeRespuestas(qa: readonly Respuesta[] | null | undefined): string | null {
  return diaDeNacimiento(respuestaPerfil(qa, "nacimiento"));
}

/** La fecha de nacimiento de una persona según sus llamadas (la de la más nueva que la tenga) y lo que corrigió el equipo. */
export function nacimientoDePersona(
  sesiones: readonly { inicia: string; respuestas?: readonly Respuesta[] | null }[], corregido?: Corregido | null,
): string | null {
  const nuevasPrimero = [...sesiones].sort((a, b) => b.inicia.localeCompare(a.inicia));
  for (const s of nuevasPrimero) {
    const dia = nacimientoDeRespuestas(conCorrecciones(s.respuestas, corregido));
    if (dia) return dia;
  }
  return null;
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
