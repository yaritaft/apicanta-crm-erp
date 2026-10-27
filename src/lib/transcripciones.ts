import { csvDe } from "./csv";
import { fechaHora, isoDia } from "./format";
import { idDeShare, duracion, type FraseGrabacion, type Grabacion } from "./fathom";
import type { ArchivoZip } from "./zip";

/* ==================================================================
   Las transcripciones de Fathom de muchas llamadas juntas, para llevarlas
   a Claude (u otra herramienta) y sacar un reporte de todo un webinar:
   «necesitaría descargar todas las transcripciones juntas» (Santi, 26/10).

   Sale un .zip con un archivo por llamada (llamadas/…md), todas en un solo
   archivo (todas-juntas.md) y un índice (indice.csv) que dice, llamada por
   llamada, si tiene transcripción y, si no, por qué. Acá, lo que no toca la
   red ni el navegador, para poder probarlo.
   ================================================================== */

/** Lo de la llamada que va al archivo (sin teléfono ni mail: para el análisis no hacen falta). */
export interface LlamadaParaTranscribir {
  sesionId: string;
  nombre: string;
  inicia: string;
  closer?: string;
  /* El Estado de Llamada, tal cual se ve en el CRM. */
  estado?: string;
  /* Cómo terminó (el desenlace del CRM: Con cierre, Sin cierre, No se presentó…): lo que separa a los que compraron de los que no. */
  resultado?: string;
  /* El link de Fathom que pegó el closer, si lo hay. */
  link?: string | null;
}

export type GrabacionDeTranscripcion = Pick<Grabacion, "sesionId" | "titulo" | "shareUrl" | "grabadaDesde" | "grabadaHasta" | "grabadoPorNombre" | "resumen" | "transcripcion">;

/** Las llamadas que no tuvieron grabación porque no se hicieron: canceladas, la persona no se presentó, reprogramadas o todavía por venir. */
const NO_SE_HIZO: Record<string, string> = {
  "Cancelada": "La llamada se canceló: no hay grabación",
  "No se presentó": "La persona no se presentó: no hay grabación",
  "Reprogramó": "Se reprogramó: la grabación, si hay, está en la otra llamada de esa persona",
  "Por venir": "Todavía no se hizo",
};
export const motivoDeNoHecha = (resultado?: string): string | null => (resultado && NO_SE_HIZO[resultado]) || null;

/** Si la llamada tiene el link de Fathom pegado. */
export const tieneLinkDeFathom = (link?: string | null) => idDeShare(link) !== null;

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Un nombre de archivo seguro: sin tildes ni símbolos, en minúsculas. */
export function nombreSeguro(s: string): string {
  const t = sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return t || "sin-nombre";
}

/** La transcripción como texto: «[00:05:32] Ana: …», juntando las frases seguidas de quien habla. */
export function textoDeTranscripcion(frases: FraseGrabacion[]): string {
  const lineas: string[] = [];
  let quien = "", t = "", texto = "";
  const cerrar = () => { if (texto) lineas.push(`[${t}] ${quien || "—"}: ${texto}`); };
  for (const f of frases) {
    if (texto && f.quien === quien) { texto += ` ${f.texto}`; continue; }
    cerrar();
    quien = f.quien; t = f.t; texto = f.texto;
  }
  cerrar();
  return lineas.join("\n");
}

/* El resumen de Fathom trae cada frase como un link largo al minuto de la grabación: sólo estorba para analizarlo. */
const sinLinks = (md: string) => md.replace(/\[([^\]]+)\]\(https?:[^)\s]+\)/g, "$1");

/** «Con cierre» y «Sin cierre» dicho como lo diría quien analiza: compró o no compró. */
export const textoDeResultado = (r: string): string => (r === "Con cierre" ? "Compró" : r === "Sin cierre" ? "No compró" : r);

const palabras = (frases: FraseGrabacion[]) => frases.reduce((n, f) => n + f.texto.split(/\s+/).filter(Boolean).length, 0);

/** La llamada como un documento (markdown): quién, cuándo, cómo terminó, el resumen de Fathom y la transcripción. */
export function documentoDeLlamada(l: LlamadaParaTranscribir, gs: GrabacionDeTranscripcion[]): string {
  const sal: string[] = [`# Llamada con ${l.nombre}`, ""];
  sal.push(`- Fecha: ${isoDia(l.inicia)} (${fechaHora(l.inicia).split(" · ")[1] ?? ""} hs)`);
  if (l.closer) sal.push(`- Closer: ${l.closer}`);
  if (l.estado) sal.push(`- Estado de la llamada: ${l.estado}`);
  if (l.resultado) sal.push(`- Resultado: ${textoDeResultado(l.resultado)}`);
  const dura = gs.map((g) => duracion(g)).find(Boolean);
  if (dura) sal.push(`- Duración: ${dura}`);
  const link = gs.find((g) => g.shareUrl)?.shareUrl ?? l.link;
  if (link) sal.push(`- Grabación: ${link}`);
  for (const g of gs) {
    if (g.resumen) sal.push("", "## Resumen de Fathom", "", sinLinks(g.resumen.trim()));
    if (g.transcripcion?.length) sal.push("", gs.length > 1 ? `## Transcripción (${g.titulo})` : "## Transcripción", "", textoDeTranscripcion(g.transcripcion));
  }
  return sal.join("\n") + "\n";
}

