import { exigirArea } from "@/lib/permisos-servidor";
import { responderDescarga } from "@/lib/meta-descarga";

/* ==================================================================
   Descargar el video o la imagen de un anuncio (el botón «Descargar» del
   detalle del anuncio: Marketing y el Dashboard).

   Los links de Meta son de otro origen y vencen: el navegador no los baja
   con un clic. Acá se le pide a Meta el anuncio de nuevo, se baja el
   archivo de sus servidores y se le pasa al navegador como una descarga
   (lib/meta-descarga.ts). El token de Meta no sale del servidor.

   GET ?ad=<id del anuncio en Meta>
       &medio=<lugar del archivo en el anuncio, desde 0>
       &tipo=video|imagen          lo que el detalle estaba mostrando
       &de=<cuántos archivos tiene el anuncio>   para numerarlos: «(2 de 3)»
       &portada=1                  de un video que Meta no entregó, su portada
       &nombre=<nombre del anuncio>  para ponerle nombre al archivo
   Lo baja quien ve Marketing, los webinars o las finanzas (los que ven el
   anuncio). Los errores vuelven como JSON {error} con un mensaje que dice
   qué pasó.
   ================================================================== */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["marketing", "webinars", "finanzas"], 1);
  if (noPuede) return noPuede;
  return responderDescarga(req);
}
