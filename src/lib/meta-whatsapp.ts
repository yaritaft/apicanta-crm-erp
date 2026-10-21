import type { SupabaseClient } from "@supabase/supabase-js";
import { GRAPH } from "./meta";

/* ==================================================================
   El costo de WhatsApp API, desde Meta (21/10).

   Los mensajes que se mandan por la API de WhatsApp Business se cobran por mensaje y por categoría (marketing, utilidad…), y se facturan a
   la cuenta de WhatsApp Business (WABA), no a las cuentas publicitarias. La API de análisis de esa cuenta (`pricing_analytics`) entrega el
   costo y el volumen por día. Se lee con el MISMO token de sistema que los anuncios (META_SYSTEM_TOKEN), que además de `ads_read` tiene que
   traer el permiso `whatsapp_business_management` y la cuenta asignada al usuario de sistema.

   Del lado del SERVIDOR (clave de servicio). Los días se guardan en `whatsapp_costos` (supabase/whatsapp-costos.sql) y la app los reparte a
   cada webinar (lib/webinar.ts, costoWhatsappDelWebinar).

   Qué se sabe de la respuesta: es una lista de bloques con `data_points`, cada punto con `start`, `end`, `volume`, `cost` y, si se pide la
   dimensión, `pricing_category`. La lectura es tolerante (acepta los nombres alternativos y números como texto) porque la referencia oficial
   no detalla la respuesta; lo que no se entiende se descarta y se cuenta en `descartados`.
   ================================================================== */

/** Las cuentas de WhatsApp Business (WABA) del portfolio, sin la de prueba. OJO: el id que muestra el Business Manager en «Cuentas de mensajes»
    (517225948145267 para «Apicanta Manychat») NO es el de la API: el de la WABA es el que sale en la dirección de «Cuentas de WhatsApp»
    (selected_asset_id): Apicanta Manychat 4597681580548968, Apicanta 2216414815700142 y los dos Yari Taft 1766082654409811 y 1644221300470641.
    META_WABA_IDS pone otras, separadas por coma. */
export const WABA_POR_DEFECTO = "4597681580548968,2216414815700142,1766082654409811,1644221300470641";
/** El portfolio comercial (Yari Taft BM): para listar qué cuentas de WhatsApp ve el token cuando la que se pidió no se puede leer. */
export const BUSINESS_POR_DEFECTO = "3322384087906994";

export function cuentasDeWhatsapp(env: NodeJS.ProcessEnv = process.env): string[] {
  const crudo = env.META_WABA_IDS?.trim() || env.META_WABA_ID?.trim() || WABA_POR_DEFECTO;
  return [...new Set(crudo.split(/[,\s]+/).filter((x) => /^\d{5,30}$/.test(x)))];
}

export interface CostoWhatsappDia {
  dia: string;       // aaaa-mm-dd
  cuenta: string;
  categoria: string;
  volumen: number;
  costo: number;
  moneda: string;
}

const DIA_SEG = 86_400;
/** Se pide de a 30 días: la referencia no dice cuántos aguanta un pedido diario y así ninguno pasa de lo razonable. */
export const DIAS_POR_PEDIDO = 30;

/** Parte [desde, hasta] (aaaa-mm-dd, ambos inclusive) en tramos de a lo sumo `max` días, como [inicio, finExclusivo] en segundos UNIX (UTC). */
export function tramos(desde: string, hasta: string, max = DIAS_POR_PEDIDO): { start: number; end: number }[] {
  const a = Date.parse(`${desde}T00:00:00Z`) / 1000, b = Date.parse(`${hasta}T00:00:00Z`) / 1000 + DIA_SEG;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
  const out: { start: number; end: number }[] = [];
  for (let s = a; s < b; s += max * DIA_SEG) out.push({ start: s, end: Math.min(s + max * DIA_SEG, b) });
  return out;
}

