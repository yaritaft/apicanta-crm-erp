/* Conexión con Meta Ads.

   El App Secret vive sólo en el servidor y el token de acceso viaja en
   una cookie httpOnly: nunca pasa por la URL ni por el JavaScript del
   navegador. Lo único que el cliente recibe son los datos ya leídos. */

export const GRAPH = "https://graph.facebook.com/v25.0";
export const DIALOGO = "https://www.facebook.com/v25.0/dialog/oauth";

export const COOKIE_TOKEN = "apicanta_meta_token";
export const COOKIE_ESTADO = "apicanta_meta_state";

/* Lo mínimo para leer campañas y resultados. Nada de escribir. */
export const PERMISOS = ["ads_read", "business_management"].join(",");

/* Dos formas de hablar con Meta, en este orden:

   1. META_SYSTEM_TOKEN — un token de usuario del sistema generado en el
      Business Manager. Es el camino correcto cuando el negocio es dueño
      de la app: no vence, no hay que loguearse y sirve para tareas
      programadas. Meta directamente no deja usar OAuth en ese caso.
   2. El flujo OAuth con cookie, para cuando la app es de un tercero. */

export const tokenDeSistema = () => process.env.META_SYSTEM_TOKEN?.trim() || null;

export const oauthConfigurado = () =>
  Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);

export const metaConfigurado = () => Boolean(tokenDeSistema()) || oauthConfigurado();

/** El token a usar: el del sistema si está, y si no el de la cookie. */
export function tokenDeLaPeticion(req: Request): string | null {
  const sistema = tokenDeSistema();
  if (sistema) return sistema;
  return req.headers.get("cookie")?.match(new RegExp(`${COOKIE_TOKEN}=([^;]+)`))?.[1] ?? null;
}

export function urlRedireccion(origen: string) {
  return `${origen}/api/meta/callback`;
}

export interface CuentaMeta { id: string; nombre: string; moneda: string; estado: number }

export async function traerCuentas(token: string): Promise<CuentaMeta[]> {
  const u = new URL(`${GRAPH}/me/adaccounts`);
  u.searchParams.set("fields", "account_id,name,currency,account_status");
  u.searchParams.set("limit", "100");
  u.searchParams.set("access_token", token);

  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(await textoDeError(r));
  const j = (await r.json()) as { data?: { account_id: string; name: string; currency: string; account_status: number }[] };
  return (j.data ?? []).map((c) => ({
    id: c.account_id, nombre: c.name, moneda: c.currency, estado: c.account_status,
  }));
}

export interface CampaniaMeta {
  id: string; nombre: string; objetivo: string; estado: string;
  inversion: number; impresiones: number; clicks: number; leads: number;
  /* Las metricas que Meta calcula. Se piden en vez de derivarlas porque sus
     definiciones no son las obvias: el CTR de Meta sale sobre impresiones
     servidas, y redondea distinto. Si las calculara yo, la tabla no le
     cerraria contra el Ads Manager y no hay peor numero que uno que discute
     con la fuente. */
  ctr: number; cpm: number; cpc: number;
  /* `clicks` son TODOS los clicks — incluye likes, comentarios, ver mas.
     `clicksEnlace` son los que se fueron a la landing, que es lo que
     importa para el embudo. Meta los reporta por separado a proposito. */
  clicksEnlace: number; ctrEnlace: number; costoPorClickEnlace: number;
  /* Personas distintas alcanzadas, y cuantas veces vio el anuncio cada una.
     Una frecuencia alta con CTR cayendo es fatiga de creativo. */
  alcance: number; frecuencia: number;
  desde?: string; hasta?: string;
  /* Qué tipos de conversión reportó Meta y cuál se usó para contar leads.
     Sirve para entender de dónde sale el número sin adivinar. */
  acciones?: Record<string, number>;
  tipoDeLead?: string;
}

/* Meta reporta la misma conversión bajo varios nombres a la vez. Para el
   embudo de Hackear IT (anuncio → landing → formulario propio) la que vale
   es la del pixel: `fb_pixel_complete_registration`. Las demás quedan como
   respaldo, en orden de preferencia.

   Importante: se toma la PRIMERA que exista, no la suma ni el máximo. Sumar
   duplicaría la misma conversión, y el máximo puede colarse con una métrica
   de otra cosa (una conversación de WhatsApp no es un registro al webinar). */
const TIPOS_DE_LEAD = [
  "offsite_conversion.fb_pixel_complete_registration",
  "omni_complete_registration",
  "complete_registration",
  "offsite_complete_registration_add_meta_leads",
  /* Formulario nativo de Meta, para campañas armadas de esa forma */
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
];

/* Lo que se le pide a cada campania. Son los mismos nombres que usa el Ads
   Manager, para que las columnas de la tabla le cierren fila por fila. */
