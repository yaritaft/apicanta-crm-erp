import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { tokenDeSistema } from "@/lib/meta";
import { cuentasDeWhatsapp, pedirAMeta, sincronizarCostosWhatsapp } from "@/lib/meta-whatsapp";
import { ventana } from "@/lib/meta-sync";
import { nubeServidor } from "@/lib/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* El costo de WhatsApp API, a pedido (21/10).

   Lo mismo que hace solo el cron de Meta cada 15 minutos (api/cron/meta), pero ahora y desde una sesión: sirve para comprobar la conexión con la
   cuenta de WhatsApp Business sin esperar a la próxima corrida, y para traer más historia. Devuelve, por cuenta, cuántos días leyó, cuánto sumó o
   el error de Meta con el diagnóstico (qué permisos tiene el token y qué cuentas ve).

   POST { dias?: 1–120 (30), cuentas?: ["id", …] } — «cuentas» prueba otros ids en lugar de los configurados (META_WABA_IDS).
   Sólo con el token de sistema (no el de la cookie): la facturación es del negocio. Lo puede pedir quien edita Marketing. */

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["marketing"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const token = tokenDeSistema();
  if (!token) return NextResponse.json({ error: "Falta META_SYSTEM_TOKEN en el servidor." }, { status: 503 });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 503 });

  const cuerpo = (await req.json().catch(() => ({}))) as { dias?: unknown; cuentas?: unknown };
  const dias = Math.min(120, Math.max(1, Math.round(Number(cuerpo.dias) || 30)));
  const pedidas = Array.isArray(cuerpo.cuentas) ? cuerpo.cuentas.map(String).filter((x) => /^\d{5,30}$/.test(x)).slice(0, 10) : [];
  const cuentas = pedidas.length ? pedidas : cuentasDeWhatsapp();
  const { desde, hasta } = ventana(dias);

  const resultado = await sincronizarCostosWhatsapp(db, pedirAMeta(token), cuentas, desde, hasta);
  return NextResponse.json({ desde, hasta, cuentas: resultado, configuradas: cuentasDeWhatsapp() }, { headers: { "Cache-Control": "no-store" } });
}
