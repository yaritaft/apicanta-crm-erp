/* ==================================================================
   El estándar de UTMs de Apicanta (Yari, 24/09/2026).

   Un link con UTMs se arma siempre igual, para agrupar sin limpiar datos
   a mano:
   - todo en minúscula, sin tildes ni espacios;
   - "_" separa campos dentro de un valor, "-" separa palabras
     (webinar_20260924, vsl-yt);
   - las fechas van aaaammdd;
   - utm_campaign arranca con el funnel: {funnel}_{detalle}. Ese prefijo
     es lo que dice por qué vía agendó;
   - sólo los cinco parámetros de siempre, y sólo los valores del
     diccionario (uno nuevo se agrega acá antes de usarlo).

   Acá están el diccionario, los ocho casos (cada vía de agenda tiene una
   sola combinación), cómo se arma el link de cada uno y cómo se lee una
   UTM, en este formato o en el viejo (utm_source=Webinar +
   utm_medium=23-09), que todavía traen las agendas de antes.
   ================================================================== */

export const FUENTES = ["meta", "instagram", "youtube", "google", "email", "whatsapp", "setter", "referido"] as const;
export const MEDIOS = ["paid", "organic", "email", "outbound", "referral"] as const;
export const FUNNELS = ["vsl", "vsl-yt", "webinar", "clase0", "qa", "setter", "referido"] as const;
export type Funnel = typeof FUNNELS[number];

/* Los eventos con fecha: el link del vivo, el de la grabación y el de los
   mails o mensajes de después. */
export const EVENTOS: Funnel[] = ["webinar", "clase0", "qa"];
export const MOMENTOS_EVENTO = ["vivo", "replay", "seguimiento"] as const;
export type MomentoEvento = typeof MOMENTOS_EVENTO[number];

export const NOMBRE_FUNNEL: Record<Funnel, string> = {
  vsl: "VSL", "vsl-yt": "VSL de YouTube", webinar: "Webinar", clase0: "Clase cero", qa: "Q&A", setter: "Setter", referido: "Referido",
};

export type Utm = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_term" | "utm_content", string>>;

/* ---------- Formato ---------- */