const numero = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const diaDe = (v: unknown): string | null => {
  const n = numero(v);
  if (n !== null && n > 1e8) return new Date((n > 1e12 ? n : n * 1000)).toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
};

/** Lo que dice la respuesta de Meta, como filas por día y categoría. Acepta `{pricing_analytics:{data:[…]}}` y `{data:[…]}`; el costo de varios
    puntos del mismo día y categoría se suma. `descartados` cuenta lo que no se pudo leer. */
export function leerCostos(json: unknown, cuenta: string, moneda: string): { filas: CostoWhatsappDia[]; descartados: number } {
  const raiz = (json as { pricing_analytics?: unknown } | null)?.pricing_analytics ?? json;
  const bloques = (raiz as { data?: unknown } | null)?.data;
  const acumulado = new Map<string, CostoWhatsappDia>();
  let descartados = 0;
  for (const b of Array.isArray(bloques) ? bloques : []) {
    const puntos = (b as { data_points?: unknown; data?: unknown } | null)?.data_points ?? (b as { data?: unknown } | null)?.data;
    for (const p of Array.isArray(puntos) ? puntos : []) {
      if (typeof p !== "object" || p === null) { descartados++; continue; }
      const x = p as Record<string, unknown>;
      const dia = diaDe(x.start ?? x.start_time ?? x.date);
      const costo = numero(x.cost ?? x.costo ?? x.amount);
      if (!dia || costo === null) { descartados++; continue; }
      const categoria = typeof x.pricing_category === "string" && x.pricing_category ? x.pricing_category : "TOTAL";
      const clave = `${dia}|${categoria}`;
      const previo = acumulado.get(clave) ?? { dia, cuenta, categoria, volumen: 0, costo: 0, moneda };
      previo.costo = Math.round((previo.costo + costo) * 1e6) / 1e6;
      previo.volumen += numero(x.volume ?? x.volumen) ?? 0;
      acumulado.set(clave, previo);
    }
  }
  return { filas: [...acumulado.values()].sort((a, b) => a.dia.localeCompare(b.dia) || a.categoria.localeCompare(b.categoria)), descartados };
}

/** Un pedido a la API de Meta (para las pruebas se reemplaza). */
export type PedirAMeta = (ruta: string, params: Record<string, string>) => Promise<unknown>;

export class ErrorMetaWhatsapp extends Error {
  constructor(mensaje: string, public codigo?: number) { super(mensaje); }
}

export const pedirAMeta = (token: string): PedirAMeta => async (ruta, params) => {
  const u = new URL(`${GRAPH}/${ruta}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  const r = await fetch(u, { cache: "no-store" });
  const j = (await r.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
  if (!r.ok || j?.error) throw new ErrorMetaWhatsapp(j?.error?.message ?? `Meta respondió ${r.status}`, j?.error?.code);
  return j;
};

/** Lo que se le dice a quien lo lee cuando Meta contesta con un error de permisos: casi siempre es el token. */
export function pistaDelError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const codigo = e instanceof ErrorMetaWhatsapp ? e.codigo : undefined;
  if (codigo === 190) return `${m} (el token venció o no es válido)`;
  if (codigo === 10 || codigo === 200 || /permission|permiso|not authorized|does not have/i.test(m)) {
    return `${m} (al token de sistema le falta el permiso whatsapp_business_management o la cuenta de WhatsApp no está asignada al usuario de sistema)`;
  }
  return m;
}

/** La moneda en la que factura la cuenta; si no se puede leer, USD (queda anotado). */
async function monedaDeLaCuenta(pedir: PedirAMeta, cuenta: string): Promise<{ moneda: string; supuesta: boolean }> {
  try {
    const j = (await pedir(cuenta, { fields: "currency" })) as { currency?: string } | null;
    return j?.currency ? { moneda: j.currency.toUpperCase(), supuesta: false } : { moneda: "USD", supuesta: true };
  } catch { return { moneda: "USD", supuesta: true }; }
}

/** El costo día por día de una cuenta, entre dos fechas (ambas inclusive). */
export async function traerCostosWhatsapp(
  pedir: PedirAMeta, cuenta: string, desde: string, hasta: string,
): Promise<{ filas: CostoWhatsappDia[]; descartados: number; moneda: string; monedaSupuesta: boolean }> {
  const { moneda, supuesta } = await monedaDeLaCuenta(pedir, cuenta);
  const filas = new Map<string, CostoWhatsappDia>();
  let descartados = 0;
  for (const t of tramos(desde, hasta)) {
    const expansion = `pricing_analytics.start(${t.start}).end(${t.end}).granularity(DAILY).metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY"])`;
    let json: unknown;
    try { json = await pedir(cuenta, { fields: expansion }); }
    catch (e) {
      /* La forma documentada es la expansión de campos; si la rechaza por parámetros (100) se prueba la del borde. */
      if (e instanceof ErrorMetaWhatsapp && (e.codigo === 100 || e.codigo === 2500)) {
        json = await pedir(`${cuenta}/pricing_analytics`, {
          start: String(t.start), end: String(t.end), granularity: "DAILY", metric_types: '["COST","VOLUME"]', dimensions: '["PRICING_CATEGORY"]',
        });
      } else throw e;
    }
    const l = leerCostos(json, cuenta, moneda);
    descartados += l.descartados;
    for (const f of l.filas) filas.set(`${f.dia}|${f.categoria}`, f);
  }
  return { filas: [...filas.values()], descartados, moneda, monedaSupuesta: supuesta };
}

