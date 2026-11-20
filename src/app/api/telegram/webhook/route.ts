import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import {
  anotarGrupoDeTelegram, esAdministradorDelGrupo, mudarGrupoDeTelegram, telegram, type ChatTelegram as Chat, type MiembroTelegram as Miembro,
} from "@/lib/accesos-servidor";
import { anotarEntradaPorLink, atenderPrivado, verPersona, type MensajeDelBot, type UsuarioTelegram } from "@/lib/telegram-identidades-servidor";

/* ==================================================================
   POST /api/telegram/webhook — los avisos del bot de los accesos.
   - Lo agregan a un grupo o le cambian los permisos (my_chat_member), o
     un administrador escribe /vincular en un grupo: el grupo queda anotado en
     `telegram_grupos` para elegirlo en el programa. Si el grupo pasa a
     supergrupo, el id nuevo reemplaza al viejo en todos lados.
   - Alguien entra a un grupo con un link de los accesos (chat_member con
     invite_link): se anota su usuario en ese acceso (`entro`). Con eso el
     outboarding lo puede sacar.
   - Quién es quién (Manu, 20/11): cada cuenta que entra, sale o escribe en un
     grupo queda anotada en `telegram_personas`, y quien le escribe al bot en su
     chat (su link personal, o compartiendo su número) queda atado a su alumno.
     Así los alumnos que ya estaban en los grupos de antes se pueden sacar sin
     buscarlos por nombre (lib/telegram-identidades-servidor.ts).
   Telegram manda el secreto de la conexión en una cabecera: sin él, nada.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type MensajeDeGrupo = MensajeDelBot & {
  chat: Chat & { type?: string }; message_id?: number; sender_chat?: { id: number };
  migrate_to_chat_id?: number; migrate_from_chat_id?: number;
};

export async function POST(peticion: Request) {
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const secreto = (await db.from("telegram_conexion").select("secreto").eq("id", 1).maybeSingle()).data?.secreto as string | undefined;
  const dado = peticion.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secreto || !iguales(dado, secreto)) return NextResponse.json({ ok: false }, { status: 403 });

  const u = (await peticion.json().catch(() => ({}))) as {
    message?: MensajeDeGrupo;
    my_chat_member?: { chat: Chat; new_chat_member?: Miembro };
    chat_member?: { chat: Chat; from?: UsuarioTelegram; new_chat_member?: Miembro; invite_link?: { invite_link?: string } };
  };
  const m = u.message;
  const cm = u.chat_member;
  /* Entró con el link personal de un alumno y la cuenta ya quedó atada a él (más abajo no hace falta anotarla de nuevo). */
  let entroConSuLink = false;
  try {
    if (u.my_chat_member) await anotarGrupoDeTelegram(db, u.my_chat_member.chat, u.my_chat_member.new_chat_member);
    /* El grupo pasó a supergrupo (Telegram lo hace solo, por ejemplo al hacer admin al bot): cambia de id. */
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
    const link = cm?.invite_link?.invite_link;
    const entro = cm?.new_chat_member?.status === "member" || cm?.new_chat_member?.status === "restricted";
    if (cm && link && entro && cm.new_chat_member?.user) {
      const usuario = cm.new_chat_member.user;
      const filas = ((await db.from("accesos_alumno").select('id, "alumnoId", externo')
        .eq("plataforma", "telegram").eq("recurso", String(cm.chat.id))).data ?? []) as { id: string; alumnoId: string; externo: Record<string, unknown> }[];
      /* Telegram puede mandar el link recortado («…»): se compara por el principio. */
      const base = link.replace(/\.{3}$|…$/, "");
      const fila = filas.find((f) => typeof f.externo?.link === "string" && (f.externo.link === link || (f.externo.link as string).startsWith(base)));
      if (fila) {
        await db.from("accesos_alumno").update({
          estado: "entro", externo: { ...fila.externo, telegramUserId: usuario.id, telegramUsuario: usuario.username ?? null },
          actualizadoEn: new Date().toISOString(),
        }).eq("id", fila.id);
        /* También queda la cuenta atada a ese alumno. Si esto falla, el acceso ya quedó anotado arriba. */
        entroConSuLink = true;
        await anotarEntradaPorLink(db, telegram, usuario, String(cm.chat.id), fila.alumnoId).catch((e) =>
          console.error("[telegram] no se anotó la cuenta", e instanceof Error ? e.message : String(e)));
      }
    }
  } catch (e) {
    console.error("[telegram] aviso", e instanceof Error ? e.message : String(e));
  }

  /* Quién es quién. Va aparte: si algo de esto falla, lo de arriba ya se hizo. */
  try {
    if (cm?.new_chat_member?.user && (cm.chat.type === "group" || cm.chat.type === "supergroup")) {
      const estado = cm.new_chat_member.status;
      const usuario = cm.new_chat_member.user;
      const chatId = String(cm.chat.id);
      if (estado === "left" || estado === "kicked") await verPersona(db, telegram, usuario, { chatId, adentro: false });
      /* Entró con un link de los accesos: ya quedó atada arriba. Con cualquier otro, queda anotada para identificarla. */
      else if (!entroConSuLink) await verPersona(db, telegram, usuario, { chatId, adentro: true, entroPor: "otro", esAdmin: estado === "administrator" || estado === "creator" });
    }
    /* Escribió en un grupo (un admin anónimo o un canal escribe como el grupo: no es nadie). */
    if (m?.from && !m.sender_chat && !m.migrate_to_chat_id && !m.migrate_from_chat_id && (m.chat.type === "group" || m.chat.type === "supergroup")) {
      await verPersona(db, telegram, m.from, { chatId: String(m.chat.id) });
    }
    /* Le escribió al bot en su chat: su link personal, o el número que comparte. */
    if (m?.chat.type === "private") await atenderPrivado(db, telegram, m);
  } catch (e) {
    console.error("[telegram] quién es quién", e instanceof Error ? e.message : String(e));
  }
  /* Siempre 200: si no, Telegram reintenta el mismo aviso. */
  return NextResponse.json({ ok: true });
}
