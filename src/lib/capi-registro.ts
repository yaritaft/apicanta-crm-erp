import { evaluarAgenda, type Criterio, type EvaluacionAgenda } from "./calificacion";
import type { PersonaCapi } from "./capi-datos";
import { nombreEventoCalificado, type Entorno } from "./capi-estado";

export { EVENTO_CALIFICADO, nombreEventoCalificado } from "./capi-estado";

/* ==================================================================
   El «registro calificado» para Meta (reunión del 02/10, F3-07).

   Cuando alguien se registra al webinar desde la landing, a Meta le llegan
   dos eventos desde el servidor:
   - Lead: se registró (el de siempre).
   - RegistroCalificado: se registró Y califica, con las mismas tres reglas
     de la agenda calificada (lib/calificacion.ts): puede invertir 1000 USD
     o más, inglés conversacional o mejor y carrera. Es el evento para que
     Meta optimice la pauta hacia la gente que sirve, no hacia cualquiera
     que deje el mail («optimizás en base a eso», Juan Cruz).

   Va con los UTMs, el país y el resultado de cada criterio. NO va lo que
   escribió en crudo: «cuánto puede invertir» es dato financiero de la
   persona y Meta pide no mandar datos sensibles; con el «sí / no» de cada
   criterio alcanza para optimizar y para el análisis.

   Un registro califica sólo con las TRES respuestas: si la landing no
   pregunta inversión, inglés y formación, nadie califica (y el evento no
   sale). Las preguntas se reconocen por su texto o por el nombre del campo
   del formulario (inversion, nivel_ingles, formacion…), como las de Calendly.

   Lógica pura (sin red ni variables de entorno): pruebas/capi-meta.test.ts.
   ================================================================== */

export interface RespuestaRegistro { pregunta: string; respuesta: string }

/* El nombre de un campo de formulario («nivel_ingles») como una pregunta
   («nivel ingles»): así lo reconoce lib/perfil.ts. */
const comoPregunta = (xs: readonly RespuestaRegistro[]): RespuestaRegistro[] =>
  xs.map((x) => ({ pregunta: x.pregunta.replace(/[_\-.]+/g, " "), respuesta: x.respuesta }));

/** Quién califica: las mismas tres reglas que la agenda de Calendly, sobre lo
 *  que contestó en el registro de la landing. */
export function evaluarRegistro(
  respuestas: readonly RespuestaRegistro[],
  contacto?: Parameters<typeof evaluarAgenda>[1],
): EvaluacionAgenda {
  return evaluarAgenda({ respuestas: comoPregunta(respuestas) }, contacto);
}

/** El id del evento: estable para un mismo registro, así si el servidor lo manda
 *  dos veces (un reintento, la misma persona que se vuelve a anotar) Meta lo
 *  junta en uno. Es el id del registro (mail + webinar) con otro prefijo. */
export const idEventoCalificado = (registroId: string): string => `rcal_${registroId.replace(/^reg_/, "")}`;

export interface RegistroParaMeta {
  /* El id del registro: reg_ + hash de mail y webinar (el que arma la ruta). */
  registroId: string;
  /* El id del Lead, si la landing manda el mismo que su píxel (para que no cuente doble). */
  idLead?: string;
  cuando: string;
  pagina?: string;
  webinarId?: string;
  utm?: Record<string, string>;
  respuestas: readonly RespuestaRegistro[];
  persona: PersonaCapi;
}

export type DatosEvento = Record<string, string | number | boolean>;

export interface EventoCapi {
  nombre: string;
  /* event_id: para no contarlo dos veces. */
  id: string;
  /* ISO */
  cuando: string;
  /* La página donde pasó. */
  url?: string;
  persona: PersonaCapi;
  valor?: number;
  moneda?: string;
  /* custom_data: lo que Meta puede usar para segmentar o crear conversiones. */
  datos?: DatosEvento;
  /* website: pasó en la landing; system_generated: lo cargó el equipo (una venta). */
  origen?: "website" | "system_generated";
}

const SI_NO: Record<Criterio, string> = { si: "si", no: "no", "sin-dato": "sin_dato" };

/** Los UTMs como los pide custom_data (sólo los que vinieron). */
function utmsParaMeta(utm?: Record<string, string>): DatosEvento {
  const out: DatosEvento = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = (utm?.[k] ?? utm?.[k.replace(/^utm_/, "")] ?? "").trim();
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

/** Los eventos que le corresponden a un registro: el Lead siempre y, si
 *  califica, el RegistroCalificado. */
export function eventosDeRegistro(
  r: RegistroParaMeta,
  env: Entorno = process.env,
  contacto?: Parameters<typeof evaluarAgenda>[1],
): EventoCapi[] {
  const ev = evaluarRegistro(r.respuestas, contacto);
  const utms = utmsParaMeta(r.utm);
  const lead: EventoCapi = {
    nombre: "Lead", id: r.idLead?.trim() || r.registroId, cuando: r.cuando, url: r.pagina, persona: r.persona,
    origen: "website", datos: { ...utms, calificado: ev.calificada ? "si" : "no" },
  };
  if (!ev.calificada) return [lead];
  return [lead, {
    nombre: nombreEventoCalificado(env), id: idEventoCalificado(r.registroId), cuando: r.cuando, url: r.pagina,
    persona: r.persona, origen: "website",
    datos: {
      ...utms,
      ...(r.webinarId ? { webinar: r.webinarId } : {}),
      calificado: "si",
      inversion: SI_NO[ev.inversion], ingles: SI_NO[ev.ingles], carrera: SI_NO[ev.carrera],
    },
  }];
}
