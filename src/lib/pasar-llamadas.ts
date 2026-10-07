import type { EstadoApp, ID, Lead, MiembroEquipo, Sesion } from "./types";
import { miembroDeCloser, sinTildes } from "./crm";
import { pasadaDe, type PasadaDeCloser } from "./pasada-closer";
import type { CambiosLlamada } from "./store";

/* ==================================================================
   Pasar llamadas de un closer a otro (reunión del 02/10: «debería ser
   tarea del director: bueno, tal te atiende»).

   El closer de una llamada es su anfitrión de Calendly. Pasarla es
   escribir el anfitrión nuevo, y anotar en `extra.pasada` que se eligió a
   mano para que Calendly no lo vuelva a pisar (lib/pasada-closer.ts). Lo
   demás sale de ahí solo, porque la base decide qué ve cada closer por el
   anfitrión de la llamada: el nuevo la ve y el viejo deja de verla. Sólo
   dueños y director pasan llamadas: a un closer la base le rechaza
   cambiarlas de dueño.

   Quién comisiona la venta: el que atendió la llamada. Una venta que sale
   de la llamada se carga con el closer de su anfitrión, así que después del
   pase sale a nombre del nuevo; una venta que ya estaba cargada se queda
   con quien la atendió.

   Acá está lo que no es pantalla: a quién se le puede pasar, cómo queda
   escrito, qué cambia en cada llamada y qué conviene avisar.
   ================================================================== */

type Equipo = Pick<EstadoApp, "equipo">;

/** Una persona del equipo a la que se le puede pasar una llamada. */
export interface DestinoDePase {
  miembro: MiembroEquipo;
  /** Cómo queda escrito en la llamada: con el nombre con el que Calendly ya
   *  lo trae (el más usado), así «Mariano» y «Mariano Arias» no aparecen
   *  como dos closers distintos en los filtros. Si todavía no atendió
   *  ninguna, el nombre de Equipo. */
  anfitrion: string;
  /** Sin correo en Equipo la app no sabe quién es: no va a ver la llamada. */
  sinCorreo: boolean;
}

/** Cuántas llamadas hay con cada anfitrión escrito. */
function anfitriones(sesiones: Pick<Sesion, "anfitrion">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sesiones) {
    const a = s.anfitrion?.trim();
    if (a) m.set(a, (m.get(a) ?? 0) + 1);
  }
  return m;
}

/** De cada persona del equipo, los anfitriones de Calendly que son suyos. */
export function anfitrionesPorMiembro(
  sesiones: Pick<Sesion, "anfitrion">[], equipo: MiembroEquipo[],
): Map<ID, { nombre: string; llamadas: number }[]> {
  const out = new Map<ID, { nombre: string; llamadas: number }[]>();
  for (const [nombre, llamadas] of anfitriones(sesiones)) {
    const m = miembroDeCloser(nombre, equipo);
    if (!m) continue;
    const xs = out.get(m.id);
    if (xs) xs.push({ nombre, llamadas }); else out.set(m.id, [{ nombre, llamadas }]);
  }
  /* El más usado primero; a igual cantidad, el nombre más corto. */
  for (const xs of out.values()) xs.sort((a, b) => b.llamadas - a.llamadas || a.nombre.length - b.nombre.length || a.nombre.localeCompare(b.nombre, "es"));
  return out;
}

/** A quiénes se les puede pasar una llamada: los closers que están en el
 *  equipo y quien ya atiende llamadas (el CEO, por ejemplo). */
export function destinosDePase(e: Pick<EstadoApp, "equipo" | "sesiones">): DestinoDePase[] {
  const suyos = anfitrionesPorMiembro(e.sesiones, e.equipo);
  return e.equipo
    .filter((m) => m.activo && (m.rol === "closer" || suyos.has(m.id)))
    .map((m) => ({ miembro: m, anfitrion: suyos.get(m.id)?.[0]?.nombre ?? m.nombre, sinCorreo: !m.email?.trim() }))
    .sort((a, b) => a.miembro.nombre.localeCompare(b.miembro.nombre, "es"));
}

/** Quién la atiende ahora, con el nombre que tiene en Equipo; sin Equipo, el
 *  anfitrión tal cual. Vacío si no tiene. */
export function closerDeLlamada(s: Pick<Sesion, "anfitrion">, equipo: MiembroEquipo[]): { nombre: string; miembro?: MiembroEquipo } {
  const a = (s.anfitrion ?? "").trim();
  const m = a ? miembroDeCloser(a, equipo) : undefined;
  return { nombre: m?.nombre ?? a, miembro: m };
}

/* ---------- Elegir de quién y cuáles ---------- */

export interface GrupoDeCloser<S> {
  /** El id de la persona del equipo o, si el anfitrión no es de nadie, su nombre escrito. */
  clave: string;
  nombre: string;
  miembro?: MiembroEquipo;
  llamadas: S[];
}

/** Las llamadas agrupadas por quién las atiende, la que más tiene primero.
 *  Lo que no tiene anfitrión queda en «Sin closer». */
export function agruparPorCloser<S extends Pick<Sesion, "anfitrion">>(llamadas: S[], equipo: MiembroEquipo[]): GrupoDeCloser<S>[] {
  const grupos = new Map<string, GrupoDeCloser<S>>();
  for (const s of llamadas) {
    const { nombre, miembro } = closerDeLlamada(s, equipo);
    const clave = miembro?.id ?? (nombre ? `a:${sinTildes(nombre)}` : "sin-closer");
    const g = grupos.get(clave);
    if (g) g.llamadas.push(s);
    else grupos.set(clave, { clave, nombre: nombre || "Sin closer", ...(miembro ? { miembro } : {}), llamadas: [s] });
  }
  return [...grupos.values()].sort((a, b) => b.llamadas.length - a.llamadas.length || a.nombre.localeCompare(b.nombre, "es"));
}

