import { claveEmail } from "./contactos";
import { diaAInstante, diaDeNegocio } from "./dia-negocio";
import { leerFecha } from "./registros-webinar";
import { lunesDe, lunesDelDia } from "./reportes";
import type { Reporte } from "./types";

/* ==================================================================
   Los reportes semanales que completan los alumnos, directo a la app.

   Lili: «si se puede conectar directamente con los reportes semanales que ya
   completan los alumnos y que esa información se actualice automáticamente en el
   CRM, sería ideal». La herramienta donde los completan (un formulario, el
   Airtable) manda cada respuesta a /api/reportes/webhook con su secreto; acá
   se entiende lo que manda, se busca de qué alumno es y se arma el reporte de su
   semana. Mandar de nuevo el de la misma semana lo reemplaza (el último gana).

   Todo acá es puro (sin red ni base) para poder probarlo; la ruta pone la base.
   ================================================================== */

export const MAX_REPORTES_POR_PEDIDO = 200;
const MAX_TEXTO = 2000;

export interface ItemReporte {
  email: string;
  alumno: string;
  /* Un día de la semana que se reporta («aaaa-mm-dd»); sin dato, la de hoy. */
  dia?: string;
  horas?: number;
  entrevistas?: number;
  postulaciones?: number;
  bloqueo?: string;
  /* Lo que contestó el alumno en el formulario de su programa. Sólo lo pone el formulario público
     (lib/reporte-servidor.ts): el webhook no lo lee, así que desde afuera no se puede mandar. */
  detalle?: { programa: string; formulario: string; respuestas: Record<string, string | number> };
}

const sinMarcas = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

/* Los nombres con que puede llegar cada dato (un formulario, el Airtable, un script a mano). */
const ALIAS: Record<Exclude<keyof ItemReporte, "detalle">, string[]> = {
  email: ["email", "mail", "correo", "correoelectronico"],
  alumno: ["alumno", "nombre", "nombrecompleto", "name", "nombreyapellido"],
  dia: ["semana", "semanadel", "fecha", "fechadelreporte", "week", "date", "createdtime", "timestamp", "marcatemporal"],
  horas: ["horas", "horasestudio", "horasdeestudio", "horasestudiadas"],
  entrevistas: ["entrevistas"],
  postulaciones: ["postulaciones", "aplicaciones"],
  bloqueo: ["bloqueo", "bloqueos", "comentarios", "notas"],
};

const aNumeroNoNegativo = (x: unknown, max: number): number | undefined | "mal" => {
  if (x === undefined || x === null || x === "") return undefined;
  const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
  /* Enteros en la base: 7,5 horas se redondea a 8. */
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : "mal";
};

/** Lo que mandó la herramienta: un reporte, una lista de ellos o `{ reportes: [...] }`. */
export function leerItems(json: unknown): { items: { posicion: number; item: ItemReporte }[]; rechazados: { posicion: number; motivo: string }[]; error?: string } {
  const lista = Array.isArray(json) ? json
    : json && typeof json === "object" && Array.isArray((json as { reportes?: unknown }).reportes) ? (json as { reportes: unknown[] }).reportes
    : json && typeof json === "object" ? [json] : null;
  if (!lista) return { items: [], rechazados: [], error: "Mandá un reporte (un objeto) o una lista de reportes." };
  if (lista.length === 0) return { items: [], rechazados: [], error: "No hay ningún reporte para guardar." };
  if (lista.length > MAX_REPORTES_POR_PEDIDO) return { items: [], rechazados: [], error: `Se pueden mandar hasta ${MAX_REPORTES_POR_PEDIDO} reportes por vez.` };

  const items: { posicion: number; item: ItemReporte }[] = [];
  const rechazados: { posicion: number; motivo: string }[] = [];
  lista.forEach((crudo, i) => {
    const posicion = i + 1;
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) { rechazados.push({ posicion, motivo: "No es un reporte." }); return; }
    const por = new Map<string, unknown>();
    for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) por.set(sinMarcas(k), v);
    const dato = (campo: keyof typeof ALIAS): unknown => {
      for (const a of ALIAS[campo]) if (por.has(a) && por.get(a) !== "" && por.get(a) !== null) return por.get(a);
      return undefined;
    };
    const texto = (campo: keyof typeof ALIAS) => {
      const x = dato(campo);
      return typeof x === "string" ? x.trim().slice(0, MAX_TEXTO) : typeof x === "number" ? String(x) : "";
    };
    const email = texto("email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { rechazados.push({ posicion, motivo: "El mail no parece válido." }); return; }
    const alumno = texto("alumno");
    if (!email && !alumno) { rechazados.push({ posicion, motivo: "No dice de qué alumno es: mandá su mail." }); return; }
    const crudoDia = dato("dia");
    const dia = crudoDia === undefined ? undefined : leerFecha(String(crudoDia));
    if (crudoDia !== undefined && !dia) { rechazados.push({ posicion, motivo: "La semana no se entendió como fecha." }); return; }
    const horas = aNumeroNoNegativo(dato("horas"), 168);
    const entrevistas = aNumeroNoNegativo(dato("entrevistas"), 1000);
    const postulaciones = aNumeroNoNegativo(dato("postulaciones"), 1000);
    for (const [nombre, v] of [["Las horas de estudio", horas], ["Las entrevistas", entrevistas], ["Las postulaciones", postulaciones]] as const) {
      if (v === "mal") { rechazados.push({ posicion, motivo: `${nombre} tienen que ser un número (0 o más).` }); return; }
    }
    items.push({
      posicion,
      item: {
        email, alumno, dia,
        horas: horas as number | undefined, entrevistas: entrevistas as number | undefined, postulaciones: postulaciones as number | undefined,
        bloqueo: texto("bloqueo") || undefined,
      },
    });
  });
  return { items, rechazados };
}

