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
import { esProgramaDeExtension, esProgramaDownsell, mesesDeCorte, WISBOO, type PlataformaDeAcceso, type Programa } from "./programas";
import { MODULOS_PARA_SIMULACRO } from "./simulacros";

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
  /* Las salas de Zoom de la semana (Lili, 28/10: «agregá al mail de bienvenida, sólo el de Hackear AI, los links de las salas»): el
     link, el ID y la clave de cada día. Salas con clave: tampoco van en el código. */
  salasZoom?: Partial<Record<DiaDeSala, SalaZoom>>;
}

export const DIAS_DE_SALA = ["martes", "miercoles", "jueves"] as const;
export type DiaDeSala = (typeof DIAS_DE_SALA)[number];
export interface SalaZoom { link?: string; id?: string; clave?: string }

/* ---------- Qué hay en cada acceso (Lili, 20/11) ----------
   Un alumno nuevo no entendía qué iba a encontrar en cada plataforma, y el mail decía lo mismo a todos aunque no todos tienen lo mismo
   (al Downsell, que no tiene Telegram ni Zoom, le decía «sumate a los grupos de Telegram y mirá tus reuniones de Zoom»; al MID, que sí
   tiene clases por un mes, no se las nombraba). LA RAÍZ: el mail eran textos fijos por modelo, sueltos de lo que la app le da a cada
   uno. Ahora los bloques de accesos, clases, bonos y dónde está el THC salen de los accesos de SU programa (Ajustes → Programas, los
   mismos con los que se le dan): si un programa suma o saca un grupo, un curso o una clase, el mail cambia solo. Acá vive sólo la
   explicación de cada uno; un acceso nuevo sin explicación sale igual con su nombre, y Ajustes → Programas lo marca. */

export interface Explicacion {
  /* Cómo se lo nombra en el mail. */
  nombre: string;
  /* Qué hay ahí, en una frase (sin punto final). */
  detalle?: string;
  /* Las clases de Zoom: qué día son (a las 18:00 de Argentina). */
  dia?: DiaDeSala;
  orden: number;
}

/* Lo que hay en Bonos (Lili, 20/11). */
export const CONTENIDO_DE_BONOS = "inversiones seguras, finanzas personales, crecimiento interno, fiscalidad y manejo de USD";

/* Por id (el de Ajustes → Programas) y, si cambió (Telegram le cambia el id al grupo que pasa a supergrupo), por nombre. */
const EXPLICACIONES: { plataforma: PlataformaDeAcceso; ids: string[]; nombre: RegExp; e: Explicacion }[] = [
  { plataforma: "wisboo", ids: [WISBOO.hackearIt], nombre: /hackear it\b/i, e: { nombre: "Hackear IT", orden: 1 } },
  { plataforma: "wisboo", ids: [WISBOO.hackearAi], nombre: /hackear (ai|ia)\b/i, e: { nombre: "Hackear IA", orden: 2 } },
  { plataforma: "wisboo", ids: [WISBOO.bonos], nombre: /^bonos\b/i, e: { nombre: "Bonos", detalle: CONTENIDO_DE_BONOS, orden: 3 } },
  { plataforma: "telegram", ids: ["-1004341505711"], nombre: /^general$/i, e: { nombre: "General", detalle: "comunidad con todos los alumnos", orden: 1 } },
  { plataforma: "telegram", ids: ["-1004338558206"], nombre: /novedades/i, e: { nombre: "Novedades", detalle: "canal donde realizamos comunicados importantes", orden: 2 } },
  { plataforma: "telegram", ids: ["-1004492115716"], nombre: /bolsa de trabajo/i, e: { nombre: "Bolsa de trabajo", detalle: "publicación de oportunidades laborales", orden: 3 } },
  { plataforma: "telegram", ids: ["-1004393795361"], nombre: /contenido recomendado/i, e: { nombre: "Contenido recomendado", detalle: "compartimos recursos y contenido de interés", orden: 4 } },
  { plataforma: "telegram", ids: ["-1003990857017"], nombre: /^hackear (ai|ia)$/i, e: { nombre: "Hackear IA", detalle: "espacio exclusivo para consultas relacionadas con IA", orden: 5 } },
  { plataforma: "zoom", ids: ["83449857065"], nombre: /simulacro/i, e: { nombre: "Simulacros y tema nuevo", detalle: "simulacros de entrevistas y tema nuevo", dia: "martes", orden: 1 } },
  { plataforma: "zoom", ids: ["84681899646"], nombre: /seguimiento/i, e: { nombre: "Seguimiento y consultas", detalle: "seguimiento y consultas en general", dia: "jueves", orden: 3 } },
  { plataforma: "zoom", ids: ["84967094264"], nombre: /consultas?\b.*\b(ia|ai)\b/i, e: { nombre: "Consultas de IA", detalle: "consultas exclusivas de IA", dia: "miercoles", orden: 2 } },
];

