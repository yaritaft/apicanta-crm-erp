import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { tokenDeSistema } from "@/lib/meta";
import { activarWebhook, estadoWebhook } from "@/lib/meta-leads";
import { sincronizarLeadsMeta } from "@/lib/meta-leads-sync";

/* ==================================================================
   Los formularios de Meta, desde Ajustes → Integraciones.

   GET: si los avisos están activos (la app escucha "leadgen" en nuestra
   dirección y cada página le avisa).
   POST { accion: "activar" }: los activa con lo que ya tenemos (el token
   de sistema y el App Secret). Meta verifica la dirección en el momento.
   POST { accion: "traer" }: la carga de una vez de los últimos 90 días,
   lo anterior a los avisos.

   Sólo para el equipo: la carga escribe en la base con la clave de
   servicio, y activar cambia la configuración de la app en Meta.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["marketing", "ajustes"], 1);
  if (noPuede) return noPuede;
  const token = tokenDeSistema();
  if (!token) return NextResponse.json({ error: "Falta META_SYSTEM_TOKEN en el servidor." }, { status: 503 });
  return NextResponse.json(await estadoWebhook(token));
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["marketing", "ajustes"], 2);
  if (noPuede) return noPuede;
  const cuerpo = (await peticion.json().catch(() => ({}))) as { accion?: string; dias?: number };
  const token = tokenDeSistema();
  if (!token) return NextResponse.json({ error: "Falta META_SYSTEM_TOKEN en el servidor." }, { status: 503 });

  if (cuerpo.accion === "activar") {
    /* La dirección pública de esta misma app: Meta la llama desde afuera. */
    const callback = `${new URL(peticion.url).origin}/api/meta/leads/webhook`;
    try {
      return NextResponse.json(await activarWebhook(token, callback));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudieron activar los avisos." }, { status: 502 });
    }
  }

  const dias = Number.isFinite(cuerpo.dias) ? Number(cuerpo.dias) : 90;
  const r = await sincronizarLeadsMeta({ dias, limite: 400 });
  return NextResponse.json(r, { status: r.errores.length && !r.paginas.length ? 502 : 200 });
}
