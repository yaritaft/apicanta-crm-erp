/* ==================================================================
   YouTube, la parte que puede ver cualquiera.

   Lo usan la pantalla del webinar y la ruta /api/youtube: sacar el id de
   un link, armar el embebido y los tipos de lo que la ruta devuelve. La
   clave de la API NO pasa por acá: vive sólo en la ruta, del lado del
   servidor, y nunca llega al navegador.
   ================================================================== */

/* Un id de video de YouTube son 11 caracteres de este alfabeto. */
export const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtube-nocookie.com", "www.youtube-nocookie.com",
]);

/**
 * El id del video a partir de un link, en cualquiera de las formas en que
 * YouTube lo comparte: youtu.be/ID, watch?v=ID, /live/ID, /shorts/ID o
 * /embed/ID. Cualquier otra cosa es null: mejor no mostrar nada que
 * embeber lo que no es.
 */
export function idDeYoutube(enlace: string | null | undefined): string | null {
  const texto = (enlace ?? "").trim();
  if (!texto) return null;
  let u: URL;
  try {
    /* Pegado sin protocolo ("youtu.be/abc…") también vale. */
    u = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;

  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = u.pathname.split("/")[1] ?? null;
  } else if (HOSTS.has(host)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else id = /^\/(?:live|shorts|embed|v)\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
  }
  return id && ID_YOUTUBE.test(id) ? id : null;
}

/* youtube-nocookie: YouTube no deja cookies hasta que alguien le da play. */
export const embebidoDe = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;

export const videoDe = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/* La miniatura pública: no necesita la API ni la clave. */
export const miniaturaDe = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/* ---------- Lo que devuelve /api/youtube ---------- */

export interface CanalYoutube {
  id?: string;
  nombre: string;
  url?: string;
  avatar?: string;
  suscriptores?: number;
  /* El canal eligió ocultar cuántos suscriptores tiene: no es un cero. */
  suscriptoresOcultos?: boolean;
}

export interface VivoYoutube {
  estado: "en-vivo" | "programado" | "terminado";
  programado?: string;
  inicio?: string;
  fin?: string;
  /* Sólo mientras está en el aire. */
  espectadores?: number;
}

export interface DatosYoutube {
  id: string;
  /* false: vino de oEmbed, sin clave de la API. Hay título y canal, pero no
     vistas, comentarios ni suscriptores. */
  completo: boolean;
  titulo: string;
  descripcion?: string;
  publicado?: string;
  miniatura?: string;
  duracionSeg?: number;
  vistas?: number;
  /* undefined = el video los oculta (likes) o los tiene cerrados
     (comentarios). Un cero sería mentir. */
  likes?: number;
  comentarios?: number;
  vivo?: VivoYoutube;
  canal: CanalYoutube;
  /* Por qué faltan datos, dicho para mostrarlo tal cual. */
  aviso?: string;
}

/* Lo que devuelve /api/youtube/vivos: los vivos del canal (terminados,
   en el aire y programados), del más nuevo al más viejo. */
export interface VivoDelCanal {
  id: string;
  titulo: string;
  miniatura?: string;
  /* Cuándo empezó o está programado */
  cuando: string;
  estado: VivoYoutube["estado"];
}

export interface VivosDelCanal {
  canal: { id: string; nombre: string };
  vivos: VivoDelCanal[];
}

/* PT1H2M3S → 3723. Lo que no se entiende es 0. */
export function segundosDeDuracion(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

/* 3723 → "1:02:03"; 125 → "2:05". */
export function duracionLegible(seg: number): string {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.floor(seg % 60);
  const dos = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

/* ---------- Texto con links ----------

   La descripción de un video trae links sueltos. Se parte el texto en
   pedazos y sólo se vuelven link los que empiezan con http(s)://: nada de
   `javascript:` ni HTML crudo. React escapa todo lo demás. */

export type Pedazo = { texto: string; url?: undefined } | { texto: string; url: string };

const URL_EN_TEXTO = /https?:\/\/[^\s<>"'`]+/gi;

export function partirConLinks(texto: string): Pedazo[] {
  const out: Pedazo[] = [];
  let desde = 0;
  for (const m of texto.matchAll(URL_EN_TEXTO)) {
    let url = m[0];
    /* El punto o la coma del final son de la oración, no del link; el
       paréntesis de cierre también, salvo que el link haya abierto uno. */
    while (/[.,;:!?]$/.test(url) || (url.endsWith(")") && !url.includes("("))) url = url.slice(0, -1);
    const i = m.index ?? 0;
    if (i > desde) out.push({ texto: texto.slice(desde, i) });
    out.push({ texto: url, url });
    desde = i + url.length;
  }
  if (desde < texto.length) out.push({ texto: texto.slice(desde) });
  return out;
}
