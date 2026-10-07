import { responderEstado } from "@/lib/whatsapp-servidor";

/* ==================================================================
   Cómo está el lector de WhatsApp y qué grupos detectó: Ajustes →
   WhatsApp, y el aviso de Webinars y del Dashboard.

   GET. Lo ve quien ve los Webinars y no está limitado a lo suyo. Sin las tablas (falta correr
   supabase/whatsapp-lector.sql) contesta igual, con `tablas: false`.

   Con ?qr=1 y el lector esperando que lo vinculen, suma el código QR (una
   imagen) pero SÓLO si quien pide es dueño o edita Ajustes (aunque no vea los
   Webinars: ahí recibe el estado y el código, sin los grupos) y el código tiene
   menos de un minuto: quien lo escanea lee ese WhatsApp. La lógica está en
   lib/whatsapp-servidor.ts (responderEstado), donde se prueba.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(peticion: Request) {
  return responderEstado(peticion);
}