export interface PaqueteDeTranscripciones {
  archivos: ArchivoZip[];
  /* Desde y hasta cuándo van las que tienen transcripción, y cuántas compraron (para el LEEME). */
  desde?: string; hasta?: string; compraron: number;
  /* Cuántas llamadas tienen transcripción y de las otras, por qué no. */
  conTranscripcion: number;
  /* Sin link de Fathom: total, y de ésas cuántas ni se hicieron (cancelada, no se presentó, reprogramada, por venir) y cuántas sí se hicieron. */
  sinLink: number;
  noSeHicieron: number;
  sinLinkHechas: number;
  linkSinTranscripcion: number;
  total: number;
}

/** Las llamadas con sus grabaciones, como los archivos del .zip. */
export function armarPaquete(llamadas: LlamadaParaTranscribir[], grabaciones: Map<string, GrabacionDeTranscripcion[]>): PaqueteDeTranscripciones {
  const ordenadas = [...llamadas].sort((a, b) => a.inicia.localeCompare(b.inicia));
  const usados = new Set<string>();
  const llamadasMd: ArchivoZip[] = [];
  const juntas: string[] = [];
  const resumenes: string[] = [];
  const indice: string[][] = [];
  let con = 0, sinLink = 0, noSeHicieron = 0, sinTrans = 0, compraron = 0, desde = "", hasta = "";

  for (const l of ordenadas) {
    const gs = (grabaciones.get(l.sesionId) ?? []).filter((g) => (g.transcripcion?.length ?? 0) > 0);
    if (gs.length === 0) {
      const linkPegado = tieneLinkDeFathom(l.link);
      const noHecha = motivoDeNoHecha(l.resultado);
      if (linkPegado) sinTrans++; else { sinLink++; if (noHecha) noSeHicieron++; }
      const porQue = linkPegado ? "Tiene el link de Fathom, pero la app todavía no pudo traer su transcripción (si pasó más de un día, la grabación no está compartida con el equipo en Fathom)"
        : noHecha ?? (l.resultado === "Sin cargar" ? "Nadie cargó cómo terminó la llamada y no tiene link de Fathom" : "La llamada se hizo pero el closer no pegó el link de Fathom");
      indice.push(["", l.nombre, isoDia(l.inicia), l.closer ?? "", l.estado ?? "", l.resultado ? textoDeResultado(l.resultado) : "", "No", porQue, "0"]);
      continue;
    }
    con++;
    if (l.resultado === "Con cierre") compraron++;
    const dia = isoDia(l.inicia);
    if (!desde || dia < desde) desde = dia;
    if (!hasta || dia > hasta) hasta = dia;
    const res = gs.map((g) => g.resumen?.trim()).filter(Boolean).map((r) => sinLinks(r!)).join("\n\n");
    if (res) resumenes.push(`## ${dia} · ${l.nombre}${l.closer ? ` · ${l.closer}` : ""}${l.resultado ? ` · ${textoDeResultado(l.resultado)}` : ""}\n\n${res}\n`);
    let nombre = `llamadas/${isoDia(l.inicia)}_${nombreSeguro(l.nombre)}.md`;
    for (let i = 2; usados.has(nombre); i++) nombre = `llamadas/${isoDia(l.inicia)}_${nombreSeguro(l.nombre)}-${i}.md`;
    usados.add(nombre);
    const doc = documentoDeLlamada(l, gs);
    llamadasMd.push({ nombre, contenido: doc });
    juntas.push(doc);
    indice.push([nombre, l.nombre, isoDia(l.inicia), l.closer ?? "", l.estado ?? "", l.resultado ? textoDeResultado(l.resultado) : "", "Sí", "", String(gs.reduce((n, g) => n + palabras(g.transcripcion ?? []), 0))]);
  }

  const cabeza = ["Archivo", "Nombre", "Fecha", "Closer", "Estado de la llamada", "Resultado", "Transcripción", "Por qué no", "Palabras"];
  const paquete: PaqueteDeTranscripciones = {
    archivos: [], conTranscripcion: con, sinLink, noSeHicieron, sinLinkHechas: sinLink - noSeHicieron, linkSinTranscripcion: sinTrans, total: ordenadas.length, desde, hasta, compraron,
  };
  paquete.archivos = [
    { nombre: "LEEME.md", contenido: leemeDeDescarga(paquete) },
    { nombre: "indice.csv", contenido: `﻿${csvDe(cabeza, indice)}` },
    { nombre: "resumenes.md", contenido: `# Resúmenes de Fathom de ${con} llamadas\n\n${resumenes.join("\n")}` },
    { nombre: "todas-juntas.md", contenido: juntas.join("\n---\n\n") },
    ...llamadasMd,
  ];
  return paquete;
}

