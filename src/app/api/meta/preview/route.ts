import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { GRAPH, metaConfigurado, tokenDeLaPeticion } from "@/lib/meta";
import { leerVistaPrevia, type VistaPrevia } from "@/lib/meta-preview";
import { ErrorDeMeta, tieneArchivo, traerMaterialDelAnuncio, type CreativoVisto } from "@/lib/meta-creativo";

/* ==================================================================
   El anuncio, para verlo en su detalle (Marketing y el Dashboard).

   Primero, su material: el video o la imagen mismos, con su tamaño, para
   mostrarlos directo y con su forma (lib/meta-creativo.ts). Si el creativo
   no deja llegar a ningún archivo (o de un video Meta sólo da la portada),
   queda la vista previa que arma Meta: un <iframe> con una página adentro,
   que sirve para cualquier formato y por lo menos reproduce el video. Ahí
   va un `aviso` que dice por qué no se ve directo.

   Los links que da Meta vencen, así que se pide cada vez que se abre el
   detalle y no se guarda.

   GET ?ad=<id del anuncio en Meta>
       &marco=1                 sólo la vista previa de Meta («Ver como lo muestra Meta»)
       &formato=<ad_format>     con marco, ese formato y no el primero que ande
   Lo ve quien ve Marketing, los webinars o las finanzas (los que ven los
   números de los anuncios). El token de Meta no sale del servidor.
   ================================================================== */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/* El feed del celular es el que tiene cualquier anuncio; si el anuncio
   corre sólo en historias o reels, Meta no arma ése y se prueba el suyo. */
const FORMATOS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_REELS", "INSTAGRAM_STORY", "FACEBOOK_REELS_MOBILE"];

/* Un token vencido o sin permiso no va a andar con otra consulta. */
const sinAcceso = (status?: number, codigo?: number) => status === 401 || codigo === 190 || codigo === 200 || codigo === 10;

async function marcoDeMeta(token: string, ad: string, formatos: string[]): Promise<{ vista: (VistaPrevia & { formato: string }) | null; error: string }> {
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
        if (sinAcceso(r.status, j.error?.code)) break;
        continue;
      }
      const vista = leerVistaPrevia(j.data?.[0]?.body);
      if (vista) return { vista: { ...vista, formato }, error: "" };
    } catch {
      ultimo = "No se pudo hablar con Meta.";
    }
  }
  return { vista: null, error: ultimo };
}

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
  const sinGuardar = { headers: { "Cache-Control": "no-store" } };

  /* El material del anuncio, directo. */
  let material: CreativoVisto | null = null;
  let aviso: string | undefined;
  if (q.get("marco") !== "1") {
    try {
      material = await traerMaterialDelAnuncio(GRAPH, token, ad);
      if (tieneArchivo(material)) return NextResponse.json(material, sinGuardar);
      aviso = material.medios.length > 0
        ? "Meta no entregó el archivo del video de este anuncio: se ve como lo arma Meta."
        : "El creativo de este anuncio no trae un video ni una imagen que se pueda mostrar directo: se ve como lo arma Meta.";
    } catch (e) {
      if (e instanceof ErrorDeMeta && sinAcceso(e.status, e.codigo)) return NextResponse.json({ error: e.message }, { status: 502 });
      aviso = "No se pudo leer el creativo de este anuncio: se ve como lo arma Meta.";
    }
  }

  const { vista, error } = await marcoDeMeta(token, ad, formatos);
  if (vista) {
    const { medios: _sinArchivo, ...texto } = material ?? { medios: [] };
    return NextResponse.json({ ...texto, ...vista, ...(aviso ? { aviso } : {}) }, sinGuardar);
  }
  /* Ni el marco: si hay al menos la portada del video, eso. */
  if (material && material.medios.length > 0) return NextResponse.json(material, sinGuardar);
  return NextResponse.json({ error }, { status: 502 });
}
