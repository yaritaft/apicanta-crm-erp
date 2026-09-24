import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { GRAPH } from "./meta";

/* ==================================================================
   Los formularios de Meta (Lead Ads): quién se anotó en un formulario
   instantáneo de Facebook o Instagram.

   Entran por webhook: Meta avisa al instante cada lead nuevo (el campo
   "leadgen" de la página) y con ese aviso se pide ESE lead a la API. No
   hay consultas periódicas, así no se gasta el límite de Meta. Para lo
   anterior al webhook hay un botón que trae los últimos 90 días (lo que
   guarda Meta), una vez.

   La suscripción se hace con lo que ya tenemos: el token de sistema para
   las páginas y el App Secret para la app. El token de verificación del
   webhook sale del App Secret, así no hay otra clave que guardar.

   Lo que tiene que tener el usuario del sistema en el Business Manager,
   además de lo de anuncios: los permisos leads_retrieval,
   pages_show_list, pages_read_engagement, pages_manage_metadata (para
   suscribir la página al webhook) y pages_manage_ads, la página
   asignada, y el acceso a los clientes potenciales (Configuración del
   negocio → Integraciones → Acceso a clientes potenciales). Si falta
   algo, el error lo dice con esas palabras.
   ================================================================== */

export interface PaginaMeta { id: string; nombre: string; token: string }
export interface FormularioMeta {
  id: string; nombre: string; estado: string;
  /* clave de la pregunta → cómo se lee ("¿Cuál es tu nivel de inglés?") */
  preguntas: Record<string, string>;
}
export interface LeadMeta {
  id: string;
  creado: string;
  formularioId: string;
  anuncioId?: string; anuncio?: string;
  conjunto?: string;
  campaniaId?: string; campania?: string;
  /* "fb" o "ig" */
  plataforma?: string;
  organico?: boolean;
  campos: { nombre: string; valores: string[] }[];
}

interface ErrorGraph { message?: string; code?: number; error_subcode?: number }

const PERMISOS_LEADS = "leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_metadata y pages_manage_ads";

function errorDeMeta(err: ErrorGraph | undefined, status: number): Error {
  const msg = err?.message ?? `Meta respondió ${status}`;
  const codigo = err?.code ?? 0;
  if (codigo === 190) {
    return new Error("El token de Meta venció o no sirve: hay que generar uno nuevo para el usuario del sistema.");
  }
  if (codigo === 10 || (codigo >= 200 && codigo < 300) || /permission|permiso/i.test(msg)) {
    return new Error(
      `A Meta le falta un permiso para leer los formularios (${msg}). El usuario del sistema necesita `
      + `${PERMISOS_LEADS}, la página asignada y el acceso a clientes potenciales en el Business Manager.`,
    );
  }
  return new Error(msg);
}

async function pedir<T>(url: URL): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  const j = (await r.json().catch(() => ({}))) as { error?: ErrorGraph };
  if (!r.ok || j.error) throw errorDeMeta(j.error, r.status);
  return j as T;
}

/* Todas las páginas de un listado, siguiendo `paging.next`. */
async function todas<T>(url: URL, maxPaginas = 40): Promise<T[]> {
  const out: T[] = [];
  let siguiente: string | undefined = url.toString();
  for (let i = 0; siguiente && i < maxPaginas; i++) {
    const j: { data?: T[]; paging?: { next?: string } } = await pedir(new URL(siguiente));
    out.push(...(j.data ?? []));
    siguiente = j.paging?.next;
  }
  return out;
}

/** Las páginas que ve el usuario del sistema, cada una con su token. */
export async function paginasDelNegocio(token: string): Promise<PaginaMeta[]> {
  const u = new URL(`${GRAPH}/me/accounts`);
  u.searchParams.set("fields", "id,name,access_token");
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", token);
  const filas = await todas<{ id: string; name: string; access_token?: string }>(u);
  return filas.filter((p) => p.access_token).map((p) => ({ id: p.id, nombre: p.name, token: p.access_token! }));
}

/** Los formularios instantáneos de una página, con sus preguntas. */
export async function formulariosDe(p: PaginaMeta): Promise<FormularioMeta[]> {
  const u = new URL(`${GRAPH}/${p.id}/leadgen_forms`);
  u.searchParams.set("fields", "id,name,status,questions{key,label}");
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", p.token);
  const filas = await todas<{ id: string; name: string; status: string; questions?: { key: string; label?: string }[] }>(u);
  return filas.map((f) => ({
    id: f.id, nombre: f.name, estado: f.status,
    preguntas: Object.fromEntries((f.questions ?? []).map((q) => [q.key, q.label || q.key])),
  }));
}

const CAMPOS_LEAD = "id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,platform,is_organic,form_id";

