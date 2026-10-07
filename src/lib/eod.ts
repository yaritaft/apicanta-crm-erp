import type { Ajustes, EstadoApp, OpcionCrm, Sesion } from "./types";
import { miembroDeCloser, opcionesDe, sinTildes } from "./crm";
import { diaDeNegocio } from "./dia-negocio";
import { esReagendar, preguntaDe } from "./estados";

/* ==================================================================
   El cierre del día del closer (EOD).

   Al final del día el closer pasa por sus llamadas de a una, como un
   Typeform, y con un par de clics deja cómo terminó cada una (Yari,
   29/09: "que los closers, de forma bien fácil y cargando la mínima
   cantidad de cosas posible, puedan reflejar si sucedió una venta y, si
   no se cerró, qué pasó").

   Lo que elige es el Estado de Llamada, el mismo del CRM, la grilla, la
   Agenda y la ficha (lib/estados.ts): viene cargado si ya lo tenía y lo
   que cambia acá cambia en todos lados. Según el estado, pide lo que
   falta:
   - una compra: se carga la venta en el asistente de siempre;
   - quedó en seguimiento: por qué no cerró (la objeción), si hizo la
     oferta y para cuándo estima cerrarlo;
   - se perdió: por qué y si hizo la oferta;
   - no vino o se canceló: nada más.
   Si la persona pidió otra fecha, alcanza con el Estado Pre-Call
   «Reagendar»: la agenda nueva entra sola desde Calendly.

   La puerta (Yari, 02/10: «para cargar el EOD tenés que cargar la venta»):
   si el estado es de compra, no se termina el día sin la venta cargada. La
   única salida es avisar que la carga otra persona, y eso queda anotado en
   la llamada (`ventaPorOtro`: quién lo dijo y cuándo).

   Lo demás (quién es, de dónde vino, qué contestó) ya lo sabe la app: no
   se vuelve a preguntar.
   ================================================================== */

export const OBJECIONES_POR_DEFECTO = [
  "Plata", "Tiempo", "Lo tiene que consultar", "No ve el valor", "No califica", "Lo quiere pensar", "Otro",
];

export function objecionesDe(a: Ajustes): string[] {
  const propias = a.crm?.objeciones?.map((x) => x.trim()).filter(Boolean);
  return propias && propias.length > 0 ? propias : OBJECIONES_POR_DEFECTO;
}

export interface RespuestaEod {
  /* Los dos estados de la llamada, con el nombre de su opción. */
  estadoLlamada?: string;
  estadoPreCall?: string;
  objecion?: string;
  hizoOferta?: boolean;
  /* aaaa-mm-dd. */
  cierreEstimado?: string;
  nota?: string;
  grabacion?: string;
  /* La salida de la puerta: la venta de esta compra la carga otra persona. */
  ventaPorOtro?: boolean;
}

const opcionDe = (opciones: OpcionCrm[], nombre?: string) => (nombre ? opciones.find((o) => o.nombre === nombre) : undefined);

/* Lo que falta para dar por cargada una llamada. Con `puerta`, una compra
   también pide la venta cargada (`tieneVenta`) o avisar que la carga otra
   persona. */
export function faltaEnRespuesta(r: RespuestaEod | undefined, opciones: OpcionCrm[], puerta?: { tieneVenta: boolean }): string | null {
  if (!r?.estadoLlamada) return esReagendar(r?.estadoPreCall) ? null : "Elegí cómo terminó la llamada";
  const que = preguntaDe(opcionDe(opciones, r.estadoLlamada));
  if (que === "venta") return puerta && !puerta.tieneVenta && !r.ventaPorOtro ? "Cargá la venta o avisá que la carga otra persona" : null;
  if (que !== "seguimiento" && que !== "perdida") return null;
  if (!r.objecion) return "Elegí por qué no cerró";
  if (r.hizoOferta === undefined) return "Contá si hiciste la oferta";
  if (que === "seguimiento" && !r.cierreEstimado) return "Elegí para cuándo estimás cerrarlo";
  return null;
}

/** La objeción que ya dice el estado: un «NO Calificado» no cerró porque no
    califica. Se propone si está en la lista; se puede cambiar. */
export function objecionSugerida(o: OpcionCrm | undefined, objeciones: string[]): string | undefined {
  if (!o || !/no calific/.test(sinTildes(o.nombre))) return undefined;
  return objeciones.find((x) => /no calific/.test(sinTildes(x)));
}

/* Si la nota ya está entre las notas de la llamada. Se compara renglón por
   renglón (sin los espacios de los costados), no por texto: «cuotas» no está
   en «Quiere pagar en cuotas de seis meses», pero la misma nota guardada dos
   veces sí. Una nota de varios renglones tiene que estar entera y seguida. */
