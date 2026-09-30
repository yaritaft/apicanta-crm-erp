import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { firmaValida, guardarGrabacion, secretoWebhook } from "@/lib/fathom-servidor";

/* ==================================================================
   Lo que manda Fathom cuando una reunión está lista: el link, el
   resumen, los accionables y la transcripción. Si es de una llamada de
   Calendly, se guarda en `grabaciones` atada a ella (lib/fathom-servidor);
   si no (una reunión personal o interna), se descarta sin guardar nada.

   Sólo se acepta con la firma de Fathom (el secreto que dio al crear el
   webhook): sin conexión, o con una firma que no da, no se guarda nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(peticion: Request) {
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });

  const cuerpo = await peticion.text();
  const secreto = await secretoWebhook(db);
  if (!secreto) return NextResponse.json({ error: "Fathom no está conectado." }, { status: 503 });
  const valida = firmaValida({
    cuerpo, secreto,
    id: peticion.headers.get("webhook-id"),
    timestamp: peticion.headers.get("webhook-timestamp"),
    firma: peticion.headers.get("webhook-signature"),
  });
  if (!valida) return NextResponse.json({ error: "Firma inválida." }, { status: 401 });

  let payload: unknown;
  try { payload = JSON.parse(cuerpo); } catch { return NextResponse.json({ error: "No es JSON." }, { status: 400 }); }

  const r = await guardarGrabacion(db, payload);
  /* Una reunión sin recording_id no se va a poder guardar nunca: 200, así
     Fathom no la reintenta. Un error de la base sí: 500 y reintenta. */
  if (!r.ok && r.error?.includes("recording_id")) return NextResponse.json({ recibido: true, guardado: false });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  /* Sin llamada: 200 igual, así Fathom no la vuelve a mandar. */
  return NextResponse.json({ recibido: true, guardado: r.guardada });
}
