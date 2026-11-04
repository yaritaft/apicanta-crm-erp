import { NextResponse } from "next/server";
import { correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { ErrorDePlaid, guardarConexion } from "@/lib/plaid-servidor";

/* ==================================================================
   Terminar de conectar Bank of America: Plaid, al cerrar su ventana, le da al navegador un `public_token` de un solo uso. Acá se cambia por el permiso
   permanente de sólo lectura y se guarda en la base (tabla sin políticas: el navegador nunca lo ve). Quién lo conectó sale de la sesión, no de lo que
   mande el navegador.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const cuerpo = (await req.json().catch(() => ({}))) as { public_token?: unknown; institucion?: unknown };
  const token = typeof cuerpo.public_token === "string" ? cuerpo.public_token.trim() : "";
  if (!/^public-[a-z]+-[A-Za-z0-9-]+$/.test(token) || token.length > 200) {
    return NextResponse.json({ error: "Plaid no mandó el permiso: probá conectar de nuevo." }, { status: 400, headers: SIN_CACHE });
  }
  try {
    const estado = await guardarConexion(token, typeof cuerpo.institucion === "string" ? cuerpo.institucion : "", correoDelPedido(req));
    return NextResponse.json({ conexion: estado }, { headers: SIN_CACHE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No pude guardar la conexión." }, { status: err instanceof ErrorDePlaid && err.status === 503 ? 503 : 502, headers: SIN_CACHE });
  }
}
