import { NextResponse } from "next/server";
import { completarLlamadas } from "@/lib/agendas-sync";
import { hayCalendly, type EventoCalendly, type InvitadoCalendly } from "@/lib/calendly";
import { firmaCalendlyValida } from "@/lib/calendly-firma";
import { ingresarInvitado } from "@/lib/calendly-sync";
import { hayServidor } from "@/lib/servidor";

/* ==================================================================
   Webhook de Calendly: cada agenda, cancelación o no-show en segundos.

   Nuestra propia suscripción, aparte de la de Santi, la del CRM viejo, las
   de Zapier y las de ActiveCampaign: Calendly avisa a todas.

   Puerta de entrada: la firma de Calendly (`Calendly-Webhook-Signature:
   t=<segundos>,v1=<hmac de "t.cuerpo">`, el mismo formato que Stripe), con
   la clave que pusimos al crear la suscripción. Sin clave configurada no se
   acepta nada: esta URL escribe contactos y leads.

   El aviso es sólo el pitido: el invitado y el evento se le vuelven a pedir
   a la API con nuestro token.

   Se contesta 200 aunque falle el guardado: con un error, Calendly reintenta
   y termina desactivando la suscripción. Lo que no entró, lo repesca el cron
   de /api/cron/calendly.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(peticion: Request) {
  const clave = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  const cuerpo = await peticion.text();
  if (!clave || !firmaCalendlyValida(cuerpo, peticion.headers.get("calendly-webhook-signature"), clave)) {
    return NextResponse.json({ error: "Aviso sin firma válida." }, { status: 401 });
  }

  let aviso: { event?: string; payload?: Record<string, unknown> } = {};
  try { aviso = JSON.parse(cuerpo); } catch { /* sin cuerpo legible no hay nada que guardar */ }
  const tipo = aviso.event ?? "";
  const payload = aviso.payload ?? {};

  /* invitee.created / invitee.canceled traen el invitado entero; los de
     no-show traen sólo su URI. En los dos casos se relee por API. */
  const uri = tipo.startsWith("invitee_no_show.")
    ? (payload.invitee as string | undefined)
    : (payload.uri as string | undefined);
  if (!uri || !/^invitee(\.|_no_show\.)/.test(tipo)) {
    return NextResponse.json({ ok: true, ignorado: tipo || "sin tipo" });
  }

  try {
    const r = await ingresarInvitado(uri, {
      invitado: payload.email ? (payload as unknown as InvitadoCalendly) : undefined,
      evento: payload.scheduled_event as EventoCalendly | undefined,
    });
    /* En el momento: las llamadas del webinar se recalculan ya (no en la
       vuelta del cron), y Realtime le avisa a las pantallas abiertas. */
    const l = await completarLlamadas().catch(() => ({ actualizados: 0, errores: [] as string[] }));
    console.log("[calendly/webhook]", JSON.stringify({ tipo, ...r, webinars: l.actualizados }));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo guardar la agenda.";
    console.error("[calendly/webhook] fallo:", tipo, error);
    return NextResponse.json({ ok: false, error });
  }
}

/* Para comprobar desde afuera que la ruta existe y tiene lo que necesita,
   sin exponer nada: sólo si están las tres piezas. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    listo: hayServidor && hayCalendly() && Boolean(process.env.CALENDLY_WEBHOOK_SIGNING_KEY),
  });
}
