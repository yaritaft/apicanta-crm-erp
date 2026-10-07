import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { estadoCapi } from "@/lib/capi-estado";

/* Lee variables de entorno en cada pedido: nunca cachear. */
export const dynamic = "force-dynamic";

/* ¿Está lista la Conversions API? Para Ajustes → Integraciones.

   Contesta qué falta cargar en Vercel y cuántos eventos se mandaron de cada
   tipo (la tabla capi_enviados). Nunca devuelve el valor de una clave: sólo
   si está o no. Lo ve quien entra a Ajustes o a Marketing. */
export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["ajustes", "marketing"], 1);
  if (noPuede) return noPuede;

  const estado = estadoCapi();
  const out: Record<string, unknown> = { ...estado };

  /* Lo mandado hasta ahora, por tipo de evento. Sin la base o sin la tabla, se omite. */
  const db = nubeServidor();
  if (db) {
    const eventos = ["Lead", estado.eventoCalificado, "Schedule", "Purchase"];
    const filas = await Promise.all(eventos.map(async (evento) => {
      const [n, ult] = await Promise.all([
        db.from("capi_enviados").select("id", { count: "exact", head: true }).eq("evento", evento),
        db.from("capi_enviados").select("enviadoEn").eq("evento", evento).order("enviadoEn", { ascending: false }).limit(1),
      ]);
      return { evento, error: n.error ?? ult.error, n: n.count ?? 0, ultimo: ((ult.data?.[0] as { enviadoEn?: string } | undefined)?.enviadoEn) ?? null };
    }));
    if (filas.some((f) => f.error)) out.sinTabla = true;
    else out.enviados = Object.fromEntries(filas.map((f) => [f.evento, { n: f.n, ultimo: f.ultimo }]));
  }
  return NextResponse.json(out);
}
