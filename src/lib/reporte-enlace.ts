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

import { ATAJO_DE, esIdFormulario, FORMULARIOS, validarRespuestas, type FormularioReporte, type IdFormulario, type Respuestas } from "./reporte-formularios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Un código con forma de UUID. Se comprueba antes de preguntarle a la base, que si no devolvería un error de tipo. */
export const esCodigoValido = (s: unknown): s is string => typeof s === "string" && UUID.test(s.trim());

/* Las once respuestas largas de Hackear Biz, de 2000 caracteres cada una, con acentos: entran de sobra. */
export const MAX_BYTES_ENVIO = 60_000;

/** La dirección de la app: APP_URL si está, y si no la de quien pide. */
export function origenDeLaApp(req: Request): string {
  return process.env.APP_URL?.trim() || new URL(req.url).origin;
}

/** El link que se le da a todos; con el código, el formulario ya viene lleno. Con `formulario`, entra directo al de ese programa:
 *  el alumno que cursa Hackear Biz e IA tiene dos links, uno por formulario (Lili, 29/10). */
export function enlaceDeReporte(origen: string, codigo?: string, formulario?: IdFormulario): string {
  const base = `${origen.replace(/\/+$/, "")}/reporte`;
  if (!codigo) return base;
  return `${base}?c=${encodeURIComponent(codigo)}${formulario ? `&p=${ATAJO_DE[formulario]}` : ""}`;
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

/** El texto para pegar en un WhatsApp con el link de cada formulario que le toca (dos si cursa Hackear Biz e IA). */
export function mensajeConFormularios(a: { nombre?: string | null; codigo: string; formularios: { programa: string; enlace: string }[] }): string {
  const saludo = primerNombre(a.nombre);
  if (a.formularios.length <= 1) return mensajeParaAlumno({ nombre: a.nombre, enlace: a.formularios[0]?.enlace ?? "", codigo: a.codigo });
  return [
    `Hola${saludo ? ` ${saludo}` : ""}! Estos son tus links para completar los formularios semanales (son dos, uno por programa):`,
    "",
    ...a.formularios.flatMap((f) => [`• ${f.programa}:`, f.enlace, ""]),
    `Si el formulario te pide tu código, es: ${a.codigo}`,
    "Son tuyos y siempre los mismos: guardalos y usalos cada semana.",
  ].join("\n");
}

const escaparHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** El aviso por mail de un alumno que completa más de un formulario: un botón por formulario que todavía le falta. */
export function armarMailConFormularios(a: { nombre?: string | null; formularios: { programa: string; enlace: string }[] }): { asunto: string; texto: string; html: string } {
  if (a.formularios.length <= 1) return armarMail({ nombre: a.nombre, enlace: a.formularios[0]?.enlace ?? "", programa: a.formularios[0]?.programa });
  const saludo = primerNombre(a.nombre);
  const programas = a.formularios.map((f) => f.programa);
  const asunto = `Tus formularios semanales de ${programas.join(" y ")}`;
  const texto = [
    `Hola${saludo ? ` ${saludo}` : ""}!`,
    "",
    "Ya podés completar tus formularios de seguimiento de esta semana. Son los mismos links de siempre, con tu código:",
    "",
    ...a.formularios.flatMap((f) => [`• ${f.programa}:`, f.enlace, ""]),
    "Si un link no abre, copialo y pegalo en el navegador.",
  ].join("\n");
  const botones = a.formularios.map((f) => `<p style="margin:0 0 12px"><a href="${escaparHtml(f.enlace)}" style="display:inline-block;background:#f7931e;color:#1c1530;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px">Completar ${escaparHtml(f.programa)}</a><br><span style="color:#6b6480;font-size:13px">${escaparHtml(f.enlace)}</span></p>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c1530">`
    + `<p>Hola${saludo ? ` ${escaparHtml(saludo)}` : ""}!</p>`
    + `<p>Ya podés completar tus formularios de seguimiento de esta semana. Son los mismos links de siempre, con tu código:</p>${botones}`
    + `<p style="color:#6b6480;font-size:13px">Si un botón no abre, copiá su link en el navegador.</p></div>`;
  return { asunto, texto, html };
}

/** El aviso por mail: asunto, texto y HTML. El nombre lo escribe cualquiera: se escapa. */
export function armarMail(a: { nombre?: string | null; enlace: string; programa?: string }): { asunto: string; texto: string; html: string } {
  const saludo = primerNombre(a.nombre);
  const asunto = a.programa ? `Tu formulario semanal de ${a.programa}` : "Tu reporte semanal";
  const deQue = a.programa ? `el formulario de seguimiento de esta semana de ${a.programa}` : "el reporte de esta semana";
  const texto = [
    `Hola${saludo ? ` ${saludo}` : ""}!`,
    "",
    `Ya podés completar ${deQue}. Es el mismo link de siempre, con tu código:`,
    a.enlace,
    "",
    "Si el link no abre, copialo y pegalo en el navegador.",
  ].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1c1530">`
    + `<p>Hola${saludo ? ` ${escaparHtml(saludo)}` : ""}!</p>`
    + `<p>Ya podés completar ${escaparHtml(deQue)}. Es el mismo link de siempre, con tu código:</p>`
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

  const f = leerFormularioYRespuestas(d);
  return f.ok ? { ok: true, valor: { codigo, formulario: f.formulario, respuestas: f.respuestas } } : f;
}

/** El formulario y sus respuestas revisadas: lo mismo con código y sin código (lib/reporte-sin-codigo.ts). */
export function leerFormularioYRespuestas(d: Record<string, unknown>): { ok: true; formulario: FormularioReporte; respuestas: Respuestas } | { ok: false; error: string; campo?: string } {
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
  return { ok: true, formulario, respuestas: v.valor };
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
