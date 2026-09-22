"use client";

import { nube } from "./supabase";
import type { Comprobante } from "./types";

/* ==================================================================
   Comprobantes de pago.

   Un pago que no se concilió contra una pasarela necesita su prueba:
   la captura de la transferencia, el PDF del recibo. Se sube a un
   bucket PRIVADO de Supabase (`comprobantes`, ver supabase/comprobantes.sql)
   y en el pago queda sólo la ruta. Para verlo se pide una URL firmada
   que vence en minutos: nadie de afuera puede adivinarla.

   Sin nube (la app corriendo local) no hay dónde subirlo: el archivo
   queda en el navegador como data URL, con un tope más bajo para no
   llenar el almacenamiento local.
   ================================================================== */

export const BUCKET_COMPROBANTES = "comprobantes";

export const ACEPTA_COMPROBANTE = "image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf";
const TIPOS = new Set(ACEPTA_COMPROBANTE.split(","));
const TOPE_NUBE = 10 * 1024 * 1024;
const TOPE_LOCAL = 2 * 1024 * 1024;

export function tamanioLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/* Lo que está mal del archivo, en castellano, o null si se puede subir. */
export function problemaDeArchivo(archivo: File): string | null {
  /* Algunos navegadores no informan el tipo de un .heic: se mira la extensión. */
  const tipo = archivo.type || (/\.hei[cf]$/i.test(archivo.name) ? "image/heic" : "");
  if (!TIPOS.has(tipo)) return "Tiene que ser una imagen (JPG, PNG, WEBP, HEIC) o un PDF.";
  const tope = nube ? TOPE_NUBE : TOPE_LOCAL;
  if (archivo.size > tope) return `Pesa ${tamanioLegible(archivo.size)}: el máximo es ${tamanioLegible(tope)}.`;
  if (archivo.size === 0) return "El archivo está vacío.";
  return null;
}

/* Nombre seguro para la ruta: sin acentos, espacios ni barras. El nombre
   original se guarda aparte, tal cual, para mostrarlo. */
function nombreSeguro(nombre: string): string {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  return (base || "comprobante").slice(-80);
}

function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result));
    lector.onerror = () => mal(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}

export async function subirComprobante(archivo: File): Promise<Comprobante> {
  const problema = problemaDeArchivo(archivo);
  if (problema) throw new Error(problema);
  const tipo = archivo.type || "image/heic";
  const base = { nombre: archivo.name, tipo, tamanio: archivo.size, subidoEn: new Date().toISOString() };

  if (!nube) return { ...base, ruta: await leerComoDataUrl(archivo) };

  const ahora = new Date();
  const carpeta = `pagos/${ahora.getFullYear()}/${String(ahora.getMonth() + 1).padStart(2, "0")}`;
  const azar = crypto.randomUUID();
  const ruta = `${carpeta}/${azar}-${nombreSeguro(archivo.name)}`;
  const { error } = await nube.storage.from(BUCKET_COMPROBANTES).upload(ruta, archivo, {
    contentType: tipo, upsert: false, cacheControl: "3600",
  });
  if (error) {
    if (/bucket not found/i.test(error.message)) {
      throw new Error("Falta crear el lugar donde se guardan los comprobantes (supabase/comprobantes.sql).");
    }
    throw new Error(`No se pudo subir: ${error.message}`);
  }
  return { ...base, ruta };
}

/* Abre el comprobante en otra pestaña. La pestaña se abre en el mismo
   click (si se abre después de esperar la URL firmada, el navegador la
   bloquea como ventana emergente) y después se la manda al archivo. */
export async function verComprobante(c: Comprobante): Promise<void> {
  const ventana = window.open("about:blank", "_blank");
  try {
    let url: string;
    if (c.ruta.startsWith("data:")) {
      const blob = await (await fetch(c.ruta)).blob();
      url = URL.createObjectURL(blob);
    } else {
      if (!nube) throw new Error("Sin conexión a la nube no se puede abrir.");
      const { data, error } = await nube.storage.from(BUCKET_COMPROBANTES).createSignedUrl(c.ruta, 300);
      if (error || !data) throw new Error(error?.message ?? "No se pudo abrir el comprobante.");
      url = data.signedUrl;
    }
    if (ventana) {
      ventana.opener = null;
      ventana.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (err) {
    ventana?.close();
    throw err;
  }
}

/* Se borra el archivo cuando alguien lo saca ANTES de guardar el pago:
   si no, quedaría huérfano en el bucket. Un pago ya guardado no se toca
   desde acá. Si falla, no importa: es un archivo privado sin dueño. */
export async function descartarComprobante(c: Comprobante): Promise<void> {
  if (!nube || c.ruta.startsWith("data:")) return;
  await nube.storage.from(BUCKET_COMPROBANTES).remove([c.ruta]).catch(() => undefined);
}
