/* ==================================================================
   La bienvenida del alumno según su perfil y lo que compró (Lili, 22/10;
   traspaso/bienvenidas-lili-22-10.md).

   El closer carga el PERFIL del alumno al llenar los datos del contrato
   (Full Stack, Mobile Developer, Data Engineer o AI Engineer). Al firmar,
   el alumno recibe:
   - su ROADMAP (uno por perfil),
   - el paso a paso de su programa (programa completo, Downsell o Reserva;
     Hackear Biz y Principals todavía no tienen el suyo: lo ve Manu),
   - el link de su FORMULARIO SEMANAL, para completarlo todos los lunes
     (sólo el programa completo, que tiene seguimiento),
   - el WhatsApp de soporte (Liliana).
   Lo ve en la página de bienvenida apenas firma y le llega por mail
   (cuando está configurado Resend: RESEND_API_KEY y RESEND_FROM).
   Todo acá es puro, para poder probarlo.
   ================================================================== */

import { enlaceWhatsapp } from "./contacto-telefono";
import { enlaceDelAlumno } from "./links-alumno";

export const PERFILES = ["Full Stack", "Mobile Developer", "Data Engineer", "AI Engineer"] as const;
export type PerfilAlumno = (typeof PERFILES)[number];

/* Los links de los roadmaps (contenido pago) y los WhatsApp de soporte NO van en el código: el repositorio es
   público. Viven en Ajustes (columna `bienvenida` de la tabla ajustes, supabase/bienvenida-mail.sql). */
export interface ConfigBienvenida {
  roadmaps?: Partial<Record<PerfilAlumno, string>>;
  soporte?: { nombre?: string; whatsapp?: string };
  auditoriaCv?: { nombre?: string; whatsapp?: string };
  /* Adónde van las respuestas del alumno al mail de bienvenida (el remitente de hackearit.com no tiene casilla). */
  responderA?: string;
}

export interface Contacto { nombre: string; whatsapp: string; enlace: string | null }

const contactoDe = (c: { nombre?: string; whatsapp?: string } | undefined, nombre: string): Contacto | null =>
  c?.whatsapp?.trim() ? { nombre: c.nombre?.trim() || nombre, whatsapp: c.whatsapp.trim(), enlace: enlaceWhatsapp(c.whatsapp) } : null;

export const esPerfil = (x: unknown): x is PerfilAlumno => typeof x === "string" && (PERFILES as readonly string[]).includes(x);

const plano = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** El perfil de la bienvenida que corresponde a lo que dice el «Stack» de la ficha de Servicio (Programa → Perfil), que
    en la base viene escrito de muchas maneras («AI ENGINEER», «IA Engineer», «full stack»). Backend, Frontend y los
    demás no tienen roadmap propio: null. */
export function perfilDeStack(stack: string | null | undefined): PerfilAlumno | null {
  const t = plano(stack ?? "");
  if (!t) return null;
  if (t === "ai engineer" || t === "ia engineer") return "AI Engineer";
  return PERFILES.find((p) => plano(p) === t) ?? null;
}

/** El perfil con el que se arma la bienvenida. Es UN solo dato con Programa → Perfil de la ficha (Lili, 25–26/10: «que se
    complete en los dos lados y viceversa»): manda el de la ficha si es uno de los roadmaps, porque es el que Servicio
    mantiene al día; si ahí no hay ninguno (vacío, o uno más fino como «Backend»), el que cargó el closer en el contrato.
    Elegirlo en la bienvenida lo deja en los dos lados, y el contrato que lo cambia lo pasa a la ficha
    (supabase/contrato-completa-ficha.sql). */
export function perfilEfectivo(delContrato: unknown, stackDeLaFicha: string | null | undefined): PerfilAlumno | null {
  return perfilDeStack(stackDeLaFicha) ?? (esPerfil(delContrato) ? delContrato : null);
}

/* Lo que cubre la bienvenida: el programa completo (Hackear AI), el Downsell o la Reserva. */
export type ModeloBienvenida = "completo" | "downsell" | "reserva";

/** El modelo según el contrato: la reserva manda; después, el programa. Hackear Biz y Principals: null (no hay texto). */
export function modeloDeBienvenida(c: { reserva?: boolean; programa: string }): ModeloBienvenida | null {
  if (c.reserva) return "reserva";
  if (c.programa === "downsell") return "downsell";
  if (c.programa === "hackear-ai") return "completo";
  return null;
}

