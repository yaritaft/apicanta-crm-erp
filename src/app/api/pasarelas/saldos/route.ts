import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { saldosReales } from "@/lib/pasarelas-api";

/* ==================================================================
   El saldo real de las cuentas que se pueden leer solas.

     GET /api/pasarelas/saldos                       → todas las que se leen solas
     GET /api/pasarelas/saldos?cuentas=proc_trust    → sólo esas
     GET /api/pasarelas/saldos?al=2026-10-12T23:00Z  → al cierre de ese momento (sólo la red de USDT guarda la historia)

   → { saldos: [{ cuentaId, saldo, moneda, al, fuente, nota? }], errores, sinConexion, soloHoy }

   Lo pide la Caja (el control de saldos) y el arqueo («Traer los saldos reales»), con la
   sesión de quien ve Finanzas. Una cuenta que falla o que no está conectada no tumba a las demás.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 1, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const url = new URL(req.url);
  const cuentas = (url.searchParams.get("cuentas") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 10);
  if (cuentas.some((c) => c.length > 60)) return NextResponse.json({ error: "Cuenta inválida." }, { status: 400, headers: SIN_CACHE });
  const alTexto = url.searchParams.get("al");
  let al: Date | undefined;
  if (alTexto) {
    al = new Date(alTexto);
    if (Number.isNaN(al.getTime())) return NextResponse.json({ error: "La fecha no se entiende." }, { status: 400, headers: SIN_CACHE });
  }
  return NextResponse.json(await saldosReales(cuentas.length ? cuentas : undefined, al), { headers: SIN_CACHE });
}
