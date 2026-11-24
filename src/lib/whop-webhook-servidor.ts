import type { SupabaseClient } from "@supabase/supabase-js";

/* ==================================================================
   El aviso de pagos de Whop (webhook), conectado solo (Juan Cruz, 24/11:
   «configurá el webhook de Whop así entra al instante»).

   Igual que el aviso de PandaDoc y el bot de Telegram (api/cron/contratos):
   el cron de cada 5 minutos se fija si Whop tiene un webhook apuntando a
   /api/pasarelas/webhook/whop y, si no, lo crea con la clave del servidor
   (WHOP_API_KEY es «sensible» en Vercel: no sale de ahí). Si estaba apagado
   (Whop lo apaga tras 3 días de fallas), lo vuelve a prender.

   El aviso es sólo el pitido: la ruta trae los cobros de la API de Whop
   (lib/cobros-al-dia-servidor.ts) y nunca guarda lo que dice el cuerpo. Por
   eso no hace falta el secreto de firma que devuelve Whop: no se guarda.

   Queda anotado en pasarelas_estado (webhookId / webhookEn / webhookError).
   Si Whop no deja crearlo (la clave sin el permiso developer:manage_webhook),
   se reintenta cada 6 horas, no cada 5 minutos.
   ================================================================== */

export const RUTA_WEBHOOK_WHOP = "/api/pasarelas/webhook/whop";
export const EVENTOS_WEBHOOK_WHOP = ["payment.succeeded"];
const HORAS_ENTRE_INTENTOS = 6;

type Obj = Record<string, unknown>;

export interface WebhookWhop { id: string; url: string; enabled: boolean }

/** El webhook de la lista que apunta a esta app (cualquier token), o nada. */
export function webhookNuestro(lista: Obj[], base: string): WebhookWhop | undefined {
  const destino = `${base.replace(/\/$/, "")}${RUTA_WEBHOOK_WHOP}`;
  const w = lista.find((x) => typeof x.url === "string" && (x.url === destino || x.url.startsWith(`${destino}?`)));
  return w ? { id: String(w.id), url: String(w.url), enabled: w.enabled !== false } : undefined;
}

/** ¿Hay que intentar ahora? Con el webhook ya anotado, no; con un error reciente, recién a las 6 horas. */
export function tocaIntentar(fila: { webhookId?: string | null; webhookEn?: string | null; webhookError?: string | null } | null, ahora: number): boolean {
  if (fila?.webhookId) return false;
  if (!fila?.webhookError || !fila.webhookEn) return true;
  const t = Date.parse(fila.webhookEn);
  return !Number.isFinite(t) || ahora - t >= HORAS_ENTRE_INTENTOS * 3600_000;
}

/** El error de Whop en palabras: el 403 es casi siempre la clave sin permiso para webhooks. */
export function explicarErrorWhop(estado: number, mensaje: string): string {
  if (estado === 401) return `Whop no aceptó la clave (401): ${mensaje}`.slice(0, 400);
  if (estado === 403) return `La clave de Whop no tiene permiso para webhooks (hace falta developer:manage_webhook). Whop dijo: ${mensaje}`.slice(0, 400);
  return `Whop respondió ${estado}: ${mensaje}`.slice(0, 400);
}

async function whopApi(clave: string, metodo: string, ruta: string, cuerpo?: Obj): Promise<{ ok: boolean; estado: number; data: Obj }> {
  const r = await fetch(`https://api.whop.com/api/v1${ruta}`, {
    method: metodo, cache: "no-store",
    headers: { Authorization: `Bearer ${clave}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as Obj;
  return { ok: r.ok, estado: r.status, data };
}
const mensajeDe = (d: Obj) => String(d.message ?? (d.error as Obj | undefined)?.message ?? d.error ?? "sin detalle");

/** La empresa de Whop (biz_…): la dice el detalle de cualquier pago. Hace falta para listar los webhooks. */
async function empresaDeWhop(db: SupabaseClient, clave: string): Promise<string | undefined> {
  const m = await db.from("movimientos").select("referencia").eq("proveedor", "whop").order("fecha", { ascending: false }).limit(1);
  const ref = ((m.data ?? []) as { referencia?: string }[])[0]?.referencia;
  if (!ref) return undefined;
  const r = await whopApi(clave, "GET", `/payments/${encodeURIComponent(ref)}`);
  const c = (r.data.company ?? r.data.account) as Obj | undefined;
  return typeof c?.id === "string" ? c.id : undefined;
}

/** Se asegura de que Whop tenga el webhook de pagos apuntando a producción. Devuelve qué hizo, en palabras. Nunca rompe el cron. */
export async function asegurarWebhookDeWhop(db: SupabaseClient, ahora = Date.now()): Promise<string> {
  const clave = process.env.WHOP_API_KEY;
  const token = process.env.PASARELAS_WEBHOOK_TOKEN;
  const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV !== "production" || !dominio || !clave || !token) return "no corresponde";
  try {
    const fila = await db.from("pasarelas_estado").select("webhookId, webhookEn, webhookError").eq("proveedor", "whop").maybeSingle();
    if (fila.error) return `no se pudo leer: ${fila.error.message}`;
    if (!tocaIntentar(fila.data as never, ahora)) return fila.data?.webhookId ? "ya estaba" : "esperando para reintentar";

    const base = `https://${dominio}`;
    const anotar = (cambios: Obj) => db.from("pasarelas_estado").upsert({ proveedor: "whop", webhookEn: new Date(ahora).toISOString(), ...cambios }, { onConflict: "proveedor" });

    /* ¿Ya hay uno nuestro? (alguien lo creó a mano, o se creó y no se llegó a anotar): se usa ese, y si está apagado se prende. */
    const biz = await empresaDeWhop(db, clave);
    if (biz) {
      const l = await whopApi(clave, "GET", `/webhooks?account_id=${encodeURIComponent(biz)}&first=100`);
      if (l.ok) {
        const ya = webhookNuestro((l.data.data ?? []) as Obj[], base);
        if (ya) {
          if (!ya.enabled) {
            const p = await whopApi(clave, "PATCH", `/webhooks/${encodeURIComponent(ya.id)}`, { enabled: true });
            if (!p.ok) { await anotar({ webhookError: explicarErrorWhop(p.estado, mensajeDe(p.data)) }); return "estaba apagado y no se pudo prender"; }
          }
          await anotar({ webhookId: ya.id, webhookError: null });
          return ya.enabled ? "ya estaba en Whop" : "estaba apagado: prendido";
        }
      }
    }

    const c = await whopApi(clave, "POST", "/webhooks", {
      url: `${base}${RUTA_WEBHOOK_WHOP}?token=${encodeURIComponent(token)}`,
      events: EVENTOS_WEBHOOK_WHOP,
      enabled: true,
      title: "Apicanta ERP · cobros al instante",
      ...(biz ? { resource_id: biz } : {}),
    });
    if (!c.ok || typeof c.data.id !== "string") {
      const error = explicarErrorWhop(c.estado, mensajeDe(c.data));
      await anotar({ webhookError: error });
      console.warn(`[whop webhook] ${error}`);
      return "Whop no dejó crearlo";
    }
    await anotar({ webhookId: c.data.id, webhookError: null });
    console.info(`[whop webhook] conectado (${c.data.id})`);
    return "conectado";
  } catch (e) {
    console.error("[whop webhook] no se pudo conectar", e instanceof Error ? e.message : String(e));
    return "no se pudo";
  }
}