export interface GuiaBienvenida {
  modelo: ModeloBienvenida;
  perfil: PerfilAlumno | null;
  roadmap: string | null;
  /* El formulario semanal (sólo el programa completo). */
  formulario: string | null;
  /* El link para anotarse al simulacro de los martes (sólo el programa completo). */
  simulacro: string | null;
  /* El link para dejar la consulta de los jueves si no puede ir a la clase (sólo el programa completo). */
  consulta: string | null;
  /* Su código personal, el mismo para todo (el reporte y los simulacros); los dos links ya lo traen. */
  codigo: string | null;
  soporte: Contacto | null;
  auditoriaCv: Contacto | null;
}

export function guiaDeBienvenida(a: {
  reserva?: boolean; programa: string; perfil?: string | null; formulario?: string | null; simulacro?: string | null; consulta?: string | null; codigo?: string | null;
  config?: ConfigBienvenida | null;
}): GuiaBienvenida | null {
  const modelo = modeloDeBienvenida(a);
  if (!modelo) return null;
  const perfil = esPerfil(a.perfil) ? a.perfil : null;
  const roadmap = perfil ? a.config?.roadmaps?.[perfil]?.trim() || null : null;
  return {
    modelo, perfil, roadmap: roadmap && /^https:\/\//.test(roadmap) ? roadmap : null,
    formulario: modelo === "completo" ? a.formulario ?? null : null,
    simulacro: modelo === "completo" ? a.simulacro ?? null : null,
    consulta: modelo === "completo" ? a.consulta ?? null : null,
    codigo: modelo === "completo" ? a.codigo ?? null : null,
    soporte: contactoDe(a.config?.soporte, "Liliana"),
    auditoriaCv: contactoDe(a.config?.auditoriaCv, "Aldana"),
  };
}

/** Con su código personal (Juan Cruz, 24/10): el link del formulario de los lunes, el de los simulacros y el de las consultas
    de los jueves ya lo traen (lib/links-alumno.ts), y el código va también a la vista. Sólo el programa completo, el que tiene seguimiento y simulacros. El mail, la página de
    bienvenida y el mensaje que se copia desde la ficha pasan por acá, así dicen lo mismo. */
export function conCodigoDelAlumno(g: GuiaBienvenida, origen: string, codigo: string | null | undefined): GuiaBienvenida {
  if (g.modelo !== "completo" || !codigo) return g;
  return {
    ...g, codigo,
    formulario: enlaceDelAlumno("reporte", origen, codigo),
    simulacro: enlaceDelAlumno("simulacro", origen, codigo),
    consulta: enlaceDelAlumno("consulta", origen, codigo),
  };
}

/* ---------- El mail ---------- */

const pasosCompleto = (aldana: string) => `1. Comenzá en Wisboo – Hackear IT
• Realizá la Introducción, el Módulo 0 y el Módulo 1.

2. Definí tu roadmap y alineación técnica
• Seguí las indicaciones de tu roadmap para definir tu stack y alinearte con el mercado.
• Si mantenés tu stack actual, continuá con el recorrido de Hackear IT.
• Si elegís Python + FastAPI, nuestro stack fuertemente recomendado, completá primero el Módulo 0 de Hackear AI y luego retomá Hackear IT.

3. Completá el Módulo 8 – Take Home Challenge (THC)
• Realizá el desafío sin utilizar IA.
• Si elegiste Python + FastAPI, completá previamente el Módulo 0 de Hackear AI.

4. Avanzá del Módulo 2 al 5
• Prepará tu perfil para comenzar a conseguir entrevistas de HR.
• Cuando tengas tu CV y LinkedIn editados, podés enviárselos a Aldana para recibir una auditoría personalizada.

📩 Contacto de Aldana: ${aldana}

(¡IMPORTANTE! Es obligatorio completar los pasos 1, 2 y 3, incluida la recomendación correspondiente del Módulo 2, antes de enviar tu CV y LinkedIn a Aldana.)

5. Del Módulo 6 al 12
• Enfocate en la preparación para las entrevistas técnicas.

6. Incorporá el contenido de IA en el momento adecuado
• En Hackear IT, aprovechá el contenido de IA disponible.
• También tenés todo el contenido de Hackear AI para profundizar tus conocimientos y herramientas.
• Priorizá lo que realmente necesites según las búsquedas y posiciones a las que estés aplicando.

7. Aprovechá los bonos disponibles
• Tenés contenido extra para complementar tu formación.

⚠️ Importante: no intentes estudiar todo al mismo tiempo. Primero alineate con el mercado, definí tu stack y avanzá hacia las entrevistas de HR. Incorporá los conocimientos de IA de forma estratégica, según las necesidades reales de tu perfil y de las posiciones a las que apuntes.`;