type LeadCrudo = {
  id: string; created_time: string; form_id?: string;
  field_data?: { name: string; values?: string[] }[];
  ad_id?: string; ad_name?: string; adset_name?: string; campaign_id?: string; campaign_name?: string;
  platform?: string; is_organic?: boolean;
};

function leadDe(l: LeadCrudo, formularioId: string): LeadMeta {
  return {
    id: l.id, creado: l.created_time, formularioId: l.form_id ?? formularioId,
    anuncioId: l.ad_id, anuncio: l.ad_name, conjunto: l.adset_name,
    campaniaId: l.campaign_id, campania: l.campaign_name,
    plataforma: l.platform, organico: l.is_organic,
    campos: (l.field_data ?? []).map((c) => ({ nombre: c.name, valores: c.values ?? [] })),
  };
}

/** Los leads de un formulario desde una fecha. */
export async function leadsDe(f: FormularioMeta, p: PaginaMeta, desde: Date): Promise<LeadMeta[]> {
  const u = new URL(`${GRAPH}/${f.id}/leads`);
  u.searchParams.set("fields", CAMPOS_LEAD);
  u.searchParams.set("limit", "500");
  u.searchParams.set("filtering", JSON.stringify([
    { field: "time_created", operator: "GREATER_THAN", value: Math.floor(desde.getTime() / 1000) },
  ]));
  u.searchParams.set("access_token", p.token);
  return (await todas<LeadCrudo>(u)).map((l) => leadDe(l, f.id));
}

/* Los campos estándar de Meta; lo demás son las preguntas del formulario. */
const ESTANDAR = new Set([
  "full_name", "first_name", "last_name", "email", "work_email", "phone_number", "work_phone_number",
  "city", "state", "country", "zip", "post_code", "street_address",
]);

const valor = (l: LeadMeta, ...nombres: string[]) =>
  l.campos.find((c) => nombres.includes(c.nombre))?.valores.join(", ").trim() || undefined;

/** Nombre, email, teléfono y país, como vienen en el formulario. */
export function datosPersonales(l: LeadMeta): { nombre?: string; email?: string; telefono?: string; pais?: string; ciudad?: string } {
  const nombre = valor(l, "full_name") ?? [valor(l, "first_name"), valor(l, "last_name")].filter(Boolean).join(" ");
  return {
    nombre: nombre || undefined,
    email: valor(l, "email", "work_email"),
    telefono: valor(l, "phone_number", "work_phone_number"),
    pais: valor(l, "country"),
    ciudad: valor(l, "city"),
  };
}

/** Las respuestas a las preguntas propias del formulario, con su texto. */
export function respuestasDe(l: LeadMeta, f?: FormularioMeta): { pregunta: string; respuesta: string }[] {
  return l.campos
    .filter((c) => !ESTANDAR.has(c.nombre) && c.valores.some((v) => v.trim()))
    .map((c) => ({
      pregunta: f?.preguntas[c.nombre] ?? c.nombre.replace(/_/g, " "),
      respuesta: c.valores.map((v) => v.replace(/_/g, " ").trim()).join(", "),
    }));
}

/* ---------- Un lead puntual, para el aviso del webhook ---------- */

/** El token de una página, pedido con el token de sistema. */
export async function paginaPorId(id: string, tokenSistema: string): Promise<PaginaMeta> {
  const u = new URL(`${GRAPH}/${id}`);
  u.searchParams.set("fields", "id,name,access_token");
  u.searchParams.set("access_token", tokenSistema);
  const p = await pedir<{ id: string; name: string; access_token?: string }>(u);
  if (!p.access_token) throw new Error(`El usuario del sistema no tiene la página ${p.name ?? id} asignada.`);
  return { id: p.id, nombre: p.name, token: p.access_token };
}

export async function formularioPorId(id: string, p: PaginaMeta): Promise<FormularioMeta> {
  const u = new URL(`${GRAPH}/${id}`);
  u.searchParams.set("fields", "id,name,status,questions{key,label}");
  u.searchParams.set("access_token", p.token);
  const f = await pedir<{ id: string; name: string; status: string; questions?: { key: string; label?: string }[] }>(u);
  return {
    id: f.id, nombre: f.name, estado: f.status,
    preguntas: Object.fromEntries((f.questions ?? []).map((q) => [q.key, q.label || q.key])),
  };
}

export async function leadPorId(id: string, formularioId: string, p: PaginaMeta): Promise<LeadMeta> {
  const u = new URL(`${GRAPH}/${id}`);
  u.searchParams.set("fields", CAMPOS_LEAD);
  u.searchParams.set("access_token", p.token);
  return leadDe(await pedir<LeadCrudo>(u), formularioId);
}

