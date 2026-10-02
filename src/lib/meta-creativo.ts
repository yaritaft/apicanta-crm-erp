/* ==================================================================
   El material de un anuncio de Meta: el video o la imagen mismos, no la
   página que Meta arma alrededor.

   "Acá tiene que aparecer directo la multimedia, no la página web, y
   adaptado a cada formato" (Juan Cruz, 02/10). La vista previa de Meta
   (/{ad}/previews) es un marco con una página adentro. Acá se lee el
   creativo del anuncio y se le pide a Meta el archivo de cada medio:

   - un video o una imagen (lo más común);
   - varias tarjetas, si es un carrusel;
   - uno por lugar, si el anuncio tiene distinto material para el Feed y
     para Historias y Reels (asset_feed_spec + asset_customization_rules).

   Cada medio va con su tamaño, para mostrarlo con su forma: vertical,
   cuadrado u horizontal. Los links de Meta vencen: se piden cada vez que
   se abre el anuncio y no se guardan.

   Sin React; las consultas reciben `fetch` para poder probarlas.
   ================================================================== */

export interface MedioAnuncio {
  tipo: "video" | "imagen";
  src: string;
  /* Lo que se ve antes de darle play. */
  poster?: string;
  ancho?: number;
  alto?: number;
  /* Dónde corre este medio, si el anuncio tiene uno por lugar: «Historias y Reels». */
  etiqueta?: string;
  /* Un video del que Meta no entregó el archivo: se muestra su portada. */
  sinArchivo?: boolean;
}

export interface CreativoVisto {
  medios: MedioAnuncio[];
  texto?: string;
  titulo?: string;
  boton?: string;
}

/** Si hay algo para mostrar directo: un archivo de verdad, no sólo la
 *  portada de un video que Meta no entregó. Sin eso, conviene la vista
 *  previa que arma Meta, que por lo menos reproduce el video. */
export const tieneArchivo = (c: Pick<CreativoVisto, "medios">): boolean => c.medios.some((m) => !m.sinArchivo);

/* Lo que el creativo dice que usa, antes de pedir los archivos. */
export interface RefMedio {
  tipo: "video" | "imagen";
  videoId?: string;
  hash?: string;
  url?: string;
  poster?: string;
  etiqueta?: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => Boolean(obj(x))) : []);
const txt = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const id = (v: unknown): string | undefined => (typeof v === "number" ? String(v) : txt(v));

/* Sólo links de Meta: lo que llega de la API va a parar a un <video> o un
   <img> de la página, y ahí no entra cualquier dirección. */
const DE_META = /^https:\/\/([a-z0-9-]+\.)*(fbcdn\.net|facebook\.com|fb\.com|fbsbx\.com|cdninstagram\.com|instagram\.com)\//i;
export const esDeMeta = (url: unknown): url is string => typeof url === "string" && DE_META.test(url);

/* ---------- Dónde corre cada medio ---------- */

const VERTICALES = new Set(["story", "reels", "facebook_reels", "instagram_reels", "instagram_stories", "facebook_stories", "profile_reels", "ig_search"]);

/** El lugar de una regla de personalización, dicho corto. */
export function etiquetaDeLugares(regla: unknown): string | undefined {
  const spec = obj(obj(regla)?.customization_spec);
  if (!spec) return undefined;
  const posiciones = ["facebook_positions", "instagram_positions", "messenger_positions", "audience_network_positions"]
    .flatMap((k) => (Array.isArray(spec[k]) ? (spec[k] as unknown[]).map(String) : []));
  if (posiciones.length === 0) return undefined;
  const verticales = posiciones.filter((p) => VERTICALES.has(p)).length;
  if (verticales === posiciones.length) {
    const hayReels = posiciones.some((p) => p.includes("reels"));
    const hayHistorias = posiciones.some((p) => p.includes("stor"));
    return hayReels && hayHistorias ? "Historias y Reels" : hayReels ? "Reels" : "Historias";
  }
  return verticales === 0 ? "Feed" : "Feed e Historias";
}

/* ---------- Leer el creativo ---------- */

