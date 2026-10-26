"use client";

import { hayNube, nube } from "./supabase";

/* ==================================================================
   Las capturas de la pre-call de cada llamada (Santi, 26/10): el setter
   sube el chat con la persona (así se le asigna la comisión) y, cuando una
   llamada se cancela, queda la prueba de que el closer le escribió.

   La imagen va a un bucket PRIVADO de Supabase (`precall`, supabase/
   precall-capturas.sql) en la carpeta de su llamada, y en la tabla
   `precall_capturas` queda quién la subió y cuándo. Para verla, la app pide
   una URL firmada que vence a los 5 minutos. Quién puede ver, subir y borrar
   lo decide la base (precall_puede): acá sólo se muestran los errores.

   Sin nube (la app corriendo local) las imágenes quedan en este navegador,
   con un tope más bajo, para poder probar la pantalla.
   ================================================================== */

export const BUCKET_PRECALL = "precall";
export const ACEPTA_CAPTURA = "image/png,image/jpeg,image/webp,image/heic,image/heif";
const TIPOS = new Set(ACEPTA_CAPTURA.split(","));
export const TOPE_CAPTURA_NUBE = 8 * 1024 * 1024;
export const TOPE_CAPTURA_LOCAL = 1.5 * 1024 * 1024;
const CLAVE_LOCAL = "apicanta:precall:v1";

export interface CapturaPrecall {
  id: string;
  sesionId: string;
  /* En la nube, la ruta en el bucket; sin nube, la imagen misma como data URL. */
  ruta: string;
  nombre: string;
  tipo: string;
  tamanio: number;
  nota?: string | null;
  subidoPor?: string | null;
  subidoPorEmail?: string | null;
  subidoEn: string;
}

export function tamanioLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** El tipo de un archivo; un .heic que el navegador no informa se reconoce por la extensión. */
export const tipoDeCaptura = (a: Pick<File, "type" | "name">): string => a.type || (/\.hei[cf]$/i.test(a.name) ? "image/heic" : "");

/** Lo que está mal del archivo, en castellano, o null si se puede subir. */
export function problemaDeCaptura(a: Pick<File, "type" | "name" | "size">, tope = hayNube ? TOPE_CAPTURA_NUBE : TOPE_CAPTURA_LOCAL): string | null {
  if (!TIPOS.has(tipoDeCaptura(a))) return "Tiene que ser una imagen (captura en PNG, JPG, WEBP o HEIC).";
  if (a.size === 0) return "La imagen está vacía.";
  if (a.size > tope) return `Pesa ${tamanioLegible(a.size)}: el máximo es ${tamanioLegible(tope)}.`;
  return null;
}

/** Nombre seguro para la ruta: sin tildes, espacios ni barras. El original se guarda aparte, para mostrarlo. */
export function nombreSeguro(nombre: string): string {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  return (base || "captura").slice(-60);
}

/** Una captura pegada del portapapeles no trae nombre útil («image.png»): se le pone uno con el momento. */
export function nombreDePegada(a: Pick<File, "name" | "type">, ahora: Date): string {
  if (a.name && !/^image\.(png|jpe?g|webp)$/i.test(a.name)) return a.name;
  const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" } as Record<string, string>)[a.type] ?? "png";
  const p = (n: number) => String(n).padStart(2, "0");
  return `captura-${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}.${ext}`;
}

/** La ruta en el bucket: <id de la llamada>/<azar>-<nombre>. La carpeta es la que mira la política de la base. */
export const rutaDeCaptura = (sesionId: string, nombre: string, azar: string) => `${sesionId}/${azar}-${nombreSeguro(nombre)}`;

/* ---------- sin nube ---------- */

function leerLocal(): CapturaPrecall[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL) ?? "[]") as CapturaPrecall[]; } catch { return []; }
}
function guardarLocal(xs: CapturaPrecall[]) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(xs)); }
  catch { throw new Error("No hay lugar en este navegador para guardar otra imagen."); }
}
function comoDataUrl(a: File): Promise<string> {
  return new Promise((ok, mal) => {
    const l = new FileReader();
    l.onload = () => ok(String(l.result));
    l.onerror = () => mal(new Error("No se pudo leer la imagen."));
    l.readAsDataURL(a);
  });
}

