import { GRAPH, metaConfigurado, tokenDeLaPeticion } from "./meta";
import { ErrorDeMeta, esDeMeta, traerMaterialDelAnuncio, type DiagnosticoMaterial, type MedioAnuncio } from "./meta-creativo";

/* ==================================================================
   Descargar el anuncio (reunión del 02/10: «podés descargar también el
   anuncio, si querés»).

   El video o la imagen de un anuncio son links de Meta: de otro origen
   (el navegador no los baja con un clic) y vencen. Así que la descarga
   pasa por el servidor, que le pide a Meta el anuncio de nuevo (el link
   fresco, y siempre de sus propios servidores), baja el archivo y se lo
   pasa al navegador como una descarga. El token de Meta no sale del
   servidor, y cada medio se pide por su lugar en el anuncio, nunca por un
   link que mande el navegador.

   Sin un anuncio real no se puede confirmar con Meta que entregue el
   archivo: cada paso que puede fallar dice qué pasó y qué hacer.

   Sin React ni Next; las consultas reciben `fetch` para poder probarlas.
   ================================================================== */

/* Un archivo más grande que esto no se baja por acá. */
export const TOPE_DE_DESCARGA = 400 * 1024 * 1024;

export type Preparada =
  | { ok: true; medio: MedioAnuncio }
  | { ok: false; status: number; error: string };

const falla = (status: number, error: string): Preparada => ({ ok: false, status, error });

/* Un token vencido o sin permiso no va a andar con otro intento. */
const sinAcceso = (status?: number, codigo?: number) => status === 401 || codigo === 190 || codigo === 200 || codigo === 10;

/** Los datos del medio pedido (el N-ésimo del anuncio, como lo muestra el
 *  detalle), con su link recién pedido a Meta. `tipo` y `portada` vienen de
 *  lo que el navegador ve: si el anuncio cambió y no coincide, se avisa. */
export async function medioParaDescargar(
  graph: string, token: string, adId: string, pedido: { indice: number; tipo?: string; portada?: boolean },
  fetchFn: typeof fetch = fetch, diagnostico?: DiagnosticoMaterial,
): Promise<Preparada> {
  let medios: MedioAnuncio[];
  try {
    medios = (await traerMaterialDelAnuncio(graph, token, adId, fetchFn, diagnostico)).medios;
  } catch (e) {
    if (e instanceof ErrorDeMeta && sinAcceso(e.status, e.codigo)) {
      return falla(502, `Meta no dejó leer este anuncio (${e.message.replace(/^Meta:\s*/, "")}). Revisá la conexión con Meta en Marketing.`);
    }
    return falla(502, "No se pudo leer el anuncio en Meta. Probá de nuevo en un rato.");
  }
  const medio = medios[pedido.indice];
  if (!medio || (pedido.tipo && medio.tipo !== pedido.tipo)) {
    return falla(404, "Ese archivo ya no está en el anuncio (puede haber cambiado en Meta). Abrí el detalle de nuevo.");
  }
  /* De un video del que Meta sólo dio la portada, se baja la portada y se dice. */
  if (medio.sinArchivo && !pedido.portada) {
    return falla(422, "Meta no entregó el archivo del video de este anuncio: sólo se puede bajar su portada. Para el video, bajalo desde el Administrador de anuncios de Meta.");
  }
  return { ok: true, medio };
}

/* ---------- Pedir el archivo ---------- */

export type Archivo =
  | { ok: true; respuesta: Response }
  | { ok: false; status: number; error: string };

const MAX_SALTOS = 3;

/** Baja el archivo de Meta. Sigue las redirecciones a mano, y sólo a otro
 *  servidor de Meta: lo que llegue a otro lado no se pide. */
export async function traerArchivo(src: string, fetchFn: typeof fetch = fetch): Promise<Archivo> {
  let url = src;
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    if (!esDeMeta(url)) return { ok: false, status: 502, error: "Meta mandó el archivo desde un lugar que no es suyo: no se baja." };
    let r: Response;
    try {
      r = await fetchFn(url, { cache: "no-store", redirect: "manual" });
    } catch {
      return { ok: false, status: 502, error: "No se pudo hablar con Meta para bajar el archivo. Probá de nuevo en un rato." };
    }
    if (r.status >= 300 && r.status < 400) {
      const siguiente = r.headers.get("location");
      if (!siguiente) break;
      url = new URL(siguiente, url).toString();
      continue;
    }
    if (!r.ok || !r.body) {
      return {
        ok: false, status: 502,
        error: `Meta no entregó el archivo (contestó ${r.status}). Probá de nuevo en un rato; si sigue igual, bajalo desde el Administrador de anuncios de Meta.`,
      };
    }
    const largo = Number(r.headers.get("content-length"));
    if (Number.isFinite(largo) && largo > TOPE_DE_DESCARGA) {
      return { ok: false, status: 413, error: "El archivo es demasiado grande para bajarlo desde acá. Bajalo desde el Administrador de anuncios de Meta." };
    }
    return { ok: true, respuesta: r };
  }
  return { ok: false, status: 502, error: "Meta mandó el archivo por un camino que no se pudo seguir. Probá de nuevo en un rato." };
}

