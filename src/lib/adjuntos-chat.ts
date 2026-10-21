"use client";

import { nube } from "./supabase";
import { tamanioLegible } from "./comprobantes";
import type { Adjunto, ID } from "./types";

/* ==================================================================
   Los archivos del chat del equipo (la ficha de cada persona), como en
   Blue OS: fotos, videos, notas de voz y cualquier archivo.

   En la nube van a un bucket PRIVADO (`chat-equipo`, supabase/chat-adjuntos.sql)
   y en el mensaje queda sólo la ruta: para verlos se pide una URL firmada que
   vence en una hora. Sin nube (la app corriendo local) no hay dónde subirlos:
   el archivo queda en el navegador como data URL, con un tope más bajo para no
   llenar el almacenamiento local. La misma idea que los comprobantes de pago.
   ================================================================== */

export const BUCKET_CHAT = "chat-equipo";
const TOPE_NUBE = 50 * 1024 * 1024;
const TOPE_LOCAL = 3 * 1024 * 1024;
/** Cuántos archivos entran en un mensaje. */
export const ADJUNTOS_POR_MENSAJE = 10;
/** Cuántos valores de la onda se guardan de una nota de voz. */
export const PICOS = 40;

export function tipoDeArchivo(mime: string, nombre = ""): Adjunto["tipo"] {
  if (mime.startsWith("image/") || /\.(heic|heif)$/i.test(nombre)) return "imagen";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "archivo";
}

/** Lo que está mal del archivo, en castellano, o null si se puede mandar. */
export function problemaDeAdjunto(archivo: Pick<File, "size" | "name">, local = !nube): string | null {
  const tope = local ? TOPE_LOCAL : TOPE_NUBE;
  if (archivo.size === 0) return `«${archivo.name}» está vacío.`;
  if (archivo.size > tope) {
    return `«${archivo.name}» pesa ${tamanioLegible(archivo.size)}: el máximo es ${tamanioLegible(tope)}${local ? " en la app local" : ""}.`;
  }
  return null;
}

/* Nombre seguro para la ruta: sin acentos, espacios ni barras. El original se guarda aparte, tal cual. */
function nombreSeguro(nombre: string): string {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  return (base || "archivo").slice(-80);
}

function leerComoDataUrl(archivo: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result));
    lector.onerror = () => mal(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}

/* ---------- medidas (opcionales: si fallan, el archivo igual se manda) ---------- */

function medirImagen(url: string): Promise<{ ancho?: number; alto?: number }> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok({ ancho: img.naturalWidth, alto: img.naturalHeight });
    img.onerror = () => ok({});
    img.src = url;
  });
}

function medirVideo(url: string): Promise<{ ancho?: number; alto?: number; duracion?: number }> {
  return new Promise((ok) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => ok({ ancho: v.videoWidth || undefined, alto: v.videoHeight || undefined, duracion: Number.isFinite(v.duration) ? v.duration : undefined });
    v.onerror = () => ok({});
    v.src = url;
  });
}

/** La onda de un audio: `PICOS` promedios de 0 a 1. Un audio muy largo no se decodifica (colgaría la pestaña). */
async function medirAudio(archivo: Blob): Promise<{ duracion?: number; picos?: number[] }> {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC || archivo.size > 25 * 1024 * 1024) return {};
  const ctx = new AC();
  try {
    const audio = await ctx.decodeAudioData(await archivo.arrayBuffer());
    const canal = audio.getChannelData(0);
    const bloque = Math.max(1, Math.floor(canal.length / PICOS));
    const crudos: number[] = [];
    for (let i = 0; i < PICOS; i++) {
      let suma = 0;
      for (let j = 0; j < bloque; j++) suma += Math.abs(canal[i * bloque + j] ?? 0);
      crudos.push(suma / bloque);
    }
    return { duracion: audio.duration, picos: normalizarPicos(crudos) };
  } catch {
    return {};
  } finally {
    void ctx.close();
  }
}

