/* ==================================================================
   Que una pregunta nueva del formulario no quede callada (27/10).

   El formulario de Calendly se cambia desde Calendly, sin pasar por la
   app: ese día sumaron «¿Cuál es tu fecha de nacimiento?» y durante horas
   la respuesta quedó guardada en cada llamada sin llegar a ninguna ficha,
   hasta que los closers preguntaron. La app reconoce cada pregunta por lo
   que dice (lib/perfil.ts); la que no reconoce no es un error, pero alguien
   tiene que enterarse. Acá se arma el aviso de la campanita para los dueños.

   Sin red ni base, para poder probarlo.
   ================================================================== */

export interface AvisoPregunta {
  id: string; para: string; tipo: "calendly"; titulo: string; cuerpo: string; de: string;
  contactoId: string | null; persona: string | null;
}

/* Un formulario raro no puede llenar la campanita: hasta tantas preguntas nuevas por agenda. */
export const MAXIMO_POR_AGENDA = 5;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const recortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Un aviso por pregunta nueva y por dueño. El id sale de la pregunta (no de la persona): la primera agenda que la trae avisa y las
    que siguen no repiten (el upsert con ignoreDuplicates deja el que ya está). `hash` es el mismo en servidor y en pruebas. */
export function avisosDePreguntasNuevas(
  preguntas: readonly string[], duenos: readonly string[], persona: { id: string; nombre: string } | null, hash: (s: string) => string,
): AvisoPregunta[] {
  const mails = [...new Set(duenos.map((m) => m.trim().toLowerCase()).filter((m) => /@/.test(m)))];
  const filas: AvisoPregunta[] = [];
  for (const pregunta of preguntas.slice(0, MAXIMO_POR_AGENDA)) {
    for (const para of mails) {
      filas.push({
        id: `av_calendly_pregunta_${hash(sinTildes(pregunta))}_${hash(para)}`, para, tipo: "calendly", de: "Calendly",
        titulo: `Pregunta nueva en el formulario de Calendly: «${recortar(pregunta, 110)}»`,
        cuerpo: `Alguien la contestó al agendar, pero la app no sabe a qué dato corresponde: la respuesta queda guardada en la llamada (se ve en la ficha, en «Con qué agendó»), pero no llena ningún campo del perfil ni del CRM. Si tiene que llegar a la ficha, hay que sumarla a la app: avisá a quien la mantiene.`,
        contactoId: persona?.id ?? null, persona: persona?.nombre ?? null,
      });
    }
  }
  return filas;
}
