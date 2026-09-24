import { nivelDeIngles, respuestaA } from "./calendly";
import type { NivelIngles } from "./types";

/* ==================================================================
   Agenda calificada: la definición del equipo, para que se mida sola.

   Califica quien cumple las tres cosas, según lo que contestó en el
   formulario de Calendly al agendar:
   1. Puede invertir 1000 USD o más: "Puedo invertir en mí de 1000 a
      2000 USD" o "más de 2000 USD".
   2. Inglés conversacional o mejor: "Conversacional aunque cometo
      errores…" o "Muy bueno, ningún problema con el inglés". Básico no.
   3. Carrera: universitaria (completa, avanzada o recién iniciada) o
      tecnicatura/terciario. Autodidacta, bootcamp o cursos solos no.

   Si la agenda no trae las respuestas (una cargada a mano), el inglés
   y la formación salen de lo que se sabe del contacto; la inversión
   sólo la pregunta Calendly, así que sin ella no califica. Lo usan la
   Agenda (la estrellita), el Dashboard y la planilla de cada webinar.
   ================================================================== */

export type Criterio = "si" | "no" | "sin-dato";

export interface EvaluacionAgenda {
  calificada: boolean;
  inversion: Criterio;
  ingles: Criterio;
  carrera: Criterio;
}

export const INVERSION_MINIMA = 1000;
const INGLES_QUE_CALIFICA: NivelIngles[] = ["conversacional", "nativo"];

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const numero = (s: string) => Number(s.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));

/* "de 1000 a 2000 USD" → 1000; "más de 2000" → 2000; "menos de 600" → 0;
   "al menos $690" → 690. Lo que se puede invertir SEGURO: el piso. */
export function pisoDeInversion(texto?: string): number | undefined {
  if (!texto) return undefined;
  const t = sinTildes(texto);
  if (/menos de|no cuento|no tengo|no dispongo/.test(t)) return 0;
  const rango = t.match(/de\s*\$?\s*([\d.,]+)\s*(?:usd)?\s*a\s*\$?\s*([\d.,]+)/);
  if (rango) return numero(rango[1]);
  const piso = t.match(/(?:mas de|al menos|desde)\s*\$?\s*([\d.,]+)/);
  if (piso) return numero(piso[1]);
  const suelto = t.match(/([\d.,]+)/);
  return suelto ? numero(suelto[1]) : undefined;
}

export function tieneCarrera(formacion?: string): Criterio {
  if (!formacion?.trim()) return "sin-dato";
  return /(universitari|terciari|tecnicatura|tecnico superior)/.test(sinTildes(formacion)) ? "si" : "no";
}

export function evaluarAgenda(
  sesion: { respuestas?: { pregunta: string; respuesta: string }[] | null },
  contacto?: { inglesNivel?: NivelIngles | null; formacion?: string | null } | null,
): EvaluacionAgenda {
  const qa = sesion.respuestas ?? [];

  const piso = pisoDeInversion(respuestaA(qa, /(invertir|inversion|te define mejor|claridad en la llamada)/));
  const inversion: Criterio = piso === undefined ? "sin-dato" : piso >= INVERSION_MINIMA ? "si" : "no";

  const nivel = nivelDeIngles(respuestaA(qa, /ingles/)) ?? contacto?.inglesNivel ?? undefined;
  const ingles: Criterio = !nivel ? "sin-dato" : INGLES_QUE_CALIFICA.includes(nivel) ? "si" : "no";

  const carrera = tieneCarrera(respuestaA(qa, /(formacion|estudio)/) ?? contacto?.formacion ?? undefined);

  return { calificada: inversion === "si" && ingles === "si" && carrera === "si", inversion, ingles, carrera };
}

/* "Invierte +1000 · inglés conversacional · carrera", o lo que falta. */
export function textoEvaluacion(ev: EvaluacionAgenda): string {
  if (ev.calificada) return "Agenda calificada: puede invertir 1000 USD o más, tiene inglés conversacional y carrera.";
  const falta = [
    ev.inversion !== "si" && (ev.inversion === "no" ? "invierte menos de 1000 USD" : "no dijo cuánto puede invertir"),
    ev.ingles !== "si" && (ev.ingles === "no" ? "inglés básico" : "sin dato de inglés"),
    ev.carrera !== "si" && (ev.carrera === "no" ? "sin carrera" : "sin dato de formación"),
  ].filter(Boolean);
  return `No califica: ${falta.join(", ")}.`;
}
