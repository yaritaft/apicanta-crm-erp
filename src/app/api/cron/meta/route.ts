import { NextResponse } from "next/server";
import { metaConfigurado, tokenDeSistema, traerCuentas } from "@/lib/meta";
import { sincronizarMeta, ventana } from "@/lib/meta-sync";
import { cuentasDeWhatsapp, pedirAMeta, sincronizarCostosWhatsapp, type ResultadoCostosWhatsapp } from "@/lib/meta-whatsapp";
import { nubeServidor } from "@/lib/servidor";

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

/* El costo de WhatsApp API (lo que cobra Meta por los mensajes de la API) sale de la cuenta de WhatsApp Business, no de las cuentas de anuncios:
   se trae con el mismo token, en cada corrida y sobre la misma ventana, y se guarda día por día (lib/meta-whatsapp.ts). Nunca corta la
   sincronización de anuncios: si falla (casi siempre por el permiso del token), queda el error en `cron_estado` y en la respuesta. */
async function costosDeWhatsapp(token: string, desde: string, hasta: string, modo: string): Promise<ResultadoCostosWhatsapp[] | { error: string }> {
  const db = nubeServidor();
  if (!db) return { error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  try {
    const r = await sincronizarCostosWhatsapp(db, pedirAMeta(token), cuentasDeWhatsapp(), desde, hasta);
    const x = await db.from("cron_estado").upsert(
      { clave: "meta-whatsapp-costos", ejecutadoEn: new Date().toISOString(), ok: r.every((c) => !c.error), resultado: { modo, cuentas: r } },
      { onConflict: "clave" },
    );
    if (x.error) console.error("[cron/meta] no pude guardar el estado de WhatsApp:", x.error.message);
    return r;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer el costo de WhatsApp." };
  }
}

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

  /* La hora SOLA no alcanza: el cron dispara cada 15 minutos, asi que esa
     hora tiene cuatro disparos y el sync completo —el mas pesado contra Meta:
     2.751 anuncios mas 30 dias— corria cuatro veces seguidas, gastando tres
     veces de mas la cuota que a la 01:00 ya se agoto una vez. Solo el primero
     de la hora. */
  const ahora = new Date();
  const completo = ahora.getUTCHours() === HORA_DEL_SYNC_COMPLETO && ahora.getUTCMinutes() < 15;
  const { desde, hasta } = ventana(completo ? 30 : 3);

  const whatsapp = await costosDeWhatsapp(token, desde, hasta, completo ? "completo" : "rapido");

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

    const salida = { modo: completo ? "completo" : "rapido", desde, hasta, resultados, fallidas, whatsapp };
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
