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

/* El video de un webinar: su link propio; si nunca se cargó, el del replay
   (muchos webinars viejos lo tienen ahí). Un "" guardado es "sin video" a
   propósito. El cron usa el mismo criterio. */
export function videoDelWebinar(w: { youtubeUrl?: string | null; enlaceReplay?: string | null }): string | null {
  return idDeYoutube(w.youtubeUrl) ?? (w.youtubeUrl == null ? idDeYoutube(w.enlaceReplay) : null);
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

/* ---------- Lo que devuelve /api/youtube/vivo ----------

   El vivo minuto a minuto. Lo junta /api/cron/youtube mientras el webinar
   está en el aire: YouTube sólo dice cuántos miran EN ESE MOMENTO, así que
   lo que no se guardó en el minuto no se puede pedir después. */

export interface MuestraVivo {
  /* El minuto, en ISO */
  t: string;
  enVivo: boolean;
  espectadores?: number;
  vistas?: number;
  likes?: number;
  comentarios?: number;
}

export interface MensajeChat {
  id: string;
  t: string;
  autor: string;
  autorCanalId?: string;
  foto?: string;
  esDueno?: boolean;
  esModerador?: boolean;
  tipo?: string;
  texto: string;
  monto?: string;
}

export interface EstadoVivoGuardado {
  estado?: "programado" | "en-vivo" | "terminado" | "video";
  programado?: string;
  inicio?: string;
  fin?: string;
  /* Por qué no se pudo leer el chat, dicho para mostrarlo tal cual. */
  errorChat?: string;
  ultimaMuestra?: string;
}

export interface DatosVivo {
  /* false: no hay base (la app corre local) y no hay nada guardado. */
  hayBase: boolean;
  estado: EstadoVivoGuardado;
  /* Durante el vivo, una por minuto. */
  minutos: MuestraVivo[];
  /* Después del vivo, una por hora y después una por día. */
  despues: MuestraVivo[];
  chat: MensajeChat[];
  /* El chat puede ser enorme: si se cortó, cuántos había en total. */
  chatTotal: number;
}

/* ---------- Lo que devuelve /api/youtube/comentarios ---------- */

export interface ComentarioYoutube {
  id: string;
  autor: string;
  autorCanalId?: string;
  foto?: string;
  texto: string;
  likes: number;
  t: string;
  editado?: boolean;
  respuestas: ComentarioYoutube[];
  /* Cuántas respuestas tiene en YouTube (pueden venir menos). */
  totalRespuestas?: number;
}

export interface ComentariosYoutube {
  comentarios: ComentarioYoutube[];
  /* true: había más de los que se trajeron. */
  cortado: boolean;
  /* Los comentarios están cerrados en el video. */
  cerrados?: boolean;
}

/* ---------- Lo que devuelve /api/youtube/analytics ----------

   YouTube Analytics necesita que el dueño del canal le dé permiso a la app
   (OAuth). Trae lo que la clave sola no puede: la retención de la
   grabación, el tiempo de reproducción, de dónde llegó la gente, países,
   edades y dispositivos. */

export interface FilaReparto { clave: string; valor: number; valor2?: number }

export interface AnalyticsVideo {
  traidoEn: string;
  /* Desde qué día cuenta YouTube (Analytics tarda dos o tres días). */
  desde: string;
  hasta: string;
  resumen: {
    vistas?: number;
    minutosVistos?: number;
    duracionMediaSeg?: number;
    porcentajeMedio?: number;
    suscriptoresGanados?: number;
    suscriptoresPerdidos?: number;
    compartidos?: number;
    picoConcurrentes?: number;
    promedioConcurrentes?: number;
  };
  /* elapsedVideoTimeRatio (0,01…1) → qué parte de la gente sigue mirando
     (audienceWatchRatio, puede pasar de 1 si vuelven a ver). */
  retencion: { ratio: number; mirando: number; relativa?: number }[];
  /* Los espectadores a la vez en cada minuto del vivo (livestreamPosition):
     lo mismo que guarda el cron, pero también para los vivos pasados. */
  porMinuto?: { min: number; promedio?: number; pico?: number }[];
  vivoVsGrabacion: FilaReparto[];
  fuentes: FilaReparto[];
  paises: FilaReparto[];
  edades: FilaReparto[];
  generos: FilaReparto[];
  dispositivos: FilaReparto[];
  /* Los reportes que YouTube no quiso dar, para decirlo sin romper el resto. */
  faltan: string[];
}

export type EstadoAnalytics =
  | { conectado: false; configurado: boolean; motivo?: string }
  | { conectado: true; canal?: string; datos?: AnalyticsVideo; error?: string };
