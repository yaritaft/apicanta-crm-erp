import { NextResponse } from "next/server";
import { validarCuerpoGrupo } from "@/lib/whatsapp";
import { autorizarLector, leerJson, recibirGrupo, repositorio, respuestaDeError, SIN_BASE } from "@/lib/whatsapp-servidor";

/* ==================================================================
   Lo que lee el lector de WhatsApp de un grupo.

   POST { grupo: { id, nombre }, participantes: [teléfonos], evento, en }
   - evento «foto»: la lista COMPLETA de quienes están en el grupo. La manda
     el lector al conectarse y cada tanto; corrige lo que haya perdido.
   - evento «entro» / «salio»: quiénes entraron o salieron recién.
   Opcionales: `total` (todos los participantes) y `sinTelefono` (los que
   WhatsApp muestra por un id interno, sin teléfono: no se mandan).

   Lo llama sólo el servicio de servicios/whatsapp-lector, con el secreto
   WHATSAPP_LECTOR_TOKEN en «Authorization: Bearer …». Sin la variable en la
   app, 503; con otro token, 401. Nunca se escribe un teléfono en los
   registros ni en la respuesta.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(peticion: Request) {
  const noPasa = autorizarLector(peticion);
  if (noPasa) return noPasa;

  const leido = await leerJson(peticion);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const v = validarCuerpoGrupo(leido.json);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const donde = repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await recibirGrupo(donde.repo, v.valor), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respuestaDeError(e, "whatsapp/grupos");
  }
}
