import {
  cruzarProductosWisboo, leerBotTelegram, leerCuentaPandadoc, leerPlantillasPandadoc, leerProductosWisboo,
  leerReunionesZoom, leerWebhookTelegram,
  type EstadoConexion, type PlantillaPandadoc, type ProductoWisboo, type ReunionZoom, type WebhookTelegram,
} from "./accesos-alumnos";

/* ==================================================================
   Accesos de alumnos del lado del servidor: las claves de Telegram,
   Wisboo, PandaDoc y Zoom viven en Vercel (sensibles) y nunca llegan al
   navegador. Por ahora sólo se PRUEBAN: cada «probar» lee y no cambia
   nada en ningún servicio (ni siquiera conecta el bot).

   PandaDoc tiene dos claves: la de producción (PANDADOC_API_KEY) se usa
   sólo en la app publicada; en local y en las versiones de prueba se usa
   la sandbox (PANDADOC_SANDBOX_KEY), que manda contratos únicamente a
   mails del dominio de la cuenta y con marca de agua. Así una prueba
   nunca le manda un contrato real a un alumno.
   ================================================================== */

const ESPERA_MS = 10_000;

/* Un error de red puede traer la dirección pedida, y la de Telegram lleva
   el token adentro: hacia afuera sale sólo un texto propio. */
function fallo(servicio: string, e: unknown): string {
  const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
  return tiempo ? `${servicio} no contestó a tiempo.` : `No se pudo hablar con ${servicio}.`;
}

async function pedirJson(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const r = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/* ---------- Telegram ---------- */

export interface PruebaTelegram {
  estado: EstadoConexion; error?: string;
  bot?: { usuario: string; nombre: string };
  webhook?: WebhookTelegram;
}

export async function probarTelegram(nuestraBase: string): Promise<PruebaTelegram> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { estado: "falta" };
  const api = `https://api.telegram.org/bot${token}`;
  try {
    const me = await pedirJson(`${api}/getMe`, {});
    const bot = leerBotTelegram(me.json);
    if (!bot) return { estado: "error", error: me.status === 401 || me.status === 404 ? "Telegram no reconoce el token." : "Telegram no devolvió el bot." };
    const info = await pedirJson(`${api}/getWebhookInfo`, {});
    return { estado: "ok", bot, webhook: leerWebhookTelegram(info.json, nuestraBase) };
  } catch (e) { return { estado: "error", error: fallo("Telegram", e) }; }
}

/* ---------- Wisboo ---------- */

export interface PruebaWisboo {
  estado: EstadoConexion; error?: string; falta?: string[];
  total?: number;
  programas?: { id: string; nombre: string; enWisboo: ProductoWisboo | null }[];
  otros?: ProductoWisboo[];
}

const TOPE_PAGINAS_WISBOO = 5;

export async function probarWisboo(): Promise<PruebaWisboo> {
  const clave = process.env.WISBOO_API_KEY, tienda = process.env.WISBOO_STORE_ID;
  const falta = [!clave && "WISBOO_API_KEY", !tienda && "WISBOO_STORE_ID"].filter((x): x is string => Boolean(x));
  if (falta.length) return { estado: "falta", falta };
  try {
    const productos: ProductoWisboo[] = [];
    let total: number | null = null;
    for (let pagina = 1; pagina <= TOPE_PAGINAS_WISBOO; pagina++) {
      const r = await pedirJson(
        `https://api.wisboo.com/v1/stores/${encodeURIComponent(tienda!)}/products?page=${pagina}&size=100`,
        { headers: { Authorization: `Bearer ${clave}` } },
      );
      if (r.status === 401) return { estado: "error", error: "Wisboo no acepta la clave (o no es de esta tienda)." };
      if (r.status === 403) return { estado: "error", error: "Wisboo dice que la API pública no está habilitada en la cuenta." };
      if (r.status === 404) return { estado: "error", error: "Wisboo no encuentra la tienda: revisá WISBOO_STORE_ID." };
      if (r.status >= 400) return { estado: "error", error: `Wisboo contestó ${r.status}.` };
      const leida = leerProductosWisboo(r.json);
      productos.push(...leida.productos);
      total = leida.total;
      if (leida.productos.length < 100 || (total !== null && productos.length >= total)) break;
    }
    const programas = cruzarProductosWisboo(productos);
    const usados = new Set(programas.map((p) => p.id));
    return { estado: "ok", total: total ?? productos.length, programas, otros: productos.filter((p) => !usados.has(p.id)) };
  } catch (e) { return { estado: "error", error: fallo("Wisboo", e) }; }
}