/* ---------- Cómo se llama el archivo ---------- */

const POR_TIPO: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v",
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

/** La extensión por lo que dice el servidor del archivo; si no dice, la del tipo de medio. */
export function extensionDe(contentType: string | null | undefined, tipo: "video" | "imagen"): string {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return POR_TIPO[t] ?? (tipo === "video" ? "mp4" : "jpg");
}

/** El nombre del anuncio, listo para ser el de un archivo: sin las
 *  extensiones que Meta deja en el nombre («MERCADO SATURADO.mp4 - Copia 2»)
 *  ni lo que un sistema de archivos no acepta, y no tan largo. */
export function nombreSeguro(nombre: string | null | undefined): string {
  const limpio = (nombre ?? "")
    .replace(/\.(mp4|mov|m4v|webm|jpe?g|png|gif|webp)\b/gi, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 80)
    .trim();
  return limpio || "anuncio";
}

/** «MERCADO SATURADO - Copia 2.mp4»; con varios medios, «… (2 de 3).mp4» o
 *  el lugar donde corre («… · Historias y Reels.mp4»). */
export function nombreDeArchivo(
  anuncio: string | null | undefined, m: { extension: string; indice: number; total: number; etiqueta?: string; portada?: boolean },
): string {
  const base = nombreSeguro(anuncio);
  const lugar = m.etiqueta ? ` · ${nombreSeguro(m.etiqueta)}` : m.total > 1 ? ` (${m.indice + 1} de ${m.total})` : "";
  return `${base}${lugar}${m.portada ? " · portada" : ""}.${m.extension}`;
}

/** Las cabeceras de la descarga: el archivo con su nombre (con y sin tildes,
 *  para cualquier navegador). */
export function cabecerasDeDescarga(nombre: string, contentType: string | null | undefined, largo?: string | null): Record<string, string> {
  const ascii = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
    "Cache-Control": "no-store",
    ...(largo ? { "Content-Length": largo } : {}),
  };
}

/* ---------- La respuesta de la ruta ---------- */

const errorJson = (status: number, mensaje: string) =>
  new Response(JSON.stringify({ error: mensaje }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** Lo que contesta GET /api/meta/descargar (la ruta sólo agrega quién puede
 *  pedirlo): el archivo como una descarga o, si algo falla, un JSON
 *  {error} con un mensaje que dice qué pasó. */
export async function responderDescarga(req: Request, fetchFn: typeof fetch = fetch): Promise<Response> {
  if (!metaConfigurado()) return errorJson(503, "Meta no está configurado.");
  const token = tokenDeLaPeticion(req);
  if (!token) return errorJson(401, "No hay conexión con Meta.");

  const q = new URL(req.url).searchParams;
  const ad = q.get("ad") ?? "";
  if (!/^\d{5,30}$/.test(ad)) return errorJson(400, "Falta el anuncio.");
  const indice = Number(q.get("medio"));
  if (!Number.isInteger(indice) || indice < 0 || indice > 30) return errorJson(400, "Falta saber qué archivo bajar.");
  const tipo = q.get("tipo") ?? undefined;
  const portada = q.get("portada") === "1";

  /* Lo que no se pudo leer queda en los registros del servidor, sin links ni claves. */
  const diagnostico: DiagnosticoMaterial = { forma: "", refs: 0, fallas: [] };
  const lista = await medioParaDescargar(GRAPH, token, ad, { indice, tipo, portada }, fetchFn, diagnostico);
  if (!lista.ok) {
    console.warn("[meta/descargar]", JSON.stringify({ ad, indice, status: lista.status, ...diagnostico }));
    return errorJson(lista.status, lista.error);
  }

  const archivo = await traerArchivo(lista.medio.src, fetchFn);
  if (!archivo.ok) {
    console.warn("[meta/descargar]", JSON.stringify({ ad, indice, status: archivo.status, error: archivo.error }));
    return errorJson(archivo.status, archivo.error);
  }

  const r = archivo.respuesta;
  const contentType = r.headers.get("content-type");
  const nombre = nombreDeArchivo(q.get("nombre"), {
    extension: extensionDe(contentType, lista.medio.tipo), indice,
    total: Number(q.get("de")) || 1, etiqueta: lista.medio.etiqueta, portada: lista.medio.sinArchivo,
  });
  /* Con el archivo comprimido, el largo de Meta no es el de lo que se manda. */
  const largo = r.headers.get("content-encoding") ? null : r.headers.get("content-length");
  /* El cuerpo pasa tal cual, sin cargarlo entero en memoria. */
  return new Response(r.body, { headers: cabecerasDeDescarga(nombre, contentType, largo) });
}