/** "Juan Pérez" → "juan-perez": minúscula, sin tildes, palabras con "-". */
export function slugUtm(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/** El día en Argentina, aaaammdd: "2026-09-24T22:00:00Z" → "20260924". */
export function fechaUtm(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replaceAll("-", "");
  const d = new Date(new Date(iso).getTime() - 3 * 3600000);
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

/** "20260924" → "2026-09-24" */
const isoDeFechaUtm = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

/* ---------- Los ocho casos ---------- */

export type IdCaso = "meta-vsl" | "vsl-organica" | "vsl-yt" | "webinar" | "clase0" | "qa" | "setter" | "referido";

export interface CasoUtm {
  id: IdCaso;
  nombre: string;
  funnel: Funnel;
  /* Lo que el creador pregunta para armar el link. */
  pide: ("fecha" | "fuenteEvento" | "momento" | "lugarVsl" | "video" | "setter" | "canalSetter" | "referidor")[];
  nota: string;
}

export const CASOS: CasoUtm[] = [
  { id: "meta-vsl", nombre: "Pauta Meta a VSL", funnel: "vsl", pide: [],
    nota: "Los tres dinámicos los completa Meta. Para que llegue el prefijo del funnel, la campaña se nombra vsl_{nombre} (o webinar_{fecha} si lleva a un webinar)." },
  { id: "vsl-organica", nombre: "VSL orgánica", funnel: "vsl", pide: ["lugarVsl"],
    nota: "El link de la bio, las historias o un post de Instagram." },
  { id: "vsl-yt", nombre: "VSL oculta desde YouTube", funnel: "vsl-yt", pide: ["video"],
    nota: "Cada descripción lleva su propio link con el video en utm_content. El link genérico queda como desconocido." },
  { id: "webinar", nombre: "Webinar", funnel: "webinar", pide: ["fecha", "fuenteEvento", "momento"],
    nota: "vivo: el link que se muestra durante el evento; replay: el de la grabación; seguimiento: el de los mails o mensajes de después." },
  { id: "clase0", nombre: "Clase cero", funnel: "clase0", pide: ["fecha", "fuenteEvento", "momento"],
    nota: "Igual que el webinar: vivo, replay o seguimiento." },
  { id: "qa", nombre: "Q&A", funnel: "qa", pide: ["fecha", "fuenteEvento", "momento"],
    nota: "Igual que el webinar: vivo, replay o seguimiento." },
  { id: "setter", nombre: "Setter orgánico", funnel: "setter", pide: ["setter", "canalSetter"],
    nota: "Un link por setter: por DM o por comentario." },
  { id: "referido", nombre: "Referido", funnel: "referido", pide: ["referidor"],
    nota: "El nombre (o el código) de quien refirió va en utm_content, para que cualquier herramienta lo conserve." },
];

export interface ValoresCaso {
  fecha?: string;          // ISO o aaaa-mm-dd
  fuenteEvento?: "email" | "whatsapp";
  momento?: MomentoEvento;
  lugarVsl?: "bio" | "historia" | "post";
  video?: string;          // slug del video de YouTube
  setter?: string;         // nombre del setter
  canalSetter?: "dm" | "comentario";
  referidor?: string;
}

/** Los UTMs de un caso, con los valores que pide ya formateados. */
export function armarUtm(caso: IdCaso, v: ValoresCaso = {}): Utm {
  switch (caso) {
    case "meta-vsl":
      return { utm_source: "meta", utm_medium: "paid", utm_campaign: "{{campaign.name}}", utm_term: "{{adset.name}}", utm_content: "{{ad.name}}" };
    case "vsl-organica":
      return { utm_source: "instagram", utm_medium: "organic", utm_campaign: "vsl_organica", utm_content: v.lugarVsl ?? "bio" };
    case "vsl-yt":
      return { utm_source: "youtube", utm_medium: "organic", utm_campaign: "vsl-yt", utm_content: slugUtm(v.video ?? "") || "desconocido" };
    case "webinar":
    case "clase0":
    case "qa":
      return {
        utm_source: v.fuenteEvento ?? "email", utm_medium: "email",
        utm_campaign: `${caso}_${v.fecha ? fechaUtm(v.fecha) : "aaaammdd"}`, utm_content: v.momento ?? "vivo",
      };
    case "setter":
      return { utm_source: "setter", utm_medium: "outbound", utm_campaign: `setter_${slugUtm(v.setter ?? "") || "nombre-setter"}`, utm_content: v.canalSetter ?? "dm" };
    case "referido":
      return { utm_source: "referido", utm_medium: "referral", utm_campaign: "referido", utm_content: slugUtm(v.referidor ?? "") || "quien-refirio" };
  }
}

/** Los UTMs como van en el link, en el orden del estándar. */
export function queryUtm(u: Utm): string {
  const orden = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
  /* Las llaves de Meta ({{campaign.name}}) van tal cual: las reemplaza Meta. */
  return orden.filter((k) => u[k]).map((k) => `${k}=${/^\{\{.+\}\}$/.test(u[k]!) ? u[k] : encodeURIComponent(u[k]!)}`).join("&");
}

/** El link de destino con los UTMs; si ya traía otros parámetros, se suman. */
export function linkConUtm(base: string, u: Utm): string {
  const b = base.trim();
  if (!b) return `?${queryUtm(u)}`;
  const [sinAncla, ancla] = b.split("#");
  const limpio = sinAncla.replace(/([?&])utm_[a-z]+=[^&]*/g, "$1").replace(/[?&]+$/, "").replace("?&", "?");
  return `${limpio}${limpio.includes("?") ? "&" : "?"}${queryUtm(u)}${ancla ? `#${ancla}` : ""}`;
}

/* ---------- Validar ---------- */

/** Lo que no sigue el estándar: vacío si está bien. */
export function problemasDeUtm(u: Utm): string[] {
  const out: string[] = [];
  const l = leerUtm(u);
  /* direct / none es lo que el estándar guarda cuando no hay UTMs. */
  if (u.utm_source === "direct" && u.utm_medium === "none") return out;
  if (l.formato === "viejo") return ["formato viejo: en el estándar va utm_campaign=webinar_aaaammdd y utm_content=vivo, replay o seguimiento"];
  for (const [k, v] of Object.entries(u)) {
    if (!v || /^\{\{.+\}\}$/.test(v)) continue;
    if (v !== v.toLowerCase()) out.push(`${k} tiene mayúsculas`);
    if (/\s/.test(v)) out.push(`${k} tiene espacios`);
    if (/[^\x00-\x7f]/.test(v)) out.push(`${k} tiene tildes o caracteres raros`);
  }
  if (u.utm_source && !(FUENTES as readonly string[]).includes(u.utm_source)) out.push(`utm_source "${u.utm_source}" no está en el diccionario`);
  if (u.utm_medium && !(MEDIOS as readonly string[]).includes(u.utm_medium)) out.push(`utm_medium "${u.utm_medium}" no está en el diccionario`);
  if (u.utm_campaign && !/^\{\{.+\}\}$/.test(u.utm_campaign) && !l.funnel) out.push(`utm_campaign "${u.utm_campaign}" no arranca con un funnel (${FUNNELS.join(", ")})`);
  if (l.funnel && EVENTOS.includes(l.funnel) && !l.fecha) out.push(`la fecha de ${u.utm_campaign} tiene que ser aaaammdd`);
  return out;
}

/* ---------- Leer ---------- */

export interface UtmLeida {
  formato: "estandar" | "viejo" | "sin-utm" | "otro";
  funnel?: Funnel;
  /* Lo que va después del funnel: vsl_{martin}, setter_{daniel}. */
  detalle?: string;
  /* De un evento en el estándar: aaaa-mm-dd. */
  fecha?: string;
  /* Del formato viejo: sólo día y mes, "23-09". */
  diaMes?: string;
  /* De un evento: vivo o después (replay, seguimiento), si el link lo dice. */
  momento?: "vivo" | "despues";
  contenido?: string;
}

const VIVO_VIEJO = /^(en[\s_-]?)?vivo$/i;
const DESPUES_VIEJO = /^(post[\s_-]?webinar|post|posterior|despues|después|replay|grabaci[oó]n|seguimiento)$/i;
const diaMesDe = (s?: string) => {
  const m = /^(\d{1,2})[-/.](\d{1,2})$/.exec((s ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : undefined;
};

/** Qué dice una UTM, en el estándar o en el formato viejo. Acepta las claves con o sin "utm_". */
export function leerUtm(crudo: Record<string, string | undefined> | null | undefined): UtmLeida {
  const u = Object.fromEntries(Object.entries(crudo ?? {}).map(([k, v]) => [k.toLowerCase().replace(/^utm_/, ""), (v ?? "").trim()]));
  const contenido = u.content || undefined;
  const momento = contenido ? (VIVO_VIEJO.test(contenido) ? "vivo" : DESPUES_VIEJO.test(contenido) ? "despues" : undefined) : undefined;
  if (!u.source && !u.medium && !u.campaign) return { formato: "sin-utm" };
  if (u.source === "direct" && u.medium === "none") return { formato: "sin-utm" };

  const c = (u.campaign ?? "").toLowerCase();
  const m = /^(vsl-yt|vsl|webinar|clase0|qa|setter|referido)(?:_(.+))?$/.exec(c);
  if (m) {
    const funnel = m[1] as Funnel;
    const detalle = m[2];
    const fecha = EVENTOS.includes(funnel) && detalle && /^\d{8}$/.test(detalle) ? isoDeFechaUtm(detalle) : undefined;
    return { formato: "estandar", funnel, detalle, fecha, momento: EVENTOS.includes(funnel) ? momento : undefined, contenido };
  }
  /* El formato viejo del webinar: utm_source=Webinar y la fecha en el medium
     (o en el content o la campaign, como venían los links de antes). */
  if (/webinar/i.test(u.source ?? "")) {
    const diaMes = diaMesDe(u.medium) ?? diaMesDe(u.content) ?? diaMesDe(u.campaign);
    return { formato: "viejo", funnel: "webinar", diaMes, momento, contenido };
  }
  return { formato: "otro", contenido };
}

/** "Webinar 24/09 · replay", "VSL martin", "Setter · daniel". */
export function textoUtm(l: UtmLeida): string | undefined {
  if (!l.funnel) return undefined;
  const nombre = NOMBRE_FUNNEL[l.funnel];
  const dia = l.fecha ? `${l.fecha.slice(8, 10)}/${l.fecha.slice(5, 7)}` : l.diaMes?.replace("-", "/");
  if (EVENTOS.includes(l.funnel)) return [`${nombre}${dia ? ` ${dia}` : ""}`, l.contenido].filter(Boolean).join(" · ");
  if (l.funnel === "vsl") return l.detalle === "organica" ? `VSL orgánica${l.contenido ? ` · ${l.contenido}` : ""}` : `VSL${l.detalle ? ` ${l.detalle}` : ""}`;
  if (l.funnel === "vsl-yt") return `VSL de YouTube${l.contenido ? ` · ${l.contenido}` : ""}`;
  if (l.funnel === "setter") return `Setter${l.detalle ? ` · ${l.detalle}` : ""}`;
  return `Referido${l.contenido ? ` · ${l.contenido}` : ""}`;
}