/** Lleva una onda a 0–1 (el más alto en 1) y la deja en `PICOS` valores, para guardarla corta. */
export function normalizarPicos(crudos: number[]): number[] {
  if (crudos.length === 0) return [];
  const n = PICOS;
  const muestra = crudos.length === n ? crudos : Array.from({ length: n }, (_, i) => {
    const desde = Math.floor((i * crudos.length) / n), hasta = Math.max(desde + 1, Math.floor(((i + 1) * crudos.length) / n));
    const tramo = crudos.slice(desde, hasta);
    return tramo.reduce((a, b) => a + b, 0) / tramo.length;
  });
  const max = Math.max(...muestra, 1e-6);
  return muestra.map((x) => Math.round(Math.max(0.06, x / max) * 100) / 100);
}

/** Sube un archivo y devuelve cómo queda en el mensaje. `extra` trae lo que ya se sabe (una nota de voz: su duración y su onda). */
export async function subirAdjunto(archivo: File, contactoId: ID, extra: Partial<Adjunto> = {}): Promise<Adjunto> {
  const problema = problemaDeAdjunto(archivo);
  if (problema) throw new Error(problema);
  const mime = archivo.type || "application/octet-stream";
  const tipo = tipoDeArchivo(mime, archivo.name);
  const medidas: Partial<Adjunto> = {};
  const urlLocal = URL.createObjectURL(archivo);
  try {
    if (tipo === "imagen") Object.assign(medidas, await medirImagen(urlLocal));
    else if (tipo === "video") Object.assign(medidas, await medirVideo(urlLocal));
    else if (tipo === "audio" && !extra.picos) Object.assign(medidas, await medirAudio(archivo));
  } finally {
    URL.revokeObjectURL(urlLocal);
  }
  const base: Adjunto = { id: crypto.randomUUID(), tipo, nombre: archivo.name, mime, bytes: archivo.size, ruta: "", ...medidas, ...extra };

  if (!nube) return { ...base, ruta: await leerComoDataUrl(archivo) };

  const hoy = new Date();
  const ruta = `${contactoId}/${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}/${base.id}-${nombreSeguro(archivo.name)}`;
  const { error } = await nube.storage.from(BUCKET_CHAT).upload(ruta, archivo, { contentType: mime, upsert: false, cacheControl: "3600" });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error("Falta crear el lugar donde se guardan los archivos del chat (supabase/chat-adjuntos.sql).");
    throw new Error(`No se pudo subir «${archivo.name}»: ${error.message}`);
  }
  return { ...base, ruta };
}

/* Las URLs ya pedidas, para no pedir una firmada por cada vez que se dibuja el mensaje. Vencen antes que la firma. */
const cache = new Map<string, { url: string; vence: number }>();

/** Una dirección con la que se puede ver o escuchar el archivo: la firmada de la nube (una hora) o el archivo guardado en este navegador. */
export async function urlDeAdjunto(a: Adjunto): Promise<string> {
  const guardada = cache.get(a.ruta);
  if (guardada && guardada.vence > Date.now()) return guardada.url;
  let url: string;
  if (a.ruta.startsWith("data:")) {
    url = URL.createObjectURL(await (await fetch(a.ruta)).blob());
    cache.set(a.ruta, { url, vence: Number.POSITIVE_INFINITY });
    return url;
  }
  if (!nube) throw new Error("Sin conexión a la nube no se puede abrir.");
  const { data, error } = await nube.storage.from(BUCKET_CHAT).createSignedUrl(a.ruta, 3600);
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir el archivo.");
  url = data.signedUrl;
  cache.set(a.ruta, { url, vence: Date.now() + 50 * 60 * 1000 });
  return url;
}

/** Se borra el archivo si lo sacan ANTES de mandar el mensaje: si no, quedaría huérfano en el bucket. */
export async function descartarAdjunto(a: Adjunto): Promise<void> {
  if (!nube || a.ruta.startsWith("data:")) return;
  await nube.storage.from(BUCKET_CHAT).remove([a.ruta]).catch(() => undefined);
}

/** «0:07», «1:23». */
export function duracionLegible(seg: number | undefined): string {
  if (seg === undefined || !Number.isFinite(seg)) return "";
  const s = Math.max(0, Math.round(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export { tamanioLegible };
