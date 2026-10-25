/* ==================================================================
   El reporte semanal sin código (Lili, 24/10).

   El link general (/reporte) pide el código de cada alumno. El que no lo
   tiene ya no queda afuera: pone su mail, nombre, apellido y WhatsApp (una
   pregunta por pantalla, antes de las de su programa) y lo completa igual.
   - Si el mail es de un alumno, el reporte va a su ficha como cualquier otro
     y le llega por mail su link personal, así la semana que viene entra con
     su código.
   - Si no (los ~100 alumnos de 2024 y 2025 que no están en la app, o alguien
     que compró con otro mail), queda en `reportes_sin_alumno` y Lili lo ata a
     un alumno o lo crea desde Reportes → Sin alumno. Atado una vez, ese mail
     va solo a ese alumno de ahí en más.
   La respuesta al alumno es la misma en los dos casos: no sirve para
   averiguar quién es alumno ni cómo se llama.

   Acá está lo puro (sin red ni base), para probarlo.
   ================================================================== */

import { esMailValido } from "./links-alumno";
import { leerFormularioYRespuestas } from "./reporte-enlace";
import { camposDelReporte, LARGO_TEXTO_CORTO, type FormularioReporte, type PreguntaReporte, type Respuestas } from "./reporte-formularios";
import type { Reporte } from "./types";

export interface DatosSinCodigo { email: string; nombre: string; apellido: string; telefono: string }

/** Las preguntas de quién es: van antes de las del programa, como las demás. Su clave empieza con «_» y no se guarda entre las respuestas. */
export const PREGUNTAS_IDENTIDAD: PreguntaReporte[] = [
  { id: "_email", titulo: "¿Cuál es tu mail?", ayuda: "El que usaste para comprar el programa.", tipo: "texto-corto", requerida: true, etiqueta: "Mail" },
  { id: "_nombre", titulo: "¿Cuál es tu nombre?", tipo: "texto-corto", requerida: true, etiqueta: "Nombre" },
  { id: "_apellido", titulo: "¿Y tu apellido?", tipo: "texto-corto", requerida: true, etiqueta: "Apellido" },
  { id: "_telefono", titulo: "¿Cuál es tu WhatsApp?", ayuda: "Con el código de país (por ejemplo +54 9 11 5555 5555), para que tu coordinadora te pueda escribir.", tipo: "texto-corto", requerida: true, etiqueta: "WhatsApp" },
];

export const esPreguntaDeIdentidad = (id: string) => PREGUNTAS_IDENTIDAD.some((p) => p.id === id);

const digitos = (s: string) => s.replace(/\D/g, "");

/** Qué le falta a una respuesta de identidad (null si está bien). */
export function problemaDeIdentidad(id: string, valor: unknown): string | null {
  const v = typeof valor === "string" ? valor.trim() : "";
  if (v.length > LARGO_TEXTO_CORTO) return "Es demasiado largo.";
  if (id === "_email") return esMailValido(v.toLowerCase()) ? null : "Escribí tu mail.";
  if (id === "_nombre") return v.length >= 2 ? null : "Escribí tu nombre.";
  if (id === "_apellido") return v.length >= 2 ? null : "Escribí tu apellido.";
  if (id === "_telefono") {
    const n = digitos(v).length;
    return n >= 8 && n <= 15 ? null : "Escribí tu WhatsApp.";
  }
  return null;
}

/** Separa lo que contestó: quién es (`_email`, `_nombre`…) y las respuestas del programa. */
export function separarIdentidad(r: Respuestas): { datos: Record<string, string>; respuestas: Respuestas } {
  const datos: Record<string, string> = {};
  const respuestas: Respuestas = {};
  for (const [k, v] of Object.entries(r)) {
    if (esPreguntaDeIdentidad(k)) datos[k.slice(1)] = String(v ?? "");
    else respuestas[k] = v;
  }
  return { datos, respuestas };
}

export interface EnvioSinCodigo { datos: DatosSinCodigo; formulario: FormularioReporte; respuestas: Respuestas }

