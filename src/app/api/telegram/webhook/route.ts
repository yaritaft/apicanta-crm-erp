import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { telegram } from "@/lib/accesos-servidor";

/* ==================================================================
   POST /api/telegram/webhook — los avisos del bot de los accesos.
   - Lo agregan a un grupo o le cambian los permisos (my_chat_member), o
     alguien escribe /vincular en un grupo: el grupo queda anotado en
     `telegram_grupos` para elegirlo en el programa.
   - Alguien entra a un grupo con un link de los accesos (chat_member con
     invite_link): se anota su usuario en ese acceso (`entro`). Con eso el
     outboarding lo puede sacar.
   Telegram manda el secreto de la conexión en una cabecera: sin él, nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Chat = { id: number; title?: string; type?: string };
type Miembro = { status?: string; user?: { id: number; username?: string; first_name?: string; is_bot?: boolean }; can_invite_users?: boolean; can_restrict_members?: boolean };

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function anotarGrupo(db: NonNullable<ReturnType<typeof nubeServidor>>, chat: Chat, bot?: Miembro) {
  if (chat.type !== "group" && chat.type !== "supergroup" && chat.type !== "channel") return;
  let m = bot;
  if (!m) {
    const me = await telegram("getMe");
    const id = (me.result as { id?: number } | undefined)?.id;
    m = id ? ((await telegram("getChatMember", { chat_id: chat.id, user_id: id })).result as Miembro) : undefined;
  }
  const admin = m?.status === "administrator" || m?.status === "creator";
  if (m?.status === "left" || m?.status === "kicked") {
    await db.from("telegram_grupos").delete().eq("chatId", String(chat.id));
    return;
  }
  await db.from("telegram_grupos").upsert({
    chatId: String(chat.id), titulo: chat.title ?? "", tipo: chat.type ?? "",
    botEsAdmin: admin, puedeInvitar: m?.status === "creator" || Boolean(admin && m?.can_invite_users),
    puedeExpulsar: m?.status === "creator" || Boolean(admin && m?.can_restrict_members), vistoEn: new Date().toISOString(),
  }, { onConflict: "chatId" });
}

export async function POST(peticion: Request) {
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const secreto = (await db.from("telegram_conexion").select("secreto").eq("id", 1).maybeSingle()).data?.secreto as string | undefined;
  const dado = peticion.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secreto || !iguales(dado, secreto)) return NextResponse.json({ ok: false }, { status: 403 });

  const u = (await peticion.json().catch(() => ({}))) as {
    message?: { chat: Chat; text?: string };
    my_chat_member?: { chat: Chat; new_chat_member?: Miembro };
    chat_member?: { chat: Chat; new_chat_member?: Miembro; invite_link?: { invite_link?: string } };
  };
  try {
    if (u.my_chat_member) await anotarGrupo(db, u.my_chat_member.chat, u.my_chat_member.new_chat_member);
    if (u.message && /^\/vincular(@\w+)?\b/i.test(u.message.text ?? "")) {
      await anotarGrupo(db, u.message.chat);
      await telegram("sendMessage", { chat_id: u.message.chat.id, text: "Listo: este grupo quedó vinculado a Apicanta para los accesos de alumnos." });
    }
    const cm = u.chat_member;
    const link = cm?.invite_link?.invite_link;
    const entro = cm?.new_chat_member?.status === "member" || cm?.new_chat_member?.status === "restricted";
    if (cm && link && entro && cm.new_chat_member?.user) {
      const usuario = cm.new_chat_member.user;
      const filas = ((await db.from("accesos_alumno").select("id, externo")
        .eq("plataforma", "telegram").eq("recurso", String(cm.chat.id))).data ?? []) as { id: string; externo: Record<string, unknown> }[];
      /* Telegram puede mandar el link recortado («…»): se compara por el principio. */
      const base = link.replace(/\.{3}$|…$/, "");
      const fila = filas.find((f) => typeof f.externo?.link === "string" && (f.externo.link === link || (f.externo.link as string).startsWith(base)));
      if (fila) {
        await db.from("accesos_alumno").update({
          estado: "entro", externo: { ...fila.externo, telegramUserId: usuario.id, telegramUsuario: usuario.username ?? null },
          actualizadoEn: new Date().toISOString(),
        }).eq("id", fila.id);
      }
    }
  } catch (e) {
    console.error("[telegram] aviso", e instanceof Error ? e.message : String(e));
  }
  /* Siempre 200: si no, Telegram reintenta el mismo aviso. */
  return NextResponse.json({ ok: true });
}
