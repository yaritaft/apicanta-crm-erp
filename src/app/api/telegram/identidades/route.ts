import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, esDuenoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { hayTelegram, telegram } from "@/lib/accesos-servidor";
import { mensajeParaVerificar } from "@/lib/telegram-identidades";
import {
  anunciarEnLosGrupos, atarPersona, desatarPersona, enlacePersonalDelBot, resumenDeIdentificacion, usuarioDeBot,
} from "@/lib/telegram-identidades-servidor";

/* ==================================================================
   Quién es quién en Telegram (Manu, 20/11), desde la ficha del alumno y
   desde Ajustes → Contratos y accesos.
   GET: cuántos alumnos con acceso ya están reconocidos y cuántas cuentas
     quedan sueltas; y el @usuario del bot.
   POST { accion, … }:
   - "enlace" { alumnoId }: el link personal del bot de ese alumno (con su
     código) y el mensaje para pegarle por WhatsApp.
   - "atar" { personaId, alumnoId }: esa cuenta de Telegram es de ese alumno;
     sus grupos pasan a los accesos y «Quitar» y el outboarding la sacan.
   - "desatar" { personaId }: se ató a la persona equivocada.
   - "equipo" { personaId, equipo }: administra el grupo, no es un alumno.
   - "anunciar" { chatIds? }: deja en los grupos el botón que lleva al bot
     para que se identifiquen. Sólo los dueños (le escribe a los alumnos).
   Atar, desatar y pedir el link son de quien edita Alumnos, sobre un alumno
   que su cuenta ve (se lee con SU sesión).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  try {
    const [resumen, bot] = await Promise.all([resumenDeIdentificacion(db), hayTelegram() ? usuarioDeBot() : Promise.resolve(null)]);
    return NextResponse.json({ resumen, bot }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer." }, { status: 500 });
  }
}

export async function POST(peticion: Request) {
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; alumnoId?: string; personaId?: string; equipo?: boolean; chatIds?: string[] };
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  if (!hayTelegram()) return NextResponse.json({ error: "Falta TELEGRAM_BOT_TOKEN en Vercel." }, { status: 503 });

  if (b.accion === "anunciar") {
    const noPuede = await exigirArea(peticion, ["ajustes"], 2, { cerrado: true });
    if (noPuede) return noPuede;
    if (!(await esDuenoDelPedido(peticion))) return NextResponse.json({ error: "Escribirle a los grupos es de los dueños." }, { status: 403 });
    try {
      return NextResponse.json(await anunciarEnLosGrupos(db, telegram, Array.isArray(b.chatIds) ? b.chatIds.map(String) : undefined));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 });
    }
  }

  const noPuede = await exigirArea(peticion, ["alumnos"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const mia = baseDelPedido(peticion);
  if (!mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const quien = correoDelPedido(peticion);
  const personaId = typeof b.personaId === "string" ? b.personaId : "";
  const alumnoId = typeof b.alumnoId === "string" ? b.alumnoId : "";

  try {
    if (b.accion === "enlace" || b.accion === "atar") {
      if (!alumnoId) return NextResponse.json({ error: "Falta el alumno." }, { status: 400 });
      const ve = (await mia.from("alumnos").select("id, nombre").eq("id", alumnoId).maybeSingle()).data as { id: string; nombre: string } | null;
      if (!ve) return NextResponse.json({ error: "No encuentro a ese alumno (o tu cuenta no lo ve)." }, { status: 404 });
      if (b.accion === "enlace") {
        const r = await enlacePersonalDelBot(db, alumnoId);
        if (!r) return NextResponse.json({ error: "No pude armar el link: ¿el bot está conectado?" }, { status: 503 });
        return NextResponse.json({ enlace: r.enlace, mensaje: mensajeParaVerificar({ nombre: ve.nombre, enlace: r.enlace }) });
      }
      if (!personaId) return NextResponse.json({ error: "Falta la cuenta de Telegram." }, { status: 400 });
      return NextResponse.json(await atarPersona(db, telegram, { personaId, alumnoId, vinculo: "manual", quien }));
    }
    if (b.accion === "desatar") {
      if (!personaId) return NextResponse.json({ error: "Falta la cuenta de Telegram." }, { status: 400 });
      await desatarPersona(db, personaId);
      return NextResponse.json({ ok: true });
    }
    if (b.accion === "equipo") {
      if (!personaId) return NextResponse.json({ error: "Falta la cuenta de Telegram." }, { status: 400 });
      const r = await db.from("telegram_personas").update({ equipo: b.equipo !== false }).eq("id", personaId);
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "No sé hacer eso." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 });
  }
}
