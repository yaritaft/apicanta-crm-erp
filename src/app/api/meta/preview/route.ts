import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { GRAPH, metaConfigurado, tokenDeLaPeticion } from "@/lib/meta";
import { leerVistaPrevia } from "@/lib/meta-preview";

/* ==================================================================
   La vista previa de un anuncio, como la arma Meta: sirve para cualquier
   formato (imagen, video, carrusel). Meta devuelve un <iframe> con un
   link que vence, así que se pide cada vez que se abre el detalle del
   anuncio (Marketing y el Dashboard) y no se guarda.

   GET ?ad=<id del anuncio en Meta>&formato=<ad_format de Meta>
   Lo ve quien ve Marketing, los webinars o las finanzas (los que ven los
   números de los anuncios). El token de Meta no sale del servidor.
   ================================================================== */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* El feed del celular es el que tiene cualquier anuncio; si el anuncio
   corre sólo en historias o reels, Meta no arma ése y se prueba el suyo. */
const FORMATOS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_REELS", "INSTAGRAM_STORY", "FACEBOOK_REELS_MOBILE"];

export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["marketing", "webinars", "finanzas"], 1);
  if (noPuede) return noPuede;
  if (!metaConfigurado()) return NextResponse.json({ error: "Meta no está configurado." }, { status: 503 });
  const token = tokenDeLaPeticion(req);
  if (!token) return NextResponse.json({ error: "No hay conexión con Meta." }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const ad = q.get("ad") ?? "";
  if (!/^\d{5,30}$/.test(ad)) return NextResponse.json({ error: "Falta el anuncio." }, { status: 400 });
  const pedido = q.get("formato");
  const formatos = pedido && FORMATOS.includes(pedido) ? [pedido] : FORMATOS;

  let ultimo = "Meta no devolvió la vista previa de este anuncio.";
  for (const formato of formatos) {
    const u = new URL(`${GRAPH}/${ad}/previews`);
    u.searchParams.set("ad_format", formato);
    u.searchParams.set("access_token", token);
    try {
      const r = await fetch(u, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { data?: { body?: string }[]; error?: { message?: string; code?: number } };
      if (!r.ok) {
        ultimo = j.error?.message ? `Meta: ${j.error.message}` : `Meta contestó ${r.status}.`;
        /* Un token vencido o sin permiso no va a andar con otro formato. */
        if (r.status === 401 || j.error?.code === 190 || j.error?.code === 200 || j.error?.code === 10) break;
        continue;
      }
      const vista = leerVistaPrevia(j.data?.[0]?.body);
      if (vista) return NextResponse.json({ ...vista, formato }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      ultimo = "No se pudo hablar con Meta.";
    }
  }
  return NextResponse.json({ error: ultimo }, { status: 502 });
}