const CAMPOS_INSIGHTS = [
  "spend", "impressions", "clicks", "ctr", "cpm", "cpc",
  "inline_link_clicks", "inline_link_click_ctr", "cost_per_inline_link_click",
  "reach", "frequency", "actions",
].join(",");

export async function traerCampanias(token: string, cuentaId: string, desde: string, hasta: string): Promise<CampaniaMeta[]> {
  const u = new URL(`${GRAPH}/act_${cuentaId.replace(/^act_/, "")}/campaigns`);
  u.searchParams.set("fields", [
    "name", "objective", "status", "start_time", "stop_time",
    `insights.time_range({"since":"${desde}","until":"${hasta}"}){${CAMPOS_INSIGHTS}}`,
  ].join(","));
  u.searchParams.set("limit", "200");
  u.searchParams.set("access_token", token);

  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(await textoDeError(r));

  const j = (await r.json()) as {
    data?: {
      id: string; name: string; objective?: string; status?: string;
      start_time?: string; stop_time?: string;
      insights?: { data?: {
        spend?: string; impressions?: string; clicks?: string;
        ctr?: string; cpm?: string; cpc?: string;
        inline_link_clicks?: string; inline_link_click_ctr?: string; cost_per_inline_link_click?: string;
        reach?: string; frequency?: string;
        actions?: { action_type: string; value: string }[];
      }[] };
    }[];
  };

  return (j.data ?? []).map((c) => {
    const ins = c.insights?.data?.[0];
    /* Meta reporta los leads dentro de `actions`, con distintos nombres
       según cómo esté configurada la campaña. */
    const acciones = Object.fromEntries(
      (ins?.actions ?? []).map((a) => [a.action_type, Number(a.value || 0)]),
    );
    const tipoUsado = TIPOS_DE_LEAD.find((t) => acciones[t] !== undefined);
    const leads = tipoUsado ? acciones[tipoUsado] : 0;

    return {
      id: c.id,
      nombre: c.name,
      objetivo: c.objective ?? "",
      estado: (c.status ?? "").toLowerCase(),
      inversion: n(ins?.spend),
      impresiones: n(ins?.impressions),
      clicks: n(ins?.clicks),
      leads,
      ctr: n(ins?.ctr),
      cpm: n(ins?.cpm),
      cpc: n(ins?.cpc),
      clicksEnlace: n(ins?.inline_link_clicks),
      ctrEnlace: n(ins?.inline_link_click_ctr),
      costoPorClickEnlace: n(ins?.cost_per_inline_link_click),
      alcance: n(ins?.reach),
      frecuencia: n(ins?.frequency),
      desde: c.start_time,
      hasta: c.stop_time,
      acciones,
      tipoDeLead: tipoUsado,
    };
  });
}

/* Meta manda los numeros como string, y omite el campo entero cuando la
   campania no tuvo ese evento. Sin esto, un `undefined` se vuelve NaN y
   contamina cualquier suma de la tabla. */
const n = (v: string | undefined) => Number(v ?? 0) || 0;

async function textoDeError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: { message?: string } };
    return j.error?.message ?? `Meta respondió ${r.status}`;
  } catch {
    return `Meta respondió ${r.status}`;
  }
}

/* ---------------- Jerarquía completa ----------------

   campaigns → adsets → ads, y aparte los insights por anuncio y por día.

   Van separados a propósito: la estructura cambia poco y los números cambian
   todos los días. Pedirlos juntos obligaría a traer toda la jerarquía cada vez
   que se quiere refrescar el gasto de ayer. */

/* Meta pagina TODO. Con 4.522 anuncios y 6.809 días de spend, quedarse con la
   primera página no da error: devuelve un número más chico, que es peor que
   fallar — nadie se entera de que el dato está cortado.

   El tope de vueltas es un cinturón: si `paging.next` alguna vez apunta a sí
   mismo, el bucle termina igual en vez de colgar la pantalla. */
async function traerTodo<T>(u: URL, token: string, tope = 300): Promise<T[]> {
  u.searchParams.set("access_token", token);
  const out: T[] = [];
  let siguiente: string | null = u.toString();
  let vueltas = 0;

  while (siguiente && vueltas < tope) {
    const r = await fetch(siguiente, { cache: "no-store" });
    if (!r.ok) throw new Error(await textoDeError(r));
    const j = (await r.json()) as { data?: T[]; paging?: { next?: string } };
    out.push(...(j.data ?? []));
    siguiente = j.paging?.next ?? null;
    vueltas++;
  }
  return out;
}

const act = (cuentaId: string) => `act_${cuentaId.replace(/^act_/, "")}`;

