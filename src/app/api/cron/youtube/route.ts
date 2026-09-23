import { NextResponse } from "next/server";
import { completarLlamadas } from "@/lib/agendas-sync";
import { seguirVivos } from "@/lib/youtube-vivo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Cada minuto: si hay un webinar en el aire, guarda cuántos lo están
   mirando y lo nuevo del chat (lib/youtube-vivo.ts), y completa las
   llamadas de cada webinar con las agendas de Calendly (lib/agendas-sync.ts). Si no hay ninguno
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
    /* Y de paso, las agendas de Calendly de cada webinar a la planilla. */
    const l = await completarLlamadas().catch((e: unknown) => ({ actualizados: 0, errores: [e instanceof Error ? e.message : "agendas"] }));
    const errores = [...r.errores, ...l.errores];
    if (r.mirados > 0 || l.actualizados > 0 || errores.length) console.log("[cron/youtube]", JSON.stringify({ ...r, llamadas: l.actualizados, errores }));
    return NextResponse.json({ ...r, llamadas: l.actualizados, errores }, { status: errores.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo seguir los vivos.";
    console.error("[cron/youtube] fallo entero:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
