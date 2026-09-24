import { GRAPH } from "./meta";

/* ==================================================================
   Los formularios de Meta (Lead Ads): quién se anotó en un formulario
   instantáneo de Facebook o Instagram.

   Con el token de sistema se piden las páginas del negocio (cada una
   trae su token de página), sus formularios con las preguntas y los
   leads de cada formulario. Meta guarda los leads sólo 90 días: por eso
   se traen solos y no hace falta entrar a descargarlos.

   Lo que tiene que tener el usuario del sistema en el Business Manager,
   además de lo de anuncios: los permisos leads_retrieval,
   pages_show_list, pages_read_engagement y pages_manage_ads, la página
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

const PERMISOS_LEADS = "leads_retrieval, pages_show_list, pages_read_engagement y pages_manage_ads";

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