/** Los medios que usa un creativo, en el orden en que se muestran y sin
 *  repetir. Sirve para un video o una imagen sueltos, un carrusel, y los
 *  anuncios con distinto material por lugar. */
export function refsDelCreativo(creativo: unknown): RefMedio[] {
  const c = obj(creativo);
  if (!c) return [];
  const out: RefMedio[] = [];
  const vistos = new Set<string>();
  const sumar = (r: RefMedio) => {
    const clave = r.videoId ? `v:${r.videoId}` : r.hash ? `h:${r.hash}` : r.url ? `u:${r.url.split("?")[0]}` : "";
    if (!clave || vistos.has(clave)) return;
    vistos.add(clave);
    out.push(r);
  };
  const video = (videoId: unknown, poster?: unknown, etiqueta?: string) => {
    const v = id(videoId);
    if (v) sumar({ tipo: "video", videoId: v, ...(esDeMeta(poster) ? { poster } : {}), ...(etiqueta ? { etiqueta } : {}) });
  };
  const imagen = (hash: unknown, url?: unknown, etiqueta?: string) => {
    const h = txt(hash);
    const u = esDeMeta(url) ? url : undefined;
    if (h || u) sumar({ tipo: "imagen", ...(h ? { hash: h } : {}), ...(u ? { url: u } : {}), ...(etiqueta ? { etiqueta } : {}) });
  };

  /* 1 · Distinto material por lugar (o varias variantes): asset_feed_spec. */
  const feed = obj(c.asset_feed_spec);
  if (feed) {
    const lugarDe = new Map<string, string>();
    for (const regla of lista(feed.asset_customization_rules)) {
      const lugar = etiquetaDeLugares(regla);
      if (!lugar) continue;
      for (const k of ["video_label", "image_label"]) {
        const nombre = txt(obj(regla[k])?.name);
        if (nombre && !lugarDe.has(nombre)) lugarDe.set(nombre, lugar);
      }
    }
    const lugar = (medio: Obj) => lista(medio.adlabels).map((l) => lugarDe.get(txt(l.name) ?? "")).find(Boolean);
    for (const v of lista(feed.videos)) video(v.video_id, v.thumbnail_url, lugar(v));
    for (const i of lista(feed.images)) imagen(i.hash, i.url, lugar(i));
  }

  /* 2 · Lo que dice la publicación del anuncio. */
  const historia = obj(c.object_story_spec);
  const vd = obj(historia?.video_data);
  if (vd) video(vd.video_id, vd.image_url);
  const ld = obj(historia?.link_data);
  if (ld) {
    const tarjetas = lista(ld.child_attachments);
    for (const t of tarjetas) {
      if (id(t.video_id)) video(t.video_id, t.picture); else imagen(t.image_hash, t.picture);
    }
    if (tarjetas.length === 0) imagen(ld.image_hash, ld.picture);
  }
  const pd = obj(historia?.photo_data);
  if (pd) imagen(pd.image_hash, pd.url);

  /* 3 · Lo que el creativo tiene suelto (los anuncios de una publicación que ya existía). */
  video(c.video_id, c.image_url);
  if (out.length === 0) imagen(c.image_hash, c.image_url);
  return out.slice(0, 12);
}

const BOTONES: Record<string, string> = {
  LEARN_MORE: "Más información", SIGN_UP: "Registrarte", APPLY_NOW: "Solicitar ahora", BOOK_NOW: "Reservar", BOOK_TRAVEL: "Reservar",
  CONTACT_US: "Contactarnos", DOWNLOAD: "Descargar", GET_OFFER: "Obtener oferta", GET_QUOTE: "Pedir presupuesto", SUBSCRIBE: "Suscribirte",
  SHOP_NOW: "Comprar", ORDER_NOW: "Pedir ahora", WATCH_MORE: "Ver más", SEE_MORE: "Ver más", MESSAGE_PAGE: "Enviar mensaje",
  SEND_MESSAGE: "Enviar mensaje", WHATSAPP_MESSAGE: "Enviar mensaje por WhatsApp", INSTAGRAM_MESSAGE: "Enviar mensaje por Instagram",
  GET_STARTED: "Empezar", JOIN_GROUP: "Unirte", LISTEN_NOW: "Escuchar", CALL_NOW: "Llamar", REGISTER_NOW: "Registrarte",
};