function yaEstaLaNota(notas: string | undefined, nota: string): boolean {
  const renglones = (t: string) => t.split(/\r?\n/).map((x) => x.trim());
  const hay = renglones(notas ?? ""), busca = renglones(nota);
  return hay.some((_, i) => busca.every((r, k) => hay[i + k] === r));
}

/** Lo que se guarda en la llamada con la respuesta del EOD. Los estados
    van sólo si cambiaron: el resto de la app los lee de la misma llamada. */
export function cambiosDelEod(
  r: RespuestaEod, s: Pick<Sesion, "notas" | "estadoLlamada" | "estadoPreCall" | "ventaPorOtro">, a: Ajustes, quien: string, cuando: string,
): Partial<Sesion> {
  const c: Partial<Sesion> = { eodEn: cuando, eodPor: quien };
  if ((r.estadoLlamada ?? "") !== (s.estadoLlamada ?? "")) c.estadoLlamada = r.estadoLlamada ?? "";
  if ((r.estadoPreCall ?? "") !== (s.estadoPreCall ?? "")) c.estadoPreCall = r.estadoPreCall ?? "";
  const que = preguntaDe(opcionDe(opcionesDe(a, "estadoLlamada"), r.estadoLlamada));
  if (que === "seguimiento" || que === "perdida") {
    c.objecion = r.objecion;
    c.hizoOferta = r.hizoOferta;
    c.cierreEstimado = que === "seguimiento" ? r.cierreEstimado : undefined;
  } else {
    /* Si cambió de idea (antes había quedado en seguimiento), se limpia. */
    c.objecion = undefined;
    c.hizoOferta = que === "venta" ? true : undefined;
    c.cierreEstimado = undefined;
  }
  /* La salida de la puerta queda anotada (quién y cuándo) y no se pisa al
     volver a guardar; si la llamada ya no es una compra, se saca. */
  if (que === "venta" && r.ventaPorOtro && !s.ventaPorOtro) c.ventaPorOtro = { por: quien, en: cuando };
  else if (s.ventaPorOtro && (que !== "venta" || r.ventaPorOtro === false)) c.ventaPorOtro = undefined;
  const nota = r.nota?.trim();
  if (nota && !yaEstaLaNota(s.notas, nota)) c.notas = s.notas?.trim() ? `${s.notas.trim()}\n${nota}` : nota;
  if (r.grabacion?.trim()) c.grabacion = r.grabacion.trim();
  return c;
}

/** Lo que ya tiene cargado una llamada, para seguir desde ahí. */
export function respuestaDe(s: Sesion): RespuestaEod | undefined {
  if (!s.estadoLlamada && !s.estadoPreCall) return undefined;
  return {
    estadoLlamada: s.estadoLlamada, estadoPreCall: s.estadoPreCall,
    objecion: s.objecion, hizoOferta: s.hizoOferta, cierreEstimado: s.cierreEstimado,
    ventaPorOtro: s.ventaPorOtro ? true : undefined,
  };
}

/* ---------- Qué llamadas le tocan ---------- */

/** El closer de una llamada es el anfitrión del evento de Calendly. */
export function esDelCloser(s: Pick<Sesion, "anfitrion">, closer: string, equipo: EstadoApp["equipo"]): boolean {
  const a = (s.anfitrion ?? "").trim();
  if (!a) return false;
  if (sinTildes(a) === sinTildes(closer)) return true;
  return miembroDeCloser(a, equipo)?.nombre === closer;
}

/** Las llamadas de un closer en un día (de Argentina), sin las canceladas. */
export function llamadasDelDia(e: Pick<EstadoApp, "sesiones" | "equipo">, closer: string, dia: string): Sesion[] {
  return e.sesiones
    .filter((s) => s.estado !== "cancelada" && diaDeNegocio(s.inicia) === dia && esDelCloser(s, closer, e.equipo))
    .sort((a, b) => a.inicia.localeCompare(b.inicia));
}

/** Los closers que tienen llamadas, para elegir de quién es el día. */
export function closersConLlamadas(e: Pick<EstadoApp, "sesiones" | "equipo">): string[] {
  const nombres = new Set<string>();
  for (const s of e.sesiones) {
    const a = s.anfitrion?.trim();
    if (!a) continue;
    nombres.add(miembroDeCloser(a, e.equipo)?.nombre ?? a);
  }
  return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
}

/* ---------- Para cuándo estima cerrarlo ---------- */

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Las fechas de los atajos: el domingo de esta semana, el último día del
 *  mes y dentro de un mes. */
export function atajosDeCierre(hoy: string): { valor: string; texto: string }[] {
  const d = new Date(`${hoy}T12:00:00Z`);
  const domingo = new Date(d); domingo.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  const finDeMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12));
  const enUnMes = new Date(d); enUnMes.setUTCDate(d.getUTCDate() + 30);
  return [
    { valor: iso(domingo), texto: "Esta semana" },
    { valor: iso(finDeMes), texto: "Este mes" },
    { valor: iso(enUnMes), texto: "Más adelante" },
  ];
}
