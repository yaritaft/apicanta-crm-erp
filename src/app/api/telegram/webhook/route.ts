import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import {
  anotarGrupoDeTelegram, esAdministradorDelGrupo, mudarGrupoDeTelegram, telegram, type ChatTelegram as Chat, type MiembroTelegram as Miembro,
} from "@/lib/accesos-servidor";

/* ==================================================================
   POST /api/telegram/webhook — los avisos del bot de los accesos.
   - Lo agregan a un grupo o le cambian los permisos (my_chat_member), o
     un administrador escribe /vincular en un grupo: el grupo queda anotado en
     `telegram_grupos` para elegirlo en el programa. Si el grupo pasa a
     supergrupo, el id nuevo reemplaza al viejo en todos lados.
   - Alguien entra a un grupo con un link de los accesos (chat_member con
     invite_link): se anota su usuario en ese acceso (`entro`). Con eso el
     outboarding lo puede sacar.
   Telegram manda el secreto de la conexión en una cabecera: sin él, nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(peticion: Request) {
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const secreto = (await db.from("telegram_conexion").select("secreto").eq("id", 1).maybeSingle()).data?.secreto as string | undefined;
  const dado = peticion.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secreto || !iguales(dado, secreto)) return NextResponse.json({ ok: false }, { status: 403 });

  const u = (await peticion.json().catch(() => ({}))) as {
    message?: {
      chat: Chat; text?: string; message_id?: number; from?: { id: number }; sender_chat?: { id: number };
      migrate_to_chat_id?: number; migrate_from_chat_id?: number;
    };
    my_chat_member?: { chat: Chat; new_chat_member?: Miembro };
    chat_member?: { chat: Chat; new_chat_member?: Miembro; invite_link?: { invite_link?: string } };
  };
  try {
    if (u.my_chat_member) await anotarGrupoDeTelegram(db, u.my_chat_member.chat, u.my_chat_member.new_chat_member);
    /* El grupo pasó a supergrupo (Telegram lo hace solo, por ejemplo al hacer admin al bot): cambia de id. */
    const m = u.message;
    if (m?.migrate_to_chat_id) await mudarGrupoDeTelegram(db, String(m.chat.id), String(m.migrate_to_chat_id));
    if (m?.migrate_from_chat_id) {
      await mudarGrupoDeTelegram(db, String(m.migrate_from_chat_id), String(m.chat.id));
      await anotarGrupoDeTelegram(db, m.chat);
    }
    /* Sólo un administrador del grupo vincula. A los demás no se les contesta y su mensaje se borra (si el bot puede),
       para que el siguiente no lo copie del historial. */
    if (m && /^\/vincular(@\w+)?\b/i.test(m.text ?? "")) {
      if (await esAdministradorDelGrupo(m)) {
        await anotarGrupoDeTelegram(db, m.chat);
        await telegram("sendMessage", { chat_id: m.chat.id, text: "Listo: este grupo quedó vinculado a Apicanta para los accesos de alumnos." });
      } else if (m.message_id) {
        await telegram("deleteMessage", { chat_id: m.chat.id, message_id: m.message_id }).catch(() => null);
      }
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
