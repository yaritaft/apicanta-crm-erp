import type { Etapa, ID, Lead, OpcionCrm, Sesion } from "./types";

/* ==================================================================
   La etapa de cada oportunidad se mueve sola con lo que pasa en el CRM,
   la Agenda y Ventas. Antes se arrastraba a mano en el Pipeline, que ahora
   es el CRM: sin esto, el pipeline abierto, el ponderado, los leads sin
   contactar y la tasa de cierre del Dashboard se quedaban quietos.

   - agenda una llamada            → Sesión agendada
   - la llamada se hizo            → Propuesta
   - se carga la venta             → la etapa ganada (Inscripto)
   - «NO Calificado», «Lead descartado» → la perdida (Perdido)
   - «Devolución»                  → la perdida, aunque haya comprado

   Agendar y hacer la llamada sólo hacen avanzar: una llamada hecha no
   devuelve a Propuesta a quien ya compró. Comprar gana desde donde esté.
   Perderse no le quita la compra a quien ya compró (una llamada de resell
   que no califica no lo saca de Inscripto); una devolución sí. Y si el
   closer se corrige y saca el «NO Calificado», el lead vuelve a donde lo
   deja la llamada.

   Lo usan el store (CRM, Agenda, Ventas) y la entrada de Calendly del
   servidor, así que no depende de nada del navegador.
   ================================================================== */

export type EventoEtapa =
  | "agendo" | "llamada-hecha" | "compro" | "perdida" | "devolucion"
  /* Dejó de estar perdida (el closer sacó el «NO Calificado»): vuelve a
     Propuesta si la llamada se hizo, o a Sesión agendada si no. */
  | "sigue" | "sigue-hecha";

type EtapaMin = Pick<Etapa, "id" | "nombre" | "orden" | "esGanada" | "esPerdida">;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* Las etapas se editan en Ajustes: la ganada y la perdida tienen su marca;
   las del medio se reconocen por su id de siempre o por el nombre. */
export function etapasClave(etapas: EtapaMin[]) {
  const por = (id: string, re: RegExp) => etapas.find((x) => x.id === id) ?? etapas.find((x) => re.test(sinTildes(x.nombre)));
  return {
    sesion: por("et_sesion", /sesion agendada|agendad/),
    propuesta: por("et_propuesta", /propuesta/),
    ganada: etapas.find((x) => x.esGanada),
    perdida: etapas.find((x) => x.esPerdida),
  };
}

/* La etapa a la que pasa un lead por ese evento, o null si se queda. */
export function etapaPorEvento(actualId: ID | undefined, evento: EventoEtapa, etapas: EtapaMin[]): ID | null {
  const k = etapasClave(etapas);
  const actual = etapas.find((x) => x.id === actualId);
  const gano = Boolean(actual?.esGanada);
  const perdio = Boolean(actual?.esPerdida);
  /* Avanzar: desde una etapa abierta anterior (o desde ninguna). */
  const avanza = (destino?: EtapaMin) =>
    destino && (!actual || (!gano && !perdio && actual.orden < destino.orden)) ? destino : undefined;
  let destino: EtapaMin | undefined;
  switch (evento) {
    /* Volver a agendar reabre al que se había perdido. */
    case "agendo": destino = perdio ? k.sesion : avanza(k.sesion); break;
    case "llamada-hecha": destino = avanza(k.propuesta); break;
    case "compro": destino = gano ? undefined : k.ganada; break;
    case "perdida": destino = gano || perdio ? undefined : k.perdida; break;
    case "devolucion": destino = perdio ? undefined : k.perdida; break;
    case "sigue": destino = perdio ? k.sesion : undefined; break;
    case "sigue-hecha": destino = perdio ? k.propuesta : undefined; break;
  }
  return destino && destino.id !== actualId ? destino.id : null;
}

/* La etapa después de varios eventos seguidos (una opción que marca la
   llamada como hecha y a la vez la da por perdida). */
export function etapaTrasEventos(actualId: ID | undefined, eventos: EventoEtapa[], etapas: EtapaMin[]): ID | null {
  let etapa = actualId;
  for (const ev of eventos) etapa = etapaPorEvento(etapa, ev, etapas) ?? etapa;
  return etapa && etapa !== actualId ? etapa : null;
}

/* Lo que dice de la oportunidad un cambio en una llamada: la llamada pasó a
   hecha, se eligió o se sacó un estado que la da por perdida. */
export function eventosDeLlamada(
  antes: Pick<Sesion, "estado" | "estadoLlamada">,
  despues: Pick<Sesion, "estado" | "estadoLlamada">,
  opciones: OpcionCrm[],
): EventoEtapa[] {
  const op = (nombre?: string) => (nombre ? opciones.find((o) => o.nombre === nombre) : undefined);
  const pierde = (o?: OpcionCrm) => o?.oportunidad === "perdida" || o?.oportunidad === "devolucion";
  const antesOp = op(antes.estadoLlamada), despuesOp = op(despues.estadoLlamada);
  const eventos: EventoEtapa[] = [];
  if (despues.estado === "hecha" && antes.estado !== "hecha") eventos.push("llamada-hecha");
  if (antes.estadoLlamada !== despues.estadoLlamada) {
    if (despuesOp?.oportunidad === "perdida") eventos.push("perdida");
    else if (despuesOp?.oportunidad === "devolucion") eventos.push("devolucion");
    else if (pierde(antesOp)) eventos.push(despues.estado === "hecha" ? "sigue-hecha" : "sigue");
  }
  return eventos;
}

/* El lead de una llamada: el suyo, o la oportunidad más reciente de la
   misma persona (las llamadas viejas no siempre traen el lead). */
export function leadDeSesion(leads: Lead[], s: Pick<Sesion, "leadId" | "contactoId">): Lead | undefined {
  const propio = s.leadId ? leads.find((l) => l.id === s.leadId) : undefined;
  if (propio) return propio;
  if (!s.contactoId) return undefined;
  return leads
    .filter((l) => l.contactoId === s.contactoId || l.id === s.contactoId)
    .sort((a, b) => (b.actualizadoEn ?? b.creadoEn).localeCompare(a.actualizadoEn ?? a.creadoEn))[0];
}