/** Qué es ese acceso para el alumno, o null si todavía no tiene explicación. */
export function explicacionDe(plataforma: PlataformaDeAcceso, recurso: string, nombre?: string | null): Explicacion | null {
  const r = recurso.trim(), n = (nombre ?? "").replace(/\s*[-–]\s*zoom\s*$/i, "").trim();
  return EXPLICACIONES.find((x) => x.plataforma === plataforma && x.ids.includes(r))?.e
    ?? (n ? EXPLICACIONES.find((x) => x.plataforma === plataforma && x.nombre.test(n))?.e ?? null : null);
}

export interface AccesoDelMail { recurso: string; nombre: string; detalle: string | null; dia: DiaDeSala | null }

/** Los accesos de su programa, en el orden en que se cuentan. `meses*`: si se cortan solos (el MID, al mes). */
export interface AccesosDeLaGuia {
  cursos: AccesoDelMail[];
  grupos: AccesoDelMail[];
  clases: AccesoDelMail[];
  mesesGrupos: number | null;
  mesesClases: number | null;
  /* Atajos: tiene Bonos en Wisboo (paso 7) y el grupo de Novedades (ahí está el drive con los THC). */
  bonos: boolean;
  novedades: boolean;
}

/** Los nombres que se conocen de cada acceso (`plataforma:recurso` → nombre), para los que no tienen explicación. */
export type NombresDeAccesos = Record<string, string>;

/** Lo que trae su programa, explicado. null si no se sabe el programa (el mail sale con los textos generales de antes). */
export function accesosDelPrograma(p: Pick<Programa, "wisboo" | "telegram" | "zoom" | "vencen"> | null | undefined, nombres: NombresDeAccesos = {}): AccesosDeLaGuia | null {
  if (!p) return null;
  const armar = (plataforma: PlataformaDeAcceso, ids: readonly string[]) => ids.map((id, i) => {
    const conocido = nombres[`${plataforma}:${id}`]?.trim() || null;
    const e = explicacionDe(plataforma, id, conocido);
    if (!e && !conocido) return null;
    return { recurso: id, nombre: e?.nombre ?? conocido!.replace(/\s*[-–]\s*zoom\s*$/i, ""), detalle: e?.detalle ?? null, dia: e?.dia ?? null, orden: e?.orden ?? 100 + i };
  }).filter((x): x is AccesoDelMail & { orden: number } => x !== null)
    .sort((a, b) => a.orden - b.orden).map(({ orden: _o, ...x }) => x);
  /* Si todos los de esa plataforma se cortan a los mismos meses, se dice; si no, no se promete nada. */
  const meses = (plataforma: PlataformaDeAcceso, ids: readonly string[]) => {
    const m = ids.map((id) => mesesDeCorte(p, plataforma, id));
    return m.length && m.every((x) => x !== null && x === m[0]) ? m[0] : null;
  };
  const cursos = armar("wisboo", p.wisboo ?? []), grupos = armar("telegram", p.telegram ?? []), clases = armar("zoom", p.zoom ?? []);
  return {
    cursos, grupos, clases, mesesGrupos: meses("telegram", p.telegram ?? []), mesesClases: meses("zoom", p.zoom ?? []),
    bonos: (p.wisboo ?? []).some((id) => explicacionDe("wisboo", id, nombres[`wisboo:${id}`])?.nombre === "Bonos"),
    novedades: (p.telegram ?? []).some((id) => explicacionDe("telegram", id, nombres[`telegram:${id}`])?.nombre === "Novedades"),
  };
}

