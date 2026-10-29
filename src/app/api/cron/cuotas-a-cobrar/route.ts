import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Le avisa a cada closer, en la campanita, las cuotas que tiene que cobrar: el día antes, el día que vencen y el día
   después si siguen sin cobrarse (Mariano, 28/10: «¿el sistema te avisa cuando tenemos que cobrar cuotas?»). Lo arma la
   base (supabase/avisos-cuotas.sql → avisar_cuotas_por_cobrar), una vez por cuota y por aviso: correrla de nuevo no repite.

   Cada corrida deja asentado en `cron_estado` cuándo fue y cuántos avisos mandó. Corre a las 12:00 UTC (9 de Argentina). */

const CLAVE = "cuotas-a-cobrar";

export async function GET(req: Request) {
  /* Igual que los otros crons: se exige que el secreto EXISTA. Sin la variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });

  const r = await db.rpc("avisar_cuotas_por_cobrar");
  const ok = !r.error;
  const resultado = ok ? { avisos: Number(r.data ?? 0) } : { error: r.error?.message };
  console.log(`[cron/${CLAVE}]`, JSON.stringify(resultado));
  const x = await db.from("cron_estado").upsert({ clave: CLAVE, ejecutadoEn: new Date().toISOString(), ok, resultado }, { onConflict: "clave" });
  if (x.error) console.error(`[cron/${CLAVE}] no pude guardar el estado:`, x.error.message);
  return NextResponse.json(resultado, { status: ok ? 200 : 502 });
}