export interface CampaignMeta { id: string; nombre: string; objetivo: string; estado: string; desde?: string; hasta?: string }
export interface AdsetMeta { id: string; campaignId: string; nombre: string; estado: string; desde?: string; hasta?: string }
export interface AdMeta { id: string; adsetId: string; campaignId: string; nombre: string; estado: string }

export interface JerarquiaMeta {
  campaigns: CampaignMeta[];
  adsets: AdsetMeta[];
  ads: AdMeta[];
}

export async function traerJerarquia(token: string, cuentaId: string): Promise<JerarquiaMeta> {
  const pedir = (edge: string, fields: string) => {
    const u = new URL(`${GRAPH}/${act(cuentaId)}/${edge}`);
    u.searchParams.set("fields", fields);
    u.searchParams.set("limit", "500");
    return u;
  };

  /* Las tres en paralelo: no dependen entre sí, y en serie esto tarda el
     triple para no ganar nada. */
  const [campaigns, adsets, ads] = await Promise.all([
    traerTodo<{ id: string; name: string; objective?: string; status?: string; start_time?: string; stop_time?: string }>(
      pedir("campaigns", "name,objective,status,start_time,stop_time"), token),
    traerTodo<{ id: string; name: string; campaign_id: string; status?: string; start_time?: string; end_time?: string }>(
      pedir("adsets", "name,campaign_id,status,start_time,end_time"), token),
    traerTodo<{ id: string; name: string; adset_id: string; campaign_id: string; status?: string }>(
      pedir("ads", "name,adset_id,campaign_id,status"), token),
  ]);

  return {
    campaigns: campaigns.map((c) => ({
      id: c.id, nombre: c.name, objetivo: c.objective ?? "",
      estado: (c.status ?? "").toLowerCase(), desde: c.start_time, hasta: c.stop_time,
    })),
    adsets: adsets.map((a) => ({
      id: a.id, campaignId: a.campaign_id, nombre: a.name,
      estado: (a.status ?? "").toLowerCase(), desde: a.start_time, hasta: a.end_time,
    })),
    ads: ads.map((a) => ({
      id: a.id, adsetId: a.adset_id, campaignId: a.campaign_id,
      nombre: a.name, estado: (a.status ?? "").toLowerCase(),
    })),
  };
}

export interface InsightDia {
  adId: string;
  dia: string;
  inversion: number; impresiones: number; clicks: number; leads: number;
  alcance: number; frecuencia: number;
  ctr: number; cpm: number; cpc: number;
  clicksEnlace: number; ctrEnlace: number; costoPorClickEnlace: number;
  acciones: Record<string, number>;
  tipoDeLead?: string;
}

/* Una fila por anuncio y por día.

   `level=ad` + `time_increment=1` es lo que abre el desglose diario. Sin el
   time_increment, Meta devuelve UN total por el rango entero — que es
   exactamente lo que teníamos y lo que impedía que el filtro de fechas
   recortara el gasto. */
export async function traerInsightsDiarios(
  token: string, cuentaId: string, desde: string, hasta: string,
): Promise<InsightDia[]> {
  const u = new URL(`${GRAPH}/${act(cuentaId)}/insights`);
  u.searchParams.set("level", "ad");
  u.searchParams.set("time_increment", "1");
  u.searchParams.set("time_range", JSON.stringify({ since: desde, until: hasta }));
  u.searchParams.set("fields", `ad_id,date_start,${CAMPOS_INSIGHTS}`);
  u.searchParams.set("limit", "500");

  const filas = await traerTodo<{
    ad_id: string; date_start: string;
    spend?: string; impressions?: string; clicks?: string;
    ctr?: string; cpm?: string; cpc?: string;
    inline_link_clicks?: string; inline_link_click_ctr?: string; cost_per_inline_link_click?: string;
    reach?: string; frequency?: string;
    actions?: { action_type: string; value: string }[];
  }>(u, token);

  return filas.map((f) => {
    const acciones = Object.fromEntries((f.actions ?? []).map((a) => [a.action_type, Number(a.value || 0)]));
    const tipoUsado = TIPOS_DE_LEAD.find((t) => acciones[t] !== undefined);
    return {
      adId: f.ad_id,
      dia: f.date_start,
      inversion: n(f.spend),
      impresiones: n(f.impressions),
      clicks: n(f.clicks),
      leads: tipoUsado ? acciones[tipoUsado] : 0,
      alcance: n(f.reach),
      frecuencia: n(f.frequency),
      ctr: n(f.ctr),
      cpm: n(f.cpm),
      cpc: n(f.cpc),
      clicksEnlace: n(f.inline_link_clicks),
      ctrEnlace: n(f.inline_link_click_ctr),
      costoPorClickEnlace: n(f.cost_per_inline_link_click),
      acciones,
      tipoDeLead: tipoUsado,
    };
  });
}