/** Qué decir cuando termina: cuántas bajaron y por qué faltan las otras. */
export function resumenDeDescarga(p: Pick<PaqueteDeTranscripciones, "conTranscripcion" | "noSeHicieron" | "sinLinkHechas" | "linkSinTranscripcion" | "total">): string {
  const lista = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const faltan = [
    p.noSeHicieron ? `${lista(p.noSeHicieron, "no se hizo", "no se hicieron")} (canceladas, no se presentaron o reprogramadas)` : "",
    p.sinLinkHechas ? `${lista(p.sinLinkHechas, "se hizo pero no tiene", "se hicieron pero no tienen")} link de Fathom` : "",
    p.linkSinTranscripcion ? `${lista(p.linkSinTranscripcion, "tiene el link pero está privada en Fathom", "tienen el link pero están privadas en Fathom")}` : "",
  ].filter(Boolean);
  return `Se bajaron ${lista(p.conTranscripcion, "transcripción", "transcripciones")} de ${lista(p.total, "llamada", "llamadas")}${faltan.length ? `; ${faltan.join(" · ")} (el motivo de cada una está en indice.csv)` : ""}.`;
}

/** El LEEME del zip: qué trae, cómo llevarlo a Claude (son millones de palabras: no entra en un chat) y un pedido para armar el reporte macro. */
export function leemeDeDescarga(p: Pick<PaqueteDeTranscripciones, "conTranscripcion" | "total" | "desde" | "hasta" | "compraron" | "noSeHicieron" | "sinLinkHechas" | "linkSinTranscripcion">): string {
  return `# Transcripciones de llamadas de Fathom

${p.conTranscripcion} transcripciones de ${p.total} llamadas${p.desde ? `, del ${p.desde} al ${p.hasta}` : ""}. ${p.compraron} terminaron en compra (campo «Resultado» de cada llamada).
${p.noSeHicieron + p.sinLinkHechas + p.linkSinTranscripcion > 0 ? `Las otras ${p.noSeHicieron + p.sinLinkHechas + p.linkSinTranscripcion}: ${p.noSeHicieron} no se hicieron (canceladas, no se presentaron o reprogramadas: no hay nada que grabar), ${p.sinLinkHechas} se hicieron pero el closer no pegó el link de Fathom y ${p.linkSinTranscripcion} tienen el link pero están privadas en Fathom (indice.csv dice el motivo de cada una).\n` : ""}
## Qué hay en cada archivo
- \`indice.csv\`: una fila por llamada, con closer, estado, resultado (compró o no) y si tiene transcripción.
- \`resumenes.md\`: sólo el resumen de Fathom de cada llamada (liviano: es lo primero para mirar el panorama).
- \`llamadas/\`: un archivo por llamada con la transcripción completa.
- \`todas-juntas.md\`: todo en un solo archivo (muy grande).

## Cómo llevarlo a Claude
Es demasiado texto para pegarlo en un chat. Lo que funciona:
1. **Claude Code o Cowork** apuntando a esta carpeta: puede leer \`llamadas/\` de a tandas y juntar el resultado. Es lo recomendado para el análisis completo.
2. **Un Proyecto de Claude** con \`resumenes.md\` y \`indice.csv\` para el panorama, y las transcripciones de las llamadas que quieras profundizar.

## Pedido sugerido (el análisis tipo «436 llamadas»)
> Leé las transcripciones de la carpeta \`llamadas/\` y armá un reporte macro. Usá \`indice.csv\` y el campo «Resultado» para separar a los que compraron de los que no. Procesá de a 25 llamadas, guardando notas intermedias en un archivo, y al final consolidá. Quiero: (1) las objeciones más frecuentes: cuántas llamadas la tienen, cuántas en cierres y cuántas sin cierre, variantes, frases textuales y cómo se superaron; (2) los motivos de compra; (3) los arquetipos de prospecto; (4) qué hacen distinto los closers en las llamadas que cierran. Contá cada cosa y citá frases reales con fecha y nombre del archivo.
`;
}
