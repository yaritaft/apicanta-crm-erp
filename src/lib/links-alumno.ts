/* ==================================================================
   Los links personales del alumno (Juan Cruz, 24/10): todo lo que el alumno
   completa (el reporte de los lunes, la inscripción al simulacro de los
   martes, la consulta de los jueves) entra con UN solo código, el del
   reporte (reporte_codigos, un UUID). El link personal ya lo trae (?c=…);
   con el link general lo pega o se lo pide a su mail.

   Un formulario público nuevo para alumnos se suma acá y sale solo en el
   mail «No tengo mi código», en el link que se copia desde la ficha y en la
   bienvenida. Puro (sin red ni base), para poder probarlo.
   ================================================================== */

export type LinkDelAlumno = "reporte" | "simulacro" | "consulta";

export const LINKS_DEL_ALUMNO: Record<LinkDelAlumno, { ruta: string; asunto: string; para: string }> = {
  reporte: { ruta: "/reporte", asunto: "Tu link para el reporte semanal", para: "completar el reporte semanal de los lunes" },
  simulacro: { ruta: "/simulacro", asunto: "Tu link para anotarte al simulacro", para: "anotarte al simulacro de entrevista de los martes" },
  consulta: { ruta: "/consulta", asunto: "Tu link para dejar tu consulta", para: "dejar tu consulta para la clase de los jueves si no podés venir" },
};

export const esLinkDelAlumno = (x: unknown): x is LinkDelAlumno => typeof x === "string" && x in LINKS_DEL_ALUMNO;

export const MSJ_CODIGO_MALO = "No encontramos ese código. Es el mismo del reporte semanal: copialo del mensaje que te mandamos, o pedí tu link con tu mail.";

/** El link de un formulario; con el código, ya entra sin pedírselo. */
export function enlaceDelAlumno(que: LinkDelAlumno, origen: string, codigo?: string): string {
  const base = `${origen.replace(/\/+$/, "")}${LINKS_DEL_ALUMNO[que].ruta}`;
  return codigo ? `${base}?c=${encodeURIComponent(codigo)}` : base;
}

const saludoDe = (nombre?: string | null) => {
  const n = (nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return n ? ` ${n[0].toUpperCase()}${n.slice(1)}` : "";
};

/** El texto para pegarle por WhatsApp: su link personal (ya trae el código). */
export function mensajeDelLink(que: LinkDelAlumno, a: { nombre?: string | null; enlace: string }): string {
  return [
    `Hola${saludoDe(a.nombre)}! Este es tu link para ${LINKS_DEL_ALUMNO[que].para}:`,
    a.enlace,
    "",
    "Es tuyo y ya trae tu código (el mismo del reporte semanal): usalo cada vez que lo necesites.",
  ].join("\n");
}

/** El mail con su link, cuando lo pide desde el formulario («No tengo mi código»). */
export function mailDelLink(que: LinkDelAlumno, a: { nombre?: string | null; enlace: string; codigo: string }): { asunto: string; texto: string } {
  return {
    asunto: LINKS_DEL_ALUMNO[que].asunto,
    texto: [
      `Hola${saludoDe(a.nombre)}!`,
      "",
      `Este es tu link para ${LINKS_DEL_ALUMNO[que].para}. Es tuyo y ya trae tu código:`,
      a.enlace,
      "",
      `Tu código es ${a.codigo}. Es el mismo para todo (el reporte, los simulacros y las consultas): guardalo.`,
    ].join("\n"),
  };
}

/** El código adentro de lo que pegó: el código solo, su link o el mensaje entero que le mandamos. "" si no hay ninguno. */
export function codigoEnTexto(s: string): string {
  return s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? "";
}

export const esMailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/** Para buscar un mail con ilike sin que «_» o «%» hagan de comodín (en un mail, «_» es común). */
export const literalParaIlike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
