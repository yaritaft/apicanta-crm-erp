import { createHmac, timingSafeEqual } from "node:crypto";
import type { ModoContrato } from "./contratos";

/* ==================================================================
   La API de PandaDoc del lado del servidor (developers.pandadoc.com).
   Las claves viven en Vercel (sensibles) y nunca llegan al navegador:

   - PANDADOC_API_KEY: la de producción. Se usa sólo en la app publicada
     (VERCEL_ENV=production): en local o en una versión de prueba nunca
     puede salir un contrato real.
   - PANDADOC_SANDBOX_KEY: la de prueba. Manda sólo a mails del dominio de
     la cuenta y con marca de agua; ve el mismo espacio que la de producción.

   Cada contrato sabe con qué clave se hizo (`modo`), y todo lo que se le
   hace después va con esa misma.
   ================================================================== */

const API = "https://api.pandadoc.com/public/v1";
const ESPERA_MS = 15_000;

/** La clave de ese modo en este entorno. Sin modo: la que corresponde al entorno (producción en la app publicada). */
export function clavePandadoc(modo?: ModoContrato): { clave: string; modo: ModoContrato } | null {
  const enProduccion = process.env.VERCEL_ENV === "production";
  const prod = enProduccion && process.env.PANDADOC_API_KEY ? process.env.PANDADOC_API_KEY : null;
  const prueba = process.env.PANDADOC_SANDBOX_KEY || null;
  if (modo === "produccion") return prod ? { clave: prod, modo } : null;
  if (modo === "prueba") return prueba ? { clave: prueba, modo } : null;
  if (enProduccion) return prod ? { clave: prod, modo: "produccion" } : null;
  return prueba ? { clave: prueba, modo: "prueba" } : null;
}

/** Un error de PandaDoc, con un texto propio (el de PandaDoc va aparte, para el registro). */
export class ErrorPandadoc extends Error {
  constructor(public status: number, mensaje: string, public detalle = "") { super(mensaje); }
}

