import { NextResponse } from "next/server";
import { seguirVivos } from "@/lib/youtube-vivo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Cada minuto: si hay un webinar en el aire, guarda cuántos lo están
   mirando y lo nuevo del chat (lib/youtube-vivo.ts). Si no hay ninguno
   cerca de su hora, no le pregunta nada a YouTube y termina en un par de
   milisegundos. */

export async function GET(req: Request) {
  /* Igual que los otros crons: se exige que el secreto EXISTA. Sin la
     variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const r = await seguirVivos();
    if (r.mirados > 0 || r.errores.length) console.log("[cron/youtube]", JSON.stringify(r));
    return NextResponse.json(r, { status: r.errores.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo seguir los vivos.";
    console.error("[cron/youtube] fallo entero:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
