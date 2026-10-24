import type { ID } from "./types";
import { enlaceDelAlumno, mailDelLink, mensajeDelLink } from "./links-alumno";

/* ==================================================================
   Simulacros de entrevista de los martes (Lili, 23/10). Los martes Yari o
   Nahuel le toman un simulacro de entrevista a 1, 2 o 3 alumnos; hacer al
   menos uno es condición del contrato. El alumno se inscribe en la app
   (/simulacro, reemplaza al Google Form), y después de la clase se carga
   cómo fue. Tabla `simulacros` (supabase/simulacros.sql).
   ================================================================== */

/* «sin_registro»: las inscripciones viejas del Google Form (importadas el 24/10): la planilla no dice si se hizo. */
export type EstadoSimulacro = "inscripto" | "hecho" | "no_se_presento" | "no_se_preparo" | "otro" | "sin_registro";

export interface Simulacro {
  id: ID;
  /* El martes de la clase (aaaa-mm-dd). */
  fecha: string;
  nombre: string;
  telefono: string;
  stack: string;
  /* Lo que pidió al inscribirse (TIPOS_PEDIDOS). */
  tipoPedido: string;
  preparado: boolean;
  alumnoId: ID | null;
  origen: "formulario" | "panel" | "google_form";
  estado: EstadoSimulacro;
  motivo: string | null;
  /* Lo que se le tomó: «Técnica» o «Recursos Humanos». */
  tipoTomado: string | null;
  tecnologias: string | null;
  comentario: string | null;
  /* Quién lo tomó (Yari o Nahuel). */
  responsable: string | null;
  cargadoPor: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

/* Las opciones del Google Form, tal cual. */
export const TIPOS_PEDIDOS = [
  "Teórico técnica",
  "Algoritmia",
  "Diseño de Arquitectura / System Design",
  "Take Home Challenge defensa",
  "Recursos Humanos",
] as const;

export const TEXTO_PREPARADO = "Sí, ya vi el módulo de Wisboo que explica cómo pasar este tipo de entrevistas y ya me preparé";

/* Quienes los toman (su ficha de Equipo): Yari y Nahuel. Les aparece la tarjeta en su panel y van primeros al elegir. */
export const TOMAN_SIMULACROS = ["eq_yari", "eq_socio"];

/** «20 oct 2026» de un día suelto (aaaa-mm-dd), sin que la hora de Argentina lo corra al día anterior. */
export const diaDeClase = (fecha: string, fmt: (iso: string) => string): string => fmt(`${fecha.slice(0, 10)}T15:00:00.000Z`);

/* Lo que se le tomó (Lili: «Tipo de entrevista (HR / técnica)»). */
export const TIPOS_TOMADOS = ["Técnica", "Recursos Humanos"] as const;

export const RESULTADOS: { valor: Exclude<EstadoSimulacro, "inscripto">; nombre: string; sub: string }[] = [
  { valor: "hecho", nombre: "Sí, se hizo", sub: "Cuenta para la condición del contrato" },
  { valor: "no_se_presento", nombre: "No se presentó", sub: "No se conectó a la clase" },
  { valor: "no_se_preparo", nombre: "No se preparó", sub: "Se conectó pero no estaba listo: se pasó al siguiente" },
  { valor: "otro", nombre: "Otro motivo", sub: "Contá qué pasó" },
];

export const NOMBRE_ESTADO: Record<EstadoSimulacro, string> = {
  inscripto: "Inscripto", hecho: "Hecho", no_se_presento: "No se presentó", no_se_preparo: "No se preparó", otro: "No se hizo",
  sin_registro: "Sin registro (Google Form)",
};

const dia = (d: Date) => d.toISOString().slice(0, 10);

/** El martes de la clase para una inscripción de `hoy`: hoy si es martes; si no, el próximo. */
export function martesDeLaClase(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`);
  const faltan = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + faltan);
  return dia(d);
}

/** El martes anterior o siguiente (para moverse de clase en clase). */
export function otroMartes(fecha: string, semanas: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * semanas);
  return dia(d);
}

/** La clase que se muestra de entrada: la de esta semana (el martes de hoy o el último) mientras tenga algo sin cargar;
    si no, la próxima. */
export function claseDeEntrada(hoy: string): string {
  const d = new Date(`${hoy}T12:00:00Z`);
  const desde = (d.getUTCDay() - 2 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - desde);
  return dia(d);
}

/** Lo que falta en la inscripción pública, en palabras (o null). Quién es lo dice su código: no se le pide nombre ni celular. */
export function problemaDeInscripcion(x: { stack?: string; tipoPedido?: string; preparado?: boolean }): string | null {
  if (!(x.stack ?? "").trim()) return "Contanos con qué stack trabajás.";
  if (!TIPOS_PEDIDOS.includes((x.tipoPedido ?? "") as (typeof TIPOS_PEDIDOS)[number])) return "Elegí qué tipo de entrevista querés.";
  if (!x.preparado) return "Para anotarte tenés que haber visto el módulo de Wisboo y haberte preparado.";
  return null;
}

/* ---------- El código de cada alumno (Juan Cruz, 24/10) ----------
   Se anota con el MISMO código del reporte semanal: los links y el mail están en lib/links-alumno.ts, para todos los
   formularios del alumno. Estos nombres quedan por los que ya los usan. */

export { codigoEnTexto, esMailValido, literalParaIlike, MSJ_CODIGO_MALO } from "./links-alumno";

/** El link para anotarse; con el código, ya entra sin pedírselo. */
export const enlaceDeSimulacro = (origen: string, codigo?: string) => enlaceDelAlumno("simulacro", origen, codigo);
/** El texto para pegarle por WhatsApp: su link personal (ya trae el código). */
export const mensajeDeSimulacro = (a: { nombre?: string | null; enlace: string }) => mensajeDelLink("simulacro", a);
/** El mail con su link, cuando lo pide desde el formulario («No tengo mi código»). */
export const mailDeSimulacro = (a: { nombre?: string | null; enlace: string; codigo: string }) => mailDelLink("simulacro", a);

/** Lo que falta para guardar cómo fue un simulacro (o null). */
export function problemaDeResultado(x: { estado?: EstadoSimulacro | null; tipoTomado?: string | null; motivo?: string | null; responsable?: string | null }): string | null {
  if (!x.estado || x.estado === "inscripto") return "Elegí cómo fue.";
  if (x.estado === "hecho" && !x.tipoTomado) return "Elegí qué entrevista se le tomó.";
  if (x.estado === "hecho" && !x.responsable?.trim()) return "Elegí quién la tomó.";
  if (x.estado === "otro" && !x.motivo?.trim()) return "Contá qué pasó.";
  return null;
}

/** Lo que dice la ficha: cuántos hizo y si ya cumple la condición del contrato (al menos uno hecho). */
export function resumenDeSimulacros(lista: readonly Pick<Simulacro, "estado" | "fecha">[]): { hechos: number; ultimo: string | null; cumple: boolean; texto: string } {
  const hechos = lista.filter((s) => s.estado === "hecho");
  const ultimo = hechos.map((s) => s.fecha).sort().pop() ?? null;
  /* Las del Google Form no dicen si se hizo: no es «todavía no hizo ninguno», es «no se sabe». */
  const sinRegistro = lista.filter((s) => s.estado === "sin_registro").length;
  const texto = hechos.length === 0
    ? sinRegistro ? `Se anotó ${sinRegistro === 1 ? "1 vez" : `${sinRegistro} veces`} por el Google Form: falta cargar si lo hizo`
      : lista.length ? "Se anotó pero todavía no hizo ningún simulacro" : "Todavía no hizo ningún simulacro"
    : hechos.length === 1 ? "Hizo 1 simulacro" : `Hizo ${hechos.length} simulacros`;
  return { hechos: hechos.length, ultimo, cumple: hechos.length > 0, texto };
}

/** Lo que dice la tarjeta del panel de una clase: «3 inscriptos · 1 sin cargar». */
export function resumenDeClase(lista: readonly Pick<Simulacro, "estado">[]): { inscriptos: number; sinCargar: number; hechos: number; texto: string } {
  const sinCargar = lista.filter((s) => s.estado === "inscripto").length;
  const hechos = lista.filter((s) => s.estado === "hecho").length;
  const partes = [`${lista.length} ${lista.length === 1 ? "inscripto" : "inscriptos"}`];
  if (hechos) partes.push(`${hechos} ${hechos === 1 ? "hecho" : "hechos"}`);
  if (sinCargar) partes.push(`${sinCargar} sin cargar`);
  return { inscriptos: lista.length, sinCargar, hechos, texto: lista.length ? partes.join(" · ") : "Todavía no se anotó nadie" };
}