/** Las que todavía no pasaron (la que está empezando cuenta: una hora de margen). */
export const todaviaNoPaso = (s: Pick<Sesion, "inicia">, ahora: number) => Date.parse(s.inicia) >= ahora - 3_600_000;

/* ---------- Qué cambia en una llamada ---------- */

export interface PlanDePase {
  id: ID;
  /** Lo que queda en la llamada. */
  cambios: Required<Pick<CambiosLlamada, "extra">> & Pick<CambiosLlamada, "anfitrion">;
  /** Cómo estaba, para deshacerlo. */
  antes: Required<Pick<CambiosLlamada, "extra">> & Pick<CambiosLlamada, "anfitrion">;
  detalle: string;
  /** Quién la atendía hasta ahora (el anfitrión, tal cual estaba). */
  de: string;
  /** Vuelve a quien dice Calendly: se saca la marca de que se eligió a mano. */
  vuelveACalendly: boolean;
}

/** Lo que hay que escribir para pasar una llamada a `destino`; null si ya
 *  la atiende. Si se la pasa a quien figura en Calendly, la llamada vuelve
 *  a ser la de siempre y se saca la marca. */
export function planDePase(
  s: Pick<Sesion, "id" | "invitado" | "anfitrion" | "extra">,
  destino: DestinoDePase,
  ctx: { equipo: MiembroEquipo[]; por: string; cuando: string },
): PlanDePase | null {
  const actual = (s.anfitrion ?? "").trim();
  const quien = closerDeLlamada(s, ctx.equipo).miembro;
  if (quien ? quien.id === destino.miembro.id : actual !== "" && sinTildes(actual) === sinTildes(destino.anfitrion)) return null;

  const previa = pasadaDe(s);
  /* Lo que dice Calendly: lo anotado si ya se había pasado; si no, lo que hay. */
  const calendly = previa?.calendly || actual;
  const deCalendly = calendly ? miembroDeCloser(calendly, ctx.equipo) : undefined;
  const vuelveACalendly = Boolean(deCalendly) && deCalendly!.id === destino.miembro.id;

  const { pasada: _marca, ...sinMarca } = (s.extra ?? {}) as Record<string, unknown>;
  const nueva: PasadaDeCloser = { a: destino.anfitrion, calendly, por: ctx.por, en: ctx.cuando };
  const extra = vuelveACalendly ? sinMarca : { ...sinMarca, pasada: nueva };

  const de = quien?.nombre ?? actual;
  const persona = s.invitado?.trim() || "la llamada";
  const por = ctx.por ? `, por ${ctx.por}` : "";
  return {
    id: s.id,
    cambios: { anfitrion: vuelveACalendly ? calendly : destino.anfitrion, extra },
    antes: { anfitrion: s.anfitrion, extra: (s.extra ?? {}) as Record<string, unknown> },
    detalle: vuelveACalendly
      ? `${persona}: vuelve con ${destino.miembro.nombre}, que es quien figura en Calendly (la había pasado a ${previa?.a ?? de}).`
      : de
        ? `${persona}: pasó de ${de} a ${destino.miembro.nombre}${por}.`
        : `${persona}: se la asignó a ${destino.miembro.nombre}${por} (no tenía closer).`,
    de: actual,
    vuelveACalendly,
  };
}

/** Si la persona de la llamada tenía a quien la atendía como responsable
 *  de su lead, la oportunidad se va con la llamada: el nombre nuevo, o null
 *  si el responsable es otro (no se toca). */
export function responsableTrasPase(
  lead: Pick<Lead, "responsable">, anfitrionAntes: string, destino: DestinoDePase, equipo: MiembroEquipo[],
): string | null {
  const r = (lead.responsable ?? "").trim();
  const antes = anfitrionAntes.trim();
  if (!r || !antes || sinTildes(r) === sinTildes(destino.anfitrion)) return null;
  const a = miembroDeCloser(r, equipo), b = miembroDeCloser(antes, equipo);
  const mismo = a && b ? a.id === b.id : sinTildes(r) === sinTildes(antes);
  return mismo ? destino.anfitrion : null;
}

/* ---------- Qué conviene avisar antes de pasar ---------- */

export interface AvisosDePase {
  /** Llamadas que ya tienen su venta cargada: la venta sigue con quien la atendió. */
  conVenta: { id: ID; persona: string; closer: string }[];
  /** Llamadas que ya se hicieron (tienen su estado cargado). */
  hechas: number;
  /** Llamadas que ya estaban pasadas a mano: se vuelven a pasar. */
  yaPasadas: number;
}

export function avisosDePase(
  llamadas: Pick<Sesion, "id" | "invitado" | "estadoLlamada" | "extra" | "anfitrion">[],
  e: Pick<EstadoApp, "equipo" | "ventas">,
  /** Por cada llamada, la venta que salió de ella (la fila del CRM la sabe). */
  ventaDe: (id: ID) => { id: ID } | undefined,
): AvisosDePase {
  const out: AvisosDePase = { conVenta: [], hechas: 0, yaPasadas: 0 };
  for (const s of llamadas) {
    if (s.estadoLlamada) out.hechas++;
    if (pasadaDe(s)) out.yaPasadas++;
    const v = ventaDe(s.id);
    if (!v) continue;
    const venta = e.ventas.find((x) => x.id === v.id);
    const closer = e.equipo.find((m) => m.id === venta?.closerId)?.nombre ?? closerDeLlamada(s, e.equipo).nombre;
    out.conVenta.push({ id: s.id, persona: s.invitado?.trim() || "Sin nombre", closer });
  }
  return out;
}
