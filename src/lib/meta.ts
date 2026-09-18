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

export async function traerCampanias(token: string, cuentaId: string, desde: string, hasta: string): Promise<CampaniaMeta[]> {
  const u = new URL(`${GRAPH}/act_${cuentaId.replace(/^act_/, "")}/campaigns`);
  u.searchParams.set("fields", [
    "name", "objective", "status", "start_time", "stop_time",
    `insights.time_range({"since":"${desde}","until":"${hasta}"}){spend,impressions,clicks,actions}`,
  ].join(","));
  u.searchParams.set("limit", "200");
  u.searchParams.set("access_token", token);

  const r = await fetch(u, { cache: "no-store" });
  if (!r.ok) throw new Error(await textoDeError(r));

  const j = (await r.json()) as {
    data?: {
      id: string; name: string; objective?: string; status?: string;
      start_time?: string; stop_time?: string;
      insights?: { data?: { spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[] }[] };
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
      inversion: Number(ins?.spend ?? 0),
      impresiones: Number(ins?.impressions ?? 0),
      clicks: Number(ins?.clicks ?? 0),
      leads,
      desde: c.start_time,
      hasta: c.stop_time,
      acciones,
      tipoDeLead: tipoUsado,
    };
  });
}

async function textoDeError(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { error?: { message?: string } };
    return j.error?.message ?? `Meta respondió ${r.status}`;
  } catch {
    return `Meta respondió ${r.status}`;
  }
}