/** Los accesos de un programa que el mail nombraría sin explicar qué hay (para avisarlo en Ajustes → Programas). */
export function accesosSinExplicacion(p: Pick<Programa, "wisboo" | "telegram" | "zoom">, nombres: NombresDeAccesos = {}): string[] {
  const out: string[] = [];
  for (const [plataforma, ids] of [["wisboo", p.wisboo], ["telegram", p.telegram], ["zoom", p.zoom]] as const) {
    for (const id of ids ?? []) if (!explicacionDe(plataforma, id, nombres[`${plataforma}:${id}`])) out.push(nombres[`${plataforma}:${id}`]?.trim() || id);
  }
  return out;
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
  /* La extensión del MID es para alguien que ya tiene su bienvenida y sus accesos: ni mail ni roadmap de nuevo. */
  if (esProgramaDeExtension(c.programa)) return null;
  if (esProgramaDownsell(c.programa)) return "downsell";
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
  /* Las salas de Zoom con su link, ID y clave (sólo el programa completo). */
  salas: Partial<Record<DiaDeSala, SalaZoom>>;
  soporte: Contacto | null;
  auditoriaCv: Contacto | null;
  /* Lo que trae su programa (cursos, grupos, clases), explicado. null: no se sabe el programa (sale el texto general). La reserva no tiene. */
  accesos: AccesosDeLaGuia | null;
}