/** Lo que manda el formulario sin código: `{ sinCodigo: { email, nombre, apellido, telefono }, formulario, respuestas }`. Un error
 *  por vez, con la pregunta que falló (`campo`: «_email», «_nombre»… o la del programa). */
export function leerEnvioSinCodigo(json: unknown): { ok: true; valor: EnvioSinCodigo } | { ok: false; error: string; campo?: string } {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, error: "No se entendió lo que mandaste." };
  const d = json as Record<string, unknown>;
  const s = (d.sinCodigo && typeof d.sinCodigo === "object" ? d.sinCodigo : {}) as Record<string, unknown>;
  for (const p of PREGUNTAS_IDENTIDAD) {
    const problema = problemaDeIdentidad(p.id, s[p.id.slice(1)]);
    if (problema) return { ok: false, error: problema, campo: p.id };
  }
  const f = leerFormularioYRespuestas(d);
  if (!f.ok) return f;
  const texto = (k: string) => String(s[k]).trim().replace(/\s+/g, " ");
  return {
    ok: true,
    valor: {
      datos: { email: texto("email").toLowerCase(), nombre: texto("nombre"), apellido: texto("apellido"), telefono: texto("telefono") },
      formulario: f.formulario, respuestas: f.respuestas,
    },
  };
}

/** Lo que se copia al reporte del alumno cuando se lo ata (las mismas columnas que guarda el reporte con código). */
export function reporteParaAtar(f: FormularioReporte, r: Respuestas): Partial<Reporte> {
  const c = camposDelReporte(f, r);
  return {
    programa: c.programa, formulario: c.formulario, respuestas: c.respuestas,
    ...(c.horas !== undefined ? { horasEstudio: c.horas } : {}),
    ...(c.entrevistas !== undefined ? { entrevistas: c.entrevistas } : {}),
    ...(c.postulaciones !== undefined ? { postulaciones: c.postulaciones } : {}),
    ...(c.bloqueo ? { bloqueo: c.bloqueo } : {}),
  };
}

/** Un id por mail y semana: mandarlo dos veces la misma semana reemplaza el anterior, como el reporte con código. */
export function idSinAlumno(email: string, semana: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return `rsa_${semana.replace(/-/g, "")}_${h.toString(36)}`;
}

/* ---------- En la app: el reporte que llegó sin alumno ---------- */

export interface ReporteSinAlumno {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  telefono: string;
  semanaDel: string;
  formulario: string;
  programa: string;
  reporte: Partial<Reporte>;
  estado: "pendiente" | "atado" | "descartado";
  alumnoId: string | null;
  reporteId: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** El alumno que parece ser (para atarlo con un clic): el del mismo mail, el del mismo WhatsApp (los últimos 8 números) o el único
 *  con ese nombre y apellido. Si hay dudas (dos con el mismo nombre), no sugiere nada. */
export function alumnoSugerido<A extends { id: string; nombre: string; email: string }>(
  r: Pick<ReporteSinAlumno, "email" | "nombre" | "apellido" | "telefono">, alumnos: readonly A[], telefonoDe: (alumnoId: string) => string | undefined,
): { alumno: A; por: "mail" | "WhatsApp" | "nombre" } | null {
  const mail = r.email.trim().toLowerCase();
  const porMail = alumnos.filter((a) => mail && a.email.trim().toLowerCase() === mail);
  if (porMail.length === 1) return { alumno: porMail[0], por: "mail" };
  const tel = digitos(r.telefono).slice(-8);
  if (tel.length === 8) {
    const porTel = alumnos.filter((a) => digitos(telefonoDe(a.id) ?? "").slice(-8) === tel);
    if (porTel.length === 1) return { alumno: porTel[0], por: "WhatsApp" };
  }
  const nombre = sinTildes(`${r.nombre} ${r.apellido}`);
  const porNombre = alumnos.filter((a) => sinTildes(a.nombre) === nombre);
  return porNombre.length === 1 ? { alumno: porNombre[0], por: "nombre" } : null;
}
