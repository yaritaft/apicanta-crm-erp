import { NextResponse } from "next/server";
import { validarCuerpoLatido } from "@/lib/whatsapp";
import { autorizarLector, leerJson, recibirLatido, repositorio, respuestaDeError, SIN_BASE } from "@/lib/whatsapp-servidor";

/* ==================================================================
   El latido del lector de WhatsApp: «sigo vivo».

   POST { en, conectado, grupos }. Cada dos minutos. `conectado` dice si el
   lector está conectado a WhatsApp (puede estar vivo y desconectado, si se
   cerró la sesión); `grupos` cuántos vigila. La app anota SU hora, no la del
   lector, y con eso avisa si pasan 15 minutos sin latido (lib/whatsapp.ts).

   Mismo secreto que /api/whatsapp/grupos.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(peticion: Request) {
  const noPasa = autorizarLector(peticion);
  if (noPasa) return noPasa;

  const leido = await leerJson(peticion, 10_000);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const v = validarCuerpoLatido(leido.json);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const donde = repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await recibirLatido(donde.repo, v.valor), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return respuestaDeError(e, "whatsapp/latido");
  }
}
