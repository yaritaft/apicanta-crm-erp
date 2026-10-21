/* ==================================================================
   Accesos de alumnos (onboarding y outboarding): lo que no depende de
   la red. El pedido es el Loom de Yari del 20/10: al firmar el contrato
   de PandaDoc, el alumno entra solo a sus grupos de Telegram, a su curso
   de Wisboo y a sus reuniones de Zoom, y el outboarding se los saca.

   Acá se leen las respuestas de cada servicio tal como vienen (sin
   confiar en que traigan todo) para la prueba de conexión de Ajustes →
   Integraciones. Las llamadas viven en accesos-alumnos-servidor.ts.
   ================================================================== */

/* Los productos de Wisboo de cada programa, como los pasó Manu el 20/10.
   Wisboo los «regala» (el cobro va por otra pasarela). */
export const PRODUCTOS_WISBOO: { id: string; nombre: string }[] = [
  { id: "PRO-019fd69d87b070648850ba3e5e53e", nombre: "Mentoría (Hackear IT)" },
  { id: "PRO-019fd69d6d247f1c8679e67e18295", nombre: "Mentoría (Hackear Biz)" },
  { id: "PRO-019fd69d7de5799e85772a1c877c7", nombre: "Mentoría (Hackear AI)" },
  { id: "PRO-06a7f78e32707000962516acdb15d48d", nombre: "Mentoría (Principals)" },
  { id: "PRO-019fd69d6d677c3085afe8fb8092d", nombre: "Mentoría (Principals Mastermind)" },
  { id: "PRO-019fd69d6bfd7aec822705c2bb262", nombre: "Bonos" },
];

/* La ruta propia que va a recibir los avisos del bot. */
export const RUTA_WEBHOOK_TELEGRAM = "/api/telegram/webhook";

export type EstadoConexion = "falta" | "ok" | "error";

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/* ---------- Telegram ---------- */

export interface WebhookTelegram {
  /* libre: nadie recibe sus avisos por webhook (se puede conectar).
     nuestro: ya apunta a Apicanta. otra: lo usa otra herramienta. */
  uso: "libre" | "nuestro" | "otra";
  /* Sólo el dominio de la otra herramienta: la dirección entera puede
     llevar un secreto adentro. */
  host: string | null;
  pendientes: number;
  ultimoError: string | null;
}

/** Lee `getWebhookInfo`. `nuestraBase` es el origen de la app (https://…). */
export function leerWebhookTelegram(respuesta: unknown, nuestraBase: string): WebhookTelegram {
  const r = objeto(objeto(respuesta).result);
  const url = texto(r.url);
  const pendientes = typeof r.pending_update_count === "number" ? r.pending_update_count : 0;
  const ultimoError = texto(r.last_error_message) || null;
  if (!url) return { uso: "libre", host: null, pendientes, ultimoError };
  let host: string | null = null;
  try { host = new URL(url).host; } catch { host = null; }
  const nuestra = `${nuestraBase.replace(/\/+$/, "")}${RUTA_WEBHOOK_TELEGRAM}`;
  const esNuestra = url === nuestra || url.startsWith(`${nuestra}?`);
  return { uso: esNuestra ? "nuestro" : "otra", host, pendientes, ultimoError };
}

/** Lee `getMe`: el usuario del bot (sin @) y si puede leer los grupos. */
export function leerBotTelegram(respuesta: unknown): { usuario: string; nombre: string } | null {
  const r = objeto(objeto(respuesta).result);
  const usuario = texto(r.username);
  if (!usuario) return null;
  return { usuario, nombre: texto(r.first_name) || usuario };
}

/* ---------- Wisboo ---------- */

export interface ProductoWisboo {
  id: string;
  nombre: string;
  /* course_type, bundle_type, webinar_type, downloadable_type */
  tipo: string;
  /* published, not_published, archived */
  estado: string;
}