export interface AlumnoBasico { id: string; nombre: string; email: string }
export interface ReporteExistente { id: string; alumnoId: string; semanaDel: string }

export interface PlanReportes {
  /* Los reportes a escribir (nuevos o que reemplazan al de esa semana). */
  filas: Reporte[];
  nuevos: number;
  actualizados: number;
  rechazados: { posicion: number; motivo: string }[];
}

/** De qué alumno es cada reporte y en qué semana cae. Dos del mismo alumno y semana en un pedido: gana el último. */
export function planificarReportes(
  items: readonly { posicion: number; item: ItemReporte }[], alumnos: readonly AlumnoBasico[], existentes: readonly ReporteExistente[],
  hoy: string, ahora: string,
): PlanReportes {
  const porMail = new Map<string, AlumnoBasico[]>();
  const porNombre = new Map<string, AlumnoBasico[]>();
  const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  for (const a of alumnos) {
    const k = claveEmail(a.email);
    if (k) porMail.set(k, [...(porMail.get(k) ?? []), a]);
    const n = sinTildes(a.nombre);
    if (n) porNombre.set(n, [...(porNombre.get(n) ?? []), a]);
  }
  const yaTiene = new Map<string, string>(existentes.map((r): [string, string] => [`${r.alumnoId}|${lunesDe(r.semanaDel)}`, r.id]));

  const plan: PlanReportes = { filas: [], nuevos: 0, actualizados: 0, rechazados: [] };
  const porClave = new Map<string, Reporte>();
  for (const { posicion, item } of items) {
    /* El mail manda; el nombre sólo sirve si es de uno solo. */
    const k = claveEmail(item.email);
    let candidatos = k ? porMail.get(k) ?? [] : [];
    if (!k) candidatos = porNombre.get(sinTildes(item.alumno)) ?? [];
    if (candidatos.length === 0) { plan.rechazados.push({ posicion, motivo: k ? "No hay un alumno con ese mail." : "No hay un alumno con ese nombre: mandá su mail." }); continue; }
    if (candidatos.length > 1) { plan.rechazados.push({ posicion, motivo: k ? "Hay más de un alumno con ese mail." : "Hay más de un alumno con ese nombre: mandá su mail." }); continue; }
    const alumno = candidatos[0];
    const dia = item.dia ?? hoy;
    /* Las semanas van de lunes a domingo: un reporte del domingo es de la semana que termina ese día. */
    const semana = lunesDelDia(dia);
    const clave = `${alumno.id}|${semana}`;
    const existente = yaTiene.get(clave);
    const fila: Reporte = {
      id: existente ?? `rep_cs_${alumno.id}_${semana}`, alumnoId: alumno.id, semanaDel: diaAInstante(semana), estado: "completado",
      completadoEn: item.dia ? diaAInstante(dia) : ahora,
      ...(item.horas !== undefined ? { horasEstudio: item.horas } : {}),
      ...(item.entrevistas !== undefined ? { entrevistas: item.entrevistas } : {}),
      ...(item.postulaciones !== undefined ? { postulaciones: item.postulaciones } : {}),
      ...(item.bloqueo ? { bloqueo: item.bloqueo } : {}),
      ...(item.detalle ? { programa: item.detalle.programa, formulario: item.detalle.formulario, respuestas: item.detalle.respuestas } : {}),
    };
    porClave.set(clave, fila);
    if (!existente) yaTiene.set(clave, fila.id);
  }
  for (const [clave, fila] of porClave) {
    plan.filas.push(fila);
    if (existentes.some((r) => `${r.alumnoId}|${lunesDe(r.semanaDel)}` === clave)) plan.actualizados++; else plan.nuevos++;
  }
  return plan;
}

/** Hoy en Argentina, para la semana de un reporte que no dice cuál es. */
export const hoyParaReportes = (ahora: Date = new Date()) => diaDeNegocio(ahora.toISOString());
