import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { nubeServidor } from "@/lib/servidor";
import { ID_YOUTUBE, type DatosVivo, type MensajeChat, type MuestraVivo } from "@/lib/youtube";

/* ==================================================================
   El vivo de un webinar, tal como lo guardó /api/cron/youtube: los
   espectadores minuto a minuto, cómo siguió la grabación después y el
   chat. Se lee con la clave de servicio, así que sólo le contesta al
   equipo.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Supabase devuelve de a 1000 filas: el chat de un vivo grande tiene más. */
const PAGINA = 1000;
const TOPE_CHAT = 20_000;

type Db = NonNullable<ReturnType<typeof nubeServidor>>;

async function todas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, tope: number) {
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += PAGINA) {
    const r = await pedir(desde, Math.min(desde + PAGINA, tope) - 1);
    if (r.error) throw new Error(r.error.message);
    filas.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGINA) break;
  }
  return filas;
}

interface FilaMuestra {
  minuto: string; enVivo: boolean;
  espectadores: number | null; vistas: number | null; likes: number | null; comentarios: number | null;
}
interface FilaChat {
  id: string; publicadoEn: string; autorNombre: string | null; autorCanalId: string | null; autorFoto: string | null;
  esDueno: boolean; esModerador: boolean; tipo: string | null; texto: string | null; monto: string | null;
}

const muestra = (m: FilaMuestra): MuestraVivo => ({
  t: m.minuto, enVivo: m.enVivo,
  espectadores: m.espectadores ?? undefined, vistas: m.vistas ?? undefined,
  likes: m.likes ?? undefined, comentarios: m.comentarios ?? undefined,
});

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver el vivo." }, { status: 401 });
  }
  const id = new URL(peticion.url).searchParams.get("video")?.trim() ?? "";
  if (!ID_YOUTUBE.test(id)) return NextResponse.json({ error: "Eso no es el id de un video de YouTube." }, { status: 400 });

  const vacio: DatosVivo = { hayBase: false, estado: {}, minutos: [], despues: [], chat: [], chatTotal: 0 };
  const db: Db | null = nubeServidor();
  if (!db) return NextResponse.json(vacio);

  try {
    const [re, muestras, chat, cuenta] = await Promise.all([
      db.from("yt_estado").select("estado, programado, inicio, fin, errorChat, ultimaMuestra").eq("videoId", id).maybeSingle(),
      todas<FilaMuestra>((a, b) => db.from("yt_muestras")
        .select("minuto, enVivo, espectadores, vistas, likes, comentarios")
        .eq("videoId", id).order("minuto").range(a, b), 20_000),
      todas<FilaChat>((a, b) => db.from("yt_chat")
        .select("id, publicadoEn, autorNombre, autorCanalId, autorFoto, esDueno, esModerador, tipo, texto, monto")
        .eq("videoId", id).order("publicadoEn").range(a, b), TOPE_CHAT),
      db.from("yt_chat").select("id", { count: "exact", head: true }).eq("videoId", id),
    ]);
    /* Tablas sin crear todavía: es como no tener nada guardado. */
    if (re.error && !/does not exist|schema cache|PGRST205/i.test(re.error.message)) throw new Error(re.error.message);
    const e = re.data as Record<string, string | null> | null;

    const datos: DatosVivo = {
      hayBase: true,
      estado: {
        estado: (e?.estado ?? undefined) as DatosVivo["estado"]["estado"],
        programado: e?.programado ?? undefined,
        inicio: e?.inicio ?? undefined,
        fin: e?.fin ?? undefined,
        errorChat: e?.errorChat ?? undefined,
        ultimaMuestra: e?.ultimaMuestra ?? undefined,
      },
      minutos: muestras.filter((m) => m.enVivo).map(muestra),
      despues: muestras.filter((m) => !m.enVivo).map(muestra),
      chat: chat.map((m): MensajeChat => ({
        id: m.id, t: m.publicadoEn, autor: m.autorNombre ?? "Sin nombre",
        autorCanalId: m.autorCanalId ?? undefined, foto: m.autorFoto ?? undefined,
        esDueno: m.esDueno || undefined, esModerador: m.esModerador || undefined,
        tipo: m.tipo ?? undefined, texto: m.texto ?? "", monto: m.monto ?? undefined,
      })),
      chatTotal: cuenta.count ?? chat.length,
    };
    return NextResponse.json(datos, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/does not exist|schema cache|PGRST205/i.test(msg)) {
      return NextResponse.json({ ...vacio, hayBase: true, sinTablas: true });
    }
    console.error("[youtube/vivo]", msg);
    return NextResponse.json({ error: "No pude leer lo guardado del vivo." }, { status: 502 });
  }
}
