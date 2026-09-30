import type { Ajustes, EstadoApp, OpcionCrm, ResultadoLlamada, Sesion } from "./types";
import { miembroDeCloser, opcionesDe, sinTildes } from "./crm";
import { diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   El cierre del día del closer (EOD).

   Al final del día el closer pasa por sus llamadas de a una, como un
   Typeform, y con un par de clics deja cómo terminó cada una (Yari,
   29/09: "que los closers, de forma bien fácil y cargando la mínima
   cantidad de cosas posible, puedan reflejar si sucedió una venta y, si
   no se cerró, qué pasó"). Como en Blue OS: el resultado, la objeción,
   si hizo la oferta y para cuándo estima cerrarlo.

   - Compró: se carga la venta en el asistente de siempre. La venta pasa
     al lead a cliente y marca la llamada (Estado de Llamada).
   - No compró: por qué (la objeción), si hizo la oferta y para cuándo
     estima cerrarlo, más una nota si quiere.
   - No se presentó: queda como que no vino (también en la Agenda).
   - Se reprogramó: la agenda nueva entra sola desde Calendly.

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

export const TEXTO_RESULTADO: Record<ResultadoLlamada, string> = {
  compro: "Con cierre",
  "no-compro": "Sin cierre",
  "no-vino": "No se presentó",
  reprogramo: "Reprogramó",
};

export interface RespuestaEod {
  resultado: ResultadoLlamada;
  objecion?: string;
  hizoOferta?: boolean;
  /* aaaa-mm-dd, o null: "no se va a cerrar". */
  cierreEstimado?: string | null;
  nota?: string;
  grabacion?: string;
}

/* Lo que falta para dar por cargada una llamada. */
export function faltaEnRespuesta(r: RespuestaEod | undefined): string | null {
  if (!r) return "Elegí cómo terminó la llamada";
  if (r.resultado !== "no-compro") return null;
  if (!r.objecion) return "Elegí por qué no cerró";
  if (r.hizoOferta === undefined) return "Contá si hiciste la oferta";
  if (r.cierreEstimado === undefined) return "Elegí para cuándo estimás cerrarlo";
  return null;
}

/* La opción del Estado de Llamada que corresponde, por su nombre de
   siempre o por lo que hace; si la cambiaron y no se encuentra, no se toca. */
function opcion(opciones: OpcionCrm[], nombre: RegExp, cumple?: (o: OpcionCrm) => boolean): string | undefined {
  return (opciones.find((o) => nombre.test(sinTildes(o.nombre))) ?? (cumple ? opciones.find(cumple) : undefined))?.nombre;
}

/** Lo que se guarda en la llamada con la respuesta del EOD. */
export function cambiosDelEod(
  r: RespuestaEod, s: Pick<Sesion, "notas" | "estadoLlamada">, a: Ajustes, quien: string, cuando: string,
): Partial<Sesion> {
  const opciones = opcionesDe(a, "estadoLlamada");
  const c: Partial<Sesion> = { resultado: r.resultado, eodEn: cuando, eodPor: quien };
  if (r.resultado === "no-compro") {
    c.objecion = r.objecion;
    c.hizoOferta = r.hizoOferta;
    c.cierreEstimado = r.cierreEstimado ?? undefined;
    const noCalifica = /no califica/.test(sinTildes(r.objecion ?? ""));
    c.estadoLlamada = noCalifica
      ? opcion(opciones, /no calificad/, (o) => o.oportunidad === "perdida" && o.llamada === "hecha")
      : r.cierreEstimado === null
        ? opcion(opciones, /descartad/, (o) => o.oportunidad === "perdida")
        : opcion(opciones, /seguimiento nutric/, (o) => o.llamada === "hecha" && !o.oportunidad && !o.auto);
    c.estado = "hecha";
  } else {
    /* Si cambió de idea (antes había dicho que no compró), se limpia. */
    c.objecion = undefined;
    c.hizoOferta = r.resultado === "compro" ? true : undefined;
    c.cierreEstimado = undefined;
  }
  /* Compró: la llamada se hizo (el Estado de Llamada lo pone la venta). */
  if (r.resultado === "compro") c.estado = "hecha";
  if (r.resultado === "no-vino") {
    c.estadoLlamada = opcion(opciones, /inasist/, (o) => o.auto === "no-show");
    c.estado = "no-show";
  }
  const nota = r.nota?.trim();
  if (nota && !(s.notas ?? "").includes(nota)) c.notas = s.notas?.trim() ? `${s.notas.trim()}\n${nota}` : nota;
  if (r.grabacion?.trim()) c.grabacion = r.grabacion.trim();
  return c;
}

/** La respuesta que ya está cargada en una llamada, para volver a editarla. */
export function respuestaDe(s: Sesion): RespuestaEod | undefined {
  if (!s.resultado) return undefined;
  return {
    resultado: s.resultado,
    objecion: s.objecion,
    hizoOferta: s.hizoOferta,
    cierreEstimado: s.resultado === "no-compro" ? s.cierreEstimado ?? null : undefined,
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

/** Las que ya pasaron y quedaron sin cargar, de días anteriores. */
export function pendientesAntesDe(e: Pick<EstadoApp, "sesiones" | "equipo">, closer: string, dia: string, ventasDe: (s: Sesion) => boolean): Sesion[] {
  return e.sesiones
    .filter((s) => s.estado !== "cancelada" && !s.resultado && diaDeNegocio(s.inicia) < dia && esDelCloser(s, closer, e.equipo) && !ventasDe(s))
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
