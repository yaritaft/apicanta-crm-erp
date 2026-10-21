import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { tokenDeSistema } from "@/lib/meta";
import { cuentasDeWhatsapp, pedirAMeta, sincronizarCostosWhatsapp, tramos } from "@/lib/meta-whatsapp";
import { ventana } from "@/lib/meta-sync";
import { nubeServidor } from "@/lib/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* El costo de WhatsApp API, a pedido (21/10).

   Lo mismo que hace solo el cron de Meta cada 15 minutos (api/cron/meta), pero ahora y desde una sesión: sirve para comprobar la conexión con la
   cuenta de WhatsApp Business sin esperar a la próxima corrida, y para traer más historia. Devuelve, por cuenta, cuántos días leyó, cuánto sumó o
   el error de Meta con el diagnóstico (qué permisos tiene el token y qué cuentas ve).

   POST { dias?: 1–500 (30), cuentas?: ["id", …], crudo?: true } — «cuentas» prueba otros ids en lugar de los configurados (META_WABA_IDS);
   «crudo» devuelve además lo que contestó Meta tal cual (sin el token), para ver la forma de la respuesta.
   Sólo con el token de sistema (no el de la cookie): la facturación es del negocio. Lo puede pedir quien edita Marketing. */

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["marketing"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const token = tokenDeSistema();
  if (!token) return NextResponse.json({ error: "Falta META_SYSTEM_TOKEN en el servidor." }, { status: 503 });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 503 });

  const cuerpo = (await req.json().catch(() => ({}))) as { dias?: unknown; cuentas?: unknown; crudo?: unknown };
  const dias = Math.min(500, Math.max(1, Math.round(Number(cuerpo.dias) || 30)));
  const pedidas = Array.isArray(cuerpo.cuentas) ? cuerpo.cuentas.map(String).filter((x) => /^\d{5,30}$/.test(x)).slice(0, 10) : [];
  const cuentas = pedidas.length ? pedidas : cuentasDeWhatsapp();
  const { desde, hasta } = ventana(dias);

  const pedir = pedirAMeta(token);
  const resultado = await sincronizarCostosWhatsapp(db, pedir, cuentas, desde, hasta);
  /* Lo que contestó Meta, tal cual, del último tramo y de la ficha de cada cuenta: sin el token y acotado. */
  const crudo: Record<string, unknown> = {};
  if (cuerpo.crudo === true) {
    const t = tramos(desde, hasta).pop();
    for (const c of cuentas) {
      const una = async (params: Record<string, string>, ruta = c) => { try { return await pedir(ruta, params); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; } };
      crudo[c] = {
        ficha: await una({ fields: "id,name,currency,timezone_id,account_review_status,business_verification_status" }),
        costos: t ? await una({ fields: `pricing_analytics.start(${t.start}).end(${t.end}).granularity(DAILY).metric_types(["COST","VOLUME"]).dimensions(["PRICING_CATEGORY"])` }) : null,
        costosBorde: t ? await una({ start: String(t.start), end: String(t.end), granularity: "DAILY", metric_types: '["COST","VOLUME"]', dimensions: '["PRICING_CATEGORY"]' }, `${c}/pricing_analytics`) : null,
      };
    }
  }
  return NextResponse.json({ desde, hasta, cuentas: resultado, configuradas: cuentasDeWhatsapp(), ...(cuerpo.crudo === true ? { crudo } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