async function pd(modo: ModoContrato, ruta: string, init: RequestInit = {}): Promise<Response> {
  const c = clavePandadoc(modo);
  if (!c) {
    throw new ErrorPandadoc(503, modo === "prueba"
      ? "Falta la clave de prueba de PandaDoc (PANDADOC_SANDBOX_KEY) en este entorno."
      : "Falta la clave de PandaDoc de producción (PANDADOC_API_KEY), o esto no es la app publicada.");
  }
  try {
    return await fetch(`${API}${ruta}`, {
      ...init, cache: "no-store", signal: AbortSignal.timeout(ESPERA_MS),
      headers: { Authorization: `API-Key ${c.clave}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    const tiempo = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ErrorPandadoc(504, tiempo ? "PandaDoc no contestó a tiempo." : "No se pudo hablar con PandaDoc.");
  }
}

async function json<T = Record<string, unknown>>(r: Response, que: string): Promise<T> {
  const cuerpo = await r.json().catch(() => null) as T & { detail?: unknown; type?: string } | null;
  if (!r.ok) {
    const detalle = typeof cuerpo?.detail === "string" ? cuerpo.detail : JSON.stringify(cuerpo?.detail ?? cuerpo ?? "").slice(0, 300);
    const texto = r.status === 401 || r.status === 403 ? "PandaDoc no acepta la clave."
      : r.status === 404 ? "PandaDoc no encuentra el documento."
      : r.status === 409 ? "PandaDoc no deja hacer eso con el documento en este estado."
      : r.status === 429 ? "PandaDoc pidió esperar un poco: probá de nuevo en un minuto."
      : `PandaDoc contestó ${r.status} al ${que}.`;
    throw new ErrorPandadoc(r.status, texto, detalle);
  }
  return (cuerpo ?? {}) as T;
}

/* ---------- Documentos ---------- */

export async function crearDocumento(modo: ModoContrato, cuerpo: Record<string, unknown>): Promise<{ id: string; status: string }> {
  const j = await json<{ id?: string; status?: string }>(await pd(modo, "/documents", { method: "POST", body: JSON.stringify(cuerpo) }), "crear el contrato");
  if (!j.id) throw new ErrorPandadoc(502, "PandaDoc no devolvió el documento.");
  return { id: j.id, status: j.status ?? "" };
}

export async function estadoDocumento(modo: ModoContrato, id: string): Promise<string> {
  const j = await json<{ status?: string }>(await pd(modo, `/documents/${encodeURIComponent(id)}`), "pedir el estado");
  return j.status ?? "";
}

/** Recién creado, el documento tarda unos segundos en pasar a borrador (antes no se puede mandar). */
export async function esperarBorrador(modo: ModoContrato, id: string, topeMs = 30_000): Promise<string> {
  const hasta = Date.now() + topeMs;
  let estado = "";
  while (Date.now() < hasta) {
    estado = await estadoDocumento(modo, id);
    if (estado && estado !== "document.uploaded") return estado;
    await new Promise((listo) => setTimeout(listo, 1500));
  }
  return estado;
}

/** El detalle de una plantilla: sus roles, sus variables y sus campos (con su «merge field»). */
export async function detallePlantilla(modo: ModoContrato, id: string): Promise<Record<string, unknown>> {
  return json(await pd(modo, `/templates/${encodeURIComponent(id)}/details`), "leer la plantilla");
}

export async function detalleDocumento(modo: ModoContrato, id: string): Promise<Record<string, unknown>> {
  return json(await pd(modo, `/documents/${encodeURIComponent(id)}/details`), "pedir el detalle");
}

export async function mandarDocumento(modo: ModoContrato, id: string, mail: { subject: string; message: string }): Promise<void> {
  await json(await pd(modo, `/documents/${encodeURIComponent(id)}/send`, {
    method: "POST", body: JSON.stringify({ ...mail, silent: false }),
  }), "mandar el contrato");
}

/** El link para firmar (una sesión de firma del destinatario). Sólo con el documento enviado. */
export async function enlaceDeFirma(modo: ModoContrato, id: string, email: string, segundos = 60 * 60 * 24 * 30): Promise<{ enlace: string; vence: string }> {
  const j = await json<{ id?: string; expires_at?: string }>(await pd(modo, `/documents/${encodeURIComponent(id)}/session`, {
    method: "POST", body: JSON.stringify({ recipient: email, lifetime: segundos }),
  }), "pedir el link para firmar");
  if (!j.id) throw new ErrorPandadoc(502, "PandaDoc no devolvió el link.");
  return { enlace: `https://app.pandadoc.com/s/${j.id}`, vence: j.expires_at ?? new Date(Date.now() + segundos * 1000).toISOString() };
}

/** Le vuelve a llegar el mail para firmar (recordatorio manual) a quien todavía no firmó. */
export async function recordarDocumento(modo: ModoContrato, id: string, recipientIds: string[]): Promise<void> {
  await json(await pd(modo, `/documents/${encodeURIComponent(id)}/send-reminder`, {
    method: "POST", body: JSON.stringify({ reminders: recipientIds.map((recipient_id) => ({ recipient_id })) }),
  }), "reenviar el contrato");
}

/** Anular: PandaDoc lo pasa a «vencido» (código 11). Un firmado no se puede anular. */
export async function anularDocumento(modo: ModoContrato, id: string, nota: string): Promise<void> {
  const r = await pd(modo, `/documents/${encodeURIComponent(id)}/status`, {
    method: "PATCH", body: JSON.stringify({ status: 11, note: nota, notify_recipients: false }),
  });
  if (r.status !== 204) await json(r, "anular el contrato");
}

/** Vuelve a borrador para corregirlo (las firmas se borran; hay que mandarlo de nuevo). */
export async function aBorrador(modo: ModoContrato, id: string): Promise<void> {
  await json(await pd(modo, `/documents/${encodeURIComponent(id)}/draft`, { method: "POST" }), "volver el contrato a borrador");
}

/** Cambia variables, destinatarios o metadata de un documento en borrador. */
export async function actualizarDocumento(modo: ModoContrato, id: string, cambios: Record<string, unknown>): Promise<void> {
  const r = await pd(modo, `/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(cambios) });
  if (r.status !== 204) await json(r, "corregir el contrato");
}

/** El PDF. Con la clave de producción y el documento firmado, el «protegido» (con su certificado). */
export async function pdfDocumento(modo: ModoContrato, id: string, firmado: boolean): Promise<ArrayBuffer> {
  const ruta = modo === "produccion" && firmado ? "download-protected" : "download";
  const r = await pd(modo, `/documents/${encodeURIComponent(id)}/${ruta}`);
  if (!r.ok) await json(r, "bajar el PDF");
  return r.arrayBuffer();
}

/* ---------- El aviso (webhook) ---------- */

export const EVENTOS_AVISO = ["document_state_changed", "recipient_completed", "document_deleted"];

export async function crearSuscripcion(modo: ModoContrato, url: string): Promise<{ id: string; clave: string }> {
  const j = await json<{ uuid?: string; shared_key?: string }>(await pd(modo, "/webhook-subscriptions", {
    method: "POST",
    body: JSON.stringify({ name: `Apicanta ERP (${modo})`, url, active: true, payload: ["metadata"], triggers: EVENTOS_AVISO }),
  }), "crear la suscripción al aviso");
  if (!j.uuid || !j.shared_key) throw new ErrorPandadoc(502, "PandaDoc no devolvió la suscripción con su clave.");
  return { id: j.uuid, clave: j.shared_key };
}

export async function borrarSuscripcion(modo: ModoContrato, id: string): Promise<void> {
  const r = await pd(modo, `/webhook-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) await json(r, "borrar la suscripción");
}

/** PandaDoc firma el cuerpo CRUDO con HMAC-SHA256 y lo manda en ?signature= (hex). Vale cualquiera de las claves. */
export function firmaPandadocValida(cuerpo: string, firma: string | null, claves: string[]): boolean {
  if (!firma || !/^[0-9a-f]{64}$/i.test(firma)) return false;
  const dada = Buffer.from(firma, "hex");
  return claves.filter(Boolean).some((clave) => {
    const esperada = createHmac("sha256", clave).update(cuerpo).digest();
    return esperada.length === dada.length && timingSafeEqual(esperada, dada);
  });
}
