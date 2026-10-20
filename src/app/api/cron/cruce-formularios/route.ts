import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { ejecutarCruceAutomatico, guardarEstadoDelCruce } from "@/lib/cruce-nube";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* El cruce automático de Formularios, cada media hora.

   Une solos los registros del formulario con quienes después agendaron en
   Calendly o compraron (mismo mail o mismo teléfono) y le pasa al contacto lo
   que el formulario sabía: el anuncio y el webinar. Las coincidencias dudosas
   (un nombre parecido) las sigue viendo una persona en Formularios → Cruce.
   Ver lib/cruce-auto.ts.

   Cada corrida deja asentado en `cron_estado` cuándo fue y qué hizo (supabase/cron-estado.sql):
   es lo que muestra Conciliación en Marketing y Finanzas.

   Corre en :05 y :35 para no pisarse con los de Meta, Calendly y pasarelas. */

export async function GET(req: Request) {
  /* Igual que los otros crons: se exige que el secreto EXISTA. Sin la
     variable, "Bearer undefined" dejaría pasar a cualquiera. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });

  try {
    const r = await ejecutarCruceAutomatico(db);
    console.log("[cron/cruce-formularios]", JSON.stringify(r));
    await guardarEstadoDelCruce(db, r);
    return NextResponse.json(r, { status: r.errores.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo hacer el cruce.";
    console.error("[cron/cruce-formularios] fallo entero:", error);
    await guardarEstadoDelCruce(db, { error });
    return NextResponse.json({ error }, { status: 502 });
  }
}