/** Lee una página de `GET /products`. */
export function leerProductosWisboo(respuesta: unknown): { productos: ProductoWisboo[]; total: number | null } {
  const r = objeto(respuesta);
  const productos = lista(r.data).flatMap((p): ProductoWisboo[] => {
    const o = objeto(p);
    const id = texto(o.id);
    return id ? [{ id, nombre: texto(o.name) || id, tipo: texto(o.product_type), estado: texto(o.state) }] : [];
  });
  const total = objeto(r.metadata).total_record_count;
  return { productos, total: typeof total === "number" ? total : null };
}

/** Cada producto de los programas, con lo que Wisboo dice de él (o null si la tienda no lo tiene). */
export function cruzarProductosWisboo(
  enLaTienda: ProductoWisboo[], conocidos = PRODUCTOS_WISBOO,
): { id: string; nombre: string; enWisboo: ProductoWisboo | null }[] {
  const porId = new Map(enLaTienda.map((p) => [p.id, p]));
  return conocidos.map((c) => ({ ...c, enWisboo: porId.get(c.id) ?? null }));
}

/* ---------- PandaDoc ---------- */

export interface PlantillaPandadoc { id: string; nombre: string; modificada: string | null }

/** Lee `GET /public/v1/templates`. */
export function leerPlantillasPandadoc(respuesta: unknown): PlantillaPandadoc[] {
  return lista(objeto(respuesta).results).flatMap((p): PlantillaPandadoc[] => {
    const o = objeto(p);
    const id = texto(o.id);
    return id ? [{ id, nombre: texto(o.name) || id, modificada: texto(o.date_modified) || null }] : [];
  });
}

/** Lee `GET /public/v1/members/current`: de quién es la clave y en qué espacio de trabajo. */
export function leerCuentaPandadoc(respuesta: unknown): { email: string; espacio: string } | null {
  const o = objeto(respuesta);
  const email = texto(o.email);
  if (!email) return null;
  return { email, espacio: texto(o.workspace_name) };
}

/* ---------- Zoom ---------- */

export interface ReunionZoom {
  id: string; tema: string; tipo: number | null;
  /* Si acepta inscriptos: sin registro activado (o recurrente sin horario fijo) Zoom no deja inscribir a nadie. */
  inscripcion?: boolean | null;
}

/** Lee `GET /users/me/meetings`. El id va como texto: puede pasar los 10 dígitos. */
export function leerReunionesZoom(respuesta: unknown): ReunionZoom[] {
  return lista(objeto(respuesta).meetings).flatMap((m): ReunionZoom[] => {
    const o = objeto(m);
    const id = typeof o.id === "number" || typeof o.id === "string" ? String(o.id) : "";
    return id ? [{ id, tema: texto(o.topic) || id, tipo: typeof o.type === "number" ? o.type : null }] : [];
  });
}

/** Lee `GET /meetings/{id}`: si la reunión acepta inscriptos. Zoom sólo inscribe en reuniones con registro
    activado (approval_type 0 o 1; 2 es «sin registro»), y las recurrentes sin horario fijo (tipo 3) no lo tienen. */
export function leerInscripcionZoom(respuesta: unknown): boolean | null {
  const o = objeto(respuesta);
  if (o.type === 3) return false;
  const aprobacion = objeto(o.settings).approval_type;
  return typeof aprobacion === "number" ? aprobacion === 0 || aprobacion === 1 : null;
}

/** El nombre de cada reunión para elegirla: con «sin inscripción» si no acepta inscriptos, y con el final del id
    cuando hay dos con el mismo tema. */
export function nombreDeReunion(m: ReunionZoom, todas: ReunionZoom[]): string {
  const repetida = todas.filter((x) => x.tema === m.tema).length > 1;
  return `${m.tema}${repetida ? ` · …${m.id.slice(-4)}` : ""}${m.inscripcion === false ? " (sin inscripción)" : ""}`;
}
