import type { ID } from "./types";

/* ==================================================================
   Consultas de los jueves (Lili, 24/10). Los jueves a las 18 h (Argentina)
   es la clase de consultas generales: el alumno que no puede ir deja su
   consulta antes, Yari (o Nahuel) la responde al comienzo de la clase y él
   mira la grabación. Reemplaza al Google Form: el alumno entra con su
   código (/consulta, lib/links-alumno.ts) y después de la clase se carga
   quién la dio y qué pasó con cada consulta. Tabla `consultas_clase`
   (supabase/consultas-clase.sql).
   ================================================================== */

export type EstadoConsulta = "recibida" | "respondida" | "no_respondida";

export interface ConsultaClase {
  id: ID;
  /* El jueves de la clase en que se responde (aaaa-mm-dd). Si pasa a la próxima clase, se corre una semana. */
  fecha: string;
  /* El jueves en que la hizo: no se mueve. */
  primeraFecha: string;
  alumnoId: ID | null;
  nombre: string;
  email: string;
  telefono: string;
  consulta: string;
  estado: EstadoConsulta;
  /* Cuántas veces pasó a la clase siguiente. */
  postergada: number;
  /* Quién dio la clase (Yari o Nahuel). */
  responsable: string | null;
  comentario: string | null;
  origen: "formulario" | "panel" | "google_form";
  cargadoPor: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/* Lo que se carga de cada consulta después de la clase (Lili: «respondida / no se respondió / queda pendiente para la próxima clase»). */
export type ResultadoConsulta = "respondida" | "no_respondida" | "proxima";
export const RESULTADOS_CONSULTA: { valor: ResultadoConsulta; nombre: string; sub: string }[] = [
  { valor: "respondida", nombre: "Respondida", sub: "Se respondió en la clase: la ve en la grabación" },
  { valor: "no_respondida", nombre: "No se respondió", sub: "No llegó a responderse y no pasa a otra clase" },
  { valor: "proxima", nombre: "Queda para la próxima clase", sub: "Pasa al jueves siguiente, con las consultas de esa clase" },
];

export const NOMBRE_ESTADO_CONSULTA: Record<EstadoConsulta, string> = {
  recibida: "Sin responder", respondida: "Respondida", no_respondida: "No se respondió",
};

/* La clase empieza a las 18 h de Argentina (UTC-3, sin horario de verano): hasta entonces, la consulta es para ese jueves. */
const HORA_DE_CLASE = 18;
const ARGENTINA_MS = -3 * 3600_000;
const dia = (d: Date) => d.toISOString().slice(0, 10);

/** El jueves en que se responde una consulta que se deja en `ahora` (ISO): el de hoy si es jueves antes de las 18 h; si no, el próximo. */
export function juevesDeLaConsulta(ahora: string): string {
  const local = new Date(Date.parse(ahora) + ARGENTINA_MS);
  const faltan = (4 - local.getUTCDay() + 7) % 7;
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + faltan, 12));
  if (faltan === 0 && local.getUTCHours() >= HORA_DE_CLASE) d.setUTCDate(d.getUTCDate() + 7);
  return dia(d);
}

/** El jueves anterior o siguiente (para moverse de clase en clase y para pasar una consulta a la próxima). */
export function otroJueves(fecha: string, semanas: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * semanas);
  return dia(d);
}

/** El último jueves que ya pasó o es hoy (aaaa-mm-dd), para saber si quedó una clase sin cargar. */
export function ultimoJueves(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 4 + 7) % 7));
  return dia(d);
}

/** Lo que falta en la consulta pública, en palabras (o null). Quién es lo dice su código. */
export function problemaDeConsulta(texto: string | undefined | null): string | null {
  const t = (texto ?? "").trim();
  if (t.length < 5) return "Escribí tu consulta.";
  if (t.length > 3000) return "La consulta es muy larga: resumila un poco (hasta 3000 letras).";
  return null;
}

/** Qué se guarda al cargar el resultado de una consulta. «Queda para la próxima» la pasa al jueves siguiente sin responder. */
export function cambiosDeResultado(c: Pick<ConsultaClase, "fecha" | "postergada">, r: ResultadoConsulta, responsable: string, comentario: string, quien: string):
  Pick<ConsultaClase, "estado" | "fecha" | "postergada" | "responsable" | "comentario" | "cargadoPor"> {
  const comun = { responsable: responsable.trim() || null, comentario: comentario.trim() || null, cargadoPor: quien || null };
  if (r === "proxima") return { ...comun, estado: "recibida", fecha: otroJueves(c.fecha, 1), postergada: (c.postergada ?? 0) + 1 };
  return { ...comun, estado: r, fecha: c.fecha, postergada: c.postergada ?? 0 };
}

/** Cómo se ve una consulta en la lista de la clase `fecha`: de esa clase, o una que se hizo antes o en esa clase y pasó a otra. */
export function enLaClase(c: Pick<ConsultaClase, "fecha" | "primeraFecha">, fecha: string): "de-la-clase" | "paso" | null {
  if (c.fecha === fecha) return "de-la-clase";
  if (c.primeraFecha <= fecha && c.fecha > fecha) return "paso";
  return null;
}

/** Lo que dice la tarjeta del panel y la página de una clase: «3 consultas · 1 respondida · 2 sin cargar». */
export function resumenDeConsultas(lista: readonly Pick<ConsultaClase, "estado">[]): { total: number; sinCargar: number; respondidas: number; texto: string } {
  const sinCargar = lista.filter((c) => c.estado === "recibida").length;
  const respondidas = lista.filter((c) => c.estado === "respondida").length;
  const partes = [`${lista.length} ${lista.length === 1 ? "consulta" : "consultas"}`];
  if (respondidas) partes.push(`${respondidas} ${respondidas === 1 ? "respondida" : "respondidas"}`);
  if (sinCargar) partes.push(`${sinCargar} sin cargar`);
  return { total: lista.length, sinCargar, respondidas, texto: lista.length ? partes.join(" · ") : "Todavía no llegó ninguna consulta" };
}
