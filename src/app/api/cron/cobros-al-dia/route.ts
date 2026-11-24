import { NextResponse } from "next/server";
import { hayServidor } from "@/lib/servidor";
import { traerCobrosAhora } from "@/lib/cobros-al-dia-servidor";
import { PASARELAS_RAPIDAS } from "@/lib/pasarelas-estado";

/* ==================================================================
   Cada 5 minutos: los cobros nuevos de Whop y Hotmart.

   Las dos no avisan por webhook, así que un cobro entraba recién con el
   cron de cada hora: quien cargaba la venta 20 minutos después de que el
   cliente pagó no lo encontraba y subía el comprobante a mano (Aldana,
   24/11: «se volvió a desconectar Whop»). Mira los últimos 3 días, guarda
   sin pisar lo conciliado y anota cuándo se revisó cada una. Lo demás
   (devoluciones, pases entre cuentas, banco) sigue en api/pasarelas/sync.
   Contesta sólo cifras: ningún dato de clientes.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!hayServidor) return NextResponse.json({ error: "Sin base." }, { status: 503 });
  const r = await traerCobrosAhora(PASARELAS_RAPIDAS, { dias: 3, fuente: "rapido" });
  for (const x of r) if (!x.ok) console.warn(`[cobros-al-dia] ${x.proveedor}: ${x.error}`);
  return NextResponse.json({ pasarelas: r.map(({ proveedor, ok, nuevos, error }) => ({ proveedor, ok, nuevos, error })) });
}