/* ---------- leer, subir, ver, borrar ---------- */

export async function capturasDe(sesionId: string): Promise<CapturaPrecall[]> {
  if (!nube) return leerLocal().filter((c) => c.sesionId === sesionId).sort((a, b) => a.subidoEn.localeCompare(b.subidoEn));
  const r = await nube.from("precall_capturas").select("*").eq("sesionId", sesionId).order("subidoEn", { ascending: true });
  if (r.error) {
    if (/precall_capturas|PGRST205|42P01/.test(`${r.error.code} ${r.error.message}`)) return [];
    throw new Error(r.error.message);
  }
  return (r.data ?? []) as CapturaPrecall[];
}

export async function subirCaptura(sesionId: string, archivo: File, quien: { nombre?: string | null; email?: string | null }): Promise<CapturaPrecall> {
  const problema = problemaDeCaptura(archivo);
  if (problema) throw new Error(problema);
  const tipo = tipoDeCaptura(archivo);
  const nombre = nombreDePegada(archivo, new Date());
  const base = {
    id: `cap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, sesionId, nombre, tipo, tamanio: archivo.size,
    subidoPor: quien.nombre ?? null, subidoPorEmail: quien.email?.toLowerCase() ?? null, subidoEn: new Date().toISOString(),
  };
  if (!nube) {
    const c: CapturaPrecall = { ...base, ruta: await comoDataUrl(archivo) };
    guardarLocal([...leerLocal(), c]);
    return c;
  }
  const ruta = rutaDeCaptura(sesionId, nombre, crypto.randomUUID());
  const sube = await nube.storage.from(BUCKET_PRECALL).upload(ruta, archivo, { contentType: tipo, upsert: false, cacheControl: "3600" });
  if (sube.error) {
    if (/bucket not found/i.test(sube.error.message)) throw new Error("Falta crear el lugar donde se guardan las capturas (supabase/precall-capturas.sql).");
    if (/row-level security|not allowed|unauthorized|403/i.test(sube.error.message)) throw new Error("Tu cuenta no puede cargar capturas en esta llamada.");
    throw new Error(`No se pudo subir: ${sube.error.message}`);
  }
  const fila = { ...base, ruta };
  const guarda = await nube.from("precall_capturas").insert(fila);
  if (guarda.error) {
    /* Sin la fila el archivo queda huérfano: se saca. */
    void nube.storage.from(BUCKET_PRECALL).remove([ruta]);
    throw new Error(/row-level security/i.test(guarda.error.message) ? "Tu cuenta no puede cargar capturas en esta llamada." : `No se pudo guardar: ${guarda.error.message}`);
  }
  return fila;
}

/** Una dirección con la que se ve cada imagen: la firmada de la nube (vence a los 5 minutos) o la que quedó en este navegador. */
export async function urlsDeCapturas(cs: CapturaPrecall[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const nubes = cs.filter((c) => !c.ruta.startsWith("data:"));
  for (const c of cs) if (c.ruta.startsWith("data:")) m.set(c.id, c.ruta);
  if (nubes.length > 0 && nube) {
    const r = await nube.storage.from(BUCKET_PRECALL).createSignedUrls(nubes.map((c) => c.ruta), 300);
    if (r.error) throw new Error(r.error.message);
    for (const x of r.data ?? []) {
      const c = nubes.find((y) => y.ruta === x.path);
      if (c && x.signedUrl) m.set(c.id, x.signedUrl);
    }
  }
  return m;
}

export async function borrarCaptura(c: CapturaPrecall): Promise<void> {
  if (!nube) { guardarLocal(leerLocal().filter((x) => x.id !== c.id)); return; }
  const r = await nube.from("precall_capturas").delete().eq("id", c.id).select("id");
  if (r.error) throw new Error(r.error.message);
  if ((r.data ?? []).length === 0) throw new Error("Sólo la puede borrar quien la subió, un dueño o el director.");
  await nube.storage.from(BUCKET_PRECALL).remove([c.ruta]);
}
