import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { salidaPorBaja } from "@/lib/contratos-de-baja-servidor";

/* ==================================================================
   POST { ventaId }: una venta se acaba de cancelar o reembolsar. Anula el contrato que no firmó, le saca los accesos que
   dio la app y le avisa a Customer Success (lib/contratos-de-baja.ts, Liliana 27/11).

   La llama la pantalla apenas la baja llega a la base. Lo hace quien puede dar de baja una venta (Ventas o Finanzas
   editable) y sólo sobre una venta que ve con SU sesión. No confía en lo que manda: mira en la base que la venta esté
   de baja de verdad (si no, no hace nada). Si este pedido no sale, la pasada de cada hora hace lo mismo.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const sinCache = { "Cache-Control": "no-store" };
const mal = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: sinCache });
const dormir = (ms: number) => new Promise((listo) => setTimeout(listo, ms));

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ventas", "finanzas"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return mal("Sin base configurada.", 503);
  const b = (await peticion.json().catch(() => ({}))) as Record<string, unknown>;
  const ventaId = typeof b.ventaId === "string" ? b.ventaId.trim() : "";
  if (!ventaId) return mal("Falta qué venta.");

  /* Con la sesión de quien pide: si no la ve, no la toca. Con un par de reintentos: la baja recién escrita puede tardar. */
  let estado: string | null = null;
  for (let i = 0; i < 4; i++) {
    const r = await mia.from("ventas").select("estado").eq("id", ventaId).maybeSingle();
    if (!r.data) return mal("No encuentro esa venta (o tu cuenta no la ve).", 404);
    estado = (r.data as { estado: string }).estado;
    if (estado === "cancelada" || estado === "reembolsada") break;
    await dormir(1000);
  }
  if (estado !== "cancelada" && estado !== "reembolsada") return NextResponse.json({ resultado: null }, { headers: sinCache });

  try {
    const resultado = await salidaPorBaja(db, ventaId, { quien: correoDelPedido(peticion) || "Apicanta" });
    return NextResponse.json({ resultado }, { headers: sinCache });
  } catch (e) {
    console.error("[contratos/baja]", ventaId, e instanceof Error ? e.message : String(e));
    return mal(e instanceof Error ? e.message : "No se pudo.", 500);
  }
}