/* ---------- La suscripción al webhook ---------- */

const tokenDeApp = () => {
  const id = process.env.META_APP_ID?.trim();
  const secreto = process.env.META_APP_SECRET?.trim();
  return id && secreto ? { id, secreto, token: `${id}|${secreto}` } : null;
};

/** El token con el que Meta verifica el webhook: sale del App Secret. */
export function tokenDeVerificacion(): string | null {
  const secreto = process.env.META_APP_SECRET?.trim();
  return secreto ? createHash("sha256").update(`apicanta-leadgen:${secreto}`).digest("hex").slice(0, 32) : null;
}

/** Que el aviso lo haya mandado Meta: la firma es un HMAC del cuerpo con el App Secret. */
export function firmaValida(cuerpo: string, cabecera: string | null): boolean {
  const secreto = process.env.META_APP_SECRET?.trim();
  if (!secreto || !cabecera?.startsWith("sha256=")) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo, "utf8").digest();
  const recibida = Buffer.from(cabecera.slice(7), "hex");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

export interface EstadoWebhook {
  app: { activo: boolean; callback?: string; error?: string };
  paginas: { id: string; nombre: string; suscripta: boolean; error?: string }[];
}

/** Si la app escucha "leadgen" y en qué dirección, y qué páginas le avisan. */
export async function estadoWebhook(tokenSistema: string): Promise<EstadoWebhook> {
  const out: EstadoWebhook = { app: { activo: false }, paginas: [] };
  const app = tokenDeApp();
  if (!app) out.app.error = "Faltan META_APP_ID y META_APP_SECRET en el servidor.";
  else {
    try {
      const u = new URL(`${GRAPH}/${app.id}/subscriptions`);
      u.searchParams.set("access_token", app.token);
      const j = await pedir<{ data?: { object: string; callback_url: string; active: boolean; fields?: { name: string }[] }[] }>(u);
      const pagina = (j.data ?? []).find((s) => s.object === "page" && s.fields?.some((f) => f.name === "leadgen"));
      out.app = { activo: Boolean(pagina?.active), callback: pagina?.callback_url };
    } catch (err) {
      out.app.error = err instanceof Error ? err.message : String(err);
    }
  }
  let paginas: PaginaMeta[] = [];
  try {
    paginas = await paginasDelNegocio(tokenSistema);
  } catch (err) {
    out.paginas.push({ id: "", nombre: "Páginas", suscripta: false, error: err instanceof Error ? err.message : String(err) });
    return out;
  }
  for (const p of paginas) {
    try {
      const u = new URL(`${GRAPH}/${p.id}/subscribed_apps`);
      u.searchParams.set("access_token", p.token);
      const j = await pedir<{ data?: { id: string; subscribed_fields?: string[] }[] }>(u);
      const suscripta = (j.data ?? []).some((a) => a.id === app?.id && a.subscribed_fields?.includes("leadgen"));
      out.paginas.push({ id: p.id, nombre: p.nombre, suscripta });
    } catch (err) {
      out.paginas.push({ id: p.id, nombre: p.nombre, suscripta: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/**
 * Activa los avisos: la app escucha "leadgen" de las páginas en `callback`
 * (Meta la verifica en el momento con un GET), y cada página se suscribe a
 * la app. Se puede correr de nuevo: si ya estaba, queda igual.
 */
export async function activarWebhook(tokenSistema: string, callback: string): Promise<EstadoWebhook> {
  const app = tokenDeApp();
  const verificacion = tokenDeVerificacion();
  if (!app || !verificacion) throw new Error("Faltan META_APP_ID y META_APP_SECRET en el servidor.");
  const u = new URL(`${GRAPH}/${app.id}/subscriptions`);
  u.searchParams.set("object", "page");
  u.searchParams.set("callback_url", callback);
  u.searchParams.set("fields", "leadgen");
  u.searchParams.set("verify_token", verificacion);
  u.searchParams.set("include_values", "true");
  u.searchParams.set("access_token", app.token);
  const r = await fetch(u, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000) });
  const j = (await r.json().catch(() => ({}))) as { error?: ErrorGraph };
  if (!r.ok || j.error) throw errorDeMeta(j.error, r.status);

  for (const p of await paginasDelNegocio(tokenSistema)) {
    const s = new URL(`${GRAPH}/${p.id}/subscribed_apps`);
    s.searchParams.set("subscribed_fields", "leadgen");
    s.searchParams.set("access_token", p.token);
    const rs = await fetch(s, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000) });
    const js = (await rs.json().catch(() => ({}))) as { error?: ErrorGraph };
    if (!rs.ok || js.error) throw errorDeMeta(js.error, rs.status);
  }
  return estadoWebhook(tokenSistema);
}
