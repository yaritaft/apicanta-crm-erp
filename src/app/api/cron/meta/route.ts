import { NextResponse } from "next/server";
import { metaConfigurado, tokenDeSistema, traerCuentas } from "@/lib/meta";
import { sincronizarMeta, ventana } from "@/lib/meta-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Sincronización automática de Meta.

   Una sola ruta para las dos cadencias, decidida por la hora. Podrían ser dos
   entradas de cron, pero el plan Hobby permite dos en total y una ya se la
   lleva el sync de pasarelas.

   - Cada 15 minutos: insights de los últimos 3 días. Rápido, y alcanza para
     que el gasto de hoy esté siempre fresco.
   - A las 08:00 UTC (5 de la mañana en Argentina): jerarquía completa más 30
     días de insights. Atrapa los anuncios nuevos, los renombres, y sobre todo
     las REFORMULACIONES de Meta, que corrige sus números hasta 28 días para
     atrás. Sin ese repaso, el gasto de la semana pasada se queda con la
     versión vieja para siempre.

   Va a las 5 AM a propósito: es cuando no hay nadie mirando la pantalla y el
   sync largo no compite con nadie. */

const HORA_DEL_SYNC_COMPLETO = 8; // UTC

export async function GET(req: Request) {
  /* El cron de Vercel manda este header. Sin la guarda, la ruta es un botón
     público para quemar la cuota de Meta.

     Se exige que el secreto EXISTA, no sólo que coincida: si CRON_SECRET no
     estuviera definido, la comparación sería contra "Bearer undefined" y
     cualquiera que mandara ese header exacto entraría. Un entorno sin la
     variable tiene que rechazar todo, no abrirse. */
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!metaConfigurado()) {
    return NextResponse.json({ error: "Meta no está configurado." }, { status: 503 });
  }

  /* Un cron no tiene cookie: sólo sirve el token de sistema. */
  const token = tokenDeSistema();
  if (!token) {
    return NextResponse.json(
      { error: "Falta META_SYSTEM_TOKEN: el cron no puede usar el token de la cookie." },
      { status: 401 },
    );
  }

  const completo = new Date().getUTCHours() === HORA_DEL_SYNC_COMPLETO;
  const { desde, hasta } = ventana(completo ? 30 : 3);

  try {
    const cuentas = await traerCuentas(token);
    /* estado 1 = activa. Una cuenta deshabilitada no gasta, y pedirle insights
       es tirar cuota de Meta al vacío. */
    const activas = cuentas.filter((c) => c.estado === 1);

    /* En SERIE, no en paralelo: tres cuentas a la vez es la forma más rápida
       de que Meta nos corte por exceso de consultas, y ahí no se sincroniza
       ninguna. */
    const resultados = [];
    const fallidas: { cuentaId: string; error: string }[] = [];
    for (const c of activas) {
      try {
        resultados.push(await sincronizarMeta(token, c.id, desde, hasta, { conJerarquia: completo }));
      } catch (e) {
        /* Que una cuenta falle no puede arrastrar a las otras. */
        fallidas.push({ cuentaId: c.id, error: e instanceof Error ? e.message : "error" });
      }
    }

    const salida = { modo: completo ? "completo" : "rapido", desde, hasta, resultados, fallidas };
    console.log("[cron/meta]", JSON.stringify(salida));

    /* 207 cuando alguna falló: el cron figura como corrido, pero queda
       distinguible de un todo-bien en los logs. */
    return NextResponse.json(salida, { status: fallidas.length ? 207 : 200 });
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo sincronizar Meta.";
    console.error("[cron/meta] fallo entero:", error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