/** Las salas de la config que tienen algo para mostrar (link o ID): el resto se descarta. */
function salasDe(config: ConfigBienvenida | null | undefined): Partial<Record<DiaDeSala, SalaZoom>> {
  const out: Partial<Record<DiaDeSala, SalaZoom>> = {};
  for (const d of DIAS_DE_SALA) {
    const s = config?.salasZoom?.[d];
    const link = s?.link?.trim() ?? "", id = s?.id?.trim() ?? "", clave = s?.clave?.trim() ?? "";
    if (/^https:\/\//.test(link) || id) out[d] = { ...(/^https:\/\//.test(link) ? { link } : {}), ...(id ? { id } : {}), ...(clave ? { clave } : {}) };
  }
  return out;
}

export function guiaDeBienvenida(a: {
  reserva?: boolean; programa: string; perfil?: string | null; formulario?: string | null; simulacro?: string | null; consulta?: string | null; codigo?: string | null;
  config?: ConfigBienvenida | null;
  /* Su programa tal como está en Ajustes → Programas (lo que se le da al firmar) y los nombres conocidos de sus accesos. */
  delPrograma?: Pick<Programa, "wisboo" | "telegram" | "zoom" | "vencen"> | null;
  nombres?: NombresDeAccesos;
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
    salas: modelo === "completo" ? salasDe(a.config) : {},
    soporte: contactoDe(a.config?.soporte, "Liliana"),
    auditoriaCv: contactoDe(a.config?.auditoriaCv, "Aldana"),
    accesos: modelo === "reserva" ? null : accesosDelPrograma(a.delPrograma, a.nombres),
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

/** El renglón de una sala: su link y, si hay, el ID y la clave (para entrar desde la app de Zoom si el link no abre). */
const salaTexto = (s?: SalaZoom): string => {
  if (!s) return "";
  const datos = [s.id ? `ID: ${s.id}` : "", s.clave ? `Clave: ${s.clave}` : ""].filter(Boolean).join(" · ");
  return `${s.link ? `\n👉 Sala: ${s.link}` : ""}${datos ? `\n${datos}` : ""}`;
};

const NUMEROS = ["cero", "un", "dos", "tres", "cuatro", "cinco", "seis"];

/* «durante tu primer mes» si esos accesos se cortan solos (el MID); vacío si no se cortan. */
const duranteTexto = (m: number | null | undefined): string => !m ? "" : m === 1 ? "durante tu primer mes" : `durante tus primeros ${m} meses`;

const juntar = (xs: string[]): string => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

/* Dónde está el THC: en el drive de la descripción del grupo de Novedades. A quien no está en ese grupo (Downsell, Plus+) no se lo manda
   a buscarlo ahí: se lo pide a soporte. Sin saber el programa, como antes. */
const thcTexto = (a: AccesosDeLaGuia | null): string => !a || a.novedades
  ? "• El THC lo encontrás en el drive «herramientas», que está en la descripción del grupo de novedades en Telegram: vas a encontrar dos THC, el de Full Stack y el de Data Engineer."
  : "• Hay dos THC, el de Full Stack y el de Data Engineer: pedile el tuyo al equipo de soporte por WhatsApp.";

/* El paso 7 (Lili, 20/11: que diga qué hay en Bonos). Sólo si su programa trae Bonos. */
const bonosTexto = (a: AccesosDeLaGuia | null): string => a && !a.bonos ? "" : `

7. Aprovechá los bonos disponibles
• Tenés contenido extra para complementar tu formación: ${CONTENIDO_DE_BONOS}.
• Lo encontrás en Wisboo, en la sección «Bonos».`;

const pasosCompleto = (aldana: string, a: AccesosDeLaGuia | null) => `1. Comenzá en Wisboo – Hackear IT
• Realizá la Introducción, el Módulo 0 y el Módulo 1.

2. Realizá tu roadmap para alinearte con el mercado
Una vez definido tu roadmap, tenés dos caminos:
• Si decidís mantener tu stack actual, continuá normalmente con el paso a paso de Hackear IT.
• Si decidís alinearte con Python y FastAPI, que es el stack que recomendamos fuertemente por su demanda actual en el mercado, dirigite a Hackear AI – Módulo 0 para aprender ambas tecnologías. Una vez completado, volvé a Hackear IT y continuá con el siguiente paso.

3. Completá el Módulo 8 y el Take Home Challenge (Hackear IT)
• Mirá todo el Módulo 8 y luego realizá el THC sin IA.
${thcTexto(a)}

4. Avanzá del Módulo 2 al 5 (Hackear IT)
• Prepará tu perfil para comenzar a conseguir entrevistas de HR.
• Cuando tengas tu CV y LinkedIn editados, podés enviárselos a Aldana para recibir una auditoría personalizada.

📩 Contacto de Aldana: ${aldana}

(¡IMPORTANTE! Es obligatorio completar los pasos 1, 2 y 3, incluida la recomendación correspondiente del Módulo 2, antes de enviar tu CV y LinkedIn a Aldana.)

5. Del Módulo 6 al 12 (Hackear IT)
• Enfocate en la preparación para las entrevistas técnicas.

6. Incorporá el contenido de IA (corresponde a ambos programas)
• Una vez que llegues a la etapa de entrevistas técnicas, incorporá el módulo de IA de Hackear IT y el contenido de Hackear AI según lo que realmente esté solicitando el mercado y las posiciones a las que estés aplicando.${bonosTexto(a)}

👉 No sirve estudiar IA ahora simplemente porque aparece en algunas búsquedas. Primero necesitás alinearte con el mercado, definir tu stack, comenzar con las entrevistas de HR y, cuando llegues a las entrevistas técnicas, identificar qué conocimientos de IA necesitás incorporar.`;

const pasosDownsell = (a: AccesosDeLaGuia | null) => `1. Comenzá en Wisboo – Hackear IT
• Introducción, Módulo 0 y Módulo 1.

2. Realizá tu roadmap para alinearte con el mercado
Una vez definido tu roadmap, tenés dos caminos:
• Si decidís mantener tu stack actual, continuá normalmente con el paso a paso de Hackear IT.
• Si decidís alinearte con Python y FastAPI, que es el stack que recomendamos fuertemente por su demanda actual en el mercado, dirigite a Hackear IA – Módulo 0 para aprender ambas tecnologías. Una vez completado, volvé a Hackear IT y continuá con el siguiente paso.

3. Completá el Módulo 8 y el Take Home Challenge (Hackear IT)
• Mirá todo el Módulo 8 y luego realizá el THC sin IA.
${thcTexto(a)}

4. Continuá del Módulo 2 al 5 (Hackear IT)
• Para editar tu CV y LinkedIn y comenzar a conseguir entrevistas de HR.

5. Del Módulo 6 al 12 (Hackear IT)
• Preparación para las entrevistas técnicas.

6. Incorporá el contenido de IA (corresponde a ambos programas)
• Una vez que llegues a la etapa de entrevistas técnicas, incorporá el módulo de IA de Hackear IT y el contenido de Hackear IA según lo que realmente esté solicitando el mercado y las posiciones a las que estés aplicando.

👉 No sirve estudiar IA ahora simplemente porque aparece en algunas búsquedas. Primero necesitás alinearte con el mercado, definir tu stack, comenzar con las entrevistas de HR y, cuando llegues a las entrevistas técnicas, identificar qué conocimientos de IA necesitás incorporar.`;

const roadmapTexto = (g: GuiaBienvenida) => g.roadmap
  ? `Tu roadmap personalizado (${g.perfil}): ${g.roadmap}`
  : "Tu roadmap personalizado te lo pasa el equipo de soporte en estos días.";

/* «🔑 Tus accesos»: qué hay en cada plataforma (Lili, 20/11), sólo lo que trae SU programa, y el link a su página de bienvenida, donde
   entra a cada una (el link a Wisboo, los grupos de Telegram y el Zoom). El link hace falta en el mail: a los contratos que el equipo
   manda a mano desde PandaDoc, la firma no los lleva a esa página (23/10: Eduardo no sabía a qué Wisboo entrar). */
function accesosTexto(a: AccesosDeLaGuia | null, pagina: string | null | undefined): string {
  const hay = Boolean(a && a.cursos.length + a.grupos.length + a.clases.length > 0);
  if (!pagina && !hay) return "";
  const lista: string[] = [];
  if (a?.cursos.length) {
    lista.push(`• Wisboo: la plataforma donde encontrás todo el contenido grabado, organizado en:\n${a.cursos.map((c, i) => `   ${i + 1}. ${c.nombre}`).join("\n")}`);
  }
  if (a?.grupos.length) {
    const cuando = duranteTexto(a.mesesGrupos);
    lista.push(`• Telegram: nuestro principal medio de comunicación${cuando ? ` (${cuando})` : ""}. Ahí vas a encontrar ${a.grupos.length === 1 ? "este grupo" : "estos grupos"}:\n${a.grupos.map((x) => `   – ${x.nombre}${x.detalle ? `: ${x.detalle}.` : ""}`).join("\n")}`);
  }
  if (a?.clases.length) {
    const cuando = duranteTexto(a.mesesClases);
    lista.push(`• Zoom: la plataforma donde realizamos ${a.clases.length === 1 ? "la clase semanal" : `las ${a.clases.length} clases semanales`} de acompañamiento${cuando ? ` (${cuando})` : ""}. Te las contamos más abajo.`);
  }
  const para = a ? juntar([
    a.cursos.length ? "ingresar a Wisboo" : "",
    a.grupos.length ? (a.grupos.length === 1 ? "sumarte al grupo de Telegram" : "sumarte a los grupos de Telegram") : "",
    a.clases.length ? "tener tus links de Zoom" : "",
  ].filter(Boolean)) : "";
  const link = pagina
    ? `Entrá acá para ${para || "ver tus accesos"} (guardá este link):\n${pagina}`
    : "Los links para entrar te los pasa el equipo de soporte.";
  return `\n\n🔑 Tus accesos${lista.length ? `\n\n${lista.join("\n\n")}` : ""}\n\n${link}`;
}

/* Las tres clases de siempre del programa completo, para cuando no se sabe su programa (como era antes). */
const CLASES_DE_SIEMPRE: AccesoDelMail[] = EXPLICACIONES.filter((x) => x.plataforma === "zoom")
  .sort((a, b) => a.e.orden - b.e.orden).map((x) => ({ recurso: x.ids[0], nombre: x.e.nombre, detalle: x.e.detalle ?? null, dia: x.e.dia ?? null }));

const NOMBRE_DIA: Record<DiaDeSala, string> = { martes: "Martes", miercoles: "Miércoles", jueves: "Jueves" };

/* Un día de clase. El martes explica que puede ir de oyente y qué módulos pide cada simulacro antes de anotarse (Lili, 20/11). */
function claseTexto(c: AccesoDelMail, g: GuiaBienvenida): string {
  const sala = c.dia ? salaTexto(g.salas[c.dia]) : "";
  if (!c.dia) return `• ${c.nombre}${c.detalle ? `: ${c.detalle}` : ""}.`;
  const titulo = `• ${NOMBRE_DIA[c.dia]} 18:00: ${c.detalle ?? c.nombre}.`;
  if (c.dia === "jueves") {
    return `${titulo}${g.consulta ? ` Si no podés venir, dejá tu consulta acá y mirá la respuesta en la grabación:\n👉 ${g.consulta}` : ""}${sala}`;
  }
  if (c.dia === "martes") {
    return `${titulo}${sala}

Podés sumarte como oyente y participar de la clase. Para hacer un simulacro, antes tenés que haber visto estos módulos:
– Simulacro de entrevista de HR: ${MODULOS_PARA_SIMULACRO.hr}.
– Simulacro de entrevista técnica: ${MODULOS_PARA_SIMULACRO.tecnica}.
${g.simulacro
    ? `Una vez que los completes, anotate acá para el simulacro que corresponda:\n👉 ${g.simulacro}`
    : "Una vez que los completes, vas a poder anotarte para el simulacro que corresponda."}
Así llegás preparado y aprovechás el espacio al máximo.`;
  }
  return `${titulo}${sala}`;
}

/** El bloque de las clases de Zoom de su programa, o vacío si no tiene. `numero`: el del título (cambia según lo que haya antes). */
function clasesTexto(g: GuiaBienvenida, numero: number, hayPagina: boolean): string {
  const clases = g.accesos ? g.accesos.clases : g.modelo === "completo" ? CLASES_DE_SIEMPRE : [];
  if (!clases.length) return "";
  const n = clases.length;
  const intro = clases.every((c) => c.dia)
    ? n === 1 ? "Es un día por semana, a las 18:00 (hora de Argentina):" : `Son ${NUMEROS[n] ?? n} días por semana, ${n === 2 ? "los dos" : "todos"} a las 18:00 (hora de Argentina):`
    : "Estas son tus clases de cada semana:";
  const cuando = duranteTexto(g.accesos?.mesesClases);
  const conSalas = clases.some((c) => c.dia && g.salas[c.dia]);
  const comoEntrar = conSalas
    ? "Si con el link no podés ingresar, bajá la app de Zoom e ingresá con el ID y la clave de la sala."
    : hayPagina ? "Tus links personales para entrar a cada clase están en tu página de accesos (el link de arriba)." : "";
  return `

🎥 ${numero}. Aprovechá las salas de Zoom
${cuando ? `Las tenés ${cuando}. ` : ""}${intro}

${clases.map((c) => claseTexto(c, g)).join("\n\n")}${comoEntrar ? `

${comoEntrar}` : ""}

Estas instancias son una oportunidad para resolver dudas, practicar y seguir avanzando.`;
}

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
    /* Si su programa trae clases (el MID, el primer mes), van antes de la ayuda. */
    const clases = clasesTexto(g, 2, Boolean(pagina));
    return {
      asunto: "¡Bienvenido/a a Hackear IA! 🚀",
      texto: `¡Bienvenido/a a Hackear IA! 🚀

¡Ya tenés todo listo para comenzar!${accesosTexto(g.accesos, pagina)}

Para aprovechar al máximo el programa, es fundamental que sigas el orden de tu roadmap, avances por etapas y enfoques tu tiempo en lo que realmente necesitás en cada momento.

📍 1. Tu roadmap y paso a paso

${roadmapTexto(g)}

Es tu guía para avanzar estratégicamente y alinearte con las necesidades del mercado. Seguí estos pasos:

${pasosDownsell(g.accesos)}${clases}

🤝 ${clases ? 3 : 2}. ¿Necesitás ayuda durante el proceso?

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
  const clases = clasesTexto(g, 3, Boolean(pagina));
  return {
    asunto: "¡Bienvenido/a a la mentoría! 🚀",
    texto: `¡Bienvenido/a a la mentoría! 🚀

Ya tenés todo listo para comenzar. Para aprovechar al máximo la mentoría, es fundamental que sigas el orden, avances por etapas y enfoques tu energía en lo que necesitás en cada momento.${accesosTexto(g.accesos, pagina)}

📍 1. Tu roadmap y paso a paso

${roadmapTexto(g)}

Es tu guía para avanzar estratégicamente y alinearte con las necesidades del mercado. Seguí estos pasos:

${pasosCompleto(g.auditoriaCv?.whatsapp ?? "te lo pasa el equipo de soporte", g.accesos)}

📅 2. Tu seguimiento semanal

Para acompañar tu proceso y ayudarte a mantener el foco, todos los lunes deberás completar este formulario de seguimiento:

👉 ${g.formulario ?? "El link de tu formulario te lo pasa el equipo de soporte."}

Dedicá unos minutos a responderlo con sinceridad, indicando tus avances, dificultades y próximos pasos. Esto nos permitirá conocer cómo venís, detectar posibles bloqueos y ayudarte a ajustar el rumbo cuando sea necesario.

Recordá: completarlo todos los lunes es parte de tu proceso de seguimiento.${g.codigo ? `

🔑 Tu código personal: ${g.codigo}
Es tuyo y sirve para todo: el formulario de los lunes, los simulacros de los martes y las consultas de los jueves. Tus links ya lo traen, así que no hace falta escribirlo; guardalo por las dudas.` : ""}${clases}

🤝 ${clases ? 4 : 3}. ¿Necesitás ayuda durante el proceso?

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
  /* La sangría de las listas de adentro (los cursos, los grupos) se conserva: en HTML los espacios del principio se pierden. */
  const conLinks = escapar(texto).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/^( +)/gm, (s) => "&nbsp;".repeat(s.length));
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

/* ---------- Si el alumno la vio y cómo le llegó (Lili, 17/11) ---------- */

export interface SeguimientoDeBienvenida {
  /* Cuántos mails le salieron (el primero y los reenvíos) y cuándo salió el último. */
  envios: number;
  ultimoEnvio: string | null;
  /* Cuándo abrió su página de bienvenida por primera y por última vez que quedó anotada (una cada pocas horas), y cuántas quedaron. */
  primeraVista: string | null;
  ultimaVista: string | null;
  vistas: number;
}

/** Lo que dice el historial del contrato sobre la bienvenida: cuántas veces se mandó y si el alumno abrió su página. */
export function seguimientoDeBienvenida(eventos: readonly { evento: string; detalle?: Record<string, unknown> | null; cuando: string }[]): SeguimientoDeBienvenida {
  const porFecha = [...eventos].sort((a, b) => a.cuando.localeCompare(b.cuando));
  const envios = porFecha.filter((e) => e.evento === "bienvenida" && e.detalle?.enviado !== false);
  const vistas = porFecha.filter((e) => e.evento === "bienvenida-vista");
  return {
    envios: envios.length, ultimoEnvio: envios.length ? envios[envios.length - 1].cuando : null,
    primeraVista: vistas[0]?.cuando ?? null, ultimaVista: vistas.length ? vistas[vistas.length - 1].cuando : null, vistas: vistas.length,
  };
}

/** Lo último que le pasó al mail según el servicio de mails, en palabras de Servicio. `malo`: no le llegó, hay que mandárselo por otro lado. */
export function estadoDelMail(estado: string | null | undefined): { texto: string; tono: "ok" | "neutro" | "malo" } | null {
  switch ((estado ?? "").trim().toLowerCase()) {
    case "": return null;
    case "delivered": return { texto: "Le llegó a su casilla", tono: "ok" };
    case "opened": return { texto: "Abrió el mail", tono: "ok" };
    case "clicked": return { texto: "Abrió el mail y entró al link", tono: "ok" };
    case "bounced": return { texto: "No le llegó: el mail rebotó", tono: "malo" };
    case "complained": return { texto: "Lo marcó como spam", tono: "malo" };
    case "delivery_delayed": return { texto: "Se demora en llegar", tono: "neutro" };
    case "failed": return { texto: "No se pudo mandar", tono: "malo" };
    case "sent": return { texto: "Salió; todavía sin confirmar la entrega", tono: "neutro" };
    default: return null;
  }
}
