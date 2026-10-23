import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import type { VersionPublicada } from "@/lib/version-app";

/* GET: la versión publicada y el último «Pedir a todos que actualicen» (components/shell/AvisoVersion lo pregunta cada
   minuto y medio). Pública: no dice nada más que eso. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let recarga: string | null = null;
  const db = nubeServidor();
  if (db) {
    const r = await db.from("ajustes").select("recargaPedida").eq("id", 1).maybeSingle();
    recarga = (r.data as { recargaPedida?: string | null } | null)?.recargaPedida ?? null;
  }
  const cuerpo: VersionPublicada = { version: process.env.VERSION_APP ?? "", recarga };
  return NextResponse.json(cuerpo, { headers: { "Cache-Control": "no-store" } });
}