/** El texto, el título y el botón del anuncio. */
export function textoDelCreativo(creativo: unknown): Pick<CreativoVisto, "texto" | "titulo" | "boton"> {
  const c = obj(creativo) ?? {};
  const historia = obj(c.object_story_spec);
  const vd = obj(historia?.video_data), ld = obj(historia?.link_data), pd = obj(historia?.photo_data);
  const feed = obj(c.asset_feed_spec);
  const primero = (xs: unknown) => txt(lista(xs)[0]?.text);
  const texto = txt(c.body) ?? txt(vd?.message) ?? txt(ld?.message) ?? txt(pd?.caption) ?? primero(feed?.bodies);
  const titulo = txt(c.title) ?? txt(vd?.title) ?? txt(ld?.name) ?? primero(feed?.titles);
  const tipo = txt(c.call_to_action_type) ?? txt(obj(vd?.call_to_action)?.type) ?? txt(obj(ld?.call_to_action)?.type)
    ?? (Array.isArray(feed?.call_to_action_types) ? txt((feed?.call_to_action_types as unknown[])[0]) : undefined);
  const boton = tipo ? BOTONES[tipo] : undefined;
  return { ...(texto ? { texto } : {}), ...(titulo ? { titulo } : {}), ...(boton ? { boton } : {}) };
}

/* ---------- Armar los medios con lo que contestó Meta ---------- */

/* Un video como lo devuelve /{video}?fields=source,picture,format. */
export interface VideoMeta { source?: string; picture?: string; format?: { width?: number; height?: number; picture?: string }[] }
/* Una imagen de /act_x/adimages. */
export interface ImagenMeta { url?: string; width?: number; height?: number }

const medida = (n: unknown) => (typeof n === "number" && n > 0 && n < 20000 ? Math.round(n) : undefined);

/* El formato más grande es el del video como se subió: de ahí salen su
   forma y la mejor portada. */
function mayorFormato(v: VideoMeta | undefined) {
  let mejor: { width?: number; height?: number; picture?: string } | undefined;
  for (const f of Array.isArray(v?.format) ? v.format : []) {
    if (!medida(f?.width) || !medida(f?.height)) continue;
    if (!mejor || (f.width ?? 0) * (f.height ?? 0) > (mejor.width ?? 0) * (mejor.height ?? 0)) mejor = f;
  }
  return mejor;
}

/** Los medios listos para mostrar. Un video sin archivo (Meta no lo dio)
 *  queda como su portada; lo que no tiene nada que mostrar, afuera. */
export function armarMedios(refs: RefMedio[], videos: Map<string, VideoMeta>, imagenes: Map<string, ImagenMeta>): MedioAnuncio[] {
  const out: MedioAnuncio[] = [];
  for (const r of refs) {
    const etiqueta = r.etiqueta ? { etiqueta: r.etiqueta } : {};
    if (r.tipo === "video") {
      const v = r.videoId ? videos.get(r.videoId) : undefined;
      const f = mayorFormato(v);
      const tamano = f ? { ancho: medida(f.width), alto: medida(f.height) } : {};
      const poster = [f?.picture, r.poster, v?.picture].find(esDeMeta);
      if (esDeMeta(v?.source)) out.push({ tipo: "video", src: v.source, ...(poster ? { poster } : {}), ...tamano, ...etiqueta });
      else if (poster) out.push({ tipo: "imagen", src: poster, ...tamano, ...etiqueta, sinArchivo: true });
      continue;
    }
    const i = r.hash ? imagenes.get(r.hash) : undefined;
    const src = [i?.url, r.url].find(esDeMeta);
    if (src) out.push({ tipo: "imagen", src, ...(i ? { ancho: medida(i.width), alto: medida(i.height) } : {}), ...etiqueta });
  }
  return out;
}

