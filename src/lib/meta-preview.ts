/* ==================================================================
   La vista previa de un anuncio que devuelve Meta (/{ad}/previews): un
   <iframe> listo para pegar. De ahí se saca sólo el link y el tamaño, y
   el marco lo arma la app: nada de HTML ajeno adentro de la página.
   ================================================================== */

export interface VistaPrevia { src: string; ancho: number; alto: number }

const DE_META = /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|fb\.com|instagram\.com)\//i;

/** El link y el tamaño del <iframe> de Meta; null si no es uno de Meta. */
export function leerVistaPrevia(html: string | undefined | null): VistaPrevia | null {
  if (!html) return null;
  const src = /<iframe[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1]?.replace(/&amp;/g, "&");
  if (!src || !DE_META.test(src)) return null;
  const numero = (atributo: string, defecto: number) => {
    const n = Number(new RegExp(`\\s${atributo}="(\\d+)"`, "i").exec(html)?.[1]);
    return Number.isFinite(n) && n >= 100 && n <= 2000 ? n : defecto;
  };
  return { src, ancho: numero("width", 320), alto: numero("height", 620) };
}
