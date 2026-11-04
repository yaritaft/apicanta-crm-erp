import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { hayServidor } from "@/lib/servidor";
import { crearLinkToken, entornoDePlaid, ErrorDePlaid, plaidConfigurado } from "@/lib/plaid-servidor";

/* ==================================================================
   Empezar a conectar Bank of America: devuelve el permiso para abrir la ventana de Plaid (`link_token`), que dura unas horas y sirve para una sola
   conexión. Con { volver: true } se abre para volver a autorizar la conexión que ya hay (Bank of America vence el permiso al año).
   Es un POST con la sesión de quien puede editar Finanzas: no se puede abrir desde un link.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  if (!plaidConfigurado()) {
    return NextResponse.json({ error: "Faltan PLAID_CLIENT_ID y PLAID_SECRET en Vercel: ver docs/conectar-bank-of-america.md." }, { status: 503, headers: SIN_CACHE });
  }
  if (!hayServidor) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY: no hay dónde guardar el permiso del banco." }, { status: 503, headers: SIN_CACHE });
  }
  const cuerpo = (await req.json().catch(() => ({}))) as { volver?: unknown; quien?: unknown };
  try {
    const linkToken = await crearLinkToken(typeof cuerpo.quien === "string" ? cuerpo.quien : "", cuerpo.volver === true);
    return NextResponse.json({ linkToken, entorno: entornoDePlaid() }, { headers: SIN_CACHE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No pude abrir la conexión con Plaid." }, { status: err instanceof ErrorDePlaid && err.status === 503 ? 503 : 502, headers: SIN_CACHE });
  }
}
