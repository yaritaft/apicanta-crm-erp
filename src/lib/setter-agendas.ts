import type { EstadoApp, ID, Sesion } from "./types";
import { sinTildes } from "./crm";
import { esLlamadaDeResell } from "./resells";
import { normalizarUtm, origenDe } from "./utms";

/* ==================================================================
   Las agendas que marca el setter (Daniel, 24/10: «sería buen cambio si
   pudiera marcar directamente las agendas que ayudé setteando, así no hace
   falta avisarle a cada closer cada vez que suben una»).

   Hasta acá una agenda era del setter sólo si entraba por su link
   (utm_campaign=setter_nombre); las que setteaba por otro lado dependían de
   que el closer se acordara de ponerlo al cargar la venta. Ahora el setter
   la marca desde Mi panel y la venta de esa persona lo toma sola. La misma
   regla está en la base (supabase/setter-marca-agendas.sql →
   setter_de_agendas), que la aplica a toda venta que entra sin setter: acá
   es para mostrarlo antes de guardar.
   ================================================================== */

/** Cuántos días antes de la venta cuenta una agenda marcada de esa persona. */
export const DIAS_DE_LA_MARCA = 45;
const DIA = 86_400_000;

/** El setter que marcó la agenda de la que sale una venta: la llamada misma o, si no está marcada, la última agenda
    marcada de esa persona en los 45 días antes de la venta. */
export function setterDeAgendas(
  sesiones: readonly Pick<Sesion, "id" | "contactoId" | "leadId" | "inicia" | "setterId">[],
  v: { sesionId?: ID; contactoId?: ID; fecha?: string },
): ID | undefined {
  const propia = v.sesionId ? sesiones.find((s) => s.id === v.sesionId) : undefined;
  if (propia?.setterId) return propia.setterId;
  if (!v.contactoId) return undefined;
  const cuando = v.fecha ? Date.parse(v.fecha) : Date.now();
  let mejor: { setterId: ID; t: number } | undefined;
  for (const s of sesiones) {
    if (!s.setterId || (s.contactoId !== v.contactoId && s.leadId !== v.contactoId)) continue;
    const t = Date.parse(s.inicia);
    if (t > cuando + DIA || t < cuando - DIAS_DE_LA_MARCA * DIA) continue;
    if (!mejor || t > mejor.t) mejor = { setterId: s.setterId, t };
  }
  return mejor?.setterId;
}

/* ---------- Mi panel → «Sumar agendas» ---------- */

/** Las agendas que un setter puede marcar: de 3 semanas atrás a 2 adelante, sin las canceladas ni los resells. Primero
    las que vienen (la más próxima arriba) y después las que ya pasaron (la más reciente arriba). */
export const DIAS_ATRAS = 21;
export const DIAS_ADELANTE = 14;

export interface AgendaParaMarcar {
  sesion: Sesion;
  /* Quién la marcó, si alguien la marcó (puede ser este mismo setter). */
  marcadaPor?: { id: ID; nombre: string };
  /* Entró por el link de este setter: ya es suya sin marcarla. */
  porLink: boolean;
  yaPaso: boolean;
}

export function agendasParaMarcar(e: EstadoApp, setterId: ID, ahora: number, busqueda = ""): AgendaParaMarcar[] {
  const t = sinTildes(busqueda.trim());
  const nombres = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));
  const lista = e.sesiones
    .filter((s) => {
      if (s.estado === "cancelada" || esLlamadaDeResell(s)) return false;
      const cuando = Date.parse(s.inicia);
      if (!(cuando >= ahora - DIAS_ATRAS * DIA && cuando <= ahora + DIAS_ADELANTE * DIA)) return false;
      return !t || sinTildes(`${s.invitado} ${s.email ?? ""}`).includes(t);
    })
    .map((s): AgendaParaMarcar => {
      const utm = normalizarUtm(s.utm);
      return {
        sesion: s,
        ...(s.setterId ? { marcadaPor: { id: s.setterId, nombre: nombres.get(s.setterId) ?? "otro setter" } } : {}),
        porLink: Boolean(utm.campaign || utm.source) && origenDe(e, utm, s.inicia)?.setterId === setterId,
        yaPaso: Date.parse(s.inicia) < ahora,
      };
    });
  const proximas = lista.filter((x) => !x.yaPaso).sort((a, b) => a.sesion.inicia.localeCompare(b.sesion.inicia));
  const pasadas = lista.filter((x) => x.yaPaso).sort((a, b) => b.sesion.inicia.localeCompare(a.sesion.inicia));
  return [...proximas, ...pasadas];
}
