import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { cargarGastosDelBanco } from "@/lib/plaid-servidor";

/* ==================================================================
   «Traer ahora»: lo mismo que hace el cron cada hora (cargar los gastos nuevos de Bank of America), a pedido de quien puede editar Finanzas. Con
   { probar: true } sólo cuenta lo que cargaría, sin guardar nada (lo que se ve en la pantalla antes de dejarlo andar solo).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  return NextResponse.json(await cargarGastosDelBanco(undefined, new Date(), { aunqueEsteApagada: true }), { headers: SIN_CACHE });
}