const PASOS_DOWNSELL = `1. Comenzá en Wisboo – Hackear IA
• Realizá la Introducción, el Módulo 0 y el Módulo 1 del contenido correspondiente a tu recorrido.

2. Definí tu roadmap y alineación técnica
• Seguí las indicaciones de tu roadmap para definir tu stack y alinearte con el mercado.
• Si decidís mantener tu stack actual, continuá con el recorrido indicado.
• Si elegís Python + FastAPI, nuestro stack fuertemente recomendado, completá primero el Módulo 0 de Hackear IA para aprender ambas tecnologías y alinearte con el mercado.

3. Completá el Módulo 8 – Take Home Challenge (THC)
• Realizá el desafío sin utilizar IA.
• Si elegiste Python + FastAPI, completá previamente el Módulo 0 de Hackear IA.

4. Avanzá del Módulo 2 al 5
• Prepará tu perfil para comenzar a postularte y conseguir entrevistas de HR.
• Seguí las recomendaciones de los módulos para avanzar con una estrategia alineada al mercado.

5. Del Módulo 6 al 12
• Enfocate en la preparación para las entrevistas técnicas.

6. Incorporá los conocimientos de IA estratégicamente
• Aprovechá el contenido de IA disponible dentro de Hackear IA.
• Priorizá los conocimientos y herramientas que realmente necesites según las búsquedas y posiciones a las que estés aplicando.

7. Aprovechá los bonos disponibles
• Si tu programa incluye contenido extra, utilizalo para complementar tu formación y reforzar tus conocimientos.

⚠️ Importante: no intentes estudiar todo al mismo tiempo. Primero alineate con el mercado, definí tu stack y avanzá hacia las entrevistas de HR. Incorporá los conocimientos y herramientas de IA de forma estratégica, según las necesidades reales de tu perfil y de las posiciones a las que apuntes.

Si elegís Python + FastAPI, recordá completar el Módulo 0 de Hackear IA antes del Take Home Challenge.`;

const roadmapTexto = (g: GuiaBienvenida) => g.roadmap
  ? `Tu roadmap personalizado (${g.perfil}): ${g.roadmap}`
  : "Tu roadmap personalizado te lo pasa el equipo de soporte en estos días.";

/* El link a su página de bienvenida, donde están los accesos (el link a Wisboo, los grupos de Telegram y el Zoom). Hace falta
   en el mail: a los contratos que el equipo manda a mano desde PandaDoc, la firma no los lleva a esa página (23/10: Eduardo
   no sabía a qué Wisboo entrar y se hizo una cuenta en otro sitio). */
const accesosTexto = (pagina: string | null | undefined) => pagina ? `

🔑 Tus accesos

Entrá acá para ingresar a Wisboo, sumarte a los grupos de Telegram y ver tus reuniones de Zoom (guardá este link):
${pagina}` : "";

/** El mail de bienvenida, en texto: el que sale por Resend y el que se copia para mandar por WhatsApp. `pagina`: el link a su
    página de bienvenida (con sus accesos); la reserva no lo lleva porque todavía no tiene accesos. */
