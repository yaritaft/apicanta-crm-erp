import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { sincronizar } from "@/lib/contratos-servidor";
import type { Contrato } from "@/lib/contratos";

/* ==================================================================
   La red de seguridad del aviso de PandaDoc: cada hora se le pregunta el
   estado a los contratos que todavía esperan algo (armándose, enviados,
   abiertos) y a los firmados que no tienen su PDF o sus accesos. Si un
   aviso se perdió, acá se recupera (y al firmar, se dan los accesos).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOPE = 60;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base." }, { status: 503 });
  const desde = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const r = await db.from("contratos").select("*")
    .gte("creadoEn", desde).not("documentoId", "is", null)
    .or('estado.in.(creando,enviado,visto),and(estado.eq.firmado,accesosEn.is.null),and(estado.eq.firmado,pdfPath.is.null)')
    .order("sincronizadoEn", { ascending: true, nullsFirst: true }).limit(TOPE);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  let cambiaron = 0, fallaron = 0;
  for (const c of (r.data ?? []) as Contrato[]) {
    try {
      const nuevo = await sincronizar(db, c, "sincronizacion");
      if (nuevo.estado !== c.estado) cambiaron++;
    } catch (e) {
      fallaron++;
      console.error("[cron contratos]", c.id, e instanceof Error ? e.message : String(e));
    }
  }
  return NextResponse.json({ ok: true, revisados: r.data?.length ?? 0, cambiaron, fallaron });
}