/* ---------- Pedirle a Meta ---------- */

const CAMPOS_CREATIVO = [
  "id", "object_type", "video_id", "image_url", "image_hash", "thumbnail_url", "body", "title", "call_to_action_type",
  "object_story_spec", "asset_feed_spec",
].join(",");

export class ErrorDeMeta extends Error {
  constructor(mensaje: string, public codigo?: number, public status?: number) { super(mensaje); }
}

async function pedir(fetchFn: typeof fetch, url: URL): Promise<Obj> {
  const r = await fetchFn(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as Obj;
  if (!r.ok) {
    const e = obj(j.error);
    throw new ErrorDeMeta(txt(e?.message) ? `Meta: ${txt(e?.message)}` : `Meta contestó ${r.status}.`, typeof e?.code === "number" ? e.code : undefined, r.status);
  }
  return j;
}

/** El material del anuncio: su creativo, y de ahí cada video e imagen.
 *  Si un video o una imagen no se puede leer (permisos), el resto sigue. */
export async function traerMaterialDelAnuncio(graph: string, token: string, adId: string, fetchFn: typeof fetch = fetch): Promise<CreativoVisto> {
  const u = new URL(`${graph}/${adId}`);
  u.searchParams.set("fields", `account_id,creative{${CAMPOS_CREATIVO}}`);
  u.searchParams.set("access_token", token);
  const ad = await pedir(fetchFn, u);
  const creativo = obj(ad.creative);
  const refs = refsDelCreativo(creativo);

  const videos = new Map<string, VideoMeta>();
  const imagenes = new Map<string, ImagenMeta>();
  const idsDeVideo = [...new Set(refs.flatMap((r) => (r.videoId ? [r.videoId] : [])))];
  const hashes = [...new Set(refs.flatMap((r) => (r.hash ? [r.hash] : [])))];

  await Promise.all([
    ...idsDeVideo.map(async (videoId) => {
      const v = new URL(`${graph}/${videoId}`);
      v.searchParams.set("fields", "source,picture,format");
      v.searchParams.set("access_token", token);
      try { videos.set(videoId, (await pedir(fetchFn, v)) as VideoMeta); } catch { /* sin permiso para ese video: queda su portada */ }
    }),
    (async () => {
      const cuenta = id(ad.account_id);
      if (!cuenta || hashes.length === 0) return;
      const i = new URL(`${graph}/act_${cuenta.replace(/^act_/, "")}/adimages`);
      i.searchParams.set("hashes", JSON.stringify(hashes));
      i.searchParams.set("fields", "hash,url,width,height");
      i.searchParams.set("access_token", token);
      try {
        for (const x of lista((await pedir(fetchFn, i)).data)) {
          const h = txt(x.hash);
          if (h) imagenes.set(h, x as ImagenMeta);
        }
      } catch { /* quedan los links que ya traía el creativo */ }
    })(),
  ]);

  return { medios: armarMedios(refs, videos, imagenes), ...textoDelCreativo(creativo) };
}

/* ---------- La forma de cada medio ---------- */

/** Vertical, cuadrado u horizontal, con la proporción más cercana de las
 *  que usa Meta: "Vertical 9:16", "Cuadrado 1:1", "Horizontal 16:9". */
export function formaDe(ancho?: number, alto?: number): string {
  if (!ancho || !alto) return "";
  const r = ancho / alto;
  const conocidas: [number, string][] = [[9 / 16, "Vertical 9:16"], [2 / 3, "Vertical 2:3"], [4 / 5, "Vertical 4:5"], [1, "Cuadrado 1:1"], [1.91, "Horizontal 1,91:1"], [16 / 9, "Horizontal 16:9"]];
  let mejor = conocidas[0];
  for (const c of conocidas) if (Math.abs(Math.log(r / c[0])) < Math.abs(Math.log(r / mejor[0]))) mejor = c;
  if (Math.abs(Math.log(r / mejor[0])) < 0.06) return mejor[1];
  return r < 0.95 ? "Vertical" : r > 1.05 ? "Horizontal" : "Cuadrado";
}
