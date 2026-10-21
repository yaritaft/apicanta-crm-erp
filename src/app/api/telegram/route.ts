import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { hayTelegram, telegram } from "@/lib/accesos-servidor";
import { leerWebhookTelegram, RUTA_WEBHOOK_TELEGRAM } from "@/lib/accesos-alumnos";

/* ==================================================================
   El bot de Telegram, desde Ajustes → Integraciones.
   GET: el bot, si está conectado a Apicanta (o a otra herramienta) y los grupos donde está.
   POST { accion }:
   - "conectar": apunta los avisos del bot a /api/telegram/webhook con un secreto propio. Si el bot
     ya lo usa otra herramienta, sólo con { forzar: true } (esa deja de recibir).
   - "desconectar": deja de recibir avisos.
   - "revisar": vuelve a preguntar, grupo por grupo, si el bot es admin y puede invitar y expulsar.
   Conectar y desconectar es de los dueños.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes", "alumnos"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  if (!hayTelegram()) return NextResponse.json({ token: false, grupos: [] });
  const base = new URL(peticion.url).origin;
  const [me, info, grupos] = await Promise.all([
    telegram("getMe"), telegram("getWebhookInfo"),
    db.from("telegram_grupos").select("*").order("titulo"),
  ]);
  const bot = me.ok ? (me.result as { username?: string }) : null;
  return NextResponse.json({
    token: true, bot: bot?.username ?? null, webhook: leerWebhookTelegram(info, base), grupos: grupos.data ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  if (!hayTelegram()) return NextResponse.json({ error: "Falta TELEGRAM_BOT_TOKEN en Vercel." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; forzar?: boolean };

  if (b.accion === "revisar") {
    const me = await telegram("getMe");
    const botId = (me.result as { id?: number } | undefined)?.id;
    const grupos = ((await db.from("telegram_grupos").select('"chatId"')).data ?? []) as { chatId: string }[];
    for (const g of grupos) {
      const m = await telegram("getChatMember", { chat_id: g.chatId, user_id: botId });
      const r = (m.result ?? {}) as { status?: string; can_invite_users?: boolean; can_restrict_members?: boolean };
      const chat = await telegram("getChat", { chat_id: g.chatId });
      const titulo = (chat.result as { title?: string } | undefined)?.title;
      await db.from("telegram_grupos").update({
        botEsAdmin: r.status === "administrator" || r.status === "creator",
        puedeInvitar: r.status === "creator" || Boolean(r.can_invite_users),
        puedeExpulsar: r.status === "creator" || Boolean(r.can_restrict_members),
        ...(titulo ? { titulo } : {}), vistoEn: new Date().toISOString(),
      }).eq("chatId", g.chatId);
    }
    return NextResponse.json({ ok: true, revisados: grupos.length });
  }

  if (!(await esDuenoDelPedido(peticion))) return NextResponse.json({ error: "Conectar el bot es de los dueños." }, { status: 403 });
  if (b.accion === "desconectar") {
    await telegram("deleteWebhook", { drop_pending_updates: false });
    /* La fila queda, sin secreto: así la pasada de cada hora sabe que se desconectó a mano y no lo reconecta. */
    await db.from("telegram_conexion").upsert({ id: 1, secreto: null, url: null, conectadoEn: null, conectadoPor: correoDelPedido(peticion) }, { onConflict: "id" });
    return NextResponse.json({ ok: true });
  }
  if (b.accion !== "conectar") return NextResponse.json({ error: "No sé hacer eso." }, { status: 400 });
  const base = new URL(peticion.url).origin;
  const w = leerWebhookTelegram(await telegram("getWebhookInfo"), base);
  if (w.uso === "otra" && !b.forzar) {
    return NextResponse.json({ error: `El bot ya lo usa otra herramienta (${w.host ?? "otra dirección"}). Si lo conectás, esa deja de recibir.`, otra: w.host }, { status: 409 });
  }
  const secreto = randomBytes(24).toString("hex");
  const url = `${base}${RUTA_WEBHOOK_TELEGRAM}`;
  const r = await telegram("setWebhook", { url, secret_token: secreto, allowed_updates: ["message", "my_chat_member", "chat_member"] });
  if (!r.ok) return NextResponse.json({ error: `Telegram no lo conectó: ${r.description ?? "sin motivo"}.` }, { status: 502 });
  await db.from("telegram_conexion").upsert({ id: 1, secreto, url, conectadoEn: new Date().toISOString(), conectadoPor: correoDelPedido(peticion) }, { onConflict: "id" });
  return NextResponse.json({ ok: true });
}
