/* ==================================================================
   El reporte semanal con link único (reunión del 07/10).

   Hoy a cada alumno le llega un mail con un link que vence en una semana, y
   cada semana 3 o 4 dicen «no me llegó». Lo que se decidió:
   - UN solo link, siempre el mismo (`/reporte`), y a cada alumno se le da su
     código, un UUID (no un número correlativo: si no, el 1 probaría con el 2).
   - Desde la app se copia un mensaje listo para pegar en el WhatsApp del
     alumno, o se le manda el aviso por mail (Resend).
   - Pasadas tres semanas sin reportar, el alumno figura como inactivo (eso ya
     lo cuenta lib/clientes-cs.ts).

   Acá está lo puro (sin red ni base) para poder probarlo: leer lo que manda el
   formulario público, armar el link, el mensaje y el mail, y frenar a quien
   insiste. La base y el envío están en lib/reporte-servidor.ts.
   ================================================================== */

import { esIdFormulario, FORMULARIOS, validarRespuestas, type FormularioReporte, type Respuestas } from "./reporte-formularios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un código con forma de UUID. Se comprueba antes de preguntarle a la base, que si no devolvería un error de tipo. */
export const esCodigoValido = (s: unknown): s is string => typeof s === "string" && UUID.test(s.trim());

/* Las once respuestas largas de Hackear Biz, de 2000 caracteres cada una, con acentos: entran de sobra. */
export const MAX_BYTES_ENVIO = 60_000;

/** La dirección de la app: APP_URL si está, y si no la de quien pide. */
export function origenDeLaApp(req: Request): string {
  return process.env.APP_URL?.trim() || new URL(req.url).origin;
}

/** El link que se le da a todos; con el código, el formulario ya viene lleno. */
export function enlaceDeReporte(origen: string, codigo?: string): string {
  const base = `${origen.replace(/\/+$/, "")}/reporte`;
  return codigo ? `${base}?c=${encodeURIComponent(codigo)}` : base;
}

export const primerNombre = (nombre?: string | null): string => {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? n[0].toUpperCase() + n.slice(1) : "";
};

/** El texto para pegar en un WhatsApp o un chat: «Hola Ana, acá está tu link…». */
export function mensajeParaAlumno(a: { nombre?: string | null; enlace: string; codigo: string }): string {
  const saludo = primerNombre(a.nombre);
  return [
    `Hola${saludo ? ` ${saludo}` : ""}! Este es tu link para completar el reporte semanal:`,
    a.enlace,
    "",
    `Si el formulario te pide tu código, es: ${a.codigo}`,
    "Es tuyo y siempre el mismo: guardalo y usalo cada semana.",
  ].join("\n");
}

const escaparHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** El aviso por mail: asunto, texto y HTML. El nombre lo escribe cualquiera: se escapa. */
export function armarMail(a: { nombre?: string | null; enlace: string }): { asunto: string; texto: string; html: string } {
  const saludo = primerNombre(a.nombre);
  const asunto = "Tu reporte semanal";
  const texto = [
    `Hola${saludo ? ` ${saludo}` : ""}!`,
    "",
    "Ya podés completar el reporte de esta semana. Es el mismo link de siempre, con tu código:",
    a.enlace,
    "",
    "Si el link no abre, copialo y pegalo en el navegador.",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c1530">`
    + `<p>Hola${saludo ? ` ${escaparHtml(saludo)}` : ""}!</p>`
    + `<p>Ya podés completar el reporte de esta semana. Es el mismo link de siempre, con tu código:</p>`
    + `<p><a href="${escaparHtml(a.enlace)}" style="display:inline-block;background:#f7931e;color:#1c1530;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Completar mi reporte</a></p>`
    + `<p style="color:#6b6480;font-size:13px">Si el botón no abre, copiá este link en el navegador:<br>${escaparHtml(a.enlace)}</p></div>`;
  return { asunto, texto, html };
}

export interface EnvioDelAlumno {
  codigo: string;
  /* El formulario que completó (el de su programa) y sus respuestas ya revisadas. */
  formulario: FormularioReporte;
  respuestas: Respuestas;
}

/** Lo que manda el formulario público: el código, qué formulario es y sus respuestas. Un error por vez, dicho para el alumno
 *  y con la pregunta que falló (`campo`). Una página abierta de antes de los formularios por programa manda las tres cifras
 *  sueltas (horas, entrevistas, postulaciones): se entienden como el formulario de Hackear IT. */
export function leerEnvio(json: unknown): { ok: true; valor: EnvioDelAlumno } | { ok: false; error: string; campo?: string } {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, error: "No se entendió lo que mandaste." };
  const d = json as Record<string, unknown>;
  const codigo = typeof d.codigo === "string" ? d.codigo.trim() : "";
  if (!esCodigoValido(codigo)) return { ok: false, error: "Ese código no es válido. Copialo de nuevo del mensaje que te mandamos.", campo: "codigo" };

  const antiguo = d.respuestas === undefined && d.formulario === undefined;
  const idFormulario = antiguo ? "hackear-it" : d.formulario;
  if (!esIdFormulario(idFormulario)) return { ok: false, error: "No se entendió de qué programa es este reporte. Actualizá la página y probá de nuevo.", campo: "formulario" };
  const formulario = FORMULARIOS[idFormulario];
  const crudas = antiguo ? { horas: d.horas, entrevistas: d.entrevistas, postulaciones: d.postulaciones, bloqueo: d.bloqueo } : d.respuestas;

  const v = validarRespuestas(formulario, crudas);
  if (!v.ok) {
    const p = formulario.preguntas.find((x) => x.id === v.campo);
    return { ok: false, error: p ? `${v.error} (${p.etiqueta ?? p.titulo})` : v.error, campo: v.campo || undefined };
  }
  return { ok: true, valor: { codigo, formulario, respuestas: v.valor } };
}

/** Frena a quien insiste: `golpea(clave)` anota un intento y dice si ya pasó el máximo en la ventana. En memoria, por instancia. */
export function limitador(max: number, ventanaMs: number, tope = 5000) {
  const intentos = new Map<string, number[]>();
  return {
    golpea(clave: string, ahora: number = Date.now()): boolean {
      const xs = (intentos.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
      xs.push(ahora);
      intentos.set(clave, xs);
      if (intentos.size > tope) intentos.clear();
      return xs.length > max;
    },
  };
}
