import { NextResponse } from "next/server";
import { hayCalendly } from "@/lib/calendly";
import { sincronizarCalendly } from "@/lib/calendly-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Repesca de Calendly cada 30 minutos.

   El webhook trae cada agenda en segundos; esto recupera lo que un webhook
   haya perdido (una caída, un deploy en el medio) y trae las cancelaciones
   que Calendly no avisó. Mira desde dos días atrás hasta dos meses adelante:
   las agendas se hacen con semanas de anticipación.

   Corre en :20 y :50 para no pisarse con el de Meta, que va en :00, :15,
   :30 y :45. */

export async function GET(req: Request) {
  /* Igual que el cron de Meta: se exige que el secreto EXISTA. Sin la
     variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!hayCalendly()) {
    return NextResponse.json({ error: "Falta CALENDLY_TOKEN." }, { status: 503 });
  }

  try {
    const r = await sincronizarCalendly({ atras: 2, adelante: 60, limite: 60 });
    console.log("[cron/calendly]", JSON.stringify(r));
    return NextResponse.json(r, { status: r.errores.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo sincronizar Calendly.";
    console.error("[cron/calendly] fallo entero:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