/* ---------- PandaDoc ---------- */

export type ModoPandadoc = "produccion" | "prueba";

/** La clave que corresponde a este entorno: producción sólo en la app publicada. */
export function clavePandadoc(): { clave: string; modo: ModoPandadoc } | null {
  if (process.env.VERCEL_ENV === "production") {
    return process.env.PANDADOC_API_KEY ? { clave: process.env.PANDADOC_API_KEY, modo: "produccion" } : null;
  }
  return process.env.PANDADOC_SANDBOX_KEY ? { clave: process.env.PANDADOC_SANDBOX_KEY, modo: "prueba" } : null;
}

export interface PruebaPandadoc {
  estado: EstadoConexion; error?: string; modo?: ModoPandadoc;
  cuenta?: { email: string; espacio: string } | null;
  plantillas?: PlantillaPandadoc[];
}

export async function probarPandadoc(): Promise<PruebaPandadoc> {
  const c = clavePandadoc();
  if (!c) return { estado: "falta" };
  const cabeza = { headers: { Authorization: `API-Key ${c.clave}` } };
  try {
    const [yo, plantillas] = await Promise.all([
      pedirJson("https://api.pandadoc.com/public/v1/members/current", cabeza),
      pedirJson("https://api.pandadoc.com/public/v1/templates?count=100&page=1", cabeza),
    ]);
    if (yo.status === 401 || plantillas.status === 401) return { estado: "error", modo: c.modo, error: "PandaDoc no acepta la clave." };
    if (plantillas.status >= 400) return { estado: "error", modo: c.modo, error: `PandaDoc contestó ${plantillas.status} al pedir las plantillas.` };
    return { estado: "ok", modo: c.modo, cuenta: leerCuentaPandadoc(yo.json), plantillas: leerPlantillasPandadoc(plantillas.json) };
  } catch (e) { return { estado: "error", modo: c.modo, error: fallo("PandaDoc", e) }; }
}

/* ---------- Zoom ---------- */

export interface PruebaZoom { estado: EstadoConexion; error?: string; falta?: string[]; reuniones?: ReunionZoom[] }

/** El token de la app Server-to-Server OAuth (dura una hora; no se guarda). */
async function tokenZoom(): Promise<{ token: string } | { error: string }> {
  const cuenta = process.env.ZOOM_ACCOUNT_ID, id = process.env.ZOOM_CLIENT_ID, secreto = process.env.ZOOM_CLIENT_SECRET;
  const basico = Buffer.from(`${id}:${secreto}`).toString("base64");
  const r = await pedirJson(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(cuenta ?? "")}`,
    { method: "POST", headers: { Authorization: `Basic ${basico}` } },
  );
  const token = (r.json as { access_token?: unknown } | null)?.access_token;
  if (typeof token === "string" && token) return { token };
  return { error: r.status === 400 || r.status === 401 ? "Zoom no acepta las credenciales de la app (o la app no está activada)." : `Zoom contestó ${r.status} al pedir el token.` };
}

export async function probarZoom(): Promise<PruebaZoom> {
  const falta = (["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"] as const).filter((n) => !process.env[n]);
  if (falta.length) return { estado: "falta", falta: [...falta] };
  try {
    const t = await tokenZoom();
    if ("error" in t) return { estado: "error", error: t.error };
    const r = await pedirJson("https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=100", {
      headers: { Authorization: `Bearer ${t.token}` },
    });
    if (r.status >= 400) return { estado: "error", error: `Zoom contestó ${r.status} al pedir las reuniones: revisá los permisos de la app.` };
    return { estado: "ok", reuniones: leerReunionesZoom(r.json) };
  } catch (e) { return { estado: "error", error: fallo("Zoom", e) }; }
}
