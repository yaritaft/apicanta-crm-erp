import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { hayApiFathom } from "@/lib/fathom-servidor";
import { avisarDeFathom, barrerLinks } from "@/lib/fathom-barrido-servidor";

/* ==================================================================
   Cada 5 minutos: a las llamadas que tienen el link de Fathom pegado y
   todavía no tienen su transcripción, se la trae (lib/fathom-barrido). Así
   cada llamada con link sale con su resumen y su transcripción, sin que
   nadie toque nada, y se puede bajar todo junto desde el webinar o la Agenda.
   Sigue donde quedó la vuelta anterior: Fathom limita los pedidos con
   transcripción y un recorrido largo se reparte en varias vueltas.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base." }, { status: 503 });
  if (!hayApiFathom()) return NextResponse.json({ ok: true, omitido: "Falta FATHOM_API_KEY." });
  const r = await barrerLinks(db, { reloj: Date.now() + 240_000, maxPaginas: 80 });
  if (!r.ok) console.error("[cron fathom]", r.error);
  /* Que no pase en silencio: si algo impide que lleguen las transcripciones, la campanita se lo dice a quien puede arreglarlo. */
  const avisos = await avisarDeFathom(db, r);
  return NextResponse.json({ ...r, avisos }, { status: r.ok ? 200 : 500 });
}
