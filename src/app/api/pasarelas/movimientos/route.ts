import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { movimientosDeMercury, movimientosDeStripe } from "@/lib/pasarelas-api";

/* ==================================================================
   Qué pasó de verdad en una cuenta (lib/movimientos-del-banco.ts).

     GET /api/pasarelas/movimientos?cuenta=proc_mercury&desde=2026-10-21T00:00Z
     GET /api/pasarelas/movimientos?cuenta=proc_stripe&desde=…

   → { movimientos: [{ ref, refApp, cuentaId, fecha, monto, contraparte, detalle?, tipo, pendiente? }], avisos, conectada }

   Lo pide la Caja cuando el saldo real no da con el esperado: para ver qué movió el banco y todavía no está en la app.
   Sólo para quien ve Finanzas. No guarda nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };
const DIAS_MAXIMOS = 120;

export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 1, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const url = new URL(req.url);
  const cuenta = url.searchParams.get("cuenta") ?? "";
  if (cuenta !== "proc_mercury" && cuenta !== "proc_stripe") {
    return NextResponse.json({ error: "Esa cuenta no se puede leer sola." }, { status: 400, headers: SIN_CACHE });
  }
  const limite = new Date(Date.now() - DIAS_MAXIMOS * 86400000);
  const pedida = new Date(url.searchParams.get("desde") ?? "");
  const desde = Number.isNaN(pedida.getTime()) ? new Date(Date.now() - 14 * 86400000) : pedida < limite ? limite : pedida;
  try {
    const r = cuenta === "proc_mercury" ? await movimientosDeMercury(desde) : await movimientosDeStripe(desde);
    return NextResponse.json({ ...r, desde: desde.toISOString() }, { headers: SIN_CACHE });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudieron leer los movimientos." }, { status: 502, headers: SIN_CACHE });
  }
}