export function textoDeBienvenida(g: GuiaBienvenida, pagina?: string | null): { asunto: string; texto: string } {
  if (g.modelo === "reserva") {
    return {
      asunto: "¡Felicitaciones por dar este primer paso! 🚀",
      texto: `¡Felicitaciones por dar este primer paso! 🚀

¡Ya recibimos tu reserva! Estás un paso más cerca de comenzar a trabajar estratégicamente en tu desarrollo profesional y prepararte para las oportunidades del mercado IT.

Como parte de este primer paso, te compartimos tu roadmap personalizado, una guía para identificar qué tecnologías necesitás priorizar y cómo orientar tu preparación según la demanda actual del mercado.

${roadmapTexto(g)}

📍 ¿Qué hacer ahora?

1. Revisá tu roadmap
Analizá las recomendaciones y los pasos indicados. La idea es que puedas identificar hacia dónde enfocar tu aprendizaje y qué necesitás fortalecer para acercarte a las oportunidades laborales que buscás.

2. Prepará tu próximo paso
No se trata de aprender todo al mismo tiempo, sino de avanzar con una estrategia clara, enfocándote en las tecnologías y habilidades que realmente pueden marcar una diferencia en tu perfil.

3. Completá tu inscripción y comenzá la mentoría
Para activar tu acceso completo, te recomendamos completar el pago restante lo antes posible. Así vas a poder ingresar al contenido de la mentoría Hackear IA, acceder a las herramientas y recursos disponibles y comenzar tu proceso de preparación con el acompañamiento correspondiente.

Vas a contar con una metodología de trabajo, un recorrido estructurado, preparación para entrevistas y recursos para desarrollar las habilidades que necesitás para avanzar hacia tu objetivo profesional.

🎯 Tu próximo paso puede marcar la diferencia

Reservar tu lugar fue el comienzo. Ahora, lo importante es transformar esa decisión en acción.

Cuanto antes completes tu inscripción, antes vas a poder empezar a trabajar en tu roadmap, avanzar con una estrategia y aprovechar los recursos de la mentoría para acercarte a tus objetivos.

¡Ya diste el primer paso! Ahora vamos por el siguiente. 🚀

Ante cualquier consulta sobre tu reserva o los próximos pasos, podés comunicarte con nuestro equipo de soporte.${g.soporte ? `
📲 WhatsApp de soporte: ${g.soporte.whatsapp}` : ""}

¡Muchos éxitos en esta nueva etapa!

Equipo de Apicanta
Mentoría Hackear IA`,
    };
  }
  if (g.modelo === "downsell") {
    return {
      asunto: "¡Bienvenido/a a Hackear IA! 🚀",
      texto: `¡Bienvenido/a a Hackear IA! 🚀

¡Ya tenés todo listo para comenzar!${accesosTexto(pagina)}

Para aprovechar al máximo el programa, es fundamental que sigas el orden de tu roadmap, avances por etapas y enfoques tu tiempo en lo que realmente necesitás en cada momento.

📍 1. Tu roadmap y paso a paso

${roadmapTexto(g)}

Es tu guía para avanzar estratégicamente y alinearte con las necesidades del mercado. Seguí estos pasos:

${PASOS_DOWNSELL}

🤝 2. ¿Necesitás ayuda durante el proceso?

Si tenés dudas sobre el recorrido, los contenidos o los pasos a seguir, podés comunicarte con ${g.soporte?.nombre ?? "nuestro equipo"}, del equipo de soporte, quien estará disponible para orientarte.${g.soporte ? `

📲 WhatsApp de soporte: ${g.soporte.whatsapp}` : ""}

——

🎯 Avanzá con estrategia y constancia

No necesitás hacerlo todo hoy. Necesitás ejecutar el paso correcto en el momento correcto y sostener el proceso.

Seguí tu roadmap, enfocá tu energía y convertí el aprendizaje en acción. 🚀

¡Muchos éxitos en esta etapa!

Apicanta
Equipo de Yari Taft`,
    };
  }
  return {
    asunto: "¡Bienvenido/a a la mentoría! 🚀",
    texto: `¡Bienvenido/a a la mentoría! 🚀

Ya tenés todo listo para comenzar. Para aprovechar al máximo la mentoría, es fundamental que sigas el orden, avances por etapas y enfoques tu energía en lo que necesitás en cada momento.${accesosTexto(pagina)}

📍 1. Tu roadmap y paso a paso

${roadmapTexto(g)}

Es tu guía para avanzar estratégicamente y alinearte con las necesidades del mercado. Seguí estos pasos:

${pasosCompleto(g.auditoriaCv?.whatsapp ?? "te lo pasa el equipo de soporte")}

📅 2. Tu seguimiento semanal

Para acompañar tu proceso y ayudarte a mantener el foco, todos los lunes deberás completar este formulario de seguimiento:

👉 ${g.formulario ?? "El link de tu formulario te lo pasa el equipo de soporte."}

Dedicá unos minutos a responderlo con sinceridad, indicando tus avances, dificultades y próximos pasos. Esto nos permitirá conocer cómo venís, detectar posibles bloqueos y ayudarte a ajustar el rumbo cuando sea necesario.

Recordá: completarlo todos los lunes es parte de tu proceso de seguimiento.${g.codigo ? `

🔑 Tu código personal: ${g.codigo}
Es tuyo y sirve para todo: el formulario de los lunes, los simulacros de los martes y las consultas de los jueves. Tus links ya lo traen, así que no hace falta escribirlo; guardalo por las dudas.` : ""}

🎥 3. Aprovechá las salas de Zoom
Hora 18hs hora Argentina
• Martes: práctica y simulacros de entrevistas o tema nuevo.${g.simulacro ? ` Para que te tomen un simulacro, anotate acá:
👉 ${g.simulacro}` : ""}
• Miércoles: consultas exclusivamente sobre IA.
• Jueves: consultas generales.${g.consulta ? ` Si no podés venir, dejá tu consulta acá y mirá la respuesta en la grabación:
👉 ${g.consulta}` : ""}

Estas instancias son una oportunidad para resolver dudas, practicar y seguir avanzando.

🤝 4. ¿Necesitás ayuda durante el proceso?

${g.soporte?.nombre ?? "El equipo de soporte"}${g.soporte ? ", del equipo de soporte," : ""} va a estar disponible para acompañarte, resolver tus dudas y ayudarte a destrabar cualquier dificultad que surja durante la mentoría.${g.soporte ? `

📲 WhatsApp de soporte: ${g.soporte.whatsapp}` : ""}

——

🎯 Tu compromiso es avanzar con estrategia y constancia.

No necesitás hacerlo todo hoy. Necesitás ejecutar el paso correcto en el momento correcto y sostener el proceso semana a semana.

¡Vamos por esos resultados!

Apicanta
Equipo de Yari Taft`,
  };
}

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** El mismo texto en HTML: renglones, links que se tocan y nada más (los clientes de mail rompen lo demás). */
export function htmlDeBienvenida(texto: string): string {
  const conLinks = escapar(texto).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f1d24;max-width:600px">${conLinks
    .split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

/* ---------- El roadmap que se elige DESPUÉS de la bienvenida (Juan Cruz, 26/10) ----------
   El mail de bienvenida sale al firmar aunque falte el perfil (con «tu roadmap te lo pasa el equipo de soporte»). Cuando
   después se elige el perfil, le llega un mail aparte con su roadmap y Customer Success recibe un aviso para mandárselo
   también por WhatsApp, con el mensaje listo para copiar desde la ficha (Contrato → Bienvenida). */

const pilaDe = (nombre?: string | null) => (nombre ?? "").trim().split(/\s+/)[0] ?? "";

/** El mail con su roadmap. null si no hay perfil o si falta el link de ese perfil en Ajustes. */
export function textoDelRoadmap(g: Pick<GuiaBienvenida, "perfil" | "roadmap" | "soporte">, nombre?: string | null): { asunto: string; texto: string } | null {
  if (!g.perfil || !g.roadmap) return null;
  const pila = pilaDe(nombre);
  return {
    asunto: `Tu roadmap personalizado (${g.perfil})`,
    texto: `Hola${pila ? ` ${pila}` : ""}!

Te compartimos tu roadmap personalizado (${g.perfil}): ${g.roadmap}

Es la guía para identificar qué tecnologías priorizar y cómo orientar tu preparación según la demanda actual del mercado. Seguí sus indicaciones en orden: no intentes estudiar todo al mismo tiempo.${g.soporte ? `

Ante cualquier duda, escribinos.
📲 WhatsApp de soporte: ${g.soporte.whatsapp}` : ""}

Apicanta
Equipo de Yari Taft`,
  };
}

/** El mismo roadmap, corto, para pegar en el WhatsApp del alumno. */
export function mensajeDelRoadmap(g: Pick<GuiaBienvenida, "perfil" | "roadmap">, nombre?: string | null): string | null {
  if (!g.perfil || !g.roadmap) return null;
  const pila = pilaDe(nombre);
  return `Hola${pila ? ` ${pila}` : ""}! Te paso tu roadmap personalizado (${g.perfil}): ${g.roadmap}\nSeguí sus indicaciones en orden y cualquier duda me escribís.`;
}

/** ¿Ya le llegó el roadmap de ESTE perfil? En el mail de bienvenida (salió con ese perfil) o en el mail aparte. */
export function roadmapYaEnviado(eventos: readonly { evento: string; detalle: Record<string, unknown>; cuando: string }[], perfil: string | null):
  { por: "bienvenida" | "mail"; cuando: string } | null {
  if (!perfil) return null;
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.detalle?.enviado !== true || e.detalle?.perfil !== perfil) continue;
    if (e.evento === "roadmap") return { por: "mail", cuando: e.cuando };
    if (e.evento === "bienvenida") return { por: "bienvenida", cuando: e.cuando };
  }
  return null;
}
