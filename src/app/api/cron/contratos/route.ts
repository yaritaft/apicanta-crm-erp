import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { sincronizar } from "@/lib/contratos-servidor";
import { conectarAvisoSolo, type Contrato } from "@/lib/contratos";
import { clavePandadoc, crearSuscripcion } from "@/lib/pandadoc-servidor";
import { randomBytes } from "node:crypto";
import { hayTelegram, revisarGruposDeTelegram, telegram } from "@/lib/accesos-servidor";
import { leerWebhookTelegram, RUTA_WEBHOOK_TELEGRAM } from "@/lib/accesos-alumnos";
import { pasarOutboardings } from "@/lib/outboarding-servidor";

/* ==================================================================
   La red de seguridad del aviso de PandaDoc: cada hora se le pregunta el
   estado a los contratos que todavía esperan algo (armándose, enviados,
   abiertos), a los firmados que no tienen su PDF o sus accesos (firmó antes
   de que se cargara su venta: se dan apenas aparece) y a los mandados a mano
   desde PandaDoc que todavía no se ataron a su venta. Si un aviso se perdió,
   acá se recupera (y al firmar, se dan los accesos).
   También se ponen al día los grupos de Telegram anotados, y se hace el
   outboarding automático: a quien está en Outboarding y ya terminó su programa
   se le sacan los accesos (lib/outboarding-servidor.ts; Lili, 26/10).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TOPE = 60;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base." }, { status: 503 });
  const aviso = await asegurarAvisoDeProduccion(db);
  const bot = await asegurarBotDeTelegram(db);
  const grupos = await revisarGruposDeTelegram(db).catch((e) => `no se pudo: ${e instanceof Error ? e.message : String(e)}`);
  const desde = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const r = await db.from("contratos").select("*")
    .gte("creadoEn", desde).not("documentoId", "is", null)
    .or('estado.in.(creando,enviado,visto),and(estado.eq.firmado,accesosEn.is.null),and(estado.eq.firmado,pdfPath.is.null)')
    .order("sincronizadoEn", { ascending: true, nullsFirst: true }).limit(TOPE);
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  /* Los mandados a mano desde PandaDoc que todavía no se ataron a su venta (o a los que no se les leyó el firmante):
     el equipo carga la venta después del contrato. */
  const sueltos = await db.from("contratos").select("*")
    .gte("creadoEn", desde).not("documentoId", "is", null).eq("origen", "pandadoc").or('ventaId.is.null,alumnoId.is.null,destinatario->>email.eq.')
    .order("sincronizadoEn", { ascending: true, nullsFirst: true }).limit(TOPE);
  const lista = [...(r.data ?? []), ...(sueltos.data ?? []).filter((x) => !(r.data ?? []).some((y) => y.id === x.id))] as Contrato[];
  let cambiaron = 0, fallaron = 0;
  for (const c of lista) {
    try {
      const nuevo = await sincronizar(db, c, "sincronizacion");
      if (nuevo.estado !== c.estado) cambiaron++;
    } catch (e) {
      fallaron++;
      console.error("[cron contratos]", c.id, e instanceof Error ? e.message : String(e));
    }
  }
  /* Después de los contratos: un alumno que firmó y ya estaba en outboarding no recibe y pierde accesos en la misma pasada. */
  const outboarding = await pasarOutboardings(db).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  return NextResponse.json({ ok: true, aviso, bot, grupos, revisados: lista.length, cambiaron, fallaron, outboarding, ...(sueltos.error ? { sueltos: sueltos.error.message } : {}) });
}

/* El aviso de PandaDoc de producción se conecta solo la primera vez (Juan Cruz, 20/10: «dejalo listo»): la clave
   de producción vive sólo en la app publicada. Si alguien lo desconecta a mano queda la fila sin clave y no se
   vuelve a conectar solo (se reconecta con el botón de Ajustes). */
async function asegurarAvisoDeProduccion(db: NonNullable<ReturnType<typeof nubeServidor>>): Promise<string> {
  try {
    const fila = await db.from("pandadoc_conexion").select("modo").eq("modo", "produccion").maybeSingle();
    if (fila.error) return `no se pudo leer: ${fila.error.message}`;
    const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (!conectarAvisoSolo({ enProduccion: process.env.VERCEL_ENV === "production" && Boolean(dominio), hayClave: Boolean(clavePandadoc("produccion")), hayFila: Boolean(fila.data) })) {
      return fila.data ? "ya estaba" : "no corresponde";
    }
    const url = `https://${dominio}/api/pandadoc/webhook`;
    const s = await crearSuscripcion("produccion", url);
    const up = await db.from("pandadoc_conexion").insert({
      modo: "produccion", suscripcionId: s.id, clave: s.clave, url, conectadoEn: new Date().toISOString(), conectadoPor: "Automático (pasada de cada hora)",
    });
    if (up.error) return `se creó en PandaDoc pero no se guardó: ${up.error.message}`;
    console.info("[cron contratos] aviso de producción conectado", url);
    return "conectado";
  } catch (e) {
    console.error("[cron contratos] no se pudo conectar el aviso de producción", e instanceof Error ? e.message : String(e));
    return "no se pudo";
  }
}

/* El bot de Telegram se conecta solo la primera vez (Juan Cruz, 20/10: «ya cargué el token»), pero SÓLO si nadie más
   lo usa: Telegram deja una sola conexión por bot y conectarlo le cortaría los avisos a otra herramienta. Con eso el
   bot anota los grupos donde lo agregan y quién entra con cada link. Desconectado a mano (fila sin secreto), no vuelve. */
async function asegurarBotDeTelegram(db: NonNullable<ReturnType<typeof nubeServidor>>): Promise<string> {
  try {
    const dominio = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    if (process.env.VERCEL_ENV !== "production" || !dominio || !hayTelegram()) return "no corresponde";
    const fila = await db.from("telegram_conexion").select("id").eq("id", 1).maybeSingle();
    if (fila.error) return `no se pudo leer: ${fila.error.message}`;
    if (fila.data) return "ya estaba";
    const base = `https://${dominio}`;
    const w = leerWebhookTelegram(await telegram("getWebhookInfo"), base);
    if (w.uso === "otra") return `lo usa otra herramienta (${w.host ?? "otra dirección"}): no se conecta solo`;
    const secreto = randomBytes(24).toString("hex");
    const url = `${base}${RUTA_WEBHOOK_TELEGRAM}`;
    const r = await telegram("setWebhook", { url, secret_token: secreto, allowed_updates: ["message", "my_chat_member", "chat_member"] });
    if (!r.ok) return `Telegram no lo conectó: ${r.description ?? "sin motivo"}`;
    const up = await db.from("telegram_conexion").insert({ id: 1, secreto, url, conectadoEn: new Date().toISOString(), conectadoPor: "Automático (pasada de cada hora)" });
    if (up.error) return `se conectó pero no se guardó el secreto: ${up.error.message}`;
    return "conectado";
  } catch (e) {
    console.error("[cron contratos] no se pudo conectar el bot", e instanceof Error ? e.message : String(e));
    return "no se pudo";
  }
}
