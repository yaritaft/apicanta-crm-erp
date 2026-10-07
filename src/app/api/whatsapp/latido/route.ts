import { NextResponse } from "next/server";
import { MAX_BYTES_QR, validarCuerpoLatido } from "@/lib/whatsapp";
import { autorizarLector, leerJson, recibirLatido, repositorio, respuestaDeError, SIN_BASE } from "@/lib/whatsapp-servidor";

/* ==================================================================
   El latido del lector de WhatsApp: «sigo vivo».

   POST { en, conectado, grupos, estado, qr }. Cada dos minutos, y enseguida
   cuando cambia el estado o el código QR. `estado` dice cómo está con WhatsApp
   (conectado, esperando_qr, reconectando o cerrado); `conectado` es lo mismo en
   true / false; `grupos`, cuántos vigila. Con estado «esperando_qr» puede
   llevar `qr`: el código para vincular el número, como imagen (data URL), que
   se guarda aparte (supabase/whatsapp-lector-qr.sql) y sólo lo ve un dueño. La
   app anota SU hora, no la del lector, y con eso avisa si pasan 15 minutos sin
   latido (lib/whatsapp.ts).

   Mismo secreto que /api/whatsapp/grupos.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(peticion: Request) {
  const noPasa = autorizarLector(peticion);
  if (noPasa) return noPasa;

  /* El código QR viaja en el latido, como imagen: cabe holgado en lo que valida el cuerpo. */
  const leido = await leerJson(peticion, MAX_BYTES_QR + 2_000);
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