export interface ResultadoCostosWhatsapp {
  cuenta: string;
  dias: number;
  total: number;
  moneda: string;
  monedaSupuesta?: boolean;
  descartados: number;
  desde: string;
  hasta: string;
  error?: string;
  /* Cuando Meta rechaza por permisos: qué permisos tiene el token y si la cuenta se puede leer, para saber si falta el permiso o la asignación. */
  diagnostico?: DiagnosticoWhatsapp;
}

export interface DiagnosticoWhatsapp {
  /** Los permisos concedidos al token (me/permissions); null si no se pudieron leer. */
  permisos: string[] | null;
  /** ¿Se pudo leer la cuenta de WhatsApp Business (id y nombre)? */
  cuentaLeible: boolean;
  nombre?: string;
  errorCuenta?: string;
  /** Si le falta justo el permiso que pide pricing_analytics. */
  faltaPermiso?: boolean;
  /** Las cuentas de WhatsApp Business que el token ve en el portfolio (id y nombre): sirve para encontrar el id correcto de la cuenta. */
  cuentasVisibles?: { id: string; nombre?: string }[];
  errorCuentasVisibles?: string;
  /** ¿La cuenta pedida está entre las que ve el token? */
  cuentaEnLista?: boolean;
  /** Quién es el token (me): el usuario de sistema. */
  usuario?: { id?: string; nombre?: string };
  /** Las cuentas de WhatsApp asignadas al usuario del token (me/assigned_whatsapp_business_accounts), si Meta deja preguntarlo. */
  asignadas?: { id: string; nombre?: string }[];
  errorAsignadas?: string;
}

