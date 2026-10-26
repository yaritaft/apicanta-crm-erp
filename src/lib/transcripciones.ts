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
  /* El link de Fathom que pegó el closer, si lo hay. */
  link?: string | null;
}

export type GrabacionDeTranscripcion = Pick<Grabacion, "sesionId" | "titulo" | "shareUrl" | "grabadaDesde" | "grabadaHasta" | "grabadoPorNombre" | "resumen" | "transcripcion">;

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

const palabras = (frases: FraseGrabacion[]) => frases.reduce((n, f) => n + f.texto.split(/\s+/).filter(Boolean).length, 0);

/** La llamada como un documento (markdown): quién, cuándo, cómo terminó, el resumen de Fathom y la transcripción. */
export function documentoDeLlamada(l: LlamadaParaTranscribir, gs: GrabacionDeTranscripcion[]): string {
  const sal: string[] = [`# Llamada con ${l.nombre}`, ""];
  sal.push(`- Fecha: ${isoDia(l.inicia)} (${fechaHora(l.inicia).split(" · ")[1] ?? ""} hs)`);
  if (l.closer) sal.push(`- Closer: ${l.closer}`);
  if (l.estado) sal.push(`- Estado de la llamada: ${l.estado}`);
  const dura = gs.map((g) => duracion(g)).find(Boolean);
  if (dura) sal.push(`- Duración: ${dura}`);
  const link = gs.find((g) => g.shareUrl)?.shareUrl ?? l.link;
  if (link) sal.push(`- Grabación: ${link}`);
  for (const g of gs) {
    if (g.resumen) sal.push("", "## Resumen de Fathom", "", g.resumen.trim());
    if (g.transcripcion?.length) sal.push("", gs.length > 1 ? `## Transcripción (${g.titulo})` : "## Transcripción", "", textoDeTranscripcion(g.transcripcion));
  }
  return sal.join("\n") + "\n";
}

export interface PaqueteDeTranscripciones {
  archivos: ArchivoZip[];
  /* Cuántas llamadas tienen transcripción y de las otras, por qué no. */
  conTranscripcion: number;
  sinLink: number;
  linkSinTranscripcion: number;
  total: number;
}

/** Las llamadas con sus grabaciones, como los archivos del .zip. */
export function armarPaquete(llamadas: LlamadaParaTranscribir[], grabaciones: Map<string, GrabacionDeTranscripcion[]>): PaqueteDeTranscripciones {
  const ordenadas = [...llamadas].sort((a, b) => a.inicia.localeCompare(b.inicia));
  const usados = new Set<string>();
  const llamadasMd: ArchivoZip[] = [];
  const juntas: string[] = [];
  const indice: string[][] = [];
  let con = 0, sinLink = 0, sinTrans = 0;

  for (const l of ordenadas) {
    const gs = (grabaciones.get(l.sesionId) ?? []).filter((g) => (g.transcripcion?.length ?? 0) > 0);
    if (gs.length === 0) {
      const linkPegado = tieneLinkDeFathom(l.link);
      if (linkPegado) sinTrans++; else sinLink++;
      indice.push(["", l.nombre, isoDia(l.inicia), l.closer ?? "", l.estado ?? "", "No",
        linkPegado ? "Tiene el link de Fathom, pero la app todavía no pudo traer su transcripción (si pasó más de un día, la grabación no está compartida con el equipo en Fathom)" : "No tiene link de Fathom", "0"]);
      continue;
    }
    con++;
    let nombre = `llamadas/${isoDia(l.inicia)}_${nombreSeguro(l.nombre)}.md`;
    for (let i = 2; usados.has(nombre); i++) nombre = `llamadas/${isoDia(l.inicia)}_${nombreSeguro(l.nombre)}-${i}.md`;
    usados.add(nombre);
    const doc = documentoDeLlamada(l, gs);
    llamadasMd.push({ nombre, contenido: doc });
    juntas.push(doc);
    indice.push([nombre, l.nombre, isoDia(l.inicia), l.closer ?? "", l.estado ?? "", "Sí", "", String(gs.reduce((n, g) => n + palabras(g.transcripcion ?? []), 0))]);
  }

  const cabeza = ["Archivo", "Nombre", "Fecha", "Closer", "Estado de la llamada", "Transcripción", "Por qué no", "Palabras"];
  return {
    archivos: [
      { nombre: "indice.csv", contenido: `﻿${csvDe(cabeza, indice)}` },
      { nombre: "todas-juntas.md", contenido: juntas.join("\n---\n\n") },
      ...llamadasMd,
    ],
    conTranscripcion: con, sinLink, linkSinTranscripcion: sinTrans, total: ordenadas.length,
  };
}

/** Qué decir cuando termina: cuántas bajaron y por qué faltan las otras. */
export function resumenDeDescarga(p: Pick<PaqueteDeTranscripciones, "conTranscripcion" | "sinLink" | "linkSinTranscripcion" | "total">): string {
  const lista = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const faltan = [
    p.sinLink ? `${lista(p.sinLink, "no tiene", "no tienen")} link de Fathom` : "",
    p.linkSinTranscripcion ? `${lista(p.linkSinTranscripcion, "tiene el link pero su transcripción todavía no llegó", "tienen el link pero su transcripción todavía no llegó")}` : "",
  ].filter(Boolean);
  return `Se bajaron ${lista(p.conTranscripcion, "transcripción", "transcripciones")} de ${lista(p.total, "llamada", "llamadas")}${faltan.length ? `; ${faltan.join(" y ")} (están en indice.csv)` : ""}.`;
}