/** Por qué Meta rechaza: pregunta cuáles permisos tiene el token y si la cuenta se puede leer. Nunca tira. */
export async function diagnosticarWhatsapp(pedir: PedirAMeta, cuenta: string): Promise<DiagnosticoWhatsapp> {
  let permisos: string[] | null = null;
  try {
    const j = (await pedir("me/permissions", {})) as { data?: { permission?: string; status?: string }[] } | null;
    permisos = (j?.data ?? []).filter((x) => x.status === "granted" && x.permission).map((x) => x.permission as string).sort();
  } catch { /* algunos tokens no lo dejan leer */ }
  const d: DiagnosticoWhatsapp = { permisos, cuentaLeible: false };
  try {
    const j = (await pedir(cuenta, { fields: "id,name" })) as { name?: string } | null;
    d.cuentaLeible = true;
    if (j?.name) d.nombre = j.name;
  } catch (e) { d.errorCuenta = e instanceof Error ? e.message : String(e); }
  if (permisos) d.faltaPermiso = !permisos.includes("whatsapp_business_management");
  /* Qué cuentas de WhatsApp ve el token en el portfolio: propias y compartidas. */
  const negocio = process.env.META_BUSINESS_ID?.trim() || BUSINESS_POR_DEFECTO;
  const vistas = new Map<string, { id: string; nombre?: string }>();
  for (const borde of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
    try {
      const j = (await pedir(`${negocio}/${borde}`, { fields: "id,name", limit: "100" })) as { data?: { id?: string; name?: string }[] } | null;
      for (const x of j?.data ?? []) if (x.id) vistas.set(x.id, { id: x.id, ...(x.name ? { nombre: x.name } : {}) });
    } catch (e) { d.errorCuentasVisibles = `${borde}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300); }
  }
  if (vistas.size) { d.cuentasVisibles = [...vistas.values()]; d.cuentaEnLista = vistas.has(cuenta); }
  try {
    const yo = (await pedir("me", { fields: "id,name" })) as { id?: string; name?: string } | null;
    if (yo) d.usuario = { ...(yo.id ? { id: yo.id } : {}), ...(yo.name ? { nombre: yo.name } : {}) };
  } catch { /* se sigue */ }
  try {
    const j = (await pedir("me/assigned_whatsapp_business_accounts", { fields: "id,name", limit: "100" })) as { data?: { id?: string; name?: string }[] } | null;
    const lista = (j?.data ?? []).filter((x) => x.id).map((x) => ({ id: x.id as string, ...(x.name ? { nombre: x.name } : {}) }));
    if (lista.length) d.asignadas = lista;
  } catch (e) { d.errorAsignadas = (e instanceof Error ? e.message : String(e)).slice(0, 300); }
  return d;
}

/** Trae de Meta y guarda en `whatsapp_costos`. Nunca tira: devuelve el error de cada cuenta para dejarlo en el estado del cron. */
export async function sincronizarCostosWhatsapp(
  db: SupabaseClient, pedir: PedirAMeta, cuentas: readonly string[], desde: string, hasta: string,
): Promise<ResultadoCostosWhatsapp[]> {
  const salida: ResultadoCostosWhatsapp[] = [];
  for (const cuenta of cuentas) {
    const base = { cuenta, dias: 0, total: 0, moneda: "USD", descartados: 0, desde, hasta };
    try {
      const t = await traerCostosWhatsapp(pedir, cuenta, desde, hasta);
      if (t.filas.length) {
        const r = await db.from("whatsapp_costos").upsert(
          t.filas.map((f) => ({ ...f, actualizadoEn: new Date().toISOString() })), { onConflict: "dia,cuenta,categoria", defaultToNull: false },
        );
        if (r.error) {
          const falta = /whatsapp_costos|schema cache|does not exist/i.test(r.error.message);
          throw new Error(falta ? "Falta correr supabase/whatsapp-costos.sql en la base." : r.error.message);
        }
      }
      const dias = new Set(t.filas.map((f) => f.dia)).size;
      salida.push({ ...base, dias, total: Math.round(t.filas.reduce((a, f) => a + f.costo, 0) * 100) / 100, moneda: t.moneda,
        ...(t.monedaSupuesta ? { monedaSupuesta: true } : {}), descartados: t.descartados });
    } catch (e) {
      const permisos = e instanceof ErrorMetaWhatsapp && (e.codigo === 10 || e.codigo === 100 || e.codigo === 200 || e.codigo === 190);
      salida.push({ ...base, error: pistaDelError(e), ...(permisos ? { diagnostico: await diagnosticarWhatsapp(pedir, cuenta) } : {}) });
    }
  }
  return salida;
}
